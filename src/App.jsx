import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  // 1) Contexte (listen + fallback get)
  useEffect(() => {
    monday.listen("context", (res) => {
      setContext(res.data);
      setError("");
    });
    monday.get("context")
      .then(({ data }) => {
        setContext((prev) => prev ?? data);
        setError("");
      })
      .catch((e) => setError("Erreur contexte: " + (e?.message || e)));
  }, []);

  // 2) Chargement des items (robuste selon ton schéma GraphQL)
  useEffect(() => {
    const boardId = context?.boardId;
    if (!boardId) return;

    let cancelled = false;
    const asID = String(boardId);
    const asInt = Number(boardId);
    const canUseInt = Number.isInteger(asInt) && asInt <= 2147483647;

    const tryItemsPageByBoard = () =>
      monday.api(
        `
        query ($boardId: ID!, $limit: Int!) {
          items_page_by_board(board_id: $boardId, limit: $limit) {
            items { id name }
          }
        }`,
        { variables: { boardId: asID, limit: 50 } }
      );

    const tryItemsPage = () =>
      monday.api(
        `
        query ($bid: ID!, $limit: Int!) {
          items_page(limit: $limit, query_params: { board_ids: [$bid] }) {
            items { id name }
          }
        }`,
        { variables: { bid: asID, limit: 50 } }
      );

    const tryBoardsItemsInt = () =>
      monday.api(
        `
        query ($ids: [Int!], $limit: Int!) {
          boards(ids: $ids) {
            id
            items(limit: $limit) { id name }
          }
        }`,
        { variables: { ids: [asInt], limit: 50 } }
      );

    (async () => {
      try {
        // 1) items_page_by_board (schéma récent)
        let res = await tryItemsPageByBoard();
        if (res?.errors?.length) {
          const txt = res.errors.map(e => e?.message).join(" | ");
          // 2) items_page (schéma alternatif)
          res = await tryItemsPage();
          if (res?.errors?.length) {
            // 3) vieux schéma: boards(ids:Int) si possible
            if (canUseInt) {
              res = await tryBoardsItemsInt();
            }
          }
          // si toujours des erreurs, on les remontera plus bas
          if (res?.errors?.length) {
            throw new Error(txt + " | " + res.errors.map(e => e?.message).join(" | "));
          }
        }

        if (cancelled) return;
        const list =
          res?.data?.items_page_by_board?.items ??
          res?.data?.items_page?.items ??
          res?.data?.boards?.[0]?.items ??
          [];

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
  }, [context?.boardId]);

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
