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
  const [selected, setSelected] = useState({});       // { [itemId]: true }
  const [receivedForm, setReceivedForm] = useState({});// { [itemId]: "12.5" }
  const [saving, setSaving] = useState(false);

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
  function toggleSelect(id) {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  }
  function setReceived(id, val) {
    setReceivedForm(prev => ({ ...prev, [id]: val }));
  }
  function getOrderedQty(line) {
    // on a déjà qtyDisplay; ici on relit la version brute si besoin
    return line.qtyDisplay;
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
          cols: [COL_SUPPLIER, COL_PRODUCT, COL_QTY],
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

  async function confirmReception() {
  const picked = supplierLines.filter(ln => selected[ln.id]);
  if (!picked.length) {
    alert("Sélectionne au moins une ligne.");
    return;
  }

  // Prépare les données saisies
  const payload = picked.map(ln => {
    const rec = receivedForm[ln.id];
    const received = rec ? parseFloat(String(rec).replace(",", ".")) : 0;
    return {
      itemId: ln.id,
      product: ln.product,
      orderedQty: ln.qtyDisplay,
      receivedQty: received,
    };
  });

  // Validation légère
  const missing = payload.filter(p => !(p.receivedQty > 0));
  if (missing.length) {
    alert("Renseigne une quantité reçue (>0) pour chaque ligne sélectionnée.");
    return;
  }

  // 👉 Ici on fera les mutations Monday :
  // - soit création/MAJ colonnes QTE_RECUE & QTE_RESTE + date entrée stock (date1)
  // - soit on passe à l’étape “Créer rouleaux” après validation
  // Pour l’instant, on affiche un récap (debug) :
  console.table(payload);
  alert(`OK, ${payload.length} ligne(s) prêtes pour la réception.\n(Je branche les mutations dès que tu me confirmes les colonnes / option rouleaux.)`);
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

                {supplierLines.map((ln) => (
                  <div key={ln.id} className="ga-card pastel-grey" style={{ cursor: "default" }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <input
                            type="checkbox"
                            checked={!!selected[ln.id]}
                            onChange={() => toggleSelect(ln.id)}
                          />
                          <span className="ga-label">{ln.product || "(Sans description)"}</span>
                        </label>

                        <div style={{ fontSize: 14, opacity: 0.85 }}>
                          Cmd : {ln.qtyDisplay} &nbsp;•&nbsp; Item #{ln.id}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span>Qté reçue</span>
                          <input
                            className="ga-input"
                            style={{ width: 120 }}
                            inputMode="decimal"
                            placeholder="ex: 10"
                            value={receivedForm[ln.id] ?? ""}
                            onChange={(e) => setReceived(ln.id, e.target.value)}
                          />
                        </label>

                        {/* Placeholders pour la suite (laize, unité, etc.) */}
                        {/* <label>Laize …</label> <label>Unité …</label> */}
                      </div>
                    </div>
                  </div>
                ))}


                    <div className="ga-modal-buttons" style={{ marginTop: 12 }}>
                      <button className="ga-btn ghost" onClick={() => setSelectedSupplier("")}>
                        ⬅︎ Retour fournisseurs
                      </button>
                      <button className="ga-btn" disabled={saving} onClick={confirmReception}>
                        {saving ? "Enregistrement…" : "Confirmer la réception"}
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
    </div>
  );
}

