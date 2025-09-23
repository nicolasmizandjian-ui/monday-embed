// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";
import QRCode from "qrcode";
import dayjs from "dayjs";

const monday = mondaySdk();

/* =========================
   CONFIG — UN SEUL BOARD
   ========================= */
const BOARD_ID = 7678082330;     // ENTRÉES DE STOCK
const ORDER_BOARD_ID = BOARD_ID; // Commandes = même board
const STOCK_BOARD_ID = BOARD_ID; // Stock (rouleaux) = même board

// Groupes — pour l’instant tu n’as que "Stock entrant" (id "topics")
// Tu pourras créer un groupe "COMMANDES" plus tard, et mettre son id ci-dessous.
const ORDER_GROUP_ID = "topics";
const STOCK_GROUP_ID = "topics";

/* =========================
   COLONNES (IDs réels)
   ========================= */
// Colonnes générales du board (déjà en place chez toi)
const COL_SUPPLIER   = "texte9";             // FOURNISSEUR (Text)
const COL_PRODUCT    = "texte2";             // Description produit (Text)
const COL_QTY        = "quantit__produit";   // Quantité produit (Numbers)
const COL_UNIT       = "texte25";            // Unité (Text)
const COL_WIDTH      = "laize";              // Laize (mm) (Numbers)
const COL_LENGTH     = "longueur__mm_";      // Longueur / Poids (Numbers)
const COL_BATCH      = "batch_fournisseur2"; // Batch FOURNISSEUR (Text)
const COL_DATE_IN    = "date1";              // Date entrée (Date)
const COL_QR_VALUE   = "text_mkw2pzva";      // QR_VALUE (Text)
const COL_QR_FILE    = "fichiers";           // (Files) si tu souhaites upload le PNG (optionnel)

// Colonnes “suivi commande” (même board). Si tu ne les as pas encore, laisse vide.
const ORDER_COL_SUPPLIER = COL_SUPPLIER;
const ORDER_COL_PRODUCT  = COL_PRODUCT;
const ORDER_COL_ORDERED  = COL_QTY;  // on réutilise la même colonne pour "qté commandée"
const ORDER_COL_RECEIVED = "";       // ← mets ici l'ID de ta colonne Numbers "QTE_RECUE" (si/qd créée)
const ORDER_COL_STATUS   = "";       // ← mets ici l'ID de ta colonne Status "STATUT_RECEPTION" (si/qd créée)
const ORDER_COL_WIDTH    = COL_WIDTH;
const ORDER_COL_UNIT     = COL_UNIT;

/* =========================
   HELPERS
   ========================= */
const fmt2n = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const fmt2s = (x) => fmt2n(x).toFixed(2);

const makeRollCode = ({ dateISO, orderId, rollIndex }) => {
  const d = dayjs(dateISO).format("YYYYMMDD");
  const idx = String(rollIndex + 1).padStart(2, "0");
  return `ROL-${d}-${orderId}-R${idx}`;
};

const makeQrPayload = ({ boardId, itemId, ref, laize, length, batch, dateISO }) => {
  return JSON.stringify({
    bid: boardId,
    iid: itemId,
    ref,
    wz: laize,
    L: length,
    b: batch,
    dt: dayjs(dateISO).format("YYYY-MM-DD"),
  });
};

async function dataUrlToFile(dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: "image/png" });
}

/* =========================
   GQL
   ========================= */
const QRY_ORDER_ITEMS_PAGE = `
  query($boardId: [Int], $limit: Int!, $cursor: String) {
    boards(ids: $boardId) {
      items_page(limit: $limit, cursor: $cursor) {
        cursor
        items {
          id
          name
          group { id title }
          column_values { id text value }
        }
      }
    }
  }
`;

const MUT_CREATE_ITEM = `
  mutation($boardId: Int!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
    create_item(board_id: $boardId, group_id: $groupId, item_name: $itemName, column_values: $columnValues) {
      id
    }
  }
`;

const MUT_CHANGE_COL_VAL = `
  mutation($boardId: Int!, $itemId: Int!, $columnId: String!, $value: JSON!) {
    change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) {
      id
    }
  }
`;

