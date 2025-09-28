"use client"

import { useState, useEffect } from "react"
import mondaySdk from "monday-sdk-js"
import {
  ROLLS_BOARD_ID,
  COL_SUPPLIER_ROLL,
  COL_CAT_ROLL,
  COL_REF_TEXT_ROLL,
  COL_WIDTH_ROLL,
  COL_LENGTH_ROLL,
  COL_LENGTH_REMAINING,
  COL_UNIT_ROLL,
  COL_VENDOR_LOT_ROLL,
  COL_DATE_IN_ROLL,
  COL_LOC_ROLL,
  COL_QUALITY_ROLL,
  COL_STATUS_ROLL,
  COL_REORDER_THRESHOLD,
  COL_TO_REORDER,
} from "../config/mondayIds"

const monday = mondaySdk()

function InventoryDashboard({ onClose }) {
  const [rolls, setRolls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [filters, setFilters] = useState({
    supplier: "",
    category: "",
    quality: "",
    status: "",
    location: "",
    lowStock: false,
    reorderNeeded: false,
  })
  const [sortBy, setSortBy] = useState("date_in")
  const [sortOrder, setSortOrder] = useState("desc")
  const [searchQuery, setSearchQuery] = useState("")

  // Stats
  const [stats, setStats] = useState({
    totalRolls: 0,
    totalLength: 0,
    remainingLength: 0,
    lowStockCount: 0,
    reorderCount: 0,
    byCategory: {},
    bySupplier: {},
    byStatus: {},
  })

  useEffect(() => {
    loadInventory()
  }, [])

  useEffect(() => {
    calculateStats()
  }, [rolls])

  const loadInventory = async () => {
    try {
      setLoading(true)
      setError("")

      const query = `
        query ($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 500) {
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
      `

      const result = await monday.api(query, {
        variables: { boardId: String(ROLLS_BOARD_ID) },
      })

      const items = result?.data?.boards?.[0]?.items_page?.items || []

      const processedRolls = items.map((item) => {
        const columnMap = Object.fromEntries(
          item.column_values.map((cv) => [cv.id, { text: cv.text, value: cv.value }]),
        )

        const lengthRemaining = Number.parseFloat(
          columnMap[COL_LENGTH_REMAINING]?.text || columnMap[COL_LENGTH_ROLL]?.text || 0,
        )
        const lengthInitial = Number.parseFloat(columnMap[COL_LENGTH_ROLL]?.text || 0)
        const reorderThreshold = Number.parseFloat(columnMap[COL_REORDER_THRESHOLD]?.text || 5) // Default 5 ML

        return {
          id: item.id,
          name: item.name,
          supplier: columnMap[COL_SUPPLIER_ROLL]?.text || "",
          category: columnMap[COL_CAT_ROLL]?.text || "",
          ref_sonefi: columnMap[COL_REF_TEXT_ROLL]?.text || "",
          width_mm: Number.parseFloat(columnMap[COL_WIDTH_ROLL]?.text || 0),
          length_initial: lengthInitial,
          length_remaining: lengthRemaining,
          unit: columnMap[COL_UNIT_ROLL]?.text || "ML",
          vendor_lot: columnMap[COL_VENDOR_LOT_ROLL]?.text || "",
          date_in: columnMap[COL_DATE_IN_ROLL]?.text || "",
          location: columnMap[COL_LOC_ROLL]?.text || "",
          quality: columnMap[COL_QUALITY_ROLL]?.text || "OK",
          status: columnMap[COL_STATUS_ROLL]?.text || "En stock",
          reorder_threshold: reorderThreshold,
          to_reorder: columnMap[COL_TO_REORDER]?.text || "Non",
          usage_percentage:
            lengthInitial > 0 ? Math.round(((lengthInitial - lengthRemaining) / lengthInitial) * 100) : 0,
          is_low_stock: lengthRemaining <= reorderThreshold,
          needs_reorder:
            columnMap[COL_TO_REORDER]?.text?.toLowerCase() === "oui" || lengthRemaining <= reorderThreshold,
        }
      })

      setRolls(processedRolls)
    } catch (e) {
      setError("Erreur lors du chargement: " + (e.message || "inconnue"))
    } finally {
      setLoading(false)
    }
  }

  const calculateStats = () => {
    const newStats = {
      totalRolls: rolls.length,
      totalLength: 0,
      remainingLength: 0,
      lowStockCount: 0,
      reorderCount: 0,
      byCategory: {},
      bySupplier: {},
      byStatus: {},
    }

    rolls.forEach((roll) => {
      newStats.totalLength += roll.length_initial
      newStats.remainingLength += roll.length_remaining

      if (roll.is_low_stock) newStats.lowStockCount++
      if (roll.needs_reorder) newStats.reorderCount++

      // By category
      if (roll.category) {
        newStats.byCategory[roll.category] = (newStats.byCategory[roll.category] || 0) + 1
      }

      // By supplier
      if (roll.supplier) {
        newStats.bySupplier[roll.supplier] = (newStats.bySupplier[roll.supplier] || 0) + 1
      }

      // By status
      if (roll.status) {
        newStats.byStatus[roll.status] = (newStats.byStatus[roll.status] || 0) + 1
      }
    })

    setStats(newStats)
  }

  const getFilteredAndSortedRolls = () => {
    const filtered = rolls.filter((roll) => {
      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (
          !(
            roll.ref_sonefi.toLowerCase().includes(query) ||
            roll.supplier.toLowerCase().includes(query) ||
            roll.category.toLowerCase().includes(query) ||
            roll.vendor_lot.toLowerCase().includes(query) ||
            roll.location.toLowerCase().includes(query)
          )
        ) {
          return false
        }
      }

      // Filters
      if (filters.supplier && roll.supplier !== filters.supplier) return false
      if (filters.category && roll.category !== filters.category) return false
      if (filters.quality && roll.quality !== filters.quality) return false
      if (filters.status && roll.status !== filters.status) return false
      if (filters.location && roll.location !== filters.location) return false
      if (filters.lowStock && !roll.is_low_stock) return false
      if (filters.reorderNeeded && !roll.needs_reorder) return false

      return true
    })

    // Sort
    filtered.sort((a, b) => {
      let aVal = a[sortBy]
      let bVal = b[sortBy]

      if (typeof aVal === "string") {
        aVal = aVal.toLowerCase()
        bVal = bVal.toLowerCase()
      }

      if (sortOrder === "asc") {
        return aVal > bVal ? 1 : -1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })

    return filtered
  }

  const getUniqueValues = (field) => {
    return [...new Set(rolls.map((roll) => roll[field]).filter(Boolean))].sort()
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A"
    try {
      return new Date(dateStr).toLocaleDateString("fr-FR")
    } catch {
      return dateStr
    }
  }

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case "en stock":
        return "var(--color-success)"
      case "en cours":
        return "var(--color-warning)"
      case "terminé":
        return "var(--color-grey-dark)"
      case "quarantaine":
        return "var(--color-danger)"
      case "nettoyé":
        return "var(--color-info)"
      default:
        return "var(--color-grey-medium)"
    }
  }

  const exportToCSV = () => {
    const filteredRolls = getFilteredAndSortedRolls()
    const headers = [
      "ID",
      "Référence",
      "Fournisseur",
      "Catégorie",
      "Largeur (mm)",
      "Longueur initiale (ML)",
      "Longueur restante (ML)",
      "Utilisation (%)",
      "Lot fournisseur",
      "Date réception",
      "Emplacement",
      "Qualité",
      "Statut",
    ]

    const csvContent = [
      headers.join(","),
      ...filteredRolls.map((roll) =>
        [
          roll.id,
          roll.ref_sonefi,
          roll.supplier,
          roll.category,
          roll.width_mm,
          roll.length_initial,
          roll.length_remaining,
          roll.usage_percentage,
          roll.vendor_lot,
          roll.date_in,
          roll.location,
          roll.quality,
          roll.status,
        ].join(","),
      ),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    link.href = URL.createObjectURL(blob)
    link.download = `inventaire_rouleaux_${new Date().toISOString().split("T")[0]}.csv`
    link.click()
  }

  const filteredRolls = getFilteredAndSortedRolls()

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal large" onClick={(e) => e.stopPropagation()}>
          <p>Chargement de l'inventaire...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal large" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0 }}>📊 Tableau de bord inventaire</h2>
            <p style={{ margin: "4px 0 0 0", opacity: 0.7 }}>
              {filteredRolls.length} rouleaux affichés sur {rolls.length} total
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ga-btn ghost" onClick={exportToCSV}>
              📥 Exporter CSV
            </button>
            <button className="ga-btn ghost" onClick={onClose}>
              ✕ Fermer
            </button>
          </div>
        </div>

        {error && <div className="ga-error">{error}</div>}

        {/* Stats Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
            marginBottom: 20,
          }}
        >
          <div className="ga-card pastel-blue">
            <div className="ga-icon">📦</div>
            <div>
              <div className="ga-label">{stats.totalRolls}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Rouleaux total</div>
            </div>
          </div>

          <div className="ga-card pastel-green">
            <div className="ga-icon">📏</div>
            <div>
              <div className="ga-label">
                {stats.remainingLength.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} ML
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Stock restant</div>
            </div>
          </div>

          <div className="ga-card pastel-orange">
            <div className="ga-icon">⚠️</div>
            <div>
              <div className="ga-label">{stats.lowStockCount}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Stock faible</div>
            </div>
          </div>

          <div className="ga-card pastel-red">
            <div className="ga-icon">🔄</div>
            <div>
              <div className="ga-label">{stats.reorderCount}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>À réassortir</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="ga-card pastel-grey" style={{ marginBottom: 20, padding: 16 }}>
          <h4 style={{ margin: "0 0 12px 0" }}>Filtres et recherche</h4>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <input
              className="ga-input"
              placeholder="Rechercher..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <select
              className="ga-input"
              value={filters.supplier}
              onChange={(e) => setFilters({ ...filters, supplier: e.target.value })}
            >
              <option value="">Tous les fournisseurs</option>
              {getUniqueValues("supplier").map((supplier) => (
                <option key={supplier} value={supplier}>
                  {supplier}
                </option>
              ))}
            </select>

            <select
              className="ga-input"
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            >
              <option value="">Toutes les catégories</option>
              {getUniqueValues("category").map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>

            <select
              className="ga-input"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Tous les statuts</option>
              {getUniqueValues("status").map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={filters.lowStock}
                onChange={(e) => setFilters({ ...filters, lowStock: e.target.checked })}
              />
              Stock faible uniquement
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={filters.reorderNeeded}
                onChange={(e) => setFilters({ ...filters, reorderNeeded: e.target.checked })}
              />
              À réassortir uniquement
            </label>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 14 }}>Trier par:</span>
              <select
                className="ga-input"
                style={{ width: "auto" }}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="date_in">Date réception</option>
                <option value="ref_sonefi">Référence</option>
                <option value="supplier">Fournisseur</option>
                <option value="length_remaining">Stock restant</option>
                <option value="usage_percentage">Utilisation</option>
              </select>

              <button
                className="ga-btn ghost"
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                style={{ padding: "8px" }}
              >
                {sortOrder === "asc" ? "↑" : "↓"}
              </button>
            </div>
          </div>
        </div>

        {/* Inventory Table */}
        <div style={{ maxHeight: "60vh", overflow: "auto" }}>
          {filteredRolls.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, opacity: 0.7 }}>
              Aucun rouleau ne correspond aux critères de recherche
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {filteredRolls.map((roll) => (
                <div key={roll.id} className="ga-card pastel-grey" style={{ padding: 12 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "200px 150px 100px 120px 100px 1fr auto",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{roll.ref_sonefi}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{roll.supplier}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>CATÉGORIE</div>
                      <div style={{ fontSize: 14 }}>{roll.category}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>LARGEUR</div>
                      <div style={{ fontSize: 14 }}>{roll.width_mm} mm</div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>RESTANT</div>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: roll.is_low_stock ? "var(--color-danger)" : "inherit",
                        }}
                      >
                        {roll.length_remaining.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} ML
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>UTILISÉ</div>
                      <div style={{ fontSize: 14 }}>{roll.usage_percentage}%</div>
                    </div>

                    <div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>STATUT</div>
                      <div
                        style={{
                          fontSize: 12,
                          color: getStatusColor(roll.status),
                          fontWeight: 600,
                        }}
                      >
                        {roll.status}
                      </div>
                      {roll.location && <div style={{ fontSize: 11, opacity: 0.6 }}>📍 {roll.location}</div>}
                    </div>

                    <div style={{ display: "flex", gap: 4 }}>
                      {roll.is_low_stock && (
                        <span
                          style={{
                            background: "var(--color-danger)",
                            color: "white",
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          FAIBLE
                        </span>
                      )}
                      {roll.needs_reorder && (
                        <span
                          style={{
                            background: "var(--color-warning)",
                            color: "white",
                            padding: "2px 6px",
                            borderRadius: 4,
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          RÉASSORT
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div style={{ marginTop: 8 }}>
                    <div
                      style={{
                        height: 4,
                        background: "var(--color-grey-light)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${roll.usage_percentage}%`,
                          background:
                            roll.usage_percentage > 90
                              ? "var(--color-danger)"
                              : roll.usage_percentage > 70
                                ? "var(--color-warning)"
                                : "var(--color-success)",
                          transition: "width 0.3s ease",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default InventoryDashboard
