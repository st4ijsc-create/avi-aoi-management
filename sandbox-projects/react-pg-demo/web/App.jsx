// Giao diện React tối giản cho dự án thử: liệt kê + thêm "việc cần làm".
// Gọi /api/todos của server.mjs. Đây là phần "react" của demo react + postgres.
import React, { useEffect, useState } from "react";

export default function App() {
  const [todos, setTodos] = useState([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  async function tai() {
    const r = await fetch("/api/todos").then((x) => x.json());
    if (r.ok) setTodos(r.todos);
  }

  useEffect(() => {
    tai();
  }, []);

  async function them(e) {
    e.preventDefault();
    setError("");
    const r = await fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((x) => x.json());
    if (r.ok) {
      setTitle("");
      tai();
    } else {
      setError(r.error);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "2rem auto", fontFamily: "sans-serif" }}>
      <h1>Việc cần làm (dự án thử)</h1>
      <form onSubmit={them} style={{ display: "flex", gap: 8 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nhập việc…" />
        <button type="submit">Thêm</button>
      </form>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {todos.map((t) => (
          <li key={t.id}>{t.done ? "✓ " : "○ "}{t.title}</li>
        ))}
      </ul>
    </div>
  );
}
