/**
 * doc 44 W2-B1 / G2.16 + G2.18 — Genealogy Access API (SYNAPSE Tầng 2 §10.3/§16).
 *
 *   GET  /v1/genealogy/{unitId}   → FULL GenealogyRecord assembled per spec §16
 *   POST /v1/genealogy/search     → reverse lookup {lot|part|carton|pallet|dateRange} → unit ids
 *
 * ASSEMBLY (spec: "gom mọi sự kiện/kết quả gắn unit_id xuyên các trạm, lắp ghép
 * theo thứ tự thời gian") — the SAME sources the internal routers use
 * (genealogyRouter / componentInstallationService / processResultService):
 *   • genealogy_chain        — append-only hash-chained unit events (station/merge/ship/…)
 *   • product_inspections    — AOI/AVI inspection steps (result + machine)
 *   • process_results        — generic station step outcomes (torque/test/… + metrics)
 *   • component_installations (⋈ supplier_lots) — materials [{part, lot}]
 *
 * HONESTY:
 *   • carton/pallet: there is NO packing table in this platform — they are read
 *     from genealogy_chain event payload keys (carton/cartonCode, pallet/
 *     palletCode; typically on 'ship'/'custom' events) and are null when never
 *     recorded. Never fabricated.
 *   • product/line come from the unit's inspections (productModel/lineCode)
 *     falling back to the chain's productModelId → product_models.code.
 *   • 404 only when EVERY source is empty for the unit.
 * Scope: data:read. READ-ONLY.
 */
import { type Router, type Request, type Response } from "express";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";

// ─── Serving shapes (spec §10.3) ──────────────────────────────────────────────

export interface GenealogyStep {
  station: string;
  ts: string;
  result: string | null;
  data: Record<string, unknown>;
  source: "genealogy_chain" | "product_inspections" | "process_results";
}

export interface GenealogyMaterial {
  part: string;
  lot: string | null;
  serial?: string | null;
  qty?: number;
  ref?: string | null;
}

export interface GenealogyRecord {
  unit_id: string;
  product: string | null;
  line: string | null;
  started: string | null;
  finished: string | null;
  steps: GenealogyStep[];
  materials: GenealogyMaterial[];
  carton: string | null;
  pallet: string | null;
  sources: { chain_events: number; inspections: number; process_results: number; installations: number };
}

