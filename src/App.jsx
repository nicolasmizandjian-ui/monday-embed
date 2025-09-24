// src/App.jsx
import React, { useMemo, useState } from "react";
import "./App.css";
import mondaySdk from "monday-sdk-js";
import ReceptionModal from "./components/ReceptionModal.jsx";
import { ENTRY_BOARD_ID, ROLLS_BOARD_ID, ROLLS_GROUP_ID, /* … COL_* … */ } from "../config/mondayIds";

const monday = mondaySdk();

// === BOARDS & GROUPS ===
const ENTRY_BOARD_ID = "7678082330"; // Entrées de stock (lignes d’achat) – déjà utilisé comme BOARD_ID
const ROLLS_BOARD_ID = "TODO_STOCK_ROULEAUX_BOARD_ID";
const ROLLS_GROUP_ID = "TODO_GROUPE_STOCK"; // ex. "stock"

// === CATALOGUE ===
const CATALOG_BOARD_ID = "TODO_CATALOGUE_SONEFI_BOARD_ID";

// === COLS Entrées (lignes d’achat) ===
const COL_UNIT_ENTRY     = "TODO_UNITE";          // Status: ML / UNITE
const COL_WIDTH_ENTRY    = "TODO_LAIZE_MM";       // Number (mm)
const COL_QTY_RCVD_CUM   = "TODO_QTE_RECUE_CUM";  // Number
const COL_QTY_LEFT_FORM  = "TODO_RESTE_A_RECEVOIR_FORMULA"; // Formula (option)
const COL_LAST_RECEIPT   = "TODO_DERNIERE_RECEPTION";       // Date
const COL_ROLLS_COUNT    = "TODO_NB_ROULEAUX";    // Number
const COL_ROLLS_LINK     = "TODO_ROULEAUX_LIES";  // Connect boards -> Stock Rouleaux
const COL_LOCK_RECEIPT   = "TODO_RECEPTION_EN_COURS"; // Status/Toggle

// === COLS Catalogue (board “Catalogue Sonefi”) ===
const COL_CAT_CATALOG    = "TODO_CAT_CATALOG";     // Status
const COL_REF_TEXT_CAT   = "TODO_REF_TEXT";        // Text unique (réf SONEFI)
const COL_ACTIVE_CAT     = "TODO_ACTIF";           // Status (Actif/Oui)
const COL_UNIT_DEFAULT   = "TODO_UNITE_DEF";       // (option) Text/Status
const COL_WIDTH_DEFAULT  = "TODO_LAIZE_DEF";       // (option) Number

// === COLS Stock Rouleaux ===
const COL_LINK_PARENT_ROLL = "TODO_LIGNE_ACHAT";   // Connect boards -> Entrées
const COL_SUPPLIER_ROLL    = "TODO_FOURNISSEUR_ROLL"; // (Text ou Mirror si tu préfères)
const COL_CAT_ROLL         = "TODO_CATEGORIE_ROLL";   // Status (mêmes labels que catalogue)
const COL_REF_LINK_ROLL    = "TODO_REF_LINK_ROLL";    // Connect boards -> Catalogue
const COL_REF_TEXT_ROLL    = "TODO_REF_TEXT_ROLL";    // Text (snapshot lisible)
const COL_WIDTH_ROLL       = "TODO_LAIZE_MM_ROLL";    // Number
const COL_LENGTH_ROLL      = "TODO_LONGUEUR_ML_ROLL"; // Number (visible si unité=ML)
const COL_UNIT_ROLL        = "TODO_UNITE_ROLL";       // Text/Status (recopie)
const COL_VENDOR_LOT_ROLL  = "TODO_LOT_FOURNISSEUR";  // Text (obligatoire)
const COL_BATCH_ROLL       = "TODO_BATCH_INTERNE";    // Text
const COL_DATE_IN_ROLL     = "TODO_DATE_RECEPTION";   // Date
const COL_LOC_ROLL         = "TODO_EMPLACEMENT";      // Text/Status
const COL_QUALITY_ROLL     = "TODO_QUALITE";          // Status: OK / Quarantaine / Rejet
const COL_QR_ROLL          = "TODO_QR_FILES";         // Files

// === SUBITEMS Entrées : journal réception ===
const COL_JOURNAL_DATE   = "TODO_J_DATE";
const COL_JOURNAL_BL     = "TODO_J_BL";
const COL_JOURNAL_LOT    = "TODO_J_LOT";
const COL_JOURNAL_QTY    = "TODO_J_QTY";
const COL_JOURNAL_UNIT   = "TODO_J_UNIT";
const COL_JOURNAL_NBROLL = "TODO_J_NBROLL";
const COL_JOURNAL_USER   = "TODO_J_USER";

// === PARAMS ===
const RECEIPT_TOLERANCE = 0.005; // 0,5%

// === CONFIG (confirmé) ===
const BOARD_ID     = "7678082330";       // ENTRÉES DE STOCK
const COL_SUPPLIER = "texte9";           // FOURNISSEUR (text)
const COL_PRODUCT  = "texte2";           // Description produit (peut contenir HTML)
const COL_QTY      = "quantit__produit"; // Quantité produit (numbers)

