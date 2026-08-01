#!/usr/bin/env node
/**
 * Reap orphaned inspection images by DB-diff (CASE #5, doc 51 §11.2).
 *
 * WHAT: lists storage objects under the inspection prefix, subtracts every key
 * referenced by measurement_results (imageKey / defectCropKey, plus keys derived
 * from imageUrl / defectCropUrl for legacy rows), and treats the remainder —
 * once older than a grace period — as orphans to report (or delete).
 *
 * WHY: the in-app age-based sweep only removes whole inspection directories older
 * than the 12-month retention window, and only in STORAGE_MODE=local. It misses
 * freshly-orphaned objects (upload OK but the DB row failed to persist) for up to
 * a year. This standalone tool gives ops an on-demand DB-diff net.
 *
 * SAFETY:
 *   • DRY-RUN by default — reports only. Real deletion requires --delete.
 *   • Grace period (--grace-hours, default 24): objects younger than the window
 *     are NEVER touched (they may be mid-write, or their DB row not yet committed).
 *   • Honest-refuse: if the DB reference set cannot be built, NOTHING is deleted.
 *   • Scoped to the inspection prefix only (default "inspections") — product /
 *     export / ai-model / floor-plan objects (other prefixes) are never at risk.
 *   • --delete against NODE_ENV=production is refused unless --force is passed.
 *   • This script only supports STORAGE_MODE=local (local FS listing). For forge/S3
 *     a list adapter is required (see report to coordinator) — it refuses otherwise.
 *
 * Usage:
 *   node scripts/reap-orphan-images.mjs                    # dry-run, grace 24h
 *   node scripts/reap-orphan-images.mjs --grace-hours=48   # dry-run, custom grace
 *   node scripts/reap-orphan-images.mjs --delete           # ACTUALLY delete
 *   node scripts/reap-orphan-images.mjs --delete --force   # allow in production
 *   node scripts/reap-orphan-images.mjs --prefix=inspections --max=5000
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── args ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
function flag(name) {
  return argv.includes(`--${name}`);
}
function opt(name, fallback) {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : fallback;
}

const DO_DELETE = flag("delete");
const FORCE = flag("force");
const GRACE_HOURS = Math.max(0, Number(opt("grace-hours", "24")) || 24);
const PREFIX = String(opt("prefix", "inspections")).replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
const MAX_DELETE = Math.max(0, Number(opt("max", "10000")) || 10000);

// ── env ─────────────────────────────────────────────────────────────────────
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

const STORAGE_MODE = process.env.STORAGE_MODE ?? "forge";
const DATABASE_URL = process.env.DATABASE_URL;

// ── guards ────────────────────────────────────────────────────────────────────
if (STORAGE_MODE !== "local") {
  console.error(
    `ERROR: this script only supports STORAGE_MODE=local (local FS listing); current mode is '${STORAGE_MODE}'.\n` +
      `       forge/S3 reaping needs a storage list adapter (server/storage.ts has none yet). Aborting.`,
  );
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set — cannot build the DB reference set. Refusing to reap.");
  process.exit(1);
}
if (DO_DELETE && process.env.NODE_ENV === "production" && !FORCE) {
  console.error("ERROR: --delete refused in NODE_ENV=production. Re-run with --force if you are sure.");
  process.exit(1);
}

function uploadsRoot() {
  return process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
}
function normKey(k) {
  return k.replace(/\\/g, "/").replace(/^\/+/, "");
}
function deriveKeyFromUploadsUrl(url) {
  if (!url || typeof url !== "string") return null;
  const marker = "/uploads/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const key = url.slice(idx + marker.length);
  return key ? normKey(key) : null;
}

// ── list local objects under the prefix ─────────────────────────────────────
async function listLocalObjects(prefix) {
  const root = uploadsRoot();
  const base = path.resolve(root, prefix);
  // path-traversal guard: base must stay under root
  if (!base.startsWith(root + path.sep) && base !== root) {
    throw new Error(`prefix '${prefix}' escapes the uploads root`);
  }
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = (await fs.promises.stat(p)).mtimeMs;
      } catch {
        continue;
      }
      out.push({ key: normKey(path.relative(root, p)), mtimeMs, abs: p });
    }
  }
  await walk(base);
  return out;
}

// ── build the DB reference set ───────────────────────────────────────────────
async function fetchReferencedKeys(sql) {
  const set = new Set();
  const rows = await sql`
    SELECT "imageKey", "defectCropKey", "imageUrl", "defectCropUrl"
    FROM measurement_results
    WHERE "imageKey" IS NOT NULL OR "defectCropKey" IS NOT NULL
       OR "imageUrl" LIKE '%/uploads/%' OR "defectCropUrl" LIKE '%/uploads/%'
  `;
  for (const r of rows) {
    if (r.imageKey) set.add(normKey(r.imageKey));
    if (r.defectCropKey) set.add(normKey(r.defectCropKey));
    const u1 = deriveKeyFromUploadsUrl(r.imageUrl);
    if (u1) set.add(u1);
    const u2 = deriveKeyFromUploadsUrl(r.defectCropUrl);
    if (u2) set.add(u2);
  }
  return set;
}

// ── run ───────────────────────────────────────────────────────────────────────
const mask = (s) => s.replace(/(:\/\/[^:]+:)[^@]+@/, "$1***@");
console.log(`Storage : local  root=${uploadsRoot()}  prefix=${PREFIX}`);
console.log(`DB      : ${mask(DATABASE_URL)}`);
console.log(`Mode    : ${DO_DELETE ? "DELETE" : "DRY-RUN (report only)"}   grace=${GRACE_HOURS}h   max=${MAX_DELETE}`);

const sql = postgres(DATABASE_URL, { max: 1 });
let referenced;
try {
  referenced = await fetchReferencedKeys(sql);
} catch (err) {
  console.error(`ERROR: could not load DB references — refusing to reap: ${err?.message ?? err}`);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
}
console.log(`Referenced keys in DB: ${referenced.size}`);

const objects = await listLocalObjects(PREFIX);
const nowMs = Date.now();
const graceMs = GRACE_HOURS * 60 * 60 * 1000;

let refCount = 0;
let orphanCount = 0;
const eligible = [];
for (const obj of objects) {
  if (referenced.has(obj.key)) {
    refCount++;
    continue;
  }
  orphanCount++;
  if (obj.mtimeMs > 0 && nowMs - obj.mtimeMs >= graceMs) eligible.push(obj);
}

console.log(
  `Scanned ${objects.length} object(s): ${refCount} referenced, ${orphanCount} orphan, ` +
    `${eligible.length} eligible (orphan AND older than ${GRACE_HOURS}h).`,
);

const sample = eligible.slice(0, 20).map((o) => o.key);
if (sample.length) {
  console.log(`Sample eligible orphans:\n  ${sample.join("\n  ")}${eligible.length > 20 ? "\n  ..." : ""}`);
}

let deleted = 0;
let failed = 0;
if (DO_DELETE) {
  for (const obj of eligible) {
    if (deleted >= MAX_DELETE) {
      console.warn(`Hit --max=${MAX_DELETE}; stopping (${eligible.length - deleted} eligible orphan(s) remain).`);
      break;
    }
    try {
      await fs.promises.unlink(obj.abs);
      deleted++;
    } catch (err) {
      if (err?.code === "ENOENT") continue; // already gone
      failed++;
      console.warn(`  failed to delete ${obj.key}: ${err?.message ?? err}`);
    }
  }
  console.log(`Deleted ${deleted} orphan object(s) (failed ${failed}).`);
} else {
  console.log(`DRY-RUN — nothing deleted. Re-run with --delete to remove the ${eligible.length} eligible orphan(s).`);
}

await sql.end({ timeout: 5 }).catch(() => {});
console.log("Done.");
