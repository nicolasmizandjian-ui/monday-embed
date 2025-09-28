"use client"

import { useState, useEffect } from "react"
import { parseQRCode } from "../utils/qrGenerator"
import RollDetailsView from "./RollDetailsView"

function QRDisplay({ qrData, onScan }) {
  const [parsedData, setParsedData] = useState(null)
  const [error, setError] = useState(null)
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (qrData) {
      const result = parseQRCode(qrData)
      if (result.success) {
        setParsedData(result.data)
        setError(null)
        onScan?.(result.data)
      } else {
        setError(result.error)
        setParsedData(null)
      }
    }
  }, [qrData, onScan])

  if (!qrData) {
    return (
      <div className="qr-display">
        <p>Scannez un QR code pour voir les informations du rouleau</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="qr-display">
        <div className="ga-error">
          <h3>QR Code non reconnu</h3>
          <p>{error}</p>
          <details>
            <summary>Données brutes</summary>
            <pre style={{ fontSize: "12px", overflow: "auto" }}>{qrData}</pre>
          </details>
        </div>
      </div>
    )
  }

  if (!parsedData) {
    return (
      <div className="qr-display">
        <p>Analyse du QR code en cours...</p>
      </div>
    )
  }

  return (
    <>
      <div className="qr-display">
        <h3>Informations du rouleau</h3>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", textAlign: "left" }}>
          <div>
            <h4>Identification</h4>
            <p>
              <strong>ID Rouleau:</strong> {parsedData.roll_item_id}
            </p>
            <p>
              <strong>Référence:</strong> {parsedData.ref_sonefi}
            </p>
            <p>
              <strong>Catégorie:</strong> {parsedData.category}
            </p>
            <p>
              <strong>Fournisseur:</strong> {parsedData.supplier}
            </p>
          </div>

          <div>
            <h4>Caractéristiques</h4>
            <p>
              <strong>Longueur:</strong> {parsedData.length_ml} ML
            </p>
            <p>
              <strong>Largeur:</strong> {parsedData.width_mm} mm
            </p>
            <p>
              <strong>Qualité:</strong> {parsedData.quality}
            </p>
            <p>
              <strong>Statut:</strong> {parsedData.status}
            </p>
          </div>

          <div>
            <h4>Traçabilité</h4>
            <p>
              <strong>Lot fournisseur:</strong> {parsedData.vendor_lot}
            </p>
            <p>
              <strong>Batch:</strong> {parsedData.batch}
            </p>
            <p>
              <strong>Date réception:</strong> {parsedData.date_in}
            </p>
            <p>
              <strong>N° BL:</strong> {parsedData.bl_number}
            </p>
          </div>

          <div>
            <h4>Localisation</h4>
            <p>
              <strong>Emplacement:</strong> {parsedData.location || "Non défini"}
            </p>
            <p>
              <strong>Notes:</strong> {parsedData.notes || "Aucune"}
            </p>
            <p>
              <strong>Généré le:</strong> {new Date(parsedData.timestamp).toLocaleString("fr-FR")}
            </p>
          </div>
        </div>

        <div style={{ marginTop: "16px", display: "flex", gap: "12px", justifyContent: "center" }}>
          <button className="ga-btn" onClick={() => setShowDetails(true)}>
            📋 Voir fiche complète
          </button>

          {parsedData.view_url && (
            <a href={parsedData.view_url} target="_blank" rel="noopener noreferrer" className="ga-btn ghost">
              🔗 Ouvrir dans Monday
            </a>
          )}
        </div>
      </div>

      {/* Modal de détails complets */}
      {showDetails && <RollDetailsView rollId={parsedData.roll_item_id} onClose={() => setShowDetails(false)} />}
    </>
  )
}

export default QRDisplay
