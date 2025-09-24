// src/App.jsx
import React, { useMemo, useState } from "react";
import "./App.css";
import mondaySdk from "monday-sdk-js";
import ReceptionModal from "./components/ReceptionModal.jsx";
import { ENTRY_BOARD_ID, ROLLS_BOARD_ID, ROLLS_GROUP_ID, /* … COL_* … */ } from "../config/mondayIds";

const monday = mondaySdk();

import {
  ENTRY_BOARD_ID, ROLLS_BOARD_ID, ROLLS_GROUP_ID,
  CATALOG_BOARD_ID,
  COL_UNIT_ENTRY, COL_WIDTH_ENTRY, COL_QTY_RCVD_CUM, COL_ROLLS_COUNT, COL_ROLLS_LINK, COL_LOCK_RECEIPT,
  COL_CAT_CATALOG, COL_REF_TEXT_CAT, COL_ACTIVE_CAT, COL_UNIT_DEFAULT, COL_WIDTH_DEFAULT,
  COL_LINK_PARENT_ROLL, COL_SUPPLIER_ROLL, COL_CAT_ROLL, COL_REF_LINK_ROLL, COL_REF_TEXT_ROLL,
  COL_WIDTH_ROLL, COL_LENGTH_ROLL, COL_UNIT_ROLL, COL_VENDOR_LOT_ROLL, COL_BATCH_ROLL, COL_DATE_IN_ROLL,
  COL_LOC_ROLL, COL_QUALITY_ROLL, COL_QR_ROLL,
  COL_JOURNAL_DATE, COL_JOURNAL_BL, COL_JOURNAL_LOT, COL_JOURNAL_QTY, COL_JOURNAL_UNIT, COL_JOURNAL_NBROLL, COL_JOURNAL_USER
} from "./config/mondayIds";


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
