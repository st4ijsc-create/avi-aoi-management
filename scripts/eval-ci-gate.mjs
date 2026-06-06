#!/usr/bin/env node
// Stage 11c — CI gate. Reads AI_ASSISTANT_PERSONA_EVAL_RESULTS.json and
// fails (exit 1) if any of the Phase-6 KPIs regress.
//
// Defaults (override via env):
//   GATE_PASS_PCT_MIN    95   (% items with score._pct>=80)
//   GATE_P95_MAX_MS      11000
//   GATE_DEPTH_AVG_MIN   0.50
//
// Usage:
//   node scripts/eval-ci-gate.mjs [path-to-results.json]
import { readFileSync } from "node:fs";

const file = process.argv[2] || "AI_ASSISTANT_PERSONA_EVAL_RESULTS.json";
const PASS_MIN = Number(process.env.GATE_PASS_PCT_MIN ?? 95);
const P95_MAX = Number(process.env.GATE_P95_MAX_MS ?? 11000);
const DEPTH_MIN = Number(process.env.GATE_DEPTH_AVG_MIN ?? 0.5);

const data = JSON.parse(readFileSync(file, "utf8"));
const r = data.results || [];
if (!r.length) {
  console.error(`[ci-gate] no results in ${file}`);
  process.exit(2);
}

const lat = r.map((x) => x.latencyMs).sort((a, b) => a - b);
const q = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
const passes = r.filter((x) => x.score && x.score._pct >= 80).length;
const passPct = (passes / r.length) * 100;
const depthAvg = r.reduce((s, x) => s + (x.depth?.total ?? 0), 0) / r.length;
const p50 = q(0.5);
const p95 = q(0.95);

const apiHit = r.filter((x) => (x.depth?._signals?.apiHits ?? 0) > 0).length;
const fenced = r.filter((x) => (x.depth?._signals?.codeFences ?? 0) > 0).length;
const screen = r.filter((x) => (x.depth?._signals?.screenPath ?? 0) > 0).length;

console.log(
  `[ci-gate] n=${r.length} pass=${passes}/${r.length} (${passPct.toFixed(1)}%)` +
    ` p50=${p50}ms p95=${p95}ms depthAvg=${depthAvg.toFixed(3)}` +
    ` api>0=${apiHit} fences>0=${fenced} screen>0=${screen}`,
);

const fails = [];
if (passPct < PASS_MIN) fails.push(`pass ${passPct.toFixed(1)}% < ${PASS_MIN}%`);
if (p95 > P95_MAX) fails.push(`p95 ${p95}ms > ${P95_MAX}ms`);
if (depthAvg < DEPTH_MIN) fails.push(`depthAvg ${depthAvg.toFixed(3)} < ${DEPTH_MIN}`);

const personas = [
  "P1_operator_new",
  "P2_operator_exp",
  "P3_qa_engineer",
  "P4_production_mgr",
  "P5_ai_engineer",
  "P6_it_admin",
];
for (const p of personas) {
  const sub = r.filter((x) => x.persona === p);
  if (!sub.length) continue;
  const d = sub.reduce((s, x) => s + (x.depth?.total ?? 0), 0) / sub.length;
  const pct =
    (sub.filter((x) => x.score && x.score._pct >= 80).length / sub.length) * 100;
  console.log(`[ci-gate]   ${p}: pass=${pct.toFixed(0)}% depth=${d.toFixed(2)}`);
}

if (fails.length) {
  console.error(`[ci-gate] FAIL: ${fails.join("; ")}`);
  process.exit(1);
}
console.log("[ci-gate] OK");
