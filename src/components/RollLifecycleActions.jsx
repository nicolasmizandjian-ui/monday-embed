"use client"

import { useState } from "react"
import RollActionModal from "./RollActionModal"

function RollLifecycleActions({ rollData, onActionComplete }) {
  const [selectedAction, setSelectedAction] = useState(null)

  const actions = [
    {
      key: "decoupe",
      label: "Découpe",
      icon: "✂️",
      color: "pastel-green",
      description: "Déclarer une découpe et déduire du stock",
    },
    {
      key: "confection",
      label: "Confection",
      icon: "🧵",
      color: "pastel-orange",
      description: "Consommer matière pour fabrication",
    },
    {
      key: "nettoyage",
      label: "Nettoyage",
      icon: "🧽",
      color: "pastel-blue",
      description: "Traçabilité des opérations de nettoyage",
    },
    {
      key: "ajustement",
      label: "Ajustement",
      icon: "⚖️",
      color: "pastel-red",
      description: "Corriger le stock (inventaire, casse...)",
    },
  ]

  const handleActionClick = (actionKey) => {
    setSelectedAction(actionKey)
  }

  const handleActionClose = (refresh) => {
    setSelectedAction(null)
    if (refresh && onActionComplete) {
      onActionComplete()
    }
  }

  if (!rollData) {
    return (
      <div className="ga-card pastel-grey">
        <p>Scannez un QR code pour accéder aux actions du rouleau</p>
      </div>
    )
  }

  const remainingLength = Number.parseFloat(rollData.length_remaining || rollData.length_ml || 0)
  const isFinished = remainingLength <= 0.5

  return (
    <div>
      <h3>Actions disponibles</h3>

      {isFinished && (
        <div className="ga-error" style={{ marginBottom: 16 }}>
          Ce rouleau est terminé (reste: {remainingLength} ML)
        </div>
      )}

      <div className="roll-actions">
        {actions.map((action) => (
          <button
            key={action.key}
            className={`action-btn ${action.key}`}
            onClick={() => handleActionClick(action.key)}
            disabled={isFinished && action.key !== "ajustement"}
            title={action.description}
          >
            <span className="action-icon">{action.icon}</span>
            <div>
              <div className="action-label">{action.label}</div>
              <div className="action-description">{action.description}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Informations contextuelles */}
      <div className="ga-card pastel-grey" style={{ marginTop: 16 }}>
        <h4>Informations du rouleau</h4>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 14 }}>
          <div>
            <strong>Référence:</strong> {rollData.ref_sonefi}
          </div>
          <div>
            <strong>Fournisseur:</strong> {rollData.supplier}
          </div>
          <div>
            <strong>Longueur restante:</strong> {remainingLength} ML
          </div>
          <div>
            <strong>Largeur:</strong> {rollData.width_mm} mm
          </div>
          <div>
            <strong>Qualité:</strong> {rollData.quality}
          </div>
          <div>
            <strong>Statut:</strong> {rollData.status}
          </div>
          <div>
            <strong>Emplacement:</strong> {rollData.location || "Non défini"}
          </div>
          <div>
            <strong>Lot fournisseur:</strong> {rollData.vendor_lot}
          </div>
        </div>
      </div>

      {/* Modal d'action */}
      {selectedAction && (
        <RollActionModal
          open={!!selectedAction}
          actionType={selectedAction}
          rollData={rollData}
          onClose={handleActionClose}
        />
      )}
    </div>
  )
}

export default RollLifecycleActions
