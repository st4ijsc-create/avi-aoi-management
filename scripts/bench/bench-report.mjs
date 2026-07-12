#!/usr/bin/env node
// scripts/bench/bench-report.mjs
// ─────────────────────────────────────────────────────────────────────────────
// doc 44 W7-3 (G1.19 / G2.20) — score a bench-ingest result against the SYNAPSE
// release-gate SLOs (doc 44 §9/§10 + LDS-L1/L2 SLOs) and print a publishable table.
//
// SLO thresholds (single source of truth = SLO_GATES below):
//   • tag→UNS P95/P99 ≤ 250ms      (LDS-L1 §… / doc 44 §10 "UNS 100k msg/s P99≤250ms")
//   • ingest→queryable P95 ≤ 1000ms (LDS-L2 "ingest→query ≤1s")
//   • throughput ≥ 100,000 pts/s    (LDS-L2 "≥100k điểm/s")
//
// Also prints the RELEASE-GATE CHECKLIST (doc 44 §10): 100k msg/s, soak 24h, chaos
// suite — flagging which are MEASURED by this result vs which still need infra.
//
// USAGE:
//   node scripts/bench/bench-report.mjs results/<label>.json
//   node scripts/bench/bench-report.mjs results/<label>.json --gate   # exit 1 if a hard gate fails
//   cat results/<label>.json | node scripts/bench/bench-report.mjs -   # read stdin
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import { gate } from "./lib/stats.mjs";

// Release-gate thresholds (edit HERE to retune the published gate).
const SLO_GATES = {
  tagToUnsP95Ms: 250,
  tagToUnsP99Ms: 250,
  ingestToQueryP95Ms: 1000,
  throughputPerSec: 100000,
  maxErrorRatePct: 0.1,
};

function parseArgs(argv) {
  const a = { in: null, gate: false };
  for (const t of argv) {
    if (t === "--gate") a.gate = true;
    else if (t === "-h" || t === "--help") a.help = true;
    else if (!t.startsWith("--")) a.in = t;
  }
  return a;
}

function readInput(src) {
  if (!src || src === "-") return fs.readFileSync(0, "utf8"); // stdin
  return fs.readFileSync(src, "utf8");
}

function fmt(v, unit = "") {
  if (v == null) return "  n/a ";
  return `${v}${unit}`;
}

