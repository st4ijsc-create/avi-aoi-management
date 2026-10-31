#!/usr/bin/env node
/**
 * Tạo / cập nhật vai trò CSDL `mcp_chi_doc` cho MCP cục bộ (server/services/mcpCucBo/dbChiDoc.ts). IDEMPOTENT — chạy lại sau mỗi đợt
 * migration để cấp quyền đọc cho bảng mới (không đặt default privileges: bảng mới mặc định KHÔNG thấy).
 *   MCP_CUC_BO_DB_MAT_KHAU=<≥24 ký tự> node scripts/mcp-cuc-bo-vai-tro.mjs --test-only | --dev-only
 * DDL bằng owner `aoi` (MIGRATION_DB_URL / MIGRATION_DB_USER / MIGRATION_DB_PASSWORD như apply-migration-*).
 *
 * Quyền: LOGIN, NOINHERIT, CONNECTION LIMIT 5, default_transaction_read_only=on, statement_timeout 5 s; CONNECT + USAGE public;
 * SELECT trên mọi bảng / view của public — bảng có cột NHẠY CẢM (tên khớp RE_NHAY_CAM) chỉ được SELECT các cột còn lại.
 * Không INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER ở bất cứ đâu; không quyền trên sequence / hàm ngoài mặc định PUBLIC.
 * Nghiệm thu ngay trong script (đăng nhập BẰNG vai trò mới): đọc được một bảng thường, cột nhạy cảm 42501, ghi 25006/42501.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

for (const f of [".env"]) {
  const p = path.resolve(f);
  if (!fs.existsSync(p)) continue;
  for (const dong of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(dong);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const VAI_TRO = "mcp_chi_doc";
const RE_NHAY_CAM = /(pass|pwd|hash|secret|token|salt|totp|otp|api_?key|apikey|private|credential|cipher|encrypt|ma_?hoa|bi_?mat|signing|session|recovery|backup_?code|noi_?dung_?da_?che)/i;
/** băm theo cách đặt tên tiếng Việt (`bamNoiDung`, `ngoaiBamDuyet`) — PHÂN BIỆT hoa thường để không bắt nhầm từ khác (do-model 2026-10-26). */
const laCotNhayCam = (c) => RE_NHAY_CAM.test(c) || /(^bam|Bam)[A-Z]/.test(c);
/**
 * Cột ẩn TƯỜNG MINH theo `bảng.cột` — nội dung người dùng/mã mà TÊN CỘT không khớp regex ở trên (dieu-phoi 2026-10-31, H5.4): lịch sử hội thoại model của lượt agent
 * (đã che bí mật nhưng vẫn là câu hỏi/mã của người dùng). Thêm cột nhạy cảm kiểu này ⇒ thêm vào đây; nghiệm thu bên dưới đòi từng cột phải ẨN.
 */
const COT_AN_TUONG_MINH = new Set(["ai_agent_run_lich_su.tinNhan"]);
const laCotAn = (bang, cot) => laCotNhayCam(cot) || COT_AN_TUONG_MINH.has(`${bang}.${cot}`);

