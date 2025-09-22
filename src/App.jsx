import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  // Contexte (écoute + fallback)
  useEffect(() => {
    monday.listen("context", ({ data }) => { setContext(data); setError(""); });
    monday.get("context").then(({ data }) => setContext((p) => p ?? data))
      .catch((e) => setError("Erreur contexte: " + (e?.message || e)));
  }, []);

  // Utilitaire pour logguer les erreurs lisibles
  const run = async (label, query, variables) => {
    const res = await monday.api(query, { variables });
    if (res?.errors?.length) {
      const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ") || "GraphQL validation errors";
      throw new Error(`[${label}] ${msg}`);
    }
    return res.data;
  };

// Charger les items du board (schema-agnostic)
useEffect(() => {
  const boardId = context?.boardId;
  if (!boardId) return;

  let cancelled = false;

  const query = `
    query ($bids: [ID!]!, $limit: Int!) {
      items_page(limit: $limit, query_params: { board_ids: $bids }) {
        items { id name }
      }
    }
  `;

  monday
    .api(query, { variables: { bids: [String(boardId)], limit: 50 } })
    .then((res) => {
      if (cancelled) return;
      if (res?.errors?.length) {
        const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ");
        setError("Erreur API Monday: " + (msg || "GraphQL error"));
        setItems([]);
        return;
      }
      setItems(res?.data?.items_page?.items ?? []);
      setError("");
    })
    .catch((err) => {
      if (cancelled) return;
      const msg =
        err?.error_message ||
        err?.message ||
        (Array.isArray(err?.errors) && err.errors.map(e => e?.message).join(" | ")) ||
        "Erreur inconnue";
      setError("Erreur API Monday: " + msg);
      setItems([]);
    });

  return () => { cancelled = true; };
}, [context?.boardId]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 16 }}>
      <h1>✅ Intégration Monday (embarqué)</h1>

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
      {!items.length && context?.boardId && !error && (
        <p>Aucun item trouvé (ou droits manquants).</p>
      )}
    </div>
  );
}
