// src/App.jsx
import React, { useMemo, useState } from "react";
import "./App.css";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

// Board ENTRÉES DE STOCK
const BOARD_ID = "7678082330";
// IDs colonnes utilisées
const COL_SUPPLIER = "texte9";            // FOURNISSEUR
const COL_PRODUCT  = "texte2";            // Description produit
const COL_QTY      = "quantit__produit";  // Quantité produit

export default function App() {
  const [showStockModal, setShowStockModal] = useState(false);
  const [loading, setLoading] = useState(false);

  // Items bruts du board (chargés quand on ouvre la modale)
  const [items, setItems] = useState([]);
  // Liste des fournisseurs uniques
  const [suppliers, setSuppliers] = useState([]);
  // Fournisseur sélectionné
  const [selectedSupplier, setSelectedSupplier] = useState("");

  // Actions (boutons de la grille)
  const actions = [
    { key: "decoupe",     label: "Lancer une découpe",     color: "pastel-green",   icon: "✂️" },
    { key: "nettoyage",   label: "Lancer un nettoyage",    color: "pastel-blue",    icon: "🧽" },
    { key: "assemblage",  label: "Lancer un assemblage",   color: "pastel-purple",  icon: "🛠️" },
    { key: "confection",  label: "Lancer une confection",  color: "pastel-orange",  icon: "🧵" },
    { key: "stock_in",    label: "Mettre en stock (réception)", color: "pastel-yellow", icon: "📦" },
    { key: "stock_out",   label: "Oups, retirer du stock", color: "pastel-red",     icon: "⚠️" },
  ];

  function handleClick(a) {
    if (a.key === "stock_in") {
      openStockModal();
    } else {
      // placeholders pour les autres actions (à brancher plus tard)
      alert(`🛠️ Bientôt : ${a.label}`);
    }
  }

  // --------- LECTURE BOARD ENTRÉES DE STOCK (robuste ID/Int) ----------
  async function openStockModal() {
    setShowStockModal(true);
    setSelectedSupplier("");
    setLoading(true);
    try {
      // Lecture via boards -> groups -> items (évite boards->items non dispo sur certains clusters)
      const qID = `
        query ($id: ID!, $limit: Int!, $cols: [String!]) {
          boards(ids: [$id]) {
            groups {
              id
              items(limit: $limit) {
                id
                name
                column_values(ids: $cols) { id text }
              }
            }
          }
        }`;
      const qINT = `
        query ($id: Int!, $limit: Int!, $cols: [String!]) {
          boards(ids: [$id]) {
            groups {
              id
              items(limit: $limit) {
                id
                name
                column_values(ids: $cols) { id text }
              }
            }
          }
        }`;

      const vars = { limit: 200, cols: [COL_SUPPLIER, COL_PRODUCT, COL_QTY] };

      // 1) Essai avec ID
      let res = await monday.api(qID, { variables: { ...vars, id: String(BOARD_ID) } });
      // 2) Si erreurs, essai avec Int
      if (res?.errors?.length) {
        res = await monday.api(qINT, { variables: { ...vars, id: Number(BOARD_ID) } });
        if (res?.errors?.length) throw new Error(res.errors.map(e => e.message).join(" | "));
      }

      // Aplatis tous les items des groupes
      const raw = (res?.data?.boards?.[0]?.groups ?? [])
        .flatMap(g => g?.items ?? []);

      // Normalise chaque item (lecture des colonnes utiles)
      const normalized = raw.map(it => {
        const byId = Object.fromEntries((it.column_values || []).map(cv => [cv.id, cv.text]));
        return {
          id: it.id,
          name: it.name,
          supplier: byId[COL_SUPPLIER] || "",
          product:  byId[COL_PRODUCT]  || it.name,
          qty:      byId[COL_QTY]      || "",
        };
      });

      setItems(normalized);

      // Fournisseurs uniques triés
      const uniq = [...new Set(normalized.map(x => x.supplier).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      setSuppliers(uniq);
    } catch (e) {
      console.error("GraphQL error:", e);
      alert("❌ Erreur GraphQL : " + (e?.message || e));
    } finally {
      setLoading(false);
    }
  }
  // ---------------------------------------------------------------------

  // Lignes du fournisseur sélectionné
  const supplierLines = useMemo(() => {
    if (!selectedSupplier) return [];
    return items.filter(it => it.supplier === selectedSupplier);
  }, [items, selectedSupplier]);

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
          <button
            key={a.key}
            className={`ga-card ${a.color}`}
            onClick={() => handleClick(a)}
          >
            <div className="ga-icon">{a.icon}</div>
            <div className="ga-label">{a.label}</div>
          </button>
        ))}
      </div>

      {/* MODALE STOCK (2 étapes : fournisseurs -> lignes) */}
      {showStockModal && (
        <div className="modal-overlay" onClick={() => setShowStockModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {!selectedSupplier ? (
              <>
                <h2 style={{marginTop:0}}>📦 Sélectionne un fournisseur</h2>
                {loading && <p>Chargement…</p>}

                {!loading && suppliers.length === 0 && (
                  <p>Aucun fournisseur trouvé dans “ENTRÉES DE STOCK”.</p>
                )}

                {!loading && suppliers.length > 0 && (
                  <div style={{display:"grid", gap:10}}>
                    {suppliers.map((s) => (
                      <button
                        key={s}
                        className="ga-card pastel-grey"
                        onClick={() => setSelectedSupplier(s)}
                        title={`Voir les lignes pour ${s}`}
                      >
                        <div className="ga-icon">🏷️</div>
                        <div className="ga-label">{s}</div>
                      </button>
                    ))}
                  </div>
                )}

                <div className="ga-modal-buttons" style={{marginTop:12}}>
                  <button className="ga-btn ghost" onClick={() => setShowStockModal(false)}>
                    Annuler
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 style={{marginTop:0}}>🧾 Lignes — {selectedSupplier}</h2>

                {supplierLines.length === 0 ? (
                  <p>Aucune ligne pour ce fournisseur.</p>
                ) : (
                  <div style={{maxHeight:380, overflow:"auto", display:"grid", gap:10}}>
                    {supplierLines.map((ln) => (
                      <div key={ln.id} className="ga-card pastel-grey" style={{cursor:"default"}}>
                        <div className="ga-icon">📦</div>
                        <div style={{display:"grid"}}>
                          <div className="ga-label">{ln.product || "(Sans description)"}</div>
                          <div style={{fontSize:14, opacity:.85}}>
                            Qté prévue : {ln.qty || "—"} &nbsp;•&nbsp; Item #{ln.id}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ga-modal-buttons" style={{marginTop:12}}>
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
    </div>
  );
}
