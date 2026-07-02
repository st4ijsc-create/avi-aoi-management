#!/usr/bin/env node
/**
 * F0 (doc 23 §F0) — front-end token lint (REPORT-ONLY baseline).
 *
 * Scans client/src/pages/**\/*.tsx for two anti-patterns that F3 will sweep to
 * design tokens:
 *   (a) raw Tailwind PALETTE classes — `text-blue-500`, `bg-emerald-600`,
 *       `border-slate-800`, `from-rose-500`, `ring-amber-400`, `fill-red-500`, …
 *       (any of text|bg|border|from|to|via|ring|fill|stroke + a named palette +
 *       a 2–3 digit shade). These should become semantic tokens
 *       (text-success / bg-warning / text-destructive / …).
 *   (b) raw HEX colours — `#0ea5e9`, `#10b981`, `#fff`, … in tsx source (props
 *       like stroke/fill/contentStyle, className strings, inline styles). These
 *       should become `var(--chart-N)` / `var(--<token>)` via chartTokens.ts.
 *
 * This is the BASELINE guard: it prints a per-file count + grand total and ALWAYS
 * exits 0 (never fails CI). A later phase can flip it to a ratchet.
 *
 * Run: `npm run lint:tokens`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PAGES_DIR = path.join(ROOT, "client", "src", "pages");

const PALETTE_NAMES = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal",
  "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

// (a) raw palette utility classes: <prefix>-<palette>-<shade>
const PALETTE_RE = new RegExp(
  `\\b(?:text|bg|border|from|to|via|ring|fill|stroke)-(?:${PALETTE_NAMES.join("|")})-[0-9]{2,3}\\b`,
  "g",
);

// (b) raw hex colours (3/4/6/8 digit).
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;

/** Recursively collect *.tsx files under a directory. */
function collectTsx(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsx(full));
    } else if (st.isFile() && full.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Count regex matches in a string (fresh lastIndex each call). */
function countMatches(re, text) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n++;
  return n;
}

function main() {
  const files = collectTsx(PAGES_DIR).sort();
  let totalPalette = 0;
  let totalHex = 0;
  const rows = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const palette = countMatches(PALETTE_RE, text);
    const hex = countMatches(HEX_RE, text);
    if (palette > 0 || hex > 0) {
      rows.push({ file: path.relative(ROOT, file).replace(/\\/g, "/"), palette, hex });
      totalPalette += palette;
      totalHex += hex;
    }
  }

  // Sort worst offenders first (palette + hex descending).
  rows.sort((a, b) => (b.palette + b.hex) - (a.palette + a.hex));

  console.log("Front-end token lint (report-only) — client/src/pages/**/*.tsx\n");
  console.log(`  ${"palette".padStart(8)}  ${"hex".padStart(6)}  file`);
  console.log(`  ${"-".repeat(8)}  ${"-".repeat(6)}  ${"-".repeat(40)}`);
  for (const r of rows) {
    console.log(`  ${String(r.palette).padStart(8)}  ${String(r.hex).padStart(6)}  ${r.file}`);
  }
  console.log(`\n  Files scanned:        ${files.length}`);
  console.log(`  Files with findings:  ${rows.length}`);
  console.log(`  Raw palette classes:  ${totalPalette}`);
  console.log(`  Raw hex colours:      ${totalHex}`);
  console.log(`  Grand total:          ${totalPalette + totalHex}\n`);
  console.log("REPORT-ONLY baseline (exit 0). F3 will sweep these to tokens.");

  // Report-only: always succeed.
  process.exit(0);
}

main();
