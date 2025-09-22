import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();
const BUILD = "v11"; // vérifie dans le titre que c'est bien cette version

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");

  // 1) Contexte (écoute + fallback)
  useEffect(() => {
    monday.listen("context", ({ data }) => setContext(data));
    monday.get("context")
      .then(({ data }) => setContext((prev) => prev ?? data))
      .catch((e) => setError("Erreur contexte: " + (e?.message || e)));
  }, []);

  // 2) Appel initial: Board.items_page (→ donne items + cursor)
  useEffect(() => {
    const boardId = context?.boardId;
    if (!boardId) return;

    let cancelled = false;

    const query = `
      query ($ids: [ID!]!, $limit: Int!) {
        boards(ids: $ids) {
          id
          items_page(limit: $limit) {
            cursor
            items { id name }
          }
        }
      }
    `;

    monday.api(query, { variables: { ids: [String(boardId)], limit: 50 } })
      .then((res) => {
        if (cancelled) return;

        if (res?.errors?.length) {
          const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ");
          setError("Erreur API Monday: " + (msg || "GraphQL error"));
          setDebug(JSON.stringify({ step: "boards.items_page", errors: res.errors }, null, 2));
          setItems([]);
          return;
        }

        const page = res?.data?.boards?.[0]?.items_page;
        const list = page?.items ?? [];
        setItems(list);
        setError("");
        // on affiche le cursor pour enchaîner si besoin avec next_items_page(cursor)
        setDebug(JSON.stringify({ cursor: page?.cursor || null, items: list.length }, null, 2));
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
          <h2>Items (max 50)</h2>
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
