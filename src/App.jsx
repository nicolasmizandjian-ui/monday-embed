import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  
useEffect(() => {
  const boardId = context?.boardId;
  if (!boardId) return;

  const query = `
    query ($boardId: ID!, $limit: Int!) {
      items_page_by_board(board_id: $boardId, limit: $limit) {
        cursor
        items { id name }
      }
    }
  `;

  monday
    .api(query, { variables: { boardId: String(boardId), limit: 50 } })
    .then((res) => {
      if (res?.errors?.length) {
        const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ");
        setError("Erreur API Monday: " + (msg || "GraphQL error"));
        setItems([]);
        return;
      }
      const list = res?.data?.items_page_by_board?.items ?? [];
      setItems(list);
      setError("");
    })
    .catch((err) => {
      const msg =
        err?.error_message || err?.message ||
        (Array.isArray(err?.errors) && err.errors.map(e => e?.message).join(" | ")) ||
        "Erreur inconnue";
      setError("Erreur API Monday: " + msg);
      setItems([]);
    });
}, [context]);




  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <h1>✅ Hello Monday (embed)</h1>

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
          <ul>
            {items.map((it) => (
              <li key={it.id}>{it.id} — {it.name}</li>
            ))}
          </ul>
        </>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {!items.length && context?.boardId && !error && (
        <p>Aucun item trouvé (ou droits manquants).</p>
      )}
    </div>
  );
}
