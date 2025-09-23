// src/App.jsx
import React, { useEffect, useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";
import QRCode from "qrcode";
import dayjs from "dayjs";

const monday = mondaySdk();

/** ============================
 *  ===  PARAMÈTRES À RENSEIGNER ===
 *  ============================ */
// Un seul et même board pour Commandes + Stock
const BOARD_ID = 7678082330;
const ORDER_BOARD_ID = BOARD_ID;
const STOCK_BOARD_ID = BOARD_ID;

// === GROUPES ===
// ⚠️ Option immédiate (un seul groupe) :
const ORDER_GROUP_ID = "topics";      // tu n'as pour l’instant que "Stock entrant"
const STOCK_GROUP_ID = "topics";


// Colonnes ENTRÉES DE STOCK (déjà partagées)
const COL_SUPPLIER   = "texte9";             // FOURNISSEUR (Text)
const COL_PRODUCT    = "texte2";             // Description produit (Text)
const COL_QTY        = "quantit__produit";   // Quantité produit (Numbers)
const COL_UNIT       = "texte25";            // Unité (Text)
const COL_WIDTH      = "laize";              // Laize (mm) (Numbers)
const COL_LENGTH     = "longueur__mm_";      // Longueur / Poids (Numbers)
const COL_BATCH      = "batch_fournisseur2"; // Batch FOURNISSEUR (Text)
const COL_DATE_IN    = "date1";              // Date entrée (Date)
// Conseillé : ajoutez une colonne Texte pour stocker la valeur encodée du QR
// Colonne texte qui stocke la valeur encodée du QR
const COL_QR_VALUE = "text_mkw2pzva";
// Optionnel : une colonne Fichier pour uploader le PNG du QR
const COL_QR_FILE    = "fichiers";           // (Files) si vous souhaitez l’upload

// --- BOARD COMMANDES (à adapter à votre board “Commandes/Fournisseurs”) ---
const ORDER_BOARD_ID     = 1234567890; // TODO: Renseignez l’ID de votre board Commandes
const ORDER_COL_SUPPLIER = "supplier"; // TODO: Colonne fournisseur (Text / Connect Board / Mirror -> texte)
const ORDER_COL_PRODUCT  = "item_desc"; // TODO: Désignation (Text)
const ORDER_COL_ORDERED  = "qty_cmd";   // TODO: Quantité commandée (Numbers)
const ORDER_COL_RECEIVED = "qty_rcv";   // TODO: Quantité déjà réceptionnée (Numbers)
const ORDER_COL_STATUS   = "status";    // TODO: Statut (Status) (ex. “Réception partielle” / “Réception OK”)
const ORDER_COL_WIDTH    = "laize";     // TODO: Laize (Numbers) si présente sur la ligne de commande
const ORDER_COL_UNIT     = "unit";      // TODO: Unité (Text) ex. “ML”

/** ============================
 *  ===  HELPERS / UTILITAIRES ===
 *  ============================ */

const fmt2n = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
const fmt2s = (x) => fmt2n(x).toFixed(2); // string “2 décimales” pour colonnes Numbers

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

/** ============================
 *  ===  GRAPHQL QUERIES/MUTATIONS ===
 *  ============================ */

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

const QRY_ORDER_ITEMS_PAGE = `
  query($boardId: [Int], $limit: Int!, $cursor: String) {
    boards(ids: $boardId) {
      items_page(limit: $limit, cursor: $cursor) {
        cursor
        items {
          id
          name
          column_values {
            id
            text
            value
          }
        }
      }
    }
  }
`;

/** ============================
 *  ===  SERVICES MONDAY ===
 *  ============================ */

// Récupération *simple* (client-side filtering) des lignes de commande.
// Vous avez déjà une liste opérationnelle : vous pouvez garder la vôtre
// et simplement nourrir "PendingLines" avec vos données.
// Ici, on montre un exemple générique à adapter (IDs ci-dessus).
async function fetchOrderLinesAll() {
  const out = [];
  let cursor = null;
  do {
    const res = await monday.api(QRY_ORDER_ITEMS_PAGE, {
      variables: { boardId: [ORDER_BOARD_ID], limit: 200, cursor },
    });
    const page = res?.data?.boards?.[0]?.items_page;
    const items = page?.items || [];
    items.forEach((it) => out.push(it));
    cursor = page?.cursor || null;
  } while (cursor);
  return out;
}

// Mapping item Monday -> structure "orderLine" utilisée par le dialog
function mapOrderItemToOrderLine(item) {
  const byId = {};
  item.column_values.forEach((cv) => (byId[cv.id] = cv));

  const supplier = byId[ORDER_COL_SUPPLIER]?.text || "";
  const product  = byId[ORDER_COL_PRODUCT]?.text || item.name || "";
  const ordered  = Number(byId[ORDER_COL_ORDERED]?.text?.replace(",", ".") || 0);
  const received = Number(byId[ORDER_COL_RECEIVED]?.text?.replace(",", ".") || 0);
  const remaining = fmt2n(ordered - received);
  const laize    = Number(byId[ORDER_COL_WIDTH]?.text?.replace(",", ".") || 0) || null;
  const unit     = byId[ORDER_COL_UNIT]?.text || "ML";
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

// Créer 1 item par rouleau dans le board STOCK + QR (texte + PNG optionnel)
async function createStockItemsFromReceipt({
  orderLine,
  qtyReceived,
  rollsCount,
  lengths,     // null -> répartition égale
  batch,
  dateISO,
  uploadQrPng = false, // mettez true si vous avez la colonne Files et que l’upload fonctionne
}) {
  const perRoll = lengths?.length === rollsCount
    ? lengths.map(fmt2n)
    : Array.from({ length: rollsCount }, () => fmt2n(qtyReceived / rollsCount));

  const created = [];

  for (let i = 0; i < rollsCount; i++) {
    const L = fmt2n(perRoll[i]);
    const Ls = fmt2s(L); // string “2 déc.”
    const itemName = makeRollCode({ dateISO, orderId: orderLine.orderItemId, rollIndex: i });

    // IMPORTANT : passer des *strings* pour les colonnes Numbers afin d’éviter les formats exotiques
    const colVals = {
      [COL_SUPPLIER]: { text: orderLine.supplier || "" },
      [COL_PRODUCT]:  { text: orderLine.product || "" },
      [COL_QTY]:      Ls,
      [COL_UNIT]:     { text: orderLine.unit || "ML" },
      [COL_WIDTH]:    orderLine.laize != null ? fmt2s(orderLine.laize) : null,
      [COL_LENGTH]:   Ls,
      [COL_BATCH]:    { text: batch || "" },
      [COL_DATE_IN]:  { date: dayjs(dateISO).format("YYYY-MM-DD") },
    };

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

    // QR : valeur texte (utile pour réimprimer/relire)
    const qrValue = makeQrPayload({
      boardId: STOCK_BOARD_ID,
      itemId: newItemId,
      ref: itemName,
      laize: orderLine.laize,
      length: L,
      batch,
      dateISO,
    });

    // Sauvegarder la valeur dans la colonne texte si présente
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
      // si la colonne n’existe pas, ignorer
    }

    // Générer le PNG (DataURL) pour l’aperçu / téléchargement
    const dataUrl = await QRCode.toDataURL(qrValue, { errorCorrectionLevel: "M", margin: 1, scale: 6 });

    // Optionnel : uploader dans la colonne Fichier
    if (uploadQrPng) {
      try {
        const file = await dataUrlToFile(dataUrl, `${itemName}.png`);
        await monday.api(MUT_ADD_FILE_TO_COL, {
          variables: { itemId: newItemId, columnId: COL_QR_FILE, file },
        });
      } catch (e) {
        // selon navigateur/compte, l’upload GraphQL de file peut varier
      }
    }

    created.push({ itemId: newItemId, itemName, dataUrl, qrValue, length: L });
  }

  return created;
}

// Mettre à jour la ligne de commande (quantité reçue + statut)
async function updateOrderLineAfterReceipt({
  orderItemId,
  orderedQty,
  alreadyReceivedQty,
  addedReceivedQty,
}) {
  const newReceived = fmt2n(Number(alreadyReceivedQty || 0) + Number(addedReceivedQty || 0));
  const remaining   = fmt2n(Number(orderedQty || 0) - newReceived);

  // maj quantité reçue
  await monday.api(MUT_CHANGE_COL_VAL, {
    variables: {
      boardId: ORDER_BOARD_ID,
      itemId: Number(orderItemId),
      columnId: ORDER_COL_RECEIVED,
      value: JSON.stringify(fmt2s(newReceived)),
    },
  });

  // statut
  const status = remaining <= 0 ? { label: "Réception OK" } : { label: "Réception partielle" };
  await monday.api(MUT_CHANGE_COL_VAL, {
    variables: {
      boardId: ORDER_BOARD_ID,
      itemId: Number(orderItemId),
      columnId: ORDER_COL_STATUS,
      value: JSON.stringify(status),
    },
  });

  return { newReceived, remaining };
}

/** ============================
 *  ===  UI: DIALOG RÉCEPTION ===
 *  ============================ */

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
      uploadQrPng: false, // passez à true si vous avez bien la colonne Files et que ça fonctionne
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-4 w-full max-w-2xl shadow-xl">
        <h2 className="text-xl font-semibold mb-2">
          Réception – {orderLine?.product} ({orderLine?.supplier})
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col">
            Quantité reçue ({orderLine?.unit || "ML"})
            <input
              type="number"
              step="0.01"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="border rounded p-2"
            />
          </label>

          <label className="flex flex-col">
            Nombre de rouleaux
            <input
              type="number"
              min="1"
              value={rolls}
              onChange={(e) => {
                const r = Math.max(1, Number(e.target.value) || 1);
                setRolls(r);
                if (mode === "perso") {
                  setLengths((prev) => {
                    const copy = Array.from({ length: r }, (_, i) => prev?.[i] ?? perRoll);
                    return copy.map(fmt2n);
                  });
                }
              }}
              className="border rounded p-2"
            />
          </label>

          <label className="flex flex-col">
            Répartition
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="border rounded p-2"
            >
              <option value="egal">Égale ({fmt2s(perRoll)} / rouleau)</option>
              <option value="perso">Personnalisée</option>
            </select>
          </label>

          <label className="flex flex-col">
            Laize (mm)
            <input
              type="number"
              step="0.01"
              value={laize}
              onChange={(e) => setLaize(e.target.value)}
              className="border rounded p-2"
            />
          </label>

          <label className="flex flex-col">
            Batch fournisseur
            <input
              type="text"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              className="border rounded p-2"
            />
          </label>

          <label className="flex flex-col">
            Date d’entrée
            <input
              type="date"
              value={dayjs(dateISO).format("YYYY-MM-DD")}
              onChange={(e) => setDateISO(new Date(e.target.value).toISOString())}
              className="border rounded p-2"
            />
          </label>
        </div>

        {mode === "perso" && (
          <div className="mt-3">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Rouleau</th>
                  <th className="text-left">Longueur</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rolls }).map((_, i) => (
                  <tr key={i}>
                    <td>R{i + 1}</td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="border rounded p-1"
                        value={lengths?.[i] ?? perRoll}
                        onChange={(e) => {
                          const v = fmt2n(e.target.value);
                          setLengths((prev) => {
                            const x = [...(prev || [])];
                            x[i] = v;
                            return x;
                          });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`mt-1 ${delta === 0 ? "text-green-600" : "text-red-600"}`}>
              Somme longueurs = {fmt2s(totalPerso)} (Δ = {fmt2s(delta)} vs quantité reçue)
            </p>
          </div>
        )}

        <div className="mt-4 flex gap-2 justify-end">
          <button onClick={onClose} className="border rounded px-3 py-2">Annuler</button>
          <button
            onClick={proceed}
            disabled={Number(qty) <= 0 || (mode === "perso" && delta !== 0)}
            className="bg-black text-white rounded px-3 py-2"
          >
            Valider la réception
          </button>
        </div>
      </div>
    </div>
  );
}

