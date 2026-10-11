#!/usr/bin/env node
/**
 * doc 81 Đợt 7 task K2 — REVOKE an owner-approved list of machine API keys in ONE transaction. Never DELETE.
 *
 *   node scripts/revoke-machine-keys.mjs --test-only --list approved.csv             # dry run (READ ONLY, rolled back)
 *   node scripts/revoke-machine-keys.mjs --test-only --list approved.csv --confirm   # revoke on _test
 *   node scripts/revoke-machine-keys.mjs --dev-only  --list approved.csv --confirm   # dev: ONLY after owner approval
 *
 * Refuses (exit 2, opens no connection) without an explicit `--list <file>` or without exactly one target flag. The list
 * file is CSV with a header holding `key_id` and `machine_code` (scripts/list-test-machine-keys.mjs --revoke-list-out
 * writes one). Every listed key must exist, be a machine key and belong to the listed machine code — otherwise NOTHING
 * changes. Revoke = `isActive=false` + `revokedAt` (as the app's revokeMachineKey), plus one audit_logs row. Prints counts
 * and key ids only — never key material, URL or env values. Logic: scripts/lib/machineKeyRevoke.mjs.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { parseRevokeList, revokeMachineKeysTx, sha256Hex, RevokeRefused } from "./lib/machineKeyRevoke.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAG = "[revoke-machine-keys]";

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
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
}
const clean = (m) => String(m).replace(/postgres(ql)?:\/\/\S+/g, "<url>");

const DICH = ["--dev-only", "--test-only"].filter((f) => process.argv.includes(f));
if (DICH.length !== 1) {
  console.error(`${TAG} need exactly one of --dev-only | --test-only (got: ${DICH.join(" ") || "none"}). Nothing done.`);
  process.exit(2);
}
const listPath = arg("--list");
if (!listPath) {
  console.error(`${TAG} refusing: an explicit --list <file.csv> of approved keys is required. Nothing done.`);
  process.exit(2);
}
if (!fs.existsSync(listPath)) {
  console.error(`${TAG} refusing: list file not found: ${listPath}. Nothing done.`);
  process.exit(2);
}
const text = fs.readFileSync(listPath, "utf-8");
const { entries, errors } = parseRevokeList(text);
if (errors.length) {
  console.error(`${TAG} refusing: the list file is not valid - nothing done:\n  - ${errors.join("\n  - ")}`);
  process.exit(2);
}
const confirm = process.argv.includes("--confirm");

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
const DRY = new Error("__DRY_RUN_ROLLBACK__");
let result = null;
let db = null;
let exitCode = 0;
try {
  await sql.begin(confirm ? "ISOLATION LEVEL READ COMMITTED" : "TRANSACTION READ ONLY", async (tx) => {
    [{ db }] = await tx`SELECT current_database() AS db`;
    if (DICH[0] === "--test-only" && !/_test$/.test(db)) throw new RevokeRefused([`--test-only resolved to "${db}"`]);
    if (DICH[0] === "--dev-only" && /_test$/.test(db)) throw new RevokeRefused([`--dev-only resolved to "${db}"`]);
    result = await revokeMachineKeysTx(tx, entries, {
      confirm,
      listSha256: sha256Hex(text),
      listName: path.basename(listPath),
    });
    if (!confirm) throw DRY; // dry run: always roll back
  });
} catch (e) {
  if (e !== DRY) {
    exitCode = e instanceof RevokeRefused ? 3 : 1;
    console.error(`${TAG} ${clean(e?.message ?? e)}`);
  }
}
await sql.end({ timeout: 2 });
if (exitCode) process.exit(exitCode);

const mode = confirm ? "COMMITTED" : "DRY RUN (read only, rolled back - add --confirm to revoke)";
console.log(
  `${TAG} db=${db} ${mode}: listed=${result.listed} ` +
    `${confirm ? `revoked=${result.revoked.length}` : `would_revoke=${result.toRevoke.length}`} ` +
    `already_revoked=${result.alreadyRevoked.length} api_keys_rows=${result.total} (unchanged, nothing deleted)`,
);
