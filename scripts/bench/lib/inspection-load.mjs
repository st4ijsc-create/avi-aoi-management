// scripts/bench/lib/inspection-load.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Doc 51 P1 (QĐ#7) — PURE core of the AVI/AOI inspection-ingest benchmark.
//
// Everything here is deterministic and I/O-free so it can be unit-tested without
// a DB, a server, or a network (see server/services/bench/benchInspectionHarness.test.ts).
// The runner (../bench-inspection-ingest.mjs) owns ALL I/O: postgres, fetch, fs.
//
// WHY a second harness next to bench-ingest.mjs: that one drives the OT TELEMETRY
// tier (/api/ot/ingest — flat tag samples, its own high rate-limit tier). This one
// drives the MACHINE INSPECTION tier (submitInspection — per-machine credential,
// N measurement points, base64 images decoded to RAM). Different payload, different
// limiter, different SLA. They are deliberately NOT merged.
// ─────────────────────────────────────────────────────────────────────────────

import { mulberry32 } from "./loadgen.mjs";
import { round, summarize, throughputPerSec } from "./stats.mjs";

/** Serial prefix that makes EVERY row this harness writes identifiable + deletable. */
export const BENCH_SERIAL_PREFIX = "BENCH";
/** Name prefix for the throw-away api_keys rows the harness issues. */
export const BENCH_KEY_NAME_PREFIX = "bench:";
/** Code prefix for synthetic machines the harness provisions (--provision). */
export const BENCH_MACHINE_CODE_PREFIX = "BENCH-M";

// ── CLI ──────────────────────────────────────────────────────────────────────

export const DEFAULTS = {
  machines: 100,
  rate: 1, // inspections/second/machine
  duration: 60, // seconds
  imageKb: 200, // DECODED image bytes per inspection (KiB) — base64 on the wire is ~4/3 of this
  imagePoints: 1, // how many measurement points carry the image (image-kb is split across them)
  points: 20, // measurement points per inspection
  endpoint: "rest", // rest | trpc
  concurrency: 200, // max in-flight HTTP requests across the whole fleet
  auth: "header", // header | body  — see assessTarget()/doc 53 §5: this changes WHICH rate-limit bucket applies
  baseUrl: "http://127.0.0.1:3000",
  dupPct: 0, // % of submissions that intentionally REPLAY the previous payload (idempotency probe)
  ngPct: 5, // % NG results
  ntfPct: 1, // % NTF results
  seed: 51,
  timeoutMs: 30000,
  runId: null,
  label: null,
  out: null,
  yes: false,
  provision: false,
  stationId: null,
  cleanup: null, // runId to clean, or "all"
  keepData: false,
  metricsUrl: null,
  help: false,
};

const INT_FLAGS = new Set([
  "machines", "rate", "duration", "imageKb", "imagePoints", "points",
  "concurrency", "seed", "timeoutMs", "stationId",
]);
const NUM_FLAGS = new Set(["dupPct", "ngPct", "ntfPct"]);
const STR_FLAGS = new Set(["endpoint", "auth", "baseUrl", "runId", "label", "out", "cleanup", "metricsUrl"]);
const BOOL_FLAGS = new Set(["yes", "provision", "keepData", "help"]);

