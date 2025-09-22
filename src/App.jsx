// src/App.jsx
import React, { useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";
// (facultatif) si tu as un App.css déjà en place :
// import "./App.css";

const monday = mondaySdk();

/** ──────────────────────────────────────────────────────────────────────
 *  CONFIG — adapte simplement ces IDs à ton board “ENTRÉES DE STOCK”
 *  - BOARD_ID: l’ID du board Entrées de Stock
 *  - COL_*   : les IDs des colonnes utilisées dans la modale
 *  (tu peux les lire dans Monday > colonne > "Column ID")
 *  ──────────────────────────────────────────────────────────────────── */
const BOARD_ID     = "7678082330";   // Entrées de Stock
const COL_SUPPLIER = "texte9";       // FOURNISSEUR
const COL_PRODUCT  = "texte2";       // Description produit
const COL_QTY      = "quantit__produit"; // Quantité produit

export default function App() {
  const [showStockModal, setShowStockModal]     = useState(false);
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState("");

  // Données chargées depuis le board “Entrées de Stock”
  const [items, setItems]                       = useState([]); // [{id,name,supplier,product,qty}]
  const [suppliers, setSuppliers]               = useState([]); // ["Fournisseur A", ...]
  const [selectedSupplier, setSelectedSupplier] = useState("");

  /** Palette pastel (fallback inline au cas où tu n’utilises pas de CSS) */
  const pastel = {
    "pastel-green":  { background: "#E8F5E9", border: "1px solid #C8E6C9" },
    "pastel-blue":   { background: "#E3F2FD", border: "1px solid #BBDEFB" },
    "pastel-purple": { background: "#F3E5F5", border: "1px solid #E1BEE7" },
    "pastel-orange": { background: "#FFF3E0", border: "1px solid #FFE0B2" },
    "pastel-yellow": { background: "#FFFDE7", border: "1px solid #FFF59D" },
    "pastel-red":    { background: "#FFEBEE", border: "1px solid #FFCDD2" },
    "pastel-grey":   { background: "#F5F5F5", border: "1px solid #E0E0E0" },
  };

  /** Tes 6 boutons */
  const actions = [
    { key: "decoupe",     label: "Lancer une découpe",         color: "pastel-green",  icon: "✂️" },
    { key: "nettoyage",   label: "Lancer un nettoyage",        color: "pastel-blue",   icon: "🧽" },
    { key: "assemblage",  label: "Lancer un assemblage",       color: "pastel-purple", icon: "🛠️" },
    { key: "confection",  label: "Lancer une confection",      color: "pastel-orange", icon: "🧵" },
    { key: "stock_in",    label: "Mettre en stock (réception)",color: "pastel-yellow", icon: "📦" },
    { key: "stock_out",   label: "Oups, retirer du stock",     color: "pastel-red",    icon: "⚠️" },
  ];

  /** Gestion clics — seul “Mettre en stock” ouvre la modale pour l’instant */
  function handleClick(a) {
    if (a.key === "stock_in") {
      openStockModal();
    } else {
      alert(`🛠️ Bientôt : ${a.label}`);
    }
  }

  /** Ouvre la modale et charge le board “Entrées de Stock”
   *  Compatible clusters : boards(ID) → groups → items, fallback Int.
   */
  async function openStockModal() {
    setShowStockModal(true);
    setSelectedSupplier("");
    setLoading(true);
    setError("");
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

      // 1) Essai en ID
      let res = await monday.api(qID,  { variables: { ...vars, id: String(BOARD_ID) } });
      // 2) Fallback en Int si le cluster l’exige
      if (res?.errors?.length) {
        res = await monday.api(qINT, { variables: { ...vars, id: Number(BOARD_ID) } });
        if (res?.errors?.length) throw new Error(res.errors.map(e => e.message).join(" | "));
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
      setError("Erreur GraphQL: " + (e?.message || "inconnue"));
    } finally {
      setLoading(false);
    }
  }

  /** Lignes du fournisseur sélectionné */
  const supplierLines = useMemo(() => {
    if (!selectedSupplier) return [];
    return items.filter(it => it.supplier === selectedSupplier);
  }, [items, selectedSupplier]);

  /** UI */
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", padding: 16 }}>
      {/* Topbar */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>⚙️ Gestion atelier</h1>
        <button
          style={{ padding:"8px 12px", borderRadius:10, border:"1px solid #ddd", background:"#fff", cursor:"pointer" }}
          onClick={() => alert("Config à venir")}
        >
          Configurer
        </button>
      </div>

      {/* Grille d’actions (6 boutons pastel) */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(220px, 1fr))", gap: 10 }}>
        {actions.map(a => (
          <button
            key={a.key}
            onClick={() => handleClick(a)}
            style={{
              textAlign:"left",
              borderRadius:12,
              padding:"14px 14px",
              cursor:"pointer",
              display:"flex",
              alignItems:"center",
              gap:12,
              ...pastel[a.color],
            }}
            title={a.label}
          >
            <div style={{ fontSize: 22, lineHeight: "22px" }}>{a.icon}</div>
            <div style={{ fontWeight: 600 }}>{a.label}</div>
          </button>
        ))}
      </div>

      {/* Erreur globale éventuelle */}
      {error && <p style={{ color:"crimson", marginTop: 10 }}>{error}</p>}

      {/* MODALE: “Mettre en stock (réception)” */}
      {showStockModal && (
        <div
          onClick={() => setShowStockModal(false)}
          style={{
            position:"fixed", inset:0, background:"rgba(0,0,0,.1)",
            display:"grid", placeItems:"center", zIndex: 10
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width:"min(800px, 92vw)", maxHeight:"80vh", overflow:"auto",
              background:"#fff", borderRadius:16, border:"1px solid #eee", padding:18, boxShadow:"0 10px 30px rgba(0,0,0,.08)"
            }}
          >
            {!selectedSupplier ? (
              <>
                <h2 style={{ marginTop: 0 }}>📦 Sélectionne un fournisseur</h2>
                {loading && <p>Chargement…</p>}

                {!loading && suppliers.length === 0 && (
                  <p>Aucun fournisseur trouvé dans “ENTRÉES DE STOCK”.</p>
                )}

                {!loading && suppliers.length > 0 && (
                  <div style={{ display:"grid", gap:10 }}>
                    {suppliers.map(s => (
                      <button
                        key={s}
                        onClick={() => setSelectedSupplier(s)}
                        style={{
                          textAlign:"left", borderRadius:12, padding:"14px 14px", cursor:"pointer",
                          display:"flex", alignItems:"center", gap:12, ...pastel["pastel-grey"]
                        }}
                        title={`Voir les lignes pour ${s}`}
                      >
                        <div style={{ fontSize: 20 }}>🏷️</div>
                        <div style={{ fontWeight: 600 }}>{s}</div>
                      </button>
                    ))}
                  </div>
                )}

                <div style={{ display:"flex", gap:8, marginTop:12 }}>
                  <button
                    onClick={() => setShowStockModal(false)}
                    style={{ padding:"8px 12px", borderRadius:10, border:"1px solid #ddd", background:"#fff", cursor:"pointer" }}
                  >
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
                  <div style={{ maxHeight: 380, overflow:"auto", display:"grid", gap:10 }}>
                    {supplierLines.map(ln => (
                      <div key={ln.id} style={{
                        borderRadius:12, padding:"12px 12px", display:"flex", alignItems:"center", gap:12,
                        ...pastel["pastel-grey"], cursor:"default"
                      }}>
                        <div style={{ fontSize: 18 }}>📦</div>
                        <div style={{ display:"grid" }}>
                          <div style={{ fontWeight: 600 }}>{ln.product || "(Sans description)"}</div>
                          <div style={{ fontSize: 13, opacity:.85 }}>
                            Qté prévue : {ln.qty || "—"} &nbsp;•&nbsp; Item #{ln.id}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display:"flex", gap:8, marginTop:12 }}>
                  <button
                    onClick={() => setSelectedSupplier("")}
                    style={{ padding:"8px 12px", borderRadius:10, border:"1px solid #ddd", background:"#fff", cursor:"pointer" }}
                  >
                    ⬅︎ Retour fournisseurs
                  </button>
                  <button
                    onClick={() => setShowStockModal(false)}
                    style={{ padding:"8px 12px", borderRadius:10, border:"1px solid #ddd", background:"#fff", cursor:"pointer" }}
                  >
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
