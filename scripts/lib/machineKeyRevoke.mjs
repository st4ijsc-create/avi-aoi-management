/**
 * doc 81 Đợt 7 task K2 — machine API keys of TEST/QA machines: classify, list (READ ONLY), revoke (ONE transaction).
 *
 * Owner decision 2026-10-11: list the test/QA machine keys on dev read-only; after the owner approves the list, those
 * keys are REVOKED — never hard-deleted. Revoke = exactly what `revokeMachineKey` does in the app
 * (`isActive=false` + a `revokedAt` stamp; authenticateMachine denies both), done for a whole approved list in ONE
 * transaction, fail-closed: any doubt about any row ⇒ ROLLBACK, nothing changes.
 *
 * Nothing here prints or returns key material: no plaintext, no hash, no `keyPrefix` (for an `mk_` key the prefix holds
 * 6 hex of the secret) — only a key CLASS derived from the fixed literal head (`mk_pilot_` / `mk_` / other).
 *
 * Used by scripts/list-test-machine-keys.mjs and scripts/revoke-machine-keys.mjs (tests: revokeMachineKeys.dot7.db.test.ts).
 */
import { createHash } from "node:crypto";

/**
 * Machine-code groups. `proposed`:
 *   REVOKE — test/QA/seed/e2e machines the owner named (FUYU-F, QATD-*, T12-*) or seed/e2e/pilot litter;
 *   ASK    — seed machines something on dev may still use (decide per group; NOT in the default revoke list);
 *   KEEP   — anything not recognised as test/QA (never in the revoke list).
 * Undecidable case: a code that matches no rule is KEEP — the list never grows by guessing.
 */
export const MACHINE_GROUPS = [
  { group: "FUYU-F", re: /^FUYU-F-/, proposed: "REVOKE", note: "twin scale-test factory (scripts/sinh-tai-twin.ts, go-tai-twin.ts)" },
  { group: "QATD", re: /^QATD-[A-Z]-/, proposed: "REVOKE", note: "QA corporate scale fixture (QATD-A/B/C)" },
  { group: "T12", re: /^T12-/, proposed: "REVOKE", note: "e2e twin fixture (e2e/twin-dot31-may.spec.ts, go-tai-twin.ts)" },
  { group: "SN-SIM", re: /^SN-SIM/, proposed: "REVOKE", note: "seed / sim-verify machine" },
  { group: "PILOT-SIM", re: /^(SCRW|GLUE)-SIM-/, proposed: "REVOKE", note: "doc 56 pilot scripts (pilot-*.mjs mint a fresh key every run)" },
  { group: "SN-TRIAL", re: /^SN-ST4I-TRIAL-/, proposed: "REVOKE", note: "trial weld seed (scripts/seed-twin-mau.ts)" },
  { group: "SIM-LINE", re: /^SIM-L\d+-/, proposed: "ASK", note: "sim-factory seed lines (scripts/sim-factory simulator posts with x-api-key) - still used by the dev simulator?" },
  { group: "PILOT-IOT", re: /^ESP32-/, proposed: "ASK", note: "doc 56 pilot IoT device (scripts/pilot-provision-devices.mjs) - may be bench hardware" },
];

/** @returns {{group: string, proposed: "REVOKE"|"ASK"|"KEEP", note: string}} */
export function classifyMachineCode(code) {
  const c = String(code ?? "");
  for (const g of MACHINE_GROUPS) if (g.re.test(c)) return { group: g.group, proposed: g.proposed, note: g.note };
  return { group: "OTHER", proposed: "KEEP", note: "not recognised as a test/QA machine" };
}

/**
 * Every machine key, with its machine, in key-id order. Timestamps are the stored naive values formatted in SQL (they
 * never pass through postgres.js Date parsing — the −7 h trap). Run it inside a READ ONLY transaction.
 */
