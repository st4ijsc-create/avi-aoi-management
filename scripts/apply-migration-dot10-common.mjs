/**
 * doc 81 Đợt 10 task A — the shared runner of apply-migration-0372 … 0375 (the 0363–0371 pattern, factored once):
 *   • exactly ONE target flag: --dev-only | --test-only | --both; no flag ⇒ refused before any connection (R-3-g);
 *   • DDL as the owner `aoi` (MIGRATION_DB_URL / MIGRATION_DB_USER / MIGRATION_DB_PASSWORD), lock_timeout 5 s, statement_timeout 60 s;
 *   • verification as the APPLICATION role (DATABASE_URL's user, must be neither superuser nor BYPASSRLS — Đ-28
 *     current_database printed), through the caller's `verify` (catalog + an ALWAYS-rolled-back behaviour probe);
 *   • `__applied_migrations` ledger: exactly one row per file.
 * --test-only derives the _test URL from TEST_DATABASE_URL, else DATABASE_URL + "_test"; it never opens the dev DB.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.substring(0, idx).trim();
    let value = trimmed.substring(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

/** `avi_app` has no DDL rights (42501) — the owner `aoi` runs the DDL. */
function asOwner(url) {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const u = new URL(url);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}

/** SQLSTATE of one statement run inside a SAVEPOINT (an error never spoils the probe transaction); null = success. */
export async function maLoi(tx, fn) {
  try {
    await tx.savepoint(async (sp) => fn(sp));
    return null;
  } catch (e) {
    return e?.code ?? String(e?.message ?? e);
  }
}

export const ROLLBACK = new Error("probe-rollback");

/** Run `body(tx)` in a transaction that is ALWAYS rolled back; returns what body returned. */
export async function rolledBack(sqlConn, body) {
  let out;
  try {
    await sqlConn.begin(async (tx) => {
      out = await body(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return out;
}

/** Compare a measured object with the wanted one (only the wanted keys); throws with both on a difference. */
export function expectExact(label, got, want) {
  const bad = Object.entries(want).filter(([k, v]) => JSON.stringify(got?.[k]) !== JSON.stringify(v));
  if (bad.length) throw new Error(`${label}: ${bad.map(([k, v]) => `${k}=${JSON.stringify(got?.[k])} (want ${JSON.stringify(v)})`).join("; ")}`);
}

/** Table-level privileges of the current role. */
export async function tablePriv(appSql, t) {
  const [p] = await appSql`
    SELECT has_table_privilege(${t}, 'SELECT') AS sel, has_table_privilege(${t}, 'INSERT') AS ins,
           has_table_privilege(${t}, 'UPDATE') AS upd, has_table_privilege(${t}, 'DELETE') AS del,
           has_table_privilege(${t}, 'TRUNCATE') AS trunc, has_table_privilege(${t}, 'REFERENCES') AS refs,
           has_table_privilege(${t}, 'TRIGGER') AS trig`;
  return p;
}
/** Columns of `t` (among `cols`) the current role may UPDATE, sorted. */
export async function updatableCols(appSql, t, cols) {
  const out = [];
  for (const c of cols) if ((await appSql`SELECT has_column_privilege(${t}, ${c}, 'UPDATE') AS u`)[0].u) out.push(c);
  return out.sort();
}
export async function columnsOf(appSql, t) {
  return (await appSql`SELECT column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name=${t}`).map((r) => r.c);
}

/**
 * @param {{ file: string, tag: string, verify: (ctx: { sql: any, appSql: any, label: string, log: (m: string) => void }) => Promise<void> }} m
 */
export async function runMigration(m) {
  loadEnvFile(path.join(__dirname, "..", ".env"));
  const MIGRATION_PATH = path.join(__dirname, "..", "drizzle", m.file);
  const args = process.argv.slice(2);
  const targetsFlags = ["--dev-only", "--test-only", "--both"].filter((f) => args.includes(f));
  if (targetsFlags.length !== 1) {
    console.error(`${m.tag} phai chi ro DUNG MOT dich: --dev-only | --test-only | --both (nhan: ${targetsFlags.join(" ") || "khong co"}). Khong chay gi.`);
    process.exit(2);
  }
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) {
    console.error(`${m.tag} DATABASE_URL not set`);
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
    if (!/test/i.test(new URL(testUrl).pathname)) {
      console.error(`${m.tag} test target ${new URL(testUrl).pathname} does not look like a test DB — refused`);
      process.exit(2);
    }
    targets.push([testUrl, "test"]);
  }
  let failed = false;
  for (const [url, label] of targets) {
    const sql = postgres(asOwner(url), { max: 1, onnotice: (n) => console.log(`  ${m.tag} ${label} NOTICE: ${n.message}`) });
    const appSql = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const [vai] = await appSql`SELECT current_user AS u, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`;
      if (vai.rolsuper || vai.rolbypassrls) throw new Error(`verification MEANINGLESS: role "${vai.u}" is privileged => must measure as avi_app.`);
      const [db0] = await appSql`SELECT current_database() AS d`;
      console.log(`  ${m.tag} ${label} verifying as: current_database()=${db0.d} role="${vai.u}"`);
      const content = fs.readFileSync(MIGRATION_PATH, "utf-8");
      await sql`SET lock_timeout = '5s'`;
      await sql`SET statement_timeout = '60s'`;
      try {
        await sql.unsafe(content);
      } catch (e) {
        if (e?.code === "55P03") throw new Error(`could not take the lock within 5 s (lock_timeout, ${e.code}: ${e.message}). Nothing changed. Retry when idle.`);
        if (e?.code === "57014") throw new Error(`DDL ${m.file} exceeded 60 s (statement_timeout, ${e.code}). Nothing changed.`);
        throw e;
      }
      console.log(`${m.tag} ${label}: DDL applied (owner aoi, lock_timeout 5s)`);
      await m.verify({ sql, appSql, label, log: (msg) => console.log(`  ${m.tag} ${label} ${msg}`) });
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
        VALUES (${m.file}, ${checksum}, true)
        ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = ${checksum}, success = true`;
      const [rows] = await sql`SELECT count(*)::int AS n FROM "__applied_migrations" WHERE filename = ${m.file}`;
      if (rows.n !== 1) throw new Error(`__applied_migrations has ${rows.n} rows (must be 1)`);
      console.log(`${m.tag} ${label}: applied + verified (structure · grants · behaviour (rolled back) · ledger)`);
    } catch (e) {
      failed = true;
      console.error(`${m.tag} ${label} FAILED:`, e?.message ?? e);
    } finally {
      await sql.end();
      await appSql.end();
    }
  }
  process.exit(failed ? 1 : 0);
}
