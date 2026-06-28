/**
 * AI Setup Advisor (LUỒNG ① + E.0 — doc 06 Technician Copilot).
 *
 * Goal: when a technician sets up a NEW machine, the AI pre-fills the whole
 * config from the MOST SIMILAR existing machine/product (a "template"). The
 * technician then REVIEWS + APPROVES via the wizard's existing RBAC'd create
 * flow instead of typing everything from scratch.
 *
 * This service is ADVISORY and FAIL-SAFE:
 *   - It never writes anything (the wizard creates via its normal mutations).
 *   - It never throws (every public fn returns a degraded bundle on error).
 *   - Flag-gated: AI_SETUP_ADVISOR_ENABLED (default OFF) → disabled bundle.
 *
 * E.0 rule (thresholds): if the template point has enough recorded samples we
 * SUGGEST limits via suggestThresholds (server/utils/thresholdSuggestion.ts);
 * otherwise we COPY the template's stored limits and tag source:"copied" with a
 * note that a threshold auto-tune cron will refine them later.
 *
 * Pure helpers (similarity scoring + bundle assembly from an INJECTED template)
 * are exported for tests so no DB is required to verify the core logic.
 */

import * as db from "../db";
import { suggestThresholds } from "../utils/thresholdSuggestion";

// ─── Flags / constants ────────────────────────────────────────────────────────

export function isSetupAdvisorEnabled(): boolean {
  return (process.env.AI_SETUP_ADVISOR_ENABLED ?? "false").toLowerCase() === "true";
}

/** Min recorded samples for a point before we trust suggestThresholds over a copy. */
export function setupMinSamples(): number {
  const n = Number(process.env.AI_SETUP_ADVISOR_MIN_SAMPLES ?? 200);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}

/** Default recommended AI model when none is inferable from the template. */
export const DEFAULT_MODEL = "dinov2-small" as const;

/** Machine types that are "related" for similarity (optical-family inspection). */
const RELATED_TYPES: Record<string, string[]> = {
  AOI: ["AVI", "SPI", "AXI"],
  AVI: ["AOI", "SPI", "AXI"],
  SPI: ["AOI", "AVI", "AXI"],
  AXI: ["AOI", "AVI", "SPI"],
  ICT: ["FCT", "ICT_FUNC"],
  FCT: ["ICT", "ICT_FUNC"],
  ICT_FUNC: ["ICT", "FCT"],
};

// ─── Shared shapes (mirrored by the frontend) ─────────────────────────────────

export type SourceTag = "data" | "copied" | "default";

export interface TemplateMachineLite {
  id: number;
  code: string | null;
  name: string | null;
  machineType: string;
  stationId: number | null;
  /** Product model the template is mapped to / its points belong to (if any). */
  productModelId: number | null;
}

/** A measurement point definition as we read it from the template product. */
export interface TemplatePoint {
  id: number;
  code: string | null;
  name: string | null;
  measurementType: string | null;
  unit: string | null;
  lowerLimit: number | null;
  upperLimit: number | null;
  nominalValue: number | null;
  /** Recent recorded values for this point (drives copy-vs-suggest). */
  sampleValues?: number[];
}

export interface TemplateNgThreshold {
  warning: number | null;
  critical: number | null;
  minSampleSize: number | null;
  cooldownMinutes: number | null;
}

/** Everything the assembler needs — injectable so the assembler is pure/testable. */
export interface TemplateData {
  machine: TemplateMachineLite;
  points: TemplatePoint[];
  ngThresholds: TemplateNgThreshold[];
  reason: string;
}

export interface ProposedPoint {
  code: string | null;
  name: string | null;
  measurementType: string | null;
  unit: string | null;
  lsl: number | null;
  usl: number | null;
  target: number | null;
  /** "data" = computed from template samples; "copied" = template's stored limits. */
  source: SourceTag;
  sampleSize: number;
  note?: string;
}

export interface ProposedNgThreshold {
  warning: number;
  critical: number;
  minSampleSize: number;
  cooldownMinutes: number;
  source: SourceTag;
}

export interface ConfigBundle {
  ok: boolean;
  disabled?: boolean;
  /** The template machine the bundle was derived from (null when defaults used). */
  templateMachine: TemplateMachineLite | null;
  /** Human-readable reason the template was chosen. */
  similarityReason: string;
  points: ProposedPoint[];
  ngThresholds: ProposedNgThreshold[];
  /** Suggested station to assign (the template's station), tagged. */
  stationSuggestion: { stationId: number | null; source: SourceTag };
  /** Recommended AI model code, tagged. */
  model: { code: string; source: SourceTag };
  /** Counts for a decision-ready summary card. */
  summary: {
    points: number;
    ngThresholds: number;
    thresholdsFromData: number;
    thresholdsCopied: number;
  };
  notes: string[];
  /** True when no template / thin data / flag off — UI shows a friendly note. */
  degraded: boolean;
}

