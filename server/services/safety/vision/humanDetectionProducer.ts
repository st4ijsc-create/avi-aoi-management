/**
 * S2b-1 (doc 20 §2/§5 / doc 16 §8) — Vision human-detection PRODUCER.
 *   Flag: SAFETY_VISION_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Turns PERSON DETECTIONS (pixel bounding boxes) + a per-camera pixel→floor
 * homography into FLOOR positions {x, y, z:0, confidence}, then drives the S2a
 * evaluator (safetyZoneService.evaluateAndRecord) — ADVISORY.
 *
 *   detection {x,y,w,h,confidence}  ──(pick foot point: bottom-centre of the box)──▶
 *   pixel {u,v}  ──(homography H, floor is z=0)──▶  floor {x,y}  ──▶  HumanPos
 *   → evaluateAndRecord(humans, robots, …)  (S2a 3-level reaction, advisory)
 *
 * The foot point (bottom-centre of the bbox) is the standard floor-contact estimate
 * for a standing person under a planar-floor homography — the head/torso are ABOVE the
 * floor plane, so projecting the box centre would over/under-shoot; the bottom edge is
 * (approximately) where the person meets the floor.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * INFERENCE BACKEND — pluggable, HONEST (this is the key seam):
 *
 *   (a) INJECTED — detections supplied by the caller / a test / an external detector.
 *       This is the value delivered NOW: given real detections + a real calibration,
 *       the producer emits correct floor positions and drives S2a. Fully tested.
 *
 *   (b) ONNX HOOK (optional) — IF a YOLO "person" ONNX model is registered AND the
 *       onnxruntime-node path (aiInferenceEngine) can run it, we call it. TODAY the
 *       repo has ONNX runtime + a YOLO-SEG decode, but NO person/pose model is
 *       registered and `yolo26n.pt` is PyTorch — it must be EXPORTED to .onnx once
 *       (see the seam note below) and registered before this hook returns anything.
 *       Until then this hook returns [] (it NEVER fabricates a person).
 *
 *   (c) NO-BACKEND — the default. Produces NOTHING. We do NOT invent a detection to
 *       make the pipeline "look alive". Honesty over theatre.
 *
 * ─ YOLO ONNX-EXPORT SEAM (documented, not fabricated) ────────────────────────
 *   `yolo26n.pt` is a PyTorch checkpoint; onnxruntime-node cannot load .pt. A ONE-TIME
 *   export is required (Python, off-box or in a sidecar), e.g.:
 *       yolo export model=yolo26n.pt format=onnx opset=13 imgsz=640
 *   then register the resulting .onnx as an ACTIVE ai_model whose labels include
 *   "person" (reuse scripts/ai-kb/register-seg-model.mjs). Only THEN can the ONNX hook
 *   run. This producer provides the contract + homography + wiring; the model export +
 *   the person-decode are the documented seam.
 *
 * ⚠ CRITICAL HONESTY / SAFETY: ADVISORY. This producer commands NO device — it only
 *   feeds the S2a evaluator, which LOGS/PROPOSES (and LOGS-only for rated_stop). No
 *   real camera/calibration/model ⇒ produces NOTHING. Never a safety-rated stop.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq } from "drizzle-orm";
import { DbUnavailableError } from "../../../_core/dbErrors";
import { getDb } from "../../../db/connection";
import { cameraCalibrations, type CameraCalibration } from "../../../../drizzle/schema";
import {
  applyHomography,
  solveHomography,
  calibrationResidualMm,
  isHomography,
  type Homography,
  type CalibrationPair,
} from "./homography";
import { evaluateAndRecord, type EvaluateAndRecordResult } from "../safetyZoneService";
import type { HumanPos, RobotPos } from "../zoneIntrusionEvaluator";

/** Flag — default OFF. */
export function safetyVisionEnabled(): boolean {
  return process.env.SAFETY_VISION_ENABLED === "true" || process.env.SAFETY_VISION_ENABLED === "1";
}

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

// ════════════════════════════════════════════════════════════════════════════
// PURE — pixel bbox → floor position via homography
// ════════════════════════════════════════════════════════════════════════════