/** `--image-kb` → `imageKb`. */
function camel(flag) {
  return flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Parse `--k=v` / `--k v` / `--bool` argv into a config. Unknown flags are
 * collected into `unknown` (the runner warns) instead of being silently dropped —
 * a typo'd `--machines` must never quietly benchmark the default 100.
 */
export function parseArgs(argv) {
  const cfg = { ...DEFAULTS, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    if (tok === "-h" || tok === "--help") { cfg.help = true; continue; }
    let raw = tok.slice(2);
    let val = null;
    const eq = raw.indexOf("=");
    if (eq !== -1) { val = raw.slice(eq + 1); raw = raw.slice(0, eq); }
    const key = camel(raw);

    if (BOOL_FLAGS.has(key)) {
      cfg[key] = val == null ? true : !/^(0|false|no)$/i.test(val);
      continue;
    }
    if (val == null) {
      const nxt = argv[i + 1];
      if (nxt != null && !nxt.startsWith("--")) { val = nxt; i++; }
    }
    if (INT_FLAGS.has(key)) {
      const n = Number.parseInt(val, 10);
      if (Number.isFinite(n)) cfg[key] = n;
      else cfg.unknown.push(`${tok} (not an integer)`);
      continue;
    }
    if (NUM_FLAGS.has(key)) {
      const n = Number.parseFloat(val);
      if (Number.isFinite(n)) cfg[key] = n;
      else cfg.unknown.push(`${tok} (not a number)`);
      continue;
    }
    if (STR_FLAGS.has(key)) { cfg[key] = val; continue; }
    cfg.unknown.push(tok);
  }
  return cfg;
}

/**
 * Reject configs that cannot produce an honest measurement. Returns a list of
 * human errors (empty = OK).
 */
export function validateConfig(cfg) {
  const errs = [];
  if (cfg.machines < 1) errs.push("--machines must be ≥ 1");
  if (cfg.rate <= 0) errs.push("--rate must be > 0 (inspections/second/machine)");
  if (cfg.duration < 1) errs.push("--duration must be ≥ 1 second");
  // points=0 is legal: the server schema accepts an empty measurements[], and a
  // header-only run is the SMOKE mode that proves auth → insert → ACK → DB count
  // without depending on measurement_point_defs seed data being present.
  if (cfg.points < 0) errs.push("--points must be ≥ 0 (0 = header-only smoke run)");
  if (cfg.imageKb < 0) errs.push("--image-kb must be ≥ 0 (0 = no images)");
  if (cfg.imagePoints < 1) errs.push("--image-points must be ≥ 1");
  if (cfg.points === 0 && cfg.imageKb > 0) {
    errs.push("--points=0 cannot carry images (images ride on measurements) — set --image-kb=0");
  }
  if (cfg.points > 0 && cfg.imagePoints > cfg.points) errs.push("--image-points cannot exceed --points");
  if (cfg.concurrency < 1) errs.push("--concurrency must be ≥ 1");
  if (!["rest", "trpc"].includes(cfg.endpoint)) errs.push(`--endpoint must be "rest" or "trpc" (got "${cfg.endpoint}")`);
  if (!["header", "body"].includes(cfg.auth)) errs.push(`--auth must be "header" or "body" (got "${cfg.auth}")`);
  if (cfg.dupPct < 0 || cfg.dupPct > 100) errs.push("--dup-pct must be within 0..100");
  if (cfg.ngPct < 0 || cfg.ntfPct < 0 || cfg.ngPct + cfg.ntfPct > 100) errs.push("--ng-pct + --ntf-pct must be within 0..100");
  return errs;
}

// ── SAFETY GUARD ─────────────────────────────────────────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Private/loopback IPv4 or a loopback name → "not somebody's production box". */
export function isLocalHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK.has(h) || LOOPBACK.has(`[${h}]`)) return true;
  if (h === "host.docker.internal") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}
function dbNameOf(url) {
  try { return new URL(url).pathname.replace(/^\//, "") || null; } catch { return null; }
}

/** Mask credentials so a URL is safe to print/persist in a result file. */
export function maskUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return String(url).replace(/\/\/[^@]*@/, "//***@");
  }
}

/**
 * Doc 51 P1 — the production guard (same posture as scripts/setup-test-db.mjs:
 * REFUSE by default, never "warn and proceed"). This harness WRITES tens of
 * thousands of inspection rows and hammers the ingest path; running it against a
 * real line's DB would both corrupt the yield numbers and DoS the factory.
 *
 * A target is RISKY when ANY of:
 *   • NODE_ENV=production
 *   • the DB name looks like prod/production/live
 *   • the DB host is neither loopback nor an RFC1918 address
 *   • the app base URL host is neither loopback nor RFC1918
 *
 * Returns { risky, reasons[] } — the runner decides (and the escape hatch is a
 * loud, documented env var, so "I meant to" is always an explicit act).
 */
