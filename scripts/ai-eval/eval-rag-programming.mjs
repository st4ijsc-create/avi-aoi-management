#!/usr/bin/env node
/**
 * scripts/ai-eval/eval-rag-programming.mjs — Doc 34 · P4 PROGRAMMING-KB retrieval eval.
 *
 * Measures how well the programming knowledge base (vendor PLC/robot/motion manuals ingested
 * into knowledge/programming) retrieves the RIGHT manual page for a grounded golden set. It
 * REUSES the production retrieval path — aiProgrammingKnowledgeService.searchProgrammingKb —
 * so it measures what the copilot actually sees (embeddings + keyword + reranker), not a
 * re-implementation.
 *
 * PER CASE (rag-cases.json): searchProgrammingKb({query,vendor,topK:k}) → over the top-K chunks:
 *   HIT@k        = at least one top-K chunk's docTitle/sourcePath contains an expectDocContains
 *                  entry OR its text contains an expectKeywords entry (case-insensitive).
 *   precision@k  = (# matching top-K chunks) / min(k, retrieved).
 *
 * AGGREGATE (overall + per-vendor): hitRate (recall proxy = hits/n), meanPrecisionAtK,
 *   semanticUsedRate (vector scoring contributed), avgCitations.
 *
 * CI GATE (opt-in): --ci (or PROG_KB_EVAL_MIN set) fails (exit 1) when overall hitRate < min
 *   (default 0.70). Mirrors scripts/ai-kb/eval-rag.mjs.
 *
 * OUTPUT: scripts/ai-eval/reports/rag-<label>.json + a printed table.
 *
 * RUN (the real eval loads the 0.6B embed model — run deliberately, via tsx):
 *   npx tsx scripts/ai-eval/eval-rag-programming.mjs                 # full set, k=5
 *   npx tsx scripts/ai-eval/eval-rag-programming.mjs --k 8 --only zmotion
 *   npx tsx scripts/ai-eval/eval-rag-programming.mjs --ci --min 0.7  # CI floor
 *   npx tsx scripts/ai-eval/eval-rag-programming.mjs --selfcheck     # NO model load
 *
 * WHY tsx: this .mjs imports the TypeScript retrieval service. `node --check` validates syntax;
 * running it (incl. --selfcheck, which imports the service + reads corpus status from disk)
 * requires a TS loader — tsx, the repo convention.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;
const now = () => (typeof performance?.now === "function" ? performance.now() : Date.now());

// ─── CLI ────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = { selfcheck: false, k: 5, only: null, limit: null, label: null, cases: null, out: null, ci: false, min: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case "--selfcheck": a.selfcheck = true; break;
      case "--k": case "--topk": a.k = Math.max(1, Math.min(20, parseInt(next(), 10) || 5)); break;
      case "--only": a.only = next(); break;              // vendor filter
      case "--limit": a.limit = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--label": a.label = next(); break;
      case "--cases": a.cases = next(); break;
      case "--out": a.out = next(); break;
      case "--ci": a.ci = true; break;
      case "--min": a.min = Number(next()); break;
      case "-h": case "--help": a.help = true; break;
      default:
        if (t.startsWith("--")) console.warn(`[eval-rag] unknown flag ignored: ${t}`);
    }
  }
  return a;
}

function safeLabel(explicit) {
  if (explicit) return String(explicit).replace(/[^\w.\-:]+/g, "_");
  try {
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    if (iso && iso.length > 4) return `rag-${iso}`;
  } catch { /* Date restricted */ }
  return "rag-latest";
}

// ─── Cases ───────────────────────────────────────────────────────────────────────
function defaultCasesPath() { return path.join(__dirname, "rag-cases.json"); }

function loadCases(casesPath) {
  const json = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const arr = Array.isArray(json) ? json : Array.isArray(json.cases) ? json.cases : null;
  if (!arr) throw new Error(`${casesPath}: expected an array or an object with a "cases" array.`);
  return arr;
}

function validateCaseShapes(cases) {
  const errors = [];
  const seen = new Set();
  const byVendor = new Map();
  cases.forEach((c, i) => {
    const where = `case[${i}]${c && c.id ? ` (${c.id})` : ""}`;
    if (!c || typeof c !== "object") { errors.push(`${where}: not an object`); return; }
    if (!c.id || typeof c.id !== "string") errors.push(`${where}: missing string "id"`);
    else if (seen.has(c.id)) errors.push(`${where}: duplicate id "${c.id}"`);
    else seen.add(c.id);
    if (!c.query || typeof c.query !== "string") errors.push(`${where}: missing string "query"`);
    const dc = Array.isArray(c.expectDocContains) ? c.expectDocContains.length : 0;
    const kw = Array.isArray(c.expectKeywords) ? c.expectKeywords.length : 0;
    if (dc + kw === 0) errors.push(`${where}: needs at least one expectDocContains or expectKeywords entry`);
    const v = c.vendor || "(unfiltered)";
    byVendor.set(v, (byVendor.get(v) || 0) + 1);
  });
  return { errors, byVendor };
}

