import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { and as drizzleAnd, eq as drizzleEq, ne as drizzleNe, gte as drizzleGte, asc as drizzleAsc, sql } from "drizzle-orm";
import * as db from "../db";
import { getDb } from "../db";
// Doc 51 P0 (R2) — out-param type for the idempotent inspection-header insert.
import type { CreateInspectionOutcome } from "../db/inspection";
import {
  productInspections,
  measurementResults as measurementResultsTable,
  measurementPointVersions,
} from "../../drizzle/schema";
import { requirePermission } from "../_core/accessControl";
// Doc 27 W2-C (C7/M4): per-machine credential auth + ingest rate limit.
import {
  authenticateMachine,
  enforceMachineIngestRateLimit,
  issueMachineKey,
  rotateMachineKey,
  revokeMachineKey,
  listMachineKeys,
  type MachineAuthResult,
} from "../services/machineAuthService";
// Doc 27 W2-C (C3/R11): inspection ingest store-and-forward (disk WAL).
import {
  inspectionStoreForwardEnabled,
  bufferSubmission,
  backfillInspections,
  bufferedInspectionCount,
  computeSubmissionKey,
  markSubmissionApplied,
  isPermanentSubmitError,
  setProcessFn as walSetProcessFn,
  setDedupFn as walSetDedupFn,
} from "../services/inspection/inspectionStoreForward";
import { storagePut, storageGet, storageDelete, resolveImageToDataUrl } from "../storage";
import { emitNGAlert, emitYieldWarning, emitDashboardUpdate } from "../_core/socket";
import { statsCache, CACHE_KEYS } from "../_core/cache";
import * as cachedStats from "../functions/cachedStatistics";
import { publishPointsConfigChanged } from "../services/mqttService";
import { publishToOutbox } from "../services/integration/outboxProducers"; // K0+-c: ADDITIVE ERP outbox (ERP_OUTBOX_ENABLED)
import { resolveThresholdEditGate } from "../services/thresholdGovernanceService"; // Doc 31 B.6 — gate machine limit write-back
import {
  evaluatePointResult,
  isPointLimitEvalEnabled,
  isUnitConvertEnabled,
  resolveGateLimitsForBoard,
  type PointLimitSnapshot,
  type PointLimitSource,
} from "../services/pointResultEvaluator"; // Doc 31 MP6 — server-side 3D/criteria spec gate; Doc 51 P1 QĐ#2 — snapshot gate; P2 batch-2 §12.2#2 — version-exact gate; P2 CASE #11 unit convert
import * as aiAdvancedDb from "../db/aiAdvanced";
import { confirmDeployment as svcConfirmDeployment, recordEdgeHeartbeat as svcRecordHeartbeat, syncEdgeResults as svcSyncEdgeResults } from "../services/aiEdgeEnhanced";
import {
  type PointDefCache,
  type WorkstationCache,
  resolveMeasurementPointDefinition,
  resolveWorkstationId,
  toOptionalDecimal,
  cleanUndefined,
  computeImageHash,
  uploadPointReferenceImage,
  uploadProductReferenceImage,
} from "./_shared";
import {
  pointShapeEnum,
  measurementGeometrySchema,
  expandArrayGeometry,
  type MeasurementGeometry,
} from "../lib/measurementGeometry";
import {
  resolveOrCreateMeasurementPointDefId,
  assertValidPointDefId,
} from "../services/measurementPointResolver";

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P1 (CASE #5) — per-image base64 size cap.
//
// The gap: `imageBase64` had NO bound. The only backstop was the 200MB HTTP body
// limit, so a single field could carry a ~40MB image and the server decoded ALL
// of them into RAM (Buffer.from) before uploading — a submission with a handful
// of large images could pin tens/hundreds of MB per request. A bounded field
// fails fast at parse time (BAD_REQUEST) instead.
//
// The default is deliberately GENEROUS (per-measurement images on the ingest path
// are defect crops, typically well under 1MB) so it cannot line-stop a real
// machine; ops can widen/narrow it via MACHINE_INGEST_MAX_IMAGE_B64 (QĐ#1). Read
// at import time so the value is a compile-time constant for zod's `.max()`.
// ════════════════════════════════════════════════════════════════════════════
function maxImageBase64Chars(): number {
  const raw = process.env.MACHINE_INGEST_MAX_IMAGE_B64;
  const n = raw === undefined || String(raw).trim() === "" ? NaN : Number(raw);
  // Default 20,000,000 base64 chars ≈ ~15MB decoded — far above any real crop,
  // far below the 200MB body limit.
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20_000_000;
}
const MAX_IMAGE_B64 = maxImageBase64Chars();
const IMAGE_B64_TOO_LARGE = `image exceeds MACHINE_INGEST_MAX_IMAGE_B64 (${MAX_IMAGE_B64} base64 chars)`;

const measurementTypeValueList = [
  "DIMENSION",
  "VISUAL",
  "ELECTRICAL",
  "POSITION",
  "COLOR",
  "SURFACE",
  "OTHER",
] as const;

const measurementPointSyncSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(255),
  description: z.string().optional(),
  measurementType: z.preprocess(
    (val) => (typeof val === "string" ? val.toUpperCase() : val),
    z.enum(measurementTypeValueList)
  ).default("VISUAL"),
  unit: z.string().max(20).optional(),
  lowerLimit: z.union([z.string(), z.number()]).optional(),
  upperLimit: z.union([z.string(), z.number()]).optional(),
  nominalValue: z.union([z.string(), z.number()]).optional(),
  positionX: z.number().int(),
  positionY: z.number().int(),
  radius: z.number().int().positive().optional(),
  // Normalized coordinates (0.0 - 1.0) relative to source image dimensions
  // If provided, these take priority over absolute coordinates for cross-resolution sync
  normalizedX: z.number().min(0).max(1).optional(),
  normalizedY: z.number().min(0).max(1).optional(),
  normalizedRadius: z.number().min(0).max(1).optional(),
  cropWidth: z.number().int().positive().optional(),
  cropHeight: z.number().int().positive().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  workstationCode: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  imageBase64: z.string().max(MAX_IMAGE_B64, IMAGE_B64_TOO_LARGE).optional(),
  imageMimeType: z.string().optional(),
  imageUrl: z.string().url().optional(),
  // P1: optional shape + geometry (additive). When present, server persists them.
  shape: pointShapeEnum.optional(),
  geometry: measurementGeometrySchema.optional(),
  // Doc 51 P2 batch-2 (§5.2 P2) — the point's updatedAt the machine last CACHED
  // (ISO string or epoch ms). Optional/additive. When present the server can
  // optimistic-lock the write-back (enforced under MACHINE_SYNC_OPTIMISTIC_LOCK)
  // so two machines / machine+engineer don't silently clobber each other; when the
  // lock is off a stale value still raises a 'blind-overwrite' audit.
  expectedUpdatedAt: z.union([z.string(), z.number()]).optional(),
});

// ============ MACHINE API ROUTER (for external machine integration) ============

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P1 (CASE #3) — CLOCK-SKEW POLICY
//
// The gap: `inspectionTime` is whatever the machine says. Nothing validated it,
// nothing compared it to the server clock, and no column recorded when the server
// actually received the board. A machine 6h off (dead RTC, no NTP, someone "fixed"
// the clock) files boards into the WRONG SHIFT / WRONG DAY, silently — and after
// the fact you cannot even enumerate the damage.
//
// The response is deliberately staged (QĐ#1 — every tightening needs a flag, a
// backward-compatible default, and telemetry BEFORE enforcement):
//   1. ALWAYS: stamp serverReceivedAt + measure signed skew + flag outliers.
//      Costs nothing, breaks nothing, and makes the blind spot measurable today.
//   2. FLAGGED: INGEST_REQUIRE_TIME_OFFSET=true rejects naive timestamps. Default
//      FALSE — flipping this on before the fleet emits offsets would stop the line.
//      Run stage 1 first, read the telemetry, then enforce.
// ════════════════════════════════════════════════════════════════════════════

function envTrue(v: string | undefined): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "on";
}

function envInt(name: string, dflt: number): number {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === "") return dflt;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : dflt;
}

/** |skew| above this ⇒ clockSkewFlagged + ops alert. Default 5 minutes. */
function clockSkewWarnSeconds(): number {
  return envInt("INGEST_CLOCK_SKEW_WARN_SECONDS", 300);
}

/**
 * ENFORCEMENT flag (default OFF). ON ⇒ an inspectionTime without an explicit UTC
 * offset is a BAD_REQUEST. OFF ⇒ accepted and TAGGED timeSource='machine_naive'.
 */
function requireTimeOffset(): boolean {
  return envTrue(process.env.INGEST_REQUIRE_TIME_OFFSET);
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P2 flags (QĐ#1 — every behavioural change carries a flag + a
// backward-compatible default).
// ════════════════════════════════════════════════════════════════════════════

/**
 * §11.2 residual #1 — on a measurement-transaction failure, DELETE the orphaned
 * inspection header (+ its idempotency-ledger claim) so a retry re-inserts a
 * COMPLETE board instead of the P0 short-circuit resolving to an empty header.
 * Default ON: it fires ONLY on the error path and is strictly safer there. Set
 * INGEST_COMPENSATE_ORPHAN_HEADER=false to revert to leave-the-empty-header.
 */
function compensateOrphanHeaderEnabled(): boolean {
  return envTrue(process.env.INGEST_COMPENSATE_ORPHAN_HEADER ?? "true");
}

/**
 * CASE #8 — soft cross-machine serial-collision detection. Default OFF: it costs
 * one extra indexed read per NEW board on the hottest table (100 boards/s, QĐ#7),
 * so it is opt-in. When on, a serial already seen from a DIFFERENT machine in the
 * recent window TAGS the row (never rejects — QĐ#3) + raises one throttled alert.
 */
function serialCollisionDetectEnabled(): boolean {
  return envTrue(process.env.INGEST_SERIAL_COLLISION_DETECT);
}

/** CASE #8 — look-back window (seconds) for a colliding serial. Default 1h. */
function serialCollisionWindowSeconds(): number {
  return envInt("INGEST_SERIAL_COLLISION_WINDOW_SEC", 3600);
}

/**
 * Doc 51 P2 batch-2 (§5.2 P2) — ENFORCE optimistic lock on the machine POINTS_PUSH
 * write-back. Default OFF (QĐ#1 backward-compat: today's machines push blind and a
 * flip-to-enforce before they cache/send updatedAt would start rejecting legit
 * syncs). When ON *and* a point carries `expectedUpdatedAt`, syncMeasurementPoints
 * threads it into updateMeasurementPointDef → a stale write is a per-point CONFLICT
 * instead of a silent last-writer-wins overwrite of a def another machine/engineer
 * just changed. When OFF (or the point omits it) the write stays blind, but a stale
 * `expectedUpdatedAt` still emits a 'blind-overwrite' audit so the drift is VISIBLE.
 */
function machineSyncOptimisticLockEnabled(): boolean {
  return envTrue(process.env.MACHINE_SYNC_OPTIMISTIC_LOCK);
}

/**
 * §5.6 — request-level ingest audit. Default OFF: an audit row PER submission on
 * the hottest ingest path is heavy (100/s ⇒ 100 audit inserts/s), so ops opts in
 * deliberately. Best-effort + fire-and-forget regardless (never affects ingest).
 */
function requestAuditEnabled(): boolean {
  return envTrue(process.env.INGEST_REQUEST_AUDIT_ENABLED);
}

/**
 * Does an ISO-8601 datetime string carry an EXPLICIT UTC offset ('Z' or ±HH[:]MM)?
 *
 * This is THE question that decides whether a timestamp is an absolute instant or
 * merely a wall-clock reading. Without an offset, `new Date(s)` interprets the
 * string in the SERVER's zone — so a machine in a different zone (or one whose
 * clock is off by a whole number of hours) yields a measured skew of ≈ 0 while
 * being completely wrong. Naive stamps are the silent half of CASE #3.
 */
export function hasExplicitUtcOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

export type InspectionTimeSource = "machine_utc" | "machine_naive" | "server";

/** Provenance of a submission's inspectionTime, derived from the ORIGINAL input. */
export function classifyInspectionTime(raw: string | undefined): InspectionTimeSource {
  if (!raw) return "server";
  return hasExplicitUtcOffset(raw) ? "machine_utc" : "machine_naive";
}

export interface ClockSkewAssessment {
  /** Signed: machineTime − serverReceivedAt, seconds. Negative = machine behind. */
  skewSeconds: number;
  flagged: boolean;
}

/** Signed skew + threshold verdict. Pure — the whole point is that it is testable. */
export function assessClockSkew(
  machineTime: Date,
  serverReceivedAt: Date,
  source: InspectionTimeSource,
): ClockSkewAssessment {
  // The server stamped the time itself → zero skew BY DEFINITION. Measuring the
  // server against its own clock and "finding" drift would be noise.
  if (source === "server") return { skewSeconds: 0, flagged: false };
  const skewSeconds = Math.round((machineTime.getTime() - serverReceivedAt.getTime()) / 1000);
  return { skewSeconds, flagged: Math.abs(skewSeconds) > clockSkewWarnSeconds() };
}

/**
 * Per-machine cooldown for the skew alert. A machine with a broken clock submits
 * at line rate (QĐ#7: 1 board/s), and EVERY board is skewed — without this, one
 * dead RTC buries the ops surface under ~3600 identical alerts an hour.
 */
const skewAlertLastSent = new Map<number, number>();
function skewAlertCooldownMs(): number {
  return envInt("INGEST_CLOCK_SKEW_ALERT_COOLDOWN_SEC", 900) * 1000;
}

/** Test seam — the cooldown map is module state. */
export function _resetClockSkewAlertCooldown(): void {
  skewAlertLastSent.clear();
}

/**
 * Route a clock-skew condition to the EXISTING ops alert surface
 * (aiSmartAlertRouter → predictive_alerts + in-app/email), reusing the pattern of
 * spcCentralAlertBridge. Fire-and-forget, fully guarded, cooldown-bounded.
 *
 * INGEST_CLOCK_SKEW_ALERT_ENABLED default TRUE — unlike a tightening, an alert
 * cannot break ingest, and a silent detector would leave CASE #3 exactly as blind
 * as it is today. The console.warn below is unconditional regardless.
 */
function raiseClockSkewAlert(params: {
  machineId: number;
  machineCode: string;
  machineName: string;
  serialNumber: string;
  skewSeconds: number;
  timeSource: InspectionTimeSource;
  machineTime: Date;
  serverReceivedAt: Date;
}): void {
  const drift = params.skewSeconds >= 0 ? "AHEAD OF" : "BEHIND";
  console.warn(
    `[submitInspection] CLOCK SKEW — machine=${params.machineCode} is ` +
      `${Math.abs(params.skewSeconds)}s ${drift} the server ` +
      `(machineTime=${params.machineTime.toISOString()}, ` +
      `serverReceivedAt=${params.serverReceivedAt.toISOString()}, ` +
      `timeSource=${params.timeSource}, serial=${params.serialNumber}) — ` +
      `boards from this machine may be filed into the WRONG SHIFT/DAY.`,
  );

  if (!envTrue(process.env.INGEST_CLOCK_SKEW_ALERT_ENABLED ?? "true")) return;

  const now = Date.now();
  const last = skewAlertLastSent.get(params.machineId) ?? 0;
  if (now - last < skewAlertCooldownMs()) return;
  skewAlertLastSent.set(params.machineId, now);

  void import("../services/aiSmartAlertRouter")
    .then(({ routeAlert }) =>
      routeAlert({
        // No dedicated clock-skew AlertType exists; PATTERN_ANOMALY is the
        // catch-all the router already understands. The message carries the truth.
        type: "PATTERN_ANOMALY",
        machineId: params.machineId,
        severity: "HIGH",
        message:
          `Đồng hồ máy ${params.machineName} (${params.machineCode}) lệch ` +
          `${Math.abs(params.skewSeconds)}s so với server — dữ liệu kiểm tra có thể bị ` +
          `ghi SAI CA/SAI NGÀY. Kiểm tra NTP/RTC của máy.`,
        data: {
          reason: "clock_skew",
          machineCode: params.machineCode,
          skewSeconds: params.skewSeconds,
          thresholdSeconds: clockSkewWarnSeconds(),
          timeSource: params.timeSource,
          machineTime: params.machineTime.toISOString(),
          serverReceivedAt: params.serverReceivedAt.toISOString(),
          serialNumber: params.serialNumber,
        },
      }),
    )
    .catch((err) => {
      console.error("[submitInspection] clock-skew alert routing failed (non-fatal):", err);
    });
}

/**
 * Doc 27 W2-C — submitInspection input, extracted to a named schema so the
 * durability layer (inspectionStoreForward) can buffer + replay the EXACT
 * payload through the same pipeline.
 */
const submitInspectionInputSchema = z.object({
      // Machine identification
      machineCode: z.string().optional(), // Mã máy (alternative to apiKey)
      apiKey: z.string().optional(), // API key (backward compatible)
      
      // Product information
      // Doc 51 P0 — bounded to the varchar(100) column and never blank: a blank
      // serial is unroutable (no traceability) AND is exempted from the ingest
      // idempotency key (uq_inspections_machine_serial_time is partial on
      // serialNumber <> ''), so accepting one would silently re-open the
      // double-count hole. `.trim()` normalises before both checks.
      serialNumber: z.string().trim().min(1).max(100), // Số serial sản phẩm
      productModel: z.string().optional(), // Model sản phẩm
      batchNumber: z.string().optional(), // Số lô
      
      // Inspection results
      cycleTime: z.number().optional(), // Thời gian chu kỳ (giây)
      overallResult: z.enum(["OK", "NG", "NTF"]), // Kết quả tổng thể
      // Thời gian kiểm tra (ISO-8601). Doc 51 P1 / CASE #3 — validated by the
      // superRefine on the object below (parseability ALWAYS; explicit UTC offset
      // only under INGEST_REQUIRE_TIME_OFFSET). Left as a bare string here on
      // purpose: z.string().datetime({offset:true}) would be a HARD tightening
      // applied at import time, killing every machine that sends naive stamps —
      // QĐ#1 requires the flag + a backward-compatible default.
      inspectionTime: z.string().optional(),

      // Doc 51 P1 — EXPLICIT INGEST IDEMPOTENCY KEY (closes the 0272 hole).
      // CLIENT-generated and STABLE across retries of the SAME board (e.g. a UUID
      // minted once when the board is inspected, reused by every retry of that
      // submission). This is the ONLY thing that protects a machine which does not
      // send inspectionTime: the server then stamps now() per receive, so 0272's
      // natural key differs on every retry and catches nothing.
      // Optional (QĐ#1: machines that don't send one keep exactly today's
      // behaviour). min(8) so a machine cannot "adopt" idempotency with a
      // low-entropy counter that collides across boards.
      idempotencyKey: z.string().trim().min(8).max(200).optional(),

      // Doc 51 P1 / CASE #12 — the points-config version the machine DECLARES it
      // is grading with. Stamped VERBATIM (machine's claim ≠ server's verdict) and
      // compared against the product's live pointsConfigVersion to TAG (never
      // reject — QĐ#3) boards graded on stale thresholds.
      // ★ QĐ#2 seam: re-grading must use the SNAPSHOT of THIS version, not live limits.
      pointsConfigVersion: z.number().int().nonnegative().optional(),

      // ── SERVER-STAMPED, NOT part of the machine contract ────────────────────
      // These exist because the store-and-forward WAL replays the payload through
      // processInspectionSubmission MINUTES-TO-HOURS later: without them a replay
      // would re-derive provenance from the replay clock and report every buffered
      // board as wildly clock-skewed. The mutation OVERWRITES both unconditionally
      // from the ORIGINAL request, so a machine cannot forge either one.
      serverReceivedAt: z.string().optional(),
      timeSource: z.enum(["machine_utc", "machine_naive", "server"]).optional(),


      // Enterprise hierarchy (top-down)
      companyCode: z.string().optional(), // Mã tập đoàn/công ty
      factoryCode: z.string().optional(), // Mã nhà máy
      workshopCode: z.string().optional(), // Mã nhà xưởng
      lineCode: z.string().optional(), // Mã dây chuyền
      stageCode: z.string().optional(), // Mã công đoạn
      
      // Production context
      productionOrderCode: z.string().optional(), // Mã lệnh sản xuất
      operatorId: z.string().optional(), // Mã công nhân vận hành (doc 29 §3: BADGE CODE — resolved to users.id at ingest, fail-open)

      // W8-B (doc 29 §2.3, migration 0192) — panel multi-up context (ADDITIVE,
      // optional): machine-reported panel serial + 1-based board index inside
      // the panel. Carried by the st4i-standard adapter (header panel_id /
      // board_index); absent for single-board machines → NULL columns.
      panelId: z.string().max(100).optional(),
      boardIndex: z.number().int().min(1).optional(),

      // Measurement data
      measurements: z.array(z.object({
        pointId: z.string().optional(), // ID điểm đo (new)
        pointCode: z.string().optional(), // Mã điểm đo (backward compatible)
        measuredValue: z.union([z.number(), z.string()]).optional(), // Giá trị đo (number hoặc string)
        // Doc 51 P2 (CASE #11) — the unit the machine measured `measuredValue` in
        // (e.g. "mil"). Optional + additive: absent ⇒ exactly today's behaviour.
        // When it differs from the point def's unit, the server converts the value
        // into the def's unit BEFORE the spec gate so a mil-vs-mm mismatch cannot
        // silently downgrade a good board. `unitScaleToCanonical` optionally gives
        // an explicit factor to mm for a non-standard unit the table doesn't know.
        unit: z.string().trim().max(20).optional(),
        unitScaleToCanonical: z.union([z.number(), z.string()]).optional(),
        result: z.enum(["OK", "NG", "NTF"]), // Kết quả
        remark: z.string().optional(), // Ghi chú
        imageBase64: z.string().max(MAX_IMAGE_B64, IMAGE_B64_TOO_LARGE).optional(), // Hình ảnh base64 (optional)
        valueZ: z.union([z.number(), z.string()]).optional(),
        valueHeight: z.union([z.number(), z.string()]).optional(),
        valueArea: z.union([z.number(), z.string()]).optional(),
        valueVolume: z.union([z.number(), z.string()]).optional(),
        valueVoidPct: z.union([z.number(), z.string()]).optional(),
        valueCoplanarity: z.union([z.number(), z.string()]).optional(),
        valueWarpage: z.union([z.number(), z.string()]).optional(),
        valueOffsetX: z.union([z.number(), z.string()]).optional(),
        valueOffsetY: z.union([z.number(), z.string()]).optional(),
        valueTilt: z.union([z.number(), z.string()]).optional(),
        valueThickness: z.union([z.number(), z.string()]).optional(),
        defectCatalogCode: z.string().max(50).optional(),
        defectSeverity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
      })),
    }).refine(data => data.apiKey || data.machineCode, {
      message: "Either apiKey or machineCode must be provided"
    })
    // ── Doc 51 P1 (CASE #3) — inspectionTime validation ──────────────────────
    // Deliberately a superRefine and not `z.string().datetime({offset:true})`:
    // the offset requirement must read process.env AT PARSE TIME so it can be a
    // flag (QĐ#1) and so tests can exercise both sides. The parseability check is
    // NOT flagged — see below.
    .superRefine((data, ctx) => {
      if (data.inspectionTime === undefined) return;
      // (1) PARSEABLE — always enforced, no flag. This is not a tightening of
      //     working behaviour: an unparseable stamp produced an Invalid Date that
      //     blew up at insert time and was classified TRANSIENT, so the payload
      //     was buffered to the WAL and retried FOREVER (a poison entry that can
      //     never succeed). A clean BAD_REQUEST is strictly better for every
      //     party — no machine that works today starts failing.
      if (Number.isNaN(new Date(data.inspectionTime).getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inspectionTime"],
          message: `inspectionTime is not a parseable date-time: "${data.inspectionTime}"`,
        });
        return;
      }
      // (2) EXPLICIT UTC OFFSET — flagged, default OFF (accept + tag as
      //     'machine_naive'). Turning this ON before every machine emits an
      //     offset would reject real production boards, so it stays opt-in until
      //     the timeSource telemetry says the fleet is ready.
      if (requireTimeOffset() && !hasExplicitUtcOffset(data.inspectionTime)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inspectionTime"],
          message:
            `inspectionTime must carry an explicit UTC offset (e.g. 2026-07-15T08:00:00+07:00 ` +
            `or ...Z) when INGEST_REQUIRE_TIME_OFFSET is on — got "${data.inspectionTime}", ` +
            `which the server can only interpret in its OWN timezone.`,
        });
      }
    });

