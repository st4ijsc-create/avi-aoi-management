#!/usr/bin/env node
/**
 * 0363 — doc 81 Đợt 3 Task 4: bảng `engineering_assignments` (hộp việc "của tôi" theo người được giao,
 * QĐ-3a). Áp `drizzle/0363_engineering_assignments.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng
 * dụng `avi_app` (khuôn `apply-migration-0362.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) tám cột tồn tại, ĐÚNG kiểu và NULL/NOT NULL; chú thích bảng có mặt — IN RA danh sách cột;
 *       hai chỉ mục: `(assignee_user_id, active)` và UNIQUE `(entity_type, entity_id) WHERE active`;
 *   (b) quyền avi_app: SELECT/INSERT có; UPDATE CHỈ cột `active`; KHÔNG DELETE/TRUNCATE (đọc catalog) —
 *       rồi ĐO HÀNH VI trong một giao dịch LUÔN HOÀN TÁC: chèn một phân công dò, chèn phân công active
 *       THỨ HAI cho cùng mục ⇒ 23505, đổi `active` ⇒ được, đổi `assignee_user_id` ⇒ 42501, DELETE ⇒ 42501
 *       (không một hàng thật nào bị đổi, kể cả khi chạy lại);
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0363.mjs --dev-only    # DB dev (chủ dự án/Kỹ thuật tự chạy)
 *   node scripts/apply-migration-0363.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0363.mjs               # cả hai
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0363_engineering_assignments.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0363]";
const BANG = "engineering_assignments";

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}
loadEnvFile(path.join(__dirname, "..", ".env"));

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** `avi_app` không có quyền DDL (42501) — ép sang owner `aoi`. */
function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

/** Cột kỳ vọng: tên → data_type của information_schema (+ độ dài varchar) + nullable. */
const COT = [
  { ten: "id", kieu: "integer", dai: null, nullable: "NO" },
  { ten: "entity_type", kieu: "character varying", dai: 32, nullable: "NO" },
  { ten: "entity_id", kieu: "integer", dai: null, nullable: "NO" },
  { ten: "assignee_user_id", kieu: "integer", dai: null, nullable: "NO" },
  { ten: "assigned_by", kieu: "integer", dai: null, nullable: "NO" },
  { ten: "assigned_at", kieu: "timestamp without time zone", dai: null, nullable: "NO" },
  { ten: "note", kieu: "text", dai: null, nullable: "YES" },
  { ten: "active", kieu: "boolean", dai: null, nullable: "NO" },
];

/** Chỉ mục kỳ vọng: tên → mẩu bắt buộc trong `pg_indexes.indexdef`. */
const CHI_MUC = [
  { ten: "idx_engineering_assignments_assignee_active", phai: ["(assignee_user_id, active)"], unique: false },
  { ten: "uq_engineering_assignments_one_active", phai: ["UNIQUE", "(entity_type, entity_id)", "WHERE active"], unique: true },
];

/** Bắt mã lỗi SQLSTATE của một câu chạy trong SAVEPOINT (lỗi không làm hỏng giao dịch dò). */
async function maLoi(tx, fn) {
  try {
    await tx.savepoint(async (sp) => fn(sp));
    return null;
  } catch (e) {
    return e?.code ?? String(e?.message ?? e);
  }
}