// ─── Pure helpers (exported for tests) ────────────────────────────────────────

function toNum(x: unknown): number | null {
  if (x == null) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export function round2(v: number): number {
  return Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;
}

/** True when `b` is the same or a "related" machine type as `a`. */
export function typesRelated(a: string, b: string): boolean {
  if (a === b) return true;
  return (RELATED_TYPES[a] ?? []).includes(b);
}

/**
 * Similarity score for a candidate template machine vs the target setup.
 * Higher is better. Pure — operates on already-loaded candidate facts.
 *
 * Weights (decreasing): exact machineType match >> same product model >>
 * related type >> richness of the measurement-point set.
 */
export function scoreCandidate(
  target: { machineType: string; productModelId?: number | null },
  cand: {
    machineType: string;
    productModelId: number | null;
    pointCount: number;
  },
): number {
  let score = 0;
  // Exact machine-type match dominates: an exact type with a different product
  // is preferred over a related type that happens to share the product model.
  if (cand.machineType === target.machineType) score += 120;
  else if (typesRelated(target.machineType, cand.machineType)) score += 40;
  else return -1; // unrelated type → never a template

  if (target.productModelId != null && cand.productModelId === target.productModelId) {
    score += 50;
  } else if (target.productModelId == null && cand.productModelId != null) {
    score += 10; // any product config is better than none
  }

  // Richness: more configured points → a more useful template (capped).
  score += Math.min(30, cand.pointCount);

  return score;
}

/**
 * Pick the best template from a list of candidates (pure). Returns the winner +
 * a human reason, or null when none is related.
 */
export function pickBestTemplate(
  target: { machineType: string; productModelId?: number | null },
  candidates: Array<{
    machine: TemplateMachineLite;
    pointCount: number;
  }>,
): { machine: TemplateMachineLite; score: number; reason: string } | null {
  let best: { machine: TemplateMachineLite; score: number } | null = null;
  for (const c of candidates) {
    const score = scoreCandidate(target, {
      machineType: c.machine.machineType,
      productModelId: c.machine.productModelId,
      pointCount: c.pointCount,
    });
    if (score < 0) continue;
    if (!best || score > best.score) best = { machine: c.machine, score };
  }
  if (!best) return null;

  const sameType = best.machine.machineType === target.machineType;
  const sameProduct =
    target.productModelId != null && best.machine.productModelId === target.productModelId;
  const reasonParts: string[] = [];
  reasonParts.push(
    sameType
      ? `cùng loại máy ${target.machineType}`
      : `loại máy tương tự (${best.machine.machineType} ~ ${target.machineType})`,
  );
  if (sameProduct) reasonParts.push("cùng model sản phẩm");
  reasonParts.push(`bộ điểm đo phong phú nhất`);

  return {
    machine: best.machine,
    score: best.score,
    reason: `Máy "${best.machine.code ?? best.machine.id}" — ${reasonParts.join(", ")}.`,
  };
}

/** Assemble a proposed point from a template point, applying the E.0 copy/suggest rule. */
export function assembleProposedPoint(p: TemplatePoint, minSamples: number): ProposedPoint {
  const lsl = toNum(p.lowerLimit);
  const usl = toNum(p.upperLimit);
  const target = toNum(p.nominalValue);
  const values = (p.sampleValues ?? []).filter((v) => typeof v === "number" && Number.isFinite(v));

  if (values.length >= minSamples) {
    const sug = suggestThresholds({
      values,
      currentNominal: target,
      currentLsl: lsl,
      currentUsl: usl,
      priorWeight: 0.2,
    });
    return {
      code: p.code,
      name: p.name,
      measurementType: p.measurementType,
      unit: p.unit,
      lsl: round2(sug.suggestedLsl),
      usl: round2(sug.suggestedUsl),
      target: round2(sug.suggestedTarget),
      source: "data",
      sampleSize: sug.n,
      note: `Tính từ ${sug.n} mẫu của máy mẫu.`,
    };
  }

  // Not enough data → COPY the template's stored limits; cron tunes later.
  return {
    code: p.code,
    name: p.name,
    measurementType: p.measurementType,
    unit: p.unit,
    lsl,
    usl,
    target,
    source: "copied",
    sampleSize: values.length,
    note: "Sao chép từ máy mẫu — sẽ tự tinh chỉnh khi đủ dữ liệu.",
  };
}

/**
 * Assemble the full bundle from an INJECTED template (pure, no DB). The DB-backed
 * buildConfigBundle below loads a TemplateData then calls this.
 */
export function assembleBundle(
  template: TemplateData | null,
  opts: { minSamples: number; recommendedModel?: string | null },
): ConfigBundle {
  if (!template) {
    return {
      ok: true,
      templateMachine: null,
      similarityReason: "Không tìm thấy máy tương tự, dùng mặc định.",
      points: [],
      ngThresholds: [],
      stationSuggestion: { stationId: null, source: "default" },
      model: { code: opts.recommendedModel || DEFAULT_MODEL, source: "default" },
      summary: { points: 0, ngThresholds: 0, thresholdsFromData: 0, thresholdsCopied: 0 },
      notes: [
        "Không tìm thấy máy tương tự — dùng giá trị mặc định. Hãy nhập/duyệt thủ công.",
      ],
      degraded: true,
    };
  }

  const points = template.points.map((p) => assembleProposedPoint(p, opts.minSamples));
  const thresholdsFromData = points.filter((p) => p.source === "data").length;
  const thresholdsCopied = points.filter((p) => p.source === "copied").length;

  const ngThresholds: ProposedNgThreshold[] = template.ngThresholds.map((ng) => ({
    warning: round2(toNum(ng.warning) ?? 5),
    critical: round2(Math.max(toNum(ng.critical) ?? 10, toNum(ng.warning) ?? 5)),
    minSampleSize: toNum(ng.minSampleSize) ?? 10,
    cooldownMinutes: toNum(ng.cooldownMinutes) ?? 30,
    source: "copied",
  }));

  const notes: string[] = [template.reason];
  if (thresholdsCopied > 0) {
    notes.push(
      `${thresholdsCopied} điểm đo sao chép ngưỡng từ máy mẫu — cron sẽ tự tinh chỉnh khi đủ dữ liệu.`,
    );
  }
  if (points.length === 0) {
    notes.push("Máy mẫu chưa có điểm đo — hãy thêm thủ công.");
  }

  const degraded = points.length === 0;

  return {
    ok: true,
    templateMachine: template.machine,
    similarityReason: template.reason,
    points,
    ngThresholds,
    stationSuggestion: { stationId: template.machine.stationId, source: "copied" },
    model: {
      code: opts.recommendedModel || DEFAULT_MODEL,
      source: opts.recommendedModel ? "copied" : "default",
    },
    summary: {
      points: points.length,
      ngThresholds: ngThresholds.length,
      thresholdsFromData,
      thresholdsCopied,
    },
    notes,
    degraded,
  };
}

// ─── DB-backed loaders (fail-safe; never throw) ───────────────────────────────

/**
 * Load candidate machines (active) with their product-model + point-count, so
 * pickBestTemplate can score them. Best-effort: returns [] on any failure.
 */
async function loadCandidates(): Promise<
  Array<{ machine: TemplateMachineLite; pointCount: number }>
> {
  try {
    const machines = (await db.getMachines()) as any[];
    const out: Array<{ machine: TemplateMachineLite; pointCount: number }> = [];
    for (const m of machines) {
      // Prefer a product the machine is mapped to (highest priority mapping).
      let productModelId: number | null = null;
      try {
        const mappings = (await db.getMappingsByMachine(m.id)) as any[];
        if (mappings.length > 0) productModelId = mappings[0]?.mapping?.productModelId ?? null;
      } catch {
        /* ignore */
      }

      // Count configured points (machine-specific OR via its product model).
      let pointCount = 0;
      try {
        const byMachine = (await db.getMeasurementPointDefsByMachine(m.id)) as any[];
        pointCount = byMachine.length;
        if (pointCount === 0 && productModelId != null) {
          const byProduct = (await db.getMeasurementPointDefsByProductModel(productModelId)) as any[];
          pointCount = byProduct.length;
        }
      } catch {
        /* ignore */
      }

      out.push({
        machine: {
          id: m.id,
          code: m.code ?? null,
          name: m.name ?? null,
          machineType: String(m.machineType),
          stationId: m.stationId ?? null,
          productModelId,
        },
        pointCount,
      });
    }
    return out;
  } catch (err) {
    console.warn("[aiSetupAdvisor] loadCandidates failed:", err);
    return [];
  }
}

/** Load the points + NG thresholds for a chosen template machine. */
async function loadTemplateConfig(
  machine: TemplateMachineLite,
  reason: string,
): Promise<TemplateData> {
  const points: TemplatePoint[] = [];
  try {
    let defs = (await db.getMeasurementPointDefsByMachine(machine.id)) as any[];
    if ((!defs || defs.length === 0) && machine.productModelId != null) {
      defs = (await db.getMeasurementPointDefsByProductModel(machine.productModelId)) as any[];
    }
    for (const d of defs ?? []) {
      let sampleValues: number[] = [];
      try {
        const rows = (await db.listMeasurementSamples({ pointDefId: d.id, windowSize: 5000 })) as any[];
        for (const r of rows) {
          const v = toNum((r as any).value);
          if (v !== null) sampleValues.push(v);
        }
      } catch {
        sampleValues = [];
      }
      points.push({
        id: d.id,
        code: d.code ?? null,
        name: d.name ?? null,
        measurementType: d.measurementType ?? null,
        unit: d.unit ?? null,
        lowerLimit: d.lowerLimit ?? null,
        upperLimit: d.upperLimit ?? null,
        nominalValue: d.nominalValue ?? null,
        sampleValues,
      });
    }
  } catch (err) {
    console.warn("[aiSetupAdvisor] loadTemplateConfig points failed:", err);
  }

  const ngThresholds: TemplateNgThreshold[] = [];
  try {
    const ngRows = await loadNgThresholdsForMachine(machine.id);
    for (const r of ngRows ?? []) {
      const t = (r as any).threshold ?? r;
      ngThresholds.push({
        warning: toNum(t.warningThreshold),
        critical: toNum(t.criticalThreshold),
        minSampleSize: toNum(t.minSampleSize),
        cooldownMinutes: toNum(t.cooldownMinutes),
      });
    }
  } catch (err) {
    console.warn("[aiSetupAdvisor] loadTemplateConfig ng failed:", err);
  }

  return { machine, points, ngThresholds, reason };
}

/** Best-effort NG-threshold lookup for a machine via the raw table. */
async function loadNgThresholdsForMachine(machineId: number): Promise<any[]> {
  try {
    const { getDb } = await import("../db/connection");
    const { mqttNgRateThresholds } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const conn = await getDb();
    if (!conn) return [];
    return await conn
      .select()
      .from(mqttNgRateThresholds)
      .where(and(eq(mqttNgRateThresholds.machineId, machineId), eq(mqttNgRateThresholds.isEnabled, true)));
  } catch {
    return [];
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Find the most similar existing machine to use as a setup template.
 * Returns null + a note when none is found (or the flag is off). Never throws.
 */
export async function findSimilarTemplate(input: {
  machineType: string;
  productModelId?: number;
  /** Exclude the target machine itself (if it already exists). */
  targetMachineId?: number;
}): Promise<{ machine: TemplateMachineLite; reason: string } | null> {
  if (!isSetupAdvisorEnabled()) return null;
  try {
    const candidates = (await loadCandidates()).filter(
      (c) => c.machine.id !== input.targetMachineId,
    );
    const best = pickBestTemplate(
      { machineType: input.machineType, productModelId: input.productModelId ?? null },
      candidates,
    );
    if (!best) return null;
    return { machine: best.machine, reason: best.reason };
  } catch (err) {
    console.warn("[aiSetupAdvisor] findSimilarTemplate failed:", err);
    return null;
  }
}

/**
 * Assemble a proposed config bundle for a NEW machine, from the most similar
 * template. Honest-degrade: flag off / no template / error → defaults bundle.
 * Never throws.
 */
export async function buildConfigBundle(input: {
  machineType: string;
  productModelId?: number;
  targetMachineId?: number;
}): Promise<ConfigBundle> {
  const minSamples = setupMinSamples();

  if (!isSetupAdvisorEnabled()) {
    const base = assembleBundle(null, { minSamples });
    return {
      ...base,
      disabled: true,
      similarityReason: "Trợ lý cấu hình chưa bật (AI_SETUP_ADVISOR_ENABLED).",
      notes: ["Trợ lý cấu hình chưa bật — dùng giá trị mặc định, nhập thủ công."],
    };
  }

  try {
    const found = await findSimilarTemplate(input);
    if (!found) {
      return assembleBundle(null, { minSamples });
    }
    const template = await loadTemplateConfig(found.machine, found.reason);
    return assembleBundle(template, { minSamples });
  } catch (err) {
    console.warn("[aiSetupAdvisor] buildConfigBundle failed:", err);
    const base = assembleBundle(null, { minSamples });
    return {
      ...base,
      notes: ["Lỗi khi dựng cấu hình đề xuất — dùng giá trị mặc định, nhập thủ công."],
    };
  }
}
