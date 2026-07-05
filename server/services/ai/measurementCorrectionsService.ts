/**
 * W7-B (doc 27 §9 gap V2 — P0, Đợt 7 item 7.2) — OPERATOR-CORRECTION HARVEST.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Before this service, a human verdict change (measurementResult.correctResult,
 * inspection.confirmNTF) only overwrote `result` and stuffed the reason into
 * `remark` — the single most valuable label stream an AOI/AVI system produces
 * was thrown away. This service harvests every change into the append-only
 * `measurement_corrections` ledger (migration 0188) and, best-effort, feeds
 * `ai_label_queue` with an already-LABELED row (humanLabel = correctedResult)
 * so the active-learning/training pipeline accumulates real labels.
 *
 * DESIGN RULES:
 *  * FAIL-OPEN EVERYWHERE — harvesting must NEVER break or slow the operator's
 *    correction. Every public function catches and logs; nothing throws out.
 *  * The harvest is ADDITIVE — the caller's original behaviour (result
 *    overwrite, overall recalculation, NTF stamps) is untouched.
 *  * Image refs are SNAPSHOTTED at harvest time (training data must survive
 *    later edits to the measurement row).
 *
 * AGREEMENT METRICS (consumed by measurementCorrectionsRouter → QualityCockpit
 * "Máy hay báo giả" card — complementary to W5-A's FalseCallEscapePanel which
 * reads only inspection-row NTF flips):
 *  * falseCallRate  = NG calls later cleared by a human (overall != NG) ÷
 *    machine NG calls — the classic false-call ratio per machine.
 *  * agreementRate  = 1 − (human-changed NG inspections ÷ operator-reviewed NG
 *    inspections). "Reviewed" = acknowledged OR verdict-changed — an honest
 *    denominator: rows nobody looked at are not counted as agreement.
 *  * correctionsHarvested = rows in measurement_corrections (labels banked).
 */
import { getDb } from "../../db/connection";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import {
  measurementCorrections,
  measurementResults,
  productInspections,
  aiLabelQueue,
  machines,
} from "../../../drizzle/schema";
import { factoryDayTextSql } from "../../utils/kpi";

// ─── Types ───────────────────────────────────────────────────────────────────

export type CorrectionSource = "correct_result" | "confirm_ntf";

export interface RecordCorrectionInput {
  measurementResultId: number | null;
  inspectionId: number;
  machineId: number;
  pointDefId: number | null;
  originalResult: string;
  correctedResult: string;
  reason?: string | null;
  operatorUserId: number;
  imageKey?: string | null;
  imageUrl?: string | null;
  source: CorrectionSource;
  /** product_inspections.aiModelId when present — provenance for the label-queue feed. */
  aiModelId?: number | null;
}

export interface RecordCorrectionResult {
  correctionId: number | null;
  labelQueued: boolean;
  /** true when nothing was harvested (no-op correction or failure — see console). */
  skipped: boolean;
}

// ─── Harvest ─────────────────────────────────────────────────────────────────

/**
 * Record ONE human correction. Fail-open: never throws; a failure only means
 * the label was not banked (the operator's correction itself already happened
 * in the caller).
 */
export async function recordCorrection(input: RecordCorrectionInput): Promise<RecordCorrectionResult> {
  // No-op corrections (same verdict) carry no label signal — skip silently.
  if (input.originalResult === input.correctedResult) {
    return { correctionId: null, labelQueued: false, skipped: true };
  }
  try {
    const db = await getDb();
    if (!db) return { correctionId: null, labelQueued: false, skipped: true };

    const [row] = await db.insert(measurementCorrections).values({
      measurementResultId: input.measurementResultId,
      inspectionId: input.inspectionId,
      machineId: input.machineId,
      pointDefId: input.pointDefId,
      originalResult: input.originalResult,
      correctedResult: input.correctedResult,
      source: input.source,
      reason: input.reason ?? null,
      operatorUserId: input.operatorUserId,
      imageKey: input.imageKey ?? null,
      imageUrl: input.imageUrl ?? null,
      // Bind explicitly (not SQL now()) so window comparisons behave exactly
      // like inspectionTime and every other JS-bound timestamp in the repo.
      createdAt: new Date(),
    }).returning({ id: measurementCorrections.id });

    const labelQueued = await enqueueLabel(input, row.id);
    return { correctionId: row.id, labelQueued, skipped: false };
  } catch (err) {
    console.warn("[measurementCorrections] harvest failed (fail-open):", err instanceof Error ? err.message : err);
    return { correctionId: null, labelQueued: false, skipped: true };
  }
}

