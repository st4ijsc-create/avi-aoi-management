/**
 * Khối 7 (doc 16 §11.2 / §15 T1-c) — WebSocket Streaming Gateway.  Flag: TWIN_LIVE_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Replaces the 5s poll for the 3D twin with a push channel that moves device models
 * in (near) real time (<500ms end-to-end). It SUBSCRIBES to the unified telemetry bus
 * via the in-process tap (telemetryBus.registerTelemetryTap) — it does NOT build a
 * second socket server or a second bus. Incoming samples are normalized into device
 * DELTAS (position/state), COALESCED per device, and FLUSHED on a throttle (<=10Hz
 * per device by default) to the per-factory room `twin:{factoryId}` via
 * socket.emitTwinDeviceDeltas.
 *
 * GATING: nothing is tapped or emitted unless TWIN_LIVE_ENABLED. When off, start() is
 * a no-op → the FE 5s poll (digitalTwin.* queries) remains the fallback, unchanged.
 *
 * COALESCING + THROTTLE: we keep a "pending delta" per equipmentId (last value wins —
 * the twin only needs the latest pose, not every intermediate sample) and flush all
 * pending deltas on a single interval timer (1000/maxHz ms). This bounds emit rate
 * regardless of ingest burst rate, and one flush carries the whole batch.
 *
 * FACTORY ROUTING: a sample maps to a factory via its machineId → station → line →
 * workshop → factory. Resolution is cached (machineId→factoryId) so the hot path does
 * no per-sample query. Robot samples (deviceId "robot:<id>") resolve via the robot's
 * station/line. Samples we cannot route to a factory are dropped (no broadcast).
 *
 * SAFETY: signal-only. No device write, no DB write on this path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { InsertOtTelemetry } from "../../../drizzle/schema";
import type { TwinDeviceDelta } from "../../_core/socket";

let unsubscribe: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

// Pending coalesced deltas keyed by `${factoryId}:${equipmentId}` (last value wins).
const pending = new Map<string, { factoryId: number; delta: TwinDeviceDelta }>();

// machineId → factoryId resolution cache (negative = null cached).
const factoryCache = new Map<number, number | null>();

/** Flag — default OFF (mirrors fleetOrchEnabled / twinLiveEnabled). */
function enabled(): boolean {
  return process.env.TWIN_LIVE_ENABLED === "true" || process.env.TWIN_LIVE_ENABLED === "1";
}

function maxHz(): number {
  const hz = Number(process.env.TWIN_STREAM_MAX_HZ) || 10;
  return Math.min(30, Math.max(1, hz));
}

/** Clear the machineId→factoryId cache (tests / after master-data edits). */
export function _clearFactoryCache(): void {
  factoryCache.clear();
}

/** Resolve a machineId → factoryId (cached). Best-effort; null when unknown. */
async function resolveFactoryId(machineId: number): Promise<number | null> {
  if (factoryCache.has(machineId)) return factoryCache.get(machineId) ?? null;
  let factoryId: number | null = null;
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (db) {
      const { machines, stations, productionLines, workshops } = await import("../../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const [m] = await db.select({ stationId: machines.stationId }).from(machines).where(eq(machines.id, machineId)).limit(1);
      if (m?.stationId != null) {
        const [s] = await db.select({ lineId: stations.lineId }).from(stations).where(eq(stations.id, m.stationId)).limit(1);
        if (s?.lineId != null) {
          const [l] = await db.select({ workshopId: productionLines.workshopId }).from(productionLines).where(eq(productionLines.id, s.lineId)).limit(1);
          if (l?.workshopId != null) {
            const [w] = await db.select({ factoryId: workshops.factoryId }).from(workshops).where(eq(workshops.id, l.workshopId)).limit(1);
            factoryId = w?.factoryId ?? null;
          }
        }
      }
    }
  } catch {
    factoryId = null;
  }
  factoryCache.set(machineId, factoryId);
  return factoryId;
}

/**
 * doc 24 Wave-1 T1 — parse a joint-angle vector out of a telemetry row's textValue.
 * A producer that streams joints through the unified bus encodes the vector as a JSON
 * number array in textValue (the bus's toCanonicalRow JSON-stringifies non-primitive
 * values). Also accepts a bare comma-separated list. Returns null for anything that
 * is not a non-empty finite number array (so a malformed row is simply ignored).
 */
function parseJointVector(textValue: string | null | undefined): number[] | null {
  if (!textValue) return null;
  const s = textValue.trim();
  let arr: unknown = null;
  if (s.startsWith("[")) {
    try { arr = JSON.parse(s); } catch { return null; }
  } else if (s.includes(",")) {
    arr = s.split(",").map((p) => Number(p.trim()));
  } else {
    return null;
  }
  if (Array.isArray(arr) && arr.length > 0 && arr.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return arr as number[];
  }
  return null;
}

