// src/App.jsx
import React, { useMemo, useState } from "react";
import "./App.css";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

// === CONFIG (confirmé) ===
const BOARD_ID     = "7678082330";       // ENTRÉES DE STOCK
const COL_SUPPLIER = "texte9";           // FOURNISSEUR (text)
const COL_PRODUCT  = "texte2";           // Description produit (peut contenir HTML)
const COL_QTY      = "quantit__produit"; // Quantité produit (numbers)

const RECEIPT_STATUS_OPTIONS = [
  { value: "complete", label: "Réception complète" },
  { value: "partial",  label: "Réception partielle" },
];

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
  const [lineStates, setLineStates] = useState({});          // { [lineId]: { selected, quantity, status, notes } }
  const [lineValidationError, setLineValidationError] = useState("");
  const [confirmationMessage, setConfirmationMessage] = useState("");

  // Boutons
  const actions = [
    { key: "decoupe",    label: "Lancer une découpe",          color: "pastel-green",  icon: "✂️" },
    { key: "nettoyage",  label: "Lancer un nettoyage",         color: "pastel-blue",   icon: "🧽" },
    { key: "assemblage", label: "Lancer un assemblage",        color: "pastel-purple", icon: "🛠️" },
    { key: "confection", label: "Lancer une confection",       color: "pastel-orange", icon: "🧵" },
    { key: "stock_in",   label: "Mettre en stock (réception)", color: "pastel-yellow", icon: "📦" },
    { key: "stock_out",  label: "Oups, retirer du stock",      color: "pastel-red",    icon: "⚠️" },
  ];

    function resetLineStates() {
    setLineStates({});
    setLineValidationError("");
    setConfirmationMessage("");
  }

  function resetSupplierSelection() {
    setSelectedSupplier("");
    setSupplierQuery("");
    resetLineStates();
  }

  function closeStockModal() {
    setShowStockModal(false);
    resetSupplierSelection();
  }

  function handleClick(a) {
    if (a.key === "stock_in") openStockModal();
    else alert(`🛠️ Bientôt : ${a.label}`);
  }

  // ---------- Chargement via boards -> items_page (ta requête B) ----------
  async function openStockModal() {
    setShowStockModal(true);
    resetSupplierSelection();
    setLoading(true);
    setError("");

    const q = `
      query ($boardId: ID!, $limit: Int!, $cols: [String!], $cursor: String) {
        boards(ids: [$boardId]) {
          items_page(limit: $limit, cursor: $cursor) {
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
            let cursor = null;
      let raw = [];

      do {
        const variables = {
          boardId: String(BOARD_ID),
          limit: 200,
          cols: [COL_SUPPLIER, COL_PRODUCT, COL_QTY],
   };
        if (cursor) variables.cursor = cursor;

        const res = await monday.api(q, { variables });
        if (res?.errors?.length) throw new Error(res.errors.map(e => e.message).join(" | "));

        const page = res?.data?.boards?.[0]?.items_page;
        const pageItems = page?.items ?? [];
        raw = raw.concat(pageItems);
        cursor = page?.cursor ?? null;
      } while (cursor);

      // Normalisation + formats
      const normalized = raw.map((it) => {
        const byId = Object.fromEntries((it.column_values || []).map(cv => [cv.id, cv.text]));
        return {
          id: it.id,
          name: it.name,
          supplier: (byId[COL_SUPPLIER] || "").trim(),
          product:  stripHtml(byId[COL_PRODUCT] || it.name),
          qtyDisplay: formatQty(byId[COL_QTY] || ""),
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

    const selectedLineCount = supplierLines.filter(
    (ln) => lineStates[ln.id]?.selected
  ).length;

  function updateLineState(lineId, updates) {
    setLineStates((prev) => {
      const current = prev[lineId] || {
        selected: false,
        quantity: "",
        status: RECEIPT_STATUS_OPTIONS[0].value,
        notes: "",
      };
      return {
        ...prev,
        [lineId]: { ...current, ...updates },
      };
    });
  }

  function toggleLineSelection(lineId) {
    setLineStates((prev) => {
      const current = prev[lineId] || {
        selected: false,
        quantity: "",
        status: RECEIPT_STATUS_OPTIONS[0].value,
        notes: "",
      };
      return {
        ...prev,
        [lineId]: { ...current, selected: !current.selected },
      };
    });
  }

  function normalizeQuantity(value) {
    if (value === undefined || value === null) return NaN;
    const normalized = String(value)
      .trim()
      .replace(/\s/g, "")
      .replace(/,/g, ".");
    if (!normalized) return NaN;
    return Number.parseFloat(normalized);
  }

  function handleConfirmReceipt() {
    setLineValidationError("");
    setConfirmationMessage("");

    const selectedLines = supplierLines.filter((ln) => lineStates[ln.id]?.selected);
    if (!selectedLines.length) {
      setLineValidationError("Sélectionne au moins une ligne avant de confirmer.");
      return;
    }

    const compiled = [];
    for (const line of selectedLines) {
      const state = lineStates[line.id];
      const quantity = normalizeQuantity(state.quantity);
      if (Number.isNaN(quantity) || quantity < 0) {
        setLineValidationError(
          `Quantité reçue invalide pour l’item #${line.id}.`
        );
        return;
      }
      compiled.push({
        itemId: line.id,
        quantityReceived: quantity,
        status: state.status,
        notes: state.notes?.trim() || "",
      });
    }

    console.log("[Réception] Lignes sélectionnées :", compiled);
    setConfirmationMessage(
      `Réception prête à être envoyée (${compiled.length} ligne${compiled.length > 1 ? "s" : ""}).`
    );
  }


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
        <div className="modal-overlay" onClick={closeStockModal}>
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
                              onClick={() => {
                              resetLineStates();
                              setSelectedSupplier(s);
                            }}
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
                  <button className="ga-btn ghost" onClick={closeStockModal}>
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
                                   <div className="ga-lines">
                    {supplierLines.map((ln) => {
                      const state = lineStates[ln.id] || {
                        selected: false,
                        quantity: "",
                        status: RECEIPT_STATUS_OPTIONS[0].value,
                        notes: "",
                      };
                      return (
                        <div
                          key={ln.id}
                          className="ga-card pastel-grey"
                          style={{ cursor: "default", alignItems: "flex-start" }}
                        >
                          <input
                            type="checkbox"
                            checked={state.selected}
                            onChange={() => toggleLineSelection(ln.id)}
                            style={{ marginTop: 6 }}
                          />
                          <div style={{ display: "grid", gap: 6, flex: 1 }}>
                            <div className="ga-label">{ln.product || "(Sans description)"}</div>
                            <div className="ga-line-meta">
                              Qté prévue : {ln.qtyDisplay} &nbsp;•&nbsp; Item #{ln.id}
                            </div>
                            <div style={{ display: "grid", gap: 8 }}>
                              <label style={{ fontSize: 14, fontWeight: 600 }}>
                                Quantité reçue
                                <input
                                  className="ga-input"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={state.quantity}
                                  onChange={(e) =>
                                    updateLineState(ln.id, { quantity: e.target.value })
                                  }
                                  disabled={!state.selected}
                                />
                              </label>
                              <label style={{ fontSize: 14, fontWeight: 600 }}>
                                Statut
                                <select
                                  className="ga-input"
                                  value={state.status}
                                  onChange={(e) =>
                                    updateLineState(ln.id, { status: e.target.value })
                                  }
                                  disabled={!state.selected}
                                >
                                  {RECEIPT_STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label style={{ fontSize: 14, fontWeight: 600 }}>
                                Remarques
                                <textarea
                                  className="ga-input"
                                  rows={2}
                                  value={state.notes}
                                  onChange={(e) =>
                                    updateLineState(ln.id, { notes: e.target.value })
                                  }
                                  disabled={!state.selected}
                                  style={{ resize: "vertical" }}
                                />
                              </label>
                            </div>
                          </div>
                        </div>
                           );
                    })}
                  </div>
                )}
                  
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  {selectedLineCount > 0
                    ? `${selectedLineCount} ligne${selectedLineCount > 1 ? "s" : ""} sélectionnée${selectedLineCount > 1 ? "s" : ""}.`
                    : "Aucune ligne sélectionnée."}
                </div>

                {lineValidationError && (
                  <p className="ga-error" style={{ marginTop: 8 }}>
                    {lineValidationError}
                  </p>
                )}
                {confirmationMessage && (
                  <p style={{ marginTop: 8, color: "#207544", fontWeight: 600 }}>
                    {confirmationMessage}
                  </p>
                )}

                <div className="ga-modal-buttons" style={{ marginTop: 12 }}>
                      <button
                    className="ga-btn ghost"
                    onClick={() => {
                      resetSupplierSelection();
                    }}
                  >
                    ⬅︎ Retour fournisseurs
                  </button>
                  <button className="ga-btn ghost" onClick={closeStockModal}>
                    Fermer
                  </button>
                    <button
                    className="ga-btn"
                    onClick={handleConfirmReceipt}
                    disabled={supplierLines.length === 0 || selectedLineCount === 0}
                    style={{ marginLeft: "auto", background: "#2e7d32", color: "#fff" }}
                  >
                    Confirmer la réception
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

