#!/usr/bin/env node
// scripts/bench/bench-ingest.mjs
// ─────────────────────────────────────────────────────────────────────────────
// doc 44 W7-3 (G1.19 ≥20k tag/gateway · G2.20 SLI ingest→queryable + load-test
// 100k msg/s + soak). Release-gate LOAD GENERATOR + measurement harness.
//
// WHAT IT MEASURES (and writes to a JSON result consumed by bench-report.mjs):
//   • throughput  — synthetic points/sec actually driven (achieved vs target)
//   • ack latency — per-batch delivery latency P50/P95/P99/P999
//   • tag→queryable latency — (http mode + --query-url) REAL time from send to
//                   the point becoming queryable (the G2.20 SLI)
//   • cpu / rss   — process.cpuUsage + peak RSS over the run
//
// MODES (honest about what each proves):
//   --mode dry   (default) — NO infrastructure. Generates + serializes load through
//                the null sink; proves the tool + math end-to-end. Latency is
//                labelled `harness` (NOT a real ingest→query number).
//   --mode http  — POST batches to a REAL ingest endpoint (--target). Add
//                --query-url to also measure the real tag→queryable SLI. Reuse the
//                app's OT ingest route or the Full-Sim inspection route.
//
// SELF-CONTAINED: pure ESM + node:fetch. Does NOT import server/ TypeScript, so it
// runs without booting the app (dry mode) or against any running instance (http).
//
// USAGE:
//   node scripts/bench/bench-ingest.mjs --selfcheck
//   node scripts/bench/bench-ingest.mjs --mode dry --tags 20000 --rate 100000 --duration 10
//   node scripts/bench/bench-ingest.mjs --mode http --target http://127.0.0.1:3000/api/ot/ingest \
//        --query-url http://127.0.0.1:3000/api/ot/telemetry/recent --rate 5000 --duration 30
//   node scripts/bench/bench-ingest.mjs --mode http --target ... --chaos-control http://127.0.0.1:4899 --duration 60
//
// See docs/BENCHMARK.md for the full flag matrix + release-gate thresholds.
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { makeLoadGenerator } from "./lib/loadgen.mjs";
import { summarize, throughputPerSec, round } from "./lib/stats.mjs";
import { nullDriver, httpDriver, simChaos } from "./lib/drivers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_VERSION = 1;
const now = () => performance.now();

// ─── CLI ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const a = {
    selfcheck: false,
    mode: "dry",
    tags: 20000,
    rate: 100000, // target points/sec
    duration: 10, // seconds
    batch: 500,
    seed: 1337,
    lines: 3,
    target: null,
    queryUrl: null,
    chaosControl: null,
    chaosEverySec: 20,
    syntheticDelayMs: 0,
    label: null,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    const next = () => argv[++i];
    switch (t) {
      case "--selfcheck": a.selfcheck = true; break;
      case "--mode": a.mode = next(); break;
      case "--tags": a.tags = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--rate": a.rate = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--duration": a.duration = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--batch": a.batch = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--seed": a.seed = parseInt(next(), 10) || 0; break;
      case "--lines": a.lines = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--target": a.target = next(); break;
      case "--query-url": a.queryUrl = next(); break;
      case "--chaos-control": a.chaosControl = next(); break;
      case "--chaos-every": a.chaosEverySec = Math.max(1, parseInt(next(), 10) || 1); break;
      case "--synthetic-delay": a.syntheticDelayMs = Math.max(0, parseFloat(next()) || 0); break;
      case "--label": a.label = next(); break;
      case "--out": a.out = next(); break;
      case "-h": case "--help": a.help = true; break;
      default:
        if (t.startsWith("--")) console.warn(`[bench-ingest] unknown flag ignored: ${t}`);
    }
  }
  return a;
}

function safeLabel(explicit) {
  if (explicit) return String(explicit).replace(/[^\w.\-]+/g, "_");
  try {
    return new Date().toISOString().replace(/[:.]/g, "-");
  } catch {
    return "bench-latest";
  }
}

