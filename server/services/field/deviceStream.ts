/**
 * Khối 1 (doc 16 §5 / §15 X1-c) — Device push-streaming with TIERED sampling.
 *  Flag: FIELD_V2_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The device-level analog of T1's twin stream. It pushes UDM state/position deltas to
 * the per-device room `device:{deviceId}` so a device-monitor view updates in (near)
 * real time instead of polling every 5s.
 *
 * NO TWIN-GATEWAY DUPLICATION: it SUBSCRIBES to the SAME unified telemetry bus via the
 * SAME in-process tap (telemetryBus.registerTelemetryTap) and uses the SAME socket
 * helper pattern — it does NOT build a second socket server, a second bus, or re-derive
 * deltas the twin already produces. The two gateways differ ONLY in fan-out target and
 * payload shape:
 *   • twinStream  → room `twin:{factoryId}`, payload = position/state deltas for 3D.
 *   • deviceStream→ room `device:{deviceId}`, payload = the FULL UDM metric set per
 *                   device, each metric COALESCED at its own TIER rate.
 *
 * TIERED SAMPLING (the X1 ask): each metric has a max emit rate (Hz) by metric class:
 *   • position (AMR pose: position_x/position_y/pose) ~10Hz
 *   • machine state (state/mode/packml_state/estop)   ~1Hz
 *   • slow analog (temperature/…)                     ~0.1Hz
 *   • default                                          1Hz
 * Within a metric's tier window only the LATEST value survives (coalesce, last-wins);
 * a faster ingest burst is collapsed to the tier rate. Tier rates are configurable via
 * env (FIELD_STREAM_HZ_POSITION / _STATE / _SLOW / _DEFAULT).
 *
 * GATING: nothing taps or emits unless FIELD_V2_ENABLED. When off, start() is a no-op
 * → the FE 5s poll remains the fallback, unchanged.
 *
 * SAFETY: signal-only. No device write, no DB write on this path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { InsertOtTelemetry } from "../../../drizzle/schema";
import type { DeviceStreamDelta } from "../../_core/socket";

let unsubscribe: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** A metric's tier: its max emit rate (Hz) and last-emitted timestamp per device. */
type MetricTier = "position" | "state" | "slow" | "default";

/** Pending coalesced value per `${deviceId}|${metric}` (last value wins until flushed). */
interface PendingMetric {
  deviceId: string;
  metric: string;
  value: number | string | boolean | null;
  tier: MetricTier;
  ts: number;
}
const pending = new Map<string, PendingMetric>();
// Last time `${deviceId}|${metric}` was actually EMITTED — enforces the tier rate.
const lastEmit = new Map<string, number>();

function enabled(): boolean {
  return process.env.FIELD_V2_ENABLED === "true" || process.env.FIELD_V2_ENABLED === "1";
}

/** Per-tier max Hz (configurable). The flush timer runs at the FASTEST tier rate. */
export function tierHz(tier: MetricTier): number {
  const env = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  switch (tier) {
    case "position": return Math.min(30, env("FIELD_STREAM_HZ_POSITION", 10));
    case "state": return Math.min(30, env("FIELD_STREAM_HZ_STATE", 1));
    case "slow": return env("FIELD_STREAM_HZ_SLOW", 0.1);
    default: return Math.min(30, env("FIELD_STREAM_HZ_DEFAULT", 1));
  }
}

/** PURE — classify a metric name into a sampling tier. Exported for unit-testing. */
export function tierForMetric(metric: string): MetricTier {
  const m = (metric ?? "").toLowerCase();
  if (m === "position_x" || m === "position_y" || m === "pos_x" || m === "pos_y" || m === "x" || m === "y" || m === "pose") {
    return "position";
  }
  if (m === "state" || m === "mode" || m === "packml_state" || m === "operation_status" || m === "estop" || m === "busy") {
    return "state";
  }
  if (m === "temperature" || m === "temp" || m === "humidity" || m === "vibration" || m === "pressure") {
    return "slow";
  }
  return "default";
}

/**
 * PURE — decide whether a metric is due to emit given its tier rate. Exported for tests.
 * `lastEmitMs` is the last emit time (or undefined if never). due iff now-last >= window.
 */
export function isDue(tier: MetricTier, now: number, lastEmitMs: number | undefined): boolean {
  if (lastEmitMs == null) return true;
  const windowMs = 1000 / tierHz(tier);
  return now - lastEmitMs >= windowMs;
}

/** Logical device key from a canonical row (machine preferred, else external deviceId). */
function deviceKeyOf(row: InsertOtTelemetry): string {
  if (row.machineId != null) return `machine:${row.machineId}`;
  return `device:${row.deviceId ?? "unknown"}`;
}