export async function listMachineKeyRows(sql) {
  const rows = await sql`
    SELECT k.id AS key_id, k.name AS key_name, m.id AS machine_id, m.code AS machine_code, m."isActive" AS machine_active,
           CASE WHEN k."keyPrefix" LIKE 'mk\\_pilot\\_%' THEN 'mk_pilot'
                WHEN k."keyPrefix" LIKE 'mk\\_%' THEN 'mk'
                ELSE 'legacy-hashed' END AS key_class,
           k."isActive" AS key_active, (k."revokedAt" IS NOT NULL) AS revoked,
           to_char(k."createdAt", 'YYYY-MM-DD HH24:MI:SS') AS created_naive,
           to_char(k."lastUsedAt", 'YYYY-MM-DD HH24:MI:SS') AS last_used_naive,
           to_char(k."expiresAt", 'YYYY-MM-DD HH24:MI:SS') AS expires_naive,
           EXISTS (SELECT 1 FROM json_array_elements_text(
                     CASE WHEN json_typeof(k.scopes::json) = 'array' THEN k.scopes::json ELSE '[]'::json END) s(v)
                   WHERE s.v IN ('*', 'edge:*', 'edge:sync')) AS has_edge_sync
      FROM api_keys k JOIN machines m ON m.id = k."machineId"
     ORDER BY k.id`;
  return rows.map((r) => {
    const c = classifyMachineCode(r.machine_code);
    // Only a key that still authenticates is worth revoking; an inactive/revoked one is listed but never proposed.
    const live = r.key_active === true && r.revoked === false;
    return { ...r, group: c.group, proposed: live ? c.proposed : "NONE (already inactive)", note: c.note };
  });
}

const LIST_COLUMNS = [
  "group", "proposed", "machine_code", "machine_id", "machine_active", "key_id", "key_name", "key_class",
  "key_active", "revoked", "created_naive", "last_used_naive", "expires_naive", "has_edge_sync", "note",
];

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns = LIST_COLUMNS) {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n";
}

/** The approved-list file the revoke script reads: one row per key, `key_id,machine_code`. */
export function toRevokeListCsv(rows) {
  return toCsv(rows.filter((r) => r.proposed === "REVOKE"), ["key_id", "machine_code"]);
}

/** Minimal RFC-4180 CSV reader (quoted cells, "" escapes). */
function parseCsv(text) {
  const out = [];
  let row = [];
  let cell = "";
  let q = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c !== "")) out.push(row);
  return out;
}

/**
 * Parse an approved revoke list. Needs a header with `key_id` and `machine_code` (other columns are ignored, so the full
 * K2 CSV filtered by hand also works). Fail-closed: any bad row ⇒ `errors` non-empty and the caller refuses.
 * @returns {{ entries: Array<{keyId: number, machineCode: string}>, errors: string[] }}
 */
export function parseRevokeList(text) {
  const rows = parseCsv(text);
  const errors = [];
  if (rows.length === 0) return { entries: [], errors: ["list file is empty"] };
  const head = rows[0].map((h) => h.trim());
  const iId = head.indexOf("key_id");
  const iCode = head.indexOf("machine_code");
  if (iId < 0 || iCode < 0) return { entries: [], errors: ["header must contain key_id and machine_code"] };
  const entries = [];
  const seen = new Set();
  rows.slice(1).forEach((r, n) => {
    const line = n + 2;
    const rawId = (r[iId] ?? "").trim();
    const code = (r[iCode] ?? "").trim();
    if (!/^[1-9]\d{0,9}$/.test(rawId)) { errors.push(`line ${line}: key_id "${rawId}" is not a positive integer`); return; }
    if (!code) { errors.push(`line ${line}: machine_code is empty`); return; }
    const keyId = Number(rawId);
    if (seen.has(keyId)) { errors.push(`line ${line}: key_id ${keyId} listed twice`); return; }
    seen.add(keyId);
    entries.push({ keyId, machineCode: code });
  });
  if (entries.length === 0 && errors.length === 0) errors.push("list has no key rows");
  return { entries, errors };
}

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

export class RevokeRefused extends Error {
  constructor(problems) {
    super(`revoke refused - nothing changed:\n  - ${problems.join("\n  - ")}`);
    this.name = "RevokeRefused";
    this.problems = problems;
  }
}