export function assessTarget({ databaseUrl, baseUrl, nodeEnv } = {}) {
  const reasons = [];
  if ((nodeEnv || "").toLowerCase() === "production") {
    reasons.push("NODE_ENV=production");
  }
  const dbName = dbNameOf(databaseUrl);
  if (dbName && /(^|[_-])(prod|production|live)([_-]|$)/i.test(dbName)) {
    reasons.push(`DB name "${dbName}" looks like production`);
  }
  const dbHost = hostOf(databaseUrl);
  if (dbHost && !isLocalHost(dbHost)) {
    reasons.push(`DB host "${dbHost}" is not loopback/private (remote DB)`);
  }
  const appHost = hostOf(baseUrl);
  if (appHost && !isLocalHost(appHost)) {
    reasons.push(`app host "${appHost}" is not loopback/private (remote server)`);
  }
  return { risky: reasons.length > 0, reasons };
}

// ── payload generation ───────────────────────────────────────────────────────

/** Stable, greppable, deletable serial. */
export function serialFor(runId, machineIdx, seq) {
  return `${BENCH_SERIAL_PREFIX}-${runId}-${machineIdx}-${seq}`;
}
/** LIKE pattern matching every serial of a run (or every run when runId="all"). */
export function serialLikeFor(runId) {
  return runId === "all" ? `${BENCH_SERIAL_PREFIX}-%` : `${BENCH_SERIAL_PREFIX}-${runId}-%`;
}

/**
 * A base64 blob that decodes to ~`kb` KiB. It carries a real JPEG SOI/EOI so
 * anything downstream that sniffs the magic bytes sees a JPEG, while the body is
 * incompressible pseudo-random data (a run of zeros would understate storage and
 * any compression cost). Deterministic for a given rng.
 *
 * NOTE the units: `kb` is the DECODED size — that is the Buffer the server holds
 * in RAM (doc 51 §5.4). The wire cost is ~4/3 of it; the runner reports both.
 */
export function makeImageBase64(kb, rng) {
  const bytes = Math.max(0, Math.round(kb * 1024));
  if (bytes === 0) return "";
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = Math.floor(rng() * 256) & 0xff;
  // JPEG magic so the payload is not obviously bogus to a sniffer.
  if (bytes >= 4) {
    buf[0] = 0xff; buf[1] = 0xd8; // SOI
    buf[bytes - 2] = 0xff; buf[bytes - 1] = 0xd9; // EOI
  }
  return buf.toString("base64");
}

/**
 * Build ONE submitInspection payload that matches submitInspectionInputSchema
 * (server/routers/machineApiRouters.ts). Deterministic given `rng`.
 *
 * Doc 51 P0 compliance: serialNumber is trimmed, non-empty, ≤100 chars — a blank
 * serial is exempt from the idempotency index, so the harness must never send one
 * (it would measure a hole instead of the fix).
 */
export function buildInspection(opts) {
  const {
    runId, machineIdx, machineCode, seq, rng,
    points = DEFAULTS.points,
    imageKb = DEFAULTS.imageKb,
    imagePoints = DEFAULTS.imagePoints,
    ngPct = DEFAULTS.ngPct,
    ntfPct = DEFAULTS.ntfPct,
    apiKey = null,
    inspectionTime = new Date().toISOString(),
    productModel,
  } = opts;

  const roll = rng() * 100;
  const overallResult = roll < ngPct ? "NG" : roll < ngPct + ntfPct ? "NTF" : "OK";
  const serialNumber = serialFor(runId, machineIdx, seq);
  if (serialNumber.length > 100) {
    throw new Error(`bench serial "${serialNumber}" exceeds the 100-char column bound — shorten --run-id`);
  }

  const imgKbPerPoint = imageKb > 0 ? imageKb / imagePoints : 0;
  const measurements = [];
  for (let p = 0; p < points; p++) {
    // Only the failing board's points may report NG — keeps the NG/OK mix coherent
    // with overallResult so the server's spec-gate/alert paths see realistic input.
    const pointNg = overallResult === "NG" && p === Math.floor(rng() * points);
    const m = {
      pointCode: `BP${String(p + 1).padStart(3, "0")}`,
      measuredValue: round(1 + rng() * 0.2, 4),
      result: pointNg ? "NG" : overallResult === "NTF" ? "NTF" : "OK",
      // 3D metrology fields (doc 51 §5): exercised so the decimal-cast path is
      // measured, not skipped.
      valueHeight: round(0.2 + rng() * 0.05, 4),
      valueArea: round(1.5 + rng() * 0.3, 4),
      valueVolume: round(0.3 + rng() * 0.1, 4),
      valueOffsetX: round((rng() - 0.5) * 0.05, 4),
      valueOffsetY: round((rng() - 0.5) * 0.05, 4),
    };
    if (pointNg) {
      m.remark = "bench synthetic defect";
      m.defectSeverity = "minor";
    }
    if (p < imagePoints && imgKbPerPoint > 0) m.imageBase64 = makeImageBase64(imgKbPerPoint, rng);
    measurements.push(m);
  }

  const payload = {
    machineCode,
    serialNumber,
    overallResult,
    inspectionTime,
    cycleTime: round(2 + rng() * 1.5, 3),
    batchNumber: `BENCH-LOT-${runId}`,
    panelId: `${serialNumber}-P`,
    boardIndex: 1,
    measurements,
  };
  if (productModel) payload.productModel = productModel;
  if (apiKey) payload.apiKey = apiKey;
  return payload;
}