export type SubmitInspectionInput = z.infer<typeof submitInspectionInputSchema>;

/** Extract a machine credential from Authorization: Bearer / X-API-Key headers. */
function machineHeaderKey(ctx: unknown): string | null {
  try {
    const headers = (ctx as { req?: { headers?: Record<string, unknown> } })?.req?.headers;
    if (!headers) return null;
    const auth = headers["authorization"];
    if (typeof auth === "string" && /^bearer\s+/i.test(auth)) {
      const tok = auth.replace(/^bearer\s+/i, "").trim();
      if (tok) return tok;
    }
    const xkey = headers["x-api-key"];
    if (typeof xkey === "string" && xkey.trim()) return xkey.trim();
  } catch {
    /* header extraction must never break the request */
  }
  return null;
}

/**
 * Wire the WAL's replay + dedup functions to THIS pipeline. Idempotent cheap
 * assignment (same pattern as telemetryBus.ensureStoreForwardWired) so the
 * wiring survives a store-forward _reset in tests/maintenance.
 */
function ensureInspectionWalWired(): void {
  walSetProcessFn((payload) => processInspectionSubmission(payload as SubmitInspectionInput));
  walSetDedupFn((payload) => inspectionAlreadyPersisted(payload as SubmitInspectionInput));
}

/**
 * Backfill dedup check: does this buffered submission ALREADY have a persisted
 * product_inspections row (machineId + serialNumber + inspectionTime)? Guards
 * the "machine retried live after DB recovery, then the WAL replays" and the
 * crash-replay cases against double-insert. Throws when the DB is unreachable
 * (transient → backfill leaves the entry queued).
 */
