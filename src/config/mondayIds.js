// Configuration centralisée des IDs Monday.com
// Remplacez par vos vrais IDs de boards et colonnes

// Boards
export const ENTRY_BOARD_ID = "7678082330" // Board "ENTRÉES DE STOCK"
export const ROLLS_BOARD_ID = "1234567891" // Board "STOCK ROULEAUX"
export const MOVEMENTS_BOARD_ID = "1234567892" // Board "MOUVEMENTS"
export const PRODUCTION_BOARD_ID = "1234567893" // Board "PRODUCTION"
export const ORDERS_BOARD_ID = "1234567894" // Board "COMMANDES"

// Groups
export const ROLLS_GROUP_ID = "topics" // Groupe par défaut dans STOCK ROULEAUX

// Colonnes Board ENTRÉES DE STOCK
export const COL_SUPPLIER = "texte9" // FOURNISSEUR (Text)
export const COL_PRODUCT = "texte2" // Description produit (Text/Long Text)
export const COL_QTY = "quantit__produit" // Quantité commandée (Numbers)
export const COL_UNIT_ENTRY = "texte3" // Unité (Text)
export const COL_WIDTH_ENTRY = "texte4" // Largeur (Text/Numbers)
export const COL_QTY_RCVD_CUM = "texte5" // Quantité reçue cumulée (Numbers)
export const COL_ROLLS_COUNT = "texte6" // Nombre de rouleaux (Numbers)
export const COL_ROLLS_LINK = "texte7" // Lien vers rouleaux (Connect Boards)
export const COL_LOCK_RECEIPT = "texte8" // Verrouillage réception (Status)
export const COL_LAST_RECEIPT = "date4" // Dernière réception (Date)

// Colonnes Board STOCK ROULEAUX
export const COL_LINK_PARENT_ROLL = "connect_boards" // Lien vers ligne d'achat (Connect Boards)
export const COL_SUPPLIER_ROLL = "texte" // Fournisseur (Text)
export const COL_CAT_ROLL = "texte0" // Catégorie (Text)
export const COL_REF_TEXT_ROLL = "texte1" // Référence SONEFI (Text)
export const COL_WIDTH_ROLL = "numbers" // Largeur mm (Numbers)
export const COL_LENGTH_ROLL = "numbers0" // Longueur ML (Numbers)
export const COL_LENGTH_REMAINING = "numbers1" // Longueur restante (Numbers)
export const COL_UNIT_ROLL = "texte2" // Unité (Text)
export const COL_VENDOR_LOT_ROLL = "texte3" // Lot fournisseur (Text)
export const COL_BATCH_ROLL = "texte4" // Batch interne (Text)
export const COL_DATE_IN_ROLL = "date" // Date réception (Date)
export const COL_LOC_ROLL = "texte5" // Emplacement (Text)
export const COL_QUALITY_ROLL = "status" // Qualité (Status)
export const COL_QR_ROLL = "files" // QR Code (Files)
export const COL_STATUS_ROLL = "status0" // Statut rouleau (Status)
export const COL_REORDER_THRESHOLD = "numbers2" // Seuil réassort (Numbers)
export const COL_TO_REORDER = "status1" // À réassort (Status)

// Colonnes Board MOUVEMENTS
export const COL_JOURNAL_DATE = "date" // Date mouvement (Date)
export const COL_JOURNAL_ROLL = "connect_boards" // Rouleau concerné (Connect Boards)
export const COL_JOURNAL_ACTION = "status" // Type d'action (Status)
export const COL_JOURNAL_QTY = "numbers" // Quantité impactée (Numbers)
export const COL_JOURNAL_UNIT = "texte" // Unité (Text)
export const COL_JOURNAL_REF = "texte0" // Référence associée (Text)
export const COL_JOURNAL_USER = "person" // Opérateur (Person)
export const COL_JOURNAL_REASON = "texte1" // Motif (Text)
export const COL_JOURNAL_ATTACHMENT = "files" // Pièce jointe (Files)
export const COL_JOURNAL_BL = "texte2" // N° BL (Text)
export const COL_JOURNAL_LOT = "texte3" // Lot (Text)
export const COL_JOURNAL_NBROLL = "numbers0" // Nombre rouleaux (Numbers)

// Colonnes Board PRODUCTION
export const COL_PROD_OF = "texte" // N° OF (Text)
export const COL_PROD_PRODUCT = "texte0" // Produit/Variante (Text)
export const COL_PROD_QTY_PLANNED = "numbers" // Quantité à fabriquer (Numbers)
export const COL_PROD_QTY_MADE = "numbers0" // Quantité fabriquée (Numbers)
export const COL_PROD_ROLLS_USED = "connect_boards" // Rouleaux consommés (Connect Boards)
export const COL_PROD_STATUS = "status" // Statut OF (Status)