/** Rough wire size of a JSON payload in bytes (no I/O). */
export function payloadBytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

// ── outcome classification ───────────────────────────────────────────────────

/**
 * Map ONE attempt to a bucket. The buckets are the report's spine, so they must
 * distinguish the four states doc 51 cares about:
 *   ok        — persisted (or at least claimed persisted) with a real inspectionId
 *   duplicate — P0 idempotency short-circuit hit (success + duplicate:true)
 *   queued    — store-and-forward ACK: success:true, queued:true, inspectionId:null.
 *               ACCEPTED BUT NOT IN THE DB YET — the silent-data-loss vector. It is
 *               NOT counted as ok, ever.
 *   http_4xx / http_429 / http_5xx / http_503 / network / timeout
 *
 * `status` is the HTTP status (0 = no response), `body` the parsed JSON (or null).
 */
export function classifyOutcome(status, body) {
  if (status === 0) return "network";
  if (status === -1) return "timeout";
  if (status >= 200 && status < 300) {
    const data = unwrapBody(body);
    if (data && data.success === false) return "app_error"; // REST proxy 200-with-failure guard
    if (data && data.queued === true) return "queued";
    if (data && data.duplicate === true) return "duplicate";
    if (data && (typeof data.inspectionId === "number")) return "ok";
    return "ok_unknown_shape";
  }
  if (status === 429) return "http_429";
  if (status === 503) return "http_503";
  if (status >= 500) return "http_5xx";
  if (status >= 400) return "http_4xx";
  return "http_other";
}

/**
 * Pull the result object out of either shape:
 *   REST  → { success, inspectionId, ... }
 *   tRPC  → { result: { data: { json: { success, ... } } } }   (superjson)
 */
export function unwrapBody(body) {
  if (!body || typeof body !== "object") return null;
  const j = body?.result?.data?.json;
  if (j && typeof j === "object") return j;
  const d = body?.result?.data;
  if (d && typeof d === "object" && !("json" in d)) return d;
  return body;
}

/** tRPC transports the error code in the body; HTTP status alone can lie. */
export function trpcErrorCode(body) {
  return body?.error?.json?.data?.code ?? body?.error?.data?.code ?? null;
}

// ── report ───────────────────────────────────────────────────────────────────

/**
 * Turn raw counters into the result document. PURE: every number in the report
 * is derived here, so the markdown/JSON and the tests agree by construction.
 */
