import React, { useEffect, useState } from "react";
import mondaySdk from "monday-sdk-js";
const monday = mondaySdk();

export default function App() {
  const [context, setContext] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    monday.listen("context", ({ data }) => { setContext(data); setError(""); });
    monday.get("context")
      .then(({ data }) => setContext((p) => p ?? data))
      .catch((e) => setError("Erreur contexte: " + (e?.message || e)));
  }, []);

  return (
    <div style={{ fontFamily:"system-ui", padding:16 }}>
      <h1>✅ SDK Monday OK (test)</h1>
      {!context && <p>Chargement du contexte…</p>}
      {context && (
        <p>
          <strong>Board ID:</strong> {String(context.boardId || "—")} ·
          <strong> Item ID:</strong> {String(context.itemId || "—")} ·
          <strong> Workspace ID:</strong> {String(context.workspaceId || "—")}
        </p>
      )}
      {error && <p style={{color:"crimson"}}>{error}</p>}
    </div>
  );
}
