/**
 * Lot Acceptance (AQL) service — doc 31 Đợt E (OP5 / decision #3).
 *
 * `sampling_plans` were configurable + linkable but NO engine consumed them, so
 * a customer's AQL requirement never produced a lot accept/reject decision. This
 * service is that engine: given a sampling plan and a lot of inspections, it
 * applies the AQL sample-size + accept/reject numbers to produce a disposition.
 *
 * LOT BOUNDARY (honest decision): a lot = the inspections of one product model
 * sharing a `batchNumber` (product_inspections.batchNumber — the machine-sent
 * batch/lot id). When inspections carry no batch, callers may pass an explicit
 * time window and the unbatched rows in that window are treated as ONE windowed
 * lot (documented fallback — real lot boundaries require the machine to send a
 * batch id).
 *
 * ACCEPTANCE NUMBERS: taken from the plan's explicit sampleSize / acceptanceQty
 * (Ac) / rejectionQty (Re) — i.e. the numbers an engineer copies from the ANSI/
 * ASQ Z1.4 master table into the plan. When only an AQL + lot size are given, the
 * sample size is derived from the Z1.4 General Inspection Level II sample-size-
 * code table and acceptance defaults to c=0 (zero-acceptance / Squeglia) — a
 * recognised, conservative AQL rule. This avoids embedding a possibly-wrong copy
 * of the full Z1.4 Ac master table; the exact numbers live in the plan.
 *
 * Read-only + never throws on bad data (fails to a null/plan-less result).
 */

import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import * as productDb from "../db/product";
import { productInspections } from "../../drizzle/schema";

export interface AcceptancePlanResolved {
  sampleSize: number;
  acceptNumber: number; // Ac
  rejectNumber: number; // Re
  codeLetter?: string;
  aqlUsed?: number | null;
  source: "explicit" | "z1.4_c0" | "c0_fallback";
}

export interface LotDisposition {
  productModelId: number;
  batchNumber: string | null;
  samplingPlanId: number | null;
  samplingPlanCode: string | null;
  plan: AcceptancePlanResolved | null;
  inspected: number;      // total inspections in the lot
  sampleTaken: number;    // units actually judged (min(sampleSize, inspected))
  defectives: number;     // NG units within the sample
  firstAt: string | null;
  lastAt: string | null;
  // 'accept' | 'reject' | 'pending' (not enough units for a full sample yet)
  // | 'no_plan' (no AQL plan configured for this product)
  disposition: "accept" | "reject" | "pending" | "no_plan";
}

// ── ANSI/ASQ Z1.4 General Inspection Level II: lot size → sample-size code ─────
const CODE_LETTER_BY_LOT: Array<{ max: number; letter: string }> = [
  { max: 8, letter: "A" }, { max: 15, letter: "B" }, { max: 25, letter: "C" },
  { max: 50, letter: "D" }, { max: 90, letter: "E" }, { max: 150, letter: "F" },
  { max: 280, letter: "G" }, { max: 500, letter: "H" }, { max: 1200, letter: "J" },
  { max: 3200, letter: "K" }, { max: 10000, letter: "L" }, { max: 35000, letter: "M" },
  { max: 150000, letter: "N" }, { max: 500000, letter: "P" }, { max: Infinity, letter: "Q" },
];
// Code letter → sample size (single sampling, normal).
const SAMPLE_SIZE_BY_LETTER: Record<string, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50, J: 80, K: 125,
  L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

export function z1_4SampleSize(lotSize: number): { letter: string; sampleSize: number } {
  const row = CODE_LETTER_BY_LOT.find((r) => lotSize <= r.max) ?? CODE_LETTER_BY_LOT[CODE_LETTER_BY_LOT.length - 1];
  // Sample size is capped at the lot size (you can't sample more than exist).
  const n = Math.min(SAMPLE_SIZE_BY_LETTER[row.letter] ?? 2, Math.max(1, lotSize));
  return { letter: row.letter, sampleSize: n };
}

