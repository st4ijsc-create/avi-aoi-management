#!/usr/bin/env node
/**
 * ★ Pha 0 P0-1 (2026-11-04) — KIỂM (mặc định) / CẤP (`--ap`) quyền DML của vai app `avi_app` trên mọi bảng + sequence của `public`.
 *   node scripts/cap-quyen-avi-app.mjs --test-only | --dev-only [--ap]
 * DDL / tra cứu bằng owner `aoi` (MIGRATION_DB_URL / MIGRATION_DB_USER / MIGRATION_DB_PASSWORD như apply-migration-*, mặc định aoi/aoi).
 *
 * Vì sao KHÔNG `GRANT ... ON ALL TABLES`: nhiều migration CỐ Ý đặt bộ quyền HẸP cho avi_app (WORM: REVOKE UPDATE/DELETE; bằng chứng /
 * khoá ký: REVOKE ALL rồi chỉ GRANT đúng cột). Cấp tràn là HOÀN NGUYÊN những hàng rào đó. Nên:
 *   • bảng có TÊN xuất hiện trong bất kỳ `REVOKE ... FROM avi_app` nào của `drizzle/*.sql` ⇒ "CỐ Ý HẸP" — chỉ báo, KHÔNG BAO GIỜ cấp;
 *   • bảng còn lại mà avi_app THIẾU một trong SELECT/INSERT/UPDATE/DELETE ⇒ "THIẾU" — `--ap` cấp đúng phần thiếu;
 *   • sequence (trừ sequence của bảng cố ý hẹp) thiếu USAGE/SELECT ⇒ `--ap` cấp.
 * Idempotent: chạy lại sau mỗi đợt migration. Báo cáo: số bảng đủ / thiếu / cố ý hẹp; `--ap` in đúng lệnh GRANT đã chạy, rồi KIỂM LẠI.
 * Kèm (90-N1): rolsuper / rolbypassrls của avi_app phải false/false.
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

const VAI = "avi_app";
const co = process.argv.slice(2);
const dich = co.includes("--test-only") ? "test" : co.includes("--dev-only") ? "dev" : null;
if (!dich || co.filter((x) => x === "--test-only" || x === "--dev-only").length !== 1) {
  console.error("Cần đúng MỘT cờ: --test-only | --dev-only  (thêm --ap để CẤP; mặc định chỉ KIỂM)");
  process.exit(2);
}
const ap = co.includes("--ap");
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

/** Bảng CỐ Ý HẸP: tên xuất hiện trong `REVOKE ... FROM avi_app` (bỏ dòng chú thích). */
export function bangCoYHep(thuMuc = path.resolve("drizzle")) {
  const ra = new Set();
  for (const f of fs.readdirSync(thuMuc).filter((x) => x.endsWith(".sql"))) {
    const sqlKhongChuThich = fs.readFileSync(path.join(thuMuc, f), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sqlKhongChuThich.matchAll(/REVOKE\s+[^;]*?\s+ON\s+(?:TABLE\s+|SEQUENCE\s+)?([^;]*?)\s+FROM\s+avi_app/gi)) {
      for (const t of m[1].split(",")) {
        const ten = t.trim().replace(/^public\./i, "").replace(/"/g, "");
        if (ten) ra.add(ten);
      }
    }
  }
  return ra;
}

const sql = postgres(owner.toString(), { max: 1, onnotice: () => {} });
try {
  const [{ db }] = await sql`SELECT current_database() AS db`;
  if (db !== tenDb) throw new Error(`current_database()=${db} ≠ ${tenDb}`);
  const [vai] = await sql`SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = ${VAI}`;
  if (!vai) throw new Error(`vai ${VAI} không tồn tại trên ${db}`);
  const hep = bangCoYHep();
  const kiem = async () => {
    const bang = await sql`
      SELECT c.relname AS ten,
        has_table_privilege(${VAI}, c.oid, 'SELECT') AS s, has_table_privilege(${VAI}, c.oid, 'INSERT') AS i,
        has_table_privilege(${VAI}, c.oid, 'UPDATE') AS u, has_table_privilege(${VAI}, c.oid, 'DELETE') AS d
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p') ORDER BY c.relname`;
    const seq = await sql`
      SELECT c.relname AS ten, has_sequence_privilege(${VAI}, c.oid, 'USAGE') AS us, has_sequence_privilege(${VAI}, c.oid, 'SELECT') AS se
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'S' ORDER BY c.relname`;
    const thieu = bang.filter((b) => !hep.has(b.ten) && !(b.s && b.i && b.u && b.d));
    const hepCo = bang.filter((b) => hep.has(b.ten));
    const seqThieu = seq.filter((q) => !hep.has(q.ten) && ![...hep].some((t) => q.ten.startsWith(`${t}_`)) && !(q.us && q.se));
    return { bang, thieu, hepCo, seqThieu };
  };
  let k = await kiem();
  console.log(`DB ${db} · ${VAI}: rolsuper=${vai.rolsuper} rolbypassrls=${vai.rolbypassrls} login=${vai.rolcanlogin}`);
  console.log(`bảng: ${k.bang.length} · đủ DML: ${k.bang.length - k.thieu.length - k.hepCo.length} · THIẾU: ${k.thieu.length} · cố ý hẹp (không cấp): ${k.hepCo.length} · sequence thiếu: ${k.seqThieu.length}`);
  for (const b of k.thieu) console.log(`  THIẾU ${b.ten}: ${["SELECT", "INSERT", "UPDATE", "DELETE"].filter((_, j) => ![b.s, b.i, b.u, b.d][j]).join(",")}`);
  for (const q of k.seqThieu) console.log(`  SEQUENCE THIẾU ${q.ten}`);
  if (ap && (k.thieu.length || k.seqThieu.length)) {
    await sql.begin(async (tx) => {
      for (const b of k.thieu) {
        const thieuQ = ["SELECT", "INSERT", "UPDATE", "DELETE"].filter((_, j) => ![b.s, b.i, b.u, b.d][j]).join(", ");
        console.log(`  GRANT ${thieuQ} ON public."${b.ten}" TO ${VAI}`);
        await tx.unsafe(`GRANT ${thieuQ} ON public."${b.ten.replace(/"/g, '""')}" TO ${VAI}`);
      }
      for (const q of k.seqThieu) {
        console.log(`  GRANT USAGE, SELECT ON SEQUENCE public."${q.ten}" TO ${VAI}`);
        await tx.unsafe(`GRANT USAGE, SELECT ON SEQUENCE public."${q.ten.replace(/"/g, '""')}" TO ${VAI}`);
      }
    });
    k = await kiem();
    console.log(`SAU KHI CẤP: THIẾU ${k.thieu.length} · sequence thiếu ${k.seqThieu.length}`);
  }
  if (vai.rolsuper || vai.rolbypassrls) {
    console.error(`✗ ${VAI} có rolsuper/rolbypassrls — RLS/WORM không có hiệu lực với app`);
    process.exitCode = 1;
  }
  if (k.thieu.length || k.seqThieu.length) process.exitCode = process.exitCode || (ap ? 1 : 3);
} finally {
  await sql.end({ timeout: 5 });
}