export function buildResult({ cfg, runId, startedAt, wallMs, latencies, buckets, dbCounts, resources, machines, wireBytes, hardware }) {
  const attempts = Object.values(buckets).reduce((a, b) => a + b, 0);
  const ok = buckets.ok ?? 0;
  const duplicate = buckets.duplicate ?? 0;
  const queued = buckets.queued ?? 0;
  const accepted = ok + duplicate + queued;
  const failed = attempts - accepted;
  const targetTotal = Math.round(cfg.machines * cfg.rate * cfg.duration);

  // ── the load-bearing numbers ────────────────────────────────────────────────
  // Rows the server SAID it wrote vs rows the DB ACTUALLY has for this run.
  //
  // `queued` (store-and-forward ACK) makes a naive `ok − dbRows` meaningless: a
  // queued submission is NOT in the DB at ACK time but MAY be replayed into it by
  // the WAL backfill moments later. So the DB count is only bounded, not exact:
  //     minExpected = ok            (nothing replayed yet)
  //     maxExpected = ok + queued   (everything replayed)
  // Below min → rows the server promised and cannot show   = SILENT DATA LOSS.
  // Above max → rows nobody acked for                      = unexplained excess.
  // Both are reported; neither is folded into a single signed number that could
  // cancel out (the earlier `ok − dbRows` reported "-4" for a healthy replay and
  // would have reported "0" for 4 lost + 4 replayed — an average, not a fact).
  const dbRows = dbCounts?.rows ?? null;
  const dbDistinct = dbCounts?.distinctSerials ?? null;
  const minExpected = ok;
  const maxExpected = ok + queued;
  const lost = dbRows == null ? null : Math.max(0, minExpected - dbRows);
  const excess = dbRows == null ? null : Math.max(0, dbRows - maxExpected);

  return {
    schemaVersion: 1,
    harness: "bench-inspection-ingest",
    doc: "docs/ECOSYSTEM/53_P1_INGEST_BENCHMARK_HARNESS.md",
    runId,
    label: cfg.label ?? runId,
    startedAt,
    config: {
      machines: cfg.machines,
      ratePerMachine: cfg.rate,
      durationSec: cfg.duration,
      points: cfg.points,
      imageKb: cfg.imageKb,
      imagePoints: cfg.imagePoints,
      endpoint: cfg.endpoint,
      auth: cfg.auth,
      concurrency: cfg.concurrency,
      dupPct: cfg.dupPct,
      baseUrl: cfg.baseUrl,
      seed: cfg.seed,
      machinesProvisioned: machines?.provisioned ?? 0,
      machinesReused: machines?.reused ?? 0,
    },
    hardware: hardware ?? null,
    throughput: {
      targetPerSec: round(cfg.machines * cfg.rate, 2),
      targetTotal,
      attempts,
      accepted,
      achievedPerSec: round(throughputPerSec(accepted, wallMs), 2),
      // How much of the demanded load the harness actually managed to OFFER. If
      // this is < ~99% the CLIENT was the bottleneck and the server numbers are
      // an under-estimate — say so rather than claim a pass.
      offeredPct: targetTotal > 0 ? round((attempts / targetTotal) * 100, 1) : null,
      acceptedPct: attempts > 0 ? round((accepted / attempts) * 100, 1) : null,
      wallMs: round(wallMs, 1),
      wireMbTotal: wireBytes != null ? round(wireBytes / 1048576, 2) : null,
      wireMbPerSec: wireBytes != null ? round(throughputPerSec(wireBytes, wallMs) / 1048576, 2) : null,
    },
    latencyMs: summarize(latencies, 1),
    buckets,
    errorRatePct: attempts > 0 ? round((failed / attempts) * 100, 2) : null,
    integrity: {
      okAcks: ok,
      duplicateAcks: duplicate,
      queuedAcks: queued,
      dbRows,
      dbDistinctSerials: dbDistinct,
      minExpectedRows: minExpected,
      maxExpectedRows: maxExpected,
      // ok acks the DB cannot account for. >0 = SILENT DATA LOSS.
      unaccountedRows: lost,
      // Rows nobody acked for. >0 = the run wrote more than it was told to.
      unexplainedExcessRows: excess,
      // Rows beyond one-per-serial. >0 = the P0 idempotency key FAILED under load.
      duplicateRowsInDb: dbRows != null && dbDistinct != null ? dbRows - dbDistinct : null,
      // Rows still only in the disk WAL (accepted, not yet queryable).
      queuedNotInDb: queued,
    },
    resources: resources ?? null,
  };
}

/**
 * Score a result against SLA thresholds. Returns { pass, gates[] } where a gate
 * with pass:null means NOT MEASURED — never silently a pass (doc 53 §4).
 */
