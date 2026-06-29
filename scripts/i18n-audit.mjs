#!/usr/bin/env node
/**
 * i18n key audit (doc 10 / U15).
 *
 * Two checks over client/src/i18n/locales/{vi,en,zh}.json:
 *   1) PARITY  — keys present in one locale but missing in another (translation gaps).
 *   2) CODE    — t("some.key") calls in client/src that have NO inline fallback AND whose key
 *                is absent from the base locale (vi) → would render the raw key to the user.
 *
 * Usage:
 *   node scripts/i18n-audit.mjs            (report; exit 0)
 *   node scripts/i18n-audit.mjs --strict   (exit 1 if any gap — for CI)
 *
 * Reports only — never modifies files. Dynamic t(`${...}`) / t(variable) calls are skipped.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LOCALES_DIR = path.join(ROOT, "client", "src", "i18n", "locales");
const SRC_DIR = path.join(ROOT, "client", "src");
const STRICT = process.argv.includes("--strict");
const LANGS = ["vi", "en", "zh"];
const BASE = "vi";

function loadLocale(lang) {
  const p = path.join(LOCALES_DIR, `${lang}.json`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function flatten(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out.add(key);
  }
  return out;
}

function walk(dir, exts, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "locales") continue;
      walk(full, exts, files);
    } else if (exts.some((x) => e.name.endsWith(x))) {
      files.push(full);
    }
  }
  return files;
}

// ── 1) Parity ──
const flat = Object.fromEntries(LANGS.map((l) => [l, flatten(loadLocale(l))]));
const union = new Set();
for (const l of LANGS) for (const k of flat[l]) union.add(k);

const parityGaps = {};
let parityTotal = 0;
for (const l of LANGS) {
  const missing = [...union].filter((k) => !flat[l].has(k));
  parityGaps[l] = missing;
  parityTotal += missing.length;
}

// ── 2) Code scan: t("key") with NO fallback, key absent from base locale ──
const baseKeys = flat[BASE];
// keys used WITH a fallback are fine; capture no-fallback static calls only.
const reNoFallback = /\bt\(\s*(['"])([A-Za-z0-9_.]+)\1\s*\)/g;
const files = walk(SRC_DIR, [".ts", ".tsx"]);
const missingNoFallback = new Map(); // key -> sample file
for (const f of files) {
  if (f.endsWith(".test.ts") || f.endsWith(".unit.test.ts")) continue;
  const txt = fs.readFileSync(f, "utf8");
  let m;
  while ((m = reNoFallback.exec(txt))) {
    const key = m[2];
    if (!key.includes(".")) continue; // skip non-namespaced (likely not an i18n key)
    if (!baseKeys.has(key) && !missingNoFallback.has(key)) {
      missingNoFallback.set(key, path.relative(ROOT, f));
    }
  }
}

// ── Report ──
console.log("=== i18n audit ===");
console.log(`Locales: ${LANGS.join(", ")} | union keys: ${union.size}`);
console.log("\n[1] Parity gaps (keys missing per locale):");
for (const l of LANGS) {
  const miss = parityGaps[l];
  console.log(`  ${l}: ${miss.length} missing` + (miss.length ? ` — e.g. ${miss.slice(0, 8).join(", ")}` : ""));
}
console.log(`\n[2] t("key") with NO fallback but key missing from "${BASE}": ${missingNoFallback.size}`);
for (const [k, f] of [...missingNoFallback].slice(0, 20)) console.log(`  ${k}  (${f})`);

const hasGaps = parityTotal > 0 || missingNoFallback.size > 0;
console.log(`\nResult: ${hasGaps ? "GAPS FOUND" : "OK"} (parity=${parityTotal}, missing-no-fallback=${missingNoFallback.size})`);
if (STRICT && hasGaps) {
  console.error("\n--strict: failing due to i18n gaps.");
  process.exit(1);
}
process.exit(0);