export async function inspectionAlreadyPersisted(input: SubmitInspectionInput): Promise<boolean> {
  if (!input.inspectionTime) return false; // cannot key without a timestamp
  let auth: MachineAuthResult;
  try {
    auth = await authenticateMachine({ apiKey: input.apiKey, machineCode: input.machineCode });
  } catch (err) {
    if (err instanceof TRPCError) return false; // invalid creds → replay will dead-letter with the real error
    throw err; // DbUnavailableError etc. → transient
  }
  const dbi = await db.getDb();
  if (!dbi) throw new Error("Database not available");
  // Same "fake UTC" shift the insert path applies (see processInspectionSubmission).
  const raw = new Date(input.inspectionTime);
  const local = new Date(raw.getTime() - raw.getTimezoneOffset() * 60000);
  const rows = await dbi
    .select({ id: productInspections.id })
    .from(productInspections)
    .where(
      drizzleAnd(
        drizzleEq(productInspections.machineId, auth.machine.id),
        drizzleEq(productInspections.serialNumber, input.serialNumber),
        drizzleEq(productInspections.inspectionTime, local),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Doc 51 P1 (QĐ#2) — load a point's edit-snapshot history (measurement_point_versions)
 * for the spec-gate reconstruction. Best-effort + memoised per submission: a DB
 * hiccup yields [] (⇒ the caller skips the gate for that point — safe), never an
 * error that fails ingest. Only called for STALE boards under the snapshot flag.
 */
async function loadPointLimitSnapshots(
  pointDefId: number,
  cache: Map<number, PointLimitSnapshot[]>,
): Promise<PointLimitSnapshot[]> {
  const hit = cache.get(pointDefId);
  if (hit) return hit;
  let snaps: PointLimitSnapshot[] = [];
  try {
    const dbi = await getDb();
    if (dbi) {
      // Doc 51 P2 batch-2 (§12.2 #2, 0282) — project the version-provenance column
      // ONLY when it exists (guarded migration); a bare projection on a DB without
      // 0282 would throw and blank the whole (P1 instant-based) history for this
      // point. Probe is cached and its OWN failure must NOT lose the snapshot rows —
      // a probe error just degrades to "no stamp" (instant path), never to [].
      let hasConfigVersionCol = false;
      try {
        hasConfigVersionCol = await db.measurementPointVersionsHasConfigVersionColumn(dbi);
      } catch {
        hasConfigVersionCol = false;
      }
      const projection: Record<string, unknown> = {
        changedAt: measurementPointVersions.changedAt,
        snapshotJson: measurementPointVersions.snapshotJson,
      };
      if (hasConfigVersionCol) {
        projection.productPointsConfigVersion = measurementPointVersions.productPointsConfigVersion;
      }
      const rows = await dbi
        .select(projection as any)
        .from(measurementPointVersions)
        .where(drizzleEq(measurementPointVersions.pointDefId, pointDefId))
        .orderBy(drizzleAsc(measurementPointVersions.changedAt));
      snaps = (rows as Array<Record<string, unknown>>)
        .filter((r) => r.changedAt instanceof Date)
        .map((r) => ({
          changedAt: r.changedAt as Date,
          limits: (r.snapshotJson ?? {}) as PointLimitSource,
          productPointsConfigVersion:
            hasConfigVersionCol && r.productPointsConfigVersion != null
              ? Number(r.productPointsConfigVersion)
              : null,
        }));
    }
  } catch (err) {
    console.warn(
      `[submitInspection] snapshot history load failed for pointDef=${pointDefId} (gate skipped for it):`,
      (err as Error)?.message ?? err,
    );
    snaps = [];
  }
  cache.set(pointDefId, snaps);
  return snaps;
}

/**
 * Doc 51 P1 (QĐ#2) — module flag: once a gateConfigVersion persist fails because
 * the 0276 column is absent, stop retrying it (avoids per-board warn spam until
 * the migration is applied). Reset via _resetGateConfigVersionProbe() in tests.
 */
let gateConfigVersionColumnMissing = false;
export function _resetGateConfigVersionProbe(): void {
  gateConfigVersionColumnMissing = false;
}

/**
 * Doc 51 P1 (QĐ#2) — persist which config version the spec-gate used, for
 * traceability (product_inspections.gateConfigVersion, migration 0276). Written
 * with a raw statement because the drizzle table type (out of this zone) has no
 * such column yet; wholly best-effort — a missing column or transient error must
 * NEVER fail an inspection that already committed.
 */
async function persistGateConfigVersion(
  inspectionId: number,
  gateConfigVersion: number | null,
): Promise<void> {
  if (gateConfigVersion == null || gateConfigVersionColumnMissing) return;
  const dbi = await getDb();
  // fakeDb in unit tests has no .execute → cleanly skip (nothing to assert there).
  if (!dbi || typeof (dbi as { execute?: unknown }).execute !== "function") return;
  try {
    await (dbi as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`UPDATE product_inspections SET "gateConfigVersion" = ${gateConfigVersion} WHERE id = ${inspectionId}`,
    );
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/gateConfigVersion|does not exist|column/i.test(msg)) {
      gateConfigVersionColumnMissing = true; // 0276 not applied — stop trying.
    }
    console.warn(
      `[submitInspection] gateConfigVersion persist skipped (non-fatal) for inspection=${inspectionId}:`,
      msg,
    );
  }
}

/**
 * Doc 51 P2 (CASE #8) — suspectedDuplicateSerial persist probe. Mirrors the
 * gateConfigVersion probe: once the 0281 column proves absent, stop retrying the
 * UPDATE (avoids per-board warn spam until the migration is applied).
 */
let suspectedDuplicateColumnMissing = false;
export function _resetSuspectedDuplicateProbe(): void {
  suspectedDuplicateColumnMissing = false;
}

/**
 * Doc 51 P2 (CASE #8) — TAG a saved inspection whose serial collided with another
 * machine's recent board (product_inspections.suspectedDuplicateSerial, 0281).
 * Raw UPDATE + best-effort (the drizzle table type gains the column via the schema
 * edit, but the migration may not be applied yet); a missing column or transient
 * error must NEVER fail a board that already committed.
 */
async function persistSuspectedDuplicateSerial(inspectionId: number): Promise<void> {
  if (suspectedDuplicateColumnMissing) return;
  const dbi = await getDb();
  // fakeDb in unit tests has no .execute → cleanly skip.
  if (!dbi || typeof (dbi as { execute?: unknown }).execute !== "function") return;
  try {
    await (dbi as unknown as { execute: (q: unknown) => Promise<unknown> }).execute(
      sql`UPDATE product_inspections SET "suspectedDuplicateSerial" = now() WHERE id = ${inspectionId}`,
    );
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (/suspectedDuplicateSerial|does not exist|column/i.test(msg)) {
      suspectedDuplicateColumnMissing = true; // 0281 not applied — stop trying.
    }
    console.warn(
      `[submitInspection] suspectedDuplicateSerial persist skipped (non-fatal) for inspection=${inspectionId}:`,
      msg,
    );
  }
}

/**
 * Doc 51 P2 (CASE #8) — is `serialNumber` already on record from a DIFFERENT
 * machine within [since, now]? Returns the OTHER machine's id, or null. Best-effort
 * read: a DB hiccup yields null (⇒ no tag), never an ingest failure. The machineId
 * inequality alone excludes THIS machine's own retries/rework (those are either a
 * P0 duplicate short-circuit or a legitimate same-machine re-scan).
 */
async function findCollidingSerialMachine(params: {
  serialNumber: string;
  machineId: number;
  since: Date;
}): Promise<number | null> {
  try {
    const dbi = await getDb();
    if (!dbi) return null;
    const rows = await dbi
      .select({ machineId: productInspections.machineId })
      .from(productInspections)
      .where(drizzleAnd(
        drizzleEq(productInspections.serialNumber, params.serialNumber),
        drizzleNe(productInspections.machineId, params.machineId),
        drizzleGte(productInspections.inspectionTime, params.since),
      ))
      .limit(1);
    return rows[0]?.machineId ?? null;
  } catch (err) {
    console.warn(
      `[submitInspection] serial-collision lookup failed (skipped) for serial=${params.serialNumber}:`,
      (err as Error)?.message ?? err,
    );
    return null;
  }
}

/**
 * Doc 51 P2 (§5.6) — request-level ingest audit. Fire-and-forget + error-isolated;
 * NEVER logs images or heavy payload — only who/what/when. Gated (default OFF).
 */
function auditInspectionSubmission(params: {
  machineId: number;
  machineCode: string;
  serialNumber: string;
  overallResult: string;
  inspectionId: number;
  authMethod: string;
  duplicate: boolean;
}): void {
  if (!requestAuditEnabled()) return;
  void db.createAuditLog({
    userId: null,
    userName: `machine:${params.machineCode}`,
    action: "machine.inspection.submit",
    entityType: "product_inspection",
    entityId: params.inspectionId,
    entityName: params.serialNumber,
    details: {
      machineId: params.machineId,
      machineCode: params.machineCode,
      serialNumber: params.serialNumber,
      overallResult: params.overallResult,
      authMethod: params.authMethod,
      duplicate: params.duplicate,
    },
    status: "success",
  }).catch((err) => {
    console.error(
      "[submitInspection] request audit failed (non-fatal):",
      (err as Error)?.message ?? err,
    );
  });
}

/**
 * The FULL submit pipeline (auth → inspection row → measurements/images →
 * alerts/side-effects). Extracted from the mutation so the store-forward WAL
 * can replay a buffered payload through EXACTLY the same code path. Throws on
 * failure — buffering decisions belong to the caller (mutation / backfill).
 */
export async function processInspectionSubmission(
  input: SubmitInspectionInput,
  opts?: { headerKey?: string | null; rateLimit?: boolean },
): Promise<{ success: true; inspectionId: number; duplicate?: boolean }> {
      // Validate machine — per-machine scoped key (Authorization header or apiKey
      // field), legacy shared apiKey (flag-gated), or machineCode. Throws
      // UNAUTHORIZED/FORBIDDEN, or DbUnavailableError when the DB is down.
      const auth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: opts?.headerKey,
        scope: "ingest:write",
      });
      const machine = auth.machine;
      // Rate limit LIVE requests only (a WAL backfill replay must never trip it).
      if (opts?.rateLimit) enforceMachineIngestRateLimit(auth);

      const normalizedProductModelCode = input.productModel?.trim();
      const productModelRecord = normalizedProductModelCode
        ? await db.getProductModelByCode(normalizedProductModelCode)
        : undefined;
      const resolvedProductModelCode = productModelRecord?.code || normalizedProductModelCode;

      // Update machine heartbeat
      await db.updateMachineHeartbeat(machine.id);

      // Find production order if provided
      let productionOrderId: number | undefined;
      if (input.productionOrderCode) {
        const order = await db.getProductionOrderByCode(input.productionOrderCode);
        if (order) {
          productionOrderId = order.id;
        }
      }

      // W2-D seam (gap C4/M8) — SOFT commissioning gate: a machine whose newest
      // signed commissioning record isn't 'commissioned' gets its submission
      // TAGGED (ingestMode='commissioning'), NEVER rejected. getAoiIngestMode is
      // 30s-cached + fail-open to "production"; the dynamic import keeps the
      // ingest path alive even if the service module itself fails to load.
      let aoiIngestMode: "production" | "commissioning" = "production";
      try {
        const { getAoiIngestMode } = await import("../services/aoiCommissioningService");
        aoiIngestMode = await getAoiIngestMode(machine.id);
      } catch {
        /* fail-open — commissioning tagging must never affect ingest */
      }

      // W7-A seam (doc 27 Đợt-3 leftover → Đợt 7, migration 0187) — stamp which
      // RELEASED inspection program (inspection_program_releases.id) was the
      // production truth for (product, machine) at ingest time. Dynamic import +
      // fail-open null, exactly like the commissioning seam above: release
      // stamping must never affect ingest. NULL = no released program (machine
      // running an unreleased/draft program) or no product model resolved.
      let programReleaseId: number | null = null;
      if (productModelRecord?.id) {
        try {
          const { getActiveRelease } = await import("../services/inspectionProgramService");
          const activeRelease = await getActiveRelease({
            productModelId: productModelRecord.id,
            machineId: machine.id,
          });
          programReleaseId = activeRelease?.id ?? null;
        } catch {
          /* fail-open — release stamping must never affect ingest */
        }
      }

      // Create inspection record
      // Fix timezone: Drizzle ORM serializes Date via .toISOString() (UTC),
      // but timestamp without time zone strips Z → stores UTC value.
      // Shift to "fake UTC" so PostgreSQL stores local time.
      //
      // ⚠ Doc 51 P1 (CASE #3) — THIS SHIFT IS LEFT IN PLACE ON PURPOSE. It is
      // process-TZ dependent and the read layer (server/utils/kpi.ts
      // getDbStorageTimezone) defaults to assuming UTC, so the two only agree when
      // FACTORY_DB_STORAGE_TZ is set to the server's zone. Removing the shift here
      // would silently re-interpret EVERY historical row (22,995 on dev) that was
      // written WITH it — a data-corruption event dressed as a bug fix. The cutover
      // needs its own migration (rewrite stored values + flip FACTORY_DB_STORAGE_TZ
      // atomically); see the doc 51 P1 report. What P1 adds is the ability to SEE
      // the problem: serverReceivedAt + signed skew + timeSource, below.
      const rawInspTime = input.inspectionTime ? new Date(input.inspectionTime) : new Date();
      const localInspTime = new Date(rawInspTime.getTime() - rawInspTime.getTimezoneOffset() * 60000);

      // ══ Doc 51 P1 (CASE #3) — PROVENANCE + CLOCK-SKEW ══════════════════════
      // serverReceivedAt/timeSource are normally stamped by the mutation from the
      // ORIGINAL request and carried through the WAL, so a replay reports the
      // receive time of the BOARD, not of the replay. Direct callers (hot-folder,
      // acquisition worker, tests) omit them → derive honestly from what we have.
      const serverReceivedAt = input.serverReceivedAt
        ? new Date(input.serverReceivedAt)
        : new Date();
      const timeSource: InspectionTimeSource =
        input.timeSource ?? classifyInspectionTime(input.inspectionTime);
      const skew = assessClockSkew(rawInspTime, serverReceivedAt, timeSource);
      if (skew.flagged) {
        raiseClockSkewAlert({
          machineId: machine.id,
          machineCode: machine.code,
          machineName: machine.name,
          serialNumber: input.serialNumber,
          skewSeconds: skew.skewSeconds,
          timeSource,
          machineTime: rawInspTime,
          serverReceivedAt,
        });
      }
      // serverReceivedAt is stored with the SAME fake-UTC shift as inspectionTime.
      // Not because the shift is right — because a column in a different time base
      // than the one it is compared against is worse than a consistently-wrong one.
      // Both move together at cutover. timeSkewSeconds is a DURATION, so it is
      // immune to all of this: it stays correct across the cutover either way.
      const localServerReceivedAt = new Date(
        serverReceivedAt.getTime() - serverReceivedAt.getTimezoneOffset() * 60000,
      );

      // ══ Doc 51 P1 (CASE #12) — CONFIG VERSION PIN ══════════════════════════
      // Which thresholds graded this board? Unanswerable until now: the machine's
      // config version was never recorded and product_models.pointsConfigVersion is
      // LIVE — it moves every time an engineer edits a limit. Stamp the machine's
      // DECLARED version verbatim, and tag (never reject — QĐ#3) how it compares.
      // ★ QĐ#2 rests on this column: a re-grade reads the SNAPSHOT of THIS version.
      const declaredConfigVersion = input.pointsConfigVersion;
      let configVersionStatus: "current" | "stale" | "ahead" | "unknown" = "unknown";
      if (declaredConfigVersion !== undefined && productModelRecord) {
        const liveVersion = productModelRecord.pointsConfigVersion ?? 1;
        configVersionStatus =
          declaredConfigVersion === liveVersion
            ? "current"
            : declaredConfigVersion < liveVersion
              ? "stale"
              : "ahead";
        if (configVersionStatus === "stale") {
          // The board was graded against thresholds the engineers have already
          // moved on from. Soft signal: ops pushes a sync, nobody's line stops.
          console.warn(
            `[submitInspection] STALE CONFIG — machine=${machine.code} graded ` +
              `serial=${input.serialNumber} with pointsConfigVersion=${declaredConfigVersion} ` +
              `but product=${resolvedProductModelCode} is at ${liveVersion} — ` +
              `board TAGGED 'stale_config', NOT rejected (QĐ#3). Machine needs a points sync.`,
          );
        } else if (configVersionStatus === "ahead") {
          // Machine claims a version the server has never issued. Either the config
          // was rolled back / the DB restored, or the machine is reporting garbage.
          console.warn(
            `[submitInspection] CONFIG VERSION AHEAD — machine=${machine.code} claims ` +
              `pointsConfigVersion=${declaredConfigVersion} but product=${resolvedProductModelCode} ` +
              `is only at ${liveVersion}. Config rollback, restored DB, or a lying machine.`,
          );
        }
      }

      // ══ Doc 51 P1 (QĐ#2) — SPEC-GATE VERSION SELECTION ═════════════════════
      // Flag-gated (SPEC_GATE_SNAPSHOT_ENABLED, default OFF ⇒ exact current
      // behaviour: gate by LIVE limits). When ON *and* the board is STALE (it
      // declares an older config than the product now holds), the spec-gate below
      // reconstructs each point's limits AS THEY WERE when the board was measured
      // (from measurement_point_versions) instead of gating it against the newer
      // live limits — that is the split-brain this closes. `gateConfigVersion`
      // records which version the gate actually used, so a re-grade is traceable
      // (persisted best-effort to product_inspections.gateConfigVersion, 0276).
      const snapshotGateOn = envTrue(process.env.SPEC_GATE_SNAPSHOT_ENABLED);
      const useSnapshotGate = snapshotGateOn && configVersionStatus === "stale";
      const liveConfigVersion = productModelRecord?.pointsConfigVersion ?? null;
      const gateConfigVersion: number | null = useSnapshotGate
        ? declaredConfigVersion ?? null
        : liveConfigVersion;
      // Per-submission cache of a point's edit-snapshot history (only touched for
      // stale boards under the flag → normally never queried).
      const pointSnapshotCache = new Map<number, PointLimitSnapshot[]>();
      let snapshotGatedPoints = 0;       // points gated by an INSTANT-reconstructed snapshot (P1)
      let snapshotMissingPoints = 0;     // stale points with no usable snapshot → gate SKIPPED
      let versionGatedPoints = 0;        // P2 batch-2 — points gated by a VERSION-EXACT snapshot (0282)
      let versionLivePoints = 0;         // P2 batch-2 — points unchanged since declared V → gated by LIVE

      // W8-B seam (doc 29 §3.2, migration 0192) — resolve the machine-sent
      // operatorId (BADGE CODE) to a canonical users.id and stamp it. Dynamic
      // import + fail-open null, exactly like the commissioning/release seams
      // above: badge state must NEVER affect ingest (unknown badge → NULL +
      // auto-registered 'auto_seen' inside the service, never a rejection).
      let operatorUserId: number | null = null;
      if (input.operatorId?.trim()) {
        try {
          const { resolveOperatorUserId } = await import("../services/operatorBadgeService");
          operatorUserId = await resolveOperatorUserId(input.operatorId, rawInspTime);
        } catch {
          /* fail-open — operator resolution must never affect ingest */
        }
      }

      // Doc 51 P0 (R2) — idempotent header insert. `insertOutcome.duplicate`
      // comes back true when the natural key (machineId, serialNumber,
      // inspectionTime) was ALREADY persisted, i.e. this is a machine retry /
      // WAL replay of a board we have already fully processed.
      const insertOutcome: CreateInspectionOutcome = { duplicate: false };
      const inspectionId = await db.createProductInspection({
        machineId: machine.id,
        ingestMode: aoiIngestMode === "commissioning" ? "commissioning" : undefined,
        programReleaseId: programReleaseId ?? undefined,
        serialNumber: input.serialNumber,
        productModelId: productModelRecord?.id,
        productModel: resolvedProductModelCode,
        batchNumber: input.batchNumber,
        overallResult: input.overallResult as any,
        originalResult: input.overallResult as any,
        corporateCode: input.companyCode, // Mã tập đoàn
        factoryCode: input.factoryCode, // Mã nhà máy
        workshopCode: input.workshopCode, // Mã nhà xưởng
        lineCode: input.lineCode, // Mã dây chuyền
        stageCode: input.stageCode, // Mã công đoạn
        productionOrderCode: input.productionOrderCode, // Mã lệnh sản xuất
        operatorId: input.operatorId, // Mã công nhân vận hành (badge code — kept verbatim)
        // W8-B (0192): resolved users.id (fail-open null) + panel context.
        operatorUserId: operatorUserId ?? undefined,
        panelSerial: input.panelId,
        boardIndex: input.boardIndex,
        inspectionTime: localInspTime,
        cycleTime: input.cycleTime ? String(input.cycleTime) : undefined,
        // Doc 51 P1 (0275) — provenance. Written on EVERY row, flags off or on:
        // the measurement is what makes CASE #3 / CASE #12 visible at all.
        serverReceivedAt: localServerReceivedAt,
        timeSkewSeconds: skew.skewSeconds,
        clockSkewFlagged: skew.flagged,
        timeSource,
        // Audit trail for the ledger-enforced key (see db/inspection.ts).
        idempotencyKey: input.idempotencyKey,
        // CASE #12 — machine's claim, verbatim + the server's soft verdict on it.
        pointsConfigVersion: declaredConfigVersion,
        configVersionStatus,
      }, insertOutcome);

      // ══ Doc 51 P0 (R2) — DUPLICATE SHORT-CIRCUIT ═══════════════════════════
      // The board is already on record: the header insert was a no-op and
      // `inspectionId` is the ORIGINAL row's id. EVERY side-effect below has
      // ALREADY run for that row, so re-running them is precisely the damage the
      // idempotency key exists to prevent:
      //   • updateProductionOrderQuantities → +2 completedQuantity per board
      //   • publishToOutbox (ERP quality-result)
      //   • measurement_results insert       → duplicated per-point rows
      //   • emitNGAlert / publishNGAlert     → the operator's Andon fires twice
      //   • stats/cache/WIP/quality-gate/inline-AI hooks
      // ACK honestly with the ORIGINAL inspectionId + duplicate:true so the
      // machine stops retrying and can reconcile. NOTE the caller path stays
      // intact: this is a SUCCESS return, so the mutation still ledgers
      // markSubmissionApplied() and the WAL replay still drains the entry.
      if (insertOutcome.duplicate) {
        console.warn(
          `[submitInspection] duplicate submission ignored (idempotency key hit) — ` +
            `machine=${machine.code} serial=${input.serialNumber} ` +
            `inspectionTime=${localInspTime.toISOString()} → existing inspectionId=${inspectionId}`,
        );
        // Doc 51 P2 (§5.6) — the retry is still a request worth auditing (default OFF).
        auditInspectionSubmission({
          machineId: machine.id,
          machineCode: machine.code,
          serialNumber: input.serialNumber,
          overallResult: input.overallResult,
          inspectionId,
          authMethod: auth.method,
          duplicate: true,
        });
        return { success: true as const, inspectionId, duplicate: true as const };
      }
      // ═══════════════════════════════════════════════════════════════════════
      //
      // ⚠ Doc 51 P2 (§11.2 residual #1) — the ERP outbox publish and the
      // production-order quantity bump USED to run HERE, between the header commit
      // and the measurement-rows transaction. That made them fire even when the
      // measurement transaction subsequently FAILED, and (worse) the order bump
      // committed a +1 that a retry — short-circuited by P0 to the empty header —
      // could never reconcile. They are now deferred to AFTER the measurement
      // transaction commits (see below), so a failed board leaves NO side-effect
      // to unwind and header compensation can simply delete the orphan.

      // Process measurements - support both pointId and pointCode
      const measurementResults: (typeof measurementResultsTable.$inferInsert)[] = [];
      const productPointCache: PointDefCache = new Map();
      const machinePointCache: PointDefCache = new Map();
      const defectCatalogCache = new Map<string, number | null>();
      const missingPointCodes: string[] = []; // Track missing point definitions
      // Doc 31 MP6 — count points the server spec-gate downgraded OK→NG so the
      // inspection's overallResult can be reconciled after the batch insert.
      let serverDowngradeCount = 0;
      const pointLimitEvalOn = isPointLimitEvalEnabled();
      // Doc 51 P2 (CASE #11) — convert the machine's measured unit into the point
      // def's unit before the 1D spec gate (default ON; inert unless the machine
      // actually sends a `unit`). Count points whose unit couldn't be reconciled.
      const unitConvertOn = isUnitConvertEnabled();
      let unitMismatchCount = 0;
      const unitMismatchPoints: string[] = [];
      // Doc 51 P1 (CASE #5) — count measurements whose image upload FAILED so the
      // silence is broken: those rows are marked (remark sentinel) + telemetry.
      let imageUploadFailures = 0;
      // Doc 31 Đợt B (OP3): defect codes reported but NOT found in defect_catalog.
      // Collected here and rolled up ONCE after the loop (best-effort telemetry —
      // never blocks ingest) so engineers see "code X seen N× but not in catalog".
      const unmatchedDefectCodesSeen: string[] = [];

      // V1 (doc 27 Đợt 7.1 — W7-A): retain ONE defect image for the post-ACK
      // inline AI gate (NG measurement's image preferred, else the first one).
      // Flag checked HERE so buffers are never retained when inline AI is off.
      const inlineGateOn = (process.env.AI_INLINE_GATE_ENABLED ?? "false").toLowerCase() === "true";
      let inlineGateImage: Buffer | null = null;
      let inlineGateImageIsNg = false;

      // ── P1-2 (doc 38 R-2b): warm the point-def cache ONCE per board ──────────
      // Resolve every DISTINCT measurement-point code up front (read-only, with
      // a small concurrency cap) so the per-point build loop below hits the
      // shared caches instead of issuing a serial DB lookup per row. Codes are
      // distinct (Set) so parallel warmers never double-read the same key.
      // Genuinely-missing codes are still auto-provisioned inside the loop
      // (the write path stays sequential + idempotent).
      {
        const distinctCodes = new Set<string>();
        for (const m of input.measurements) {
          if (m.pointId) distinctCodes.add(m.pointId);
          if (m.pointCode) distinctCodes.add(m.pointCode);
        }
        const codes = Array.from(distinctCodes);
        let wc = 0;
        const warmWorker = async () => {
          for (let j = wc++; j < codes.length; j = wc++) {
            try {
              await resolveMeasurementPointDefinition(
                codes[j],
                productModelRecord?.id,
                machine.id,
                productPointCache,
                machinePointCache,
              );
            } catch { /* warm is best-effort; the loop re-resolves on miss */ }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(6, codes.length) }, () => warmWorker()),
        );
      }

      // ── P1-2: bounded-concurrency image PRE-UPLOAD (was one sequential
      // storagePut per point). Decode each base64 image and upload with a fixed
      // concurrency cap via a hand-rolled semaphore (no new dependency), BEFORE
      // the DB record build/transaction. Results are keyed by measurement index
      // so input order is preserved; per-image failures are swallowed exactly as
      // the previous inline try/catch did. The inline-gate image is captured
      // here in input order (NG preferred) — identical selection to before.
      const uploadedImages: Array<{ url?: string; key?: string } | undefined> =
        new Array(input.measurements.length);
      {
        type UploadJob = { index: number; buffer: Buffer; ext: string; pointCode: string };
        const jobs: UploadJob[] = [];
        for (let i = 0; i < input.measurements.length; i++) {
          const m = input.measurements[i];
          if (!m.imageBase64 || m.imageBase64.length <= 200) continue;
          const pointCode = m.pointId || m.pointCode || 'UNKNOWN';
          // Already a URL — use as-is (no upload, no key), same as before.
          if (m.imageBase64.startsWith('http') || m.imageBase64.startsWith('/uploads')) {
            uploadedImages[i] = { url: m.imageBase64 };
            continue;
          }
          const base64Data = m.imageBase64.replace(/^data:image\/[^;]+;base64,/, '');
          const buffer = Buffer.from(base64Data, 'base64');
          // V1 inline-gate image capture (before upload; NG preferred).
          if (inlineGateOn && (!inlineGateImage || (!inlineGateImageIsNg && m.result === "NG"))) {
            inlineGateImage = buffer;
            inlineGateImageIsNg = m.result === "NG";
          }
          const ext = m.imageBase64.startsWith('data:image/png') ? 'png' : 'jpg';
          jobs.push({ index: i, buffer, ext, pointCode });
        }

        const IMAGE_UPLOAD_CONCURRENCY = 6;
        let cursor = 0;
        const uploadWorker = async () => {
          for (let j = cursor++; j < jobs.length; j = cursor++) {
            const job = jobs[j];
            try {
              const fileKey = `inspections/${inspectionId}/${job.pointCode}-${nanoid(8)}.${job.ext}`;
              const { url } = await storagePut(fileKey, job.buffer, `image/${job.ext === 'png' ? 'png' : 'jpeg'}`);
              uploadedImages[job.index] = { url, key: fileKey };
            } catch (imgErr) {
              console.error(`[submitInspection] Image upload failed for point ${job.pointCode}:`, imgErr);
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(IMAGE_UPLOAD_CONCURRENCY, jobs.length) }, () => uploadWorker()),
        );
      }

      for (let mi = 0; mi < input.measurements.length; mi++) {
        const measurement = input.measurements[mi];
        const candidateCodes = [measurement.pointId, measurement.pointCode].filter((code): code is string => Boolean(code));
        let pointDef: Awaited<ReturnType<typeof resolveMeasurementPointDefinition>> = null;
        let usedCode: string | undefined;
        
        for (const code of candidateCodes) {
          pointDef = await resolveMeasurementPointDefinition(
            code,
            productModelRecord?.id,
            machine.id,
            productPointCache,
            machinePointCache,
          );
          if (pointDef) {
            usedCode = code;
            break;
          }
        }

        // P0-A data-integrity: never persist pointDefId = 0. If no definition was
        // pre-configured, auto-provision a real one via the shared resolver so the
        // measurement stays visible to SPC/capability/heatmap analytics.
        const pointCode = measurement.pointId || measurement.pointCode || 'UNKNOWN';
        let resolvedPointDefId: number;
        if (pointDef?.id) {
          resolvedPointDefId = pointDef.id;
        } else {
          missingPointCodes.push(pointCode);
          console.warn(`[submitInspection] Point definition not found for: ${pointCode} (machine: ${machine.code}, product: ${resolvedProductModelCode || 'N/A'}) — auto-provisioning`);
          resolvedPointDefId = await resolveOrCreateMeasurementPointDefId(usedCode ?? pointCode, {
            productModelId: productModelRecord?.id,
            machineId: machine.id,
            productCache: productPointCache,
            machineCache: machinePointCache,
            autoCreate: true,
          });
        }
        assertValidPointDefId(resolvedPointDefId, `submitInspection (machine=${machine.code}, point=${pointCode})`);

        // Route measuredValue to the correct DB column based on type
        const rawValue = measurement.measuredValue;
        let numericValue: string | undefined = undefined;
        let textValue: string | undefined = undefined;
        if (rawValue !== undefined && rawValue !== null) {
          const num = Number(rawValue);
          if (!isNaN(num) && rawValue !== '') {
            numericValue = String(num); // decimal column accepts numeric string
          } else {
            textValue = String(rawValue); // non-numeric → measuredValueText
          }
        }

        // Image was already uploaded in the bounded-concurrency pre-pass above
        // (P1-2, doc 38 R-2b); read this row's pre-computed result by index.
        const uploaded = uploadedImages[mi];
        const uploadedImageUrl: string | undefined = uploaded?.url;
        const uploadedImageKey: string | undefined = uploaded?.key;

        // Doc 51 P1 (CASE #5) — an image the machine SENT that produced neither a
        // URL nor a key means the upload FAILED (storage down / decode error). The
        // old code swallowed it (console.error → imageUrl left undefined), so a NG
        // point lost its evidence image SILENTLY. Detect it here so the row can be
        // marked instead: same predicate the pre-upload pass used to enqueue a job.
        const intendedUpload =
          !!measurement.imageBase64 &&
          measurement.imageBase64.length > 200 &&
          !measurement.imageBase64.startsWith("http") &&
          !measurement.imageBase64.startsWith("/uploads");
        const imageUploadFailed = intendedUpload && !uploaded;
        if (imageUploadFailed) imageUploadFailures++;

        let defectCatalogId: number | undefined;
        let defectCodeRaw: string | undefined;
        if (measurement.defectCatalogCode) {
          const defectCode = measurement.defectCatalogCode.trim();
          if (defectCode) {
            if (!defectCatalogCache.has(defectCode)) {
              const defect = await db.getDefectCatalogByCode(defectCode);
              defectCatalogCache.set(defectCode, defect?.id ?? null);
            }
            const cachedDefectId = defectCatalogCache.get(defectCode);
            defectCatalogId = cachedDefectId ?? undefined;
            if (!defectCatalogId) {
              // OP3: unresolved code — keep the RAW code (honest, never dropped)
              // and queue it for the unmatched-code rollup. The measurement is
              // still persisted; only defectCatalogId stays null.
              defectCodeRaw = defectCode.slice(0, 50);
              unmatchedDefectCodesSeen.push(defectCode);
            }
          }
        }

        // Doc 31 MP6 (decision #2) — server-side spec gate. When the resolved
        // point def carries limits/criteria and POINT_LIMIT_EVAL_ENABLED is on,
        // the evaluator can DOWNGRADE a machine "OK" to "NG" on a real violation
        // (never upgrades, never touches NTF). Auto-provisioned points (no
        // pointDef) have no limits → machine verdict passes through untouched.
        //
        // Doc 51 P1 (QĐ#2) — LIMIT SOURCE SELECTION. By default (or for a
        // current/ahead board, or when the flag is off) the gate uses the LIVE
        // pointDef, exactly as before. For a STALE board under
        // SPEC_GATE_SNAPSHOT_ENABLED, it instead uses the limits reconstructed
        // for the instant the board was received — and when that history can't
        // confirm the older limits, it SKIPS the gate for this point (safe: the
        // machine's verdict stands) rather than gate a stale board by newer limits.
        let effectiveResult = measurement.result;
        let specGateRemark: string | undefined;
        if (pointDef && pointLimitEvalOn) {
          let gateLimits: PointLimitSource | null = pointDef as unknown as PointLimitSource;
          if (useSnapshotGate) {
            const snaps = await loadPointLimitSnapshots(resolvedPointDefId, pointSnapshotCache);
            // Doc 51 P2 batch-2 (§12.2 #2) — prefer VERSION-EXACT (0282) over the P1
            // instant proxy. `declaredConfigVersion` is the exact config the machine
            // graded under; when a snapshot carries the 0282 stamp we gate by the
            // limits live at THAT version, else fall back to instant, else (no usable
            // history) SKIP the gate (safe: machine verdict stands).
            const resolved = resolveGateLimitsForBoard({
              snapshots: snaps,
              liveLimits: pointDef as unknown as PointLimitSource,
              declaredVersion: declaredConfigVersion ?? null,
              atInstant: serverReceivedAt,
            });
            gateLimits = resolved.limits;
            if (resolved.limits === null) {
              snapshotMissingPoints++; // no usable snapshot → do NOT gate this stale point
            } else if (resolved.basis === "version") {
              versionGatedPoints++;
            } else if (resolved.basis === "live") {
              versionLivePoints++;     // point unchanged since declared V → live == V-era limits
            } else {
              snapshotGatedPoints++;   // instant-based reconstruction (P1)
            }
          }
          if (gateLimits) {
            const evalRes = evaluatePointResult(gateLimits, measurement, measurement.result, {
              convertUnits: unitConvertOn,
            });
            effectiveResult = evalRes.result;
            if (evalRes.overridden) {
              serverDowngradeCount++;
              const vtag = gateConfigVersion != null ? ` v${gateConfigVersion}` : "";
              specGateRemark = `Spec gate${vtag}: ${evalRes.violations.join("; ")}`.slice(0, 480);
            }
            // Doc 51 P2 (CASE #11) — the machine's unit couldn't be reconciled with
            // the def's unit, so the 1D gate was SKIPPED for this point (never a
            // silent NG). Surface it, do not fail the board.
            if (evalRes.unitMismatch) {
              unitMismatchCount++;
              unitMismatchPoints.push(`${pointCode}(${measurement.unit ?? "?"}→${(gateLimits.unit ?? "?")})`);
            }
          }
        }

        measurementResults.push({
          inspectionId,
          pointDefId: resolvedPointDefId,
          measuredValue: numericValue,
          measuredValueText: textValue,
          valueZ: toOptionalDecimal(measurement.valueZ),
          valueHeight: toOptionalDecimal(measurement.valueHeight),
          valueArea: toOptionalDecimal(measurement.valueArea),
          valueVolume: toOptionalDecimal(measurement.valueVolume),
          valueVoidPct: toOptionalDecimal(measurement.valueVoidPct),
          valueCoplanarity: toOptionalDecimal(measurement.valueCoplanarity),
          valueWarpage: toOptionalDecimal(measurement.valueWarpage),
          valueOffsetX: toOptionalDecimal(measurement.valueOffsetX),
          valueOffsetY: toOptionalDecimal(measurement.valueOffsetY),
          valueTilt: toOptionalDecimal(measurement.valueTilt),
          valueThickness: toOptionalDecimal(measurement.valueThickness),
          defectCatalogId,
          defectCodeRaw,
          defectSeverity: measurement.defectSeverity,
          result: effectiveResult,
          // Doc 51 P1 (CASE #5) — when the evidence image failed to upload, stamp a
          // queryable sentinel into remark (LIKE '%[IMG_UPLOAD_FAILED]%') so the
          // missing image is VISIBLE, never silent. Preserves any spec-gate/machine
          // remark alongside it.
          remark: (() => {
            const base = specGateRemark ?? measurement.remark ?? (pointDef ? undefined : `Point: ${pointCode}`);
            if (!imageUploadFailed) return base;
            return `${base ? base + " " : ""}[IMG_UPLOAD_FAILED]`.slice(0, 480);
          })(),
          imageUrl: uploadedImageUrl,
          imageKey: uploadedImageKey,
        });
      }
      
      // Log summary of missing point definitions
      if (missingPointCodes.length > 0) {
        console.warn(`[submitInspection] ${missingPointCodes.length} measurement(s) saved without point definition: ${missingPointCodes.join(', ')}`);
      }

      // Doc 31 Đợt B (OP3): roll up any unresolved defect codes for the curation
      // panel. Best-effort — a telemetry failure must never fail the ingest.
      if (unmatchedDefectCodesSeen.length > 0) {
        try {
          await db.recordUnmatchedDefectCodes(unmatchedDefectCodesSeen, {
            machineId: machine.id,
            productModelId: productModelRecord?.id ?? null,
          });
          console.warn(`[submitInspection] ${unmatchedDefectCodesSeen.length} defect code(s) not in defect_catalog (recorded for curation): ${Array.from(new Set(unmatchedDefectCodesSeen)).join(', ')}`);
        } catch (telemetryErr) {
          console.error('[submitInspection] unmatched-defect-code telemetry failed (non-fatal):', telemetryErr);
        }
      }

      // Doc 35 W2.8 (W2-A) — persist the measurement rows AND the spec-gate
      // overall-NG promotion in ONE transaction so a crash mid-write can't leave
      // a board whose per-point rows say NG under an OK header. The inspection
      // header insert + external image uploads already ran above (image/object
      // I/O must stay OUTSIDE the DB transaction), and the fire-and-forget
      // post-ACK hooks below (embedding, quality-gate, WIP, inline AI) stay
      // OUTSIDE too so they can never block/roll back ingest. Uses the repo's
      // getDb()/db.transaction/tx.insert convention (see fleet/resourceManager).
      //
      // Doc 31 MP6 — when the server spec-gate downgraded ≥1 point to NG on a
      // machine-"OK" inspection, promote the board's overallResult to NG so
      // yield/FPY stays consistent with the per-point verdicts. originalResult
      // (the machine's original) is left intact for audit. NOTE: downstream
      // realtime NG alerts below key off the machine's original overall
      // (input.overallResult) — a server-downgraded board is reflected in stored
      // data/analytics but does not retro-fire the live NG alert.
      const promoteOverallToNg = serverDowngradeCount > 0 && input.overallResult === "OK";
      // Doc 51 P1 (CASE #5) — keys of images ALREADY uploaded to object storage for
      // THIS submission. If the measurement transaction below fails, these are
      // orphans (bytes in storage, no DB row pointing at them) → we compensate by
      // deleting them so a failed insert can't silently accrete dead objects.
      const uploadedStorageKeys = uploadedImages
        .map((u) => u?.key)
        .filter((k): k is string => typeof k === "string" && k.length > 0);
      if (measurementResults.length > 0 || promoteOverallToNg) {
        const dbInstance = await getDb();
        if (!dbInstance) throw new Error("Database not available");
        try {
          await dbInstance.transaction(async (tx) => {
            if (measurementResults.length > 0) {
              await tx.insert(measurementResultsTable).values(measurementResults);
            }
            if (promoteOverallToNg) {
              await tx
                .update(productInspections)
                .set({ overallResult: "NG", updatedAt: new Date() })
                .where(drizzleAnd(
                  drizzleEq(productInspections.id, inspectionId),
                  drizzleEq(productInspections.overallResult, "OK"),
                ));
            }
          });
        } catch (txErr) {
          // COMPENSATION — the measurement rows did NOT persist, so every image we
          // pre-uploaded for this board is now orphaned. Delete them (best-effort,
          // storageDelete never throws) BEFORE re-throwing so the caller's WAL
          // buffer / retry path re-uploads cleanly instead of leaking objects.
          if (uploadedStorageKeys.length > 0) {
            console.warn(
              `[submitInspection] measurement tx failed for inspection=${inspectionId} — ` +
                `compensating ${uploadedStorageKeys.length} orphaned image(s).`,
            );
            await Promise.all(
              uploadedStorageKeys.map(async (key) => {
                try {
                  const res = await storageDelete(key);
                  if (!res.deleted && res.error) {
                    console.error(`[submitInspection] orphan image cleanup failed for ${key}:`, res.error);
                  }
                } catch (delErr) {
                  console.error(`[submitInspection] orphan image cleanup threw for ${key}:`, delErr);
                }
              }),
            );
          }
          // ── Doc 51 P2 (§11.2 residual #1) — HEADER COMPENSATION ───────────────
          // The header committed in its own transaction (db.createProductInspection)
          // but the measurement rows did NOT persist. Without cleanup the P0
          // duplicate short-circuit would resolve every retry to this EMPTY header
          // and the board would never get its measurements. Delete the orphan (and
          // its idempotency-ledger claim, so the retry re-inserts fresh) BEFORE
          // re-throwing. Best-effort — a cleanup failure must not mask the original
          // error, and no side-effects (ERP outbox / order bump) have run yet.
          if (compensateOrphanHeaderEnabled()) {
            try {
              await db.deleteInspectionForCompensation({
                inspectionId,
                machineId: machine.id,
                idempotencyKey: input.idempotencyKey,
              });
              console.warn(
                `[submitInspection] measurement tx failed for inspection=${inspectionId} — ` +
                  `deleted orphaned header so retry re-inserts a complete board.`,
              );
            } catch (compErr) {
              console.error(
                `[submitInspection] header compensation FAILED for inspection=${inspectionId} ` +
                  `(empty header may persist; retry will short-circuit to it):`,
                (compErr as Error)?.message ?? compErr,
              );
            }
          }
          throw txErr;
        }
        if (promoteOverallToNg) {
          console.warn(`[submitInspection] spec-gate downgraded ${serverDowngradeCount} point(s) → inspection ${inspectionId} overall promoted to NG`);
        }
      }

      // ══ Doc 51 P2 (§11.2 residual #1) — DEFERRED SIDE-EFFECTS ══════════════════
      // Now that the measurement rows have COMMITTED (or there were none to write),
      // the board is fully persisted — run the ERP outbox publish and the
      // production-order quantity bump. Moved here from before the measurement
      // transaction so that a measurement failure (which compensated the header
      // above) leaves NO ERP event and NO phantom order increment behind.
      publishToOutbox({
        eventType: "quality-result",
        payload: {
          inspectionId,
          serialNumber: input.serialNumber,
          machineId: machine.id,
          machineCode: machine.code,
          overallResult: input.overallResult,
          productModelId: productModelRecord?.id ?? null,
          productionOrderCode: input.productionOrderCode ?? null,
          inspectionTime: localInspTime.toISOString(),
        },
        idempotencyKey: `qr-${inspectionId}`,
        corporateCode: input.companyCode ?? null,
      });

      // Update production order quantities if linked
      if (productionOrderId) {
        const updateData: any = { completedQuantity: 1 };
        if (input.overallResult === 'OK') {
          updateData.okQuantity = 1;
        } else {
          updateData.ngQuantity = 1;
        }
        await db.updateProductionOrderQuantities(productionOrderId, updateData);
      }

      // ══ Doc 51 P2 (CASE #11) — surface unit-conversion mismatches ══════════════
      if (unitMismatchCount > 0) {
        console.warn(
          `[submitInspection] ${unitMismatchCount} measurement(s) had an UNCONVERTIBLE unit for inspection=${inspectionId} ` +
            `serial=${input.serialNumber} — 1D spec gate SKIPPED for: ${unitMismatchPoints.join(", ")} ` +
            `(machine unit vs point-def unit incompatible; board NOT failed on it).`,
        );
      }

      // ══ Doc 51 P2 (CASE #8) — SERIAL-COLLISION SOFT DETECT (QĐ#3) ══════════════
      // A serial already seen from a DIFFERENT machine in the recent window ⇒ two
      // machines reporting one serial, or a mis-scan. TAG the row (never reject) +
      // one throttled alert. Opt-in (one extra read/board on the hot path). This
      // is NOT an idempotency retry: same machine + same key already short-circuited.
      if (serialCollisionDetectEnabled()) {
        const since = new Date(localInspTime.getTime() - serialCollisionWindowSeconds() * 1000);
        const otherMachineId = await findCollidingSerialMachine({
          serialNumber: input.serialNumber,
          machineId: machine.id,
          since,
        });
        if (otherMachineId != null) {
          await persistSuspectedDuplicateSerial(inspectionId);
          console.warn(
            `[submitInspection] SUSPECTED DUPLICATE SERIAL — serial=${input.serialNumber} was already ` +
              `reported by machineId=${otherMachineId} within ${serialCollisionWindowSeconds()}s; ` +
              `machine=${machine.code} (id=${machine.id}) board inspection=${inspectionId} TAGGED, NOT rejected (QĐ#3).`,
          );
          void import("../services/aiSmartAlertRouter")
            .then(({ routeAlert }) =>
              routeAlert({
                type: "PATTERN_ANOMALY",
                machineId: machine.id,
                severity: "MEDIUM",
                message:
                  `Serial ${input.serialNumber} bị BÁO TRÙNG giữa máy ${machine.code} và machineId=${otherMachineId} ` +
                  `trong ${serialCollisionWindowSeconds()}s — có thể quét trùng hoặc hai máy cùng serial. Board VẪN được lưu, đã gắn cờ.`,
                data: {
                  reason: "serial_collision",
                  serialNumber: input.serialNumber,
                  machineId: machine.id,
                  otherMachineId,
                  inspectionId,
                },
              }),
            )
            .catch((err) => {
              console.error("[submitInspection] serial-collision alert routing failed (non-fatal):", err);
            });
        }
      }

      // Doc 51 P1 (QĐ#2) — record which config version the spec-gate used (0276)
      // ONLY in snapshot mode (the divergent case worth tracing). Flag OFF / a
      // current board gates by LIVE by definition, so a NULL gateConfigVersion
      // means exactly that — and the default hot path (QĐ#7: 100 boards/s) takes
      // ZERO extra writes, honouring QĐ#1's "flag off ⇒ no perf change". Best-effort
      // AFTER the measurements committed; never fails ingest.
      if (useSnapshotGate) {
        await persistGateConfigVersion(inspectionId, gateConfigVersion);
      }
      if (useSnapshotGate && (snapshotGatedPoints > 0 || snapshotMissingPoints > 0 || versionGatedPoints > 0 || versionLivePoints > 0)) {
        console.warn(
          `[submitInspection] SNAPSHOT SPEC-GATE — inspection=${inspectionId} ` +
            `serial=${input.serialNumber} graded under declared config v${gateConfigVersion} ` +
            `(live v${liveConfigVersion}): ${versionGatedPoints} point(s) gated VERSION-EXACT (0282), ` +
            `${versionLivePoints} point(s) unchanged since v${gateConfigVersion} → gated LIVE, ` +
            `${snapshotGatedPoints} point(s) gated by INSTANT snapshot (fallback), ` +
            `${snapshotMissingPoints} point(s) had no usable snapshot → gate SKIPPED (safe).`,
        );
      }
      // Doc 51 P1 (CASE #5) — surface silent image-upload losses.
      if (imageUploadFailures > 0) {
        console.error(
          `[submitInspection] ${imageUploadFailures} image upload(s) FAILED for inspection=${inspectionId} ` +
            `serial=${input.serialNumber} — those measurement rows are tagged [IMG_UPLOAD_FAILED] (no evidence image).`,
        );
      }

      // Emit realtime alerts if NG
      if (input.overallResult === "NG") {
        // Get factory/workshop info for alert
        const station = await db.getStationById(machine.stationId);
        const line = station ? await db.getLineById(station.lineId) : null;
        const workshop = line ? await db.getWorkshopById(line.workshopId) : null;
        const factory = workshop ? await db.getFactoryById(workshop.factoryId) : null;

        emitNGAlert(
          machine.id,
          machine.name,
          machine.code,
          input.serialNumber,
          factory?.name,
          workshop?.name
        );
        
        // Publish NG alert to MQTT clients
        try {
          const { publishNGAlert } = await import('../services/mqttService');
          const productModelInfo = productModelRecord || null;
          
          // Build pointCode→imageUrl lookup from auto-uploaded images
          const pointImageMap = new Map<string, string>();
          // Build pointCode→referenceImageUrl lookup from resolved point definitions
          const pointRefImageMap = new Map<string, string>();
          if (input.measurements) {
            for (let i = 0; i < input.measurements.length; i++) {
              const m = input.measurements[i];
              const mr = measurementResults[i];
              if (mr?.imageUrl) {
                const code = m.pointId || m.pointCode || 'UNKNOWN';
                pointImageMap.set(code, mr.imageUrl);
              }
              // Lookup reference image from resolved pointDef cache
              const code = m.pointId || m.pointCode || 'UNKNOWN';
              const normalizedCode = code.trim();
              // Check product cache first, then machine cache
              const cachedDef = productPointCache.get(normalizedCode) || machinePointCache.get(normalizedCode);
              if (cachedDef?.referenceImageUrl) {
                pointRefImageMap.set(code, cachedDef.referenceImageUrl);
              }
            }
          }

          await publishNGAlert({
            machineId: machine.id,
            machineName: machine.name,
            machineCode: machine.code,
            serialNumber: input.serialNumber,
            stationId: machine.stationId,
            factoryName: factory?.name,
            workshopName: workshop?.name,
            lineName: line?.name,
            stationName: station?.name,
            inspectionId,
            timestamp: new Date(),
            // Enhanced product info
            productModelId: productModelInfo?.id,
            productModelName: productModelInfo?.name || resolvedProductModelCode,
            productModelCode: productModelInfo?.code || resolvedProductModelCode,
            // Overall inspection result
            overallResult: input.overallResult,
            // Measurement results with proper uploaded image URLs (not base64)
            measurementResults: input.measurements?.filter(m => m.result === 'NG').map(m => {
              const pointCode = m.pointId || m.pointCode || 'UNKNOWN';
              const normalizedPc = pointCode.trim();
              const def = productPointCache.get(normalizedPc) || machinePointCache.get(normalizedPc);
              return {
                pointId: def?.id,
                pointCode,
                result: m.result,
                value: m.measuredValue,
                imageUrl: pointImageMap.get(pointCode),
                referenceImageUrl: pointRefImageMap.get(pointCode),
                workstationId: def?.workstationId ?? undefined,
                normalizedX: def?.normalizedX != null ? Number(def.normalizedX) : undefined,
                normalizedY: def?.normalizedY != null ? Number(def.normalizedY) : undefined,
                normalizedRadius: def?.normalizedRadius != null ? Number(def.normalizedRadius) : undefined,
              };
            }) || [],
            // Determine severity based on NG count
            severity: (input.measurements?.filter(m => m.result === 'NG').length || 0) >= 3 ? 'critical' : 'high',
          });
        } catch (mqttError) {
          console.error('[MQTT] Failed to publish NG alert:', mqttError);
        }
      }

      // Invalidate cache after new inspection
      statsCache.invalidate(CACHE_KEYS.DASHBOARD_STATS);
      statsCache.invalidate(CACHE_KEYS.MACHINE_STATS);
      statsCache.invalidate(CACHE_KEYS.DAILY_STATS);
      
      // Invalidate statistics cache (async, don't await)
      cachedStats.invalidateStatisticsCache().catch(err => {
        console.error('[Cache] Failed to invalidate statistics cache:', err);
      });

      // Get updated stats and emit dashboard update
      const machineStats = await db.getMachineStats(machine.id);
      emitDashboardUpdate({
        type: "STATS_UPDATE",
        machineId: machine.id,
        stats: machineStats,
        timestamp: new Date(),
      });

      // Check yield rate and emit warning if below threshold
      if (machineStats.yieldRate < 90) {
        emitYieldWarning(
          machine.id,
          machine.name,
          machine.code,
          machineStats.yieldRate,
          90
        );
      }

      // Check NG rate thresholds per measurement point → auto MQTT alert
      try {
        const { checkNgRateAfterInspection } = await import('../services/ngRateAlertService');
        // Run async, don't block the response
        checkNgRateAfterInspection({
          stationId: machine.stationId,
          machineId: machine.id,
          inspectionId,
          productModelId: productModelRecord?.id,
        }).catch(err => {
          console.error('[NgRateAlert] Failed to check NG rate thresholds:', err);
        });
      } catch (ngRateErr) {
        console.error('[NgRateAlert] Failed to import ngRateAlertService:', ngRateErr);
      }

      // P0-D: realtime quality-gate evaluation. Runs AFTER results are persisted.
      // Fire-and-forget + fully guarded — a gate evaluation failure must never
      // fail the inspection insert. Does NOT touch P0-A's resolver/assert logic.
      try {
        const { evaluateGatesAfterInspection } = await import('../services/qualityGateEvaluator');
        evaluateGatesAfterInspection({
          machineId: machine.id,
          inspectionId,
          productModelId: productModelRecord?.id ?? null,
          stationId: machine.stationId ?? null,
        }).catch(err => {
          console.error('[QualityGate] post-inspection evaluation failed:', err);
        });
      } catch (gateErr) {
        console.error('[QualityGate] Failed to import qualityGateEvaluator:', gateErr);
      }

      // P2 WIP write-path: populate wip_tracking / station_dwell_time /
      // line_balance_metrics + bump the matching production order. Runs AFTER
      // results are persisted; fire-and-forget + fully guarded (the service never
      // throws) so it can never fail the inspection insert. Does NOT touch the
      // P0-A resolver/assert nor the P0-D quality-gate logic above.
      try {
        const { ingestInspectionToWip } = await import('../services/wipIngestService');
        ingestInspectionToWip({
          inspectionId,
          serialNumber: input.serialNumber,
          lotNumber: input.batchNumber ?? null,
          overallResult: input.overallResult,
          machineId: machine.id,
          stationId: machine.stationId ?? null,
          productModelId: productModelRecord?.id ?? null,
          productCode: resolvedProductModelCode ?? null,
          cycleTimeSec: input.cycleTime ?? null,
          // Explicit order link → wipIngest skips its heuristic order bump
          // (the inline block above already incremented completedQuantity).
          productionOrderId: productionOrderId ?? null,
        }).catch(err => {
          console.error('[wipIngest] post-inspection ingest failed:', err);
        });
      } catch (wipErr) {
        console.error('[wipIngest] Failed to import wipIngestService:', wipErr);
      }

      // V1/V5/V18 (doc 27 Đợt 7.1 — W7-A): INLINE AI quality gate + NTF seam.
      // Flag-gated (AI_INLINE_GATE_ENABLED, default OFF) fire-and-forget:
      // scheduled with setImmediate so it runs strictly AFTER this function
      // returns — the machine's ingest ACK is NEVER delayed or poisoned by AI.
      // Per-machine/product enablement (quality-gate config `enabled`), the
      // AI-down circuit breaker and the NEEDS_REVIEW fallback all live inside
      // runInlineQualityGate. Success writes use processQualityGate — the SAME
      // shape as the on-demand UI path — and feed the A/B canary (V5).
      if (inlineGateOn && inlineGateImage) {
        const gateImage = inlineGateImage;
        const gateProductModelId = productModelRecord?.id ?? null;
        const gateMachineId = machine.id;
        setImmediate(() => {
          import("../services/aiQualityGate")
            .then(({ runInlineQualityGate }) =>
              runInlineQualityGate({
                inspectionId,
                machineId: gateMachineId,
                productModelId: gateProductModelId,
                source: "machine_api",
                getImage: () => gateImage,
              }),
            )
            .catch((err) => {
              console.error(
                `[InlineGate] post-ingest AI gate failed for inspection ${inspectionId}:`,
                (err as Error)?.message ?? err,
              );
            });
        });
      }

      // Doc 51 P2 (§5.6) — request-level audit of the fully-persisted board (default OFF).
      auditInspectionSubmission({
        machineId: machine.id,
        machineCode: machine.code,
        serialNumber: input.serialNumber,
        overallResult: input.overallResult,
        inspectionId,
        authMethod: auth.method,
        duplicate: false,
      });

      return { success: true as const, inspectionId };
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P2 batch-2 (§5.2 P2, CASE khởi tạo) — SHARED point/fiducial projectors.
//
// getPoints (full pull) and deltaSyncPoints (incremental pull) MUST hand a machine
// the SAME geometry so a machine that initialises via getPoints is not blind to
// shape/geometry/cells/fiducials/coordinateMode (previously getPoints shipped only
// legacy circle fields → every non-circle point was mis-inspected as a circle).
// One projector, one source of truth — no copy-paste drift.
// ════════════════════════════════════════════════════════════════════════════

/** Project one measurement_point_defs row into the machine sync payload (geometry-
 *  complete). `lighting` is the point's illumination recipe rows (may be empty). */
function projectSyncPoint(p: Record<string, any>, lighting: any[] = []): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    measurementType: p.measurementType,
    // Fine-grained catalog type (SOLDER/XRAY/POSITION/…).
    measurementTypeCode: p.measurementTypeCode ?? null,
    unit: p.unit,
    lowerLimit: p.lowerLimit,
    upperLimit: p.upperLimit,
    nominalValue: p.nominalValue,
    positionX: p.positionX,
    positionY: p.positionY,
    radius: p.radius,
    normalizedX: p.normalizedX,
    normalizedY: p.normalizedY,
    normalizedRadius: p.normalizedRadius,
    cropWidth: p.cropWidth,
    cropHeight: p.cropHeight,
    orderIndex: p.orderIndex,
    isActive: p.isActive,
    // P1: shape + geometry (additive) — the fields getPoints previously omitted.
    shape: p.shape ?? "circle",
    geometry: p.geometry ?? null,
    // 3D/solder/xray/position limits + criteria (same limits the server gates with).
    positionZ: p.positionZ ?? null,
    heightMin: p.heightMin ?? null,
    heightMax: p.heightMax ?? null,
    heightNominal: p.heightNominal ?? null,
    areaMin: p.areaMin ?? null,
    areaMax: p.areaMax ?? null,
    volumeMin: p.volumeMin ?? null,
    volumeMax: p.volumeMax ?? null,
    coplanarityMax: p.coplanarityMax ?? null,
    warpageMax: p.warpageMax ?? null,
    voidPctMax: p.voidPctMax ?? null,
    offsetXMax: p.offsetXMax ?? null,
    offsetYMax: p.offsetYMax ?? null,
    tiltMax: p.tiltMax ?? null,
    thicknessMin: p.thicknessMin ?? null,
    thicknessMax: p.thicknessMax ?? null,
    criteria: p.criteria ?? null,
    // Multi-shot lighting recipe for this point (may be []).
    lighting: (lighting ?? []).map((l: any) => ({
      shotIndex: l.shotIndex,
      name: l.name ?? null,
      lightSource: l.lightSource,
      color: l.color,
      colorHex: l.colorHex ?? null,
      intensityPct: l.intensityPct,
      angleDeg: l.angleDeg ?? null,
      exposureUs: l.exposureUs ?? null,
      gain: l.gain ?? null,
      focusOffsetUm: l.focusOffsetUm ?? null,
      opticalFilter: l.opticalFilter ?? null,
      purpose: l.purpose ?? null,
    })),
    lastModifiedAt: p.lastModifiedAt?.toISOString?.() ?? null,
  };
  // P1: server-side expansion of an array shape into individual cells.
  if (p.shape === "array" && p.geometry) {
    try {
      base.cells = expandArrayGeometry(p.geometry as any);
    } catch {
      base.cells = [];
    }
  }
  return base;
}

