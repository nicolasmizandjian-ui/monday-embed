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

  // Chargement des items avec fallbacks
  useEffect(() => {
    const boardId = context?.boardId;
    const workspaceId = context?.workspaceId;
    if (!boardId) return;

    let cancelled = false;
    const bidStr = String(boardId);
    const widNum = Number(workspaceId);
    const hasWid = Number.isInteger(widNum);

    (async () => {
      try {
        // A) Schéma récent
        const qA = `
          query ($bid: ID!, $limit: Int!) {
            items_page_by_board(board_id: $bid, limit: $limit) {
              items { id name }
            }
          }`;
        const dA = await run("A items_page_by_board", qA, { bid: bidStr, limit: 50 });
        if (!cancelled) { setItems(dA?.items_page_by_board?.items ?? []); setError(""); }
        return;
      } catch (eA) {
        // continue
      }

      try {
        // B) Fallback par workspace (évite l’ID de board > Int32)
        if (!hasWid) throw new Error("skip B");
        const qB = `
          query ($wid: Int!, $limit: Int!) {
            items_page(limit: $limit, query_params: { workspace_ids: [$wid] }) {
              items { id name board { id } }
            }
          }`;
        const dB = await run("B items_page(workspace)", qB, { wid: widNum, limit: 50 });
        let list = dB?.items_page?.items ?? [];
        list = list.filter(it => String(it.board?.id) === bidStr).map(({ id, name }) => ({ id, name }));
        if (!cancelled) { setItems(list); setError(""); }
        return;
      } catch (eB) {
        // continue
      }

      try {
        // C) Fallback générique puis filtrage JS
        const qC = `
          query ($limit: Int!) {
            items_page(limit: $limit) {
              items { id name board { id } }
            }
          }`;
        const dC = await run("C items_page(all)", qC, { limit: 50 });
        let list = dC?.items_page?.items ?? [];
        list = list.filter(it => String(it.board?.id) === bidStr).map(({ id, name }) => ({ id, name }));
        if (!cancelled) { setItems(list); setError(""); }
        return;
      } catch (eC) {
        if (!cancelled) { setError(String(eC?.message || eC)); setItems([]); }
      }
    })();

    return () => { cancelled = true; };
  }, [context?.boardId, context?.workspaceId]);

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