const co = process.argv.slice(2);
const dich = co.includes("--test-only") ? "test" : co.includes("--dev-only") ? "dev" : null;
if (!dich || co.filter((x) => x === "--test-only" || x === "--dev-only").length !== 1) {
  console.error("Cần đúng MỘT cờ: --test-only | --dev-only");
  process.exit(2);
}
const matKhau = process.env.MCP_CUC_BO_DB_MAT_KHAU ?? "";
if (matKhau.length < 24 || /['"\\\s]/.test(matKhau)) {
  console.error("MCP_CUC_BO_DB_MAT_KHAU phải ≥ 24 ký tự, không dấu nháy / gạch chéo ngược / khoảng trắng");
  process.exit(2);
}
const devUrl = process.env.DATABASE_URL;
if (!devUrl) throw new Error("DATABASE_URL chưa đặt");
const u = new URL(devUrl);
if (dich === "test" && !/_test$/.test(u.pathname)) u.pathname = u.pathname + "_test";
if (dich === "dev" && /_test$/.test(u.pathname)) throw new Error("--dev-only nhưng DATABASE_URL trỏ DB test");
const tenDb = decodeURIComponent(u.pathname.replace(/^\//, ""));
const owner = new URL(process.env.MIGRATION_DB_URL ?? u.toString());
if (!process.env.MIGRATION_DB_URL) {
  owner.username = process.env.MIGRATION_DB_USER ?? "aoi";
  owner.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
}
owner.pathname = "/" + tenDb;

const sql = postgres(owner.toString(), { max: 1, onnotice: () => undefined });
try {
  const [{ db }] = await sql`SELECT current_database() AS db`;
  if (db !== tenDb) throw new Error(`kết nối nhầm DB: ${db}`);
  if (dich === "test" && !/_test$/.test(db)) throw new Error("đích test nhưng DB không kết thúc _test");
  let soBangDu = 0;
  let soBangCot = 0;
  let soCotAn = 0;
  await sql.begin(async (tx) => {
    const [r] = await tx`SELECT 1 AS c FROM pg_roles WHERE rolname = ${VAI_TRO}`;
    // Mật khẩu là literal trong DDL (CREATE/ALTER ROLE không nhận tham số) — đã kiểm không chứa nháy / gạch chéo ngược ở trên.
    if (!r) await tx.unsafe(`CREATE ROLE ${VAI_TRO} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD '${matKhau}'`);
    else await tx.unsafe(`ALTER ROLE ${VAI_TRO} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5 PASSWORD '${matKhau}'`);
    await tx.unsafe(`ALTER ROLE ${VAI_TRO} SET default_transaction_read_only = on`);
    await tx.unsafe(`ALTER ROLE ${VAI_TRO} SET statement_timeout = '5s'`);
    await tx.unsafe(`ALTER ROLE ${VAI_TRO} SET idle_in_transaction_session_timeout = '10s'`);
    await tx.unsafe(`GRANT CONNECT ON DATABASE "${tenDb.replace(/"/g, '""')}" TO ${VAI_TRO}`);
    await tx.unsafe(`GRANT USAGE ON SCHEMA public TO ${VAI_TRO}`);
    // Đặt lại từ đầu: REVOKE trên bảng cũng thu quyền theo cột.
    await tx.unsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${VAI_TRO}`);
    await tx.unsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${VAI_TRO}`);
    const bang = await tx`SELECT c.relname AS t, array_agg(a.attname::text ORDER BY a.attnum) AS cot
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
      GROUP BY c.relname ORDER BY c.relname`;
    for (const { t, cot } of bang) {
      const an = cot.filter((c) => laCotAn(t, c));
      const ten = `public."${t.replace(/"/g, '""')}"`;
      if (an.length === 0) {
        await tx.unsafe(`GRANT SELECT ON ${ten} TO ${VAI_TRO}`);
        soBangDu++;
      } else {
        const con = cot.filter((c) => !laCotAn(t, c));
        soCotAn += an.length;
        if (con.length > 0) {
          await tx.unsafe(`GRANT SELECT (${con.map((c) => `"${c.replace(/"/g, '""')}"`).join(", ")}) ON ${ten} TO ${VAI_TRO}`);
          soBangCot++;
        }
      }
    }
  });
  console.log(`[mcp_chi_doc] ${tenDb}: ${soBangDu} bảng đọc đủ cột · ${soBangCot} bảng đọc theo cột (${soCotAn} cột nhạy cảm ẩn)`);

  // ── Nghiệm thu bằng chính vai trò mới ───────────────────────────────────────────────────────────────────────────────
  const vt = new URL(owner.toString());
  vt.username = VAI_TRO;
  vt.password = matKhau;
  const s2 = postgres(vt.toString(), { max: 1, onnotice: () => undefined });
  try {
    const [{ ro }] = await s2`SELECT current_setting('default_transaction_read_only') AS ro`;
    if (ro !== "on") throw new Error(`default_transaction_read_only = ${ro}`);
    const [{ n }] = await s2`SELECT count(*)::int AS n FROM information_schema.table_privileges WHERE grantee = ${VAI_TRO} AND privilege_type <> 'SELECT'`;
    if (n !== 0) throw new Error(`vai trò có ${n} quyền khác SELECT`);
    const nhay = await s2`SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND has_column_privilege(current_user, 'public.' || quote_ident(table_name), column_name, 'SELECT')`;
    const lo = nhay.filter((r) => laCotAn(r.t, r.c));
    if (lo.length > 0) throw new Error(`cột nhạy cảm đọc được: ${lo.slice(0, 5).map((r) => `${r.t}.${r.c}`).join(", ")}`);
    // cột ẩn TƯỜNG MINH: nếu bảng có mặt thì cột phải KHÔNG đọc được (kể cả khi tên cột không khớp regex)
    for (const kh of COT_AN_TUONG_MINH) {
      const [b, c] = kh.split(".");
      const [co] = await sql`SELECT 1 AS x FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ${b} AND column_name = ${c}`;
      if (!co) continue;
      const [{ doc }] = await s2`SELECT has_column_privilege(current_user, ${"public." + b}, ${c}, 'SELECT') AS doc`;
      if (doc) throw new Error(`cột tường minh phải ẩn nhưng đọc được: ${kh}`);
    }
    const [{ k }] = await s2`SELECT count(DISTINCT table_name)::int AS k FROM information_schema.column_privileges WHERE grantee = ${VAI_TRO} AND table_schema = 'public'`;
    let ghiBiChan = false;
    try {
      await s2.unsafe("CREATE TABLE mcp_thu_ghi (x int)");
    } catch (e) {
      ghiBiChan = ["25006", "42501"].includes(e.code);
    }
    if (!ghiBiChan) throw new Error("vai trò TẠO được bảng");
    console.log(`[mcp_chi_doc] nghiệm thu: read_only=on · 0 quyền khác SELECT · 0 cột nhạy cảm đọc được · ${k} bảng thấy · DDL bị chặn`);
  } finally {
    await s2.end({ timeout: 5 });
  }
} finally {
  await sql.end({ timeout: 5 });
}
