#!/usr/bin/env node
/**
 * Provision an ISOLATED test database for the integration test suite.
 *
 * WHY: a subset of server tests run against a REAL DB via getDb() (they are NOT mocked),
 * and some are DESTRUCTIVE (e.g. auth.setupAdmin deletes all users in beforeEach). Running
 * them against the dev DB would wipe dev data — so they need their own database.
 *
 * WHAT (default): CLONE the dev DB into "<db>_test" via `CREATE DATABASE ... TEMPLATE` — an
 * exact physical replica (schema + extensions + TimescaleDB hypertables + data), which a
 * fresh migration run cannot reliably reproduce (legacy/lenient migrations leave gaps).
 *   --migrate : instead CREATE an empty test DB and apply drizzle/*.sql migrations to it.
 *
 * SAFETY: refuses to proceed unless the resolved test db name contains "test" and differs
 * from the dev db — it can never target the dev/prod database.
 *
 * Usage:  node scripts/setup-test-db.mjs           (clone — recommended)
 *         node scripts/setup-test-db.mjs --migrate  (fresh migrate)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";
import postgres from "postgres";

const MODE_MIGRATE = process.argv.includes("--migrate");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(path.join(__dirname, "..", ".env"));

const devUrl = process.env.DATABASE_URL;
if (!devUrl) {
  console.error("ERROR: DATABASE_URL not set (need it to derive the test DB connection).");
  process.exit(1);
}

// Resolve the test URL: explicit TEST_DATABASE_URL wins, else swap the db name to <db>_test.
function deriveTestUrl(url) {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const u = new URL(url);
  const devName = u.pathname.replace(/^\//, "") || "postgres";
  u.pathname = "/" + devName + "_test";
  return u.toString();
}
const testUrl = deriveTestUrl(devUrl);
const testName = new URL(testUrl).pathname.replace(/^\//, "");
const devName = new URL(devUrl).pathname.replace(/^\//, "");

// SAFETY GUARD — never touch the dev/prod database.
if (!/test/i.test(testName) || testName === devName) {
  console.error(`ERROR: refusing — test db "${testName}" must contain "test" and differ from dev db "${devName}".`);
  process.exit(1);
}

const mask = (s) => s.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
console.log(`Dev  DB : ${mask(devUrl)}`);
console.log(`Test DB : ${mask(testUrl)}`);

// Run admin SQL against the maintenance "postgres" database.
async function withAdmin(fn) {
  const admin = new URL(testUrl);
  admin.pathname = "/postgres";
  const sql = postgres(admin.toString(), { max: 1 });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (MODE_MIGRATE) {
  // Empty DB + fresh migrations (legacy/lenient migrations may leave schema gaps).
  await withAdmin(async (sql) => {
    const exists = await sql`SELECT 1 FROM pg_database WHERE datname = ${testName}`;
    if (exists.length === 0) {
      await sql.unsafe(`CREATE DATABASE "${testName}"`); // testName validated above
      console.log(`Created database "${testName}".`);
    } else {
      console.log(`Database "${testName}" already exists.`);
    }
  });
  console.log("Applying migrations to the test DB…");
  execFileSync(process.execPath, [path.join(__dirname, "migrate-standalone.mjs")], {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
} else {
  // CLONE the dev DB → exact replica (schema + extensions + Timescale + data). Recreate
  // each run so the test DB tracks the dev schema. Terminate stray connections first.
  await withAdmin(async (sql) => {
    await sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${testName} AND pid <> pg_backend_pid()`;
    await sql.unsafe(`DROP DATABASE IF EXISTS "${testName}"`);
    console.log(`Cloning "${devName}" → "${testName}" (TEMPLATE)…`);
    // TEMPLATE requires no other sessions on the source; the dev app must be stopped.
    await sql.unsafe(`CREATE DATABASE "${testName}" TEMPLATE "${devName}"`);
  });
}
console.log("✓ Test DB ready.");
