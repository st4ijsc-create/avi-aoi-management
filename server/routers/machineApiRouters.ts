import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { and as drizzleAnd, eq as drizzleEq } from "drizzle-orm";
import * as db from "../db";
import { productInspections } from "../../drizzle/schema";
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
import { storagePut, storageGet, resolveImageToDataUrl } from "../storage";
import { emitNGAlert, emitYieldWarning, emitDashboardUpdate } from "../_core/socket";
import { statsCache, CACHE_KEYS } from "../_core/cache";
import * as cachedStats from "../functions/cachedStatistics";
import { publishPointsConfigChanged } from "../services/mqttService";
import { publishToOutbox } from "../services/integration/outboxProducers"; // K0+-c: ADDITIVE ERP outbox (ERP_OUTBOX_ENABLED)
import { resolveThresholdEditGate } from "../services/thresholdGovernanceService"; // Doc 31 B.6 — gate machine limit write-back
import { evaluatePointResult, isPointLimitEvalEnabled } from "../services/pointResultEvaluator"; // Doc 31 MP6 — server-side 3D/criteria spec gate
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
  imageBase64: z.string().optional(),
  imageMimeType: z.string().optional(),
  imageUrl: z.string().url().optional(),
  // P1: optional shape + geometry (additive). When present, server persists them.
  shape: pointShapeEnum.optional(),
  geometry: measurementGeometrySchema.optional(),
});

// ============ MACHINE API ROUTER (for external machine integration) ============

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
      serialNumber: z.string(), // Số serial sản phẩm
      productModel: z.string().optional(), // Model sản phẩm
      batchNumber: z.string().optional(), // Số lô
      
      // Inspection results
      cycleTime: z.number().optional(), // Thời gian chu kỳ (giây)
      overallResult: z.enum(["OK", "NG", "NTF"]), // Kết quả tổng thể
      inspectionTime: z.string().optional(), // Thời gian kiểm tra
      
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
        result: z.enum(["OK", "NG", "NTF"]), // Kết quả
        remark: z.string().optional(), // Ghi chú
        imageBase64: z.string().optional(), // Hình ảnh base64 (optional)
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
 * The FULL submit pipeline (auth → inspection row → measurements/images →
 * alerts/side-effects). Extracted from the mutation so the store-forward WAL
 * can replay a buffered payload through EXACTLY the same code path. Throws on
 * failure — buffering decisions belong to the caller (mutation / backfill).
 */