type SamplingPlanRow = {
  id: number;
  code: string;
  strategy: string | null;
  lotSize: number | null;
  aqlCritical: string | null;
  aqlMajor: string | null;
  aqlMinor: string | null;
  sampleSize: number | null;
  acceptanceQty: number | null;
  rejectionQty: number | null;
};

/**
 * Resolve a plan into concrete { sampleSize, Ac, Re }. Prefers the plan's
 * explicit numbers; otherwise derives sample size from Z1.4 Level II + c=0.
 */
export function resolveAcceptancePlan(plan: SamplingPlanRow, lotSizeHint?: number): AcceptancePlanResolved {
  const effectiveLotSize = lotSizeHint ?? plan.lotSize ?? undefined;
  const governingAql = firstNum(plan.aqlMajor, plan.aqlMinor, plan.aqlCritical);

  if (plan.sampleSize && plan.sampleSize > 0) {
    const ac = plan.acceptanceQty ?? 0;
    const re = plan.rejectionQty ?? ac + 1;
    return {
      sampleSize: plan.sampleSize,
      acceptNumber: ac,
      rejectNumber: Math.max(re, ac + 1),
      aqlUsed: governingAql,
      source: "explicit",
    };
  }

  if (effectiveLotSize && effectiveLotSize > 0) {
    const { letter, sampleSize } = z1_4SampleSize(effectiveLotSize);
    const ac = plan.acceptanceQty ?? 0; // c=0 default
    const re = plan.rejectionQty ?? ac + 1;
    return {
      sampleSize,
      acceptNumber: ac,
      rejectNumber: Math.max(re, ac + 1),
      codeLetter: letter,
      aqlUsed: governingAql,
      source: "z1.4_c0",
    };
  }

  // No sample size and no lot size — last-resort c=0 on whatever is inspected.
  const ac = plan.acceptanceQty ?? 0;
  const re = plan.rejectionQty ?? ac + 1;
  return { sampleSize: 0, acceptNumber: ac, rejectNumber: Math.max(re, ac + 1), aqlUsed: governingAql, source: "c0_fallback" };
}