/** Raw value from a canonical row (exactly one of num/text/bool is set). */
function valueOf(row: InsertOtTelemetry): number | string | boolean | null {
  if (row.numValue != null) return row.numValue;
  if (row.boolValue != null) return row.boolValue;
  if (row.textValue != null) return row.textValue;
  return null;
}

/** Tap handler — coalesce each sample into the pending map (last value wins per metric). */
function onTelemetryBatch(rows: InsertOtTelemetry[]): void {
  if (!enabled()) return;
  const now = Date.now();
  for (const row of rows) {
    const deviceId = deviceKeyOf(row);
    const metric = row.metric;
    if (!metric) continue;
    const tier = tierForMetric(metric);
    pending.set(`${deviceId}|${metric}`, { deviceId, metric, value: valueOf(row), tier, ts: now });
  }
}

/**
 * Flush — for every pending metric that is DUE per its tier, group by device and emit
 * one device:state delta per device carrying all its due metrics. Coalescing means a
 * metric that arrived 50x in the window is emitted once at its tier rate.
 */
function flush(now: number = Date.now()): void {
  if (pending.size === 0) return;
  const byDevice = new Map<string, DeviceStreamDelta>();
  for (const [key, p] of pending) {
    if (!isDue(p.tier, now, lastEmit.get(key))) continue; // tier rate-limit
    let d = byDevice.get(p.deviceId);
    if (!d) { d = { deviceId: p.deviceId, metrics: {}, ts: now }; byDevice.set(p.deviceId, d); }
    d.metrics[p.metric] = p.value;
    lastEmit.set(key, now);
    pending.delete(key); // emitted → drop (a fresh sample re-adds it)
  }
  if (byDevice.size === 0) return;
  // Lazy import keeps this module free of a socket import cycle.
  import("../../_core/socket")
    .then(({ emitDeviceDeltas }) => emitDeviceDeltas([...byDevice.values()]))
    .catch((err) => console.error("[DeviceStream] flush failed:", (err as Error)?.message ?? err));
}

/**
 * Start the device-stream gateway: register the telemetry tap + start the flush timer.
 * Flag-gated: a no-op (and logs why) when FIELD_V2_ENABLED is off. Idempotent. The
 * timer runs at the FASTEST tier (position) so a 10Hz pose is delivered at ~10Hz while
 * slower metrics stay rate-limited by isDue().
 */
export function startDeviceStreamGateway(): void {
  if (started) return;
  if (!enabled()) {
    console.log("[DeviceStream] gateway NOT started (FIELD_V2_ENABLED off) — FE falls back to 5s poll");
    return;
  }
  started = true;
  const fastestHz = Math.max(tierHz("position"), tierHz("state"), tierHz("default"), 1);
  const intervalMs = Math.max(10, Math.round(1000 / fastestHz));
  import("../telemetryBus")
    .then(({ registerTelemetryTap }) => {
      unsubscribe = registerTelemetryTap((rows) => onTelemetryBatch(rows));
    })
    .catch((err) => console.error("[DeviceStream] tap registration failed:", (err as Error)?.message ?? err));
  flushTimer = setInterval(() => flush(), intervalMs);
  if (typeof (flushTimer as any)?.unref === "function") (flushTimer as any).unref();
  console.log(`[DeviceStream] gateway started (tiers pos=${tierHz("position")}Hz state=${tierHz("state")}Hz slow=${tierHz("slow")}Hz, flush every ${intervalMs}ms → room device:{id})`);
}

/** Stop the gateway (tests / shutdown). */
export function stopDeviceStreamGateway(): void {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  pending.clear();
  lastEmit.clear();
  started = false;
}

// ── test/inspection hooks (no side effects) ──────────────────────────────────
export function _ingestForTest(rows: InsertOtTelemetry[]): void { onTelemetryBatch(rows); }
export function _collectFlush(now: number = Date.now()): DeviceStreamDelta[] {
  // Same logic as flush() but RETURNS the deltas instead of emitting (for tests).
  const byDevice = new Map<string, DeviceStreamDelta>();
  for (const [key, p] of pending) {
    if (!isDue(p.tier, now, lastEmit.get(key))) continue;
    let d = byDevice.get(p.deviceId);
    if (!d) { d = { deviceId: p.deviceId, metrics: {}, ts: now }; byDevice.set(p.deviceId, d); }
    d.metrics[p.metric] = p.value;
    lastEmit.set(key, now);
    pending.delete(key);
  }
  return [...byDevice.values()];
}
export function _pendingCount(): number { return pending.size; }
export function _reset(): void { pending.clear(); lastEmit.clear(); started = false; }
