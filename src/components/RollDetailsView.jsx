"use client"

import { useState, useEffect } from "react"
import mondaySdk from "monday-sdk-js"
import {
  MOVEMENTS_BOARD_ID,
  COL_SUPPLIER_ROLL,
  COL_CAT_ROLL,
  COL_REF_TEXT_ROLL,
  COL_WIDTH_ROLL,
  COL_LENGTH_ROLL,
  COL_LENGTH_REMAINING,
  COL_UNIT_ROLL,
  COL_VENDOR_LOT_ROLL,
  COL_BATCH_ROLL,
  COL_DATE_IN_ROLL,
  COL_LOC_ROLL,
  COL_QUALITY_ROLL,
  COL_STATUS_ROLL,
  COL_QR_ROLL,
  COL_JOURNAL_DATE,
  COL_JOURNAL_ACTION,
  COL_JOURNAL_QTY,
  COL_JOURNAL_UNIT,
  COL_JOURNAL_REF,
  COL_JOURNAL_USER,
  COL_JOURNAL_REASON,
  COL_JOURNAL_ROLL, // Declare the variable here
} from "../config/mondayIds"

const monday = mondaySdk()

function RollDetailsView({ rollId, onClose }) {
  const [rollData, setRollData] = useState(null)
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [activeTab, setActiveTab] = useState("details")

  useEffect(() => {
    if (rollId) {
      loadRollDetails()
    }
  }, [rollId])

  const loadRollDetails = async () => {
    try {
      setLoading(true)
      setError("")

      // Charger les détails du rouleau
      const rollQuery = `
        query ($itemId: [ID!]) {
          items(ids: $itemId) {
            id
            name
            column_values {
              id
              text
              value
            }
          }
        }
      `

      const rollResult = await monday.api(rollQuery, {
        variables: { itemId: [String(rollId)] },
      })

      if (rollResult?.data?.items?.[0]) {
        const item = rollResult.data.items[0]
        const columnMap = Object.fromEntries(
          item.column_values.map((cv) => [cv.id, { text: cv.text, value: cv.value }]),
        )

        const rollDetails = {
          id: item.id,
          name: item.name,
          supplier: columnMap[COL_SUPPLIER_ROLL]?.text || "",
          category: columnMap[COL_CAT_ROLL]?.text || "",
          ref_sonefi: columnMap[COL_REF_TEXT_ROLL]?.text || "",
          width_mm: Number.parseFloat(columnMap[COL_WIDTH_ROLL]?.text || 0),
          length_ml: Number.parseFloat(columnMap[COL_LENGTH_ROLL]?.text || 0),
          length_remaining: Number.parseFloat(
            columnMap[COL_LENGTH_REMAINING]?.text || columnMap[COL_LENGTH_ROLL]?.text || 0,
          ),
          unit: columnMap[COL_UNIT_ROLL]?.text || "ML",
          vendor_lot: columnMap[COL_VENDOR_LOT_ROLL]?.text || "",
          batch: columnMap[COL_BATCH_ROLL]?.text || "",
          date_in: columnMap[COL_DATE_IN_ROLL]?.text || "",
          location: columnMap[COL_LOC_ROLL]?.text || "",
          quality: columnMap[COL_QUALITY_ROLL]?.text || "OK",
          status: columnMap[COL_STATUS_ROLL]?.text || "En stock",
          qr_files: columnMap[COL_QR_ROLL]?.value ? JSON.parse(columnMap[COL_QR_ROLL].value) : null,
        }

        setRollData(rollDetails)
      }

      // Charger l'historique des mouvements
      await loadMovements()
    } catch (e) {
      setError("Erreur lors du chargement: " + (e.message || "inconnue"))
    } finally {
      setLoading(false)
    }
  }

  const loadMovements = async () => {
    try {
      // Rechercher les mouvements liés à ce rouleau
      const movementsQuery = `
        query ($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 100) {
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

      const movementsResult = await monday.api(movementsQuery, {
        variables: { boardId: String(MOVEMENTS_BOARD_ID) },
      })

      const allMovements = movementsResult?.data?.boards?.[0]?.items_page?.items || []

      // Filtrer les mouvements pour ce rouleau
      const rollMovements = allMovements
        .map((item) => {
          const columnMap = Object.fromEntries(
            item.column_values.map((cv) => [cv.id, { text: cv.text, value: cv.value }]),
          )

          // Vérifier si ce mouvement concerne notre rouleau
          const rollConnection = columnMap[COL_JOURNAL_ROLL]?.value
          let isRelated = false

          if (rollConnection) {
            try {
              const parsed = JSON.parse(rollConnection)
              isRelated = parsed.linkedPulseIds?.some(
                (link) => Number.parseInt(link.linkedPulseId) === Number.parseInt(rollId),
              )
            } catch (e) {
              // Ignore parsing errors
            }
          }

          if (!isRelated) return null

          return {
            id: item.id,
            name: item.name,
            date: columnMap[COL_JOURNAL_DATE]?.text || "",
            action: columnMap[COL_JOURNAL_ACTION]?.text || "",
            quantity: Number.parseFloat(columnMap[COL_JOURNAL_QTY]?.text || 0),
            unit: columnMap[COL_JOURNAL_UNIT]?.text || "",
            reference: columnMap[COL_JOURNAL_REF]?.text || "",
            user: columnMap[COL_JOURNAL_USER]?.text || "",
            reason: columnMap[COL_JOURNAL_REASON]?.text || "",
          }
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.date) - new Date(a.date))

      setMovements(rollMovements)
    } catch (e) {
      console.warn("Erreur chargement mouvements:", e)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return "Non défini"
    try {
      return new Date(dateStr).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    } catch {
      return dateStr
    }
  }

  const formatDateTime = (dateStr) => {
    if (!dateStr) return "Non défini"
    try {
      return new Date(dateStr).toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return dateStr
    }
  }

  const calculateUsagePercentage = () => {
    if (!rollData || !rollData.length_ml) return 0
    const used = rollData.length_ml - rollData.length_remaining
    return Math.round((used / rollData.length_ml) * 100)
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

  const getQualityColor = (quality) => {
    switch (quality?.toLowerCase()) {
      case "ok":
        return "var(--color-success)"
      case "quarantaine":
        return "var(--color-warning)"
      case "rejet":
        return "var(--color-danger)"
      default:
        return "var(--color-grey-medium)"
    }
  }

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <p>Chargement des détails du rouleau...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="ga-error">{error}</div>
          <div className="ga-modal-buttons">
            <button className="ga-btn" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!rollData) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <p>Rouleau non trouvé</p>
          <div className="ga-modal-buttons">
            <button className="ga-btn" onClick={onClose}>
              Fermer
            </button>
          </div>
        </div>
      </div>
    )
  }

  const usagePercentage = calculateUsagePercentage()

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal large" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, color: "var(--color-primary)" }}>Fiche de vie - {rollData.ref_sonefi}</h2>
            <p style={{ margin: "4px 0 0 0", opacity: 0.7 }}>
              ID: {rollData.id} • {rollData.supplier}
            </p>
          </div>
          <button className="ga-btn ghost" onClick={onClose}>
            ✕ Fermer
          </button>
        </div>

        {/* Status Bar */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 20,
            padding: 16,
            background: "var(--color-grey-light)",
            borderRadius: "var(--border-radius)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>STATUT</div>
            <div
              style={{
                color: getStatusColor(rollData.status),
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {rollData.status}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>QUALITÉ</div>
            <div
              style={{
                color: getQualityColor(rollData.quality),
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              {rollData.quality}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>UTILISATION</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{usagePercentage}% utilisé</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>RESTANT</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>
              {rollData.length_remaining.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} ML
            </div>
          </div>
        </div>

        {/* Usage Progress Bar */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              height: 8,
              background: "var(--color-grey-light)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${usagePercentage}%`,
                background:
                  usagePercentage > 90
                    ? "var(--color-danger)"
                    : usagePercentage > 70
                      ? "var(--color-warning)"
                      : "var(--color-success)",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 12,
              opacity: 0.7,
              marginTop: 4,
            }}
          >
            <span>0 ML</span>
            <span>{rollData.length_ml.toLocaleString("fr-FR")} ML</span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid var(--color-grey-medium)" }}>
          {[
            { key: "details", label: "Détails", icon: "📋" },
            { key: "history", label: "Historique", icon: "📊", badge: movements.length },
            { key: "qr", label: "QR Code", icon: "📱" },
          ].map((tab) => (
            <button
              key={tab.key}
              className={`ga-btn ${activeTab === tab.key ? "" : "ghost"}`}
              onClick={() => setActiveTab(tab.key)}
              style={{
                borderRadius: "8px 8px 0 0",
                position: "relative",
              }}
            >
              {tab.icon} {tab.label}
              {tab.badge && (
                <span className="ga-badge" style={{ marginLeft: 8 }}>
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ minHeight: 300 }}>
          {activeTab === "details" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div>
                <h4>Identification</h4>
                <div className="details-grid">
                  <div>
                    <strong>Référence SONEFI:</strong> {rollData.ref_sonefi}
                  </div>
                  <div>
                    <strong>Catégorie:</strong> {rollData.category}
                  </div>
                  <div>
                    <strong>Fournisseur:</strong> {rollData.supplier}
                  </div>
                  <div>
                    <strong>Lot fournisseur:</strong> {rollData.vendor_lot}
                  </div>
                  <div>
                    <strong>Batch interne:</strong> {rollData.batch}
                  </div>
                </div>

                <h4 style={{ marginTop: 24 }}>Caractéristiques</h4>
                <div className="details-grid">
                  <div>
                    <strong>Longueur initiale:</strong> {rollData.length_ml.toLocaleString("fr-FR")} ML
                  </div>
                  <div>
                    <strong>Longueur restante:</strong> {rollData.length_remaining.toLocaleString("fr-FR")} ML
                  </div>
                  <div>
                    <strong>Largeur:</strong> {rollData.width_mm} mm
                  </div>
                  <div>
                    <strong>Unité:</strong> {rollData.unit}
                  </div>
                </div>
              </div>

              <div>
                <h4>Traçabilité</h4>
                <div className="details-grid">
                  <div>
                    <strong>Date réception:</strong> {formatDate(rollData.date_in)}
                  </div>
                  <div>
                    <strong>Qualité:</strong>
                    <span style={{ color: getQualityColor(rollData.quality), marginLeft: 8 }}>{rollData.quality}</span>
                  </div>
                  <div>
                    <strong>Statut:</strong>
                    <span style={{ color: getStatusColor(rollData.status), marginLeft: 8 }}>{rollData.status}</span>
                  </div>
                  <div>
                    <strong>Emplacement:</strong> {rollData.location || "Non défini"}
                  </div>
                </div>

                <h4 style={{ marginTop: 24 }}>Statistiques</h4>
                <div className="details-grid">
                  <div>
                    <strong>Consommé:</strong>{" "}
                    {(rollData.length_ml - rollData.length_remaining).toLocaleString("fr-FR")} ML
                  </div>
                  <div>
                    <strong>Taux d'utilisation:</strong> {usagePercentage}%
                  </div>
                  <div>
                    <strong>Mouvements:</strong> {movements.length}
                  </div>
                  <div>
                    <strong>Dernière activité:</strong> {movements[0] ? formatDate(movements[0].date) : "Aucune"}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "history" && (
            <div>
              <h4>Historique des mouvements ({movements.length})</h4>
              {movements.length === 0 ? (
                <p style={{ textAlign: "center", opacity: 0.7, padding: 40 }}>
                  Aucun mouvement enregistré pour ce rouleau
                </p>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {movements.map((movement) => (
                    <div key={movement.id} className="ga-card pastel-grey">
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "120px 100px 1fr 100px",
                          gap: 12,
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>DATE</div>
                          <div style={{ fontWeight: 600 }}>{formatDate(movement.date)}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>ACTION</div>
                          <div style={{ fontWeight: 600 }}>{movement.action}</div>
                        </div>
                        <div>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>DÉTAILS</div>
                          <div>{movement.reason || movement.reference || "N/A"}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: 12, opacity: 0.7 }}>QUANTITÉ</div>
                          <div style={{ fontWeight: 600 }}>
                            {movement.quantity > 0 ? `${movement.quantity} ${movement.unit}` : "N/A"}
                          </div>
                        </div>
                      </div>
                      {movement.user && (
                        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Opérateur: {movement.user}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "qr" && (
            <div style={{ textAlign: "center" }}>
              <h4>QR Code du rouleau</h4>
              {rollData.qr_files && rollData.qr_files.files && rollData.qr_files.files.length > 0 ? (
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <img
                      src={rollData.qr_files.files[0].url || "/placeholder.svg"}
                      alt="QR Code du rouleau"
                      style={{
                        maxWidth: 200,
                        height: "auto",
                        border: "1px solid var(--color-grey-medium)",
                        borderRadius: "var(--border-radius)",
                      }}
                    />
                  </div>
                  <p style={{ fontSize: 14, opacity: 0.7 }}>
                    Scannez ce QR code pour accéder rapidement aux informations et actions du rouleau
                  </p>
                  <a
                    href={rollData.qr_files.files[0].url}
                    download={`QR_${rollData.ref_sonefi}_${rollData.id}.png`}
                    className="ga-btn"
                  >
                    📥 Télécharger QR Code
                  </a>
                </div>
              ) : (
                <div>
                  <p style={{ opacity: 0.7, marginBottom: 20 }}>Aucun QR code généré pour ce rouleau</p>
                  <button className="ga-btn" onClick={() => alert("Fonctionnalité à implémenter")}>
                    Générer QR Code
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RollDetailsView
