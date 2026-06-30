/**
 * S1-d (doc 16 §8 a / §15 S1) — Near-miss CV advisory.  Flag: SAFETY_AUDIT_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Accepts an ADVISORY human-proximity detection {deviceId, stationId, distance,
 * confidence, source} — supplied by the EXISTING vision pipeline or a test/manual
 * trigger. This module does NOT track humans itself; it CONSUMES a detection.
 *
 * When distance < the configured margin (NEAR_MISS_MARGIN_MM) it:
 *   1. records a near_miss safety_event (via safetyAuditService.record),
 *   2. raises a YELLOW (advisory) Andon (reason 'safety'),
 *   3. PROPOSES a speed reduction — it surfaces a proposal describing whether the
 *      EXISTING interlock/commandDispatcher gate would even permit a write. It NEVER
 *      dispatches a command itself: any actual speed reduction must go through the
 *      gated dispatcher (INTERLOCK_AUTO_BLOCK_ENABLED + OT_CONTROL_ENABLED + HITL),
 *      exactly as the interlock engine does.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: this is ADVISORY. The software provides NO sub-second
 *   guarantee and performs NO safety-rated stop. CV-based near-miss detection at the
 *   software layer is best-effort monitoring for PDCA — a real hardware-rated
 *   protective stop (Safety PLC + UWB/LiDAR/vision-on-edge) is deferred to S2.
 *
 * No-op (enabled:false, triggered:false) unless SAFETY_AUDIT_ENABLED.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { record, safetyAuditEnabled } from "./safetyAuditService";
import { raiseAndon } from "../andon/andonService";
import { isInterlockAutoBlockEnabled, isOtControlEnabled } from "../ot/commandDispatcher";

/** Margin (mm) below which a proximity detection is treated as a near-miss. */
export function nearMissMarginMm(): number {
  const n = Number(process.env.NEAR_MISS_MARGIN_MM ?? 500);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

/** Min detection confidence (0..1) to act on — avoids acting on low-quality detections. */
export function nearMissMinConfidence(): number {
  const n = Number(process.env.NEAR_MISS_MIN_CONFIDENCE ?? 0.5);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
}

export interface ProximityDetection {
  deviceId?: number | null;
  robotId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  /** Estimated human↔robot distance in mm. */
  distance: number;
  /** Detection confidence 0..1. */
  confidence: number;
  /** Provenance — only 'vision' is wired today; do NOT fabricate a tracker. */
  source: "vision" | "manual" | "test";
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface SpeedReductionProposal {
  /** Whether the gated dispatcher could currently execute a real speed reduction. */
  gateOpen: boolean;
  /** Documented gate state — explicit so the response can never imply an auto-stop. */
  reason: string;
}

export interface NearMissResult {
  enabled: boolean;
  triggered: boolean;
  marginMm: number;
  safetyEventId?: number;
  andonId?: number;
  proposal?: SpeedReductionProposal;
  message?: string;
}

/**
 * PURE — does this detection cross the near-miss threshold? Below margin AND at/above
 * the min confidence. Exposed for unit testing.
 */
export function isNearMiss(distance: number, confidence: number, marginMm = nearMissMarginMm(), minConfidence = nearMissMinConfidence()): boolean {
  return confidence >= minConfidence && distance < marginMm;
}

/**
 * Build the speed-reduction proposal WITHOUT dispatching. We never call the
 * dispatcher here; we only DESCRIBE whether the existing gate would permit it, so the
 * proposal is honest and the advisory stays advisory.
 */
function buildProposal(): SpeedReductionProposal {
  const autoBlock = isInterlockAutoBlockEnabled();
  const otControl = isOtControlEnabled();
  const gateOpen = autoBlock && otControl;
  return {
    gateOpen,
    reason: gateOpen
      ? "gate flags on — a HUMAN/HITL-confirmed speed reduction may be dispatched via the gated dispatcher (this advisor does NOT auto-execute)"
      : `gate closed (INTERLOCK_AUTO_BLOCK_ENABLED=${autoBlock}, OT_CONTROL_ENABLED=${otControl}) — no command path; advisory log + yellow Andon only`,
  };
}

/**
 * Process one advisory proximity detection. Above the margin (or low confidence) →
 * no-op (triggered:false). Below → record near_miss + raise YELLOW Andon + attach a
 * speed-reduction PROPOSAL (never dispatched).
 */
export async function processDetection(det: ProximityDetection): Promise<NearMissResult> {
  const marginMm = nearMissMarginMm();
  if (!safetyAuditEnabled()) return { enabled: false, triggered: false, marginMm, message: "SAFETY_AUDIT_ENABLED off" };

  if (!isNearMiss(det.distance, det.confidence, marginMm)) {
    return { enabled: true, triggered: false, marginMm, message: "above margin / low confidence — no-op" };
  }

  // 1) record the advisory near_miss safety event.
  const rec = await record({
    eventType: "near_miss",
    robotId: det.robotId ?? null,
    deviceId: det.deviceId ?? null,
    lineId: det.lineId ?? null,
    stationId: det.stationId ?? null,
    humanPosition: { distanceMm: det.distance, confidence: det.confidence, source: det.source },
    detectedBy: det.source === "vision" ? "vision" : "operator",
    handledBy: "advisory",
    outcome: "logged_only",
    isNearMiss: true,
    notes: `ADVISORY near-miss: distance ${det.distance}mm < margin ${marginMm}mm (source ${det.source}, conf ${det.confidence})`,
    scope: det.scope ?? null,
    corporateCode: det.corporateCode ?? null,
    factoryId: det.factoryId ?? null,
  });

  // 2) raise a YELLOW (advisory) Andon.
  let andonId: number | undefined;
  try {
    const andon = await raiseAndon(
      {
        state: "yellow",
        reason: "safety",
        title: "ADVISORY near-miss (human proximity)",
        message: `Advisory CV near-miss: ${det.distance}mm < ${marginMm}mm margin. NOT a safety-rated stop — verify on the floor.`,
        lineId: det.lineId ?? null,
        stationId: det.stationId ?? null,
        machineId: det.deviceId ?? null,
        raisedBySystem: true,
      },
    );
    andonId = andon.id;
  } catch (err) {
    console.error("[NearMiss] raiseAndon failed:", (err as Error)?.message ?? err);
  }

  // 3) PROPOSE a speed reduction (never dispatch here).
  const proposal = buildProposal();

  return {
    enabled: true,
    triggered: true,
    marginMm,
    safetyEventId: rec.event?.id,
    andonId,
    proposal,
  };
}