function gateLine(g) {
  const mark = g.pass === true ? "PASS" : g.pass === false ? "FAIL" : "  — ";
  const cmp = g.mode === "min" ? "≥" : "≤";
  const value = g.measured == null ? "not measured" : `${g.measured}${g.unit}`;
  return `  [${mark}] ${g.label.padEnd(28)} ${String(value).padStart(16)}  (target ${cmp} ${g.threshold}${g.unit})`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/bench/bench-report.mjs <result.json|-> [--gate]");
    return 0;
  }
  let r;
  try {
    r = JSON.parse(readInput(args.in));
  } catch (e) {
    console.error(`[bench-report] cannot read/parse input: ${e?.message ?? e}`);
    return 2;
  }

  const tq = r.tagToQueryMs;
  const ack = r.ackLatencyMs || {};
  const tp = r.throughput || {};
  const errorRatePct = tp.pointsSent > 0 ? (r.errors / tp.pointsSent) * 100 : 0;

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log(` SYNAPSE INGEST BENCHMARK — ${r.label ?? "(unlabelled)"}`);
  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log(` mode:        ${r.mode}   latencyKind: ${r.latencyKind}`);
  console.log(` started:     ${r.startedAt ?? "n/a"}`);
  console.log(` hardware:    ${r.hardware?.cpu ?? "?"} (${r.hardware?.cpuCores ?? "?"} cores), ${r.hardware?.totalMemGb ?? "?"}GB, ${r.hardware?.platform ?? "?"}`);
  console.log(` config:      tags=${r.config?.tags} targetRate=${r.config?.targetRate}/s duration=${r.config?.durationSec}s batch=${r.config?.batch}`);
  console.log("");
  console.log(" THROUGHPUT");
  console.log(`   points sent:        ${fmt(tp.pointsSent)}`);
  console.log(`   wall time:          ${fmt(tp.wallMs, "ms")}`);
  console.log(`   achieved:           ${fmt(tp.achievedPerSec, " pts/s")}  (${fmt(tp.achievedPct, "%")} of target ${fmt(tp.targetPerSec)})`);
  console.log("");
  console.log(" LATENCY (ms)                 n        min     p50     p95     p99    p999      max");
  console.log(`   ack (${r.latencyKind}):`.padEnd(30) +
    `${fmt(ack.n)}   ${fmt(ack.min)}   ${fmt(ack.p50)}   ${fmt(ack.p95)}   ${fmt(ack.p99)}   ${fmt(ack.p999)}   ${fmt(ack.max)}`);
  if (tq) {
    console.log(`   tag→queryable:`.padEnd(30) +
      `${fmt(tq.n)}   ${fmt(tq.min)}   ${fmt(tq.p50)}   ${fmt(tq.p95)}   ${fmt(tq.p99)}   ${fmt(tq.p999)}   ${fmt(tq.max)}`);
  } else {
    console.log("   tag→queryable:              (not measured — dry mode or no --query-url)");
  }
  console.log("");
  console.log(" RESOURCES");
  console.log(`   cpu:                ${fmt(r.resources?.cpuPct, "%")} (user ${fmt(r.resources?.cpuUserMs, "ms")} / sys ${fmt(r.resources?.cpuSystemMs, "ms")})`);
  console.log(`   peak RSS:           ${fmt(r.resources?.peakRssMib, " MiB")}`);
  console.log(`   errors:             ${fmt(r.errors)} (${fmt(Math.round(errorRatePct * 1000) / 1000, "%")})`);
  if (r.chaos) console.log(`   chaos injections:   ${r.chaos.length} (${r.chaos.filter((c) => c.ok).length} ok)`);

  // ── SLO gates ──────────────────────────────────────────────────────────────
  const gates = [
    gate("tag→UNS P95", tq?.p95 ?? null, SLO_GATES.tagToUnsP95Ms, "max", "ms"),
    gate("tag→UNS P99", tq?.p99 ?? null, SLO_GATES.tagToUnsP99Ms, "max", "ms"),
    gate("ingest→queryable P95", tq?.p95 ?? null, SLO_GATES.ingestToQueryP95Ms, "max", "ms"),
    gate("throughput", tp.achievedPerSec ?? null, SLO_GATES.throughputPerSec, "min", " pts/s"),
    gate("error rate", tp.pointsSent > 0 ? Math.round(errorRatePct * 1000) / 1000 : null, SLO_GATES.maxErrorRatePct, "max", "%"),
  ];
  console.log("");
  console.log(" RELEASE-GATE SLOs (doc 44 §9/§10 · LDS-L1/L2)");
  for (const g of gates) console.log(gateLine(g));

  const hardFails = gates.filter((g) => g.pass === false);
  const notMeasured = gates.filter((g) => g.pass === null);
  console.log("");
  console.log(" RELEASE-GATE CHECKLIST (doc 44 §10 — needs the full soak/chaos campaign)");
  console.log(`   [${tp.achievedPct >= 100 ? "meas" : " ?? "}] 100k msg/s sustained          ${tp.achievedPct >= 100 ? "achieved this run" : "not reached in this run (needs streaming bus + broker cluster infra)"}`);
  console.log(`   [ ?? ] soak 24h no leak/deadlock     run --duration 86400 against a live target + watch peak RSS`);
  console.log(`   [${r.chaos ? "meas" : " ?? "}] chaos suite green              ${r.chaos ? `${r.chaos.length} injections driven via Full-Sim` : "add --chaos-control <sim-url> against Full-Sim"}`);
  console.log("");

  if (r.mode === "dry") {
    console.log(" NOTE: dry mode proves the HARNESS + math only (no DB/broker). For a real");
    console.log("       tag→UNS / ingest→queryable SLI, run --mode http against a live ingest");
    console.log("       endpoint with --query-url (needs Timescale + UNS bridge; see docs/BENCHMARK.md).");
  }

  const verdict = hardFails.length === 0
    ? (notMeasured.length ? "PASS (measured gates) — some gates NOT MEASURED" : "PASS — all gates green")
    : `FAIL — ${hardFails.length} gate(s) below SLO`;
  console.log(`═══ VERDICT: ${verdict} ═══`);

  if (args.gate && hardFails.length > 0) return 1;
  return 0;
}

process.exit(main());
