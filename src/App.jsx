import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();
const BUILD = "v10";

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");

  // 1) Contexte
  useEffect(() => {
    monday.listen("context", ({ data }) => setContext(data));
    monday.get("context").then(({ data }) => setContext((p) => p ?? data));
  }, []);

  // 2) Étape A: next_items_page -> IDs, Étape B: items(ids: …) -> détails
  useEffect(() => {
    const boardId = context?.boardId;
    if (!boardId) return;

    let cancelled = false;

    const qList = `
      query ($bids: [ID!]!, $limit: Int!) {
        next_items_page(limit: $limit, query_params: { board_ids: $bids }) {
          cursor
          items { id }
        }
      }
    `;
    const qItems = `
      query ($ids: [ID!]!) {
        items(ids: $ids) { id name }
      }
    `;

    (async () => {
      try {
        // A) récupérer la liste d'IDs du board
        const listRes = await monday.api(qList, {
          variables: { bids: [String(boardId)], limit: 50 },
        });
        if (cancelled) return;

        if (listRes?.errors?.length) {
          const msg = listRes.errors.map(e => e?.message).filter(Boolean).join(" | ");
          setError("Erreur API Monday (liste IDs): " + (msg || "GraphQL error"));
          setDebug(JSON.stringify({ step: "A next_items_page", errors: listRes.errors }, null, 2));
          setItems([]);
          return;
        }

        const ids = (listRes?.data?.next_items_page?.items ?? []).map(it => String(it.id));
        if (!ids.length) {
          setItems([]);
          setError("");
          setDebug(JSON.stringify({ step: "A next_items_page", idsCount: 0 }, null, 2));
          return;
        }

        // B) récupérer les détails via items(ids: …)
        const itemsRes = await monday.api(qItems, { variables: { ids } });
        if (cancelled) return;

        if (itemsRes?.errors?.length) {
          const msg = itemsRes.errors.map(e => e?.message).filter(Boolean).join(" | ");
          setError("Erreur API Monday (items par IDs): " + (msg || "GraphQL error"));
          setDebug(JSON.stringify({ step: "B items(ids)", errors: itemsRes.errors, ids }, null, 2));
          setItems([]);
          return;
        }

        const list = itemsRes?.data?.items ?? [];
        setItems(list);
        setError("");
        setDebug(JSON.stringify({ step: "OK", ids: ids.length, items: list.length }, null, 2));
      } catch (err) {
        if (cancelled) return;
        const msg = err?.message || err?.error_message || "Erreur inconnue";
        setError("Erreur API Monday: " + msg);
        setDebug(JSON.stringify(err, null, 2));
        setItems([]);
      }
    })();

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
