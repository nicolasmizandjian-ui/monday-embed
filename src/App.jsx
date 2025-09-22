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
  const bid = context?.boardId;
  if (!bid) return;

  const run = async () => {
    // 1) tentative avec ID (chaîne)
    let res = await monday.api(
      `
      query ($ids: [ID!]!) {
        boards(ids: $ids) {
          id
          name
          items(limit: 50) { id name }
        }
      }
      `,
      { variables: { ids: [String(bid)] } }
    );

    // 2) si GraphQL signale une erreur de validation, on essaie en Int
    if (res?.errors?.length) {
      const n = Number(bid);
      const intRes = await monday.api(
        `
        query ($ids: [Int!]!) {
          boards(ids: $ids) {
            id
            name
            items(limit: 50) { id name }
          }
        }
        `,
        { variables: { ids: [n] } }
      );
      // on remplace par la réponse de fallback
      res = intRes;
    }

    // 3) gestion d’erreurs GraphQL lisible
    if (res?.errors?.length) {
      const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ");
      setError("Erreur API Monday: " + (msg || "GraphQL error"));
      setItems([]);
      return;
    }

    const list = res?.data?.boards?.[0]?.items ?? [];
    setItems(list);
    setError("");
  };

  run().catch((e) => {
    setError("Erreur réseau/SDK: " + (e?.message || e));
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
