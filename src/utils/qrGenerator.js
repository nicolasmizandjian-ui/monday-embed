// Utilitaires pour la génération et gestion des QR codes

/**
 * Génère un payload QR pour un rouleau
 * @param {Object} rollData - Données du rouleau
 * @returns {Object} Payload structuré pour le QR code
 */
export function generateRollQRPayload(rollData) {
  return {
    type: "roll",
    version: "1.0",
    timestamp: new Date().toISOString(),
    roll_item_id: rollData.roll_item_id,
    parent_entry_id: rollData.parent_entry_id,

    // Informations produit
    supplier: rollData.supplier,
    category: rollData.category,
    ref_sonefi: rollData.ref_sonefi,
    ref_sellsy: rollData.ref_sellsy,

    // Caractéristiques physiques
    unit: rollData.unit || "ML",
    width_mm: rollData.width_mm,
    length_ml: rollData.length_ml,
    length_remaining: rollData.length_remaining || rollData.length_ml,

    // Traçabilité
    vendor_lot: rollData.vendor_lot,
    batch: rollData.batch,
    date_in: rollData.dateIn,
    bl_number: rollData.bl,

    // État et localisation
    quality: rollData.quality || "OK",
    status: rollData.status || "En stock",
    location: rollData.loc,
    notes: rollData.notes,

    // URL de consultation (sera générée côté serveur)
    view_url: `${window.location.origin}/roll/${rollData.roll_item_id}`,
  }
}

/**
 * Génère un QR code via QuickChart.io
 * @param {Object} payload - Données à encoder dans le QR
 * @param {Object} options - Options de génération
 * @returns {Promise<Blob>} Blob de l'image QR
 */
export async function generateQRCodeImage(payload, options = {}) {
  const { size = 512, format = "png", margin = 1, errorCorrectionLevel = "M" } = options

  const qrData = JSON.stringify(payload)
  const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qrData)}&format=${format}&margin=${margin}&size=${size}&ecc=${errorCorrectionLevel}`

  try {
    const response = await fetch(qrUrl)
    if (!response.ok) {
      throw new Error(`QR generation failed: ${response.status}`)
    }
    return await response.blob()
  } catch (error) {
    console.error("QR code generation error:", error)
    throw error
  }
}

/**
 * Crée un fichier QR et l'attache à une colonne Monday.com
 * @param {Object} monday - Instance Monday SDK
 * @param {string} itemId - ID de l'item Monday
 * @param {string} columnId - ID de la colonne fichier
 * @param {Object} payload - Données pour le QR
 * @returns {Promise<void>}
 */
export async function createAndAttachQR(monday, itemId, columnId, payload) {
  try {
    // Générer l'image QR
    const qrBlob = await generateQRCodeImage(payload)

    // Créer un fichier avec un nom descriptif
    const fileName = `QR_${payload.ref_sonefi || "Roll"}_${itemId}.png`
    const file = new File([qrBlob], fileName, { type: "image/png" })

    // Attacher le fichier à Monday.com
    const mutation = `
      mutation ($itemId: ID!, $columnId: String!, $file: File!) {
        add_file_to_column(item_id: $itemId, column_id: $columnId, file: $file) { 
          id 
          name
          url
        }
      }
    `

    const result = await monday.api(mutation, {
      variables: {
        itemId: String(itemId),
        columnId,
        file,
      },
    })

    console.log("QR code attached successfully:", result)
    return result
  } catch (error) {
    console.error("Failed to create and attach QR code:", error)
    throw error
  }
}

/**
 * Génère un batch interne unique
 * @param {string} parentId - ID de la ligne d'achat parent
 * @param {number} sequence - Numéro de séquence
 * @param {string} dateIn - Date de réception
 * @returns {string} Batch formaté
 */
export function generateBatch(parentId, sequence, dateIn) {
  const date = new Date(dateIn)
  const year = String(date.getFullYear()).slice(2)
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const seq = String(sequence).padStart(2, "0")

  return `SNE-${year}${month}${day}-${parentId}-${seq}`
}

/**
 * Valide un payload QR
 * @param {Object} payload - Payload à valider
 * @returns {Object} Résultat de validation
 */
export function validateQRPayload(payload) {
  const errors = []
  const warnings = []

  // Champs obligatoires
  const required = ["type", "roll_item_id", "supplier", "category"]
  required.forEach((field) => {
    if (!payload[field]) {
      errors.push(`Champ obligatoire manquant: ${field}`)
    }
  })

  // Validations métier
  if (payload.length_ml && payload.length_ml <= 0) {
    errors.push("La longueur doit être positive")
  }

  if (payload.width_mm && payload.width_mm <= 0) {
    errors.push("La largeur doit être positive")
  }

  if (!payload.vendor_lot) {
    warnings.push("Lot fournisseur manquant - risque de quarantaine")
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Parse un QR code scanné
 * @param {string} qrData - Données du QR code
 * @returns {Object} Données parsées
 */
export function parseQRCode(qrData) {
  try {
    const payload = JSON.parse(qrData)

    // Vérifier que c'est bien un QR de rouleau
    if (payload.type !== "roll") {
      throw new Error("QR code non reconnu comme rouleau")
    }

    return {
      success: true,
      data: payload,
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      rawData: qrData,
    }
  }
}
