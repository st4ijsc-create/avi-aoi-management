/**
 * S1-b (doc 16 §8 e / §15 S1) — Safety event audit.  Flag: SAFETY_AUDIT_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Records and queries ADVISORY safety events for ISO/TS 15066 + ISO 10218 PDCA
 * reporting. Two hooks (additive, flag-gated, used elsewhere):
 *   • robotIngest e-stop transition → record(detectedBy=telemetry, outcome=logged_only)
 *   • interlock engine stop/reduce  → record(detectedBy=interlock)
 * Neither hook changes the existing control behaviour — they only LOG.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: NOTHING here is safety-rated. safety_events is an
 *   ADVISORY MONITORING/LOGGING record — NOT a substitute for a safety-rated
 *   controller. The software does NOT perform a SIL 2/3 stop and provides NO
 *   sub-second guarantee. `outcome: logged_only` is the honest default for an
 *   e-stop the software merely OBSERVED (it did not cause the stop). A real
 *   hardware-rated stop (Safety PLC / UWB / LiDAR) is deferred to S2. This service
 *   commands NO device.
 *
 * With SAFETY_AUDIT_ENABLED off, record() is a no-op (enabled:false). Reads are
 * always allowed (a read of the advisory log is safe even when ingest is off).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, gte, desc, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { safetyEvents, type SafetyEvent } from "../../../drizzle/schema";
import { emitSafetyEvent } from "../../_core/socket";

/** Flag — default OFF (mirrors fleetOrchEnabled / workforceEnabled). */
export function safetyAuditEnabled(): boolean {
  return process.env.SAFETY_AUDIT_ENABLED === "true" || process.env.SAFETY_AUDIT_ENABLED === "1";
}

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not connected");
  return d;
}

export type SafetyEventType =
  // 'zone_intrusion' (S2a) is a distinct, more specific variant of 'intrusion': it is
  // raised by the dynamic safety-zone evaluator (graduated 3-level reaction). The
  // column is a free varchar, so this is additive with no migration.
  | "estop" | "collision" | "intrusion" | "zone_intrusion" | "force_limit" | "speed_violation" | "near_miss";
// Provenance of the OBSERVATION. `plc` = read from a certified Safety PLC's (non-
// safety-rated) status interface; `sim` = a clearly-labelled SIMULATED track/status
// (never a real sensor). Both are additive — the column is a free varchar, so no
// migration is needed. They exist so PLC/sim-observed events are labelled HONESTLY
// instead of being mislabelled `telemetry`/`operator`.
export type SafetyDetectedBy = "vision" | "interlock" | "operator" | "telemetry" | "plc" | "sim";
export type SafetyHandledBy = "interlock_engine" | "operator" | "advisory";
export type SafetyOutcome = "stopped" | "reduced_speed" | "manual_override" | "logged_only";

export interface RecordSafetyEventInput {
  eventType: SafetyEventType;
  robotId?: number | null;
  deviceId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  sourceInterlockEventId?: number | null;
  humanPosition?: Record<string, unknown> | null;
  robotState?: Record<string, unknown> | null;
  responseTimeMs?: number | null;
  detectedBy?: SafetyDetectedBy | null;
  handledBy?: SafetyHandledBy | null;
  outcome?: SafetyOutcome;
  isNearMiss?: boolean;
  notes?: string | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface RecordResult {
  ok: boolean;
  enabled: boolean;
  event?: SafetyEvent;
  message?: string;
}

/**
 * Record an ADVISORY safety event (append). No-op (enabled:false) unless
 * SAFETY_AUDIT_ENABLED. Emits a realtime advisory event; never commands a device.
 */
export async function record(input: RecordSafetyEventInput): Promise<RecordResult> {
  if (!safetyAuditEnabled()) return { ok: false, enabled: false, message: "SAFETY_AUDIT_ENABLED off" };
  const d = await db();
  const [event] = await d
    .insert(safetyEvents)
    .values({
      eventType: input.eventType,
      robotId: input.robotId ?? null,
      deviceId: input.deviceId ?? null,
      lineId: input.lineId ?? null,
      stationId: input.stationId ?? null,
      sourceInterlockEventId: input.sourceInterlockEventId ?? null,
      humanPosition: input.humanPosition ?? undefined,
      robotState: input.robotState ?? undefined,
      responseTimeMs: input.responseTimeMs ?? null,
      detectedBy: input.detectedBy ?? null,
      handledBy: input.handledBy ?? null,
      // logged_only is the honest default: the software only observed/logged it.
      outcome: input.outcome ?? "logged_only",
      isNearMiss: input.isNearMiss ?? input.eventType === "near_miss",
      notes: input.notes ?? null,
      scope: input.scope ?? null,
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
    })
    .returning();

  try {
    emitSafetyEvent({
      id: event.id,
      eventType: event.eventType,
      robotId: event.robotId,
      lineId: event.lineId,
      stationId: event.stationId,
      detectedBy: event.detectedBy,
      outcome: event.outcome,
      isNearMiss: event.isNearMiss,
      createdAt: event.createdAt,
    });
  } catch (err) {
    console.error("[Safety] emit failed:", (err as Error)?.message ?? err);
  }
  return { ok: true, enabled: true, event };
}

export interface FeedFilter {
  eventType?: SafetyEventType;
  robotId?: number;
  isNearMiss?: boolean;
  sinceHours?: number;
  limit?: number;
}

/** Query the safety-event feed (newest first). Read — always allowed. */
export async function queryFeed(filter: FeedFilter = {}): Promise<SafetyEvent[]> {
  const d = await db();
  const conds = [];
  if (filter.eventType) conds.push(eq(safetyEvents.eventType, filter.eventType));
  if (filter.robotId != null) conds.push(eq(safetyEvents.robotId, filter.robotId));
  if (filter.isNearMiss != null) conds.push(eq(safetyEvents.isNearMiss, filter.isNearMiss));
  if (filter.sinceHours != null) conds.push(gte(safetyEvents.createdAt, new Date(Date.now() - filter.sinceHours * 3600 * 1000)));
  return d
    .select()
    .from(safetyEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(safetyEvents.createdAt))
    .limit(filter.limit ?? 200);
}

export interface NearMissTrendBucket {
  day: string;
  count: number;
}

/** Near-miss trend by day for PDCA (read — always allowed). */
export async function nearMissTrend(sinceDays = 30): Promise<NearMissTrendBucket[]> {
  const d = await db();
  const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);
  const rows = await d
    .select({
      day: sql<string>`to_char(date_trunc('day', ${safetyEvents.createdAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(safetyEvents)
    .where(and(eq(safetyEvents.isNearMiss, true), gte(safetyEvents.createdAt, since)))
    .groupBy(sql`date_trunc('day', ${safetyEvents.createdAt})`)
    .orderBy(sql`date_trunc('day', ${safetyEvents.createdAt})`);
  return rows.map((r) => ({ day: r.day, count: r.count }));
}

/** Stamp a human PDCA audit on a safety event (who reviewed it). */
export async function auditEvent(eventId: number, auditedBy: number): Promise<SafetyEvent | null> {
  const d = await db();
  const [row] = await d
    .update(safetyEvents)
    .set({ auditedAt: new Date(), auditedBy })
    .where(eq(safetyEvents.id, eventId))
    .returning();
  return row ?? null;
}
