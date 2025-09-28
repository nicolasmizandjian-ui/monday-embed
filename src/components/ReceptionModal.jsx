"use client"

import { useEffect, useMemo, useState } from "react"
import mondaySdk from "monday-sdk-js"

const monday = mondaySdk()

import {
  ENTRY_BOARD_ID,
  ROLLS_BOARD_ID,
  ROLLS_GROUP_ID,
  COL_QTY_RCVD_CUM,
  COL_ROLLS_COUNT,
  COL_LOCK_RECEIPT,
  COL_LINK_PARENT_ROLL,
  COL_SUPPLIER_ROLL,
  COL_CAT_ROLL,
  COL_REF_TEXT_ROLL,
  COL_WIDTH_ROLL,
  COL_LENGTH_ROLL,
  COL_UNIT_ROLL,
  COL_VENDOR_LOT_ROLL,
  COL_DATE_IN_ROLL,
  COL_LOC_ROLL,
  COL_QUALITY_ROLL,
  COL_QR_ROLL,
  COL_LAST_RECEIPT,
  COL_BATCH_ROLL,
} from "../config/mondayIds"

import { generateRollQRPayload, createAndAttachQR, generateBatch, validateQRPayload } from "../utils/qrGenerator"

function stripHtml(html) {
  if (!html) return ""
  const div = document.createElement("div")
  div.innerHTML = html
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim()
}
function formatQty(q) {
  const n = Number.parseFloat(String(q).replace(/\s/g, "").replace(",", "."))
  if (Number.isNaN(n)) return q || "—"
  return new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}
const RECEIPT_TOLERANCE = 0.005 // 0,5 %