// ─── Selfcheck (no load, no infra) ────────────────────────────────────────────
function runSelfcheck(cfg, outDir) {
  console.log("=== bench-ingest selfcheck (no load generated) ===\n");
  let critical = 0;
  const line = (ok, label, detail) =>
    console.log(`  ${ok ? "OK  " : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);

  // 1. deterministic generator produces the requested count + shape
  let genOk = false;
  try {
    const gen = makeLoadGenerator({ tagCount: Math.min(cfg.tags, 1000), seed: cfg.seed, lineCount: cfg.lines });
    const batch = gen.generateBatch(10, 0);
    genOk = batch.length === 10 && batch.every((s) => s.deviceId && s.metric && "value" in s);
    line(genOk, "load generator", `${gen.deviceCount} devices, sample shape OK`);
  } catch (e) {
    line(false, "load generator", e?.message ?? String(e));
  }
  if (!genOk) critical++;

  // 2. determinism — same seed → identical first batch
  try {
    const g1 = makeLoadGenerator({ tagCount: 300, seed: 42 }).generateBatch(50, 0);
    const g2 = makeLoadGenerator({ tagCount: 300, seed: 42 }).generateBatch(50, 0);
    const same = JSON.stringify(g1) === JSON.stringify(g2);
    line(same, "determinism", same ? "same seed → identical batch" : "MISMATCH");
    if (!same) critical++;
  } catch (e) {
    line(false, "determinism", e?.message ?? String(e)); critical++;
  }

  // 3. fetch available (http mode requires it)
  const fetchOk = typeof fetch === "function";
  line(fetchOk, "global fetch", fetchOk ? "present (Node ≥18)" : "MISSING — http mode unavailable");
  if (!fetchOk) critical++;

  // 4. mode sanity
  if (cfg.mode === "http" && !cfg.target) {
    line(false, "http mode", "--target is required for --mode http"); critical++;
  } else {
    line(true, "mode", `${cfg.mode}${cfg.mode === "http" ? ` → ${cfg.target}` : " (no infra needed)"}`);
  }

  // 5. output dir writable
  let outOk = false;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    const probe = path.join(outDir, `.selfcheck-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(probe, "ok"); fs.unlinkSync(probe); outOk = true;
    line(true, "output dir writable", outDir);
  } catch (e) {
    line(false, "output dir writable", e?.message ?? String(e));
  }
  if (!outOk) critical++;

  console.log(`\n=== selfcheck ${critical === 0 ? "PASSED" : "FAILED"} (${critical} critical) ===`);
  return critical === 0 ? 0 : 1;
}