/** ============================
 *  ===  UI PRINCIPALE (App) ===
 *  ============================ */

export default function App() {
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [pendingLines, setPendingLines] = useState([]);

  // Dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState(null);
  const [lastCreated, setLastCreated] = useState([]); // récap des items/QR créés

  // Exemple générique: récupérer toutes les lignes, filtrer par fournisseur et statut (client-side)
  useEffect(() => {
    (async () => {
      // Si vous avez DÉJÀ votre logique fournisseur + lignes, vous pouvez SUPPRIMER ce bloc
      const items = await fetchOrderLinesAll();
      const lines = items.map(mapOrderItemToOrderLine);

      // fournisseurs uniques
      const uniq = Array.from(new Set(lines.map((l) => l.supplier).filter(Boolean))).sort();
      setSuppliers(uniq);

      // si aucun fournisseur sélectionné, prendre le 1er s’il existe
      if (!selectedSupplier && uniq.length > 0) {
        setSelectedSupplier(uniq[0]);
      }

      // maj lignes selon filtre courant
      const filtered = lines.filter(
        (l) =>
          (!!selectedSupplier ? l.supplier === selectedSupplier : true) &&
          l.remainingQty > 0 // non réceptionné totalement
      );
      setPendingLines(filtered);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSupplier]);

  const onClickLine = (line) => {
    setSelectedLine(line);
    setDialogOpen(true);
  };

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Réceptions fournisseurs → Stock</h1>
      </header>

      {/* Sélecteur fournisseur */}
      <div className="flex items-center gap-2">
        <span>Fournisseur :</span>
        <select
          className="border rounded p-2"
          value={selectedSupplier}
          onChange={(e) => setSelectedSupplier(e.target.value)}
        >
          {suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Lignes non réceptionnées */}
      <div className="border rounded-2xl p-3">
        <h2 className="text-lg font-medium mb-2">Lignes à réceptionner</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
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
              <tr><td colSpan={7} className="text-gray-500 p-2">Aucune ligne en attente pour ce fournisseur.</td></tr>
            )}
            {pendingLines.map((l) => (
              <tr key={l.orderItemId} className="border-t">
                <td className="py-1">{l.product}</td>
                <td>{fmt2s(l.orderedQty)}</td>
                <td>{fmt2s(l.receivedQty)}</td>
                <td className="font-medium">{fmt2s(l.remainingQty)}</td>
                <td>{l.laize ? fmt2s(l.laize) : "-"}</td>
                <td>{l.unit || "ML"}</td>
                <td>
                  <button
                    onClick={() => onClickLine(l)}
                    className="text-white bg-black rounded px-3 py-1"
                  >
                    Mettre en stock
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Récapitulatif dernière réception (QR téléchargeables) */}
      {lastCreated.length > 0 && (
        <div className="border rounded-2xl p-3">
          <h3 className="font-medium mb-2">Récap – QR créés</h3>
          <div className="grid md:grid-cols-3 gap-3">
            {lastCreated.map((c) => (
              <div key={c.itemId} className="border rounded-lg p-2">
                <div className="text-sm font-semibold">{c.itemName}</div>
                <div className="text-xs text-gray-600 mb-1">Longueur: {fmt2s(c.length)}</div>
                <img src={c.dataUrl} alt={`QR ${c.itemName}`} className="w-40 h-40 object-contain" />
                <a
                  href={c.dataUrl}
                  download={`${c.itemName}.png`}
                  className="inline-block mt-2 text-xs underline"
                >
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
    </div>
  );
}