function pickString(obj: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  if (!obj) return null;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

// ─── GET /genealogy/:unitId ───────────────────────────────────────────────────

async function assembleRecord(unitId: string): Promise<GenealogyRecord | null> {
  const { getDb } = await import("../../db/connection");
  const {
    genealogyChain,
    productInspections,
    processResults,
    componentInstallations,
    supplierLots,
    machines,
    productModels,
  } = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) return null;

  // 1) Chain events (asc = insertion/chain order).
  const chainRows = await db
    .select()
    .from(genealogyChain)
    .where(eq(genealogyChain.serialNumber, unitId))
    .orderBy(asc(genealogyChain.id))
    .limit(5000);

  // 2) Inspection steps (machine code joined for the station label).
  const inspectionRows = await db
    .select({
      id: productInspections.id,
      machineId: productInspections.machineId,
      machineCode: machines.code,
      stageCode: productInspections.stageCode,
      lineCode: productInspections.lineCode,
      productModel: productInspections.productModel,
      overallResult: productInspections.overallResult,
      inspectionTime: productInspections.inspectionTime,
      cycleTime: productInspections.cycleTime,
      productionOrderCode: productInspections.productionOrderCode,
    })
    .from(productInspections)
    .leftJoin(machines, eq(productInspections.machineId, machines.id))
    .where(eq(productInspections.serialNumber, unitId))
    .orderBy(asc(productInspections.inspectionTime))
    .limit(1000);

  // 3) Generic process step results.
  const processRows = await db
    .select({
      id: processResults.id,
      machineId: processResults.machineId,
      machineCode: machines.code,
      stepType: processResults.stepType,
      lineCode: processResults.lineCode,
      result: processResults.result,
      metrics: processResults.metrics,
      measuredAt: processResults.measuredAt,
      recipeRef: processResults.recipeRef,
    })
    .from(processResults)
    .leftJoin(machines, eq(processResults.machineId, machines.id))
    .where(eq(processResults.serialNumber, unitId))
    .orderBy(asc(processResults.measuredAt))
    .limit(1000);

  // 4) Materials (component installations ⋈ supplier lots for the lot code).
  const installRows = await db
    .select({
      componentCode: componentInstallations.componentCode,
      componentSerial: componentInstallations.componentSerial,
      qty: componentInstallations.qty,
      refDesignator: componentInstallations.refDesignator,
      installedAt: componentInstallations.installedAt,
      supplierLotNumber: supplierLots.supplierLotNumber,
    })
    .from(componentInstallations)
    .leftJoin(supplierLots, eq(componentInstallations.supplierLotId, supplierLots.id))
    .where(eq(componentInstallations.serialNumber, unitId))
    .orderBy(asc(componentInstallations.installedAt))
    .limit(2000);

  if (
    chainRows.length === 0 &&
    inspectionRows.length === 0 &&
    processRows.length === 0 &&
    installRows.length === 0
  ) {
    return null;
  }

  // ── steps: union of the three step sources, time-ordered ───────────────────
  const steps: GenealogyStep[] = [];
  for (const c of chainRows) {
    const payload = (c.payload ?? {}) as Record<string, unknown>;
    steps.push({
      station: c.stationCode ?? String(c.eventType),
      ts: new Date(c.recordedAt).toISOString(),
      result: pickString(payload, ["result", "status"]),
      data: { eventType: c.eventType, ...(c.parentSerial ? { parentSerial: c.parentSerial } : {}), ...payload },
      source: "genealogy_chain",
    });
  }
  for (const i of inspectionRows) {
    steps.push({
      station: i.machineCode ?? i.stageCode ?? `machine:${i.machineId}`,
      ts: new Date(i.inspectionTime).toISOString(),
      result: String(i.overallResult),
      data: {
        inspectionId: i.id,
        machineId: i.machineId,
        ...(i.stageCode ? { stageCode: i.stageCode } : {}),
        ...(i.cycleTime != null ? { cycleTime: Number(i.cycleTime) } : {}),
        ...(i.productionOrderCode ? { productionOrderCode: i.productionOrderCode } : {}),
      },
      source: "product_inspections",
    });
  }
  for (const p of processRows) {
    steps.push({
      station: p.machineCode ?? `machine:${p.machineId}`,
      ts: new Date(p.measuredAt).toISOString(),
      result: String(p.result),
      data: {
        stepType: p.stepType,
        ...(p.metrics ? { metrics: p.metrics } : {}),
        ...(p.recipeRef ? { recipeRef: p.recipeRef } : {}),
      },
      source: "process_results",
    });
  }
  steps.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // ── materials ───────────────────────────────────────────────────────────────
  const materials: GenealogyMaterial[] = installRows.map((m) => ({
    part: m.componentCode,
    lot: m.supplierLotNumber ?? null,
    ...(m.componentSerial ? { serial: m.componentSerial } : {}),
    ...(m.qty != null ? { qty: Number(m.qty) } : {}),
    ...(m.refDesignator ? { ref: m.refDesignator } : {}),
  }));

  // ── product / line / carton / pallet (honest fallbacks) ────────────────────
  let product: string | null = pickString(
    { productModel: inspectionRows.find((i) => i.productModel)?.productModel ?? null },
    ["productModel"],
  );
  if (!product) {
    const pmId = chainRows.find((c) => c.productModelId != null)?.productModelId;
    if (pmId != null) {
      const [pm] = await db.select({ code: productModels.code }).from(productModels).where(eq(productModels.id, pmId)).limit(1);
      product = pm?.code ?? null;
    }
  }
  const line =
    inspectionRows.find((i) => i.lineCode)?.lineCode ??
    processRows.find((p) => p.lineCode)?.lineCode ??
    null;

  let carton: string | null = null;
  let pallet: string | null = null;
  for (const c of chainRows) {
    const payload = (c.payload ?? {}) as Record<string, unknown>;
    carton = pickString(payload, ["carton", "cartonCode", "carton_id", "cartonId"]) ?? carton;
    pallet = pickString(payload, ["pallet", "palletCode", "pallet_id", "palletId"]) ?? pallet;
  }

  return {
    unit_id: unitId,
    product,
    line,
    started: steps[0]?.ts ?? null,
    finished: steps.length > 0 ? steps[steps.length - 1].ts : null,
    steps,
    materials,
    carton,
    pallet,
    sources: {
      chain_events: chainRows.length,
      inspections: inspectionRows.length,
      process_results: processRows.length,
      installations: installRows.length,
    },
  };
}

// ─── POST /genealogy/search ───────────────────────────────────────────────────