/** A person detection as a pixel-space bounding box (from any detector). */
export interface PersonDetection {
  /** top-left x (pixels). */
  x: number;
  /** top-left y (pixels). */
  y: number;
  /** width (pixels). */
  w: number;
  /** height (pixels). */
  h: number;
  /** detection confidence 0..1. */
  confidence: number;
  /** optional stable id (tracker) — else assigned by index. */
  id?: string | number;
}

/**
 * PURE — the pixel FOOT point (bottom-centre) of a bbox, the floor-contact estimate.
 */
export function footPixel(det: PersonDetection): { u: number; v: number } {
  return { u: det.x + det.w / 2, v: det.y + det.h };
}

/**
 * PURE — project a set of person detections through a camera homography to FLOOR
 * positions (z=0). Detections whose foot pixel maps to infinity (degenerate) are
 * skipped (never fabricated). Returns HumanPos ready for the S2a evaluator.
 */
export function detectionsToFloorHumans(dets: PersonDetection[], H: Homography): HumanPos[] {
  const out: HumanPos[] = [];
  dets.forEach((det, i) => {
    const foot = footPixel(det);
    let floor;
    try {
      floor = applyHomography(H, foot);
    } catch {
      return; // horizon/degenerate pixel — drop, do not fabricate a position
    }
    out.push({
      id: det.id ?? `det-${i}`,
      x: floor.x,
      y: floor.y,
      z: 0,
      confidence: det.confidence,
    });
  });
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// INFERENCE BACKENDS (pluggable) — injected | onnx-hook | none
// ════════════════════════════════════════════════════════════════════════════

/** A backend that produces PERSON DETECTIONS from a frame (or nothing). */
export interface DetectionBackend {
  readonly kind: "injected" | "onnx" | "none";
  /** Human-readable label — always states whether detections are real or absent. */
  label(): string;
  /**
   * Produce person detections for a frame. The 'none' backend returns [] — it NEVER
   * fabricates a person. The 'onnx' backend returns [] until a person ONNX model is
   * registered (honest seam). 'injected' returns exactly what was supplied.
   */
  detect(frame?: DetectionFrameInput): Promise<PersonDetection[]>;
}

/** Optional frame input for a real backend (a decoded image buffer + size). */
export interface DetectionFrameInput {
  imageBuffer?: Buffer;
  width?: number;
  height?: number;
}

/** INJECTED backend — returns caller/test-supplied detections verbatim. */
export class InjectedDetectionBackend implements DetectionBackend {
  readonly kind = "injected" as const;
  constructor(private readonly detections: PersonDetection[]) {}
  async detect(): Promise<PersonDetection[]> {
    return this.detections;
  }
  label(): string {
    return `injected (${this.detections.length} detection${this.detections.length === 1 ? "" : "s"})`;
  }
}

/** NO-BACKEND — the honest default. Produces NOTHING. */
export class NoDetectionBackend implements DetectionBackend {
  readonly kind = "none" as const;
  async detect(): Promise<PersonDetection[]> {
    return [];
  }
  label(): string {
    return "no-backend (produces nothing — needs a real camera + calibration + an exported ONNX person model)";
  }
}

/**
 * ONNX HOOK backend — wires to the existing aiInferenceEngine IF a YOLO "person" model
 * is registered and can run. TODAY: no person/pose ONNX model is registered and
 * yolo26n.pt is PyTorch (needs the one-time export documented above), so this returns
 * [] honestly. When such a model is registered, replace the body of `detect()` with the
 * decode; the producer contract above is unchanged.
 *
 * We keep this as an EXPLICIT, labelled seam rather than a stub that fakes a person.
 */
export class OnnxPersonDetectionBackend implements DetectionBackend {
  readonly kind = "onnx" as const;
  constructor(private readonly modelCode?: string) {}
  async detect(_frame?: DetectionFrameInput): Promise<PersonDetection[]> {
    // HONEST SEAM: no registered person/pose ONNX model wired yet. onnxruntime-node +
    // the YOLO-seg decode exist (aiInferenceEngine / aiSegmentation), but a person
    // model must be exported from yolo26n.pt (.pt→.onnx) and registered ACTIVE first.
    // Until then we produce NOTHING — never a fabricated person.
    return [];
  }
  label(): string {
    return `onnx-hook (SEAM: ${this.modelCode ?? "no person model"} not wired — export yolo26n.pt→.onnx + register ACTIVE with a 'person' label)`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// CALIBRATION STORE (per-camera homography) — CRUD
// ════════════════════════════════════════════════════════════════════════════

export interface CalibrationFilter {
  cameraId?: string;
  safetyZoneId?: number;
  robotId?: number;
  onlyEnabled?: boolean;
}

/** List camera calibrations (read — always allowed). */
export async function listCalibrations(filter: CalibrationFilter = {}): Promise<CameraCalibration[]> {
  const d = await db();
  const conds = [];
  if (filter.cameraId != null) conds.push(eq(cameraCalibrations.cameraId, filter.cameraId));
  if (filter.safetyZoneId != null) conds.push(eq(cameraCalibrations.safetyZoneId, filter.safetyZoneId));
  if (filter.robotId != null) conds.push(eq(cameraCalibrations.robotId, filter.robotId));
  if (filter.onlyEnabled) conds.push(eq(cameraCalibrations.enabled, true));
  return d
    .select()
    .from(cameraCalibrations)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(cameraCalibrations.id);
}

export interface UpsertCalibrationInput {
  id?: number;
  cameraId: string;
  name?: string | null;
  /** Provide a precomputed 3×3 homography (9 numbers, row-major)… */
  homography?: Homography | null;
  /** …OR provide ≥4 image↔floor pairs to SOLVE the homography from. */
  pairs?: CalibrationPair[] | null;
  safetyZoneId?: number | null;
  robotId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  enabled?: boolean;
  notes?: string | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface CalibrationWriteResult {
  ok: boolean;
  enabled: boolean;
  calibration?: CameraCalibration;
  residualMm?: number;
  message?: string;
}

/**
 * PURE — resolve the effective homography for an upsert: use an explicit matrix, else
 * SOLVE from pairs. Returns {H, residualMm, pairs} or an error string. Exposed for test.
 */
export function resolveHomography(
  input: { homography?: Homography | null; pairs?: CalibrationPair[] | null },
): { H: Homography; residualMm: number; pairs: CalibrationPair[] | null } | { error: string } {
  if (input.homography) {
    if (!isHomography(input.homography)) return { error: "homography must be 9 finite numbers (row-major 3×3)" };
    const residualMm = input.pairs && input.pairs.length ? calibrationResidualMm(input.homography, input.pairs) : 0;
    return { H: input.homography, residualMm, pairs: input.pairs ?? null };
  }
  if (input.pairs && input.pairs.length >= 4) {
    try {
      const H = solveHomography(input.pairs);
      return { H, residualMm: calibrationResidualMm(H, input.pairs), pairs: input.pairs };
    } catch (err) {
      return { error: (err as Error)?.message ?? "homography solve failed" };
    }
  }
  return { error: "provide either a precomputed homography (9 numbers) or ≥4 image↔floor pairs" };
}

/** Create or update a camera calibration (flag-gated). Solves H from pairs if needed. */
export async function upsertCalibration(input: UpsertCalibrationInput): Promise<CalibrationWriteResult> {
  if (!safetyVisionEnabled()) return { ok: false, enabled: false, message: "SAFETY_VISION_ENABLED off" };
  const resolved = resolveHomography(input);
  if ("error" in resolved) return { ok: false, enabled: true, message: resolved.error };
  const d = await db();
  const values = {
    cameraId: input.cameraId,
    name: input.name ?? null,
    homography: resolved.H,
    pairs: resolved.pairs ?? undefined,
    residualMm: resolved.residualMm,
    safetyZoneId: input.safetyZoneId ?? null,
    robotId: input.robotId ?? null,
    stationId: input.stationId ?? null,
    lineId: input.lineId ?? null,
    imageWidth: input.imageWidth ?? null,
    imageHeight: input.imageHeight ?? null,
    enabled: input.enabled ?? true,
    notes: input.notes ?? null,
    scope: input.scope ?? null,
    corporateCode: input.corporateCode ?? null,
    factoryId: input.factoryId ?? null,
  };
  if (input.id != null) {
    const [calibration] = await d
      .update(cameraCalibrations)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(cameraCalibrations.id, input.id))
      .returning();
    if (!calibration) return { ok: false, enabled: true, message: `camera calibration ${input.id} not found` };
    return { ok: true, enabled: true, calibration, residualMm: resolved.residualMm };
  }
  const [calibration] = await d.insert(cameraCalibrations).values(values).returning();
  return { ok: true, enabled: true, calibration, residualMm: resolved.residualMm };
}

// ════════════════════════════════════════════════════════════════════════════
// PRODUCE — detections + calibration → floor humans → S2a evaluator (advisory)
// ════════════════════════════════════════════════════════════════════════════

export interface ProduceInput {
  /** The calibration to use — either a loaded row, or its cameraId (loaded from DB). */
  calibration?: CameraCalibration;
  cameraId?: string;
  /** The detection backend (default: NoDetectionBackend — produces nothing). */
  backend?: DetectionBackend;
  /** Optional injected detections shortcut (wraps InjectedDetectionBackend). */
  detections?: PersonDetection[];
  /** Optional frame for a real backend. */
  frame?: DetectionFrameInput;
  /** Robot positions to protect (floor mm). If absent, defaults to origin (advisory). */
  robots?: RobotPos[];
  minConfidence?: number;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface ProduceResult {
  enabled: boolean;
  /** The detection backend used — always labelled (honesty). */
  backend: string;
  /** Number of raw detections the backend produced. */
  detectionCount: number;
  /** The floor positions the producer computed (may be fewer than detections). */
  floorHumans: HumanPos[];
  /** The S2a evaluation result (reactions + recorded events), or null when no humans. */
  evaluation: EvaluateAndRecordResult | null;
  message?: string;
}

/**
 * The producer contract. Runs the detection backend, projects detections through the
 * camera's homography to floor positions, and drives the S2a evaluator. ADVISORY —
 * never commands a device. No-op (enabled:false) unless SAFETY_VISION_ENABLED. With no
 * backend / no detections / no calibration it produces NOTHING (never fabricates).
 */
export async function produce(input: ProduceInput): Promise<ProduceResult> {
  if (!safetyVisionEnabled()) {
    return { enabled: false, backend: "off", detectionCount: 0, floorHumans: [], evaluation: null, message: "SAFETY_VISION_ENABLED off" };
  }

  // Resolve the calibration (explicit row, or load newest enabled for cameraId).
  let calib = input.calibration ?? null;
  if (!calib && input.cameraId) {
    const rows = await listCalibrations({ cameraId: input.cameraId, onlyEnabled: true });
    calib = rows[rows.length - 1] ?? null; // newest by id
  }
  if (!calib || !isHomography(calib.homography)) {
    return {
      enabled: true,
      backend: "none",
      detectionCount: 0,
      floorHumans: [],
      evaluation: null,
      message: calib ? "calibration has no valid homography" : `no enabled calibration for camera "${input.cameraId ?? "?"}"`,
    };
  }

  const backend: DetectionBackend =
    input.backend ?? (input.detections ? new InjectedDetectionBackend(input.detections) : new NoDetectionBackend());

  const detections = await backend.detect(input.frame);
  const floorHumans = detectionsToFloorHumans(detections, calib.homography);

  if (floorHumans.length === 0) {
    return { enabled: true, backend: backend.label(), detectionCount: detections.length, floorHumans: [], evaluation: null };
  }

  // Robots to protect: caller-supplied, else the zone-bound robot at origin (advisory).
  const robots: RobotPos[] =
    input.robots && input.robots.length > 0
      ? input.robots
      : calib.robotId != null
        ? [{ id: calib.robotId, x: 0, y: 0, z: 0 }]
        : [{ id: "camera-scene", x: 0, y: 0, z: 0 }];

  const evaluation = await evaluateAndRecord({
    humans: floorHumans,
    robots,
    filter: {
      robotId: calib.robotId ?? undefined,
      stationId: calib.stationId ?? undefined,
      lineId: calib.lineId ?? undefined,
    },
    source: "vision",
    minConfidence: input.minConfidence,
    scope: input.scope ?? calib.scope ?? null,
    corporateCode: input.corporateCode ?? calib.corporateCode ?? null,
    factoryId: input.factoryId ?? calib.factoryId ?? null,
  });

  return { enabled: true, backend: backend.label(), detectionCount: detections.length, floorHumans, evaluation };
}
