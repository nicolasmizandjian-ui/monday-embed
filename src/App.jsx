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
  const [supplierIndex, setSupplierIndex] = useState([]); // [{name,count}]
  const [supplierQuery, setSupplierQuery] = useState("");
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

  // Petite aide pour deviner la colonne "fournisseur"
  const guessSupplierCol = (columns) => {
    const norm = (s) => (s || "").toLowerCase();
    // 1) par titre
    let c =
      columns.find((c) => /fournisseur|supplier|vendor/.test(norm(c.title))) ||
      // 2) par id
      columns.find((c) => /fourni|supplier|vendor/.test(norm(c.id)));
    return c?.id || null;
  };

  // Requête: colonnes + items via groups -> items (compat cluster)
  const qID = `
    query ($id: ID!, $limit: Int!) {
      boards(ids: [$id]) {
        id
        name
        columns { id title type }
        groups {
          id
          title
          items(limit: $limit) {
            id
            name
            column_values { id text }
          }
        }
      }
    }`;
  const qINT = `
    query ($id: Int!, $limit: Int!) {
      boards(ids: [$id]) {
        id
        name
        columns { id title type }
        groups {
          id
          title
          items(limit: $limit) {
            id
            name
            column_values { id text }
          }
        }
      }
    }`;

  try {
    const vars = { limit: 200 };

    // 1) essai ID
    let res = await monday.api(qID, { variables: { ...vars, id: String(BOARD_ID) } });
    // 2) fallback Int
    if (res?.errors?.length) {
      res = await monday.api(qINT, { variables: { ...vars, id: Number(BOARD_ID) } });
      if (res?.errors?.length) throw new Error(res.errors.map((e) => e.message).join(" | "));
    }

    const board = res?.data?.boards?.[0];
    if (!board) throw new Error("Board introuvable (BOARD_ID incorrect ?)");

    // Déterminer la bonne colonne fournisseur
    const allColumns = board.columns || [];
    let supplierColId = COL_SUPPLIER; // ta constante en haut du fichier
    const exists = allColumns.some((c) => c.id === supplierColId);

    if (!exists) {
      supplierColId = guessSupplierCol(allColumns);
    }

    if (!supplierColId) {
      setError("Impossible de trouver la colonne fournisseur.");
      setDebug(
        JSON.stringify(
          {
            hint: "Vérifie l’ID via Monday > menu colonne > Developer info > Copy column ID",
            columns: allColumns,
          },
          null,
          2
        )
      );
      setLoading(false);
      return;
    }

    // Aplatir items de tous les groupes
    const rawItems = (board.groups || []).flatMap((g) => g.items || []);

    // Normaliser: on lit la colonne fournisseur détectée
    const normalized = rawItems.map((it) => {
      const map = Object.fromEntries((it.column_values || []).map((cv) => [cv.id, cv.text]));
      return {
        id: it.id,
        name: it.name,
        supplier: map[supplierColId] || "",
        // on garde tes 2 autres colonnes si tu veux les utiliser plus tard
        product: map[COL_PRODUCT] || it.name,
        qty: map[COL_QTY] || "",
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

                {!loading && supplierIndex.length === 0 && (
                  <p>Aucun fournisseur trouvé dans “ENTRÉES DE STOCK”. Vérifie COL_SUPPLIER.</p>
                )}

                {!loading && supplierIndex.length > 0 && (
                  <>
                    <input
                      className="ga-input"
                      placeholder="Rechercher un fournisseur…"
                      value={supplierQuery}
                      onChange={e => setSupplierQuery(e.target.value)}
                    />
                    <div className="ga-supplier-list">
                      {supplierIndex
                        .filter(s => s.name.toLowerCase().includes(supplierQuery.toLowerCase()))
                        .map((s) => (
                          <button
                            key={s.name}
                            className="ga-card pastel-grey"
                            onClick={() => setSelectedSupplier(s.name)}
                            title={`Voir les lignes pour ${s.name}`}
                            style={{justifyContent:"space-between"}}
                          >
                            <div style={{display:"flex", alignItems:"center", gap:12}}>
                              <div className="ga-icon">🏷️</div>
                              <div className="ga-label">{s.name}</div>
                            </div>
                            <span className="ga-badge">{s.count}</span>
                          </button>
                        ))}
                    </div>
                  </>
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

