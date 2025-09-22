import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");

  // 1) Contexte (écoute + fallback)
  useEffect(() => {
    monday.listen("context", ({ data }) => setContext(data));
    monday
      .get("context")
      .then(({ data }) => setContext((prev) => prev ?? data))
      .catch((e) => setError("Erreur contexte: " + (e?.message || e)));
  }, []);

  // 2) Charger les items via boards(ids: [ID!]) { items }
useEffect(() => {
  const boardId = context?.boardId;
  if (!boardId) return;

  let cancelled = false;

  const query = `
    query ($ids: [ID!]!, $limit: Int!) {
      boards(ids: $ids) {
        items(limit: $limit) { id name }
      }
    }
  `;

  monday.api(query, { variables: { ids: [String(boardId)], limit: 50 } })
    .then(res => {
      if (cancelled) return;
      if (res?.errors?.length) {
        const msg = res.errors.map(e => e?.message).join(" | ");
        setError("Erreur API Monday: " + (msg || "GraphQL error"));
        setItems([]);
        return;
      }
      setItems(res?.data?.boards?.[0]?.items ?? []);
      setError("");
    })
    .catch(err => {
      if (cancelled) return;
      setError("Erreur API Monday: " + (err?.message || "inconnue"));
      setItems([]);
    });

  return () => { cancelled = true; };
}, [context?.boardId]);

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", padding: 16 }}>
      <h1>✅ Intégration Monday (embarqué)</h1>

      {!context && <p>Chargement du contexte…</p>}
      {context && (
        <p>
          <strong>Board ID :</strong> {String(context.boardId || "—")}{" · "}
          <strong>Item ID :</strong> {String(context.itemId || "—")}{" · "}
          <strong>Workspace ID :</strong> {String(context.workspaceId || "—")}
        </p>
      )}

      {!!items.length && (
        <>
          <h2>Items (50 max)</h2>
          <ul>
            {items.map((it) => (
              <li key={it.id}>{it.id} — {it.name}</li>
            ))}
          </ul>
        </>
      )}

      {error && <p style={{ color: "crimson", marginTop: 8 }}>{error}</p>}
      {!items.length && context?.boardId && !error && (
        <p style={{ opacity: 0.7 }}>Aucun item trouvé (ou droits manquants).</p>
      )}

      {debug && (
        <details style={{ marginTop: 12 }}>
          <summary>Debug GraphQL</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{debug}</pre>
        </details>
      )}
    </div>
  );
}
