"use client"

// src/App.jsx
import { useMemo, useState } from "react"
import "./App.css"
import mondaySdk from "monday-sdk-js"
import ReceptionModal from "./components/ReceptionModal.jsx"
import QRScanner from "./components/QRScanner.jsx"
import RollLifecycleActions from "./components/RollLifecycleActions.jsx"
import InventoryDashboard from "./components/InventoryDashboard.jsx"

// IDs centralisés (mets tes vrais IDs dans src/config/mondayIds.js)
import { ENTRY_BOARD_ID, COL_UNIT_ENTRY, COL_WIDTH_ENTRY, COL_QTY_RCVD_CUM, COL_ROLLS_COUNT } from "./config/mondayIds"

// === Colonnes locales EXISTANTES sur le board Entrées (garde-les ici si tu ne les as pas centralisées)
const COL_SUPPLIER = "texte9" // FOURNISSEUR (Text)
const COL_PRODUCT = "texte2" // Description produit (peut contenir HTML)
const COL_QTY = "quantit__produit" // Quantité commandée (Numbers)

const monday = mondaySdk()

// ---------- Helpers ----------
function stripHtml(html) {
  if (!html) return ""
  const div = document.createElement("div")
  div.innerHTML = html
  return (div.textContent || div.innerText || "").replace(/\s+/g, " ").trim()
}
function formatQty(q) {
  const n = Number.parseFloat(String(q).replace(/\s/g, "").replace(",", "."))
  if (Number.isNaN(n)) return q || "—"
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

export default function App() {
  // UI
  const [showStockModal, setShowStockModal] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Données
  const [items, setItems] = useState([]) // {id,name,supplier,product,qtyDisplay, qtyRaw, unit, widthMm, qtyReceivedCum, nbRolls}
  const [suppliers, setSuppliers] = useState([]) // ["FOURNISSEUR..."]
  const [supplierCounts, setSupplierCounts] = useState({}) // { Fournisseur: nb }
  const [selectedSupplier, setSelectedSupplier] = useState("")
  const [supplierQuery, setSupplierQuery] = useState("")

  // Modale réception
  const [selectedEntry, setSelectedEntry] = useState(null)

  // QR Scanner and Roll Actions
  const [showQRScanner, setShowQRScanner] = useState(false)
  const [scannedRoll, setScannedRoll] = useState(null)

  const [showInventoryDashboard, setShowInventoryDashboard] = useState(false)

  // Boutons
  const actions = [
    { key: "decoupe", label: "Lancer une découpe", color: "pastel-green", icon: "✂️" },
    { key: "nettoyage", label: "Lancer un nettoyage", color: "pastel-blue", icon: "🧽" },
    { key: "assemblage", label: "Lancer un assemblage", color: "pastel-purple", icon: "🛠️" },
    { key: "confection", label: "Lancer une confection", color: "pastel-orange", icon: "🧵" },
    { key: "stock_in", label: "Mettre en stock (réception)", color: "pastel-yellow", icon: "📦" },
    { key: "inventory", label: "Tableau de bord inventaire", color: "pastel-grey", icon: "📊" },
  ]

  function handleClick(a) {
    if (a.key === "stock_in") openStockModal()
    else if (a.key === "decoupe" || a.key === "nettoyage" || a.key === "assemblage" || a.key === "confection") {
      setShowQRScanner(true)
    } else if (a.key === "inventory") {
      setShowInventoryDashboard(true)
    } else alert(`🛠️ Bientôt : ${a.label}`)
  }

  const handleRollScanned = (rollData) => {
    setScannedRoll(rollData)
  }

  const handleActionComplete = () => {
    // Refresh roll data if needed
    console.log("Action completed, refreshing data...")
  }

  // ---------- Chargement via boards -> items_page ----------
  async function openStockModal() {
    setShowStockModal(true)
    setSelectedSupplier("")
    setSupplierQuery("")
    setLoading(true)
    setError("")

    console.log("[v0] Fetching board columns for debugging...")

    const debugQuery = `
      query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          columns {
            id
            title
            type
          }
        }
      }
    `

    try {
      const debugRes = await monday.api(debugQuery, {
        variables: { boardId: String(ENTRY_BOARD_ID) },
      })

      console.log("[v0] Available columns in board:", debugRes?.data?.boards?.[0]?.columns)

      const columns = debugRes?.data?.boards?.[0]?.columns || []
      const supplierCol = columns.find(
        (col) => col.title.toLowerCase().includes("fournisseur") || col.title.toLowerCase().includes("supplier"),
      )
      const productCol = columns.find(
        (col) =>
          col.title.toLowerCase().includes("produit") ||
          col.title.toLowerCase().includes("description") ||
          col.title.toLowerCase().includes("product"),
      )
      const qtyCol = columns.find(
        (col) =>
          col.title.toLowerCase().includes("quantité") ||
          col.title.toLowerCase().includes("quantity") ||
          col.title.toLowerCase().includes("qté"),
      )

      console.log("[v0] Found columns:", { supplierCol, productCol, qtyCol })

      // Use found column IDs or fallback to hardcoded ones
      const actualSupplierCol = supplierCol?.id || COL_SUPPLIER
      const actualProductCol = productCol?.id || COL_PRODUCT
      const actualQtyCol = qtyCol?.id || COL_QTY

      console.log("[v0] Using column IDs:", { actualSupplierCol, actualProductCol, actualQtyCol })

      const q = `
      query ($boardId: ID!, $limit: Int!, $cols: [String!]) {
        boards(ids: [$boardId]) {
          items_page(limit: $limit) {
            items {
              id
              name
              column_values(ids: $cols) { id text }
            }
            cursor
          }
        }
      }
    `

      const res = await monday.api(q, {
        variables: {
          boardId: String(ENTRY_BOARD_ID),
          limit: 200,
          cols: [
            actualSupplierCol,
            actualProductCol,
            actualQtyCol,
            COL_UNIT_ENTRY,
            COL_WIDTH_ENTRY,
            COL_QTY_RCVD_CUM,
            COL_ROLLS_COUNT,
          ],
        },
      })

      console.log("[v0] API Response:", res)

      if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join(" | "))

      const raw = res?.data?.boards?.[0]?.items_page?.items ?? []
      console.log("[v0] Raw items:", raw)

      // Normalisation + formats
      const normalized = raw.map((it) => {
        const map = Object.fromEntries((it.column_values || []).map((cv) => [cv.id, cv.text]))
        console.log("[v0] Item column values:", it.id, map)

        const qtyRaw = map[actualQtyCol] || ""
        return {
          id: it.id,
          name: it.name,
          supplier: (map[actualSupplierCol] || "").trim(),
          product: stripHtml(map[actualProductCol] || it.name),
          qtyDisplay: formatQty(qtyRaw || ""),
          qtyRaw: qtyRaw,
          unit: (map[COL_UNIT_ENTRY] || "").trim(), // ex. "ML" / "UNITE"
          widthMm: (map[COL_WIDTH_ENTRY] || "").trim(), // number string
          qtyReceivedCum: (map[COL_QTY_RCVD_CUM] || "0").trim(), // number string
          nbRolls: (map[COL_ROLLS_COUNT] || "0").trim(), // number string
        }
      })

      console.log("[v0] Normalized items:", normalized)
      setItems(normalized)

      const uniq = [...new Set(normalized.map((x) => x.supplier).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "fr", { sensitivity: "base" }),
      )
      setSuppliers(uniq)
      console.log("[v0] Found suppliers:", uniq)

      const counts = normalized.reduce((acc, it) => {
        if (it.supplier) acc[it.supplier] = (acc[it.supplier] || 0) + 1
        return acc
      }, {})
      setSupplierCounts(counts)

      if (!uniq.length) setError("Aucun fournisseur trouvé dans 'ENTRÉES DE STOCK'.")
    } catch (e) {
      console.error("[v0] Error fetching suppliers:", e)
      setError("Erreur GraphQL (items_page) : " + (e?.message || "inconnue"))
    } finally {
      setLoading(false)
    }
  }

  // Lignes du fournisseur sélectionné
  const supplierLines = useMemo(
    () => (selectedSupplier ? items.filter((it) => it.supplier === selectedSupplier) : []),
    [items, selectedSupplier],
  )

  return (
    <div className="ga-wrapper">
      {/* TOPBAR */}
      <div className="ga-topbar">
        <h1 className="ga-title">⚙️ Gestion atelier</h1>
        <button className="ga-btn ghost" onClick={() => alert("Config à venir")}>
          Configurer
        </button>
      </div>

      {/* GRILLE D'ACTIONS */}
      <div className="ga-grid">
        {actions.map((a) => (
          <button key={a.key} className={`ga-card ${a.color}`} onClick={() => handleClick(a)}>
            <div className="ga-icon">{a.icon}</div>
            <div className="ga-label">{a.label}</div>
          </button>
        ))}
      </div>

      {error && <p className="ga-error">{error}</p>}

      {/* MODALE STOCK — Sélection fournisseur & lignes */}
      {showStockModal && (
        <div className="modal-overlay" onClick={() => setShowStockModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {!selectedSupplier ? (
              <>
                <h2 style={{ marginTop: 0 }}>📦 Sélectionne un fournisseur</h2>
                {loading && <p>Chargement…</p>}

                {!loading && suppliers.length === 0 && <p>Aucun fournisseur trouvé dans “ENTRÉES DE STOCK”.</p>}

                {!loading && suppliers.length > 0 && (
                  <>
                    <input
                      className="ga-input"
                      placeholder="Rechercher un fournisseur…"
                      value={supplierQuery}
                      onChange={(e) => setSupplierQuery(e.target.value)}
                      style={{ marginBottom: 12 }}
                    />
                    <div style={{ display: "grid", gap: 10 }}>
                      {suppliers
                        .filter((s) => s.toLowerCase().includes(supplierQuery.toLowerCase()))
                        .map((s) => (
                          <button
                            key={s}
                            className="ga-card pastel-grey"
                            onClick={() => setSelectedSupplier(s)}
                            title={`Voir les lignes pour ${s}`}
                            style={{ justifyContent: "space-between" }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                              <div className="ga-icon">🏷️</div>
                              <div className="ga-label">{s}</div>
                            </div>
                            <span className="ga-badge">{supplierCounts[s] || 0}</span>
                          </button>
                        ))}
                    </div>
                  </>
                )}

                <div className="ga-modal-buttons" style={{ marginTop: 12 }}>
                  <button className="ga-btn ghost" onClick={() => setShowStockModal(false)}>
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 style={{ marginTop: 0 }}>🧾 Lignes — {selectedSupplier}</h2>

                {supplierLines.length === 0 ? (
                  <p>Aucune ligne pour ce fournisseur.</p>
                ) : (
                  <div style={{ maxHeight: 380, overflow: "auto", display: "grid", gap: 10 }}>
                    {supplierLines.map((ln) => (
                      <div
                        key={ln.id}
                        className="ga-card pastel-grey"
                        style={{ cursor: "pointer" }}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          console.log("open réception pour", ln.id)
                          setSelectedEntry({
                            id: ln.id,
                            name: ln.name,
                            supplier: ln.supplier,
                            product: ln.product,
                            qtyCommanded: Number.parseFloat(String(ln.qtyRaw || "0").replace(",", ".")) || 0,
                            unit: ln.unit || "ML",
                            widthMm: ln.widthMm ? Number.parseFloat(String(ln.widthMm).replace(",", ".")) : undefined,
                            qtyReceivedCum: ln.qtyReceivedCum
                              ? Number.parseFloat(String(ln.qtyReceivedCum).replace(",", "."))
                              : 0,
                            nbRolls: ln.nbRolls ? Number.parseInt(ln.nbRolls, 10) : 0,
                          })
                        }}
                      >
                        <div className="ga-icon">📦</div>
                        <div style={{ display: "grid" }}>
                          <div className="ga-label">{ln.product || "(Sans description)"}</div>
                          <div style={{ fontSize: 14, opacity: 0.85 }}>
                            Qté commandée : {ln.qtyDisplay} &nbsp;•&nbsp; Item #{ln.id}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ga-modal-buttons" style={{ marginTop: 12 }}>
                  <button className="ga-btn ghost" onClick={() => setSelectedSupplier("")}>
                    ⬅︎ Retour fournisseurs
                  </button>
                  <button className="ga-btn ghost" onClick={() => setShowStockModal(false)}>
                    Fermer
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* MODALE RÉCEPTION (au-dessus de la précédente grâce à .modal-top dans App.css) */}
      {selectedEntry && (
        <ReceptionModal
          open={!!selectedEntry}
          entryItem={selectedEntry}
          onClose={(refresh) => {
            setSelectedEntry(null)
            if (refresh) openStockModal() // recharge la liste après validation
          }}
        />
      )}

      {/* MODALE QR SCANNER & ACTIONS ROULEAU */}
      {showQRScanner && (
        <div className="modal-overlay" onClick={() => setShowQRScanner(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ margin: 0 }}>Scanner QR & Actions Rouleau</h2>
              <button className="ga-btn ghost" onClick={() => setShowQRScanner(false)}>
                ✕ Fermer
              </button>
            </div>

            <div style={{ display: "grid", gap: 20 }}>
              <QRScanner onRollScanned={handleRollScanned} />
              <RollLifecycleActions rollData={scannedRoll} onActionComplete={handleActionComplete} />
            </div>
          </div>
        </div>
      )}

      {showInventoryDashboard && <InventoryDashboard onClose={() => setShowInventoryDashboard(false)} />}
    </div>
  )
}
