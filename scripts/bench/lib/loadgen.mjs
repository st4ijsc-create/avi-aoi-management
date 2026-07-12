// scripts/bench/lib/loadgen.mjs
// ─────────────────────────────────────────────────────────────────────────────
// doc 44 W7-3 (G1.19) — DETERMINISTIC synthetic telemetry load generator.
//
// Produces CanonicalSample-shaped objects (the exact shape telemetryBus.ingest
// consumes: {ts, deviceId, protocol, metric, value, unit, quality, meta}) so the
// same batch can be fed to the real ingest path OR measured in-process. Given the
// same `seed` it emits byte-identical batches → reproducible benchmark runs and a
// determinism unit test (benchStats.test.ts).
//
// NO real device data is fabricated into the DB by this file — it only SHAPES
// synthetic load; a driver (drivers.mjs) decides whether/where to send it. This
// keeps the honesty invariant: the generator is a load tool, not a data source.
// ─────────────────────────────────────────────────────────────────────────────

/** mulberry32 — tiny deterministic PRNG (32-bit). Same seed → same stream. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Metric templates spread across each synthetic device so a "tag" = (device, metric).
const METRICS = [
  { metric: "spindle_speed", unit: "rpm", base: 1100, jitter: 60, kind: "num" },
  { metric: "temperature", unit: "°C", base: 45, jitter: 4, kind: "num" },
  { metric: "vibration", unit: "mm/s", base: 2.1, jitter: 0.9, kind: "num" },
  { metric: "cycle_count", unit: "", base: 0, jitter: 0, kind: "counter" },
  { metric: "ng_rate", unit: "%", base: 2.5, jitter: 1.5, kind: "num" },
  { metric: "running", unit: "", base: 1, jitter: 0, kind: "bool" },
];

/**
 * Build a deterministic generator over `tagCount` logical tags spread across
 * `deviceCount` synthetic devices (each device carries METRICS.length metrics).
 * `linePrefix` labels the site/line so the stream processor can enrich by line.
 *
 * Returns { tagCount, deviceCount, generateBatch(count, baseTsMs) } where
 * generateBatch yields exactly `count` CanonicalSample objects with monotonically
 * increasing ts starting at baseTsMs.
 */
export function makeLoadGenerator({ tagCount = 20000, deviceCount, seed = 1337, lineCount = 3 } = {}) {
  const perDevice = METRICS.length;
  const devices = deviceCount ?? Math.max(1, Math.ceil(tagCount / perDevice));
  const rnd = mulberry32(seed);
  const counters = new Map(); // deviceId|metric → running counter (deterministic)

  function deviceId(i) {
    const line = (i % lineCount) + 1;
    return `SIM-L${line}-DEV${String(i).padStart(4, "0")}`;
  }

  /** Generate `count` samples. Cycles (device, metric) round-robin for even spread. */
  function generateBatch(count, baseTsMs = 0) {
    const out = new Array(count);
    for (let k = 0; k < count; k++) {
      const flat = k % tagCount;
      const devIdx = Math.floor(flat / perDevice) % devices;
      const m = METRICS[flat % perDevice];
      const dev = deviceId(devIdx);
      let value;
      if (m.kind === "counter") {
        const key = `${dev}|${m.metric}`;
        const c = (counters.get(key) ?? 0) + 1;
        counters.set(key, c);
        value = c;
      } else if (m.kind === "bool") {
        value = rnd() > 0.02; // ~2% "not running"
      } else {
        value = Math.round((m.base + (rnd() * 2 - 1) * m.jitter) * 1000) / 1000;
      }
      out[k] = {
        ts: new Date(baseTsMs + k).toISOString(),
        deviceId: dev,
        protocol: "opcua",
        metric: m.metric,
        value,
        unit: m.unit || undefined,
        quality: "good",
        meta: { synthetic: true, bench: true },
      };
    }
    return out;
  }

  return { tagCount, deviceCount: devices, lineCount, generateBatch };
}