function ReceptionModal({
  open,
  onClose,
  entryItem, // { id, name, supplier, product, qtyCommanded, unit, widthMm, qtyReceivedCum }
}) {
  const [dateIn, setDateIn] = useState(new Date().toISOString().slice(0, 10))
  const [bl, setBl] = useState("")
  const [vendorLot, setVendorLot] = useState("")
  const [category, setCategory] = useState("")
  // états catalogue
  const [catalog, setCatalog] = useState([])
  const [categoryOptions, setCategoryOptions] = useState([])
  const [refOptions, setRefOptions] = useState([])

  // fournisseur visible/éditable
  const [supplier, setSupplier] = useState(entryItem?.supplier || "")
  const [supplierOptions, setSupplierOptions] = useState([])

  useEffect(() => {
    let alive = true
    fetch("/catalog_with_suppliers.json")
      .then((r) => r.json())
      .then((rowsRaw) => {
        if (!alive) return

        // Helpers de nettoyage
        const safe = (v) => (v == null ? "" : String(v).trim())
        const isJunkCat = (s) => {
          const x = safe(s).toLowerCase()
          if (!x) return true
          if (x === "nan" || x === "categorie" || x === "catégorie" || x === "nombre de possibilites") return true
          if (/^\d+$/.test(x)) return true // 109, 123…
          return false
        }
        const pretty = (s) => {
          // FEUTRE_LAINE -> Feutre laine
          const t = safe(s).replace(/[_]+/g, " ").toLowerCase()
          return t.replace(/\b\p{L}/gu, (m) => m.toUpperCase())
        }

        // 1) Normaliser les lignes utiles
        const rows = rowsRaw
          .map((r) => ({
            // Mapping des clés du JSON (MAJUSCULES) vers les noms internes (minuscules)
            categorie: safe(r.CATEGORIE),
            ref_sonefi: safe(r.REFERENCE_SONEFI),
            ref_sellsy: safe(r.REFERENCE_SELLSY),
            supplier_default: safe(r.FOURNISSEUR),
            // Ces champs n’existent pas (ou pas toujours) dans ton JSON : on garde des valeurs par défaut
            unite_def: safe(r.UNITE_DEF || ""),
            laize_mm: r.LAIZE_MM ?? "",
            actif: safe(r.ACTIF || ""),
          }))
          .filter((r) => r.ref_sonefi && r.ref_sonefi !== "-" && r.categorie && !isJunkCat(r.categorie))

        setCatalog(rows)

        // 2) Catégories uniques "propres"
        const cats = Array.from(
          new Set(rows.filter((r) => !r.actif || r.actif.toLowerCase().includes("oui")).map((r) => r.categorie)),
        )
          .filter((c) => !isJunkCat(c))
          .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }))

        // On prépare des étiquettes jolies pour l’affichage
        setCategoryOptions(cats.map((c) => pretty(c)))

        // 3) Suggestions fournisseurs depuis le tableau
        const sup = Array.from(new Set(rows.map((r) => r.supplier_default).filter(Boolean))).sort((a, b) =>
          a.localeCompare(b, "fr", { sensitivity: "base" }),
        )
        setSupplierOptions((prev) => Array.from(new Set([...(prev || []), ...sup])))
      })
      .catch(console.error)
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!category) {
      setRefOptions([])
      return
    }

    // Normaliser pour comparer proprement (sans accents, casse, ponctuation)
    const norm = (s) =>
      String(s || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "") // accents
        .replace(/[_\W]+/g, " ") // underscores & ponctuation -> espace
        .trim()
        .toLowerCase()

    const sel = norm(category)

    // On retrouve la "vraie" catégorie correspondante dans le catalogue
    const rows = catalog
      .filter((r) => norm(r.categorie) === sel)
      .filter((r) => !r.actif || r.actif.toLowerCase().includes("oui"))

    setRefOptions(rows)
  }, [category, catalog])

  const [refSelected, setRefSelected] = useState(null)
  const [unit, setUnit] = useState(entryItem?.unit || "ML") // recopie unité de la ligne
  const [widthMm, setWidthMm] = useState(entryItem?.widthMm || "")
  const [supplierTxt, setSupplierTxt] = useState(entryItem?.supplier || "")
  const [loc, setLoc] = useState("")
  const [qualityDefault, setQualityDefault] = useState("OK")

  // --- états existants (dateIn, bl, vendorLot global éventuel, category, refOptions, refSelected, unit, widthMm, supplierTxt, loc, qualityDefault, etc.) ---

  // 1) Choix du mode (produits vs rouleaux)
  const [mode, setMode] = useState(entryItem?.unit === "ML" ? "rolls" : "pieces")
  const isML = mode === "rolls"

  // 2) Liste des rouleaux (UNIQUE déclaration)
  const [rolls, setRolls] = useState([
    { length: "", widthMm: entryItem?.widthMm || "", vendorLot: "", quality: "OK", loc: "", notes: "" },
  ])

  // 3) Pièces (pour le mode produits)
  const [piecesQty, setPiecesQty] = useState(0)

  // 4) Loading / Erreur
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState("")

  // 5) Calculs dérivés
  const qtyLeft = Math.max(
    0,
    (Number.parseFloat(entryItem?.qtyCommanded) || 0) - (Number.parseFloat(entryItem?.qtyReceivedCum) || 0),
  )
  const sumRolls = useMemo(() => rolls.reduce((s, r) => s + (Number.parseFloat(r.length) || 0), 0), [rolls])

  function onPickRef(refRow) {
    setRefSelected(refRow)
    if (refRow?.unite_def) setUnit(refRow.unite_def) // "ML", "UNITE", ...
    if (refRow?.laize_mm != null) setWidthMm(refRow.laize_mm) // nombre (mm)
  }

  // 6) Helpers pour la table des rouleaux
  function updateRoll(idx, patch) {
    setRolls((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  function addRoll() {
    setRolls((prev) => [
      ...prev,
      { length: "", widthMm: entryItem?.widthMm || "", vendorLot: "", quality: "OK", loc: "", notes: "" },
    ])
  }
  function removeRoll(idx) {
    setRolls((prev) => prev.filter((_, i) => i !== idx))
  }

  // 2.2 Auto-préremplir unité/laize depuis la ref choisie (sans bloquer la saisie)
  useEffect(() => {
    if (refSelected) {
      if (refSelected.unite_def && !entryItem?.unit) setUnit(refSelected.unite_def)
      if (refSelected.laize_mm != null && !entryItem?.widthMm) setWidthMm(refSelected.laize_mm)
    }
  }, [refSelected, entryItem])

  async function handleValidate() {
    try {
      setErr("")

      // validations communes
      if (!dateIn) throw new Error("Date de réception obligatoire.")
      if (!bl) throw new Error("N° BL obligatoire.")
      if (!supplierTxt.trim()) throw new Error("Fournisseur obligatoire.")
      if (!category) throw new Error("Catégorie obligatoire.")
      if (!refSelected) throw new Error("Référence SONEFI obligatoire (choisir dans la liste).")

      if (mode === "rolls") {
        // --- Mode ROULEAUX (ML) ---
        if (rolls.length === 0) throw new Error("Ajoute au moins un rouleau.")
        if (!widthMm) throw new Error("Laize obligatoire.")

        const sum = rolls.reduce((s, r) => s + (Number.parseFloat(r.length) || 0), 0)
        const maxAllowed = qtyLeft * (1 + RECEIPT_TOLERANCE)
        if (sum > maxAllowed) {
          throw new Error(`Somme des longueurs (${sum}) > reste autorisé (${qtyLeft} ± tolérance).`)
        }
        const emptyLots = rolls.map((r, i) => ({ i, lot: (r.vendorLot || "").trim() })).filter((x) => !x.lot)

        if (emptyLots.length) {
          throw new Error(
            `Lot fournisseur requis pour chaque rouleau (manquant: ${emptyLots.map((x) => `#${x.i + 1}`).join(", ")})`,
          )
        }
      } else {
        // --- Mode PRODUITS (unités) ---
        if (!piecesQty || piecesQty <= 0) throw new Error("Quantité (pièces) > 0 requise.")
        const maxAllowed = qtyLeft * (1 + RECEIPT_TOLERANCE)
        if (piecesQty > maxAllowed) {
          throw new Error(`Qté pièces > reste autorisé (${qtyLeft} ± tolérance).`)
        }
      }

      setLoading(true)

      // 1) Verrouiller la ligne d’achat
      await changeCols(entryItem.id, {
        [COL_LOCK_RECEIPT]: { label: "Oui" },
      })

      const createdRollIds = []
      let qtyReceived = 0

      if (mode === "rolls") {
        // 2) Créer chaque rouleau dans le board Stock Rouleaux
        for (let i = 0; i < rolls.length; i++) {
          const r = rolls[i]
          const len = Number.parseFloat(r.length) || 0
          if (len <= 0) continue

          const newRollId = await createItemInGroup(
            ROLLS_BOARD_ID,
            ROLLS_GROUP_ID,
            `${refSelected?.ref_sonefi || "Rouleau"} — ${len} ML`,
          )

          const batch = generateBatch(entryItem.id, i + 1, dateIn)

          // ⚠️ Lot fournisseur par ROULEAU
          await changeCols(newRollId, {
            [COL_LINK_PARENT_ROLL]: { item_ids: [entryItem.id] },
            [COL_SUPPLIER_ROLL]: (supplierTxt || entryItem.supplier || "").trim(),
            [COL_CAT_ROLL]: refSelected?.categorie || category || "",
            [COL_REF_TEXT_ROLL]: refSelected?.ref_sonefi || "",
            [COL_LENGTH_ROLL]: len,
            [COL_WIDTH_ROLL]: Number.parseFloat(r.widthMm || widthMm) || null,
            [COL_UNIT_ROLL]: "ML",
            [COL_VENDOR_LOT_ROLL]: (r.vendorLot || "").trim(), // <<< ici le lot par rouleau
            [COL_BATCH_ROLL]: batch, // Add generated batch
            [COL_DATE_IN_ROLL]: dateIn,
            [COL_LOC_ROLL]: (r.loc || loc || "").trim(),
            [COL_QUALITY_ROLL]: r.quality || qualityDefault || "OK",
            // ... autres colonnes si besoin (QR, notes, liens vers Catalogue, etc.)
          })

          try {
            const rollData = {
              roll_item_id: newRollId,
              parent_entry_id: entryItem.id,
              dateIn,
              bl,
              supplier: (supplierTxt || entryItem.supplier || "").trim(),
              category: refSelected?.categorie || category || "",
              ref_sonefi: refSelected?.ref_sonefi || "",
              ref_sellsy: refSelected?.ref_sellsy || "",
              unit: "ML",
              width_mm: Number.parseFloat(r.widthMm || widthMm) || null,
              length_ml: len,
              vendor_lot: (r.vendorLot || "").trim(),
              batch: batch,
              quality: r.quality || qualityDefault || "OK",
              status: "En stock",
              loc: (r.loc || loc || "").trim(),
              notes: (r.notes || "").trim(),
            }

            // Validate payload before generating QR
            const validation = validateQRPayload(rollData)
            if (!validation.isValid) {
              console.warn("QR validation warnings:", validation.warnings)
              // Continue with warnings, but log them
            }

            // Generate structured QR payload
            const qrPayload = generateRollQRPayload(rollData)

            // Create and attach QR using enhanced utility
            await createAndAttachQR(monday, newRollId, COL_QR_ROLL, qrPayload)
          } catch (e) {
            console.warn("QR attach failed for roll", newRollId, e)
          }

          createdRollIds.push(newRollId)
          qtyReceived += len
        }
      } else {
        // Mode PRODUITS : pas d'items rouleaux; on incrémente juste le cumul
        qtyReceived = Number.parseFloat(piecesQty) || 0
      }

      // 3) Mettre à jour le cumul reçu sur la ligne d’achat
      const prevCum = Number.parseFloat(String(entryItem.qtyReceivedCum || "0").replace(",", ".")) || 0
      const newCum = prevCum + qtyReceived

      await changeCols(entryItem.id, {
        [COL_QTY_RCVD_CUM]: newCum,
        [COL_ROLLS_COUNT]:
          mode === "rolls"
            ? Number.parseInt(entryItem.nbRolls || 0, 10) + createdRollIds.length
            : entryItem.nbRolls || 0,
        [COL_LAST_RECEIPT]: dateIn,
      })

      // 3.b Archive la ligne d'entrée si commande complète (disparition du board "ENTRÉES DE STOCK")
      try {
        const commanded = Number.parseFloat(entryItem?.qtyCommanded) || 0
        const tolerance = RECEIPT_TOLERANCE ?? 0.005 // 0,5 %
        const complete = commanded > 0 && newCum >= commanded * (1 - tolerance)
        if (complete) {
          await monday.api(`mutation ($id: ID!) { archive_item(item_id: $id) { id } }`, {
            variables: { id: String(entryItem.id) },
          })
        }
      } catch (e) {
        console.warn("Archive entry failed", e)
      }

      // 5) Déverrouiller (ou pas, selon ton process), fermer la modale et rafraîchir
      await changeCols(entryItem.id, { [COL_LOCK_RECEIPT]: { label: "Non" } })
      onClose(true)
    } catch (e) {
      setErr(e?.message || "Erreur inconnue")
    } finally {
      setLoading(false)
    }
  }

  // === Mutations utilitaires ===
  async function createItemInGroup(boardId, groupId, name) {
    const m = `
    mutation ($boardId: ID!, $groupId: String!, $name: String!) {
      create_item (board_id: $boardId, group_id: $groupId, item_name: $name) { id }
    }
  `
    const r = await monday.api(m, { variables: { boardId: String(boardId), groupId, name } })
    return r?.data?.create_item?.id
  }
  async function changeCols(itemId, colValsObj) {
    const m = `
    mutation ($itemId: ID!, $boardId: ID, $colVals: JSON!) {
      change_multiple_column_values (item_id: $itemId, board_id: $boardId, column_values: $colVals) { id }
    }
  `
    const colVals = JSON.stringify(colValsObj)
    await monday
      .api(m, { variables: { itemId: String(itemId), boardId: String(ROLLS_BOARD_ID), colVals } })
      .catch(async () => {
        // si c’était pour la ligne d’achat, on retente avec board Entrées
        await monday.api(m, { variables: { itemId: String(itemId), boardId: String(ENTRY_BOARD_ID), colVals } })
      })
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
  `
    const res = await monday.api(q, { variables: { itemId: [String(parentId)], boardId: String(ENTRY_BOARD_ID) } })
    const val = res?.data?.items?.[0]?.column_values?.[0]?.value
    let current = []
    if (val) {
      try {
        current = JSON.parse(val)?.linkedPulseIds?.map((x) => Number.parseInt(x.linkedPulseId, 10)) || []
      } catch {}
    }
    const merged = Array.from(new Set([...current, ...childIds]))
    const payload = { [connectColId]: { item_ids: merged, board_id: Number.parseInt(childBoardId, 10) } }
    await changeCols(parentId, payload)
  }
  async function createSubitem(parentId, name) {
    const m = `
    mutation ($parentId: ID!, $itemName: String!) {
      create_subitem (parent_item_id: $parentId, item_name: $itemName) { id }
    }
  `
    const r = await monday.api(m, { variables: { parentId: String(parentId), itemName: name } })
    return r?.data?.create_subitem?.id
  }

  // UI
  if (!open) return null

  const resteAff = (qtyLeft ?? 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 })

  return (
    <div className="modal-overlay modal-top" onClick={() => onClose(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Réception — Item #{entryItem?.id}</h2>
        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>
          <div>
            <b>Produit :</b> {entryItem?.product}
          </div>
          <div>
            <b>Fournisseur :</b> {supplierTxt}
          </div>
          <div>
            <b>Unité :</b> {unit} · <b>Commandé :</b> {formatQty(entryItem?.qtyCommanded)} · <b>Reçu :</b>{" "}
            {formatQty(entryItem?.qtyReceivedCum || 0)} · <b>Reste :</b> {resteAff}
          </div>
          {isML && (
            <div>
              <b>Laize (mm) :</b>{" "}
              <input
                className="ga-input"
                style={{ width: 120 }}
                value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)}
              />
            </div>
          )}
        </div>

        {/* --- Toggle type de réception --- */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "8px 0" }}>
          <span style={{ fontWeight: 600 }}>Type de réception :</span>
          <button type="button" className={`ga-btn ${isML ? "" : "ghost"}`} onClick={() => setMode("rolls")}>
            Rouleaux (ML)
          </button>
          <button type="button" className={`ga-btn ${!isML ? "" : "ghost"}`} onClick={() => setMode("pieces")}>
            Produits (unités)
          </button>
        </div>

        <div className="grid" style={{ display: "grid", gap: 8 }}>
          <div>
            <label>📅 Date réception</label>
            <input type="date" className="ga-input" value={dateIn} onChange={(e) => setDateIn(e.target.value)} />
          </div>
          <div>
            <label>📄 N° BL</label>
            <input className="ga-input" value={bl} onChange={(e) => setBl(e.target.value)} />
          </div>

          <div>
            <label>🏭 Fournisseur</label>
            <select className="ga-input" value={supplierTxt} onChange={(e) => setSupplierTxt(e.target.value)}>
              <option value="">— Choisir fournisseur —</option>
              {supplierOptions.map((sup) => (
                <option key={sup} value={sup}>
                  {sup}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>🏷️ Lot fournisseur {isML ? "(obligatoire sinon Quarantaine)" : ""}</label>
            <input className="ga-input" value={vendorLot} onChange={(e) => setVendorLot(e.target.value)} />
          </div>

          <div>
            <label>📚 Catégorie</label>
            <select className="ga-input" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">— Choisir —</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>🧾 Réf SONEFI</label>
            <select
              className="ga-input"
              value={refSelected?.ref_sonefi || ""}
              onChange={(e) => {
                const found = refOptions.find((o) => String(o.ref_sonefi) === e.target.value)
                onPickRef(found || null)
              }}
            >
              <option value="">— Sélectionner ({refOptions.length}) —</option>
              {refOptions.map((o) => (
                <option key={o.ref_sonefi} value={o.ref_sonefi}>
                  {o.ref_sonefi}
                  {o.ref_sellsy ? ` — ${o.ref_sellsy}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label>🏬 Emplacement (option)</label>
            <input
              className="ga-input"
              value={loc}
              onChange={(e) => setLoc(e.target.value)}
              placeholder="Mezza / Rack A-3…"
            />
          </div>
        </div>

        {/* Section ROULEAUX (mode ML) */}
        {isML && (
          <>
            <div className="ga-divider" />

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="ga-btn" onClick={addRoll}>
                + Ajouter un rouleau
              </button>
              <div style={{ marginLeft: "auto" }}>
                <b>Total saisi :</b>{" "}
                {rolls.reduce((s, r) => s + (Number.parseFloat(r.length) || 0), 0).toLocaleString("fr-FR")} ML
              </div>
            </div>

            <div style={{ maxHeight: 260, overflow: "auto", marginTop: 8, display: "grid", gap: 8 }}>
              {rolls.map((r, idx) => (
                <div
                  key={idx}
                  className="ga-card pastel-grey"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "140px 140px 1fr 120px auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <div>
                    <label>Longueur (ML)</label>
                    <input
                      className="ga-input"
                      value={r.length}
                      onChange={(e) => updateRoll(idx, { length: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>Laize (mm)</label>
                    <input
                      className="ga-input"
                      value={r.widthMm}
                      onChange={(e) => updateRoll(idx, { widthMm: e.target.value })}
                    />
                  </div>
                  <div>
                    <label>Lot fournisseur</label>
                    <input
                      className="ga-input"
                      value={r.vendorLot}
                      onChange={(e) => updateRoll(idx, { vendorLot: e.target.value })}
                      placeholder="ex. 24-09-B123"
                    />
                  </div>
                  <div>
                    <label>Qualité</label>
                    <select
                      className="ga-input"
                      value={r.quality}
                      onChange={(e) => updateRoll(idx, { quality: e.target.value })}
                    >
                      <option>OK</option>
                      <option>Quarantaine</option>
                      <option>Rejet</option>
                    </select>
                  </div>
                  <button className="ga-btn ghost" onClick={() => removeRoll(idx)}>
                    Supprimer
                  </button>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label>Observations</label>
                    <input
                      className="ga-input"
                      value={r.notes}
                      onChange={(e) => updateRoll(idx, { notes: e.target.value })}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {err && (
          <p className="ga-error" style={{ marginTop: 8 }}>
            {err}
          </p>
        )}

        <div className="ga-modal-buttons" style={{ marginTop: 12 }}>
          <button className="ga-btn ghost" onClick={() => onClose(false)}>
            Annuler
          </button>
          <button className="ga-btn" disabled={loading} onClick={handleValidate}>
            {loading ? "Traitement…" : "Valider la réception"}
          </button>
        </div>
      </div>
    </div>
  )
}
export default ReceptionModal