// A retrieved chunk MATCHES a case (mirrors scripts/ai-kb/eval-rag.mjs isHit).
function chunkMatches(chunk, c) {
  const doc = `${chunk.docTitle || ""} ${chunk.sourcePath || ""}`.toLowerCase();
  const txt = (chunk.text || "").toLowerCase();
  const docOk = (c.expectDocContains || []).some((s) => doc.includes(String(s).toLowerCase()));
  const kwOk = (c.expectKeywords || []).some((k) => txt.includes(String(k).toLowerCase()));
  return docOk || kwOk;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────────
const r3 = (n) => (Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function computeGroup(records, k) {
  const n = records.length;
  return {
    n,
    k,
    hits: records.filter((r) => r.hit).length,
    hitRate: n ? r3(records.filter((r) => r.hit).length / n) : null,
    meanPrecisionAtK: r3(mean(records.map((r) => r.precisionAtK)) ?? NaN),
    semanticUsedRate: n ? r3(records.filter((r) => r.semanticUsed).length / n) : null,
    avgCitations: r3(mean(records.map((r) => r.citations)) ?? NaN),
  };
}

function printTable(perVendor, overall) {
  const head = ["group", "n", "hit@k", "prec@k", "sem%", "cites"];
  const rows = [];
  const fmt = (label, m) => [
    label, String(m.n),
    m.hitRate == null ? "n/a" : `${m.hits}/${m.n}`,
    m.meanPrecisionAtK == null ? "n/a" : m.meanPrecisionAtK.toFixed(2),
    m.semanticUsedRate == null ? "n/a" : `${Math.round(m.semanticUsedRate * 100)}%`,
    m.avgCitations == null ? "n/a" : m.avgCitations.toFixed(1),
  ];
  for (const [v, m] of Object.entries(perVendor)) rows.push(fmt(v, m));
  rows.push(fmt("OVERALL", overall));
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log("\n" + line(head));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (let i = 0; i < rows.length; i++) {
    if (i === rows.length - 1) console.log(widths.map((w) => "-".repeat(w)).join("  "));
    console.log(line(rows[i]));
  }
}

// ─── SELF-CHECK (NO model load) ────────────────────────────────────────────────────
async function runSelfcheck(cfg) {
  console.log("=== eval-rag-programming selfcheck (no model is loaded) ===\n");
  let critical = 0;
  const ok = (label, detail) => console.log(`  OK    ${label}${detail ? " — " + detail : ""}`);
  const fail = (label, detail) => { console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); critical++; };

  const casesPath = cfg.cases ? path.resolve(cfg.cases) : defaultCasesPath();
  let cases = null;
  try { cases = loadCases(casesPath); ok("cases JSON parses", `${cases.length} cases · ${path.relative(process.cwd(), casesPath)}`); }
  catch (e) { fail("cases JSON parses", e?.message ?? String(e)); }

  let byVendor = new Map();
  if (cases) {
    const v = validateCaseShapes(cases);
    byVendor = v.byVendor;
    if (v.errors.length) v.errors.forEach((e) => fail("case shape", e));
    else ok("case shapes", "every case has id/query + at least one expected doc/keyword; ids unique");
    console.log("  case counts per vendor scope:");
    for (const [k, c] of [...byVendor.entries()].sort()) console.log(`      ${String(c).padStart(3)}  ${k}`);
  }

  // import the retrieval service (does NOT load a model) + read corpus status from disk
  let kbMod = null;
  try {
    kbMod = await import("../../server/services/aiProgrammingKnowledgeService");
    ok("import aiProgrammingKnowledgeService", `searchProgrammingKb: ${typeof kbMod.searchProgrammingKb}`);
    if (typeof kbMod.searchProgrammingKb !== "function") fail("searchProgrammingKb export", "not a function");
  } catch (e) { fail("import aiProgrammingKnowledgeService", e?.message ?? String(e)); }

  if (kbMod && typeof kbMod.getProgrammingKbStatus === "function") {
    let status = null;
    try { status = kbMod.getProgrammingKbStatus(); } catch (e) { fail("read corpus status", e?.message ?? String(e)); }
    if (status) {
      console.log(`  corpus: ${status.totalChunks} chunks · embedModel=${status.corpusEmbedModel} · queryEmbedModel=${status.queryEmbedModel} · match=${status.embedModelMatches}`);
      if (!status.embedModelMatches) console.log("  WARN  corpus/query embed models differ — the real eval will fall back to KEYWORD-ONLY retrieval.");
      const anyEmbed = (status.collections || []).some((c) => c.hasEmbeddings);
      if (!anyEmbed) console.log("  WARN  no collection has embeddings.jsonl — the real eval will be KEYWORD-ONLY (run scripts/ai-kb/embed-programming.mjs).");
      const slugs = new Set((status.collections || []).flatMap((c) => [c.vendor, c.vendorSlug]).map((s) => String(s).toLowerCase()));
      for (const [v] of byVendor) {
        if (v === "(unfiltered)") continue;
        if (!slugs.has(String(v).toLowerCase())) console.log(`  WARN  vendor "${v}" is not an ingested collection — those cases will retrieve nothing.`);
      }
      console.log("  collections:");
      for (const c of status.collections || []) console.log(`      ${String(c.chunks).padStart(6)}  ${c.vendorSlug.padEnd(18)} docs=${c.docs} embeddings=${c.hasEmbeddings} langs=${(c.langs || []).join("/")}`);
    }
  }

  console.log(`\n=== selfcheck ${critical === 0 ? "PASSED" : "FAILED"} (${critical} critical issue${critical === 1 ? "" : "s"}) ===`);
  console.log("Critical = cases parse + valid shapes + retrieval service imports. Corpus/embedding gaps are WARNINGS (the real eval still runs, keyword-only).");
  console.log("The model is NOT loaded here; run WITHOUT --selfcheck (via tsx) for the real eval.");
  return critical === 0 ? 0 : 1;
}

// ─── FULL EVAL (loads the embed model) ─────────────────────────────────────────────
async function runEval(cfg) {
  const casesPath = cfg.cases ? path.resolve(cfg.cases) : defaultCasesPath();
  let cases = loadCases(casesPath);
  const shape = validateCaseShapes(cases);
  if (shape.errors.length) { console.error("[eval-rag] invalid cases:\n  " + shape.errors.join("\n  ")); return 1; }

  if (cfg.only) cases = cases.filter((c) => (c.vendor || "").toLowerCase() === cfg.only.toLowerCase());
  if (cfg.limit) cases = cases.slice(0, cfg.limit);
  if (!cases.length) { console.error(`[eval-rag] no cases after filters (only=${cfg.only}, limit=${cfg.limit}).`); return 1; }

  if (!process.env.PROG_KB_ENABLED) process.env.PROG_KB_ENABLED = "true";
  const k = cfg.k;
  const DO_CI = cfg.ci || process.env.PROG_KB_EVAL_MIN != null;
  const CI_MIN = Number.isFinite(cfg.min) ? cfg.min : Number(process.env.PROG_KB_EVAL_MIN ?? "0.70");

  const { searchProgrammingKb, getProgrammingKbStatus } = await import("../../server/services/aiProgrammingKnowledgeService");
  try {
    const st = getProgrammingKbStatus?.();
    if (st) console.log(`[eval-rag] corpus ${st.totalChunks} chunks · embedModelMatch=${st.embedModelMatches} · PROG_KB_ENABLED=${st.enabled}`);
  } catch { /* best-effort */ }
  console.log(`[eval-rag] ${cases.length} case(s), k=${k}${cfg.only ? ` · only=${cfg.only}` : ""}${DO_CI ? ` · CI gate ON (min=${CI_MIN})` : ""}. The FIRST query pays the embed-model load.\n`);

  const records = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${cases.length}] ${c.id.padEnd(22)} ${(c.vendor || "(any)").padEnd(18)} `);
    const rec = { id: c.id, vendor: c.vendor || null, hit: false, precisionAtK: 0, retrieved: 0, semanticUsed: false, citations: 0, top1: null, latencyMs: null, error: null };
    const t0 = now();
    let r = null;
    try {
      r = await searchProgrammingKb({ query: c.query, vendor: c.vendor, topK: k });
    } catch (e) {
      rec.error = e?.message ?? String(e);
      rec.latencyMs = Math.round(now() - t0);
      console.log(`ERROR: ${rec.error}`);
      records.push(rec);
      continue;
    }
    rec.latencyMs = Math.round(now() - t0);
    const chunks = (r.chunks || []).slice(0, k);
    rec.retrieved = chunks.length;
    rec.semanticUsed = !!r.semanticUsed;
    rec.citations = Array.isArray(r.citations) ? r.citations.length : 0;
    const matches = chunks.map((ch) => chunkMatches(ch, c));
    const nMatch = matches.filter(Boolean).length;
    rec.hit = nMatch > 0;
    rec.precisionAtK = r3(nMatch / Math.max(1, Math.min(k, chunks.length)));
    const top = chunks[0];
    if (top) rec.top1 = { vendor: top.vendor, docTitle: top.docTitle, page: top.page ?? null, score: top.score };
    console.log(`${rec.hit ? "HIT " : "miss"} prec=${rec.precisionAtK.toFixed(2)} sem=${rec.semanticUsed} cites=${rec.citations}${top ? ` top1="${(top.docTitle || "").slice(0, 34)}" p.${top.page ?? "?"}` : " (none)"}`);
    records.push(rec);
  }

  // ─── metrics ─────────────────────────────────────────────────────────────────
  const vendors = [...new Set(records.map((r) => r.vendor || "(unfiltered)"))].sort();
  const perVendor = {};
  for (const v of vendors) perVendor[v] = computeGroup(records.filter((r) => (r.vendor || "(unfiltered)") === v), k);
  const overall = computeGroup(records, k);
  printTable(perVendor, overall);

  // ─── CI gate ─────────────────────────────────────────────────────────────────
  let ciFail = false;
  if (DO_CI) {
    console.log(`\n[eval-rag] ── CI gate ── (overall hit@${k} min=${CI_MIN})`);
    if ((overall.hitRate ?? 0) < CI_MIN) { ciFail = true; console.log(`  ✗ overall hit@${k} ${(overall.hitRate ?? 0).toFixed(3)} < ${CI_MIN}  → FAIL`); }
    else console.log(`  ✓ overall hit@${k} ${(overall.hitRate ?? 0).toFixed(3)} ≥ ${CI_MIN}  → PASS`);
  }
  const missed = records.filter((r) => !r.hit).map((r) => r.id);
  if (missed.length) console.log(`[eval-rag] misses (tune query/expected, or check corpus): ${missed.join(", ")}`);
  if (records.some((r) => !r.semanticUsed)) console.log("[eval-rag] note: some/all cases used KEYWORD-ONLY (semanticUsed=false) — ensure embeddings.jsonl exists and the embed model matches the corpus for true semantic recall.");

  // ─── report JSON ─────────────────────────────────────────────────────────────
  const label = safeLabel(cfg.label);
  const outDir = cfg.out ? path.resolve(cfg.out) : path.join(__dirname, "reports");
  const report = {
    schemaVersion: SCHEMA_VERSION,
    harness: "rag-programming",
    label,
    startedAt: (() => { try { return new Date().toISOString(); } catch { return null; } })(),
    casesFile: path.relative(process.cwd(), casesPath),
    config: { k, only: cfg.only, limit: cfg.limit, ci: DO_CI, min: DO_CI ? CI_MIN : null },
    metricDefinitions: {
      "hit@k": "≥1 top-K chunk matches an expected doc (docTitle/sourcePath) or keyword (text)",
      "precision@k": "matching top-K chunks / min(k, retrieved)",
      hitRate: "hits / n (recall proxy)",
      semanticUsedRate: "cases where vector scoring contributed / n (else keyword-only)",
    },
    overall,
    perVendor,
    gate: DO_CI ? { min: CI_MIN, pass: !ciFail } : null,
    cases: records,
  };
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, `rag-${label}.json`);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2) + "\n");
    console.log(`\n[eval-rag] report → ${path.relative(process.cwd(), outFile)}`);
  } catch (e) {
    console.warn("[eval-rag] could not write report JSON:", e?.message ?? e);
  }

  return DO_CI && ciFail ? 1 : 0;
}

// ─── Entry ─────────────────────────────────────────────────────────────────────
async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) { console.log(fs.readFileSync(path.join(__dirname, "README.md"), "utf8")); return 0; }
  return cfg.selfcheck ? runSelfcheck(cfg) : runEval(cfg);
}

main()
  .then((code) => process.exit(typeof code === "number" ? code : 0))
  .catch((err) => { console.error("[eval-rag] fatal:", err?.stack ?? err); process.exit(1); });