// ─── Load run ─────────────────────────────────────────────────────────────────
async function runLoad(cfg, outDir) {
  const label = safeLabel(cfg.label);
  const gen = makeLoadGenerator({ tagCount: cfg.tags, seed: cfg.seed, lineCount: cfg.lines });

  let driver;
  if (cfg.mode === "http") {
    if (!cfg.target) { console.error("[bench-ingest] --mode http requires --target"); return 1; }
    // doc 48 R3: the /api/ot/ingest tier authenticates by per-machine key. Present it
    // as x-api-key when OT_BENCH_API_KEY is set, so an AUTHENTICATED (legitimate)
    // high-rate client is benchmarked. Unset → no key header (unchanged behaviour).
    const headers = { "content-type": "application/json" };
    if (process.env.OT_BENCH_API_KEY) headers["x-api-key"] = process.env.OT_BENCH_API_KEY;
    driver = httpDriver({
      target: cfg.target,
      queryUrl: cfg.queryUrl,
      probeIntervalBatches: cfg.queryUrl ? 10 : 0,
      headers,
    });
  } else {
    driver = nullDriver({ syntheticDelayMs: cfg.syntheticDelayMs });
  }

  const targetTotal = cfg.rate * cfg.duration;
  const batchesTotal = Math.max(1, Math.ceil(targetTotal / cfg.batch));
  // Pace: how many batches per 100ms tick to hit the target rate.
  const tickMs = 100;
  const batchesPerTick = Math.max(1, Math.round((cfg.rate * (tickMs / 1000)) / cfg.batch));

  console.log(
    `[bench-ingest] mode=${cfg.mode} tags=${cfg.tags} target=${cfg.rate} pts/s over ${cfg.duration}s ` +
      `(batch=${cfg.batch}, ~${batchesTotal} batches)`,
  );
  if (cfg.mode === "dry") {
    console.log("[bench-ingest] DRY MODE — no DB/broker touched. Latency reported is HARNESS overhead, not ingest→query.");
  }

  const cpu0 = process.cpuUsage();
  const wall0 = now();
  let peakRssMib = round(process.memoryUsage().rss / 1048576, 1);
  let batchesSent = 0;
  let baseTs = Date.now();
  const chaosLog = [];
  let lastChaos = wall0;

  // Drive in paced ticks until duration elapses.
  await new Promise((resolve) => {
    const timer = setInterval(async () => {
      const elapsedMs = now() - wall0;
      if (elapsedMs >= cfg.duration * 1000 || batchesSent >= batchesTotal) {
        clearInterval(timer);
        resolve();
        return;
      }
      const sends = [];
      for (let b = 0; b < batchesPerTick && batchesSent < batchesTotal; b++) {
        const batch = gen.generateBatch(cfg.batch, baseTs);
        baseTs += cfg.batch;
        batchesSent++;
        sends.push(driver.send(batch));
      }
      await Promise.all(sends).catch(() => {});
      const rss = process.memoryUsage().rss / 1048576;
      if (rss > peakRssMib) peakRssMib = round(rss, 1);

      // Optional Full-Sim chaos injection during soak.
      if (cfg.chaosControl && now() - lastChaos >= cfg.chaosEverySec * 1000) {
        lastChaos = now();
        const lineNo = (chaosLog.length % cfg.lines) + 1;
        const action = chaosLog.length % 2 === 0 ? "opcua.kill" : "opcua.restart";
        const r = await simChaos(cfg.chaosControl, action, { line: lineNo });
        chaosLog.push({ atMs: round(now() - wall0), action, line: lineNo, ok: r.ok });
        console.log(`[bench-ingest] chaos ${action} line=${lineNo} → ${r.ok ? "ok" : "FAILED"}`);
      }
    }, tickMs);
  });

  // Wait out any in-flight queryable probes.
  if (typeof driver.drainProbes === "function") await driver.drainProbes();

  const wallMs = now() - wall0;
  const cpu = process.cpuUsage(cpu0);
  const s = driver.stats();
  const achieved = throughputPerSec(s.sent, wallMs);

  const result = {
    schemaVersion: SCHEMA_VERSION,
    label,
    startedAt: (() => { try { return new Date().toISOString(); } catch { return null; } })(),
    mode: cfg.mode,
    latencyKind: driver.latencyKind,
    config: {
      tags: cfg.tags, targetRate: cfg.rate, durationSec: cfg.duration, batch: cfg.batch,
      seed: cfg.seed, lines: cfg.lines, target: cfg.target, queryUrl: cfg.queryUrl,
      chaosControl: cfg.chaosControl,
    },
    hardware: {
      platform: `${os.platform()} ${os.release()}`,
      nodeVersion: process.version,
      cpu: os.cpus?.()[0]?.model ?? "unknown",
      cpuCores: os.cpus?.().length ?? null,
      totalMemGb: round(os.totalmem() / 1024 / 1024 / 1024, 1),
    },
    throughput: {
      pointsSent: s.sent,
      wallMs: round(wallMs, 1),
      achievedPerSec: round(achieved, 1),
      targetPerSec: cfg.rate,
      achievedPct: round((achieved / cfg.rate) * 100, 1),
    },
    ackLatencyMs: summarize(s.ackLatencies),
    tagToQueryMs: s.tagToQueryLatencies.length ? summarize(s.tagToQueryLatencies) : null,
    errors: s.errors,
    http: s.http,
    resources: {
      cpuUserMs: round(cpu.user / 1000, 1),
      cpuSystemMs: round(cpu.system / 1000, 1),
      cpuPct: round(((cpu.user + cpu.system) / 1000 / wallMs) * 100, 1),
      peakRssMib,
    },
    chaos: chaosLog.length ? chaosLog : null,
  };

  fs.mkdirSync(outDir, { recursive: true });
  const outFile = cfg.out ? path.resolve(cfg.out) : path.join(outDir, `${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

  console.log(
    `\n[bench-ingest] sent=${s.sent} in ${round(wallMs, 0)}ms → ${round(achieved, 0)} pts/s ` +
      `(${result.throughput.achievedPct}% of ${cfg.rate}); ack P95=${result.ackLatencyMs.p95}ms; ` +
      `errors=${s.errors}; peakRSS=${peakRssMib}MiB`,
  );
  if (result.tagToQueryMs) {
    console.log(`[bench-ingest] tag→queryable P95=${result.tagToQueryMs.p95}ms P99=${result.tagToQueryMs.p99}ms (n=${result.tagToQueryMs.n})`);
  }
  console.log(`[bench-ingest] result: ${outFile}`);
  console.log(`[bench-ingest] score it: node scripts/bench/bench-report.mjs "${outFile}"`);
  return 0;
}

async function main() {
  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) { console.log(fs.readFileSync(path.join(__dirname, "README.md"), "utf8")); return 0; }
  const outDir = cfg.out ? path.dirname(path.resolve(cfg.out)) : path.join(__dirname, "results");
  return cfg.selfcheck ? runSelfcheck(cfg, outDir) : runLoad(cfg, outDir);
}

main()
  .then((code) => process.exit(typeof code === "number" ? code : 0))
  .catch((err) => { console.error("[bench-ingest] fatal:", err?.stack ?? err); process.exit(1); });
