/**
 * S2a (doc 20 §2/§5 / doc 16 §8) — Safety-zone service.  Flag: SAFETY_ZONE_SW_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Wires the PURE zoneIntrusionEvaluator into the S1 ADVISORY safety layer:
 *   • loads enabled safety_zones (optionally scoped to a robot/station/line),
 *   • runs evaluateZones() against a SIMULATED human set + robot positions,
 *   • for each reaction records an ADVISORY safety_event (via safetyAuditService):
 *       - eventType 'zone_intrusion'  for none-crossing 'stop'/'rated_stop'
 *       - eventType 'speed_violation' for 'speed_reduce'
 *       outcome reflects the level (reduced_speed / stopped / logged_only),
 *       detectedBy = 'vision' | 'sim' recorded HONESTLY (both additive varchar values),
 *       responseTimeMs = ms from detection → reaction proposal (ADVISORY latency, not SIL),
 *   • for 'speed_reduce'/'stop' attaches a PROPOSAL describing whether the EXISTING
 *     interlock/commandDispatcher gate would even permit a write — it NEVER dispatches
 *     here (identical honesty to nearMissAdvisor.buildProposal),
 *   • for 'rated_stop' LOGS an advisory finding with an explicit note that a certified
 *     Safety PLC must perform the actual rated stop (S2 hardware) — NEVER actuated.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: ADVISORY only. NO device is commanded here. The gate
 *   (INTERLOCK_AUTO_BLOCK_ENABLED + OT_CONTROL_ENABLED + HITL) is exactly the S1 gate;
 *   a real rated stop is HARDWARE (S2), deferred. Humans are SIMULATED until UWB/LiDAR.
 *
 * No-op (enabled:false) unless SAFETY_ZONE_SW_ENABLED. Requires SAFETY_AUDIT_ENABLED
 * for the advisory events to actually persist (safetyAuditService.record is itself
 * gated) — when audit is off we still return the computed reactions (advisory read),
 * we just don't write.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq } from "drizzle-orm";
import { DbUnavailableError } from "../../_core/dbErrors";
import { getDb } from "../../db/connection";
import { safetyZones, type SafetyZone } from "../../../drizzle/schema";
import { record, safetyAuditEnabled } from "./safetyAuditService";
import { isInterlockAutoBlockEnabled, isOtControlEnabled } from "../ot/commandDispatcher";
import {
  evaluateZones,
  type HumanPos,
  type RobotPos,
  type SafetyZoneSpec,
  type ZoneReaction,
} from "./zoneIntrusionEvaluator";

/** Flag — default OFF (mirrors safetyAuditEnabled / workforceEnabled). */
export function safetyZoneSwEnabled(): boolean {
  return process.env.SAFETY_ZONE_SW_ENABLED === "true" || process.env.SAFETY_ZONE_SW_ENABLED === "1";
}

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

/** Map a DB safety_zones row → the evaluator's spec shape. */
function toSpec(z: SafetyZone): SafetyZoneSpec {
  return {
    id: z.id,
    robotId: z.robotId,
    deviceId: z.deviceId,
    stationId: z.stationId,
    lineId: z.lineId,
    enabled: z.enabled,
    geometry: z.geometry ?? null,
    speedReduceDistanceMm: z.speedReduceDistanceMm,
    stopDistanceMm: z.stopDistanceMm,
    ratedStopDistanceMm: z.ratedStopDistanceMm,
    reactionSpeedPct: z.reactionSpeedPct,
  };
}

export interface ZoneQueryFilter {
  robotId?: number;
  stationId?: number;
  lineId?: number;
  onlyEnabled?: boolean;
}

/** List safety zones (read — always allowed, even flag-off). Newest-agnostic order by id. */
export async function listZones(filter: ZoneQueryFilter = {}): Promise<SafetyZone[]> {
  const d = await db();
  const conds = [];
  if (filter.robotId != null) conds.push(eq(safetyZones.robotId, filter.robotId));
  if (filter.stationId != null) conds.push(eq(safetyZones.stationId, filter.stationId));
  if (filter.lineId != null) conds.push(eq(safetyZones.lineId, filter.lineId));
  if (filter.onlyEnabled) conds.push(eq(safetyZones.enabled, true));
  return d
    .select()
    .from(safetyZones)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(safetyZones.id);
}