// ---------- Helpers ----------
function stripHtml(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent || div.innerText || "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatQty(q) {
  const n = parseFloat(String(q).replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n)) return q || "—";
  return new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export default function App() {
  // UI
  const [showStockModal, setShowStockModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Données
  const [items, setItems] = useState([]);                  // {id,name,supplier,product,qtyDisplay}
  const [suppliers, setSuppliers] = useState([]);          // ["FOURNISSEUR..."]
  const [supplierCounts, setSupplierCounts] = useState({}); // { Fournisseur: nb }
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);

  // Boutons
  const actions = [
    { key: "decoupe",    label: "Lancer une découpe",          color: "pastel-green",  icon: "✂️" },
    { key: "nettoyage",  label: "Lancer un nettoyage",         color: "pastel-blue",   icon: "🧽" },
    { key: "assemblage", label: "Lancer un assemblage",        color: "pastel-purple", icon: "🛠️" },
    { key: "confection", label: "Lancer une confection",       color: "pastel-orange", icon: "🧵" },
    { key: "stock_in",   label: "Mettre en stock (réception)", color: "pastel-yellow", icon: "📦" },
    { key: "stock_out",  label: "Oups, retirer du stock",      color: "pastel-red",    icon: "⚠️" },
  ];

  function handleClick(a) {
    if (a.key === "stock_in") openStockModal();
    else alert(`🛠️ Bientôt : ${a.label}`);
  }

  // ---------- Chargement via boards -> items_page (ta requête B) ----------
  async function openStockModal() {
    setShowStockModal(true);
    setSelectedSupplier("");
    setSupplierQuery("");
    setLoading(true);
    setError("");

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
    `;

    try {
      const res = await monday.api(q, {
        variables: {
          boardId: String(BOARD_ID),
          limit: 200,
          cols: [COL_SUPPLIER, COL_PRODUCT, COL_QTY, COL_UNIT_ENTRY, COL_WIDTH_ENTRY, COL_QTY_RCVD_CUM, COL_ROLLS_COUNT],
        },
      });
      if (res?.errors?.length) throw new Error(res.errors.map(e => e.message).join(" | "));

      const raw = res?.data?.boards?.[0]?.items_page?.items ?? [];

      // Normalisation + formats
      const normalized = raw.map((it) => {
        const byId = Object.fromEntries((it.column_values || []).map(cv => [cv.id, cv.text]));
        return {
          id: it.id,
          name: it.name,
          supplier: (byId[COL_SUPPLIER] || "").trim(),
          product:  stripHtml(byId[COL_PRODUCT] || it.name),
          qtyDisplay: formatQty(byId[COL_QTY] || ""),
          qtyRaw: byId[COL_QTY] || "",
          unit: (byId[COL_UNIT_ENTRY] || "").trim(),
          widthMm: byId[COL_WIDTH_ENTRY] || "",
          qtyReceivedCum: byId[COL_QTY_RCVD_CUM] || "0",
          nbRolls: byId[COL_ROLLS_COUNT] || "0",
        };
      });

      setItems(normalized);

      const uniq = [...new Set(normalized.map(x => x.supplier).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      setSuppliers(uniq);

      const counts = normalized.reduce((acc, it) => {
        if (it.supplier) acc[it.supplier] = (acc[it.supplier] || 0) + 1;
        return acc;
      }, {});
      setSupplierCounts(counts);

      if (!uniq.length) setError("Aucun fournisseur trouvé (colonne FOURNISSEUR vide ?).");
    } catch (e) {
      setError("Erreur GraphQL (items_page) : " + (e?.message || "inconnue"));
    } finally {
      setLoading(false);
    }
  }

  // Lignes du fournisseur sélectionné
  const supplierLines = useMemo(
    () => (selectedSupplier ? items.filter(it => it.supplier === selectedSupplier) : []),
    [items, selectedSupplier]
  );

  return (
    <div className="ga-wrapper">
      {/* TOPBAR */}
      <div className="ga-topbar">
        <h1 className="ga-title">⚙️ Gestion atelier</h1>
        <button className="ga-btn ghost" onClick={() => alert("Config à venir")}>
          Configurer
        </button>
      </div>

      {/* GRILLE D’ACTIONS */}
      <div className="ga-grid">
        {actions.map((a) => (
          <button key={a.key} className={`ga-card ${a.color}`} onClick={() => handleClick(a)}>
            <div className="ga-icon">{a.icon}</div>
            <div className="ga-label">{a.label}</div>
          </button>
        ))}
      </div>

      {error && <p className="ga-error">{error}</p>}

      {/* MODALE STOCK */}
      {showStockModal && (
        <div className="modal-overlay" onClick={() => setShowStockModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {!selectedSupplier ? (
              <>
                <h2 style={{ marginTop: 0 }}>📦 Sélectionne un fournisseur</h2>
                {loading && <p>Chargement…</p>}

                {!loading && suppliers.length === 0 && (
                  <p>Aucun fournisseur trouvé dans “ENTRÉES DE STOCK”.</p>
                )}

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
                        .filter(s => s.toLowerCase().includes(supplierQuery.toLowerCase()))
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
                        onClick={() => {
                          setSelectedEntry({
                            id: ln.id,
                            name: ln.name,
                            supplier: ln.supplier,
                            product: ln.product,
                            qtyCommanded: parseFloat(String(ln.qtyRaw).replace(",", ".")) || 0,
                            unit: ln.unit || "ML",
                            widthMm: ln.widthMm ? parseFloat(String(ln.widthMm).replace(",", ".")) : undefined,
                            qtyReceivedCum: ln.qtyReceivedCum ? parseFloat(String(ln.qtyReceivedCum).replace(",", ".")) : 0,
                            nbRolls: ln.nbRolls ? parseInt(ln.nbRolls,10) : 0,
                          });
                        }}
                      >
                        {/* ton rendu existant */}
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
      {selectedEntry && (
        <ReceptionModal
          open={!!selectedEntry}
          entryItem={selectedEntry}
          onClose={(refresh) => {
            setSelectedEntry(null);
            if (refresh) openStockModal(); // recharge la liste après validation
          }}
        />
      )}
    </div>
  );
}