/**
 * PURE — extract a twin delta from one canonical telemetry row, or null if the row
 * carries nothing the twin renders. Exported for unit-testing the mapping. We treat
 * position_x/position_y (numeric) and a state metric (text) as renderable; a joints
 * metric (JSON number array in textValue) drives articulation; other metrics are
 * ignored on this channel.
 */
export function rowToDelta(
  row: InsertOtTelemetry,
): { equipmentId: string; field: "x" | "y" | "state" | "joints"; value: number | string | number[] } | null {
  const metric = (row.metric ?? "").toLowerCase();
  const equipmentId = row.machineId != null ? `machine:${row.machineId}` : `device:${row.deviceId ?? "unknown"}`;
  if ((metric === "position_x" || metric === "pos_x" || metric === "x") && row.numValue != null) {
    return { equipmentId, field: "x", value: row.numValue };
  }
  if ((metric === "position_y" || metric === "pos_y" || metric === "y") && row.numValue != null) {
    return { equipmentId, field: "y", value: row.numValue };
  }
  if ((metric === "packml_state" || metric === "state" || metric === "operation_status") && row.textValue != null) {
    return { equipmentId, field: "state", value: row.textValue };
  }
  // T1 — OPTIONAL articulation: joints stream as a JSON number array in textValue.
  if (metric === "joints" || metric === "joint_angles" || metric === "pose_joints") {
    const joints = parseJointVector(row.textValue);
    if (joints) return { equipmentId, field: "joints", value: joints };
  }
  return null;
}

/** Tap handler — coalesce each renderable sample into the pending map. */
async function onTelemetryBatch(rows: InsertOtTelemetry[]): Promise<void> {
  if (!enabled()) return;
  for (const row of rows) {
    if (row.machineId == null) continue; // only factory-routable machine samples
    const parsed = rowToDelta(row);
    if (!parsed) continue;
    const factoryId = await resolveFactoryId(row.machineId);
    if (factoryId == null) continue;
    const key = `${factoryId}:${parsed.equipmentId}`;
    const slot = pending.get(key) ?? { factoryId, delta: { equipmentId: parsed.equipmentId, ts: Date.now() } };
    if (parsed.field === "x") slot.delta.position = { x: parsed.value as number, y: slot.delta.position?.y ?? 0 };
    else if (parsed.field === "y") slot.delta.position = { x: slot.delta.position?.x ?? 0, y: parsed.value as number };
    else if (parsed.field === "state") slot.delta.state = parsed.value as string;
    // T1 — coalesce the joint vector (last value wins, like position/state).
    else if (parsed.field === "joints") slot.delta.joints = parsed.value as number[];
    slot.delta.ts = Date.now();
    pending.set(key, slot);
  }
}

/** Flush all pending deltas grouped by factory to their twin rooms. */
async function flush(): Promise<void> {
  if (pending.size === 0) return;
  const byFactory = new Map<number, TwinDeviceDelta[]>();
  for (const { factoryId, delta } of pending.values()) {
    const arr = byFactory.get(factoryId);
    if (arr) arr.push(delta);
    else byFactory.set(factoryId, [delta]);
  }
  pending.clear();
  try {
    const { emitTwinDeviceDeltas } = await import("../../_core/socket");
    for (const [factoryId, deltas] of byFactory) emitTwinDeviceDeltas(factoryId, deltas);
  } catch (err) {
    console.error("[TwinStream] flush failed:", (err as Error)?.message ?? err);
  }
}

/**
 * Start the streaming gateway: register the telemetry tap + start the throttle timer.
 * Flag-gated: a no-op (and logs why) when TWIN_LIVE_ENABLED is off. Idempotent.
 */
export function startTwinStreamGateway(): void {
  if (started) return;
  if (!enabled()) {
    console.log("[TwinStream] gateway NOT started (TWIN_LIVE_ENABLED off) — FE falls back to 5s poll");
    return;
  }
  started = true;
  const intervalMs = Math.round(1000 / maxHz());
  // Lazy import keeps this module free of an import cycle through telemetryBus.
  import("../telemetryBus")
    .then(({ registerTelemetryTap }) => {
      unsubscribe = registerTelemetryTap((rows) => {
        void onTelemetryBatch(rows);
      });
    })
    .catch((err) => console.error("[TwinStream] tap registration failed:", (err as Error)?.message ?? err));
  flushTimer = setInterval(() => {
    void flush();
  }, intervalMs);
  if (typeof (flushTimer as any)?.unref === "function") (flushTimer as any).unref();
  console.log(`[TwinStream] gateway started (<=${maxHz()}Hz, flush every ${intervalMs}ms → room twin:{factoryId})`);
}

/** Stop the gateway (tests / shutdown). */
export function stopTwinStreamGateway(): void {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  pending.clear();
  started = false;
}

/** Test/inspection hook — current pending-delta count (no side effects). */
export function _pendingCount(): number {
  return pending.size;
}
