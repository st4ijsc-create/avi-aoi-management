/**
 * Khối 1 (doc 16 §5 / §15 X1-b) — Field Device HEARTBEAT TTL stale-detection.
 *  Flag: FIELD_V2_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Tracks the last observed heartbeat per device (field_device_health) and, on a
 * lightweight sweep, derives a liveness `state`:
 *
 *   live            — heartbeat within the TTL (default 2s for fast devices)
 *   stale           — heartbeat older than TTL but within the lost-connection grace
 *   lost_connection — heartbeat older than the lost threshold (TTL * LOST_FACTOR)
 *   unknown         — no heartbeat observed yet
 *
 * When a device TRANSITIONS into 'lost_connection', the sweep emits an ADVISORY
 * event (socket safety:event + eventBus) so safety/fleet can react — e.g. the fleet
 * rebalancer reclaims the lost device's open tasks. It performs NO safety-rated stop.
 *
 * GATING: recordHeartbeat() + sweepFieldHealth() are NO-OPS unless FIELD_V2_ENABLED.
 * The startup sweep (installed in _core/index.ts) only schedules a timer when the flag
 * is on; otherwise nothing runs. DB-absent is a safe no-op.
 *
 * SAFETY: monitoring/STATE only — opens NO device-control path. The lost-connection
 * reaction routes through the EXISTING gated paths (fleet rebalance → tasks state only;
 * dispatch stays with the gated dispatchers, dry-run by default).
 *
 * The pure classifier `classifyLiveness` is exported + unit-tested in isolation.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { fieldDeviceHealth } from "../../../drizzle/schema";

/** Flag — default OFF (mirrors fleetOrchEnabled / twinLiveEnabled). */
export function fieldV2Enabled(): boolean {
  return process.env.FIELD_V2_ENABLED === "true" || process.env.FIELD_V2_ENABLED === "1";
}