/**
 * Feed ai_label_queue with an already-human-labeled row. Best-effort:
 *  * imageUrl is NOT NULL in ai_label_queue — correction rows without an image
 *    ref cannot be enqueued (the corrections ledger still keeps them).
 *  * modelId is NOT NULL there — use the inspection's aiModelId when known,
 *    else 0 with metadata.source='operator_correction' making the human (non-
 *    model) provenance explicit.
 */
async function enqueueLabel(input: RecordCorrectionInput, correctionId: number): Promise<boolean> {
  if (!input.imageUrl) return false;
  try {
    const db = await getDb();
    if (!db) return false;
    await db.insert(aiLabelQueue).values({
      inspectionId: input.inspectionId,
      measurementResultId: input.measurementResultId,
      imageUrl: input.imageUrl,
      modelId: input.aiModelId ?? 0, // 0 = no AI model involved (see metadata.source)
      predictedLabel: input.originalResult, // what the machine said
      samplingStrategy: "RANDOM", // not actively sampled — harvested from operator flow
      priority: 0,
      status: "LABELED", // human already decided — no review round needed
      reviewedBy: input.operatorUserId,
      reviewedAt: new Date(),
      humanLabel: input.correctedResult,
      reviewNotes: input.reason ?? null,
      machineId: input.machineId,
      metadata: {
        source: "operator_correction",
        correctionId,
        correctionSource: input.source,
        pointDefId: input.pointDefId,
      },
    });
    return true;
  } catch (err) {
    // Table absent / enum mismatch / race — the corrections ledger is the
    // source of truth; the queue feed is opportunistic.
    console.warn("[measurementCorrections] ai_label_queue feed skipped (fail-open):", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Harvest a whole-inspection NTF confirmation (inspection.confirmNTF): one
 * correction row per NG measurement (each NG point image is a training sample
 * "machine NG → human NTF"), or a single inspection-level row when the
 * inspection has no per-point NG rows. Fail-open.
 */
export async function harvestNtfConfirmation(params: {
  inspectionId: number;
  machineId: number;
  operatorUserId: number;
  reason: string;
  aiModelId?: number | null;
}): Promise<{ harvested: number }> {
  try {
    const db = await getDb();
    if (!db) return { harvested: 0 };

    const ngRows = await db
      .select({
        id: measurementResults.id,
        pointDefId: measurementResults.pointDefId,
        imageKey: measurementResults.imageKey,
        imageUrl: measurementResults.imageUrl,
      })
      .from(measurementResults)
      .where(and(
        eq(measurementResults.inspectionId, params.inspectionId),
        eq(measurementResults.result, "NG"),
      ))
      .limit(200); // safety cap — AOI boards top out well below this

    let harvested = 0;
    if (ngRows.length === 0) {
      const res = await recordCorrection({
        measurementResultId: null,
        inspectionId: params.inspectionId,
        machineId: params.machineId,
        pointDefId: null,
        originalResult: "NG",
        correctedResult: "NTF",
        reason: params.reason,
        operatorUserId: params.operatorUserId,
        source: "confirm_ntf",
        aiModelId: params.aiModelId,
      });
      if (!res.skipped) harvested++;
    } else {
      for (const row of ngRows) {
        const res = await recordCorrection({
          measurementResultId: row.id,
          inspectionId: params.inspectionId,
          machineId: params.machineId,
          pointDefId: row.pointDefId,
          originalResult: "NG",
          correctedResult: "NTF",
          reason: params.reason,
          operatorUserId: params.operatorUserId,
          imageKey: row.imageKey,
          imageUrl: row.imageUrl,
          source: "confirm_ntf",
          aiModelId: params.aiModelId,
        });
        if (!res.skipped) harvested++;
      }
    }
    return { harvested };
  } catch (err) {
    console.warn("[measurementCorrections] NTF harvest failed (fail-open):", err instanceof Error ? err.message : err);
    return { harvested: 0 };
  }
}

// ─── Agreement / false-call analytics ────────────────────────────────────────

export interface MachineFalseCallSummaryRow {
  machineId: number;
  machineCode: string | null;
  machineName: string | null;
  /** NG calls the machine made in the window (originalResult = 'NG'). */
  ngCalls: number;
  /** Of those, later cleared by a human (overallResult != 'NG'). */
  humanCleared: number;
  /** Operator-reviewed NG inspections (acknowledged OR verdict changed). */
  reviewed: number;
  /** Structured labels banked in measurement_corrections for this machine. */
  correctionsHarvested: number;
  /** humanCleared / ngCalls (%), null when no NG calls. */
  falseCallRate: number | null;
  /** 1 − humanCleared / reviewed (%), null when nothing reviewed. */
  agreementRate: number | null;
}

export async function getMachineFalseCallSummary(params: {
  startDate: Date;
  endDate: Date;
  machineId?: number;
  limit?: number;
}): Promise<MachineFalseCallSummaryRow[]> {
  const db = await getDb();
  if (!db) return [];

  const inspConditions: SQL[] = [
    eq(productInspections.originalResult, "NG"),
    gte(productInspections.inspectionTime, params.startDate),
    lte(productInspections.inspectionTime, params.endDate),
  ];
  if (params.machineId) inspConditions.push(eq(productInspections.machineId, params.machineId));

  const clearedExpr = sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} <> 'NG')`;
  const reviewedExpr = sql<number>`COUNT(*) FILTER (WHERE ${productInspections.acknowledgedAt} IS NOT NULL OR ${productInspections.overallResult} <> 'NG')`;

  const corrConditions: SQL[] = [
    gte(measurementCorrections.createdAt, params.startDate),
    lte(measurementCorrections.createdAt, params.endDate),
  ];
  if (params.machineId) corrConditions.push(eq(measurementCorrections.machineId, params.machineId));

  const [ngStats, corrStats] = await Promise.all([
    db
      .select({
        machineId: productInspections.machineId,
        ngCalls: sql<number>`COUNT(*)`,
        humanCleared: clearedExpr,
        reviewed: reviewedExpr,
      })
      .from(productInspections)
      .where(and(...inspConditions))
      .groupBy(productInspections.machineId),
    db
      .select({
        machineId: measurementCorrections.machineId,
        corrections: sql<number>`COUNT(*)`,
      })
      .from(measurementCorrections)
      .where(and(...corrConditions))
      .groupBy(measurementCorrections.machineId),
  ]);

  const corrByMachine = new Map<number, number>(corrStats.map((r) => [r.machineId, Number(r.corrections) || 0]));
  const machineIds = Array.from(new Set([...ngStats.map((r) => r.machineId), ...corrStats.map((r) => r.machineId)]));
  if (machineIds.length === 0) return [];

  const machineRows = await db
    .select({ id: machines.id, code: machines.code, name: machines.name })
    .from(machines)
    .where(inArray(machines.id, machineIds));
  const machineById = new Map(machineRows.map((m) => [m.id, m]));

  const rows: MachineFalseCallSummaryRow[] = [];
  const seen = new Set<number>();
  for (const r of ngStats) {
    seen.add(r.machineId);
    const ngCalls = Number(r.ngCalls) || 0;
    const humanCleared = Number(r.humanCleared) || 0;
    const reviewed = Number(r.reviewed) || 0;
    rows.push({
      machineId: r.machineId,
      machineCode: machineById.get(r.machineId)?.code ?? null,
      machineName: machineById.get(r.machineId)?.name ?? null,
      ngCalls,
      humanCleared,
      reviewed,
      correctionsHarvested: corrByMachine.get(r.machineId) ?? 0,
      falseCallRate: ngCalls > 0 ? round2((humanCleared / ngCalls) * 100) : null,
      agreementRate: reviewed > 0 ? round2((1 - humanCleared / reviewed) * 100) : null,
    });
  }
  // Machines with harvested corrections but no NG calls in-window (e.g. OK→NG
  // corrections on old rows) still show their banked labels.
  for (const [machineId, corrections] of corrByMachine) {
    if (seen.has(machineId)) continue;
    rows.push({
      machineId,
      machineCode: machineById.get(machineId)?.code ?? null,
      machineName: machineById.get(machineId)?.name ?? null,
      ngCalls: 0,
      humanCleared: 0,
      reviewed: 0,
      correctionsHarvested: corrections,
      falseCallRate: null,
      agreementRate: null,
    });
  }

  rows.sort((a, b) => (b.falseCallRate ?? -1) - (a.falseCallRate ?? -1) || b.ngCalls - a.ngCalls);
  return rows.slice(0, params.limit ?? 20);
}

export interface AgreementTrendPoint {
  /** Factory-local day (YYYY-MM-DD) — same bucketing as W1-C KPIs (gap A2). */
  day: string;
  ngCalls: number;
  humanCleared: number;
  correctionsHarvested: number;
  falseCallRate: number | null;
}

/** Daily NG-later-cleared + harvested-corrections trend for the cockpit card. */
export async function getAgreementTrend(params: {
  startDate: Date;
  endDate: Date;
  machineId?: number;
}): Promise<AgreementTrendPoint[]> {
  const db = await getDb();
  if (!db) return [];

  const inspConditions: SQL[] = [
    eq(productInspections.originalResult, "NG"),
    gte(productInspections.inspectionTime, params.startDate),
    lte(productInspections.inspectionTime, params.endDate),
  ];
  if (params.machineId) inspConditions.push(eq(productInspections.machineId, params.machineId));
  const corrConditions: SQL[] = [
    gte(measurementCorrections.createdAt, params.startDate),
    lte(measurementCorrections.createdAt, params.endDate),
  ];
  if (params.machineId) corrConditions.push(eq(measurementCorrections.machineId, params.machineId));

  const inspDay = factoryDayTextSql(productInspections.inspectionTime);
  const corrDay = factoryDayTextSql(measurementCorrections.createdAt);

  const [inspRows, corrRows] = await Promise.all([
    db
      .select({
        day: sql<string>`${inspDay}`.as("day"),
        ngCalls: sql<number>`COUNT(*)`,
        humanCleared: sql<number>`COUNT(*) FILTER (WHERE ${productInspections.overallResult} <> 'NG')`,
      })
      .from(productInspections)
      .where(and(...inspConditions))
      .groupBy(inspDay)
      .orderBy(inspDay),
    db
      .select({
        day: sql<string>`${corrDay}`.as("day"),
        corrections: sql<number>`COUNT(*)`,
      })
      .from(measurementCorrections)
      .where(and(...corrConditions))
      .groupBy(corrDay)
      .orderBy(corrDay),
  ]);

  const byDay = new Map<string, AgreementTrendPoint>();
  for (const r of inspRows) {
    const ngCalls = Number(r.ngCalls) || 0;
    const humanCleared = Number(r.humanCleared) || 0;
    byDay.set(String(r.day), {
      day: String(r.day),
      ngCalls,
      humanCleared,
      correctionsHarvested: 0,
      falseCallRate: ngCalls > 0 ? round2((humanCleared / ngCalls) * 100) : null,
    });
  }
  for (const r of corrRows) {
    const day = String(r.day);
    const point = byDay.get(day) ?? { day, ngCalls: 0, humanCleared: 0, correctionsHarvested: 0, falseCallRate: null };
    point.correctionsHarvested = Number(r.corrections) || 0;
    byDay.set(day, point);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

// ─── Training export ─────────────────────────────────────────────────────────

export interface CorrectionTrainingSample {
  correctionId: number;
  inspectionId: number;
  measurementResultId: number | null;
  machineId: number;
  pointDefId: number | null;
  /** Machine / previous verdict — the "prediction" being corrected. */
  machineLabel: string;
  /** Human verdict — the training label. */
  humanLabel: string;
  reason: string | null;
  imageKey: string | null;
  imageUrl: string | null;
  source: string;
  correctedBy: number;
  correctedAt: Date;
}

/**
 * Second training-data source for aiFeedback.exportTrainingBatch (V2): the
 * harvested operator corrections, newest first. Additive — the aiSuggestions
 * feedback path is untouched.
 */
export async function getCorrectionTrainingSamples(opts: {
  limit?: number;
  since?: Date;
} = {}): Promise<CorrectionTrainingSample[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions: SQL[] = [];
  if (opts.since) conditions.push(gte(measurementCorrections.createdAt, opts.since));

  const rows = await db
    .select()
    .from(measurementCorrections)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(measurementCorrections.createdAt))
    .limit(Math.min(Math.max(opts.limit ?? 1000, 1), 5000));

  return rows.map((r) => ({
    correctionId: r.id,
    inspectionId: r.inspectionId,
    measurementResultId: r.measurementResultId,
    machineId: r.machineId,
    pointDefId: r.pointDefId,
    machineLabel: r.originalResult,
    humanLabel: r.correctedResult,
    reason: r.reason,
    imageKey: r.imageKey,
    imageUrl: r.imageUrl,
    source: r.source,
    correctedBy: r.operatorUserId,
    correctedAt: r.createdAt,
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
