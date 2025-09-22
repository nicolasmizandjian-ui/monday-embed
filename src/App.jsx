import React, { useEffect, useMemo, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();
const BUILD = "toolbar-6btn-v1";

export default function App() {
  const [context, setContext] = useState(null);
  const [boardName, setBoardName] = useState("");
  const [items, setItems] = useState([]); // {id,name,groupId}
  const [columns, setColumns] = useState([]); // {id,title,type}
  const [selected, setSelected] = useState(() => new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // === 1) Contexte Monday (board courant) ==============================
  useEffect(() => {
    monday.listen("context", ({ data }) => setContext(data));
    monday.get("context").then(({ data }) => setContext((p) => p ?? data));
  }, []);

  const boardId = context?.boardId ? String(context.boardId) : null;

  // === 2) Lecture du board courant: columns + groups.items =============
  const fetchBoard = async () => {
    if (!boardId) return;
    setBusy(true);
    setError("");
    try {
      const query = `
        query ($id: ID!, $limit: Int!) {
          boards(ids: [$id]) {
            id
            name
            columns { id title type }
            groups {
              id
              title
              items(limit: $limit) { id name }
            }
          }
        }
      `;
      const res = await monday.api(query, { variables: { id: boardId, limit: 200 } });
      if (res?.errors?.length) {
        const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ");
        throw new Error(msg || "GraphQL error");
      }
      const b = res?.data?.boards?.[0];
      setBoardName(b?.name || "");
      setColumns(b?.columns || []);
      const list = (b?.groups || []).flatMap(g =>
        (g?.items || []).map(it => ({ id: String(it.id), name: it.name, groupId: g.id }))
      );
      setItems(list);
    } catch (e) {
      setError("Erreur API Monday (lecture board): " + (e?.message || "inconnue"));
      setItems([]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { fetchBoard(); /* au mount + quand board change */ }, [boardId]);

  // === 3) Sélection ====================================================
  const allSelected = useMemo(
    () => items.length > 0 && selected.size === items.length,
    [items, selected]
  );
  const toggleOne = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected(prev => {
      if (prev.size === items.length) return new Set();
      return new Set(items.map(it => it.id));
    });
  };

  // === 4) Utils visibles immédiatement ================================
  const exportCSV = () => {
    const rows = [["id", "name"]];
    const pool = selected.size ? items.filter(it => selected.has(it.id)) : items;
    pool.forEach(it => rows.push([it.id, it.name]));
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `board-${boardId}-items.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  // === 5) COLONNES (à personnaliser) ===================================
  // 👉 Renseigne ici les IDs de colonnes de TON board si tu veux activer les boutons statut/date :
  const statusColId = useMemo(
    () => columns.find(c => c.type === "status")?.id || "status",
    [columns]
  );
  const dateColId = useMemo(
    () => columns.find(c => c.type === "date")?.id || "date",
    [columns]
  );

  // === 6) ACTIONS — 6 boutons ==========================================
  // A) Créer un item (brouillon) dans le premier groupe
  const actionCreate = async () => {
    if (!boardId) return;
    try {
      setBusy(true); setError("");
      const firstGroupId = items[0]?.groupId || "topics"; // fallback "topics"
      // ⚠️ Sur certains comptes, les mutations exigent Int pour board_id.
      // Si une erreur survient, dis-moi l’erreur exacte et je te fournis la variante compatible.
      const mutation = `
        mutation ($board: ID!, $group: String!, $name: String!) {
          create_item (board_id: $board, group_id: $group, item_name: $name) { id }
        }
      `;
      const res = await monday.api(mutation, {
        variables: { board: boardId, group: firstGroupId, name: "Nouvelle intervention" }
      });
      if (res?.errors?.length) {
        throw new Error(res.errors.map(e => e?.message).join(" | ") || "GraphQL error");
      }
      await fetchBoard();
    } catch (e) {
      setError("Création échouée: " + (e?.message || "inconnue"));
    } finally {
      setBusy(false);
    }
  };

  // B) Planifier aujourd’hui (date) — sur la sélection (ou tout si rien sélectionné)
  const actionPlanToday = async () => {
    if (!boardId) return;
    const target = selected.size ? items.filter(it => selected.has(it.id)) : items;
    if (!target.length) return;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    try {
      setBusy(true); setError("");
      // Mutation générique (peut nécessiter Int pour board_id sur certains clusters)
      const mutation = `
        mutation ($board: ID!, $item: ID!, $col: String!, $val: JSON!) {
          change_column_value (board_id: $board, item_id: $item, column_id: $col, value: $val) {
            id
          }
        }
      `;
      for (const it of target) {
        const variables = {
          board: boardId,
          item: it.id,
          col: dateColId,
          val: JSON.stringify({ date: today })
        };
        const res = await monday.api(mutation, { variables });
        if (res?.errors?.length) throw new Error(res.errors.map(e => e?.message).join(" | "));
      }
      await fetchBoard();
    } catch (e) {
      setError("Planification échouée: " + (e?.message || "inconnue"));
    } finally {
      setBusy(false);
    }
  };

  // C) Marquer "En cours" (status)
  const actionMarkInProgress = async () => {
    await changeStatusLabel("En cours"); // 👉 adapte le libellé si besoin
  };

  // D) Marquer "Terminé" (status)
  const actionMarkDone = async () => {
    await changeStatusLabel("Terminé");  // 👉 adapte le libellé si besoin
  };

  // Helper statut
  const changeStatusLabel = async (label) => {
    if (!boardId) return;
    const target = selected.size ? items.filter(it => selected.has(it.id)) : items;
    if (!target.length) return;
    try {
      setBusy(true); setError("");
      const mutation = `
        mutation ($board: ID!, $item: ID!, $col: String!, $val: JSON!) {
          change_column_value (board_id: $board, item_id: $item, column_id: $col, value: $val) { id }
        }
      `;
      for (const it of target) {
        const variables = {
          board: boardId,
          item: it.id,
          col: statusColId,
          val: JSON.stringify({ label })
        };
        const res = await monday.api(mutation, { variables });
        if (res?.errors?.length) throw new Error(res.errors.map(e => e?.message).join(" | "));
      }
      await fetchBoard();
    } catch (e) {
      setError(`Changement de statut "${label}" échoué: ` + (e?.message || "inconnue"));
    } finally {
      setBusy(false);
    }
  };

  // E) Dupliquer les items sélectionnés
  const actionDuplicate = async () => {
    if (!boardId) return;
    const target = selected.size ? items.filter(it => selected.has(it.id)) : [];
    if (!target.length) return;
    try {
      setBusy(true); setError("");
      const mutation = `
        mutation ($item: ID!) {
          duplicate_item (item_id: $item) { id }
        }
      `;
      for (const it of target) {
        const res = await monday.api(mutation, { variables: { item: it.id } });
        if (res?.errors?.length) throw new Error(res.errors.map(e => e?.message).join(" | "));
      }
      await fetchBoard();
    } catch (e) {
      setError("Duplication échouée: " + (e?.message || "inconnue"));
    } finally {
      setBusy(false);
    }
  };

  // F) Rafraîchir
  const actionRefresh = async () => { await fetchBoard(); };

  // === Rendu ===========================================================
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", padding: 16 }}>
      <h1>Gestion Atelier — {boardName || "Board"} <small style={{opacity:.6}}>({BUILD})</small></h1>

      <p style={{marginTop:4}}>
        <strong>Board ID :</strong> {boardId || "—"}
      </p>

      {/* Barre d’actions — 6 boutons */}
      <div style={{display:"flex", gap:8, flexWrap:"wrap", margin:"12px 0"}}>
        <button onClick={actionCreate} disabled={busy}>➕ Nouvelle intervention</button>
        <button onClick={actionPlanToday} disabled={busy}>📅 Planifier aujourd’hui</button>
        <button onClick={actionMarkInProgress} disabled={busy}>🚧 Marquer “En cours”</button>
        <button onClick={actionMarkDone} disabled={busy}>✅ Clôturer (Terminé)</button>
        <button onClick={actionDuplicate} disabled={busy || selected.size===0}>🧬 Dupliquer la sélection</button>
        <button onClick={exportCSV} disabled={busy}>⬇️ Export CSV</button>
        <button onClick={actionRefresh} disabled={busy}>🔄 Rafraîchir</button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {/* Liste + sélection */}
      <div style={{marginTop:8}}>
        <label style={{display:"inline-flex",alignItems:"center",gap:6,marginBottom:8}}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
        </label>

        {!items.length && !error && <p style={{opacity:.7}}>Aucun item trouvé.</p>}

        <ul style={{listStyle:"none", padding:0}}>
          {items.map(it => (
            <li key={it.id} style={{display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:"1px solid #eee"}}>
              <input
                type="checkbox"
                checked={selected.has(it.id)}
                onChange={() => toggleOne(it.id)}
              />
              <span style={{minWidth:80, opacity:.7}}>#{it.id}</span>
              <span>{it.name}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
