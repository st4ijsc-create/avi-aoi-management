/**
 * Kết nối PostgreSQL cho dự án thử. Dùng một database RIÊNG (`demo_react_pg`) trên
 * postgres local — KHÔNG đụng `aoi_management` sản xuất.
 *
 * Đặt `DEMO_DATABASE_URL` trong môi trường, hoặc mặc định trỏ database demo trên cùng
 * máy chủ local. `setup-db.mjs` tạo database + bảng `todos`.
 */
import pg from "pg";

const URL =
  process.env.DEMO_DATABASE_URL ||
  "postgresql://aoi:aoi@127.0.0.1:5434/demo_react_pg";

export const pool = new pg.Pool({ connectionString: URL, max: 4 });

export async function layTodos() {
  const { rows } = await pool.query(
    'SELECT id, title, done FROM todos ORDER BY id DESC LIMIT 100',
  );
  return rows;
}

export async function themTodo(title) {
  const { rows } = await pool.query(
    'INSERT INTO todos (title) VALUES ($1) RETURNING id, title, done',
    [title],
  );
  return rows[0];
}