/**
 * Revoke an approved list in ONE transaction (the caller's `sql.begin`). Never DELETE.
 *
 *   1. lock the listed rows (`FOR UPDATE OF k`, lock_timeout 5 s; a dry run is READ ONLY and takes no lock);
 *   2. refuse (throw RevokeRefused ⇒ ROLLBACK) unless EVERY entry exists, is a MACHINE key, and its machine code in the
 *      DB equals the code in the list (a stale or hand-edited list can never revoke someone else's key);
 *   3. confirm=false ⇒ report only (the caller runs it READ ONLY and rolls back);
 *   4. confirm=true ⇒ `isActive=false`, `revokedAt` kept or stamped (UTC wall, like the app's naive timestamps),
 *      `updatedAt` stamped; keys already inactive+revoked are left untouched;
 *   5. re-check in the same transaction: api_keys row count unchanged (nothing deleted) and every listed key is now
 *      inactive with a revokedAt — else throw ⇒ ROLLBACK;
 *   6. one audit_logs row (action machine.key.revoke.bulk) with the key ids and the list file's sha256.
 *
 * @returns {Promise<{listed: number, toRevoke: number[], alreadyRevoked: number[], revoked: number[], total: number}>}
 */
export async function revokeMachineKeysTx(tx, entries, { confirm, listSha256, listName }) {
  if (!Array.isArray(entries) || entries.length === 0) throw new RevokeRefused(["empty list"]);
  await tx.unsafe("SET LOCAL lock_timeout = '5s'");
  await tx.unsafe("SET LOCAL statement_timeout = '60s'");
  const ids = entries.map((e) => e.keyId);
  const [{ n: totalBefore }] = await tx`SELECT count(*)::int AS n FROM api_keys`;
  // A dry run is READ ONLY (no row locks allowed there); a confirmed run locks every listed row before deciding.
  const found = await tx`
    SELECT k.id, k."machineId" AS machine_id, m.code AS machine_code, k."isActive" AS active, (k."revokedAt" IS NOT NULL) AS revoked
      FROM api_keys k LEFT JOIN machines m ON m.id = k."machineId"
     WHERE k.id IN ${tx(ids)}
     ORDER BY k.id
     ${confirm ? tx`FOR UPDATE OF k` : tx``}`;
  const byId = new Map(found.map((r) => [r.id, r]));
  const problems = [];
  for (const e of entries) {
    const r = byId.get(e.keyId);
    if (!r) problems.push(`key ${e.keyId}: not found`);
    else if (r.machine_id === null) problems.push(`key ${e.keyId}: not a machine key`);
    else if (r.machine_code !== e.machineCode) {
      problems.push(`key ${e.keyId}: list says machine "${e.machineCode}", DB says "${r.machine_code ?? "(machine row missing)"}"`);
    }
  }
  if (problems.length) throw new RevokeRefused(problems);

  const alreadyRevoked = found.filter((r) => !r.active && r.revoked).map((r) => r.id);
  const toRevoke = found.filter((r) => r.active || !r.revoked).map((r) => r.id);
  const result = { listed: entries.length, toRevoke, alreadyRevoked, revoked: [], total: totalBefore };
  if (!confirm) return result;

  if (toRevoke.length) {
    const upd = await tx`
      UPDATE api_keys
         SET "isActive" = false,
             "revokedAt" = COALESCE("revokedAt", (now() AT TIME ZONE 'UTC')),
             "updatedAt" = (now() AT TIME ZONE 'UTC')
       WHERE id IN ${tx(toRevoke)}
       RETURNING id`;
    result.revoked = upd.map((r) => r.id).sort((a, b) => a - b);
  }
  const [{ n: totalAfter }] = await tx`SELECT count(*)::int AS n FROM api_keys`;
  const [{ n: stillLive }] = await tx`
    SELECT count(*)::int AS n FROM api_keys WHERE id IN ${tx(ids)} AND ("isActive" OR "revokedAt" IS NULL)`;
  if (totalAfter !== totalBefore || stillLive !== 0 || result.revoked.length !== toRevoke.length) {
    throw new RevokeRefused([
      `post-check failed: api_keys rows ${totalBefore} -> ${totalAfter}, still live ${stillLive}, revoked ${result.revoked.length}/${toRevoke.length}`,
    ]);
  }
  await tx`
    INSERT INTO audit_logs ("userId", "userName", action, "entityType", "entityId", "entityName", details, status)
    VALUES (NULL, 'script:revoke-machine-keys', 'machine.key.revoke.bulk', 'api_key', NULL, ${String(listName ?? "").slice(0, 255)},
            ${JSON.stringify({ revoked: result.revoked, alreadyRevoked, listed: entries.length, listSha256, task: "doc 81 dot 7 K2" })},
            'success')`;
  return result;
}
