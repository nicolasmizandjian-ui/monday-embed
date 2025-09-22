import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");

  // Contexte
  useEffect(() => {
    monday.listen("context", ({ data }) => setContext(data));
    monday.get("context").then(({ data }) => setContext((p) => p ?? data));
  }, []);

  // Helper: exécute une requête et log
  const run = async (label, query, variables) => {
    const res = await monday.api(query, { variables });
    // trace console + stocke le dernier résultat pour affichage
    console.log(label, { variables, res });
    if (res?.errors?.length) {
      setDebug(
        `${label}\n` +
        JSON.stringify({ variables, errors: res.errors }, null, 2)
      );
      throw new Error(
        res.errors.map(e => e?.message).filter(Boolean).join(" | ") ||
        "GraphQL validation errors"
      );
    }
    setDebug(`${label}\n${JSON.stringify(res.data, null, 2)}`);
    return res.data;
  };

// Chargement items avec fallbacks (A → B? → C → D)
useEffect(() => {
  const boardId = context?.boardId;
  const workspaceId = context?.workspaceId;
  if (!boardId) return;

  const bidStr = String(boardId);
  const widNum = Number(workspaceId);
  const hasWid = Number.isInteger(widNum);

  let cancelled = false;

  (async () => {
    try {
      // A) items_page_by_board
      const qA = `
        query ($bid: ID!, $limit: Int!) {
          items_page_by_board(board_id: $bid, limit: $limit) {
            items { id name }
          }
        }`;
      let data = await run("A: items_page_by_board", qA, { bid: bidStr, limit: 50 });
      setItems(data?.items_page_by_board?.items ?? []);
      setError("");
      return;
    } catch {}

    try {
      // B) items_page filtré par workspace (seulement si wid valide)
      if (!hasWid) throw new Error("skip B (no workspaceId)");
      const qB = `
        query ($wid: Int!, $limit: Int!) {
          items_page(limit: $limit, query_params: { workspace_ids: [$wid] }) {
            items { id name board { id } }
          }
        }`;
      const data = await run("B: items_page (workspace filter)", qB, { wid: widNum, limit: 50 });
      let list = data?.items_page?.items ?? [];
      list = list.filter(it => String(it.board?.id) === bidStr).map(({ id, name }) => ({ id, name }));
      setItems(list);
      setError("");
      return;
    } catch {}

    try {
      // C) items_page sans filtre + filtrage JS
      const qC = `
        query ($limit: Int!) {
          items_page(limit: $limit) {
            items { id name board { id } }
          }
        }`;
      const data = await run("C: items_page (no filter)", qC, { limit: 50 });
      let list = data?.items_page?.items ?? [];
      list = list.filter(it => String(it.board?.id) === bidStr).map(({ id, name }) => ({ id, name }));
      if (list.length) {
        setItems(list);
        setError("");
        return;
      }
    } catch {}

    try {
      // D) boards(ids: …) ultra compatible
      const qD = `
        query ($bids: [ID!]!, $limit: Int!) {
          boards(ids: $bids) {
            items (limit: $limit) { id name }
          }
        }`;
      const data = await run("D: boards → items(limit)", qD, { bids: [bidStr], limit: 50 });
      const list = data?.boards?.[0]?.items ?? [];
      setItems(list);
      setError("");
    } catch (e) {
      if (cancelled) return;
      setError("Erreur API Monday: " + (e?.message || "inconnue"));
      setItems([]);
    }
  })();

  return () => { cancelled = true; };
}, [context?.boardId, context?.workspaceId]);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1>✅ Intégration Monday (embarqué)</h1>

      {!context && <p>Chargement du contexte…</p>}
      {context && (
        <p>
          <strong>Board ID :</strong> {String(context.boardId || "—")}
          {" · "}
          <strong>Item ID :</strong> {String(context.itemId || "—")}
          {" · "}
          <strong>Workspace ID :</strong> {String(context.workspaceId || "—")}
        </p>
      )}

      {!!items.length && (
        <>
          <h2>Items (50 max)</h2>
          <ul>{items.map(it => <li key={it.id}>{it.id} — {it.name}</li>)}</ul>
        </>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {/* bloc debug pour voir l’erreur exacte */}
      {debug && (
        <details style={{ marginTop: 16 }}>
          <summary>Debug GraphQL</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{debug}</pre>
        </details>
      )}
    </div>
  );
}
