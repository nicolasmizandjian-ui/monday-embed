import React, { useEffect, useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();
const BUILD = "atelier-6btn-v1";

// --- Config persistée (localStorage) -----------------------------------
const loadCfg = () => {
  try { return JSON.parse(localStorage.getItem("atelierCfg") || "{}"); }
  catch { return {}; }
};
const saveCfg = (cfg) => localStorage.setItem("atelierCfg", JSON.stringify(cfg));

export default function App() {
  const [context, setContext] = useState(null);
  const [boardName, setBoardName] = useState("");
  const [items, setItems] = useState([]);     // {id,name,groupId}
  const [columns, setColumns] = useState([]); // {id,title,type}
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const [cfg, setCfg] = useState(() => ({
    phaseColId: loadCfg().phaseColId || "status", // colonne statut “phase”
    stockColId: loadCfg().stockColId || "numbers", // colonne nombre “stock”
  }));

  // --- Contexte Monday --------------------------------------------------
  useEffect(() => {
    monday.listen("context", ({ data }) => setContext(data));
    monday.get("context").then(({ data }) => setContext((p) => p ?? data));
  }, []);
  const boardId = context?.boardId ? String(context.boardId) : null;

  // --- Lecture du board (robuste: A → B → C) ----------------------------
  const fetchBoard = async () => {
    if (!boardId) return;
    setBusy(true); setError(""); setDebug("");
    const tries = [];

    // A) ID avec colonnes
    tries.push({
      label: "A boards(ID) columns + groups.items",
      q: `
        query ($id: ID!, $limit: Int!) {
          boards(ids: [$id]) {
            id name
            columns { id title type }
            groups { id title items(limit: $limit) { id name } }
          }
        }
      `,
      v: { id: boardId, limit: 200 },
      pick: (d) => {
        const b = d?.boards?.[0];
        return {
          name: b?.name || "",
          cols: b?.columns || [],
          its: (b?.groups || []).flatMap(g => (g?.items || []).map(it => ({ id: String(it.id), name: it.name, groupId: g.id })))
        };
      }
    });

    // B) INT avec colonnes (certains clusters)
    const boardIdInt = Number(boardId);
    if (Number.isFinite(boardIdInt)) {
      tries.push({
        label: "B boards(Int) columns + groups.items",
        q: `
          query ($id: Int!, $limit: Int!) {
            boards(ids: [$id]) {
              id name
              columns { id title type }
              groups { id title items(limit: $limit) { id name } }
            }
          }
        `,
        v: { id: boardIdInt, limit: 200 },
        pick: (d) => {
          const b = d?.boards?.[0];
          return {
            name: b?.name || "",
            cols: b?.columns || [],
            its: (b?.groups || []).flatMap(g => (g?.items || []).map(it => ({ id: String(it.id), name: it.name, groupId: g.id })))
          };
        }
      });
    }

    // C) Minimal (ID)
    tries.push({
      label: "C boards(ID) groups.items",
      q: `
        query ($id: ID!, $limit: Int!) {
          boards(ids: [$id]) {
            id name
            groups { id title items(limit: $limit) { id name } }
          }
        }
      `,
      v: { id: boardId, limit: 200 },
      pick: (d) => {
        const b = d?.boards?.[0];
        return {
          name: b?.name || "",
          cols: [],
          its: (b?.groups || []).flatMap(g => (g?.items || []).map(it => ({ id: String(it.id), name: it.name, groupId: g.id })))
        };
      }
    });

    const failures = [];
    for (const t of tries) {
      try {
        const res = await monday.api(t.q, { variables: t.v });
        if (res?.errors?.length) { failures.push({ step: t.label, errors: res.errors }); continue; }
        const p = t.pick(res?.data);
        setBoardName(p.name); setColumns(p.cols); setItems(p.its);
        setDebug(JSON.stringify({ step: t.label, items: p.its.length, columns: p.cols.length }, null, 2));
        setBusy(false); return;
      } catch (e) { failures.push({ step: t.label, error: e?.message || String(e) }); }
    }
    setError("Erreur API Monday (lecture board): GraphQL validation errors");
    setDebug(JSON.stringify({ failures }, null, 2));
    setItems([]); setBusy(false);
  };

  useEffect(() => { fetchBoard(); }, [boardId]);

  // --- Sélection --------------------------------------------------------
  const allSelected = useMemo(() => items.length > 0 && selected.size === items.length, [items, selected]);
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(prev => (prev.size === items.length ? new Set() : new Set(items.map(it => it.id))));

  // --- Helpers mutations ------------------------------------------------
  const changeStatusLabel = async (itemIds, columnId, label) => {
    const mutation = `
      mutation ($board: ID!, $item: ID!, $col: String!, $val: JSON!) {
        change_column_value (board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
      }
    `;
    for (const id of itemIds) {
      const res = await monday.api(mutation, {
        variables: { board: boardId, item: id, col: columnId, val: JSON.stringify({ label }) }
      });
      if (res?.errors?.length) throw new Error(res.errors.map(e => e?.message).join(" | "));
    }
  };

  // lecture du nombre actuel puis incrément
  const adjustNumber = async (itemIds, columnId, delta) => {
    const q = `
      query ($ids: [ID!]!, $col: [String!]) {
        items(ids: $ids) { id column_values(ids: $col) { id text } }
      }
    `;
    const m = `
      mutation ($board: ID!, $item: ID!, $col: String!, $val: String!) {
        change_column_value (board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
      }
    `;
    const read = await monday.api(q, { variables: { ids: itemIds, col: [columnId] } });
    if (read?.errors?.length) throw new Error(read.errors.map(e => e?.message).join(" | "));
    const map = new Map();
    for (const it of (read?.data?.items || [])) {
      const cv = (it?.column_values || [])[0];
      const cur = Number(cv?.text?.replace(",", ".") || 0);
      map.set(String(it.id), Number.isFinite(cur) ? cur : 0);
    }
    for (const id of itemIds) {
      const next = (map.get(String(id)) || 0) + delta;
      const res = await monday.api(m, { variables: { board: boardId, item: id, col: columnId, val: String(next) } });
      if (res?.errors?.length) throw new Error(res.errors.map(e => e?.message).join(" | "));
    }
  };

  const targets = () => (selected.size ? items.filter(it => selected.has(it.id)).map(it => it.id) : items.map(it => it.id));

  // --- Boutons “Gestion atelier” ---------------------------------------
  const runPhase = async (label) => {
    try { setBusy(true); setError(""); await changeStatusLabel(targets(), cfg.phaseColId, label); await fetchBoard(); }
    catch (e) { setError(`Action phase "${label}" échouée: ` + (e?.message || "inconnue")); }
    finally { setBusy(false); }
  };

  const stockDelta = async (delta) => {
    try { setBusy(true); setError(""); await adjustNumber(targets(), cfg.stockColId, delta); await fetchBoard(); }
    catch (e) { setError(`Mouvement de stock (${delta>0?"+":"-"}): ` + (e?.message || "inconnue")); }
    finally { setBusy(false); }
  };

  // --- Rendu ------------------------------------------------------------
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", padding: 16 }}>
      <div style={{display:"flex", alignItems:"center", gap:12, justifyContent:"space-between"}}>
        <h1 style={{margin:0}}>⚙️ Gestion atelier <small style={{opacity:.6}}>({BUILD})</small></h1>
        <button onClick={() => setShowCfg(s => !s)}>Configurer</button>
      </div>

      {showCfg && (
        <div style={{margin:"12px 0", padding:12, border:"1px solid #ddd", borderRadius:8}}>
          <div style={{display:"grid", gap:8, gridTemplateColumns:"200px 1fr", alignItems:"center"}}>
            <label>Colonne “Phase” (status):</label>
            <input value={cfg.phaseColId} onChange={e=>setCfg({...cfg, phaseColId:e.target.value.trim()})} />
            <label>Colonne “Stock” (numbers):</label>
            <input value={cfg.stockColId} onChange={e=>setCfg({...cfg, stockColId:e.target.value.trim()})} />
          </div>
          <div style={{marginTop:8, display:"flex", gap:8}}>
            <button onClick={()=>{ saveCfg(cfg); setShowCfg(false); }}>💾 Enregistrer</button>
            <button onClick={()=>{ const next={phaseColId:"status",stockColId:"numbers"}; setCfg(next); saveCfg(next); }}>↺ Réinitialiser</button>
          </div>
          {!!columns.length && (
            <p style={{marginTop:8, fontSize:12, opacity:.8}}>
              Colonnes détectées : {columns.map(c=>`${c.id}(${c.type})`).join(", ")}
            </p>
          )}
        </div>
      )}

      <p style={{margin:"6px 0 12px"}}><strong>Board ID :</strong> {boardId || "—"} — <em>{boardName}</em></p>

      {/* Tes 6 boutons */}
      <div style={{display:"grid", gridTemplateColumns:"repeat(3, minmax(220px, 1fr))", gap:8, marginBottom:12}}>
        <button disabled={busy} onClick={()=>runPhase("Découpe")}>✂️ Lancer une découpe</button>
        <button disabled={busy} onClick={()=>runPhase("Nettoyage")}>🧽 Lancer un nettoyage</button>
        <button disabled={busy} onClick={()=>runPhase("Assemblage")}>🛠️ Lancer un assemblage</button>

        <button disabled={busy} onClick={()=>runPhase("Confection")}>🧵 Lancer une confection</button>
        <button disabled={busy} onClick={()=>stockDelta(+1)}>📦 Mettre en stock</button>
        <button disabled={busy} onClick={()=>stockDelta(-1)}>⚠️ Oups retirer du stock</button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {debug && (
        <details style={{ marginTop: 8 }}>
          <summary>Debug</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{debug}</pre>
        </details>
      )}

      {/* Sélection + liste */}
      <div style={{marginTop:8}}>
        <label style={{display:"inline-flex",alignItems:"center",gap:6,marginBottom:8}}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </label>

        {!items.length && !error && <p style={{opacity:.7}}>Aucun item trouvé.</p>}

        <ul style={{listStyle:"none", padding:0}}>
          {items.map(it => (
            <li key={it.id} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid #eee"}}>
              <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggleOne(it.id)} />
              <span style={{minWidth:80, opacity:.7}}>#{it.id}</span>
              <span>{it.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