export async function processInspectionSubmission(
  input: SubmitInspectionInput,
  opts?: { headerKey?: string | null; rateLimit?: boolean },
): Promise<{ success: true; inspectionId: number }> {
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
      const rawInspTime = input.inspectionTime ? new Date(input.inspectionTime) : new Date();
      const localInspTime = new Date(rawInspTime.getTime() - rawInspTime.getTimezoneOffset() * 60000);

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

      });

      // K0+-c: ADDITIVELY publish the quality result to the durable ERP outbox.
      // Fire-and-forget + error-isolated (never blocks/affects the ingest path);
      // gated by ERP_OUTBOX_ENABLED (no-op when off). Idempotent per inspectionId.
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

      // Process measurements - support both pointId and pointCode
      const measurementResults = [];
      const productPointCache: PointDefCache = new Map();
      const machinePointCache: PointDefCache = new Map();
      const defectCatalogCache = new Map<string, number | null>();
      const missingPointCodes: string[] = []; // Track missing point definitions
      // Doc 31 MP6 — count points the server spec-gate downgraded OK→NG so the
      // inspection's overallResult can be reconciled after the batch insert.
      let serverDowngradeCount = 0;
      const pointLimitEvalOn = isPointLimitEvalEnabled();
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
      
      for (const measurement of input.measurements) {
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

        // Auto-upload image to storage if base64 is provided
        let uploadedImageUrl: string | undefined = undefined;
        let uploadedImageKey: string | undefined = undefined;
        if (measurement.imageBase64 && measurement.imageBase64.length > 200) {
          try {
            // If already a URL, use as-is
            if (measurement.imageBase64.startsWith('http') || measurement.imageBase64.startsWith('/uploads')) {
              uploadedImageUrl = measurement.imageBase64;
            } else {
              // Strip data URI prefix if present
              const base64Data = measurement.imageBase64.replace(/^data:image\/[^;]+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');
              // V1 inline-gate image capture (before upload — an upload failure
              // must not deprive the AI gate of the already-decoded image).
              if (inlineGateOn && (!inlineGateImage || (!inlineGateImageIsNg && measurement.result === "NG"))) {
                inlineGateImage = buffer;
                inlineGateImageIsNg = measurement.result === "NG";
              }
              const ext = measurement.imageBase64.startsWith('data:image/png') ? 'png' : 'jpg';
              const fileKey = `inspections/${inspectionId}/${pointCode}-${nanoid(8)}.${ext}`;
              const { url } = await storagePut(fileKey, buffer, `image/${ext === 'png' ? 'png' : 'jpeg'}`);
              uploadedImageUrl = url;
              uploadedImageKey = fileKey;
            }
          } catch (imgErr) {
            console.error(`[submitInspection] Image upload failed for point ${pointCode}:`, imgErr);
          }
        }

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
        let effectiveResult = measurement.result;
        let specGateRemark: string | undefined;
        if (pointDef && pointLimitEvalOn) {
          const evalRes = evaluatePointResult(pointDef as any, measurement, measurement.result);
          effectiveResult = evalRes.result;
          if (evalRes.overridden) {
            serverDowngradeCount++;
            specGateRemark = `Spec gate: ${evalRes.violations.join("; ")}`.slice(0, 480);
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
          remark: specGateRemark ?? measurement.remark ?? (pointDef ? undefined : `Point: ${pointCode}`),
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

      if (measurementResults.length > 0) {
        await db.createMeasurementResults(measurementResults);
      }

      // Doc 31 MP6 — if the server spec-gate downgraded ≥1 point to NG on a
      // machine-"OK" inspection, promote the board's overallResult to NG so
      // yield/FPY stays consistent with the per-point verdicts. Best-effort;
      // originalResult (the machine's original) is left intact for audit. NOTE:
      // downstream realtime NG alerts below key off the machine's original
      // overall (input.overallResult) — a server-downgraded board is reflected
      // in stored data/analytics but does not retro-fire the live NG alert.
      if (serverDowngradeCount > 0 && input.overallResult === "OK") {
        try {
          await db.reconcileInspectionOverallNG(inspectionId);
          console.warn(`[submitInspection] spec-gate downgraded ${serverDowngradeCount} point(s) → inspection ${inspectionId} overall promoted to NG`);
        } catch (reconErr) {
          console.error("[submitInspection] overall NG reconciliation failed (non-fatal):", reconErr);
        }
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

      return { success: true as const, inspectionId };
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
      const payload: SubmitInspectionInput = {
        ...input,
        inspectionTime: input.inspectionTime ?? new Date().toISOString(),
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
      imageBase64: z.string(),
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

            await db.updateMeasurementPointDef(existing.id, updatePayload);
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
          productModels: [{
            productModelId: productModel.id,
            productModelCode: productModel.code,
            productModelName: productModel.name,
            referenceImageUrl: productModel.referenceImageUrl,
            imageWidth: productModel.imageWidth,
            imageHeight: productModel.imageHeight,
            pointsConfigVersion: productModel.pointsConfigVersion,
            totalPoints: points.length,
            points: points.map((p) => ({
              id: p.id,
              code: p.code,
              name: p.name,
              description: p.description,
              measurementType: p.measurementType,
              unit: p.unit,
              lowerLimit: p.lowerLimit,
              upperLimit: p.upperLimit,
              nominalValue: p.nominalValue,
              positionX: p.positionX,
              positionY: p.positionY,
              radius: p.radius,
              normalizedX: p.normalizedX ? Number(p.normalizedX) : null,
              normalizedY: p.normalizedY ? Number(p.normalizedY) : null,
              normalizedRadius: p.normalizedRadius ? Number(p.normalizedRadius) : null,
              cropWidth: p.cropWidth,
              cropHeight: p.cropHeight,
              orderIndex: p.orderIndex,
              referenceImageUrl: p.referenceImageUrl,
              isActive: p.isActive,
              workstationId: p.workstationId,
            })),
          }],
        };
      }

      // No productModelCode: get all points for all product models mapped to this machine
      const mappings = await db.getMappingsByMachine(machine.id);
      const productModels: Array<{
        productModelId: number;
        productModelCode: string;
        productModelName: string;
        referenceImageUrl: string | null;
        imageWidth: number | null;
        imageHeight: number | null;
        pointsConfigVersion: number;
        totalPoints: number;
        points: Array<Record<string, unknown>>;
      }> = [];

      for (const { product: pm } of mappings) {
        if (!pm) continue;

        const points = await db.getMeasurementPointDefsByProductModel(pm.id);
        productModels.push({
          productModelId: pm.id,
          productModelCode: pm.code,
          productModelName: pm.name,
          referenceImageUrl: pm.referenceImageUrl,
          imageWidth: pm.imageWidth,
          imageHeight: pm.imageHeight,
          pointsConfigVersion: pm.pointsConfigVersion,
          totalPoints: points.length,
          points: points.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            measurementType: p.measurementType,
            unit: p.unit,
            lowerLimit: p.lowerLimit,
            upperLimit: p.upperLimit,
            nominalValue: p.nominalValue,
            positionX: p.positionX,
            positionY: p.positionY,
            radius: p.radius,
            normalizedX: p.normalizedX ? Number(p.normalizedX) : null,
            normalizedY: p.normalizedY ? Number(p.normalizedY) : null,
            normalizedRadius: p.normalizedRadius ? Number(p.normalizedRadius) : null,
            cropWidth: p.cropWidth,
            cropHeight: p.cropHeight,
            orderIndex: p.orderIndex,
            referenceImageUrl: p.referenceImageUrl,
            isActive: p.isActive,
            workstationId: p.workstationId,
          })),
        });
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
      imageBase64: z.string().optional(),
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
      imageBase64: z.string().optional(),
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
        };
      }

      // Get changed points
      const { points } = await db.getPointsChangedSinceVersion(productModel.id, input.sinceVersion);

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
      const fiducials = fiducialRows.map((f: any) => ({
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

      // Doc 31 MP6 (decision #2) — batch-load per-point lighting recipes so the
      // machine can apply the multi-shot illumination profile. Best-effort (an
      // empty map on failure never breaks the point sync).
      const lightingByPoint = await db
        .listMpLightingProfilesByPointDefIds(points.map((p) => p.id))
        .catch(() => new Map<number, any[]>());

      const projectedPoints = points.map((p) => {
        const base: Record<string, unknown> = {
          id: p.id,
          code: p.code,
          name: p.name,
          description: p.description,
          measurementType: p.measurementType,
          // Doc 31 MP6 — fine-grained catalog type (SOLDER/XRAY/POSITION/…).
          measurementTypeCode: (p as any).measurementTypeCode ?? null,
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
          // P1: shape + geometry (additive)
          shape: (p as any).shape ?? "circle",
          geometry: (p as any).geometry ?? null,
          // Doc 31 MP6 (decision #2) — 3D/solder/xray/position limits + criteria so
          // the same limits the server now gates with (pointResultEvaluator) are
          // also transported to the machine. All additive; null when unset.
          positionZ: (p as any).positionZ ?? null,
          heightMin: (p as any).heightMin ?? null,
          heightMax: (p as any).heightMax ?? null,
          heightNominal: (p as any).heightNominal ?? null,
          areaMin: (p as any).areaMin ?? null,
          areaMax: (p as any).areaMax ?? null,
          volumeMin: (p as any).volumeMin ?? null,
          volumeMax: (p as any).volumeMax ?? null,
          coplanarityMax: (p as any).coplanarityMax ?? null,
          warpageMax: (p as any).warpageMax ?? null,
          voidPctMax: (p as any).voidPctMax ?? null,
          offsetXMax: (p as any).offsetXMax ?? null,
          offsetYMax: (p as any).offsetYMax ?? null,
          tiltMax: (p as any).tiltMax ?? null,
          thicknessMin: (p as any).thicknessMin ?? null,
          thicknessMax: (p as any).thicknessMax ?? null,
          criteria: (p as any).criteria ?? null,
          // Doc 31 MP6 — multi-shot lighting recipe for this point (may be []).
          lighting: (lightingByPoint.get(p.id) ?? []).map((l: any) => ({
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
          lastModifiedAt: p.lastModifiedAt?.toISOString() ?? null,
        };
        // P1: server-side expansion of array shape into individual cells.
        if ((p as any).shape === "array" && (p as any).geometry) {
          try {
            base.cells = expandArrayGeometry((p as any).geometry as any);
          } catch {
            base.cells = [];
          }
        }
        return base;
      });

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
