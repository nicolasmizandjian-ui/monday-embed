import React, { useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";
import "./App.css"; // 👈 important pour les couleurs & tailles

const monday = mondaySdk();

/** CONFIG — adapte si besoin */
const BOARD_ID     = "7678082330";          // Board “ENTRÉES DE STOCK”
const COL_SUPPLIER = "texte9";              // FOURNISSEUR
const COL_PRODUCT  = "texte2";              // Description produit
const COL_QTY      = "quantit__produit";    // Quantité produit

export default function App() {
  const [showStockModal, setShowStockModal]     = useState(false);
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState("");
  const [debug, setDebug]                       = useState("");

  // Données chargées depuis le board “Entrées de Stock”
  const [items, setItems]                       = useState([]); // [{id,name,supplier,product,qty}]
  const [suppliers, setSuppliers]               = useState([]); // ["Fournisseur A", ...]
  const [selectedSupplier, setSelectedSupplier] = useState("");

  const actions = [
    { key: "decoupe",     label: "Lancer une découpe",          color: "pastel-green",  icon: "✂️" },
    { key: "nettoyage",   label: "Lancer un nettoyage",         color: "pastel-blue",   icon: "🧽" },
    { key: "assemblage",  label: "Lancer un assemblage",        color: "pastel-purple", icon: "🛠️" },
    { key: "confection",  label: "Lancer une confection",       color: "pastel-orange", icon: "🧵" },
    { key: "stock_in",    label: "Mettre en stock (réception)", color: "pastel-yellow", icon: "📦" },
    { key: "stock_out",   label: "Oups, retirer du stock",      color: "pastel-red",    icon: "⚠️" },
  ];

  function handleClick(a) {
    if (a.key === "stock_in") {
      openStockModal();
    } else {
      // à brancher plus tard
      alert(`🛠️ Bientôt : ${a.label}`);
    }
  }

  /** Lecture “Entrées de Stock” — boards → groups → items (fallback ID/Int) + debug détaillé */
  async function openStockModal() {
    setShowStockModal(true);
    setSelectedSupplier("");
    setLoading(true);
    setError("");
    setDebug("");
    try {
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

      let attempts = [];
      // 1) Essai en ID
      let res = await monday.api(qID, { variables: { ...vars, id: String(BOARD_ID) } });
      if (res?.errors?.length) attempts.push({ variant: "ID", errors: res.errors });

      // 2) Fallback en Int si besoin
      if (res?.errors?.length) {
        res = await monday.api(qINT, { variables: { ...vars, id: Number(BOARD_ID) } });
        if (res?.errors?.length) attempts.push({ variant: "Int", errors: res.errors });
      }

      if (res?.errors?.length) {
        setError("Erreur GraphQL : validation errors");
        setDebug(JSON.stringify({ attempts }, null, 2));
        return;
      }

      const raw = (res?.data?.boards?.[0]?.groups ?? []).flatMap(g => g?.items ?? []);
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

      const uniq = [...new Set(normalized.map(x => x.supplier).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
      setSuppliers(uniq);
    } catch (e) {
      setError("Erreur GraphQL : " + (e?.message || "inconnue"));
      setDebug(e?.stack || String(e));
    } finally {
      setLoading(false);
    }
  }

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
      {debug && (
        <details className="ga-debug">
          <summary>Afficher le debug</summary>
          <pre>{debug}</pre>
        </details>
      )}

      {/* MODALE STOCK */}
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
                  <div className="ga-supplier-list">
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

                <div className="ga-modal-buttons">
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
                  <div className="ga-lines">
                    {supplierLines.map((ln) => (
                      <div key={ln.id} className="ga-card pastel-grey" style={{cursor:"default"}}>
                        <div className="ga-icon">📦</div>
                        <div style={{display:"grid"}}>
                          <div className="ga-label">{ln.product || "(Sans description)"}</div>
                          <div className="ga-line-meta">
                            Qté prévue : {ln.qty || "—"} • Item #{ln.id}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="ga-modal-buttons">
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