const MUT_ADD_FILE_TO_COL = `
  mutation($itemId: Int!, $columnId: String!, $file: File!) {
    add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) {
      id
    }
  }
`;

/* =========================
   SERVICES
   ========================= */
async function fetchOrderLinesFromGroup(boardId, groupId) {
  const out = [];
  let cursor = null;
  do {
    const res = await monday.api(QRY_ORDER_ITEMS_PAGE, {
      variables: { boardId: [boardId], limit: 200, cursor },
    });
    const page = res?.data?.boards?.[0]?.items_page;
    const items = page?.items || [];
    items.forEach((it) => {
      if (it?.group?.id === groupId) out.push(it);
    });
    cursor = page?.cursor || null;
  } while (cursor);
  return out;
}

function mapOrderItemToOrderLine(item) {
  const byId = {};
  (item.column_values || []).forEach((cv) => (byId[cv.id] = cv));

  const supplier = byId[ORDER_COL_SUPPLIER]?.text || "";
  const product  = byId[ORDER_COL_PRODUCT]?.text || item.name || "";
  const ordered  = Number((byId[ORDER_COL_ORDERED]?.text || "0").replace(",", ".")) || 0;
  const received = ORDER_COL_RECEIVED
    ? Number((byId[ORDER_COL_RECEIVED]?.text || "0").replace(",", ".")) || 0
    : 0; // si pas de colonne, on considère 0 reçu
  const remaining = fmt2n(ordered - received);

  const laize    = Number((byId[ORDER_COL_WIDTH]?.text || "").replace(",", ".")) || null;
  const unit     = (byId[ORDER_COL_UNIT]?.text || "ML").trim() || "ML";
  const status   = byId[ORDER_COL_STATUS]?.text || "";

  return {
    orderItemId: Number(item.id),
    supplier,
    product,
    orderedQty: ordered,
    receivedQty: received,
    remainingQty: remaining,
    laize,
    unit,
    status,
  };
}

async function createStockItemsFromReceipt({
  orderLine,
  qtyReceived,
  rollsCount,
  lengths, // null => répartition égale
  batch,
  dateISO,
  uploadQrPng = false,
}) {
  const perRoll = lengths?.length === rollsCount
    ? lengths.map(fmt2n)
    : Array.from({ length: rollsCount }, () => fmt2n(qtyReceived / rollsCount));

  const created = [];

  for (let i = 0; i < rollsCount; i++) {
    const L = fmt2n(perRoll[i]);
    const Ls = fmt2s(L);
    const itemName = makeRollCode({ dateISO, orderId: orderLine.orderItemId, rollIndex: i });

    const colVals = {
      [COL_SUPPLIER]: { text: orderLine.supplier || "" },
      [COL_PRODUCT]:  { text: orderLine.product || "" },
      [COL_QTY]:      Ls,                                  // Numbers → string "x.xx"
      [COL_UNIT]:     { text: orderLine.unit || "ML" },
      [COL_WIDTH]:    orderLine.laize != null ? fmt2s(orderLine.laize) : null,
      [COL_LENGTH]:   Ls,
      [COL_BATCH]:    { text: batch || "" },
      [COL_DATE_IN]:  { date: dayjs(dateISO).format("YYYY-MM-DD") },
    };

    // 1) Créer l'item rouleau
    const res = await monday.api(MUT_CREATE_ITEM, {
      variables: {
        boardId: STOCK_BOARD_ID,
        groupId: STOCK_GROUP_ID,
        itemName,
        columnValues: JSON.stringify(colVals),
      },
    });
    const newItemId = Number(res?.data?.create_item?.id);
    if (!newItemId) continue;

    // 2) Écrire la valeur du QR dans la colonne texte
    const qrValue = makeQrPayload({
      boardId: STOCK_BOARD_ID,
      itemId: newItemId,
      ref: itemName,
      laize: orderLine.laize,
      length: L,
      batch,
      dateISO,
    });
    try {
      await monday.api(MUT_CHANGE_COL_VAL, {
        variables: {
          boardId: STOCK_BOARD_ID,
          itemId: newItemId,
          columnId: COL_QR_VALUE,
          value: JSON.stringify({ text: qrValue }),
        },
      });
    } catch (e) {
      // si pas de colonne, on ignore
    }

    // 3) Générer le PNG (DataURL) pour l’aperçu / téléchargement
    const dataUrl = await QRCode.toDataURL(qrValue, { errorCorrectionLevel: "M", margin: 1, scale: 6 });

    // 4) (Option) Uploader le PNG en colonne Fichier
    if (uploadQrPng) {
      try {
        const file = await dataUrlToFile(dataUrl, `${itemName}.png`);
        await monday.api(MUT_ADD_FILE_TO_COL, {
          variables: { itemId: newItemId, columnId: COL_QR_FILE, file },
        });
      } catch (e) {
        // selon le contexte, l’upload de fichier GraphQL peut ne pas être dispo
      }
    }

    created.push({ itemId: newItemId, itemName, dataUrl, qrValue, length: L });
  }

  return created;
}

