// src/App.jsx
import React, { useMemo, useState } from "react";
import "./App.css";
import mondaySdk from "monday-sdk-js";
import "./App.css"; // 👈 important pour les couleurs & tailles

const monday = mondaySdk();

// === CONFIG — Entrées de stock ===
const BOARD_ID = "7678082330";
// IDs de colonnes (à vérifier dans Monday > menu colonne > Developer info)
const COL_SUPPLIER = "texte9";            // FOURNISSEUR
const COL_PRODUCT  = "texte2";            // Description produit
const COL_QTY      = "quantit__produit";  // Quantité produit

export default function App() {
  const [showStockModal, setShowStockModal] = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");

  // Données
  const [items, setItems]                 = useState([]);          // [{id,name,supplier,product,qty}]
  const [suppliers, setSuppliers]         = useState([]);          // ["F1","F2",...]
  const [selectedSupplier, setSelectedSupplier] = useState("");
  const [supplierCounts, setSupplierCounts] = useState({});
  const [supplierQuery, setSupplierQuery] = useState("");

  const actions = [
    { key: "decoupe",    label: "Lancer une découpe",            color: "pastel-green",  icon: "✂️" },
    { key: "nettoyage",  label: "Lancer un nettoyage",           color: "pastel-blue",   icon: "🧽" },
    { key: "assemblage", label: "Lancer un assemblage",          color: "pastel-purple", icon: "🛠️" },
    { key: "confection", label: "Lancer une confection",         color: "pastel-orange", icon: "🧵" },
    { key: "stock_in",   label: "Mettre en stock (réception)",   color: "pastel-yellow", icon: "📦" },
    { key: "stock_out",  label: "Oups, retirer du stock",        color: "pastel-red",    icon: "⚠️" },
  ];

  function handleClick(a) {
    if (a.key === "stock_in") openStockModal();
    else alert(`🛠️ Bientôt : ${a.label}`);
  }

  // ---------- Chargement "Entrées de stock" : items_page => fallback groups/items ----------
async function openStockModal() {
  setShowStockModal(true);
  setSelectedSupplier("");
  setLoading(true);
  setError("");

  const LIMIT = 200;
  const cols = [COL_SUPPLIER, COL_PRODUCT, COL_QTY];

  // === même forme que ta requête B qui marche dans le Playground ===
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
      variables: { boardId: String(BOARD_ID), limit: LIMIT, cols }
    });

    if (res?.errors?.length) {
      throw new Error(res.errors.map(e => e.message).join(" | "));
    }

    const raw = res?.data?.boards?.[0]?.items_page?.items ?? [];

    // normalisation
    const normalized = raw.map(it => {
      const map = Object.fromEntries((it.column_values || []).map(cv => [cv.id, cv.text]));
      return {
        id: it.id,
        name: it.name,
        supplier: (map[COL_SUPPLIER] || "").trim(),
        product:  map[COL_PRODUCT]  || it.name,
        qty:      map[COL_QTY]      || "",
      };
    });

    setItems(normalized);

    // fournisseurs uniques triés
    const uniq = [...new Set(normalized.map(x => x.supplier).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,"fr",{sensitivity:"base"}));
    setSuppliers(uniq);

    if (!uniq.length) {
      setError("Aucun fournisseur trouvé dans FOURNISSEUR (texte9) sur ce board.");
    }
  } catch (e) {
    setError("Erreur GraphQL (items_page) : " + (e?.message || "inconnue"));
  } finally {
    setLoading(false);
  }
}

  const supplierLines = useMemo(() => {
    if (!selectedSupplier) return [];
    return items.filter(it => it.supplier === selectedSupplier);
  }, [items, selectedSupplier]);

  // ---------- UI ----------
  return (
    <div className="ga-wrapper">
      {/* TOPBAR */}
      <div className="ga-topbar">
        <h1 className="ga-title">⚙️ Gestion atelier</h1>
        <button className="ga-btn ghost" onClick={() => alert("Config à venir")}>
          Configurer
        </button>
      </div>

      {/* GRILLE D’ACTIONS — gros boutons pastel, bien espacés */}
      <div className="ga-grid">
        {actions.map((a) => (
          <button
            key={a.key}
            className={`ga-card ${a.color}`}
            onClick={() => handleClick(a)}
            title={a.label}
          >
            <div className="ga-icon">{a.icon}</div>
            <div className="ga-label">{a.label}</div>
          </button>
        ))}
      </div>

      {error && <p className="ga-error">{error}</p>}

      {showStockModal && (
        <div className="modal-overlay" onClick={() => setShowStockModal(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            {!selectedSupplier ? (
              <>
                <h2 style={{marginTop:0}}>📦 Sélectionne un fournisseur</h2>
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
                        style={{marginBottom:12}}
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

                <div className="ga-modal-buttons" style={{marginTop:12}}>
                  <button className="ga-btn ghost" onClick={()=>setShowStockModal(false)}>Annuler</button>
                </div>
              </>

            ) : (
              <>
                <h2 style={{marginTop:0}}>🧾 Lignes — {selectedSupplier}</h2>

                {supplierLines.length === 0 ? (
                  <p>Aucune ligne pour ce fournisseur.</p>
                ) : (
                  <div style={{maxHeight:380, overflow:"auto", display:"grid", gap:10}}>
                    {supplierLines.map(ln => (
                      <div key={ln.id} className="ga-card pastel-grey" style={{cursor:"default"}}>
                        <div className="ga-icon">📦</div>
                        <div style={{display:"grid"}}>
                          <div className="ga-label">{ln.product || "(Sans description)"}</div>
                          <div style={{fontSize:14, opacity:.85}}>
                            Qté prévue : {ln.qty || "—"} • Item #{ln.id}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="ga-modal-buttons" style={{marginTop:12}}>
                  <button className="ga-btn ghost" onClick={()=>setSelectedSupplier("")}>⬅︎ Retour fournisseurs</button>
                  <button className="ga-btn ghost" onClick={()=>setShowStockModal(false)}>Fermer</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