function firstNum(...vals: Array<string | number | null | undefined>): number | null {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * Apply Ac/Re to a sample. Pure — testable without a DB.
 * `inspected` is the lot's total; `defectivesInSample` the NG count within the
 * first `plan.sampleSize` units (or all units when the lot is smaller).
 */
export function decideDisposition(
  plan: AcceptancePlanResolved,
  inspected: number,
  sampleTaken: number,
  defectivesInSample: number,
): "accept" | "reject" | "pending" {
  // Full sample not yet collected.
  if (plan.sampleSize > 0 && inspected < plan.sampleSize) return "pending";
  if (sampleTaken === 0) return "pending";
  if (defectivesInSample >= plan.rejectNumber) return "reject";
  if (defectivesInSample <= plan.acceptNumber) return "accept";
  return "pending"; // between Ac and Re (only when Re > Ac+1) — keep sampling
}

async function resolvePlanForProduct(
  productModelId: number,
  samplingPlanId?: number,
): Promise<SamplingPlanRow | null> {
  try {
    if (samplingPlanId) {
      const p = await productDb.getSamplingPlanById(samplingPlanId);
      return (p as any) ?? null;
    }
    const plans = await productDb.listSamplingPlansByProduct(productModelId, { includeInactive: false });
    return ((plans as any[]) ?? [])[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Evaluate ONE lot. Fetches an ordered sample of `sampleSize` units (the first
 * inspected, by time) and counts NG within it, then applies Ac/Re.
 */
export async function evaluateLotAcceptance(params: {
  productModelId: number;
  samplingPlanId?: number;
  batchNumber?: string | null;
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
}): Promise<LotDisposition> {
  const base: LotDisposition = {
    productModelId: params.productModelId,
    batchNumber: params.batchNumber ?? null,
    samplingPlanId: null,
    samplingPlanCode: null,
    plan: null,
    inspected: 0,
    sampleTaken: 0,
    defectives: 0,
    firstAt: null,
    lastAt: null,
    disposition: "no_plan",
  };

  const planRow = await resolvePlanForProduct(params.productModelId, params.samplingPlanId);
  if (!planRow) return base;
  base.samplingPlanId = planRow.id;
  base.samplingPlanCode = planRow.code;

  const db = await getDb();
  if (!db) return base;

  const conds: any[] = [eq(productInspections.productModelId, params.productModelId)];
  if (params.batchNumber != null) conds.push(eq(productInspections.batchNumber, params.batchNumber));
  else conds.push(isNull(productInspections.batchNumber));
  if (params.machineId) conds.push(eq(productInspections.machineId, params.machineId));
  if (params.startDate) conds.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conds.push(lte(productInspections.inspectionTime, params.endDate));

  // Total inspected in the lot.
  const [tot] = await db
    .select({
      inspected: sql<number>`count(*)`,
      firstAt: sql<Date | null>`min(${productInspections.inspectionTime})`,
      lastAt: sql<Date | null>`max(${productInspections.inspectionTime})`,
    })
    .from(productInspections)
    .where(and(...conds));
  const inspected = Number(tot?.inspected ?? 0);
  base.inspected = inspected;
  base.firstAt = tot?.firstAt ? new Date(tot.firstAt as any).toISOString() : null;
  base.lastAt = tot?.lastAt ? new Date(tot.lastAt as any).toISOString() : null;

  const resolved = resolveAcceptancePlan(planRow, inspected);
  base.plan = resolved;

  // Sample = first N inspected units (or all when N is 0 / larger than the lot).
  const takeN = resolved.sampleSize > 0 ? resolved.sampleSize : inspected;
  const sampleRows = await db
    .select({ result: productInspections.overallResult })
    .from(productInspections)
    .where(and(...conds))
    .orderBy(asc(productInspections.inspectionTime))
    .limit(Math.max(0, takeN));
  const sampleTaken = sampleRows.length;
  const defectives = sampleRows.filter((r) => r.result === "NG").length;
  base.sampleTaken = sampleTaken;
  base.defectives = defectives;
  base.disposition = decideDisposition(resolved, inspected, sampleTaken, defectives);
  return base;
}

/**
 * List recent lots for a product (grouped by batchNumber) and their dispositions.
 * `limit` caps the number of lots (each is then evaluated with an ordered sample).
 */
export async function listLotDispositions(params: {
  productModelId: number;
  samplingPlanId?: number;
  startDate?: Date;
  endDate?: Date;
  machineId?: number;
  limit?: number;
}): Promise<LotDisposition[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.min(Math.max(1, params.limit ?? 50), 200);

  const conds: any[] = [eq(productInspections.productModelId, params.productModelId)];
  if (params.machineId) conds.push(eq(productInspections.machineId, params.machineId));
  if (params.startDate) conds.push(gte(productInspections.inspectionTime, params.startDate));
  if (params.endDate) conds.push(lte(productInspections.inspectionTime, params.endDate));

  const groups = await db
    .select({
      batchNumber: productInspections.batchNumber,
      lastAt: sql<Date | null>`max(${productInspections.inspectionTime})`,
    })
    .from(productInspections)
    .where(and(...conds))
    .groupBy(productInspections.batchNumber)
    .orderBy(desc(sql`max(${productInspections.inspectionTime})`))
    .limit(limit);

  const out: LotDisposition[] = [];
  for (const g of groups) {
    out.push(await evaluateLotAcceptance({
      productModelId: params.productModelId,
      samplingPlanId: params.samplingPlanId,
      batchNumber: g.batchNumber ?? null,
      startDate: params.startDate,
      endDate: params.endDate,
      machineId: params.machineId,
    }));
  }
  return out;
}
