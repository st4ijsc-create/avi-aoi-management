/**
 * Express API tối giản cho dự án thử — /api/todos (GET liệt kê, POST thêm).
 * POST đi qua `validateTodo` (logic thuần, test độc lập) trước khi ghi CSDL.
 */
import express from "express";
import { validateTodo } from "./validate.mjs";
import { layTodos, themTodo } from "./db.mjs";

const app = express();
app.use(express.json());

app.get("/api/todos", async (_req, res) => {
  try {
    res.json({ ok: true, todos: await layTodos() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post("/api/todos", async (req, res) => {
  const v = validateTodo(req.body);
  if (!v.ok) return res.status(400).json({ ok: false, error: v.error });
  try {
    res.status(201).json({ ok: true, todo: await themTodo(v.title) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

const PORT = Number(process.env.DEMO_PORT || 4100);
if (import.meta.url === `file://${process.argv[1]}`) {
  app.listen(PORT, () => console.log(`[react-pg-demo] API tại http://127.0.0.1:${PORT}`));
}

export { app };
