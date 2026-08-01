#!/usr/bin/env -S npx tsx
/**
 * doc 48 R3 — LAKE SINK smoke/verify (npm run lake:verify).
 *
 * Proves the cold-tier lake sink writes a real, valid file WITHOUT depending on live
 * ingest telemetry: it starts the sink, publishes a handful of SYNTHETIC telemetry
 * samples through the SAME streaming bus the tap uses, then confirms a gzipped-NDJSON
 * partition file landed under LAKE_DIR and prints its first row.
 *
 * Runs under `tsx` so it imports the REAL server TypeScript (no logic duplication).
 * Works on BOTH backends (publish + consume in one process):
 *   • STREAM_BRIDGE_BACKEND=nats  → the sink's DURABLE JetStream consumer drains NATS.
 *   • STREAM_BRIDGE_BACKEND=inprocess → the sink's in-process (non-durable) source.
 *
 * Non-invasive: forces LAKE_SINK_ENABLED for THIS process only, uses a dedicated
 * `lake_verify` consumer + a `syn/telemetry/lakeverify` subject with no production
 * history, and a small fast batch. It never touches the production `lake_sink`
 * consumer and stops itself when done (does NOT leave a consumer running).
 *
 * Exit 0 = a file was written; exit 1 = nothing landed (see the printed reason).
 */
import dotenv from "dotenv";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

dotenv.config();

// ── Verify overrides (this process only) ─────────────────────────────────────
process.env.LAKE_SINK_ENABLED = "true";
const LAKE_DIR = process.env.LAKE_DIR?.trim() || "./data/lake";
process.env.LAKE_DIR = LAKE_DIR;
const TOPIC = "syn/telemetry/lakeverify";
process.env.LAKE_SOURCE_TOPIC = TOPIC;
const CONSUMER = "lake_verify";
process.env.LAKE_CONSUMER = CONSUMER;
process.env.LAKE_FLUSH_MS = process.env.LAKE_FLUSH_MS || "1500";
process.env.LAKE_BATCH_MAX = process.env.LAKE_BATCH_MAX || "50";
process.env.LAKE_DELIVER_POLICY = "all";
// Prove the deterministic FS path unless the caller explicitly opts into S3.
if (!process.env.LAKE_VERIFY_USE_S3) {
  delete process.env.LAKE_S3_ENDPOINT;
  delete process.env.LAKE_S3_BUCKET;
}

const backend = process.env.STREAM_BRIDGE_BACKEND === "nats" ? "nats" : "inprocess";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Never hang a CI/verify run.
const hardTimeout = setTimeout(() => {
  console.error("[lake:verify] hard timeout (30s) — FAIL");
  process.exit(1);
}, 30_000);
hardTimeout.unref?.();

/** Recursively collect part-<CONSUMER>-*.ndjson.gz files under root. */
async function listLakeFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.startsWith(`part-${CONSUMER}-`) && e.name.endsWith(".ndjson.gz")) out.push(p);
    }
  }
  await walk(root);
  return out;
}

async function main() {
  console.log(
    `[lake:verify] backend=${backend} dir=${LAKE_DIR} topic=${TOPIC} consumer=${CONSUMER} ` +
      `flush=${process.env.LAKE_FLUSH_MS}ms`,
  );

  const { getStreamBridge, resetStreamBridge } = await import("../../server/services/streaming/streamBridge.ts");
  const { startLakeSink, stopLakeSink, getLakeSinkStatus } = await import(
    "../../server/services/streaming/lakeSink.ts"
  );

  const cleanup = async () => {
    try {
      await stopLakeSink();
    } catch {
      /* best-effort */
    }
    try {
      await resetStreamBridge();
    } catch {
      /* best-effort */
    }
  };

  const started = await startLakeSink();
  if (!started) {
    console.error("[lake:verify] sink did not start (LAKE_SINK_ENABLED not honoured?) — FAIL");
    await cleanup();
    return 1;
  }
  console.log(`[lake:verify] sink started: mode=${started.mode} target=${started.target}`);
  if (started.mode !== "nats-durable" && started.mode !== "bridge") {
    console.error(
      `[lake:verify] source UNAVAILABLE (${started.mode}). backend=nats needs NATS reachable on ` +
        `${process.env.NATS_URL || "NATS_URL (unset)"}. FAIL`,
    );
    await cleanup();
    return 1;
  }

  // Let the durable consumer become ready before publishing.
  await sleep(started.mode === "nats-durable" ? 900 : 150);

  const bridge = await getStreamBridge();
  const baseFiles = getLakeSinkStatus().filesWritten;
  const now = Date.now();
  const samples = Array.from({ length: 5 }, (_, i) => ({
    deviceId: `SIM-L9-VERIFY-${i}`,
    machineCode: `SIM-VERIFY`,
    metric: "verify_signal",
    value: Math.round(Math.random() * 1000) / 10,
    ts: new Date(now + i).toISOString(),
    meta: { source: "lake:verify", overallResult: i % 2 ? "OK" : "NG" },
  }));
  const pub = await bridge.publish(TOPIC, samples);
  console.log(
    `[lake:verify] published ${samples.length} synthetic samples → ok=${pub.ok} ` +
      `seq=${pub.seq ?? "-"} reason=${pub.reason ?? "-"}`,
  );
  if (!pub.ok) {
    console.error(`[lake:verify] publish refused (${pub.reason}) — the bus is not available. FAIL`);
    await cleanup();
    return 1;
  }

  // Poll for a flush (sink status.filesWritten increases — robust across re-runs).
  let wrote = false;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    if (getLakeSinkStatus().filesWritten > baseFiles) {
      wrote = true;
      break;
    }
  }

  const status = getLakeSinkStatus();
  console.log("[lake:verify] sink status:", JSON.stringify(status));

  if (!wrote) {
    console.error("[lake:verify] no file was written within ~20s — FAIL");
    await cleanup();
    return 1;
  }

  // Locate + prove the newest file's content.
  const files = await listLakeFiles(LAKE_DIR);
  if (files.length === 0) {
    console.error(`[lake:verify] sink reported a write but no part-${CONSUMER}-*.ndjson.gz found under ${LAKE_DIR} — FAIL`);
    await cleanup();
    return 1;
  }
  const withMtime = await Promise.all(files.map(async (f) => ({ f, m: (await stat(f)).mtimeMs })));
  withMtime.sort((a, b) => b.m - a.m);
  const newest = withMtime[0].f;
  const rows = gunzipSync(await readFile(newest)).toString("utf8").trim().split("\n");
  console.log(`[lake:verify] wrote ${status.filesWritten} file(s), ${status.rowsWritten} row(s), ${status.bytesWritten}B gz`);
  console.log(`[lake:verify] newest: ${newest}  (${rows.length} row(s))`);
  console.log(`[lake:verify] first row: ${rows[0]}`);
  console.log("[lake:verify] PASS");
  await cleanup();
  return 0;
}

main()
  .then((code) => {
    clearTimeout(hardTimeout);
    process.exit(code);
  })
  .catch((err) => {
    clearTimeout(hardTimeout);
    console.error("[lake:verify] ERROR:", err?.stack || err?.message || err);
    process.exit(1);
  });