/** Global heartbeat TTL (ms) — default 2s for fast devices. Per-device override wins. */
export function defaultHeartbeatTtlMs(): number {
  const v = Number(process.env.FIELD_HEARTBEAT_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : 2000;
}

/**
 * The multiple of the TTL past which a stale device is declared 'lost_connection'.
 * Default 5 → with a 2s TTL: >2s stale, >10s lost_connection. Min 1 (lost == stale).
 */
export function lostFactor(): number {
  const v = Number(process.env.FIELD_HEARTBEAT_LOST_FACTOR);
  return Number.isFinite(v) && v >= 1 ? v : 5;
}

export type LivenessState = "live" | "stale" | "lost_connection" | "unknown";

/**
 * PURE — classify a device's liveness from its heartbeat age. No I/O, no clock read
 * (caller passes `now`) so it is deterministic + trivially unit-testable.
 *
 *   lastHeartbeat == null            → 'unknown'
 *   age <= ttlMs                     → 'live'
 *   ttlMs < age <= ttlMs * lostMult  → 'stale'
 *   age > ttlMs * lostMult           → 'lost_connection'
 */
export function classifyLiveness(
  lastHeartbeat: Date | null | undefined,
  now: Date,
  ttlMs: number,
  lostMultiplier: number,
): LivenessState {
  if (!lastHeartbeat) return "unknown";
  const ttl = ttlMs > 0 ? ttlMs : 2000;
  const mult = lostMultiplier >= 1 ? lostMultiplier : 1;
  const age = now.getTime() - lastHeartbeat.getTime();
  if (age <= ttl) return "live";
  if (age <= ttl * mult) return "stale";
  return "lost_connection";
}

export interface RecordHeartbeatInput {
  deviceKey: string;
  deviceKind?: string;
  robotId?: number | null;
  machineId?: number | null;
  at?: Date;
  heartbeatTtlMs?: number | null;
  /** Discovery provenance (X1-d) — set only when first registering a discovered device. */
  discoveredVia?: string | null;
  endpoint?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

/**
 * Upsert a device's heartbeat into field_device_health (state→'live'). No-op unless
 * FIELD_V2_ENABLED. Fail-safe: never throws into the caller's poll loop.
 */
export async function recordHeartbeat(input: RecordHeartbeatInput): Promise<void> {
  if (!fieldV2Enabled()) return;
  const db = await getDb();
  if (!db) return;
  const at = input.at ?? new Date();
  try {
    const [existing] = await db
      .select({ id: fieldDeviceHealth.id })
      .from(fieldDeviceHealth)
      .where(eq(fieldDeviceHealth.deviceKey, input.deviceKey))
      .limit(1);
    if (existing) {
      await db
        .update(fieldDeviceHealth)
        .set({
          state: "live",
          lastHeartbeat: at,
          lastEventAt: at,
          deviceKind: input.deviceKind ?? undefined,
          robotId: input.robotId ?? undefined,
          machineId: input.machineId ?? undefined,
          heartbeatTtlMs: input.heartbeatTtlMs ?? undefined,
          updatedAt: at,
        })
        .where(eq(fieldDeviceHealth.id, existing.id));
    } else {
      await db.insert(fieldDeviceHealth).values({
        deviceKey: input.deviceKey,
        deviceKind: input.deviceKind ?? "robot",
        robotId: input.robotId ?? null,
        machineId: input.machineId ?? null,
        state: "live",
        lastHeartbeat: at,
        lastEventAt: at,
        heartbeatTtlMs: input.heartbeatTtlMs ?? null,
        discoveredVia: input.discoveredVia ?? null,
        endpoint: input.endpoint ?? null,
        corporateCode: input.corporateCode ?? null,
        factoryId: input.factoryId ?? null,
      });
    }
  } catch (err) {
    console.error(`[FieldHealth] recordHeartbeat failed for "${input.deviceKey}":`, (err as Error)?.message ?? err);
  }
}

export interface SweepResult {
  enabled: boolean;
  scanned: number;
  marked: number; // devices that TRANSITIONED into lost_connection on this sweep
  staled: number; // devices that TRANSITIONED into stale
}

/**
 * One stale-detection pass. Reads every health row, reclassifies by heartbeat age,
 * writes the new state when it changed, and EMITS an advisory event + triggers the
 * gated fleet rebalance for each device that just went 'lost_connection'.
 * No-op unless FIELD_V2_ENABLED. Fail-safe.
 */
export async function sweepFieldHealth(now: Date = new Date()): Promise<SweepResult> {
  if (!fieldV2Enabled()) return { enabled: false, scanned: 0, marked: 0, staled: 0 };
  const db = await getDb();
  if (!db) return { enabled: true, scanned: 0, marked: 0, staled: 0 };

  const ttlDefault = defaultHeartbeatTtlMs();
  const mult = lostFactor();
  let scanned = 0;
  let marked = 0;
  let staled = 0;
  const newlyLost: Array<{ deviceKey: string; robotId: number | null; factoryId: number | null }> = [];

  try {
    const rows = await db.select().from(fieldDeviceHealth);
    for (const r of rows) {
      scanned++;
      const ttl = r.heartbeatTtlMs ?? ttlDefault;
      const next = classifyLiveness(r.lastHeartbeat, now, ttl, mult);
      if (next === r.state) continue; // no transition
      await db
        .update(fieldDeviceHealth)
        .set({ state: next, updatedAt: now })
        .where(eq(fieldDeviceHealth.id, r.id));
      if (next === "lost_connection") {
        marked++;
        newlyLost.push({ deviceKey: r.deviceKey, robotId: r.robotId, factoryId: r.factoryId });
      } else if (next === "stale") {
        staled++;
      }
    }
  } catch (err) {
    console.error("[FieldHealth] sweep failed:", (err as Error)?.message ?? err);
    return { enabled: true, scanned, marked, staled };
  }

  // React to each lost device (ADVISORY): emit a safety event + (gated) fleet rebalance.
  for (const lost of newlyLost) {
    await reactToLostConnection(lost);
  }
  if (marked > 0 || staled > 0) {
    console.log(`[FieldHealth] sweep: ${marked} lost_connection, ${staled} stale (of ${scanned})`);
  }
  return { enabled: true, scanned, marked, staled };
}

/**
 * ADVISORY reaction to a device going 'lost_connection'. Emits a safety:event (so a
 * cockpit/operator sees it) and, for a robot, hands its open fleet tasks to another
 * device via the EXISTING gated rebalancer (FLEET_ORCH_ENABLED-gated; tasks STATE only,
 * never a device command). Fault-isolated.
 */
async function reactToLostConnection(lost: { deviceKey: string; robotId: number | null; factoryId: number | null }): Promise<void> {
  // 1) Advisory safety/health event (signal-only).
  try {
    const { emitSafetyEvent } = await import("../../_core/socket");
    emitSafetyEvent({
      id: 0,
      eventType: "lost_connection",
      robotId: lost.robotId,
      lineId: null,
      stationId: null,
      detectedBy: "telemetry",
      outcome: "logged_only",
      isNearMiss: false,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error(`[FieldHealth] lost-event emit failed for "${lost.deviceKey}":`, (err as Error)?.message ?? err);
  }
  // 2) Gated fleet rebalance for a robot (no-op unless FLEET_ORCH_ENABLED).
  if (lost.robotId != null) {
    try {
      const { rebalanceDeviceTasks } = await import("../fleet/taskAllocator");
      await rebalanceDeviceTasks(lost.robotId, "lost_connection");
    } catch (err) {
      console.error(`[FieldHealth] rebalance hook failed for "${lost.deviceKey}":`, (err as Error)?.message ?? err);
    }
  }
}

// ── startup sweep timer (mirrors fleet/erpOutbox/twinStream startup) ──────────
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let sweeping = false;

/**
 * Start the lightweight heartbeat sweep. A NO-OP (logs why) unless FIELD_V2_ENABLED.
 * The timer is unref'd (never blocks shutdown) and non-overlapping. Interval defaults
 * to the TTL (min 500ms) so a stale device is caught within ~1 TTL.
 */
export function startFieldHealthSweep(): void {
  if (sweepTimer) return; // guard double-start
  if (!fieldV2Enabled()) {
    console.log("[FieldHealth] sweep NOT started (FIELD_V2_ENABLED off)");
    return;
  }
  const intervalMs = Math.max(500, Number(process.env.FIELD_HEARTBEAT_SWEEP_MS) || defaultHeartbeatTtlMs());
  sweepTimer = setInterval(() => {
    if (sweeping) return; // no overlap
    sweeping = true;
    void sweepFieldHealth()
      .catch((err) => console.error("[FieldHealth] sweep error:", (err as Error)?.message ?? err))
      .finally(() => { sweeping = false; });
  }, intervalMs);
  if (typeof (sweepTimer as any)?.unref === "function") (sweepTimer as any).unref();
  console.log(`[FieldHealth] heartbeat sweep started (every ${intervalMs}ms, TTL ${defaultHeartbeatTtlMs()}ms, lost×${lostFactor()})`);
}

/** Stop the sweep (tests / shutdown). */
export function stopFieldHealthSweep(): void {
  if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  sweeping = false;
}

/** Read-only: list health rows (optionally filtered by state). For the router. */
export async function listFieldHealth(filter?: { state?: LivenessState; deviceKind?: string }): Promise<typeof fieldDeviceHealth.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [];
  if (filter?.state) conds.push(eq(fieldDeviceHealth.state, filter.state));
  if (filter?.deviceKind) conds.push(eq(fieldDeviceHealth.deviceKind, filter.deviceKind));
  return db
    .select()
    .from(fieldDeviceHealth)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(fieldDeviceHealth.deviceKey);
}

/** Count health rows grouped by state (for a UI badge). Read-only. */
export async function fieldHealthSummary(): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db
    .select({ state: fieldDeviceHealth.state, n: sql<number>`count(*)::int` })
    .from(fieldDeviceHealth)
    .groupBy(fieldDeviceHealth.state);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.state] = Number(r.n);
  return out;
}