async function updateOrderLineAfterReceipt({
  orderItemId,
  orderedQty,
  alreadyReceivedQty,
  addedReceivedQty,
}) {
  const newReceived = fmt2n(Number(alreadyReceivedQty || 0) + Number(addedReceivedQty || 0));
  const remaining   = fmt2n(Number(orderedQty || 0) - newReceived);

  // maj Qté reçue si la colonne existe
  if (ORDER_COL_RECEIVED) {
    await monday.api(MUT_CHANGE_COL_VAL, {
      variables: {
        boardId: ORDER_BOARD_ID,
        itemId: Number(orderItemId),
        columnId: ORDER_COL_RECEIVED,
        value: JSON.stringify(fmt2s(newReceived)),
      },
    });
  }

  // maj Statut si la colonne existe
  if (ORDER_COL_STATUS) {
    const status = remaining <= 0 ? { label: "Réception OK" } : { label: "Réception partielle" };
    await monday.api(MUT_CHANGE_COL_VAL, {
      variables: {
        boardId: ORDER_BOARD_ID,
        itemId: Number(orderItemId),
        columnId: ORDER_COL_STATUS,
        value: JSON.stringify(status),
      },
    });
  }

  return { newReceived, remaining };
}

/* =========================
   UI — DIALOG RÉCEPTION
   ========================= */