export function evaluateGates(result, thresholds = DEFAULT_THRESHOLDS) {
  const gates = [];
  const add = (label, measured, threshold, mode, unit, note) => {
    if (measured == null || !Number.isFinite(measured)) {
      gates.push({ label, measured: null, threshold, mode, unit, pass: null, note: note ?? "not measured" });
      return;
    }
    gates.push({ label, measured, threshold, mode, unit, pass: mode === "min" ? measured >= threshold : measured <= threshold });
  };
  add("offered load (harness kept up)", result.throughput.offeredPct, thresholds.offeredPctMin, "min", "%");
  add("accepted rate", result.throughput.acceptedPct, thresholds.acceptedPctMin, "min", "%");
  add("error rate", result.errorRatePct, thresholds.errorPctMax, "max", "%");
  add("latency p95", result.latencyMs?.p95, thresholds.p95Max, "max", "ms");
  add("latency p99", result.latencyMs?.p99, thresholds.p99Max, "max", "ms");
  add("unaccounted rows (data loss)", result.integrity.unaccountedRows, 0, "max", "rows");
  add("unexplained excess rows", result.integrity.unexplainedExcessRows, 0, "max", "rows");
  add("duplicate rows in DB (P0 idempotency)", result.integrity.duplicateRowsInDb, 0, "max", "rows");
  // A queued ACK is "accepted but not queryable". Tolerating it silently would let
  // a run whose DB never received the data report a clean pass.
  add("queued-not-in-DB (store-forward backlog)", result.integrity.queuedNotInDb, thresholds.queuedMax, "max", "rows");
  const hard = gates.filter((g) => g.pass === false);
  const unmeasured = gates.filter((g) => g.pass === null);
  return { pass: hard.length === 0 && unmeasured.length === 0, failed: hard.length, unmeasured: unmeasured.length, gates };
}

/**
 * Doc 53 §4 — PROPOSED SLA gates for "100 machines × 1/s + 200KB image".
 * These are a STARTING POINT for the owner to ratify against a measured
 * baseline, not a measured fact. Do not cite them as achieved numbers.
 */
export const DEFAULT_THRESHOLDS = {
  offeredPctMin: 99,
  acceptedPctMin: 99.9,
  errorPctMax: 0.1,
  p95Max: 1000,
  p99Max: 2000,
  queuedMax: 0,
};