export interface CreateZoneInput {
  code: string;
  name: string;
  robotId?: number | null;
  deviceId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  geometry?: SafetyZone["geometry"] | null;
  speedReduceDistanceMm?: number;
  stopDistanceMm?: number;
  ratedStopDistanceMm?: number;
  reactionSpeedPct?: number;
  enabled?: boolean;
  notes?: string | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface ZoneWriteResult {
  ok: boolean;
  enabled: boolean;
  zone?: SafetyZone;
  message?: string;
}

/** Validate the graduated-threshold invariant: speedReduce ≥ stop ≥ ratedStop > 0. */
export function validateThresholds(t: { speedReduceDistanceMm: number; stopDistanceMm: number; ratedStopDistanceMm: number }): string | null {
  if (!(t.ratedStopDistanceMm > 0)) return "ratedStopDistanceMm must be > 0";
  if (!(t.stopDistanceMm >= t.ratedStopDistanceMm)) return "stopDistanceMm must be ≥ ratedStopDistanceMm";
  if (!(t.speedReduceDistanceMm >= t.stopDistanceMm)) return "speedReduceDistanceMm must be ≥ stopDistanceMm";
  return null;
}

/** Create a safety zone (flag-gated). Validates the graduated-threshold invariant. */
export async function createZone(input: CreateZoneInput): Promise<ZoneWriteResult> {
  if (!safetyZoneSwEnabled()) return { ok: false, enabled: false, message: "SAFETY_ZONE_SW_ENABLED off" };
  const thresholds = {
    speedReduceDistanceMm: input.speedReduceDistanceMm ?? 2000,
    stopDistanceMm: input.stopDistanceMm ?? 1000,
    ratedStopDistanceMm: input.ratedStopDistanceMm ?? 500,
  };
  const err = validateThresholds(thresholds);
  if (err) return { ok: false, enabled: true, message: err };
  const d = await db();
  const [zone] = await d
    .insert(safetyZones)
    .values({
      code: input.code,
      name: input.name,
      robotId: input.robotId ?? null,
      deviceId: input.deviceId ?? null,
      stationId: input.stationId ?? null,
      lineId: input.lineId ?? null,
      geometry: input.geometry ?? undefined,
      ...thresholds,
      reactionSpeedPct: input.reactionSpeedPct ?? 30,
      enabled: input.enabled ?? true,
      notes: input.notes ?? null,
      scope: input.scope ?? null,
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
    })
    .returning();
  return { ok: true, enabled: true, zone };
}

export interface UpdateZoneInput extends Partial<CreateZoneInput> {
  id: number;
}

/** Update a safety zone (flag-gated). Re-validates thresholds when any is supplied. */
export async function updateZone(input: UpdateZoneInput): Promise<ZoneWriteResult> {
  if (!safetyZoneSwEnabled()) return { ok: false, enabled: false, message: "SAFETY_ZONE_SW_ENABLED off" };
  const d = await db();
  const [existing] = await d.select().from(safetyZones).where(eq(safetyZones.id, input.id)).limit(1);
  if (!existing) return { ok: false, enabled: true, message: `safety zone ${input.id} not found` };
  const thresholds = {
    speedReduceDistanceMm: input.speedReduceDistanceMm ?? existing.speedReduceDistanceMm,
    stopDistanceMm: input.stopDistanceMm ?? existing.stopDistanceMm,
    ratedStopDistanceMm: input.ratedStopDistanceMm ?? existing.ratedStopDistanceMm,
  };
  const err = validateThresholds(thresholds);
  if (err) return { ok: false, enabled: true, message: err };
  const [zone] = await d
    .update(safetyZones)
    .set({
      code: input.code ?? existing.code,
      name: input.name ?? existing.name,
      robotId: input.robotId !== undefined ? input.robotId : existing.robotId,
      deviceId: input.deviceId !== undefined ? input.deviceId : existing.deviceId,
      stationId: input.stationId !== undefined ? input.stationId : existing.stationId,
      lineId: input.lineId !== undefined ? input.lineId : existing.lineId,
      geometry: input.geometry !== undefined ? (input.geometry ?? undefined) : existing.geometry ?? undefined,
      ...thresholds,
      reactionSpeedPct: input.reactionSpeedPct ?? existing.reactionSpeedPct,
      enabled: input.enabled ?? existing.enabled,
      notes: input.notes !== undefined ? input.notes : existing.notes,
      updatedAt: new Date(),
    })
    .where(eq(safetyZones.id, input.id))
    .returning();
  return { ok: true, enabled: true, zone };
}

// ════════════════════════════════════════════════════════════════════════════
// EVALUATE + WIRE INTO S1 ADVISORY
// ════════════════════════════════════════════════════════════════════════════

export interface SpeedReductionProposal {
  gateOpen: boolean;
  reason: string;
}

/**
 * Build the gate proposal WITHOUT dispatching — identical honesty to
 * nearMissAdvisor.buildProposal. We only DESCRIBE whether the EXISTING gate would
 * permit a HITL-confirmed write; this service never calls the dispatcher.
 */
export function buildProposal(): SpeedReductionProposal {
  const autoBlock = isInterlockAutoBlockEnabled();
  const otControl = isOtControlEnabled();
  const gateOpen = autoBlock && otControl;
  return {
    gateOpen,
    reason: gateOpen
      ? "gate flags on — a HUMAN/HITL-confirmed speed-reduce/stop may be dispatched via the existing gated dispatcher (this service does NOT auto-execute)"
      : `gate closed (INTERLOCK_AUTO_BLOCK_ENABLED=${autoBlock}, OT_CONTROL_ENABLED=${otControl}) — no command path; advisory log only`,
  };
}

export interface ZoneReactionRecord extends ZoneReaction {
  /** The advisory safety_event id, if one was written (audit flag on). */
  safetyEventId?: number;
  /** The gate proposal — present for speed_reduce/stop; null for rated_stop/none. */
  proposal?: SpeedReductionProposal | null;
  /** True only for rated_stop: explicitly documents LOG-not-actuate. */
  ratedStopLoggedNotActuated?: boolean;
  /**
   * ADVISORY software latency (ms) from detection → this reaction PROPOSAL, mirrored
   * onto safety_events.responseTimeMs. NOT a safety-rated stopping-time guarantee.
   */
  responseTimeMs?: number;
}

export interface EvaluateAndRecordInput {
  humans: HumanPos[];
  robots: RobotPos[];
  /** Optional explicit zones (e.g. from a test/sim); else loaded from DB (enabled). */
  zones?: SafetyZoneSpec[];
  /** Scope the DB zone load. */
  filter?: ZoneQueryFilter;
  /** Provenance of the human set — 'sim' by default (honest: no real tracker). */
  source?: "vision" | "sim";
  minConfidence?: number;
  /**
   * When the detection was OBSERVED (epoch ms). Used to populate the ADVISORY
   * safety_events.responseTimeMs = (reaction-proposal recorded) − (detected) for
   * ISO/TS 15066 PDCA latency reporting. This is a SOFTWARE detection→reaction-proposal
   * latency measurement — NOT a safety-rated stopping-time guarantee. Defaults to "now"
   * (⇒ ~0ms) when the caller has no upstream detection timestamp.
   */
  detectedAtMs?: number;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface EvaluateAndRecordResult {
  enabled: boolean;
  reactions: ZoneReactionRecord[];
  recorded: number;
  message?: string;
}

/** Map a reaction level → the safety_events (eventType, outcome) pair. */
function eventMapping(level: ZoneReaction["level"]): { eventType: "zone_intrusion" | "speed_violation"; outcome: "reduced_speed" | "stopped" | "logged_only" } | null {
  switch (level) {
    case "speed_reduce":
      return { eventType: "speed_violation", outcome: "reduced_speed" };
    case "stop":
      return { eventType: "zone_intrusion", outcome: "stopped" };
    case "rated_stop":
      // LOG only — the software did NOT (and cannot) perform the rated stop.
      return { eventType: "zone_intrusion", outcome: "logged_only" };
    case "none":
    default:
      return null;
  }
}

/**
 * Run the evaluator and WIRE the result into S1: record an advisory safety_event per
 * non-'none' reaction and attach a gate PROPOSAL (speed_reduce/stop) or a
 * LOG-not-actuate flag (rated_stop). Never commands a device.
 *
 * No-op (enabled:false) unless SAFETY_ZONE_SW_ENABLED. If SAFETY_AUDIT_ENABLED is off
 * the reactions are still returned (advisory read) but nothing is persisted.
 */
export async function evaluateAndRecord(input: EvaluateAndRecordInput): Promise<EvaluateAndRecordResult> {
  if (!safetyZoneSwEnabled()) {
    return { enabled: false, reactions: [], recorded: 0, message: "SAFETY_ZONE_SW_ENABLED off" };
  }

  // Zones: explicit (sim/test) or loaded from DB (enabled + filtered).
  let specs: SafetyZoneSpec[];
  if (input.zones) {
    specs = input.zones;
  } else {
    const rows = await listZones({ ...(input.filter ?? {}), onlyEnabled: true });
    specs = rows.map(toSpec);
  }

  // Detection time (epoch ms) — the moment the track was OBSERVED. Defaults to now.
  const detectedAtMs = input.detectedAtMs ?? Date.now();
  const reactions = evaluateZones(input.humans, input.robots, specs, { minConfidence: input.minConfidence });
  const source = input.source ?? "sim";
  // Honest provenance: 'vision' for a real vision producer, 'sim' for a SIMULATED
  // track (both are additive varchar values — no migration; the true source is ALSO
  // restated in the free-text notes).
  const detectedBy = source === "vision" ? ("vision" as const) : ("sim" as const);

  const out: ZoneReactionRecord[] = [];
  let recorded = 0;

  for (const r of reactions) {
    const rec: ZoneReactionRecord = { ...r };
    const mapping = eventMapping(r.level);

    if (mapping) {
      // Record the advisory event (self-gated by SAFETY_AUDIT_ENABLED).
      const robotIdNum = typeof r.robotId === "number" ? r.robotId : Number(r.robotId);
      // ADVISORY latency: ms from detection → this reaction proposal. Clamped ≥0 so a
      // clock skew never yields a negative. Software measurement only, not SIL timing.
      const responseTimeMs = Math.max(0, Date.now() - detectedAtMs);
      rec.responseTimeMs = responseTimeMs;
      const res = await record({
        eventType: mapping.eventType,
        robotId: Number.isFinite(robotIdNum) ? robotIdNum : null,
        humanPosition: {
          nearestHumanId: r.nearestHumanId,
          nearestDistanceMm: r.nearestDistanceMm,
          level: r.level,
          source,
        },
        responseTimeMs,
        detectedBy,
        handledBy: "advisory",
        outcome: mapping.outcome,
        isNearMiss: r.level === "speed_reduce",
        notes:
          r.level === "rated_stop"
            ? `ADVISORY zone rated_stop DETECTED (zone ${r.triggeringZoneId}, ${r.nearestDistanceMm}mm, source ${source}). ${r.note}`
            : `ADVISORY zone ${r.level} (zone ${r.triggeringZoneId}, ${r.nearestDistanceMm}mm, source ${source}). ${r.note}`,
        scope: input.scope ?? null,
        corporateCode: input.corporateCode ?? null,
        factoryId: input.factoryId ?? null,
      });
      if (res.ok && res.event) {
        rec.safetyEventId = res.event.id;
        recorded += 1;
      }
    }

    if (r.level === "speed_reduce" || r.level === "stop") {
      // PROPOSE only — build the gate description; never dispatch here.
      rec.proposal = buildProposal();
      rec.ratedStopLoggedNotActuated = false;
    } else if (r.level === "rated_stop") {
      // LOG the finding; explicitly do NOT actuate (a certified Safety PLC must).
      rec.proposal = null;
      rec.ratedStopLoggedNotActuated = true;
    } else {
      rec.proposal = null;
    }

    out.push(rec);
  }

  return { enabled: true, reactions: out, recorded };
}

/**
 * Thin adapter so the EXISTING proximity-ingest path (safety.ingestProximity) can
 * ALSO drive the zone evaluator. Converts a single proximity detection into a
 * one-human / one-robot set and evaluates against that robot's zones. Returns null
 * when the flag is off (caller keeps the S1 near-miss behaviour unchanged).
 */
export async function evaluateFromProximity(det: {
  robotId?: number | null;
  deviceId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  /** Human↔robot distance (mm) — placed as a human on the +X axis from origin. */
  distance: number;
  confidence: number;
  source: "vision" | "manual" | "test";
  /** When the detection was observed (epoch ms) — for responseTimeMs. Defaults to now. */
  detectedAtMs?: number;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}): Promise<EvaluateAndRecordResult | null> {
  if (!safetyZoneSwEnabled()) return null;
  const robotId = det.robotId ?? det.deviceId;
  if (robotId == null) return null; // need a robot to protect
  // Model the detection as a human at `distance` mm from a robot at the origin.
  const robots: RobotPos[] = [{ id: robotId, x: 0, y: 0, z: 0 }];
  const humans: HumanPos[] = [{ id: "prox", x: det.distance, y: 0, z: 0, confidence: det.confidence }];
  return evaluateAndRecord({
    humans,
    robots,
    filter: { robotId, stationId: det.stationId ?? undefined, lineId: det.lineId ?? undefined },
    source: det.source === "vision" ? "vision" : "sim",
    detectedAtMs: det.detectedAtMs,
    scope: det.scope ?? null,
    corporateCode: det.corporateCode ?? null,
    factoryId: det.factoryId ?? null,
  });
}
