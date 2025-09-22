import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();
const BUILD = "v7"; // juste pour vérifier qu'on voit bien la dernière version

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

  // Boards → items (compat universelle avec ID string)
  useEffect(() => {
    const boardId = context?.boardId;
    if (!boardId) return;

    let cancelled = false;

    const query = `
      query ($ids: [ID!]!, $limit: Int!) {
        boards(ids: $ids) {
          id
          items(limit: $limit) { id name }
        }
      }
    `;

    monday.api(query, { variables: { ids: [String(boardId)], limit: 50 } })
      .then((res) => {
        if (cancelled) return;

        if (res?.errors?.length) {
          const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ");
          setError("Erreur API Monday: " + (msg || "GraphQL error"));
          setDebug(JSON.stringify({ step: "boards→items", errors: res.errors }, null, 2));
          setItems([]);
          return;
        }

        const list = res?.data?.boards?.[0]?.items ?? [];
        setItems(list);
        setError("");
        setDebug(JSON.stringify({ boardsReturned: res?.data?.boards?.length || 0, items: list.length }, null, 2));
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.message || err?.error_message || "Erreur inconnue";
        setError("Erreur API Monday: " + msg);
        setDebug(JSON.stringify(err, null, 2));
        setItems([]);
      });

    return () => { cancelled = true; };
  }, [context?.boardId]);

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", padding: 16 }}>
      <h1>✅ Intégration Monday (embarqué) — {BUILD}</h1>

      {!context && <p>Chargement du contexte…</p>}
      {context && (
        <p>
          <strong>Board ID :</strong> {String(context.boardId || "—")} ·{" "}
          <strong>Item ID :</strong> {String(context.itemId || "—")} ·{" "}
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

      {debug && (
        <details style={{ marginTop: 12 }}>
          <summary>Debug GraphQL</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{debug}</pre>
        </details>
      )}
    </div>
  );
}
