"use client"

import { useState } from "react"
import mondaySdk from "monday-sdk-js"
import {
  MOVEMENTS_BOARD_ID,
  COL_LENGTH_REMAINING,
  COL_STATUS_ROLL,
  COL_JOURNAL_DATE,
  COL_JOURNAL_ROLL,
  COL_JOURNAL_ACTION,
  COL_JOURNAL_QTY,
  COL_JOURNAL_UNIT,
  COL_JOURNAL_REF,
  COL_JOURNAL_REASON,
} from "../config/mondayIds"

const monday = mondaySdk()

function RollActionModal({ open, onClose, rollData, actionType }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // États communs
  const [quantity, setQuantity] = useState("")
  const [reference, setReference] = useState("")
  const [reason, setReason] = useState("")
  const [notes, setNotes] = useState("")

  // États spécifiques par action
  const [cutType, setCutType] = useState("length") // length, width, pieces
  const [productionOrder, setProductionOrder] = useState("")
  const [cleaningProduct, setCleaningProduct] = useState("")
  const [cleaningLot, setCleaningLot] = useState("")
  const [temperature, setTemperature] = useState("")
  const [duration, setDuration] = useState("")
  const [adjustmentType, setAdjustmentType] = useState("inventory") // inventory, damage, error

  const actionConfig = {
    decoupe: {
      title: "Découpe",
      icon: "✂️",
      color: "pastel-green",
      requiresQuantity: true,
      requiresReference: true,
    },
    confection: {
      title: "Confection",
      icon: "🧵",
      color: "pastel-orange",
      requiresQuantity: true,
      requiresReference: true,
    },
    nettoyage: {
      title: "Nettoyage",
      icon: "🧽",
      color: "pastel-blue",
      requiresQuantity: false,
      requiresReference: false,
    },
    ajustement: {
      title: "Ajustement Stock",
      icon: "⚖️",
      color: "pastel-red",
      requiresQuantity: true,
      requiresReference: false,
    },
  }

  const config = actionConfig[actionType] || actionConfig.decoupe

  const handleSubmit = async () => {
    try {
      setError("")
      setLoading(true)

      // Validations communes
      if (config.requiresQuantity && (!quantity || Number.parseFloat(quantity) <= 0)) {
        throw new Error("Quantité obligatoire et > 0")
      }

      if (config.requiresReference && !reference.trim()) {
        throw new Error("Référence obligatoire")
      }

      // Validations spécifiques
      if (actionType === "ajustement" && !reason.trim()) {
        throw new Error("Motif obligatoire pour les ajustements")
      }

      if (actionType === "nettoyage" && !cleaningProduct.trim()) {
        throw new Error("Produit de nettoyage obligatoire")
      }

      const currentLength = Number.parseFloat(rollData.length_remaining || rollData.length_ml || 0)
      let newLength = currentLength
      let impactedQty = 0

      // Calcul de l'impact selon le type d'action
      switch (actionType) {
        case "decoupe":
          if (cutType === "length") {
            impactedQty = Number.parseFloat(quantity)
            newLength = Math.max(0, currentLength - impactedQty)
          } else if (cutType === "width") {
            // Pour la largeur, on peut implémenter une logique de chutes
            impactedQty = Number.parseFloat(quantity) // m² ou autre unité
            // La longueur pourrait être affectée selon le schéma de chutes
          } else if (cutType === "pieces") {
            // Conversion pièces -> mètres selon paramétrage produit
            impactedQty = Number.parseFloat(quantity)
            // newLength calculé selon conversion
          }
          break

        case "confection":
          impactedQty = Number.parseFloat(quantity)
          newLength = Math.max(0, currentLength - impactedQty)
          break

        case "ajustement":
          impactedQty = Number.parseFloat(quantity)
          newLength = Math.max(0, currentLength + impactedQty) // + ou - selon signe
          break

        case "nettoyage":
          impactedQty = 0 // Pas d'impact sur la quantité
          break
      }

      // Vérification des limites
      if (newLength < 0) {
        throw new Error("Quantité insuffisante en stock")
      }

      // 1. Créer l'entrée dans le journal des mouvements
      const movementId = await createMovement({
        rollId: rollData.roll_item_id,
        actionType,
        quantity: impactedQty,
        reference,
        reason,
        notes,
        cutType,
        productionOrder,
        cleaningProduct,
        cleaningLot,
        temperature,
        duration,
        adjustmentType,
      })

      // 2. Mettre à jour le rouleau
      await updateRoll(rollData.roll_item_id, {
        lengthRemaining: newLength,
        status: newLength <= 0.5 ? "Terminé" : actionType === "nettoyage" ? "Nettoyé" : "En cours",
      })

      onClose(true) // Fermer avec refresh
    } catch (e) {
      setError(e.message || "Erreur inconnue")
    } finally {
      setLoading(false)
    }
  }

  const createMovement = async (data) => {
    const movementName = `${config.title} - ${rollData.ref_sonefi || "Rouleau"} - ${new Date().toLocaleDateString("fr-FR")}`

    const mutation = `
      mutation ($boardId: ID!, $itemName: String!) {
        create_item(board_id: $boardId, item_name: $itemName) { id }
      }
    `

    const result = await monday.api(mutation, {
      variables: {
        boardId: String(MOVEMENTS_BOARD_ID),
        itemName: movementName,
      },
    })

    const movementId = result?.data?.create_item?.id
    if (!movementId) throw new Error("Impossible de créer le mouvement")

    // Remplir les colonnes du mouvement
    const columnValues = {
      [COL_JOURNAL_DATE]: new Date().toISOString().split("T")[0],
      [COL_JOURNAL_ROLL]: { item_ids: [Number.parseInt(data.rollId)] },
      [COL_JOURNAL_ACTION]: { label: config.title },
      [COL_JOURNAL_QTY]: data.quantity,
      [COL_JOURNAL_UNIT]: data.cutType === "pieces" ? "PIECES" : "ML",
      [COL_JOURNAL_REF]: data.reference || data.productionOrder || "",
      [COL_JOURNAL_REASON]: data.reason || `${config.title} - ${data.cutType || ""}`,
    }

    await changeCols(movementId, columnValues, MOVEMENTS_BOARD_ID)
    return movementId
  }

  const updateRoll = async (rollId, updates) => {
    const columnValues = {}

    if (updates.lengthRemaining !== undefined) {
      columnValues[COL_LENGTH_REMAINING] = updates.lengthRemaining
    }

    if (updates.status) {
      columnValues[COL_STATUS_ROLL] = { label: updates.status }
    }

    await changeCols(rollId, columnValues)
  }

  const changeCols = async (itemId, colValsObj, boardId = null) => {
    const mutation = `
      mutation ($itemId: ID!, $boardId: ID, $colVals: JSON!) {
        change_multiple_column_values(item_id: $itemId, board_id: $boardId, column_values: $colVals) { id }
      }
    `

    const colVals = JSON.stringify(colValsObj)
    await monday.api(mutation, {
      variables: {
        itemId: String(itemId),
        boardId: boardId ? String(boardId) : null,
        colVals,
      },
    })
  }

  if (!open) return null

  return (
    <div className="modal-overlay modal-top" onClick={() => onClose(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 className={config.color}>
          {config.icon} {config.title}
        </h2>

        <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 16 }}>
          <div>
            <strong>Rouleau:</strong> {rollData.ref_sonefi} - {rollData.supplier}
          </div>
          <div>
            <strong>Longueur restante:</strong> {rollData.length_remaining || rollData.length_ml} ML
          </div>
          <div>
            <strong>Largeur:</strong> {rollData.width_mm} mm
          </div>
          <div>
            <strong>Qualité:</strong> {rollData.quality}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {/* Champs spécifiques par action */}
          {actionType === "decoupe" && (
            <>
              <div>
                <label>Type de découpe</label>
                <select className="ga-input" value={cutType} onChange={(e) => setCutType(e.target.value)}>
                  <option value="length">Longueur (ML)</option>
                  <option value="width">Largeur (chutes)</option>
                  <option value="pieces">Pièces</option>
                </select>
              </div>

              <div>
                <label>Quantité à découper</label>
                <input
                  type="number"
                  step="0.01"
                  className="ga-input"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder={cutType === "pieces" ? "Nombre de pièces" : "Mètres"}
                />
              </div>

              <div>
                <label>Référence commande</label>
                <input
                  className="ga-input"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="N° commande client"
                />
              </div>
            </>
          )}

          {actionType === "confection" && (
            <>
              <div>
                <label>Quantité consommée (ML)</label>
                <input
                  type="number"
                  step="0.01"
                  className="ga-input"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>

              <div>
                <label>Ordre de fabrication</label>
                <input
                  className="ga-input"
                  value={productionOrder}
                  onChange={(e) => setProductionOrder(e.target.value)}
                  placeholder="N° OF"
                />
              </div>

              <div>
                <label>Produit à fabriquer</label>
                <input
                  className="ga-input"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Référence produit fini"
                />
              </div>
            </>
          )}

          {actionType === "nettoyage" && (
            <>
              <div>
                <label>Type d'opération</label>
                <select className="ga-input" value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">— Choisir —</option>
                  <option value="lavage">Lavage</option>
                  <option value="degraissage">Dégraissage</option>
                  <option value="desinfection">Désinfection</option>
                  <option value="autre">Autre</option>
                </select>
              </div>

              <div>
                <label>Produit utilisé</label>
                <input
                  className="ga-input"
                  value={cleaningProduct}
                  onChange={(e) => setCleaningProduct(e.target.value)}
                  placeholder="Nom du produit de nettoyage"
                />
              </div>

              <div>
                <label>Lot produit</label>
                <input
                  className="ga-input"
                  value={cleaningLot}
                  onChange={(e) => setCleaningLot(e.target.value)}
                  placeholder="N° lot du produit"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <label>Température (°C)</label>
                  <input
                    type="number"
                    className="ga-input"
                    value={temperature}
                    onChange={(e) => setTemperature(e.target.value)}
                  />
                </div>
                <div>
                  <label>Durée (min)</label>
                  <input
                    type="number"
                    className="ga-input"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {actionType === "ajustement" && (
            <>
              <div>
                <label>Type d'ajustement</label>
                <select className="ga-input" value={adjustmentType} onChange={(e) => setAdjustmentType(e.target.value)}>
                  <option value="inventory">Inventaire</option>
                  <option value="damage">Casse/Dégât</option>
                  <option value="error">Erreur de saisie</option>
                  <option value="other">Autre</option>
                </select>
              </div>

              <div>
                <label>Ajustement (ML) - positif ou négatif</label>
                <input
                  type="number"
                  step="0.01"
                  className="ga-input"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="ex: -2.5 ou +1.2"
                />
              </div>

              <div>
                <label>Motif détaillé (obligatoire)</label>
                <textarea
                  className="ga-input"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Expliquez la raison de l'ajustement..."
                />
              </div>
            </>
          )}

          {/* Champ notes commun */}
          <div>
            <label>Observations</label>
            <textarea
              className="ga-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Commentaires additionnels..."
            />
          </div>
        </div>

        {error && (
          <div className="ga-error" style={{ marginTop: 12 }}>
            {error}
          </div>
        )}

        <div className="ga-modal-buttons" style={{ marginTop: 16 }}>
          <button className="ga-btn ghost" onClick={() => onClose(false)}>
            Annuler
          </button>
          <button className={`ga-btn action-btn ${actionType}`} disabled={loading} onClick={handleSubmit}>
            {loading ? "Traitement..." : `Valider ${config.title.toLowerCase()}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default RollActionModal