/** Markdown summary (the human artifact that accompanies the JSON). */
export function renderMarkdown(result, gateResult) {
  const t = result.throughput;
  const l = result.latencyMs ?? {};
  const i = result.integrity;
  const c = result.config;
  const lines = [];
  lines.push(`# Bench ingest inspection — \`${result.runId}\``);
  lines.push("");
  lines.push(`- Thời điểm: ${result.startedAt}`);
  lines.push(`- Kịch bản: **${c.machines} máy × ${c.ratePerMachine}/s × ${c.durationSec}s** · ${c.points} điểm đo · ảnh ${c.imageKb}KB × ${c.imagePoints} điểm`);
  lines.push(`- Endpoint: \`${c.endpoint}\` · auth: \`${c.auth}\` · concurrency ${c.concurrency} · baseUrl ${c.baseUrl}`);
  if (result.hardware) lines.push(`- Máy chạy bench: ${result.hardware.cpu} (${result.hardware.cpuCores} lõi), Node ${result.hardware.nodeVersion}`);
  lines.push("");
  lines.push("## Thông lượng");
  lines.push("");
  lines.push("| Chỉ số | Giá trị |");
  lines.push("|---|---|");
  lines.push(`| Mục tiêu | ${t.targetPerSec}/s (${t.targetTotal} bản) |`);
  lines.push(`| Đã gửi (attempts) | ${t.attempts} (${t.offeredPct ?? "?"}% mục tiêu) |`);
  lines.push(`| Được nhận (accepted) | ${t.accepted} (${t.acceptedPct ?? "?"}%) |`);
  lines.push(`| Đạt được | **${t.achievedPerSec}/s** trong ${t.wallMs}ms |`);
  lines.push(`| Băng thông | ${t.wireMbTotal ?? "?"} MB (${t.wireMbPerSec ?? "?"} MB/s) |`);
  lines.push("");
  lines.push("## Độ trễ (ms)");
  lines.push("");
  lines.push("| n | p50 | p95 | p99 | p99.9 | max |");
  lines.push("|---|---|---|---|---|---|");
  lines.push(`| ${l.n ?? 0} | ${l.p50 ?? "-"} | ${l.p95 ?? "-"} | ${l.p99 ?? "-"} | ${l.p999 ?? "-"} | ${l.max ?? "-"} |`);
  lines.push("");
  lines.push("## Kết quả theo mã (bucket)");
  lines.push("");
  lines.push("| Bucket | Số lượng |");
  lines.push("|---|---|");
  for (const [k, v] of Object.entries(result.buckets).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${k}\` | ${v} |`);
  }
  lines.push(`| **tỉ lệ lỗi** | **${result.errorRatePct ?? "?"}%** |`);
  lines.push("");
  lines.push("## Chính trực dữ liệu (đếm lại TỪ DB)");
  lines.push("");
  lines.push("| Chỉ số | Giá trị | Ý nghĩa |");
  lines.push("|---|---|---|");
  lines.push(`| ACK ok | ${i.okAcks} | server nói đã ghi |`);
  lines.push(`| ACK queued (WAL) | ${i.queuedAcks} | nhận rồi nhưng **chưa vào DB** |`);
  lines.push(`| Dòng DB dự kiến | ${i.minExpectedRows}..${i.maxExpectedRows} | ok .. ok+queued (queued có thể đã replay) |`);
  lines.push(`| Dòng trong DB | ${i.dbRows ?? "KHÔNG ĐO"} | đếm lại từ \`product_inspections\` |`);
  lines.push(`| **Thất thoát âm thầm** | **${i.unaccountedRows ?? "KHÔNG ĐO"}** | thiếu so với ACK ok · **phải = 0** |`);
  lines.push(`| Dòng dư không giải thích được | ${i.unexplainedExcessRows ?? "KHÔNG ĐO"} | nhiều hơn ok+queued · **phải = 0** |`);
  lines.push(`| **Dòng trùng trong DB** | **${i.duplicateRowsInDb ?? "KHÔNG ĐO"}** | dòng − serial khác nhau · **phải = 0** (P0 0272) |`);
  lines.push(`| ACK duplicate | ${i.duplicateAcks} | P0 short-circuit đã bắt |`);
  lines.push("");
  if (result.resources) {
    lines.push("## Tài nguyên app-server");
    lines.push("");
    if (result.resources.note) lines.push(`> ${result.resources.note}`);
    else {
      lines.push("| Chỉ số | Trước | Đỉnh | Sau |");
      lines.push("|---|---|---|---|");
      lines.push(`| RSS (MiB) | ${result.resources.rssStartMib ?? "-"} | ${result.resources.rssPeakMib ?? "-"} | ${result.resources.rssEndMib ?? "-"} |`);
      lines.push(`| Heap dùng (MiB) | ${result.resources.heapStartMib ?? "-"} | ${result.resources.heapPeakMib ?? "-"} | ${result.resources.heapEndMib ?? "-"} |`);
    }
    lines.push("");
  }
  if (gateResult) {
    lines.push("## Chấm ngưỡng SLA (đề xuất — chờ chủ hệ chốt)");
    lines.push("");
    lines.push("| Cổng | Đo được | Ngưỡng | Kết |");
    lines.push("|---|---|---|---|");
    for (const g of gateResult.gates) {
      const verdict = g.pass === null ? "⚠ KHÔNG ĐO" : g.pass ? "PASS" : "**FAIL**";
      lines.push(`| ${g.label} | ${g.measured ?? "-"}${g.unit} | ${g.mode === "min" ? "≥" : "≤"} ${g.threshold}${g.unit} | ${verdict} |`);
    }
    lines.push("");
    lines.push(`**Tổng: ${gateResult.pass ? "PASS" : "FAIL"}** (${gateResult.failed} fail, ${gateResult.unmeasured} không đo được)`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Deterministic RNG per machine so a rerun with the same seed replays the load. */
export function rngForMachine(seed, machineIdx) {
  return mulberry32((seed >>> 0) + machineIdx * 7919);
}

/** Parse a prometheus text exposition for the gauges we need (no dep). */
export function parsePromGauge(text, name) {
  if (!text) return null;
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)\\s*$`, "m");
  const m = re.exec(text);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}
