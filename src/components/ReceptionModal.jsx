import React, { useEffect, useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

import {
  ENTRY_BOARD_ID, ROLLS_BOARD_ID, ROLLS_GROUP_ID, CATALOG_BOARD_ID,
  COL_UNIT_ENTRY, COL_WIDTH_ENTRY, COL_QTY_RCVD_CUM, COL_ROLLS_COUNT, COL_ROLLS_LINK, COL_LOCK_RECEIPT,
  COL_CAT_CATALOG, COL_REF_TEXT_CAT, COL_ACTIVE_CAT, COL_UNIT_DEFAULT, COL_WIDTH_DEFAULT,
  COL_LINK_PARENT_ROLL, COL_SUPPLIER_ROLL, COL_CAT_ROLL, COL_REF_LINK_ROLL, COL_REF_TEXT_ROLL,
  COL_WIDTH_ROLL, COL_LENGTH_ROLL, COL_UNIT_ROLL, COL_VENDOR_LOT_ROLL, COL_BATCH_ROLL, COL_DATE_IN_ROLL,
  COL_LOC_ROLL, COL_QUALITY_ROLL, COL_QR_ROLL, COL_LAST_RECEIPT,
  COL_JOURNAL_DATE, COL_JOURNAL_BL, COL_JOURNAL_LOT, COL_JOURNAL_QTY, COL_JOURNAL_UNIT, COL_JOURNAL_NBROLL, COL_JOURNAL_USER
} from "../config/mondayIds";

function stripHtml(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim();
}
function formatQty(q) {
  const n = parseFloat(String(q).replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n)) return q || "—";
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
const RECEIPT_TOLERANCE = 0.005; // 0,5 %

function ReceptionModal({
  open, onClose,
  entryItem, // { id, name, supplier, product, qtyCommanded, unit, widthMm, qtyReceivedCum }
}) {
  const [dateIn, setDateIn] = useState(new Date().toISOString().slice(0,10));
  const [bl, setBl] = useState("");
  const [vendorLot, setVendorLot] = useState("");
  const [category, setCategory] = useState("");
  const [refOptions, setRefOptions] = useState([]); // [{id, name, refText, unitDefault, widthDefault}]
  const [refSelected, setRefSelected] = useState(null);
  const [unit, setUnit] = useState(entryItem?.unit || "ML"); // recopie unité de la ligne
  const [widthMm, setWidthMm] = useState(entryItem?.widthMm || "");
  const [supplierTxt, setSupplierTxt] = useState(entryItem?.supplier || "");
  const [loc, setLoc] = useState("");
  const [qualityDefault, setQualityDefault] = useState("OK");

// --- états existants (dateIn, bl, vendorLot global éventuel, category, refOptions, refSelected, unit, widthMm, supplierTxt, loc, qualityDefault, etc.) ---

// 1) Choix du mode (produits vs rouleaux)
const [mode, setMode] = useState(entryItem?.unit === "ML" ? "rolls" : "pieces");
const isML = mode === "rolls";

// 2) Liste des rouleaux (UNIQUE déclaration)
const [rolls, setRolls] = useState([
  { length: "", widthMm: entryItem?.widthMm || "", vendorLot: "", quality: "OK", loc: "", notes: "" },
]);

// 3) Pièces (pour le mode produits)
const [piecesQty, setPiecesQty] = useState(0);

// 4) Loading / Erreur
const [loading, setLoading] = useState(false);
const [err, setErr] = useState("");

// 5) Calculs dérivés
const qtyLeft = Math.max(
    0,
    (parseFloat(entryItem?.qtyCommanded) || 0) - (parseFloat(entryItem?.qtyReceivedCum) || 0)
   );
const sumRolls = useMemo(
  () => rolls.reduce((s, r) => s + (parseFloat(r.length) || 0), 0),
  [rolls]
);

// 6) Helpers pour la table des rouleaux
function updateRoll(idx, patch) {
  setRolls(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
}
function addRoll() {
  setRolls(prev => [
    ...prev,
    { length: "", widthMm: entryItem?.widthMm || "", vendorLot: "", quality: "OK", loc: "", notes: "" },
  ]);
}
function removeRoll(idx) {
  setRolls(prev => prev.filter((_, i) => i !== idx));
}

  // 2.1 Charger refs du catalogue selon catégorie
  useEffect(() => {
    if (!open) return;
    if (!category) { setRefOptions([]); setRefSelected(null); return; }
    (async () => {
      try {
        const q = `
          query ($boardId: ID!, $limit: Int!) {
            boards(ids: [$boardId]) {
              items_page(limit: $limit) {
                items {
                  id
                  name
                  column_values {
                    id
                    text
                  }
                }
              }
            }
          }
        `;
        const res = await monday.api(q, { variables: { boardId: String(CATALOG_BOARD_ID), limit: 500 }});
        const raw = res?.data?.boards?.[0]?.items_page?.items ?? [];
        const rows = raw.map(it => {
          const map = Object.fromEntries((it.column_values||[]).map(cv => [cv.id, cv.text]));
          return {
            id: it.id,
            name: it.name,
            cat: (map[COL_CAT_CATALOG]||"").trim(),
            refText: (map[COL_REF_TEXT_CAT]||"").trim(),
            active: (map[COL_ACTIVE_CAT]||"").toLowerCase().includes("oui") || (map[COL_ACTIVE_CAT]||"").toLowerCase().includes("actif"),
            unitDefault: (map[COL_UNIT_DEFAULT]||"").trim(),
            widthDefault: parseFloat((map[COL_WIDTH_DEFAULT]||"").replace(",", "."))
          };
        }).filter(r => r.active && r.cat === category);
        setRefOptions(rows);
        setRefSelected(null);
      } catch (e) {
        setErr("Erreur chargement catalogue : " + (e?.message||"inconnue"));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

  // 2.2 Auto-préremplir unité/laize depuis la ref choisie (sans bloquer la saisie)
  useEffect(() => {
    if (refSelected) {
      if (refSelected.unitDefault && !entryItem?.unit) setUnit(refSelected.unitDefault);
      if (refSelected.widthDefault && !entryItem?.widthMm) setWidthMm(refSelected.widthDefault);
    }
  }, [refSelected, entryItem]);

  async function handleValidate() {
  try {
    setErr("");

    // validations communes
    if (!dateIn) throw new Error("Date obligatoire.");
    if (!bl) throw new Error("N° BL obligatoire.");
    if (!category) throw new Error("Catégorie obligatoire.");
    if (!refSelected) throw new Error("Réf SONEFI obligatoire (choisis dans la liste).");

    // qtyLeft = quantité restante autorisée sur la ligne (tu l'as déjà calculée)
    // RECEIPT_TOLERANCE doit être défini en haut du fichier (ex: 0.005)

    if (mode === "rolls") {
      // --- Mode ROULEAUX (ML) ---
      if (rolls.length === 0) throw new Error("Ajoute au moins un rouleau.");
      if (!widthMm) throw new Error("Laize obligatoire.");

      const sum = rolls.reduce((s, r) => s + (parseFloat(r.length) || 0), 0);
      const maxAllowed = qtyLeft * (1 + RECEIPT_TOLERANCE);
      if (sum > maxAllowed) {
        throw new Error(`Somme des longueurs (${sum}) > reste autorisé (${qtyLeft} ± tolérance).`);
      }
      const emptyLots = rolls
    .map((r, i) => ({ i, lot: (r.vendorLot || "").trim() }))
    .filter(x => !x.lot);

  if (emptyLots.length) {
    throw new Error(
      `Lot fournisseur requis pour chaque rouleau (manquant: ${emptyLots.map(x => `#${x.i + 1}`).join(", ")})`
    );
  }
    } else {
      // --- Mode PRODUITS (unités) ---
      if (!piecesQty || piecesQty <= 0) throw new Error("Quantité (pièces) > 0 requise.");
      const maxAllowed = qtyLeft * (1 + RECEIPT_TOLERANCE);
      if (piecesQty > maxAllowed) {
        throw new Error(`Qté pièces > reste autorisé (${qtyLeft} ± tolérance).`);
      }
    }

    setLoading(true);

    // 1) Verrouiller la ligne d’achat
    await changeCols(entryItem.id, {
      [COL_LOCK_RECEIPT]: { label: "Oui" },
    });

    let createdRollIds = [];
    let qtyReceived = 0;

    if (mode === "rolls") {
      // 2) Créer chaque rouleau dans le board Stock Rouleaux
      for (let i = 0; i < rolls.length; i++) {
        const r = rolls[i];
        const len = parseFloat(r.length) || 0;
        if (len <= 0) continue;

         const newRollId = await createItemInGroup(
            ROLLS_BOARD_ID,
             ROLLS_GROUP_ID,
           `${refSelected?.name || "Rouleau"} — ${len} ML`
         );

        // ⚠️ Lot fournisseur par ROULEAU
        await changeCols(newRollId, {
          [COL_LINK_PARENT_ROLL]: { item_ids: [entryItem.id] },
          [COL_SUPPLIER_ROLL]: entryItem.supplier || "",
          [COL_CAT_ROLL]: category || "",
          [COL_REF_TEXT_ROLL]: refSelected?.name || "",
          [COL_LENGTH_ROLL]: len,
          [COL_WIDTH_ROLL]: parseFloat(r.widthMm || widthMm) || null,
          [COL_UNIT_ROLL]: "ML",
          [COL_VENDOR_LOT_ROLL]: (r.vendorLot || "").trim(), // <<< ici le lot par rouleau
          [COL_DATE_IN_ROLL]: dateIn,
          [COL_LOC_ROLL]: (r.loc || loc || "").trim(),
          [COL_QUALITY_ROLL]: r.quality || qualityDefault || "OK",
          // ... autres colonnes si besoin (QR, notes, liens vers Catalogue, etc.)
        });

        createdRollIds.push(newRollId);
        qtyReceived += len;
      }
    } else {
      // Mode PRODUITS : pas d'items rouleaux; on incrémente juste le cumul
      qtyReceived = parseFloat(piecesQty) || 0;
    }

    // 3) Mettre à jour le cumul reçu sur la ligne d’achat
    const prevCum = parseFloat(String(entryItem.qtyReceivedCum || "0").replace(",", ".")) || 0;
    const newCum = prevCum + qtyReceived;

    await changeCols(entryItem.id, {
      [COL_QTY_RCVD_CUM]: newCum,
      [COL_ROLLS_COUNT]: mode === "rolls" ? (parseInt(entryItem.nbRolls || 0, 10) + createdRollIds.length) : (entryItem.nbRolls || 0),
      [COL_LAST_RECEIPT]: dateIn,
    });

    // 4) Journal (si tu as des subitems)
    // await appendJournalLine({ date: dateIn, bl, lot: mode==="rolls" ? "Voir rouleaux" : (vendorLot || ""), qty: qtyReceived, unit: mode==="rolls" ? "ML" : "UNITE", nbRolls: createdRollIds.length });

    // 5) Déverrouiller (ou pas, selon ton process), fermer la modale et rafraîchir
    await changeCols(entryItem.id, { [COL_LOCK_RECEIPT]: { label: "Non" } });
    onClose(true);
  } catch (e) {
    setErr(e?.message || "Erreur inconnue");
  } finally {
    setLoading(false);
  }
}

  function makeBatch(parentId, seq) {
    const d = new Date(dateIn);
    const YY = String(d.getFullYear()).slice(2);
    const MM = String(d.getMonth()+1).padStart(2,"0");
    const DD = String(d.getDate()).padStart(2,"0");
    return `SNE-${YY}${MM}${DD}-${parentId}-${String(seq).padStart(2,"0")}`;
  }

  // === Mutations utilitaires ===
  async function createItemInGroup(boardId, groupId, name) {
    const m = `
      mutation ($boardId: ID!, $groupId: String!, $name: String!) {
        create_item (board_id: $boardId, group_id: $groupId, item_name: $name) { id }
      }
    `;
    const r = await monday.api(m, { variables: { boardId: String(boardId), groupId, name }});
    return r?.data?.create_item?.id;
  }
  async function changeCols(itemId, colValsObj) {
    const m = `
      mutation ($itemId: ID!, $boardId: ID, $colVals: JSON!) {
        change_multiple_column_values (item_id: $itemId, board_id: $boardId, column_values: $colVals) { id }
      }
    `;
    const colVals = JSON.stringify(colValsObj);
    await monday.api(m, { variables: { itemId: String(itemId), boardId: String(ROLLS_BOARD_ID), colVals }})
      .catch(async () => {
        // si c’était pour la ligne d’achat, on retente avec board Entrées
        await monday.api(m, { variables: { itemId: String(itemId), boardId: String(ENTRY_BOARD_ID), colVals }});
      });
  }
  async function appendLinks(parentId, connectColId, childIds, childBoardId) {
    // Récupérer existants puis concaténer
    const q = `
      query ($itemId: [ID!], $boardId: ID!) {
        items (ids: $itemId) {
          id
          column_values (ids: ["${connectColId}"]) { id value }
        }
      }
    `;
    const res = await monday.api(q, { variables: { itemId: [String(parentId)], boardId: String(ENTRY_BOARD_ID) }});
    const val = res?.data?.items?.[0]?.column_values?.[0]?.value;
    let current = [];
    if (val) {
      try { current = JSON.parse(val)?.linkedPulseIds?.map(x => parseInt(x.linkedPulseId,10))||[]; } catch {}
    }
    const merged = Array.from(new Set([...current, ...childIds]));
    const payload = { [connectColId]: { item_ids: merged, board_id: parseInt(childBoardId,10) } };
    await changeCols(parentId, payload);
  }
  async function createSubitem(parentId, name) {
    const m = `
      mutation ($parentId: ID!, $itemName: String!) {
        create_subitem (parent_item_id: $parentId, item_name: $itemName) { id }
      }
    `;
    const r = await monday.api(m, { variables: { parentId: String(parentId), itemName: name }});
    return r?.data?.create_subitem?.id;
  }

  // UI
  if (!open) return null;

  const resteAff = (qtyLeft ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

  return (
    <div className="modal-overlay modal-top" onClick={() => onClose(false)}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <h2>Réception — Item #{entryItem?.id}</h2>
        <div style={{fontSize:14,opacity:.8,marginBottom:8}}>
          <div><b>Produit :</b> {entryItem?.product}</div>
          <div><b>Fournisseur :</b> {supplierTxt}</div>
          <div><b>Unité :</b> {unit} · <b>Commandé :</b> {formatQty(entryItem?.qtyCommanded)} · <b>Reçu :</b> {formatQty(entryItem?.qtyReceivedCum||0)} · <b>Reste :</b> {resteAff}</div>
          {isML && <div><b>Laize (mm) :</b> <input className="ga-input" style={{width:120}} value={widthMm} onChange={e=>setWidthMm(e.target.value)} /></div>}
        </div>

        {/* --- Toggle type de réception --- */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
          <span style={{ fontWeight: 600 }}>Type de réception :</span>
          <button
            type="button"
            className={`ga-btn ${isML ? "" : "ghost"}`}
            onClick={() => setMode("rolls")}
          >
            Rouleaux (ML)
          </button>
          <button
            type="button"
            className={`ga-btn ${!isML ? "" : "ghost"}`}
            onClick={() => setMode("pieces")}
          >
            Produits (unités)
          </button>
        </div>

        <div className="grid" style={{display:"grid",gap:8}}>
          <div>
            <label>📅 Date réception</label>
            <input type="date" className="ga-input" value={dateIn} onChange={e=>setDateIn(e.target.value)} />
          </div>
          <div>
            <label>📄 N° BL</label>
            <input className="ga-input" value={bl} onChange={e=>setBl(e.target.value)} />
          </div>
          <div>
            <label>🏷️ Lot fournisseur {isML ? "(obligatoire sinon Quarantaine)" : ""}</label>
            <input className="ga-input" value={vendorLot} onChange={e=>setVendorLot(e.target.value)} />
          </div>

          <div>
            <label>📚 Catégorie</label>
            <select className="ga-input" value={category} onChange={e=>setCategory(e.target.value)}>
              <option value="">— Choisir —</option>
              <option>Feutre synthétique</option>
              <option>Feutre laine</option>
              <option>Aiguilleté filtration</option>
              <option>Maille polyamide</option>
              <option>Accessoires</option>
              <option>Emballages</option>
            </select>
          </div>

          <div>
            <label>🧾 Réf SONEFI</label>
            <select className="ga-input" value={refSelected?.id||""} onChange={e=>{
              const found = refOptions.find(o=>o.id===e.target.value);
              setRefSelected(found||null);
            }}>
              <option value="">— Sélectionner ({refOptions.length}) —</option>
              {refOptions.map(o=>(
                <option key={o.id} value={o.id}>{o.refText || o.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label>🏬 Emplacement (option)</label>
            <input className="ga-input" value={loc} onChange={e=>setLoc(e.target.value)} placeholder="Mezza / Rack A-3…" />
          </div>
        </div>

       {/* Section ROULEAUX (mode ML) */}
        {isML && (
          <>
            <div className="ga-divider" />

            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button className="ga-btn" onClick={addRoll}>+ Ajouter un rouleau</button>
              <div style={{marginLeft:"auto"}}>
                <b>Total saisi :</b>{" "}
                {rolls.reduce((s,r)=> s + (parseFloat(r.length)||0), 0).toLocaleString("fr-FR")} ML
              </div>
            </div>

            <div style={{maxHeight:260,overflow:"auto",marginTop:8,display:"grid",gap:8}}>
              {rolls.map((r, idx)=>(
                <div key={idx} className="ga-card pastel-grey" style={{display:"grid",gridTemplateColumns:"140px 140px 1fr 120px auto",gap:8,alignItems:"center"}}>
                  <div>
                    <label>Longueur (ML)</label>
                    <input className="ga-input" value={r.length} onChange={e=>updateRoll(idx,{length:e.target.value})} />
                  </div>
                  <div>
                    <label>Laize (mm)</label>
                    <input className="ga-input" value={r.widthMm} onChange={e=>updateRoll(idx,{widthMm:e.target.value})} />
                  </div>
                  <div>
                    <label>Lot fournisseur</label>
                    <input className="ga-input" value={r.vendorLot} onChange={e=>updateRoll(idx,{vendorLot:e.target.value})} placeholder="ex. 24-09-B123" />
                  </div>
                  <div>
                    <label>Qualité</label>
                    <select className="ga-input" value={r.quality} onChange={e=>updateRoll(idx,{quality:e.target.value})}>
                      <option>OK</option>
                      <option>Quarantaine</option>
                      <option>Rejet</option>
                    </select>
                  </div>
                  <button className="ga-btn ghost" onClick={()=>removeRoll(idx)}>Supprimer</button>
                  <div style={{gridColumn:"1 / -1"}}>
                    <label>Observations</label>
                    <input className="ga-input" value={r.notes} onChange={e=>updateRoll(idx,{notes:e.target.value})} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {err && <p className="ga-error" style={{marginTop:8}}>{err}</p>}

        <div className="ga-modal-buttons" style={{marginTop:12}}>
          <button className="ga-btn ghost" onClick={()=>onClose(false)}>Annuler</button>
          <button className="ga-btn" disabled={loading} onClick={handleValidate}>
            {loading ? "Traitement…" : "Valider la réception"}
          </button>
        </div>
      </div>
    </div>
  );
}
export default ReceptionModal;