async function applyTo(rawUrl, label) {
  const sql = postgres(asOwner(rawUrl), { max: 1, onnotice: (n) => console.log(`  ${TAG} ${label} NOTICE: ${n.message}`) });
  const appSql = postgres(rawUrl, { max: 1, onnotice: () => {} });
  try {
    const [vai] = await appSql`
      SELECT current_user AS u, r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname = current_user`;
    if (vai.rolsuper || vai.rolbypassrls) {
      throw new Error(`nghiem thu VO NGHIA: vai "${vai.u}" co dac quyen => phai do bang avi_app.`);
    }
    const [db0] = await appSql`SELECT current_database() AS d`;
    console.log(`  ${TAG} ${label} nghiệm thu: current_database()=${db0.d} vai="${vai.u}"`);
    const [truoc] = await appSql`SELECT to_regclass(${"public." + BANG}) IS NOT NULL AS co`;
    console.log(`  ${TAG} ${label} TRƯỚC: bảng ${BANG} ${truoc.co ? "ĐÃ có" : "chưa có"}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    // Khuôn 0362 (#6) — DDL là bảng MỚI nên không chờ khoá bảng nóng nào, nhưng `REVOKE/GRANT` và
    // `COMMENT` vẫn lấy khoá trên chính bảng; giữ cùng giới hạn chờ khoá 5 s (+ trần 60 s cho cả câu) trên
    // CHÍNH kết nối chạy DDL (max: 1): không lấy được khoá ⇒ DỪNG, báo rõ, không đổi gì.
    await sql`SET lock_timeout = '5s'`;
    await sql`SET statement_timeout = '60s'`;
    try {
      await sql.unsafe(content);
    } catch (e) {
      if (e?.code === "55P03") {
        throw new Error(
          `KHONG lay duoc khoa ${BANG} trong 5 s (lock_timeout, ${e.code}: ${e.message}) — co giao dich khac dang giu bang. ` +
            `Chua doi gi ca. Chay lai khi vang tai.`,
        );
      }
      if (e?.code === "57014") {
        throw new Error(
          `DDL ${MIGRATION_FILE} vuot qua 60 s (statement_timeout, ${e.code}: ${e.message}) — bi huy, giao dich hoan tac. ` +
            `Chua doi gi ca. Kiem tra tai DB roi chay lai.`,
        );
      }
      throw e;
    }
    console.log(`${TAG} ${label}: DDL applied (owner aoi, lock_timeout 5s)`);

    // (a) cột
    const cot = await appSql`
      SELECT column_name, data_type, character_maximum_length, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG}
       ORDER BY ordinal_position`;
    for (const k of COT) {
      const c = cot.find((r) => r.column_name === k.ten);
      if (!c) throw new Error(`(a) thieu cot ${k.ten}`);
      if (c.data_type !== k.kieu) throw new Error(`(a) cot ${k.ten} kieu ${c.data_type} (phai la ${k.kieu})`);
      if (k.dai != null && Number(c.character_maximum_length) !== k.dai) throw new Error(`(a) cot ${k.ten} dai ${c.character_maximum_length} (phai la ${k.dai})`);
      if (c.is_nullable !== k.nullable) throw new Error(`(a) cot ${k.ten} is_nullable=${c.is_nullable} (phai la ${k.nullable})`);
    }
    if (cot.length !== COT.length) throw new Error(`(a) bang co ${cot.length} cot (phai la ${COT.length}): ${cot.map((c) => c.column_name).join(",")}`);
    for (const c of cot) {
      console.log(`  ${TAG} ${label} (a) cột ${c.column_name}: ${c.data_type}${c.character_maximum_length ? `(${c.character_maximum_length})` : ""} NULL=${c.is_nullable}`);
    }
    const [chuThich] = await appSql`SELECT obj_description(${"public." + BANG}::regclass, 'pg_class') AS c`;
    if (!chuThich?.c || !/QD-3a/.test(chuThich.c)) throw new Error(`(a) thieu chu thich bang ${BANG}`);
    // (a) chỉ mục
    const idx = await appSql`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${BANG}`;
    for (const k of CHI_MUC) {
      const r = idx.find((x) => x.indexname === k.ten);
      if (!r) throw new Error(`(a) thieu chi muc ${k.ten}`);
      for (const manh of k.phai) {
        if (!r.indexdef.includes(manh)) throw new Error(`(a) chi muc ${k.ten} thieu "${manh}": ${r.indexdef}`);
      }
      if (!k.unique && r.indexdef.includes("UNIQUE")) throw new Error(`(a) chi muc ${k.ten} khong duoc UNIQUE: ${r.indexdef}`);
      console.log(`  ${TAG} ${label} (a) chỉ mục ${r.indexdef}`);
    }

    // (b) quyền — catalog
    const [q] = await appSql`
      SELECT has_table_privilege(${BANG}, 'SELECT') AS sel,
             has_table_privilege(${BANG}, 'INSERT') AS ins,
             has_table_privilege(${BANG}, 'DELETE') AS del,
             has_table_privilege(${BANG}, 'TRUNCATE') AS trn,
             has_table_privilege(${BANG}, 'UPDATE') AS upd_bang,
             has_column_privilege(${BANG}, 'active', 'UPDATE') AS upd_active,
             has_column_privilege(${BANG}, 'assignee_user_id', 'UPDATE') AS upd_assignee,
             has_sequence_privilege(${BANG + "_id_seq"}, 'USAGE') AS seq`;
    const kyVong = { sel: true, ins: true, del: false, trn: false, upd_bang: false, upd_active: true, upd_assignee: false, seq: true };
    for (const [k, v] of Object.entries(kyVong)) {
      if (q[k] !== v) throw new Error(`(b) quyen avi_app ${k}=${q[k]} (phai la ${v})`);
    }
    console.log(`  ${TAG} ${label} (b) catalog avi_app: ${JSON.stringify(q)}`);

    // (b) quyền — hành vi, trong giao dịch LUÔN HOÀN TÁC
    const HOAN_TAC = new Error("probe-0363-rollback");
    let kq = null;
    try {
      await appSql.begin(async (tx) => {
        const [mot] = await tx`
          INSERT INTO ${tx(BANG)} (entity_type, entity_id, assignee_user_id, assigned_by, note)
          VALUES ('probe-0363', -1, -1, -1, 'probe-0363') RETURNING id, active`;
        const trung = await maLoi(tx, (sp) => sp`
          INSERT INTO ${sp(BANG)} (entity_type, entity_id, assignee_user_id, assigned_by)
          VALUES ('probe-0363', -1, -2, -1)`);
        const doiNguoi = await maLoi(tx, (sp) => sp`UPDATE ${sp(BANG)} SET assignee_user_id = -3 WHERE id = ${mot.id}`);
        const xoa = await maLoi(tx, (sp) => sp`DELETE FROM ${sp(BANG)} WHERE id = ${mot.id}`);
        const [tat] = await tx`UPDATE ${tx(BANG)} SET active = false WHERE id = ${mot.id} RETURNING active`;
        // Sau khi tắt hàng 1, một phân công active MỚI cho cùng mục lại hợp lệ (chỉ mục CÓ ĐIỀU KIỆN).
        const moiSauTat = await maLoi(tx, (sp) => sp`
          INSERT INTO ${sp(BANG)} (entity_type, entity_id, assignee_user_id, assigned_by)
          VALUES ('probe-0363', -1, -2, -1)`);
        kq = { activeMacDinh: mot.active, trung, doiNguoi, xoa, tat: tat?.active, moiSauTat };
        throw HOAN_TAC; // LUÔN hoàn tác
      });
    } catch (e) {
      if (e !== HOAN_TAC) throw e;
    }
    const dung = kq && kq.activeMacDinh === true && kq.trung === "23505" && kq.doiNguoi === "42501" &&
      kq.xoa === "42501" && kq.tat === false && kq.moiSauTat === null;
    if (!dung) throw new Error(`(b) hanh vi avi_app sai: ${JSON.stringify(kq)}`);
    const [conLai] = await appSql`SELECT count(*)::int AS n FROM ${appSql(BANG)} WHERE entity_type = 'probe-0363'`;
    if (conLai.n !== 0) throw new Error(`(b) giao dich do KHONG hoan tac: con ${conLai.n} hang probe`);
    console.log(`  ${TAG} ${label} (b) hành vi avi_app: ${JSON.stringify(kq)} — trong giao dịch HOÀN TÁC (0 hàng dò còn lại)`);

    // (c)
    await sql`
      CREATE TABLE IF NOT EXISTS "__applied_migrations" (
        "id" SERIAL PRIMARY KEY,
        "filename" VARCHAR(500) NOT NULL UNIQUE,
        "applied_at" TIMESTAMP DEFAULT NOW(),
        "checksum" VARCHAR(64),
        "success" BOOLEAN DEFAULT true
      )`;
    const checksum = simpleHash(content);
    await sql`
      INSERT INTO "__applied_migrations" (filename, checksum, success)
      VALUES (${MIGRATION_FILE}, ${checksum}, true)
      ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}, success = true`;
    const [rows] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${MIGRATION_FILE}`;
    if (rows.n !== 1) throw new Error(`__applied_migrations co ${rows.n} hang (phai la 1)`);

    console.log(`${TAG} ${label}: applied + verified (cột · chỉ mục · quyền · sổ migration)`);
  } finally {
    await sql.end();
    await appSql.end();
  }
}

const args = process.argv.slice(2);
const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error(`${TAG} DATABASE_URL not set`);
  process.exit(1);
}
const targets = [];
if (!args.includes("--test-only")) targets.push([devUrl, "dev"]);
if (!args.includes("--dev-only")) {
  let testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    const u = new URL(devUrl);
    u.pathname = "/" + u.pathname.replace(/^\//, "") + "_test";
    testUrl = u.toString();
  }
  targets.push([testUrl, "test"]);
}
let failed = false;
for (const [url, label] of targets) {
  try {
    await applyTo(url, label);
  } catch (e) {
    failed = true;
    console.error(`${TAG} ${label} FAILED:`, e?.message ?? e);
  }
}
process.exit(failed ? 1 : 0);
