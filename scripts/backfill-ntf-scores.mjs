#!/usr/bin/env node
/**
 * W7-B (doc 27 §9 V3, Đợt 7 item 7.3) — ON-DEMAND backfill of
 * product_inspections."ntfScore" for recent NG inspections. NEVER auto-run:
 * the live path scores at ingest (ntfPredictorService.scoreInspectionNtf via
 * W7-A's seam); this script exists for (re)scoring history, e.g. right after
 * enabling the predictor or after the heuristic changes.
 *
 * Usage:
 *   node scripts/backfill-ntf-scores.mjs                 # last 7 days, unscored only, cap 500
 *   node scripts/backfill-ntf-scores.mjs --days 30       # deeper window
 *   node scripts/backfill-ntf-scores.mjs --limit 2000    # bigger cap (max 5000)
 *   node scripts/backfill-ntf-scores.mjs --rescore       # also overwrite existing scores
 *
 * Requires DATABASE_URL (read from .env) and migration 0188 applied
 * (scripts/apply-migration-0188.mjs). Delegates to the SAME service the live
 * path uses (no duplicated heuristic) via the tsx loader.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { register } from "tsx/esm/api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── .env loader (same minimal parser as the migration runners) ───────────────
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

if (!process.env.DATABASE_URL) {
  console.error("[backfill-ntf] DATABASE_URL not set (checked .env)");
  process.exit(1);
}

// ── args ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function intArg(name, def) {
  const i = args.indexOf(name);
  if (i === -1 || i + 1 >= args.length) return def;
  const n = Number(args[i + 1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}
const days = intArg("--days", 7);
const limit = intArg("--limit", 500);
const rescore = args.includes("--rescore");

// ── run through the real service (tsx loader — no duplicated heuristic) ──────
register();
const serviceUrl = pathToFileURL(
  path.join(__dirname, "..", "server", "services", "ai", "ntfPredictorService.ts"),
).href;
const { backfillNtfScores, isNtfPredictorEnabled } = await import(serviceUrl);

if (!isNtfPredictorEnabled()) {
  console.warn("[backfill-ntf] NTF_PREDICTOR_ENABLED=false — proceeding anyway (explicit manual run).");
}

console.log(`[backfill-ntf] scoring NG inspections: last ${days} day(s), cap ${limit}${rescore ? ", RESCORING existing" : ", unscored only"} ...`);
const result = await backfillNtfScores({ days, limit, rescore });
console.log(`[backfill-ntf] done — scanned ${result.scanned}, scored ${result.scored}, skipped ${result.skipped} (no signal / non-NG / error).`);
process.exit(0);
