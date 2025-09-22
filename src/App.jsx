import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  // 1) Contexte (listen + fallback get)
  useEffect(() => {
    const onCtx = ({ data }) => { setContext(data); setError(""); };
    monday.listen("context", onCtx);

    monday.get("context")
      .then(({ data }) => setContext((prev) => prev ?? data))
      .catch((e) => setError("Erreur contexte: " + (e?.message || e)));

    // pas d'API d'unsubscribe officielle; on laisse comme ça
  }, []);

  // 2) Charger des items du board, avec fallbacks selon le schéma GraphQL
  useEffect(() => {
    const boardId = context?.boardId;
    const workspaceId = context?.workspaceId;
    if (!boardId) return;

    let cancelled = false;
    const asID = String(boardId);
    const widInt = Number(workspaceId);

    const tryItemsPageByBoard = () =>
      monday.api(
        `query ($bid: ID!, $limit: Int!) {
           items_page_by_board(board_id: $bid, limit: $limit) {
             items { id name }
           }
         }`,
        { variables: { bid: asID, limit: 50 } }
      );

    const tryItemsPageWorkspace = () =>
      monday.api(
        `query ($wid: Int!, $limit: Int!) {
           items_page(limit: $limit, query_params: { workspace_ids: [$wid] }) {
             items { id name board { id } }
           }
         }`,
        { variables: { wid: widInt, limit: 50 } }
      );

    const tryItemsPageAll = () =>
      monday.api(
        `query ($limit: Int!) {
           items_page(limit: $limit) {
             items { id name board { id } }
           }
         }`,
        { variables: { limit: 50 } }
      );

    (async () => {
      try {
        // A) moderne : items_page_by_board
        let res = await tryItemsPageByBoard();

        // B) si erreur de validation → items_page par workspace
        if (res?.errors?.length) res = await tryItemsPageWorkspace();

        // C) si encore erreur → items_page “général”
        if (res?.errors?.length) res = await tryItemsPageAll();

        if (cancelled) return;

        if (res?.errors?.length) {
          const msg = res.errors.map(e => e?.message).filter(Boolean).join(" | ");
          throw new Error(msg || "GraphQL validation errors");
        }

        // Normaliser + (si besoin) filtrer par board côté JS
        let list =
          res?.data?.items_page_by_board?.items ??
          res?.data?.items_page?.items ??
          [];

        if (list.length && list[0]?.board) {
          const bid = String(boardId);
          list = list.filter(it => String(it.board?.id) === bid)
                     .map(({ id, name }) => ({ id, name }));
        }

        setItems(list);
        setError("");
      } catch (err) {
        if (cancelled) return;
        const msg =
          err?.message ||
          err?.error_message ||
          (Array.isArray(err?.errors) && err.errors.map(e => e?.message).join(" | ")) ||
          "Erreur inconnue";
        setError("Erreur API Monday: " + msg);
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
