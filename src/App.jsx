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

    const LIMIT = 500;
    const cols = [COL_SUPPLIER, COL_PRODUCT, COL_QTY];

    // helpers de requêtes
    const Q_ITEMS_PAGE_ID = `
      query ($id: ID!, $limit: Int!, $cols: [String!]) {
        boards(ids: [$id]) {
          items_page(limit: $limit) {
            items {
              id name
              column_values(ids: $cols){ id text }
            }
          }
        }
      }`;
    const Q_ITEMS_PAGE_INT = `
      query ($id: Int!, $limit: Int!, $cols: [String!]) {
        boards(ids: [$id]) {
          items_page(limit: $limit) {
            items {
              id name
              column_values(ids: $cols){ id text }
            }
          }
        }
      }`;
    const Q_GROUPS_ID = `
      query ($id: ID!, $limit: Int!, $cols: [String!]) {
        boards(ids: [$id]) {
          groups {
            items(limit: $limit) {
              id name
              column_values(ids: $cols){ id text }
            }
          }
        }
      }`;
    const Q_GROUPS_INT = `
      query ($id: Int!, $limit: Int!, $cols: [String!]) {
        boards(ids: [$id]) {
          groups {
            items(limit: $limit) {
              id name
              column_values(ids: $cols){ id text }
            }
          }
        }
      }`;

    try {
      // 1) tenter items_page (ID → Int)
      let res = await monday.api(Q_ITEMS_PAGE_ID,  { variables: { id: String(BOARD_ID), limit: LIMIT, cols } });
      if (res?.errors?.length) {
        res = await monday.api(Q_ITEMS_PAGE_INT, { variables: { id: Number(BOARD_ID), limit: LIMIT, cols } });
      }

      // 2) fallback groups/items si items_page non dispo
      let raw = [];
      if (!res?.errors?.length) {
        raw = res?.data?.boards?.[0]?.items_page?.items || [];
      } else {
        let r2 = await monday.api(Q_GROUPS_ID,  { variables: { id: String(BOARD_ID), limit: LIMIT, cols } });
        if (r2?.errors?.length) {
          r2 = await monday.api(Q_GROUPS_INT, { variables: { id: Number(BOARD_ID), limit: LIMIT, cols } });
        }
        if (r2?.errors?.length) {
          const msg = (r2.errors || res.errors).map(e => e?.message).join(" | ");
          throw new Error(msg || "GraphQL validation errors");
        }
        raw = (r2?.data?.boards?.[0]?.groups || []).flatMap(g => g?.items || []);
      }

      // normalisation
      const normalized = (raw || []).map((it) => {
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

    // Construire l’index fournisseurs -> nb de lignes
    const idx = new Map();
    for (const it of normalized) {
      const name = (it.supplier || "").trim();
      if (!name) continue;
      idx.set(name, (idx.get(name) || 0) + 1);
    }
    const supplierIndex = [...idx]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));

    setSupplierIndex(supplierIndex);
    setSuppliers(supplierIndex.map((x) => x.name));

    // Si rien trouvé, on t’affiche les colonnes en debug
    if (supplierIndex.length === 0) {
      setError("Aucun fournisseur détecté dans les items.");
      setDebug(
        JSON.stringify(
          {
            supplierColId,
            sample: normalized.slice(0, 5),
            columns: allColumns,
          },
          null,
          2
        )
      );
    }
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
                  <div style={{display:"grid", gap:10}}>
                    {suppliers.map(s => (
                      <button
                        key={s}
                        className="ga-card pastel-grey"
                        onClick={()=>setSelectedSupplier(s)}
                        title={`Voir les lignes pour ${s}`}
                      >
                        <div className="ga-icon">🏷️</div>
                        <div className="ga-label">{s}</div>
                      </button>
                    ))}
                  </div>
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

