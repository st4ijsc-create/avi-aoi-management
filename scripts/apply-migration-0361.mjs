#!/usr/bin/env node
/**
 * 0361 — doc 81 Đợt 1C Task 4: bảng `gateway_device_allowlist` (allowlist thiết bị cho khoá IOT_GATEWAY).
 * Áp `drizzle/0361_gateway_device_allowlist.sql` bằng owner `aoi`, rồi NGHIỆM THU bằng vai ứng dụng
 * `avi_app` (khuôn `apply-migration-0359.mjs`).
 *
 * Phép đo sau DDL (vai avi_app, Đ-28 current_database):
 *   (a) bảng tồn tại với đúng 4 cột, khoá chính (gatewayMachineId, deviceMachineId), 2 FK → machines;
 *   (b) avi_app INSERT + SELECT + DELETE được một hàng dò (hai máy có sẵn); UPDATE bị TỪ CHỐI (42501);
 *       ★ fix round 1: TOÀN BỘ phép dò chạy trong một giao dịch LUÔN hoàn tác — chạy lại script không
 *       bao giờ xoá một mục allowlist thật trùng cặp dò, và cặp dò không bao giờ "sống" với kết nối khác;
 *   (c) `__applied_migrations` có đúng 1 hàng cho tệp này.
 *
 *   node scripts/apply-migration-0361.mjs --dev-only    # DB dev (chủ dự án/Kỹ thuật tự chạy)
 *   node scripts/apply-migration-0361.mjs --test-only   # DB _test
 *   node scripts/apply-migration-0361.mjs               # cả hai
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = "0361_gateway_device_allowlist.sql";
const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", MIGRATION_FILE);
const TAG = "[0361]";
const BANG = "gateway_device_allowlist";

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

const COT = ["gatewayMachineId", "deviceMachineId", "addedBy", "createdAt"];

async function tuChoi(fn) {
  try {
    await fn();
    return false;
  } catch (e) {
    return e?.code === "42501";
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
    const [truoc] = await appSql`SELECT to_regclass(${"public." + BANG}) AS t`;
    console.log(`  ${TAG} ${label} TRƯỚC: bảng ${truoc.t ? "đã có" : "chưa có"}`);

    const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
    await sql.unsafe(content);
    console.log(`${TAG} ${label}: DDL applied (owner aoi)`);

    // (a)
    const cot = await appSql`
      SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ${BANG} ORDER BY ordinal_position`;
    const ten = cot.map((c) => c.column_name);
    if (JSON.stringify(ten) !== JSON.stringify(COT)) throw new Error(`(a) cot sai: ${ten.join(", ")}`);
    const rb = await appSql`
      SELECT c.contype, pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
       WHERE c.conrelid = ${"public." + BANG}::regclass ORDER BY c.contype, c.conname`;
    const pk = rb.filter((r) => r.contype === "p");
    const fk = rb.filter((r) => r.contype === "f");
    if (pk.length !== 1 || !/\("gatewayMachineId", "deviceMachineId"\)/.test(pk[0].def)) throw new Error(`(a) PK sai: ${JSON.stringify(pk)}`);
    if (fk.length !== 2 || !fk.every((f) => /REFERENCES machines\(id\) ON DELETE CASCADE/.test(f.def))) throw new Error(`(a) FK sai: ${JSON.stringify(fk)}`);
    console.log(`  ${TAG} ${label} (a) ${COT.length} cột · PK (gateway, device) · 2 FK → machines ON DELETE CASCADE: OK`);

    // (b) — ★ fix round 1: dò quyền TRONG MỘT GIAO DỊCH LUÔN HOÀN TÁC. Bản đầu upsert cặp (hai máy id
    //   thấp nhất) rồi DELETE vô điều kiện ⇒ chạy lại trên DB đã có đúng cặp đó sẽ XOÁ một mục allowlist
    //   thật (không audit), và trong lúc chạy cặp dò "sống" với mọi kết nối khác. Nay: mọi thao tác nằm
    //   trong `appSql.begin` và kết thúc bằng một lỗi mốc ⇒ ROLLBACK — không gì của phép dò được commit,
    //   không kết nối nào khác thấy nó, mục có sẵn (nếu có) không bao giờ mất.
    const may = await appSql`SELECT id FROM machines ORDER BY id LIMIT 2`;
    if (may.length < 2) {
      console.log(`  ${TAG} ${label} (b) BỎ QUA: DB có < 2 máy, không dựng được hàng dò`);
    } else {
      const [g, d] = [may[0].id, may[1].id];
      const HOAN_TAC = new Error("probe-0361-rollback");
      let kq = null;
      try {
        await appSql.begin(async (tx) => {
          const coSan = (await tx`SELECT 1 FROM ${tx(BANG)} WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`).length > 0;
          if (!coSan) await tx`INSERT INTO ${tx(BANG)} ("gatewayMachineId","deviceMachineId","addedBy") VALUES (${g}, ${d}, NULL)`;
          const doc = await tx`SELECT 1 FROM ${tx(BANG)} WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`;
          // UPDATE bị từ chối làm hỏng giao dịch ⇒ bọc trong SAVEPOINT để đi tiếp.
          let updTuChoi = false;
          try {
            await tx.savepoint((sp) => sp`UPDATE ${sp(BANG)} SET "addedBy" = 1 WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`);
          } catch (e) {
            updTuChoi = e?.code === "42501";
          }
          const xoa = await tx`DELETE FROM ${tx(BANG)} WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d} RETURNING 1`;
          kq = { coSan, doc: doc.length, updTuChoi, xoa: xoa.length };
          throw HOAN_TAC; // LUÔN hoàn tác — kể cả khi cặp có sẵn (DELETE ở trên bị rollback)
        });
      } catch (e) {
        if (e !== HOAN_TAC) throw e;
      }
      if (!kq || kq.doc !== 1) throw new Error(`(b) SELECT lai hang do that bai: ${JSON.stringify(kq)}`);
      if (!kq.updTuChoi) throw new Error(`(b) avi_app phai bi tu choi UPDATE`);
      if (kq.xoa !== 1) throw new Error(`(b) avi_app DELETE hang do: ${kq.xoa} (phai la 1)`);
      const conLai = await appSql`SELECT 1 FROM ${appSql(BANG)} WHERE "gatewayMachineId" = ${g} AND "deviceMachineId" = ${d}`;
      if (conLai.length !== (kq.coSan ? 1 : 0)) throw new Error(`(b) giao dich do KHONG hoan tac: con ${conLai.length} hang`);
      console.log(`  ${TAG} ${label} (b) avi_app INSERT/SELECT/DELETE OK, UPDATE bị từ chối 42501 — trong giao dịch HOÀN TÁC (cặp có sẵn: ${kq.coSan ? "có, còn nguyên" : "không"}): OK`);
    }

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

    console.log(`${TAG} ${label}: applied + verified (cột · khoá · quyền · sổ migration)`);
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
