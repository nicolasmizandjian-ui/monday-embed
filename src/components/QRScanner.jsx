"use client"

import { useState, useRef } from "react"
import QRDisplay from "./QRDisplay"

function QRScanner({ onRollScanned }) {
  const [qrData, setQrData] = useState("")
  const [isScanning, setIsScanning] = useState(false)
  const fileInputRef = useRef(null)

  // Simulation de scan manuel pour les tests
  const handleManualInput = (e) => {
    setQrData(e.target.value)
  }

  // Upload d'image QR pour décodage
  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setIsScanning(true)

    try {
      // Dans un vrai projet, vous utiliseriez une librairie comme jsQR
      // Pour la démo, on simule le décodage
      const reader = new FileReader()
      reader.onload = (event) => {
        // Simulation - dans la réalité, il faudrait décoder l'image
        setQrData(
          '{"type":"roll","roll_item_id":"123456","supplier":"FOURNISSEUR TEST","category":"FEUTRE","ref_sonefi":"REF-001","length_ml":50,"width_mm":1500,"quality":"OK","vendor_lot":"LOT-2024-001","batch":"SNE-241201-123-01","date_in":"2024-12-01","bl_number":"BL-001","status":"En stock","timestamp":"2024-12-01T10:00:00.000Z"}',
        )
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error("Erreur lors du décodage QR:", error)
    } finally {
      setIsScanning(false)
    }
  }

  const handleRollScan = (rollData) => {
    onRollScanned?.(rollData)
  }

  return (
    <div style={{ padding: "20px" }}>
      <h2>Scanner QR Code</h2>

      <div style={{ display: "grid", gap: "16px", marginBottom: "20px" }}>
        <div>
          <label>Saisie manuelle (pour test):</label>
          <textarea
            className="ga-input"
            value={qrData}
            onChange={handleManualInput}
            placeholder="Collez ici les données JSON du QR code..."
            rows={3}
          />
        </div>

        <div>
          <label>Ou uploadez une image QR:</label>
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileUpload} className="ga-input" />
          {isScanning && <p>Décodage en cours...</p>}
        </div>
      </div>

      <QRDisplay qrData={qrData} onScan={handleRollScan} />
    </div>
  )
}

export default QRScanner
