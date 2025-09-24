import React, { useEffect, useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

// src/config/mondayIds.js
export const ENTRY_BOARD_ID = "7678082330";
export const ROLLS_BOARD_ID = "xxxxxxxxxx";
export const ROLLS_GROUP_ID = "stock";
// … toutes les COL_* ici …

import {
  ENTRY_BOARD_ID, ROLLS_BOARD_ID, ROLLS_GROUP_ID, CATALOG_BOARD_ID,COL_* // importe celles que tu utilises
} from "../config/mondayIds";


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

  // ML : liste de rouleaux (longueur + laize + qualité + obs)
  const [rolls, setRolls] = useState([]);
  const [piecesQty, setPiecesQty] = useState(0); // pour UNITE

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const qtyLeft = Math.max(0, (entryItem?.qtyCommanded || 0) - (entryItem?.qtyReceivedCum || 0));
  const sumRolls = useMemo(() => rolls.reduce((s, r) => s + (parseFloat(r.length)||0), 0), [rolls]);

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

  function addRollRow() {
    setRolls(prev => [...prev, { length: 0, widthMm: widthMm || 0, quality: qualityDefault, notes: "" }]);
  }
  function setRollField(i, field, val) {
    setRolls(prev => prev.map((r, idx) => idx===i ? { ...r, [field]: val } : r));
  }
  function removeRollRow(i) {
    setRolls(prev => prev.filter((_, idx) => idx!==i));
  }
  function autoDistribute(total, n) {
    const t = parseFloat(total); const count = parseInt(n,10);
    if (!t || !count || count<=0) return;
    const base = Math.floor((t/count)*1000)/1000;
    const arr = Array.from({length: count}, (_,i) => ({ length: base, widthMm: widthMm||0, quality: qualityDefault, notes:"" }));
    // Ajuster le dernier avec l'arrondi
    arr[count-1].length = Math.round((t - base*(count-1))*1000)/1000;
    setRolls(arr);
  }

  async function handleValidate() {
    try {
      setErr("");
      // validations
      if (!dateIn) throw new Error("Date obligatoire.");
      if (!bl) throw new Error("N° BL obligatoire.");
      if (!category) throw new Error("Catégorie obligatoire.");
      if (!refSelected) throw new Error("Réf SONEFI obligatoire (choisis dans la liste).");

      if (unit === "ML") {
        if (!vendorLot || vendorLot.trim()==="") {
          // autorisé mais en quarantaine
        }
        if (rolls.length===0) throw new Error("Ajoute au moins un rouleau.");
        if (!widthMm) throw new Error("Laize obligatoire.");
        const sum = sumRolls;
        const maxAllowed = qtyLeft*(1+RECEIPT_TOLERANCE);
        if (sum > maxAllowed) {
          throw new Error(`Somme des longueurs (${sum}) > reste autorisé (${qtyLeft} ± tolérance).`);
        }
      } else if (unit === "UNITE") {
        if (!piecesQty || piecesQty<=0) throw new Error("Quantité (pièces) > 0 requise.");
        const maxAllowed = qtyLeft*(1+RECEIPT_TOLERANCE);
        if (piecesQty > maxAllowed) throw new Error(`Qté > reste autorisé (${qtyLeft} ± tolérance).`);
      }

      setLoading(true);

      // 1) Verrouiller la ligne d’achat
      await changeCols(entryItem.id, {
        [COL_LOCK_RECEIPT]: { label: "Oui" }
      });

      let createdRollIds = [];
      let qtyReceived = 0;

      if (unit === "ML") {
        // 2) Créer chaque rouleau dans board Stock Rouleaux
        for (let i=0;i<rolls.length;i++){
          const r = rolls[i];
          const rollName = `Rouleau — ${stripHtml(entryItem.product).slice(0,50)} — ${r.length} ML`;
          const newItemId = await createItemInGroup(ROLLS_BOARD_ID, ROLLS_GROUP_ID, rollName);

          // batch interne
          const batch = makeBatch(entryItem.id, i+1);

          // qualité : si lot vide => quarantaine forcée
          const qual = (vendorLot && vendorLot.trim()!=="") ? (r.quality||"OK") : "Quarantaine";

          await changeCols(newItemId, {
            [COL_LINK_PARENT_ROLL]: { item_ids: [parseInt(entryItem.id,10)], board_id: parseInt(ENTRY_BOARD_ID,10) },
            [COL_SUPPLIER_ROLL]: supplierTxt || "",
            [COL_CAT_ROLL]: { label: category },
            [COL_REF_LINK_ROLL]: { item_ids: [parseInt(refSelected.id,10)], board_id: parseInt(CATALOG_BOARD_ID,10) },
            [COL_REF_TEXT_ROLL]: refSelected.refText || refSelected.name || "",
            [COL_WIDTH_ROLL]: r.widthMm || widthMm || "",
            [COL_LENGTH_ROLL]: r.length || "",
            [COL_UNIT_ROLL]: unit,
            [COL_VENDOR_LOT_ROLL]: vendorLot || "",
            [COL_BATCH_ROLL]: batch,
            [COL_DATE_IN_ROLL]: dateIn,
            [COL_LOC_ROLL]: loc || "",
            [COL_QUALITY_ROLL]: { label: qual },
          });

          // QR: générer PNG & uploader (placeholder, à brancher ensuite)
          // const qrBlob = await generateQrPngBlob(makeItemUrl(newItemId));
          // await uploadFileToColumn(newItemId, COL_QR_ROLL, qrBlob, `QR-${newItemId}.png`);

          createdRollIds.push(newItemId);
          qtyReceived += (parseFloat(r.length)||0);
        }
      } else if (unit === "UNITE") {
        qtyReceived = piecesQty;
      }

      // 3) Mettre à jour la ligne d’achat (cumul, date, nb rouleaux, liens…)
      const newCum = (entryItem.qtyReceivedCum||0) + qtyReceived;
      const nbRollsAdd = (unit === "ML") ? createdRollIds.length : 0;

      const parentUpdates = {
        [COL_QTY_RCVD_CUM]: newCum.toString().replace(".", ","),
        [COL_LAST_RECEIPT]: dateIn,
      };
      if (nbRollsAdd>0) parentUpdates[COL_ROLLS_COUNT] = ((entryItem.nbRolls||0)+nbRollsAdd).toString();

      await changeCols(entryItem.id, parentUpdates);

      // 3.b Lier rouleaux créés dans la colonne Connect (si ML)
      if (createdRollIds.length>0) {
        await appendLinks(entryItem.id, COL_ROLLS_LINK, createdRollIds.map(id => parseInt(id,10)), ROLLS_BOARD_ID);
      }

      // 4) Journal (subitem)
      const journalName = `Réception du ${dateIn}`;
      const journalId = await createSubitem(entryItem.id, journalName);
      await changeCols(journalId, {
        [COL_JOURNAL_DATE]: dateIn,
        [COL_JOURNAL_BL]: bl,
        [COL_JOURNAL_LOT]: vendorLot || "",
        [COL_JOURNAL_QTY]: (unit==="ML" ? qtyReceived : piecesQty).toString().replace(".", ","),
        [COL_JOURNAL_UNIT]: unit,
        [COL_JOURNAL_NBROLL]: (unit==="ML" ? createdRollIds.length : 0).toString(),
        [COL_JOURNAL_USER]: "App", // tu peux remplacer par le nom renvoyé par monday.get("context")
      });

      // 5) Déverrouiller
      await changeCols(entryItem.id, { [COL_LOCK_RECEIPT]: { label: "Non" } });

      alert("Réception enregistrée ✅");
      onClose(true); // refresh parent
    } catch (e) {
      setErr(e?.message || "Erreur inconnue");
      // déverrouiller si verrou posé
      try { await changeCols(entryItem.id, { [COL_LOCK_RECEIPT]: { label: "Non" } }); } catch {}
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

  const isML = unit === "ML";
  const resteAff = (qtyLeft ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

  return (
    <div className="modal-overlay" onClick={() => onClose(false)}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <h2>Réception — Item #{entryItem?.id}</h2>
        <div style={{fontSize:14,opacity:.8,marginBottom:8}}>
          <div><b>Produit :</b> {entryItem?.product}</div>
          <div><b>Fournisseur :</b> {supplierTxt}</div>
          <div><b>Unité :</b> {unit} · <b>Commandé :</b> {formatQty(entryItem?.qtyCommanded)} · <b>Reçu :</b> {formatQty(entryItem?.qtyReceivedCum||0)} · <b>Reste :</b> {resteAff}</div>
          {isML && <div><b>Laize (mm) :</b> <input className="ga-input" style={{width:120}} value={widthMm} onChange={e=>setWidthMm(e.target.value)} /></div>}
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

        {isML ? (
          <>
            <div className="ga-divider" />
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <button className="ga-btn" onClick={addRollRow}>+ Ajouter rouleau</button>
              <span>ou</span>
              <button className="ga-btn ghost" onClick={()=>{
                const totalStr = prompt("Total à répartir (ML) ?", String(qtyLeft||""));
                const nStr = prompt("Nombre de rouleaux ?", "1");
                autoDistribute(totalStr, nStr);
              }}>Répartir automatiquement</button>
              <div style={{marginLeft:"auto"}}><b>Total saisi :</b> {sumRolls.toLocaleString("fr-FR")} ML</div>
            </div>

            <div style={{maxHeight:220,overflow:"auto",marginTop:8,display:"grid",gap:6}}>
              {rolls.map((r, i)=>(
                <div key={i} className="ga-card pastel-grey" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:8,alignItems:"center"}}>
                  <div>
                    <label>Longueur (ML)</label>
                    <input className="ga-input" value={r.length} onChange={e=>setRollField(i,"length",e.target.value)} />
                  </div>
                  <div>
                    <label>Laize (mm)</label>
                    <input className="ga-input" value={r.widthMm} onChange={e=>setRollField(i,"widthMm",e.target.value)} />
                  </div>
                  <div>
                    <label>Qualité</label>
                    <select className="ga-input" value={r.quality} onChange={e=>setRollField(i,"quality",e.target.value)}>
                      <option>OK</option>
                      <option>Quarantaine</option>
                      <option>Rejet</option>
                    </select>
                  </div>
                  <button className="ga-btn ghost" onClick={()=>removeRollRow(i)}>Supprimer</button>
                  <div style={{gridColumn:"1 / -1"}}>
                    <label>Observations</label>
                    <input className="ga-input" value={r.notes} onChange={e=>setRollField(i,"notes",e.target.value)} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="ga-divider" />
            <div>
              <label>Quantité (pièces) à réceptionner</label>
              <input className="ga-input" type="number" value={piecesQty} onChange={e=>setPiecesQty(parseInt(e.target.value||"0",10))} />
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