const searchSchema = z.object({
  lot: z.string().trim().min(1).max(120).optional(),
  part: z.string().trim().min(1).max(120).optional(),
  carton: z.string().trim().min(1).max(120).optional(),
  pallet: z.string().trim().min(1).max(120).optional(),
  dateRange: z
    .object({
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

function rangeDate(raw: string | undefined, label: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new ApiHttpError(400, "bad_request", `Invalid dateRange.${label}.`);
  return d;
}

/** Intersect helper (null = criterion not applied). */
function intersect(a: Set<string> | null, b: Set<string>): Set<string> {
  if (a === null) return b;
  const out = new Set<string>();
  for (const v of a) if (b.has(v)) out.add(v);
  return out;
}

async function searchUnits(input: z.infer<typeof searchSchema>): Promise<{ units: string[]; criteria: string[] } | null> {
  const { getDb } = await import("../../db/connection");
  const { genealogyChain, componentInstallations, supplierLots } = await import("../../../drizzle/schema");
  const db = await getDb();
  if (!db) return null;

  const from = rangeDate(input.dateRange?.from, "from");
  const to = rangeDate(input.dateRange?.to, "to");
  const perQueryLimit = 5000;
  const criteria: string[] = [];
  let result: Set<string> | null = null;

  // lot → chain lotCode ∪ installations whose supplier lot number matches.
  if (input.lot) {
    criteria.push("lot");
    const found = new Set<string>();
    const chainConds: SQL[] = [eq(genealogyChain.lotCode, input.lot)];
    if (from) chainConds.push(gte(genealogyChain.recordedAt, from));
    if (to) chainConds.push(lte(genealogyChain.recordedAt, to));
    const chainRows = await db
      .select({ serialNumber: genealogyChain.serialNumber })
      .from(genealogyChain)
      .where(and(...chainConds))
      .limit(perQueryLimit);
    for (const r of chainRows) found.add(r.serialNumber);

    const instConds: SQL[] = [eq(supplierLots.supplierLotNumber, input.lot)];
    if (from) instConds.push(gte(componentInstallations.installedAt, from));
    if (to) instConds.push(lte(componentInstallations.installedAt, to));
    const instRows = await db
      .select({ serialNumber: componentInstallations.serialNumber })
      .from(componentInstallations)
      .innerJoin(supplierLots, eq(componentInstallations.supplierLotId, supplierLots.id))
      .where(and(...instConds))
      .limit(perQueryLimit);
    for (const r of instRows) found.add(r.serialNumber);
    result = intersect(result, found);
  }

  // part → installations by component code.
  if (input.part) {
    criteria.push("part");
    const conds: SQL[] = [eq(componentInstallations.componentCode, input.part)];
    if (from) conds.push(gte(componentInstallations.installedAt, from));
    if (to) conds.push(lte(componentInstallations.installedAt, to));
    const rows = await db
      .select({ serialNumber: componentInstallations.serialNumber })
      .from(componentInstallations)
      .where(and(...conds))
      .limit(perQueryLimit);
    result = intersect(result, new Set(rows.map((r) => r.serialNumber)));
  }

  // carton / pallet → chain event payload keys (see module header).
  const payloadCriterion = async (keys: string[], value: string, label: string) => {
    criteria.push(label);
    const keyConds = keys.map((k) => sql`${genealogyChain.payload} ->> ${k} = ${value}`);
    const conds: SQL[] = [sql`(${sql.join(keyConds, sql` OR `)})`];
    if (from) conds.push(gte(genealogyChain.recordedAt, from));
    if (to) conds.push(lte(genealogyChain.recordedAt, to));
    const rows = await db
      .select({ serialNumber: genealogyChain.serialNumber })
      .from(genealogyChain)
      .where(and(...conds))
      .limit(perQueryLimit);
    result = intersect(result, new Set(rows.map((r) => r.serialNumber)));
  };
  if (input.carton) await payloadCriterion(["carton", "cartonCode", "carton_id", "cartonId"], input.carton, "carton");
  if (input.pallet) await payloadCriterion(["pallet", "palletCode", "pallet_id", "palletId"], input.pallet, "pallet");

  const limit = input.limit ?? 200;
  const units = [...(result ?? new Set<string>())].sort().slice(0, limit);
  return { units, criteria };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** Register /genealogy routes on the /api/v1 router. */
export function registerGenealogyRoutes(r: Router): void {
  r.get(
    "/genealogy/:unitId",
    requireScope(API_SCOPES.DATA_READ),
    wrap(async (req: Request, res: Response) => {
      const unitId = String(req.params.unitId ?? "").trim();
      if (!unitId || unitId.length > 128) throw new ApiHttpError(400, "bad_request", "Invalid unit id (serial number).");
      const record = await assembleRecord(unitId);
      if (!record) {
        throw new ApiHttpError(
          404,
          "not_found",
          `Unit "${unitId}" has no genealogy data (no chain events, inspections, process results or installations).`,
        );
      }
      sendOk(res, record);
    }),
  );

  r.post(
    "/genealogy/search",
    requireScope(API_SCOPES.DATA_READ),
    wrap(async (req: Request, res: Response) => {
      const parsed = searchSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ApiHttpError(400, "bad_request", "Invalid genealogy search body.", { issues: parsed.error.issues });
      }
      const input = parsed.data;
      if (!input.lot && !input.part && !input.carton && !input.pallet) {
        throw new ApiHttpError(400, "bad_request", "Provide at least one of: lot, part, carton, pallet.");
      }
      const found = await searchUnits(input);
      if (!found) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");
      sendOk(res, {
        units: found.units,
        count: found.units.length,
        criteria: found.criteria,
        // AND semantics across supplied criteria (documented for callers).
        semantics: "intersection",
      });
    }),
  );
}
