/**
 * Tạo database demo RIÊNG `demo_react_pg` + bảng `todos` trên postgres local.
 * KHÔNG đụng `aoi_management`. Chạy: `npm run setup-db`.
 */
import pg from "pg";

const ADMIN = process.env.DEMO_ADMIN_URL || "postgresql://aoi:aoi@127.0.0.1:5434/postgres";
const DB = "demo_react_pg";

const admin = new pg.Client({ connectionString: ADMIN });
await admin.connect();
const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [DB]);
if (exists.rowCount === 0) {
  await admin.query(`CREATE DATABASE ${DB}`);
  console.log(`[setup-db] đã tạo database ${DB}`);
} else {
  console.log(`[setup-db] database ${DB} đã có`);
}
await admin.end();

const db = new pg.Client({ connectionString: `postgresql://aoi:aoi@127.0.0.1:5434/${DB}` });
await db.connect();
await db.query(`
  CREATE TABLE IF NOT EXISTS todos (
    id     SERIAL PRIMARY KEY,
    title  VARCHAR(200) NOT NULL,
    done   BOOLEAN NOT NULL DEFAULT false
  )
`);
console.log("[setup-db] bảng todos sẵn sàng");
await db.end();