/** Project fiducial_marks rows into the machine sync payload. */
function projectFiducials(rows: any[]): Array<Record<string, unknown>> {
  return (rows ?? []).map((f: any) => ({
    id: f.id,
    code: f.code,
    name: f.name,
    type: f.type,
    positionX: f.positionX,
    positionY: f.positionY,
    normalizedX: f.normalizedX != null ? Number(f.normalizedX) : null,
    normalizedY: f.normalizedY != null ? Number(f.normalizedY) : null,
    searchWindowW: f.searchWindowW,
    searchWindowH: f.searchWindowH,
    templateImageUrl: f.templateImageUrl ?? null,
    orderIndex: f.orderIndex,
  }));
}

export const machineApiRouter = router({
  // Submit inspection data from machine — DURABLE (doc 27 W2-C, gap C3/R11):
  // a transient failure (DB down) buffers the full payload to the disk WAL and
  // ACKs `{ success:true, queued:true }`; the backfill worker replays it with
  // idempotency once the DB recovers. Permanent errors (bad key / validation)
  // still throw. With INSPECTION_STORE_FORWARD_ENABLED off → exact old behaviour.
  submitInspection: publicProcedure
    .input(submitInspectionInputSchema)
    .mutation(async ({ input, ctx }) => {
      const headerKey = machineHeaderKey(ctx);
      // Stamp receive-time when the machine omitted inspectionTime so a WAL
      // replay reproduces the same timestamp (stable idempotency key) and the
      // persisted row keeps the ORIGINAL receive time, not the replay time.
      //
      // ⚠ Doc 51 P1 — this `?? new Date()` is EXACTLY the hole 0272 could not
      // close: a machine that omits inspectionTime gets a NEW stamp on every
      // receive, so each retry lands on a different natural key and inserts a
      // fresh row. Only `input.idempotencyKey` (ledger-enforced, 0275) protects
      // those machines. Nothing here can fix it — two independent HTTP requests
      // carry no shared identity unless the CLIENT provides one.
      const receivedAt = new Date();
      const payload: SubmitInspectionInput = {
        ...input,
        inspectionTime: input.inspectionTime ?? receivedAt.toISOString(),
        // Doc 51 P1 (CASE #3) — provenance stamped from the ORIGINAL request and
        // carried through the WAL. Assigned AFTER the spread so a machine that
        // tries to send these cannot forge its own receive time or hide a naive
        // timestamp behind timeSource:'machine_utc'.
        serverReceivedAt: receivedAt.toISOString(),
        timeSource: classifyInspectionTime(input.inspectionTime),
      };
      // The WAL entry must be self-authenticating on replay: fold a header
      // credential into the payload's apiKey field (never persisted to the DB).
      const walPayload: SubmitInspectionInput = {
        ...payload,
        apiKey: payload.apiKey ?? headerKey ?? undefined,
      };
      try {
        const result = await processInspectionSubmission(payload, { headerKey, rateLimit: true });
        if (inspectionStoreForwardEnabled()) {
          // Ledger the live success so a queued duplicate of the SAME submission
          // (machine retry captured while the DB flapped) dedupes on backfill.
          markSubmissionApplied(computeSubmissionKey(walPayload));
          if (bufferedInspectionCount() > 0) {
            // Opportunistic drain: the DB is demonstrably up again.
            ensureInspectionWalWired();
            void backfillInspections().catch(() => undefined);
          }
        }
        return result;
      } catch (err) {
        if (!inspectionStoreForwardEnabled() || isPermanentSubmitError(err)) throw err;
        ensureInspectionWalWired();
        const buffered = await bufferSubmission(walPayload);
        if (!buffered.buffered && !buffered.duplicate) throw err; // bounds evicted it → never lie
        console.error(
          `[submitInspection] transient failure (${(err as Error)?.message || err}) — ` +
            `${buffered.duplicate ? "submission already queued in" : "payload queued to"} inspection WAL ` +
            `(serial=${payload.serialNumber}, submissionId=${buffered.key.slice(0, 12)}…)`,
        );
        return {
          success: true as const,
          queued: true as const,
          submissionId: buffered.key,
          inspectionId: null,
        };
      }
    }),

  // ============================================================
  // Doc 27 W2-C (C7) — per-machine key lifecycle (admin RBAC).
  // Service layer: server/services/machineAuthService.ts (W2-D's onboarding
  // wizard calls these). Plaintext keys are returned EXACTLY ONCE.
  // ============================================================
  listKeys: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => listMachineKeys(input.machineId)),

  issueKey: protectedProcedure
    .use(requirePermission("admin_system", "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive(),
      name: z.string().min(1).max(255).optional(),
      scopes: z.array(z.string().min(1).max(64)).min(1).optional(),
      expiresAt: z.union([z.string(), z.date()]).nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const expiresAt = input.expiresAt == null || input.expiresAt === ""
        ? null
        : input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
      if (expiresAt && Number.isNaN(expiresAt.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid expiresAt date" });
      }
      return issueMachineKey({
        machineId: input.machineId,
        name: input.name,
        scopes: input.scopes,
        expiresAt,
        createdBy: ctx.user?.id ?? null,
      });
    }),

  rotateKey: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(z.object({ keyId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => rotateMachineKey(input.keyId, ctx.user?.id ?? null)),

  revokeKey: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(z.object({ keyId: z.number().int().positive() }))
    .mutation(async ({ input }) => revokeMachineKey(input.keyId)),

  // Upload image for measurement
  uploadImage: publicProcedure
    .input(z.object({
      apiKey: z.string(),
      inspectionId: z.number(),
      pointCode: z.string(),
      imageBase64: z.string().max(MAX_IMAGE_B64, IMAGE_B64_TOO_LARGE),
      mimeType: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Validate API key (per-machine scoped key or legacy shared key)
      const auth = await authenticateMachine({
        apiKey: input.apiKey,
        headerKey: machineHeaderKey(ctx),
        scope: "ingest:write",
      });
      const machine = auth.machine;
      enforceMachineIngestRateLimit(auth);

      const inspection = await db.getProductInspectionById(input.inspectionId);
      if (!inspection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inspection not found' });
      }

      const inspectionModel = inspection.productModelId
        ? await db.getProductModelById(inspection.productModelId)
        : inspection.productModel
          ? await db.getProductModelByCode(inspection.productModel.trim())
          : undefined;

      const productPointCache: PointDefCache = new Map();
      const machinePointCache: PointDefCache = new Map();
      const pointDef = await resolveMeasurementPointDefinition(
        input.pointCode,
        inspectionModel?.id,
        machine.id,
        productPointCache,
        machinePointCache,
      );
      if (!pointDef) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement point not found' });
      }

      // Find the measurement result
      const { measurementResults } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }

      const results = await dbInstance.select().from(measurementResults)
        .where(and(
          eq(measurementResults.inspectionId, input.inspectionId),
          eq(measurementResults.pointDefId, pointDef.id)
        ))
        .limit(1);

      if (results.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement result not found' });
      }

      // Upload image to S3
      const buffer = Buffer.from(input.imageBase64, 'base64');
      const ext = input.mimeType?.split('/')[1] || 'jpg';
      const fileKey = `inspections/${input.inspectionId}/${input.pointCode}-${nanoid(8)}.${ext}`;
      
      const { url } = await storagePut(fileKey, buffer, input.mimeType || 'image/jpeg');

      // Update measurement result with image URL
      await dbInstance.update(measurementResults).set({
        imageUrl: url,
        imageKey: fileKey,
      }).where(eq(measurementResults.id, results[0].id));

      return { success: true, imageUrl: url };
    }),

  syncMeasurementPoints: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      // Source image dimensions from the third-party app
      // Used to auto-transform absolute pixel coordinates when resolutions differ
      sourceImageWidth: z.number().int().positive().optional(),
      sourceImageHeight: z.number().int().positive().optional(),
      clientVersion: z.string().max(50).optional(),
      points: z.array(measurementPointSyncSchema).min(1),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      const auth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "ingest:write",
      });
      const machine = auth.machine;
      enforceMachineIngestRateLimit(auth);

      await db.updateMachineHeartbeat(machine.id);

      const syncStartTime = Date.now();
      const normalizedModelCode = input.productModelCode.trim();
      const productModel = await db.getProductModelByCode(normalizedModelCode);
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product model not found' });
      }

      const workstationCache: WorkstationCache = new Map();
      const results: Array<{ code: string; id: number; action: 'created' | 'updated'; coordTransformed?: boolean; limitBlocked?: boolean }> = [];
      const errors: Array<{ code: string; message: string }> = [];
      // Doc 31 B.6 — # of existing points whose incoming LIMIT change was blocked by
      // the lifecycle gate (live product). Geometry/image still sync; only the
      // approved LSL/USL/target are protected. Surfaced in the sync log + response.
      let limitGateBlockedCount = 0;
      // Doc 51 P2 batch-2 (§5.2 P2) — optimistic-lock telemetry on the write-back.
      const lockEnforced = machineSyncOptimisticLockEnabled();
      let staleConflictCount = 0;   // enforced writes rejected as stale (CONFLICT)
      let blindOverwriteCount = 0;  // blind writes over a point changed since the machine cached it

      // Coordinate normalization helpers
      const serverW = productModel.imageWidth;
      const serverH = productModel.imageHeight;
      const sourceW = input.sourceImageWidth;
      const sourceH = input.sourceImageHeight;
      const hasServerDimensions = serverW != null && serverH != null && serverW > 0 && serverH > 0;

      /**
       * Resolve coordinates: handles 3 scenarios:
       * 1. Client sends normalizedX/Y → compute absolute from server dimensions
       * 2. Client sends sourceImageWidth/Height (different from server) → transform absolute coords
       * 3. Same resolution or no info → use absolute coords as-is
       * Always computes normalizedX/Y for storage
       */
      function resolveCoordinates(point: typeof input.points[0]) {
        let finalX = point.positionX;
        let finalY = point.positionY;
        let finalRadius = point.radius ?? 20;
        let normX: string | undefined;
        let normY: string | undefined;
        let normR: string | undefined;
        let transformed = false;

        if (point.normalizedX != null && point.normalizedY != null && hasServerDimensions) {
          // Case 1: Client sent normalized coordinates → compute absolute for server image
          finalX = Math.round(point.normalizedX * serverW!);
          finalY = Math.round(point.normalizedY * serverH!);
          normX = point.normalizedX.toFixed(8);
          normY = point.normalizedY.toFixed(8);
          if (point.normalizedRadius != null) {
            finalRadius = Math.round(point.normalizedRadius * serverW!);
            normR = point.normalizedRadius.toFixed(8);
          }
          transformed = true;
        } else if (sourceW && sourceH && hasServerDimensions && (sourceW !== serverW || sourceH !== serverH)) {
          // Case 2: Source resolution differs from server → transform coordinates
          const scaleX = serverW! / sourceW;
          const scaleY = serverH! / sourceH;
          finalX = Math.round(point.positionX * scaleX);
          finalY = Math.round(point.positionY * scaleY);
          finalRadius = Math.round(finalRadius * scaleX);
          normX = (finalX / serverW!).toFixed(8);
          normY = (finalY / serverH!).toFixed(8);
          normR = (finalRadius / serverW!).toFixed(8);
          transformed = true;
        } else if (hasServerDimensions) {
          // Case 3: Same resolution or no source info → compute normalized from absolute
          normX = (point.positionX / serverW!).toFixed(8);
          normY = (point.positionY / serverH!).toFixed(8);
          normR = (finalRadius / serverW!).toFixed(8);
        }

        return { finalX, finalY, finalRadius, normX, normY, normR, transformed };
      }

      for (let index = 0; index < input.points.length; index++) {
        const point = input.points[index];
        try {
          const existing = await db.getMeasurementPointDefByCode(productModel.id, point.code);
          const workstationId = await resolveWorkstationId(point.workstationCode, workstationCache);
          const referenceImage = await uploadPointReferenceImage(
            productModel.id,
            point.code,
            point.imageBase64,
            point.imageMimeType,
            point.imageUrl,
          );

          const { finalX, finalY, finalRadius, normX, normY, normR, transformed } = resolveCoordinates(point);

          if (existing) {
            const updatePayload = cleanUndefined({
              name: point.name,
              description: point.description,
              measurementType: point.measurementType,
              unit: point.unit,
              lowerLimit: toOptionalDecimal(point.lowerLimit),
              upperLimit: toOptionalDecimal(point.upperLimit),
              nominalValue: toOptionalDecimal(point.nominalValue),
              positionX: finalX,
              positionY: finalY,
              radius: finalRadius,
              normalizedX: normX,
              normalizedY: normY,
              normalizedRadius: normR,
              cropWidth: point.cropWidth,
              cropHeight: point.cropHeight,
              orderIndex: point.orderIndex,
              workstationId,
              machineId: machine.id,
              isActive: point.isActive ?? true,
              shape: point.shape,
              geometry: point.geometry,
              updatedAt: new Date(),
              lastModifiedAt: new Date(),
            });

            if (referenceImage) {
              Object.assign(updatePayload, { referenceImageUrl: referenceImage.url });
              if (referenceImage.key) {
                Object.assign(updatePayload, { referenceImageKey: referenceImage.key });
              }
              // Compute and store image hash for deduplication
              if ((referenceImage as any).hash) {
                Object.assign(updatePayload, { imageHash: (referenceImage as any).hash });
              }
            }

            // ── Doc 31 B.6 — machine limit write-back gate ───────────────────
            // A machine POINTS_PUSH can carry NEW LSL/USL/target. Writing limits
            // to an EXISTING point of a LIVE product is a governed direct edit
            // (decision #4): on active/eol/archived or a dev product with a
            // released program, the machine may NOT silently overwrite approved
            // limits. When the incoming limits actually CHANGE and the gate blocks,
            // we STRIP just the limit fields (geometry/image/name still sync) and
            // record the block + an audit row. On a `development` product the
            // change is applied and audited as a direct edit.
            const incoming = {
              lowerLimit: updatePayload.lowerLimit as string | undefined,
              upperLimit: updatePayload.upperLimit as string | undefined,
              nominalValue: updatePayload.nominalValue as string | undefined,
            };
            const decEq = (a?: string | null, b?: string | null): boolean => {
              if (a == null || b == null) return a == null && b == null;
              const na = Number(a); const nb = Number(b);
              return Number.isFinite(na) && Number.isFinite(nb) ? na === nb : String(a) === String(b);
            };
            const limitChanged =
              (incoming.lowerLimit !== undefined && !decEq(incoming.lowerLimit, existing.lowerLimit as string | null)) ||
              (incoming.upperLimit !== undefined && !decEq(incoming.upperLimit, existing.upperLimit as string | null)) ||
              (incoming.nominalValue !== undefined && !decEq(incoming.nominalValue, existing.nominalValue as string | null));
            let limitBlocked = false;
            if (limitChanged) {
              const gate = await resolveThresholdEditGate(existing.id);
              const auditBase = {
                productModelId: productModel.id,
                machineId: machine.id,
                lifecycleStatus: gate.lifecycleStatus,
                gateDecision: gate.decision,
                gateEnforced: gate.enforced,
                hasReleasedProgram: gate.hasReleasedProgram,
                before: { lowerLimit: existing.lowerLimit ?? null, upperLimit: existing.upperLimit ?? null, nominalValue: existing.nominalValue ?? null },
                after: { lowerLimit: incoming.lowerLimit ?? null, upperLimit: incoming.upperLimit ?? null, nominalValue: incoming.nominalValue ?? null },
              };
              if (gate.decision === "requires_approval" && gate.enforced) {
                // Protect approved limits — strip them; keep geometry/image/name.
                delete (updatePayload as Record<string, unknown>).lowerLimit;
                delete (updatePayload as Record<string, unknown>).upperLimit;
                delete (updatePayload as Record<string, unknown>).nominalValue;
                limitBlocked = true;
                limitGateBlockedCount++;
                db.createAuditLog({
                  action: "threshold.machineSyncBlocked",
                  entityType: "measurement_point_def",
                  entityId: existing.id,
                  entityName: existing.code ?? point.code,
                  details: { source: "machineSync.syncMeasurementPoints", blocked: true, ...auditBase },
                  status: "failure", // the attempted machine limit write was rejected
                }).catch(() => {});
              } else {
                db.createAuditLog({
                  action: "threshold.directEdit",
                  entityType: "measurement_point_def",
                  entityId: existing.id,
                  entityName: existing.code ?? point.code,
                  details: { source: "machineSync.syncMeasurementPoints", ...auditBase },
                  status: "success",
                }).catch(() => {});
              }
            }

            // ── Doc 51 P2 batch-2 (§5.2 P2) — optimistic lock on the write-back ──
            // A machine may cache updatedAt and send it as `expectedUpdatedAt`.
            //   • lock ENFORCED + value present → compare-and-set: a stale value
            //     throws MeasurementPointConflictError (caught below → CONFLICT, that
            //     point is NOT overwritten).
            //   • otherwise (blind, back-compat) → still write, but if the cached
            //     value is stale vs the live row, record a 'blind-overwrite' audit so
            //     the silent clobber is visible.
            const knownUpdatedAt =
              point.expectedUpdatedAt != null ? new Date(point.expectedUpdatedAt) : undefined;
            const enforceLock = lockEnforced && knownUpdatedAt !== undefined;
            if (
              knownUpdatedAt !== undefined &&
              !enforceLock &&
              db.isStaleUpdate(existing.updatedAt, knownUpdatedAt)
            ) {
              blindOverwriteCount++;
              db.createAuditLog({
                action: "measurementPoint.blindOverwrite",
                entityType: "measurement_point_def",
                entityId: existing.id,
                entityName: existing.code ?? point.code,
                details: {
                  source: "machineSync.syncMeasurementPoints",
                  machineId: machine.id,
                  productModelId: productModel.id,
                  expectedUpdatedAt: Number.isNaN(knownUpdatedAt.getTime())
                    ? String(point.expectedUpdatedAt)
                    : knownUpdatedAt.toISOString(),
                  actualUpdatedAt:
                    existing.updatedAt instanceof Date
                      ? existing.updatedAt.toISOString()
                      : (existing.updatedAt ?? null),
                  note: "machine overwrote a point changed since its last sync (optimistic lock not enforced)",
                },
                status: "success",
              }).catch(() => {});
            }
            await db.updateMeasurementPointDef(
              existing.id,
              updatePayload,
              enforceLock ? { expectedUpdatedAt: knownUpdatedAt } : undefined,
            );
            results.push({ code: point.code, id: existing.id, action: 'updated', coordTransformed: transformed, limitBlocked });
          } else {
            const newPoint = {
              productModelId: productModel.id,
              machineId: machine.id,
              workstationId,
              code: point.code,
              name: point.name,
              description: point.description,
              measurementType: point.measurementType,
              unit: point.unit,
              lowerLimit: toOptionalDecimal(point.lowerLimit),
              upperLimit: toOptionalDecimal(point.upperLimit),
              nominalValue: toOptionalDecimal(point.nominalValue),
              positionX: finalX,
              positionY: finalY,
              radius: finalRadius,
              normalizedX: normX,
              normalizedY: normY,
              normalizedRadius: normR,
              cropWidth: point.cropWidth ?? 100,
              cropHeight: point.cropHeight ?? 100,
              orderIndex: point.orderIndex ?? index,
              isActive: point.isActive ?? true,
              shape: point.shape,
              geometry: point.geometry,
              lastModifiedAt: new Date(),
            };

            if (referenceImage) {
              Object.assign(newPoint, { referenceImageUrl: referenceImage.url });
              if (referenceImage.key) {
                Object.assign(newPoint, { referenceImageKey: referenceImage.key });
              }
              if ((referenceImage as any).hash) {
                Object.assign(newPoint, { imageHash: (referenceImage as any).hash });
              }
            }

            const id = await db.createMeasurementPointDef(newPoint);
            results.push({ code: point.code, id, action: 'created', coordTransformed: transformed });
          }
        } catch (error) {
          // Doc 51 P2 batch-2 (§5.2 P2) — a rejected optimistic-lock write surfaces
          // as MeasurementPointConflictError (duck-typed by `.code`, never
          // instanceof — db is mocked in tests). Count it + give a clear message;
          // the rest of the batch still processes (per-point isolation).
          if (error && (error as { code?: string }).code === "MP_STALE_WRITE") {
            staleConflictCount++;
            errors.push({
              code: point.code,
              message:
                "CONFLICT: điểm đo đã bị thay đổi kể từ lần máy đồng bộ gần nhất — bỏ qua ghi đè (optimistic lock). " +
                "Point was changed since the machine last synced; write skipped.",
            });
          } else {
            errors.push({
              code: point.code,
              message: error instanceof TRPCError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : 'Unknown error',
            });
          }
        }
      }

      const createdCount = results.filter((r) => r.action === 'created').length;
      const updatedCount = results.filter((r) => r.action === 'updated').length;
      const transformedCount = results.filter((r) => r.coordTransformed).length;

      // Bump pointsConfigVersion if any points were created or updated
      let newConfigVersion = productModel.pointsConfigVersion ?? 1;
      if (results.length > 0) {
        newConfigVersion += 1;
        await db.updateProductModel(productModel.id, {
          pointsConfigVersion: newConfigVersion,
          updatedAt: new Date(),
        });

        // Notify all subscribers about config change
        publishPointsConfigChanged(productModel.code, newConfigVersion, input.machineCode);
      }

      const syncDurationMs = Date.now() - syncStartTime;

      // Log sync operation
      db.createProductSyncLog({
        machineId: machine.id,
        machineCode: input.machineCode ?? machine.code,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        syncOperation: "POINTS_PUSH",
        syncStatus: errors.length === 0 ? "SUCCESS" : errors.length < input.points.length ? "PARTIAL" : "FAILED",
        pointsSynced: results.length,
        pointsCreated: createdCount,
        pointsUpdated: updatedCount,
        pointsFailed: errors.length,
        errorDetails: errors.length > 0 ? errors : null,
        sourceImageWidth: input.sourceImageWidth ?? null,
        sourceImageHeight: input.sourceImageHeight ?? null,
        serverImageWidth: productModel.imageWidth ?? null,
        serverImageHeight: productModel.imageHeight ?? null,
        coordTransformations: transformedCount,
        fromVersion: productModel.pointsConfigVersion ?? 1,
        toVersion: newConfigVersion,
        durationMs: syncDurationMs,
        clientVersion: input.clientVersion ?? null,
      }).catch(() => {}); // fire-and-forget, don't block response

      return {
        success: errors.length === 0,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        pointsConfigVersion: newConfigVersion,
        total: input.points.length,
        created: createdCount,
        updated: updatedCount,
        failed: errors.length,
        coordTransformed: transformedCount,
        serverImageWidth: productModel.imageWidth,
        serverImageHeight: productModel.imageHeight,
        // Doc 31 B.6 — # of points whose incoming limit change was blocked by the
        // lifecycle gate (approved limits protected; geometry/image still synced).
        limitChangesBlocked: limitGateBlockedCount,
        // Doc 51 P2 batch-2 (§5.2 P2) — optimistic-lock outcomes on the write-back.
        // `staleConflicts`: writes rejected because the point moved since the machine
        // cached it (only when MACHINE_SYNC_OPTIMISTIC_LOCK is on + machine sent
        // expectedUpdatedAt). `blindOverwrites`: writes that clobbered a since-changed
        // point while the lock was off (audited, still applied).
        optimisticLockEnforced: lockEnforced,
        staleConflicts: staleConflictCount,
        blindOverwrites: blindOverwriteCount,
        points: results,
        errors,
      };
    }),

  // Heartbeat endpoint
  heartbeat: publicProcedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        headerKey: machineHeaderKey(ctx),
        scope: "equipment:read",
      });

      await db.updateMachineHeartbeat(machine.id);
      return { success: true, machineId: machine.id };
    }),

  // ============================================================
  // CHECK Points Config Version — Lightweight check to see if points need re-sync
  // Returns the current pointsConfigVersion for each product model
  // Client compares with its cached version to decide whether to call getPoints
  // ============================================================
  checkPointsVersion: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1).optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input, ctx }) => {
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "equipment:read",
      });

      if (input.productModelCode) {
        const productModel = await db.getProductModelByCode(input.productModelCode.trim());
        if (!productModel) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
        }
        return {
          success: true,
          productModels: [{
            productModelCode: productModel.code,
            pointsConfigVersion: productModel.pointsConfigVersion,
            imageWidth: productModel.imageWidth,
            imageHeight: productModel.imageHeight,
          }],
        };
      }

      // All product models mapped to this machine
      const mappings = await db.getMappingsByMachine(machine.id);
      return {
        success: true,
        productModels: mappings
          .filter(m => m.product)
          .map(m => ({
            productModelCode: m.product!.code,
            pointsConfigVersion: m.product!.pointsConfigVersion,
            imageWidth: m.product!.imageWidth,
            imageHeight: m.product!.imageHeight,
          })),
      };
    }),

  // ============================================================
  // GET Points — Machine client downloads measurement point definitions from server
  // Direction 2: Server → Client (machine pulls points)
  // ============================================================
  getPoints: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1).optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input, ctx }) => {
      // Authenticate machine
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "equipment:read",
      });

      // Update heartbeat
      await db.updateMachineHeartbeat(machine.id);

      // Doc 51 P2 batch-2 (§5.2 P2, CASE khởi tạo) — build ONE product-model entry
      // with geometry parity to deltaSyncPoints: the SHARED projectSyncPoint (shape/
      // geometry/cells/3D-limits/criteria/lighting) + fiducials + coordinateMode, so
      // a machine that initialises via getPoints is not blind to non-circle points.
      // Legacy fields are preserved verbatim (normalizedX/Y/R kept as Number|null;
      // referenceImageUrl + workstationId still present) — additive, never breaking.
      async function buildModelEntry(pm: any, points: any[]) {
        const [fiducialRows, lightingByPoint] = await Promise.all([
          db.getFiducialMarksByProductModel(pm.id).catch(() => [] as any[]),
          db
            .listMpLightingProfilesByPointDefIds(points.map((p) => p.id))
            .catch(() => new Map<number, any[]>()),
        ]);
        return {
          productModelId: pm.id,
          productModelCode: pm.code,
          productModelName: pm.name,
          referenceImageUrl: pm.referenceImageUrl,
          imageWidth: pm.imageWidth,
          imageHeight: pm.imageHeight,
          pointsConfigVersion: pm.pointsConfigVersion,
          // Additive parity fields (deltaSyncPoints already returns these).
          coordinateMode: pm.coordinateMode ?? "pixel",
          fiducials: projectFiducials(fiducialRows),
          totalPoints: points.length,
          points: points.map((p) => ({
            ...projectSyncPoint(p, lightingByPoint.get(p.id) ?? []),
            // Preserve getPoints' legacy field types + extra fields (back-compat).
            normalizedX: p.normalizedX ? Number(p.normalizedX) : null,
            normalizedY: p.normalizedY ? Number(p.normalizedY) : null,
            normalizedRadius: p.normalizedRadius ? Number(p.normalizedRadius) : null,
            referenceImageUrl: p.referenceImageUrl,
            workstationId: p.workstationId,
          })),
        };
      }

      // If productModelCode is provided, get points for that specific product model
      if (input.productModelCode) {
        const normalizedModelCode = input.productModelCode.trim();
        const productModel = await db.getProductModelByCode(normalizedModelCode);
        if (!productModel) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${normalizedModelCode}' not found` });
        }

        const points = await db.getMeasurementPointDefsByProductModel(productModel.id);

        return {
          success: true,
          machineId: machine.id,
          machineCode: machine.code,
          productModels: [await buildModelEntry(productModel, points)],
        };
      }

      // No productModelCode: get all points for all product models mapped to this machine
      const mappings = await db.getMappingsByMachine(machine.id);
      const productModels: Array<Record<string, unknown>> = [];

      for (const { product: pm } of mappings) {
        if (!pm) continue;
        const points = await db.getMeasurementPointDefsByProductModel(pm.id);
        productModels.push(await buildModelEntry(pm, points));
      }

      return {
        success: true,
        machineId: machine.id,
        machineCode: machine.code,
        productModels,
      };
    }),

  // ============================================================
  // GET Product Image — Machine client downloads product reference image from server
  // Direction: Server → AOI Machine
  // ============================================================
  getProductImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input, ctx }) => {
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "equipment:read",
      });

      await db.updateMachineHeartbeat(machine.id);

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      if (!productModel.referenceImageUrl && !productModel.referenceImageKey) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product has no reference image' });
      }

      let downloadUrl = productModel.referenceImageUrl;
      if (productModel.referenceImageKey) {
        const result = await storageGet(productModel.referenceImageKey);
        downloadUrl = result.url;
      }

      // Convert relative /uploads/ URLs to base64 data URLs for external clients
      const imageUrl = await resolveImageToDataUrl(downloadUrl);

      return {
        success: true,
        data: {
          productModelId: productModel.id,
          productModelCode: productModel.code,
          productModelName: productModel.name,
          imageUrl,
          imageWidth: productModel.imageWidth,
          imageHeight: productModel.imageHeight,
        },
      };
    }),

  // ============================================================
  // SYNC Product Image — Machine pushes product reference image to server (AOI → Server)
  // ============================================================
  syncProductImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      imageBase64: z.string().max(MAX_IMAGE_B64, IMAGE_B64_TOO_LARGE).optional(),
      imageMimeType: z.string().optional(),
      imageUrl: z.string().url().optional(),
      imageWidth: z.number().int().positive().optional(),
      imageHeight: z.number().int().positive().optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }).refine((data) => data.imageBase64 || data.imageUrl, {
      message: 'Either imageBase64 or imageUrl must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      const auth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "ingest:write",
      });
      const machine = auth.machine;
      enforceMachineIngestRateLimit(auth);

      await db.updateMachineHeartbeat(machine.id);

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      // Compute image hash for deduplication
      const imageData = input.imageBase64 || input.imageUrl;
      let newHash: string | null = null;
      let imageSkipped = false;

      if (input.imageBase64 && input.imageBase64.trim().length > 0 && !/^https?:\/\//i.test(input.imageBase64.trim())) {
        newHash = computeImageHash(input.imageBase64);

        // Skip upload if hash matches existing
        if (productModel.imageHash && productModel.imageHash === newHash) {
          imageSkipped = true;
          // Log skipped sync
          db.createProductSyncLog({
            machineId: machine.id,
            machineCode: input.machineCode ?? machine.code,
            productModelId: productModel.id,
            productModelCode: productModel.code,
            syncOperation: "IMAGE_PUSH",
            syncStatus: "SUCCESS",
            imageHashBefore: productModel.imageHash,
            imageHashAfter: newHash,
            imageSkipped: true,
          }).catch(() => {});

          return {
            success: true,
            machineId: machine.id,
            productModelId: productModel.id,
            productModelCode: productModel.code,
            imageSkipped: true,
            imageHash: newHash,
            message: "Image unchanged (hash match), upload skipped",
          };
        }
      }

      const referenceImage = await uploadProductReferenceImage(
        productModel.id,
        input.imageBase64,
        input.imageMimeType,
        input.imageUrl,
      );

      if (!referenceImage) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid image data provided' });
      }

      const updatePayload: Record<string, unknown> = {
        referenceImageUrl: referenceImage.url,
        updatedAt: new Date(),
      };
      if (referenceImage.key) {
        updatePayload.referenceImageKey = referenceImage.key;
      }
      if (input.imageWidth) {
        updatePayload.imageWidth = input.imageWidth;
      }
      if (input.imageHeight) {
        updatePayload.imageHeight = input.imageHeight;
      }
      if (newHash) {
        updatePayload.imageHash = newHash;
      }

      await db.updateProductModel(productModel.id, updatePayload);

      // Log image sync
      db.createProductSyncLog({
        machineId: machine.id,
        machineCode: input.machineCode ?? machine.code,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        syncOperation: "IMAGE_PUSH",
        syncStatus: "SUCCESS",
        imageHashBefore: productModel.imageHash ?? null,
        imageHashAfter: newHash,
        imageSkipped: false,
      }).catch(() => {});

      return {
        success: true,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        imageUrl: referenceImage.url,
        imageKey: referenceImage.key,
        imageHash: newHash,
        imageSkipped: false,
      };
    }),

  // ============================================================
  // SYNC Point Reference Image — Upload reference image for a single measurement point
  // Dedicated endpoint so the App doesn't have to re-sync all points just to update one image
  // Direction: AOI App → Server
  // ============================================================
  syncPointImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      pointCode: z.string().trim().min(1),
      imageBase64: z.string().max(MAX_IMAGE_B64, IMAGE_B64_TOO_LARGE).optional(),
      imageMimeType: z.string().optional(),
      imageUrl: z.string().url().optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }).refine((data) => data.imageBase64 || data.imageUrl, {
      message: 'Either imageBase64 or imageUrl must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      const auth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "ingest:write",
      });
      const machine = auth.machine;
      enforceMachineIngestRateLimit(auth);

      await db.updateMachineHeartbeat(machine.id);

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      const existing = await db.getMeasurementPointDefByCode(productModel.id, input.pointCode.trim());
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Measurement point '${input.pointCode}' not found in product model '${input.productModelCode}'` });
      }

      // Compute image hash for deduplication (same pattern as syncProductImage)
      let pointImageHash: string | null = null;
      if (input.imageBase64 && input.imageBase64.trim().length > 0 && !/^https?:\/\//i.test(input.imageBase64.trim())) {
        pointImageHash = computeImageHash(input.imageBase64);
        // Skip upload if hash matches existing point image hash
        if (existing.imageHash && existing.imageHash === pointImageHash) {
          return {
            success: true,
            machineId: machine.id,
            productModelId: productModel.id,
            productModelCode: productModel.code,
            pointId: existing.id,
            pointCode: existing.code,
            referenceImageUrl: existing.referenceImageUrl,
            referenceImageKey: existing.referenceImageKey ?? null,
            imageSkipped: true,
            imageHash: pointImageHash,
            message: 'Image unchanged (hash match), upload skipped',
          };
        }
      }

      const referenceImage = await uploadPointReferenceImage(
        productModel.id,
        input.pointCode.trim(),
        input.imageBase64,
        input.imageMimeType,
        input.imageUrl,
      );

      if (!referenceImage) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid image data provided' });
      }

      // Doc 31 B.6 — NO threshold gate here: this endpoint updates ONLY the point's
      // reference image (URL/key/hash) and never LSL/USL/target, so it is not a
      // limit-write path. (The limit gate lives in syncMeasurementPoints, which is
      // the endpoint that can carry limits.) Investigated + confirmed image-only.
      const updatePayload: Record<string, unknown> = {
        referenceImageUrl: referenceImage.url,
        updatedAt: new Date(),
        lastModifiedAt: new Date(),
      };
      if (referenceImage.key) {
        updatePayload.referenceImageKey = referenceImage.key;
      }
      if (pointImageHash) {
        updatePayload.imageHash = pointImageHash;
      }

      await db.updateMeasurementPointDef(existing.id, updatePayload);

      return {
        success: true,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        pointId: existing.id,
        pointCode: existing.code,
        referenceImageUrl: referenceImage.url,
        referenceImageKey: referenceImage.key,
        imageSkipped: false,
        imageHash: pointImageHash,
      };
    }),

  // ============================================================
  // GET Point Reference Image — Download reference image for a single measurement point by code
  // Direction: Server → AOI App
  // ============================================================
  getPointImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      pointCode: z.string().trim().min(1),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input, ctx }) => {
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "equipment:read",
      });

      await db.updateMachineHeartbeat(machine.id);

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      const point = await db.getMeasurementPointDefByCode(productModel.id, input.pointCode.trim());
      if (!point) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Measurement point '${input.pointCode}' not found in product model '${input.productModelCode}'` });
      }

      if (!point.referenceImageUrl) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Measurement point '${input.pointCode}' has no reference image` });
      }

      // Convert relative /uploads/ URLs to base64 data URLs for external clients
      const referenceImageUrl = await resolveImageToDataUrl(point.referenceImageUrl);
      const productReferenceImageUrl = await resolveImageToDataUrl(productModel.referenceImageUrl);

      return {
        success: true,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        pointId: point.id,
        pointCode: point.code,
        pointName: point.name,
        referenceImageUrl,
        position: {
          x: point.positionX,
          y: point.positionY,
          radius: point.radius,
          normalizedX: point.normalizedX ? Number(point.normalizedX) : null,
          normalizedY: point.normalizedY ? Number(point.normalizedY) : null,
          normalizedRadius: point.normalizedRadius ? Number(point.normalizedRadius) : null,
          cropWidth: point.cropWidth,
          cropHeight: point.cropHeight,
        },
        productReferenceImageUrl,
      };
    }),

  // ============================================================
  // DELTA SYNC — Returns only points changed since a given version
  // Client sends its cached version, server returns diff
  // ============================================================
  deltaSyncPoints: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      sinceVersion: z.number().int().nonnegative(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input, ctx }) => {
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "equipment:read",
      });

      await db.updateMachineHeartbeat(machine.id);

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      const currentVersion = productModel.pointsConfigVersion ?? 1;

      // No changes since client version
      if (currentVersion <= input.sinceVersion) {
        return {
          success: true,
          hasChanges: false,
          currentVersion,
          sinceVersion: input.sinceVersion,
          points: [],
          // Doc 51 P1 (CASE #4) — shape parity with the has-changes branch.
          deletedCodes: [] as string[],
          deletedPoints: [] as Array<{ id: number; code: string; deletedAt: string | null; deletedAtVersion: number | null }>,
        };
      }

      // Get changed points + tombstones (doc 51 CASE #4). deletedCodes lets a
      // machine that MERGES its point set (or caches per code) learn which points
      // are RETIRED and STOP inspecting them — previously they just vanished from
      // `points`, so the machine kept grading boards against a spec that no longer
      // exists. Additive: existing consumers that read only `points` are untouched.
      const { points, deletedPoints, deletedCodes } =
        await db.getPointsChangedSinceVersion(productModel.id, input.sinceVersion);

      // Log delta sync pull
      db.createProductSyncLog({
        machineId: machine.id,
        machineCode: input.machineCode ?? machine.code,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        syncOperation: "DELTA_SYNC",
        syncStatus: "SUCCESS",
        pointsSynced: points.length,
        fromVersion: input.sinceVersion,
        toVersion: currentVersion,
      }).catch(() => {});

      // P1: load fiducial marks (additive top-level field)
      const fiducialRows = await db.getFiducialMarksByProductModel(productModel.id).catch(() => [] as any[]);
      const fiducials = projectFiducials(fiducialRows);

      // Doc 31 MP6 (decision #2) — batch-load per-point lighting recipes so the
      // machine can apply the multi-shot illumination profile. Best-effort (an
      // empty map on failure never breaks the point sync).
      const lightingByPoint = await db
        .listMpLightingProfilesByPointDefIds(points.map((p) => p.id))
        .catch(() => new Map<number, any[]>());

      // Doc 51 P2 batch-2 — shared projector (parity with getPoints).
      const projectedPoints = points.map((p) =>
        projectSyncPoint(p as any, lightingByPoint.get(p.id) ?? []),
      );

      return {
        success: true,
        hasChanges: true,
        currentVersion,
        sinceVersion: input.sinceVersion,
        serverImageWidth: productModel.imageWidth,
        serverImageHeight: productModel.imageHeight,
        coordinateMode: (productModel as any).coordinateMode ?? "pixel",
        fiducials,
        points: projectedPoints,
        // Doc 51 P1 (CASE #4) — retired points the machine must STOP inspecting.
        // `deletedCodes` is the flat code list (most machines key on code);
        // `deletedPoints` carries id/code/deletedAt/deletedAtVersion for richer
        // clients. Both additive; empty arrays when nothing was retired.
        deletedCodes,
        deletedPoints: deletedPoints.map((t) => ({
          id: t.id,
          code: t.code,
          deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
          deletedAtVersion: t.deletedAtVersion,
        })),
      };
    }),

  // ============================================================
  // SYNC HISTORY — Returns sync log entries for a machine
  // ============================================================
  getSyncHistory: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().optional(),
      syncOperation: z.enum(["POINTS_PUSH", "POINTS_PULL", "IMAGE_PUSH", "IMAGE_PULL", "FULL_SYNC", "DELTA_SYNC"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().nonnegative().default(0),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input, ctx }) => {
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "equipment:read",
      });

      let productModelId: number | undefined;
      if (input.productModelCode) {
        const productModel = await db.getProductModelByCode(input.productModelCode.trim());
        if (productModel) productModelId = productModel.id;
      }

      const logs = await db.getProductSyncLogs({
        machineId: machine.id,
        productModelId,
        syncOperation: input.syncOperation,
        limit: input.limit,
        offset: input.offset,
      });

      return {
        success: true,
        machineId: machine.id,
        machineCode: machine.code,
        logs,
      };
    }),

  // ============================================================
  // WS-2 — EDGE DEPLOYMENT (machine-facing). Same apiKey|machineCode auth as
  // the rest of this router. Additive — does NOT change any existing endpoint.
  // ============================================================

  // checkModelVersion — machine polls for its READY (or already-DEPLOYED/ACTIVE)
  // deployments so it can compare its local model hash vs packageHash.
  checkModelVersion: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
    }).refine((d) => d.apiKey || d.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input, ctx }) => {
      const { machine } = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "edge:sync",
      });
      await db.updateMachineHeartbeat(machine.id).catch(() => {});

      // Deployments addressed to this machine, by machineId or deviceId === code.
      const byMachine = await aiAdvancedDb.getEdgeDeployments({ machineId: machine.id, limit: 100 });
      const byDevice = await aiAdvancedDb.getEdgeDeploymentsByDevice(machine.code);
      const seen = new Set<number>();
      const all = [...byMachine, ...byDevice].filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });

      const deployments = all
        .filter((d) => ["READY", "DOWNLOADING", "DEPLOYED", "ACTIVE", "OUTDATED"].includes(d.status))
        .map((d) => ({
          deploymentId: d.id,
          modelId: d.modelId,
          modelVersion: d.modelVersion,
          packageVersion: d.packageVersion,
          packageHash: d.packageHash,
          packageSize: d.packageSize,
          status: d.status,
        }));

      return { success: true, machineId: machine.id, machineCode: machine.code, deployments };
    }),

  // getModelPackage — returns download metadata (proxy URL, hash, size, config)
  // for a specific deployment and flips READY → DOWNLOADING. Never returns a raw
  // storage URL — only the apiKey-verified proxy path.
  getModelPackage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      deploymentId: z.number().int().positive(),
    }).refine((d) => d.apiKey || d.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      const edgeAuth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "edge:sync",
      });
      const machine = edgeAuth.machine;

      const deployment = await aiAdvancedDb.getEdgeDeployment(input.deploymentId);
      if (!deployment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found' });

      const owns = (deployment.machineId != null && deployment.machineId === machine.id)
        || (!!deployment.deviceId && deployment.deviceId === machine.code);
      if (!owns) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Deployment does not belong to this machine' });
      }
      if (!deployment.packageKey || !deployment.packageHash) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Package not ready' });
      }

      if (deployment.status === "READY") {
        await aiAdvancedDb.updateEdgeDeployment(deployment.id, { status: "DOWNLOADING" }).catch(() => {});
      }

      return {
        success: true,
        deploymentId: deployment.id,
        // apiKey-verified proxy download path (machine sends its apiKey header).
        downloadUrl: `/api/edge/download/${deployment.id}`,
        packageHash: deployment.packageHash,
        packageSize: deployment.packageSize,
        packageVersion: deployment.packageVersion,
        modelId: deployment.modelId,
        modelVersion: deployment.modelVersion,
        deployConfig: deployment.deployConfig ?? null,
      };
    }),

  // confirmDeployment — machine reports local hash after download+verify.
  // Match → DEPLOYED; mismatch → FAILED.
  confirmDeployment: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      deploymentId: z.number().int().positive(),
      localHash: z.string().min(1).max(128),
    }).refine((d) => d.apiKey || d.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      const edgeAuth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "edge:sync",
      });
      const machine = edgeAuth.machine;

      const deployment = await aiAdvancedDb.getEdgeDeployment(input.deploymentId);
      if (!deployment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found' });
      const owns = (deployment.machineId != null && deployment.machineId === machine.id)
        || (!!deployment.deviceId && deployment.deviceId === machine.code);
      if (!owns) throw new TRPCError({ code: 'FORBIDDEN', message: 'Deployment does not belong to this machine' });

      const result = await svcConfirmDeployment(input.deploymentId, input.localHash);
      return { success: result.matched, ...result };
    }),

  // edgeHeartbeat — periodic liveness. DEPLOYED → ACTIVE; refreshes machine
  // lastHeartbeat. Backward-compatible signal for the stale checker.
  edgeHeartbeat: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      deploymentId: z.number().int().positive(),
    }).refine((d) => d.apiKey || d.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      const edgeAuth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "edge:sync",
      });
      const machine = edgeAuth.machine;

      const deployment = await aiAdvancedDb.getEdgeDeployment(input.deploymentId);
      if (!deployment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found' });
      const owns = (deployment.machineId != null && deployment.machineId === machine.id)
        || (!!deployment.deviceId && deployment.deviceId === machine.code);
      if (!owns) throw new TRPCError({ code: 'FORBIDDEN', message: 'Deployment does not belong to this machine' });

      const result = await svcRecordHeartbeat(input.deploymentId);
      return { success: true, ...result };
    }),

  // syncEdgeResults — machine pushes offline inference results. Idempotent via
  // localResultId (re-sending the same batch never duplicates rows).
  syncEdgeResults: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      deploymentId: z.number().int().positive(),
      results: z.array(z.object({
        localResultId: z.string().min(1).max(100),
        inputReference: z.string().optional(),
        predictions: z.array(z.object({ label: z.string(), confidence: z.number() })),
        confidence: z.number(),
        topLabel: z.string().max(100),
        processingTimeMs: z.number().int().nonnegative().optional(),
        inferredAt: z.union([z.string(), z.date()]),
        inspectionId: z.number().int().positive().optional(),
      })).max(500),
    }).refine((d) => d.apiKey || d.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .mutation(async ({ input, ctx }) => {
      const edgeAuth = await authenticateMachine({
        apiKey: input.apiKey,
        machineCode: input.machineCode,
        headerKey: machineHeaderKey(ctx),
        scope: "edge:sync",
      });
      const machine = edgeAuth.machine;

      const deployment = await aiAdvancedDb.getEdgeDeployment(input.deploymentId);
      if (!deployment) throw new TRPCError({ code: 'NOT_FOUND', message: 'Deployment not found' });
      const owns = (deployment.machineId != null && deployment.machineId === machine.id)
        || (!!deployment.deviceId && deployment.deviceId === machine.code);
      if (!owns) throw new TRPCError({ code: 'FORBIDDEN', message: 'Deployment does not belong to this machine' });

      await db.updateMachineHeartbeat(machine.id).catch(() => {});
      // syncEdgeResults is an ingest-volume endpoint → rate-limited like submitInspection.
      enforceMachineIngestRateLimit(edgeAuth);

      const result = await svcSyncEdgeResults(
        input.deploymentId,
        input.results.map((r) => ({
          localResultId: r.localResultId,
          inputReference: r.inputReference,
          predictions: r.predictions,
          confidence: r.confidence,
          topLabel: r.topLabel,
          processingTimeMs: r.processingTimeMs,
          inferredAt: typeof r.inferredAt === "string" ? new Date(r.inferredAt) : r.inferredAt,
          inspectionId: r.inspectionId,
        })),
      );

      return { success: true, ...result };
    }),
});
