#!/usr/bin/env node
/**
 * doc 81 Đợt 7 task K2 — READ-ONLY list of the machine API keys, grouped by machine code (test/QA vs other), plus the
 * proposed revoke list for the owner to approve.
 *
 *   node scripts/list-test-machine-keys.mjs --dev-only  --out keys.csv [--revoke-list-out revoke-list.csv]
 *   node scripts/list-test-machine-keys.mjs --test-only --out keys.csv
 *
 * Every statement runs in `BEGIN TRANSACTION READ ONLY` (+ statement_timeout 15 s, lock_timeout 2 s) and the transaction
 * is ROLLED BACK; the script checks `transaction_read_only = on` before reading. No key material, URL or env value is
 * printed or written (see scripts/lib/machineKeyRevoke.mjs). Grouping rules: MACHINE_GROUPS there.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { listMachineKeyRows, toCsv, toRevokeListCsv } from "./lib/machineKeyRevoke.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[list-test-machine-keys]";

function envKey(key) {
  if (process.env[key]) return process.env[key];
  const f = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(f)) return undefined;
  for (const line of fs.readFileSync(f, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1 || t.slice(0, i).trim() !== key) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return undefined;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const DICH = ["--dev-only", "--test-only"].filter((f) => process.argv.includes(f));
const out = arg("--out");
if (DICH.length !== 1 || !out) {
  console.error(`${TAG} need exactly one of --dev-only | --test-only, and --out <file.csv>. Nothing read.`);
  process.exit(2);
}
const devUrl = envKey("DATABASE_URL");
if (!devUrl) {
  console.error(`${TAG} DATABASE_URL not set`);
  process.exit(1);
}
let url = devUrl;
if (DICH[0] === "--test-only") {
  url = envKey("TEST_DATABASE_URL");
  if (!url) {
    const u = new URL(devUrl);
    u.pathname = "/" + u.pathname.replace(/^\//, "") + "_test";
    url = u.toString();
  }
}

const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {}, prepare: false });
const ROLLBACK = new Error("__ROLLBACK__");
let rows = null;
let db = null;
try {
  await sql.begin("TRANSACTION READ ONLY", async (tx) => {
    await tx.unsafe("SET LOCAL statement_timeout = '15s'");
    await tx.unsafe("SET LOCAL lock_timeout = '2s'");
    const [ro] = await tx.unsafe("SHOW transaction_read_only");
    if (ro.transaction_read_only !== "on") throw new Error("transaction is not read only - refusing");
    [{ db }] = await tx`SELECT current_database() AS db`;
    if (DICH[0] === "--test-only" && !/_test$/.test(db)) throw new Error(`--test-only resolved to "${db}" - refusing`);
    rows = await listMachineKeyRows(tx);
    throw ROLLBACK; // always roll back
  });
} catch (e) {
  if (e !== ROLLBACK) {
    console.error(`${TAG} FAILED:`, String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "<url>"));
    await sql.end({ timeout: 2 });
    process.exit(1);
  }
}
await sql.end({ timeout: 2 });

fs.writeFileSync(out, toCsv(rows));
const revokeOut = arg("--revoke-list-out");
if (revokeOut) fs.writeFileSync(revokeOut, toRevokeListCsv(rows));

const by = new Map();
for (const r of rows) {
  const k = `${r.group}|${r.proposed}`;
  const v = by.get(k) ?? { keys: 0, machines: new Set(), everUsed: 0, edgeSync: 0 };
  v.keys++;
  v.machines.add(r.machine_id);
  if (r.last_used_naive) v.everUsed++;
  if (r.has_edge_sync) v.edgeSync++;
  by.set(k, v);
}
console.log(`${TAG} db=${db} (READ ONLY, rolled back) machine keys=${rows.length}`);
for (const [k, v] of [...by.entries()].sort()) {
  const [g, p] = k.split("|");
  console.log(`  ${g.padEnd(10)} ${p.padEnd(24)} keys=${v.keys} machines=${v.machines.size} everUsed=${v.everUsed} edgeSync=${v.edgeSync}`);
}
console.log(`${TAG} wrote ${out}${revokeOut ? ` and ${revokeOut} (${rows.filter((r) => r.proposed === "REVOKE").length} keys)` : ""}`);
