import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  // 1) Récupère le contexte (boardId, itemId, etc.)
  useEffect(() => {
    monday.get("context").then(({ data }) => {
      setContext(data);
    }).catch((e) => setError("Erreur contexte: " + e?.message));
  }, []);

  // 2) Quand on a le boardId, on charge quelques items via GraphQL
useEffect(() => {
  const boardId = context?.boardId;
  if (!boardId) return;

  const query = `
    query ($boardIds: [ID!]!) {
      boards(ids: $boardIds) {
        id
        name
        items(limit: 50) {
          id
          name
        }
      }
    }
  `;

  monday
    .api(query, { variables: { boardIds: [String(boardId)] } }) // <-- ID = string
    .then((res) => {
      const items = res?.data?.boards?.[0]?.items ?? [];
      setItems(items);
      setError("");
    })
    .catch((err) => {
      // Affiche le vrai message GraphQL pour debug
      const list = err?.errors?.map(e => e?.message).filter(Boolean) || [];
      const msg = list.length ? list.join(" | ") : (err?.message || "Erreur inconnue");
      setError("Erreur API Monday: " + msg);
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