function ReceiveDialog({ open, onClose, orderLine, onDone }) {
  const [qty, setQty] = useState(orderLine?.remainingQty ?? 0);
  const [rolls, setRolls] = useState(1);
  const [mode, setMode] = useState("egal"); // "egal" | "perso"
  const [laize, setLaize] = useState(orderLine?.laize ?? "");
  const [batch, setBatch] = useState("");
  const [dateISO, setDateISO] = useState(new Date().toISOString());
  const [lengths, setLengths] = useState([]);

  useEffect(() => {
    if (open) {
      setQty(orderLine?.remainingQty ?? 0);
      setRolls(1);
      setMode("egal");
      setLaize(orderLine?.laize ?? "");
      setBatch("");
      setDateISO(new Date().toISOString());
      setLengths([]);
    }
  }, [open, orderLine]);

  const perRoll = useMemo(() => fmt2n((Number(qty) || 0) / (Number(rolls) || 1)), [qty, rolls]);

  const totalPerso = useMemo(() => {
    if (mode !== "perso") return fmt2n(perRoll * rolls);
    return fmt2n((lengths || []).reduce((s, v) => s + Number(v || 0), 0));
  }, [mode, perRoll, rolls, lengths]);

  const delta = fmt2n(Number(qty || 0) - Number(totalPerso));

  const proceed = async () => {
    const payloadLengths = mode === "perso" ? lengths : null;

    const created = await createStockItemsFromReceipt({
      orderLine: { ...orderLine, laize: Number(laize) || null },
      qtyReceived: Number(qty),
      rollsCount: Number(rolls),
      lengths: payloadLengths,
      batch,
      dateISO,
      uploadQrPng: false, // passe à true si tu veux uploader le PNG dans la colonne Files
    });

    await updateOrderLineAfterReceipt({
      orderItemId: orderLine.orderItemId,
      orderedQty: orderLine.orderedQty,
      alreadyReceivedQty: orderLine.receivedQty,
      addedReceivedQty: Number(qty),
    });

    onDone?.(created);
    onClose?.();
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0" style={{background: "rgba(0,0,0,.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:9999}}>
      <div className="bg-white" style={{borderRadius:16, padding:16, width:"100%", maxWidth:800, boxShadow:"0 10px 30px rgba(0,0,0,.2)"}}>
        <h2 style={{fontSize:18, fontWeight:600, marginBottom:8}}>
          Réception – {orderLine?.product} {orderLine?.supplier ? `(${orderLine?.supplier})` : ""}
        </h2>

        <div style={{display:"grid", gridTemplateColumns:"1fr 1fr", gap:12}}>
          <label style={{display:"flex", flexDirection:"column"}}>
            Quantité reçue ({orderLine?.unit || "ML"})
            <input type="number" step="0.01" value={qty} onChange={(e)=>setQty(e.target.value)} style={{border:"1px solid #ccc", borderRadius:8, padding:8}}/>
          </label>

          <label style={{display:"flex", flexDirection:"column"}}>
            Nombre de rouleaux
            <input type="number" min="1" value={rolls} onChange={(e)=>{
              const r = Math.max(1, Number(e.target.value) || 1);
              setRolls(r);
              if (mode === "perso") {
                setLengths((prev)=>{
                  const copy = Array.from({length:r}, (_,i)=> prev?.[i] ?? perRoll);
                  return copy.map(fmt2n);
                });
              }
            }} style={{border:"1px solid #ccc", borderRadius:8, padding:8}}/>
          </label>

          <label style={{display:"flex", flexDirection:"column"}}>
            Répartition
            <select value={mode} onChange={(e)=>setMode(e.target.value)} style={{border:"1px solid #ccc", borderRadius:8, padding:8}}>
              <option value="egal">Égale ({fmt2s(perRoll)} / rouleau)</option>
              <option value="perso">Personnalisée</option>
            </select>
          </label>

          <label style={{display:"flex", flexDirection:"column"}}>
            Laize (mm)
            <input type="number" step="0.01" value={laize ?? ""} onChange={(e)=>setLaize(e.target.value)} style={{border:"1px solid #ccc", borderRadius:8, padding:8}}/>
          </label>

          <label style={{display:"flex", flexDirection:"column"}}>
            Batch fournisseur
            <input type="text" value={batch} onChange={(e)=>setBatch(e.target.value)} style={{border:"1px solid #ccc", borderRadius:8, padding:8}}/>
          </label>

          <label style={{display:"flex", flexDirection:"column"}}>
            Date d’entrée
            <input type="date" value={dayjs(dateISO).format("YYYY-MM-DD")} onChange={(e)=>setDateISO(new Date(e.target.value).toISOString())} style={{border:"1px solid #ccc", borderRadius:8, padding:8}}/>
          </label>
        </div>

        {mode === "perso" && (
          <div style={{marginTop:12}}>
            <table style={{width:"100%", fontSize:14}}>
              <thead>
                <tr><th style={{textAlign:"left"}}>Rouleau</th><th style={{textAlign:"left"}}>Longueur</th></tr>
              </thead>
              <tbody>
                {Array.from({length: rolls}).map((_,i)=>(
                  <tr key={i}>
                    <td>R{i+1}</td>
                    <td>
                      <input type="number" step="0.01" value={lengths?.[i] ?? perRoll}
                        onChange={(e)=>{
                          const v = fmt2n(e.target.value);
                          setLengths((prev)=>{
                            const x = [...(prev||[])];
                            x[i] = v;
                            return x;
                          });
                        }}
                        style={{border:"1px solid #ccc", borderRadius:8, padding:6}}/>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{marginTop:6, color: delta===0 ? "#16a34a" : "#dc2626"}}>
              Somme longueurs = {fmt2s(totalPerso)} (Δ = {fmt2s(delta)} vs quantité reçue)
            </p>
          </div>
        )}

        <div style={{marginTop:16, display:"flex", gap:8, justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{border:"1px solid #ccc", borderRadius:8, padding:"8px 12px", background:"#fff"}}>Annuler</button>
          <button
            onClick={proceed}
            disabled={Number(qty)<=0 || (mode==="perso" && delta!==0)}
            style={{border:"1px solid #000", borderRadius:8, padding:"8px 12px", background:"#000", color:"#fff"}}
          >
            Valider la réception
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================
   UI PRINCIPALE — BOUTONS + VUES
   ========================= */
const VIEWS = { RECEPTION: "RECEPTION", OUTBOUND: "OUTBOUND", INVENTORY: "INVENTORY" };
function cx(...cls) { return cls.filter(Boolean).join(" "); }

export default function App() {
  const [view, setView] = useState(VIEWS.RECEPTION);
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [allLines, setAllLines] = useState([]);
  const [pendingLines, setPendingLines] = useState([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState(null);
  const [lastCreated, setLastCreated] = useState([]);

  // On log le contexte pour debug mais on n'écrase pas BOARD_ID
  useEffect(() => {
    monday.get("context").then((res) => {
      console.log("Contexte Monday (board ouvert):", res?.data);
    });
  }, []);

  // Charger toutes les lignes du groupe COMMANDES (actuellement "topics")
  useEffect(() => {
    (async () => {
      const items = await fetchOrderLinesFromGroup(ORDER_BOARD_ID, ORDER_GROUP_ID);
      const lines = items.map(mapOrderItemToOrderLine);

      // Fournisseurs uniques
      const uniq = Array.from(new Set(lines.map((l) => l.supplier).filter(Boolean))).sort();
      setSuppliers(uniq);
      if (!selectedSupplier && uniq.length > 0) {
        setSelectedSupplier(uniq[0]);
      }

      setAllLines(lines);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtrer selon fournisseur + “reste > 0”
  useEffect(() => {
    const filtered = allLines.filter((l) =>
      (selectedSupplier ? l.supplier === selectedSupplier : true) &&
      Number(l.remainingQty) > 0
    );
    setPendingLines(filtered);
  }, [allLines, selectedSupplier]);

  const onClickLine = (line) => {
    setSelectedLine(line);
    setDialogOpen(true);
  };

  return (
    <div style={{padding:16, display:"grid", gap:16}}>
      {/* Toolbar */}
      <header style={{display:"flex", alignItems:"center", justifyContent:"space-between"}}>
        <div style={{fontSize:12, opacity:0.7}}>
          Source: ENTRÉES DE STOCK #{BOARD_ID} • Groupe stock: {STOCK_GROUP_ID}
        </div>
        <nav style={{display:"flex", gap:8}}>
          <button
            onClick={() => setView(VIEWS.RECEPTION)}
            className={cx("btn")}
            style={{
              padding:"8px 12px", borderRadius:8, border:"1px solid",
              background: view===VIEWS.RECEPTION ? "#000" : "#fff",
              color: view===VIEWS.RECEPTION ? "#fff" : "#000"
            }}
          >
            Mettre en stock
          </button>
          <button
            onClick={() => setView(VIEWS.OUTBOUND)}
            style={{
              padding:"8px 12px", borderRadius:8, border:"1px solid",
              background: view===VIEWS.OUTBOUND ? "#000" : "#fff",
              color: view===VIEWS.OUTBOUND ? "#fff" : "#000"
            }}
          >
            Sortie stock
          </button>
          <button
            onClick={() => setView(VIEWS.INVENTORY)}
            style={{
              padding:"8px 12px", borderRadius:8, border:"1px solid",
              background: view===VIEWS.INVENTORY ? "#000" : "#fff",
              color: view===VIEWS.INVENTORY ? "#fff" : "#000"
            }}
          >
            Inventaire
          </button>
        </nav>
      </header>

      {/* VUE RECEPTION */}
      {view === VIEWS.RECEPTION && (
        <>
          {/* Sélecteur fournisseur */}
          <div style={{display:"flex", gap:8, alignItems:"center"}}>
            <span>Fournisseur :</span>
            <select
              value={selectedSupplier}
              onChange={(e)=>setSelectedSupplier(e.target.value)}
              style={{border:"1px solid #ccc", borderRadius:8, padding:8}}
            >
              {suppliers.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Lignes à réceptionner */}
          <div style={{border:"1px solid #eee", borderRadius:16, padding:12}}>
            <h2 style={{fontSize:18, fontWeight:600, marginBottom:8}}>Lignes à réceptionner</h2>
            <table style={{width:"100%", fontSize:14}}>
              <thead>
                <tr style={{textAlign:"left"}}>
                  <th>Produit</th>
                  <th>Qté cmd</th>
                  <th>Qté reçue</th>
                  <th>Reste</th>
                  <th>Laize</th>
                  <th>Unité</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendingLines.length === 0 && (
                  <tr><td colSpan={7} style={{color:"#666", padding:"8px 0"}}>Aucune ligne en attente pour ce fournisseur.</td></tr>
                )}
                {pendingLines.map((l) => (
                  <tr key={l.orderItemId} style={{borderTop:"1px solid #f0f0f0"}}>
                    <td style={{padding:"6px 0"}}>{l.product}</td>
                    <td>{fmt2s(l.orderedQty)}</td>
                    <td>{fmt2s(l.receivedQty)}</td>
                    <td style={{fontWeight:600}}>{fmt2s(l.remainingQty)}</td>
                    <td>{l.laize != null ? fmt2s(l.laize) : "-"}</td>
                    <td>{l.unit || "ML"}</td>
                    <td>
                      <button
                        onClick={() => onClickLine(l)}
                        style={{padding:"6px 10px", borderRadius:8, border:"1px solid #000", background:"#000", color:"#fff"}}
                      >
                        Mettre en stock
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Récap QR créés */}
          {lastCreated.length > 0 && (
            <div style={{border:"1px solid #eee", borderRadius:16, padding:12}}>
              <h3 style={{fontWeight:600, marginBottom:8}}>Récap – QR créés</h3>
              <div style={{display:"grid", gap:12, gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))"}}>
                {lastCreated.map((c) => (
                  <div key={c.itemId} style={{border:"1px solid #eee", borderRadius:12, padding:8}}>
                    <div style={{fontSize:13, fontWeight:600}}>{c.itemName}</div>
                    <div style={{fontSize:12, color:"#666", marginBottom:6}}>Longueur: {fmt2s(c.length)}</div>
                    <img src={c.dataUrl} alt={`QR ${c.itemName}`} style={{width:160, height:160, objectFit:"contain"}} />
                    <a href={c.dataUrl} download={`${c.itemName}.png`} style={{display:"inline-block", marginTop:6, fontSize:12, textDecoration:"underline"}}>
                      Télécharger le QR
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dialog */}
          {selectedLine && (
            <ReceiveDialog
              open={dialogOpen}
              onClose={() => setDialogOpen(false)}
              orderLine={selectedLine}
              onDone={(created) => setLastCreated(created)}
            />
          )}
        </>
      )}

      {/* VUE SORTIE (placeholder) */}
      {view === VIEWS.OUTBOUND && (
        <div style={{border:"1px solid #eee", borderRadius:16, padding:12}}>
          <h2 style={{fontSize:18, fontWeight:600, marginBottom:8}}>Sortie stock</h2>
          <p style={{fontSize:13, opacity:0.7}}>À venir : sélection d’articles (scan QR), quantité sortie, motif, document de sortie.</p>
        </div>
      )}

      {/* VUE INVENTAIRE (placeholder) */}
      {view === VIEWS.INVENTORY && (
        <div style={{border:"1px solid #eee", borderRadius:16, padding:12}}>
          <h2 style={{fontSize:18, fontWeight:600, marginBottom:8}}>Inventaire</h2>
          <p style={{fontSize:13, opacity:0.7}}>À venir : filtres (fournisseur/matière/laize), regroupements, export CSV.</p>
        </div>
      )}
    </div>
  );
}
