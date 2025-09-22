import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";

const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [debug, setDebug] = useState("");

  // -- 1) Contexte (écoute + fallback get) ------------------------------
  useEffect(() => {
    // Écoute en temps réel (souvent le plus fiable dans l’embed)
    monday.listen("context", ({ data }) => setContext(data));

    // Lecture immédiate (fallback)
    monday
      .get("context")
      .then(({ data }) => setContext((prev) => prev ?? data))
      .catch((e) => setError("Erreur contexte: " + (e?.message || e)));
  }, []);

  // -- 2) Charger des items du board courant ----------------------------
  // Stratégie simple et compatible :
  //   - on appelle items_page(limit: N)
  //   - on filtre côté JS sur board.id === context.boardId
  useEffect(() => {
    const boardId = context?.boardId;
    if (!boardId) return;

    let cancelled = false;

    const query = `
      query ($limit: Int!) {
        items_page(limit: $limit) {
          items { id name board { id } }
        }
      }
    `;

    monday
      .api(query, { variables: { limit: 50 } })
      .then((res) => {
        if (cancelled) return;

        if (res?.errors?.length) {
          // Affiche le détail dans le bloc "Debug GraphQL"
          setError("Graphql validation errors");
          setDebug(
            JSON.stringify(
              { step: "items_page", errors: res.errors },
              null,
              2
            )
          );
          setItems([]);
          return;
        }

        const all = res?.data?.items_page?.items ?? [];
        const bid = String(boardId);
        const list = all
          .filter((it) => String(it?.board?.id) === bid)
          .map(({ id, name }) => ({ id, name }));

        setItems(list);
        setError("");
        setDebug(JSON.stringify({ totalReturned: all.length, keptForBoard: list.length }, null, 2));
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          err?.error_message ||
          err?.message ||
          (Array.isArray(err?.errors) && err.errors.map((e) => e?.message).join(" | ")) ||
          "Erreur inconnue";
        setError("Erreur API Monday: " + msg);
        setDebug(JSON.stringify(err, null, 2));
        setItems([]);
      });

    return () => {
      cancelled = true;
    };
  }, [context?.boardId]);

  // -- 3) Rendu ----------------------------------------------------------
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
              <li key={it.id}>
                {it.id} — {it.name}
              </li>
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
