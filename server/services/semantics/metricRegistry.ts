/**
 * Semantic Metric Registry — doc 44 Batch W2-A4 (gaps G2.14 + G2.15).
 * SYNAPSE Tầng 2 — Chương 9 (Semantic Layer) + Chương 10.2 (MetricResult).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * "MỘT ĐỊNH NGHĨA — MỘT SỰ THẬT": metric definitions live AS-CODE + VERSIONED
 * in contracts/metrics/*.yaml (Git-reviewed). This registry
 *   • loads + validates them once at init (cached),
 *   • serves them (listMetrics / getDefinition),
 *   • computes them (computeMetric → MetricResult per spec §10.2, ALWAYS
 *     stamped with definition_version "OEE@v1"),
 *   • guards them (verifyDefinitionsIntegrity — a formula change without a
 *     version bump is caught against a pinned fingerprint snapshot).
 *
 * DELEGATION, NEVER RE-DERIVATION: computeMetric maps each definition's
 * `implementation` pointer onto the EXPLICIT static handler table below
 * (IMPLEMENTATIONS) — statically imported canonical functions only
 * (oeeService.* — the self-declared CANONICAL OEE source, oeeService.ts:27-51;
 * server/utils/kpi.* — the LOCKED yield/FPY/DPMO math, doc 27 decision #4;
 * server/db/statistics.getMachineStats — which itself delegates to kpi.*).
 * NO string eval, NO dynamic require. A metric asked for a scope it does not
 * declare → honest MetricComputeError("UNSUPPORTED_SCOPE").
 *
 * UNITS: MetricResult.value / parts are normalized FRACTIONS 0..1 for ratio
 * metrics (spec §10.2 example: value 0.87) even though the underlying live
 * services speak percentages 0..100 for the legacy UI contract. Count-type
 * metrics (Throughput) and per-million metrics (DPMO) keep their natural unit
 * (declared in each YAML's notes). Honest-null is preserved end-to-end.
 *
 * READ-ONLY: nothing here writes to the DB or to any device.
 * ════════════════════════════════════════════════════════════════════════════
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseAllDocuments } from "yaml";
import { and, gte, lte, sql } from "drizzle-orm";

import { getDb } from "../../db/connection";
import { productInspections } from "../../../drizzle/schema";
// CANONICAL sources (read-only imports — see file headers of each):
import { getMachineOEELive, getLineOEE, resolveIdealCycleTimeSec } from "../oeeService";
import { getMachineStats } from "../../db/statistics";
import { dpmo as dpmoMath, fpyAggregateSql, fpyFromFirstInspections, executeRows } from "../../utils/kpi";

// ════════════════════════════════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════════════════════════════════

export interface MetricInputDef {
  name: string;
  source: string;
}

export interface MetricDefinition {
  metric: string;
  /** Bumped whenever the formula (or an input's meaning) changes. */
  version: number;
  scope: string[];
  formula: string;
  /** Pointer(s) to the canonical implementation — a single key or one per scope. */
  implementation: string | Record<string, string>;
  inputs?: MetricInputDef[];
  notes?: string;
}

/** MetricResult — serving schema per SYNAPSE Tầng 2 spec §10.2. */
export interface MetricResult {
  metric: string;
  scope: string;
  /** Human-resolvable path for the scope when known (machine code / line name). */
  path?: string;
  window: { from: string; to: string };
  /** Honest-null when the canonical inputs are absent — never fabricated. */
  value: number | null;
  parts?: Record<string, number | null>;
  /** e.g. "OEE@v1" — traceability to the governed definition. */
  definition_version: string;
}

export type MetricComputeErrorCode =
  | "METRIC_NOT_FOUND"
  | "UNSUPPORTED_SCOPE"
  | "SCOPE_ID_REQUIRED"
  | "WINDOW_NOT_SUPPORTED"
  | "DB_UNAVAILABLE";

export class MetricComputeError extends Error {
  constructor(
    public readonly code: MetricComputeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MetricComputeError";
  }
}

interface ComputeArgs {
  scope: string;
  scopeId?: number;
  from: Date;
  to: Date;
}

interface ComputeOutcome {
  value: number | null;
  parts?: Record<string, number | null>;
  path?: string;
}

type ImplementationFn = (args: Required<Pick<ComputeArgs, "from" | "to">> & ComputeArgs, metric: string) => Promise<ComputeOutcome>;

// ════════════════════════════════════════════════════════════════════════════
// Canonical implementation handlers — EXPLICIT static map (no string eval).
// Keys are the `implementation` pointers used by contracts/metrics/*.yaml.
// ════════════════════════════════════════════════════════════════════════════

/** % (0..100 legacy contract) → fraction 0..1, 4 decimals; null passes through. */
function pctToFraction(x: number | null | undefined): number | null {
  if (x == null) return null;
  return Math.round((x / 100) * 10000) / 10000;
}

/** Equipment live path accepts only trailing windows anchored ~now. */
const TRAILING_WINDOW_TOLERANCE_MS = 15 * 60 * 1000;

/** Pick the requested OEE-family factor out of a live A/P/Q/OEE result (all %). */
function extractOeeFamily(
  metric: string,
  m: { availability: number | null; performance: number | null; quality: number | null; oee: number | null },
): ComputeOutcome {
  switch (metric) {
    case "OEE":
      return {
        value: pctToFraction(m.oee),
        parts: {
          availability: pctToFraction(m.availability),
          performance: pctToFraction(m.performance),
          quality: pctToFraction(m.quality),
        },
      };
    case "Availability":
      return { value: pctToFraction(m.availability) };
    case "Performance":
      return { value: pctToFraction(m.performance) };
    case "Quality":
      return { value: pctToFraction(m.quality) };
    default:
      // Unreachable for validated definitions; honest error if a YAML ever
      // points a non-OEE-family metric at this handler.
      throw new MetricComputeError(
        "UNSUPPORTED_SCOPE",
        `Metric "${metric}" is not extractable from the OEE live path`,
      );
  }
}

const IMPLEMENTATIONS: Record<string, ImplementationFn> = {
  /**
   * Equipment-grain live OEE family — DELEGATES to the canonical
   * oeeService.getMachineOEELive (trailing window anchored at NOW; ideal cycle
   * resolved via oeeService.resolveIdealCycleTimeSec, same as mqttOeeRouters).
   */
  "oeeService.getMachineOEELive": async (args, metric) => {
    if (args.scopeId == null) {
      throw new MetricComputeError("SCOPE_ID_REQUIRED", `scope "equipment" requires scopeId (machine id)`);
    }
    if (Math.abs(Date.now() - args.to.getTime()) > TRAILING_WINDOW_TOLERANCE_MS) {
      throw new MetricComputeError(
        "WINDOW_NOT_SUPPORTED",
        `equipment-scope ${metric} is computed by the canonical LIVE path (oeeService.getMachineOEELive), ` +
          `which only supports trailing windows ending at now — use scope "line" for historical [from, to] windows`,
      );
    }
    const windowHours = (args.to.getTime() - args.from.getTime()) / 3_600_000;
    const idealCycleTimeSec = await resolveIdealCycleTimeSec(args.scopeId);
    const live = await getMachineOEELive({ machineId: args.scopeId, windowHours, idealCycleTimeSec });
    return { ...extractOeeFamily(metric, live), path: live.machineCode || undefined };
  },

  /**
   * Line-grain OEE family + line Throughput — DELEGATES to the canonical
   * oeeService.getLineOEE (explicit [from, to]; the warRoom rollup path).
   */
  "oeeService.getLineOEE": async (args, metric) => {
    if (args.scopeId == null) {
      throw new MetricComputeError("SCOPE_ID_REQUIRED", `scope "line" requires scopeId (production line id)`);
    }
    const rows = await getLineOEE({ lineId: args.scopeId, from: args.from, to: args.to });
    const row = rows[0];
    if (!row) {
      // Honest-null: unknown line / no active machines / no data in window.
      return metric === "OEE"
        ? { value: null, parts: { availability: null, performance: null, quality: null } }
        : { value: null };
    }
    if (metric === "Throughput") {
      return { value: row.details.totalCount, path: row.lineName };
    }
    return { ...extractOeeFamily(metric, row), path: row.lineName };
  },

  /**
   * Equipment-grain FPY + Throughput — DELEGATES to server/db/statistics
   * getMachineStats, which itself computes via the canonical kpi.fpyAggregateSql
   * fragment + kpi.fpyFromFirstInspections/finalYield math (doc 27 decision #4).
   */
  "statisticsDb.getMachineStats": async (args, metric) => {
    if (args.scopeId == null) {
      throw new MetricComputeError("SCOPE_ID_REQUIRED", `scope "equipment" requires scopeId (machine id)`);
    }
    const stats = await getMachineStats(args.scopeId, args.from, args.to);
    if (metric === "Throughput") {
      return { value: Number(stats.total) || 0 };
    }
    // FPY — recompute the fraction from the raw first-inspection counts through
    // the canonical math (full precision; getMachineStats.fpy is display-rounded).
    const firstTotal = Number(stats.firstTotal) || 0;
    const firstPass = Number(stats.firstPass) || 0;
    if (firstTotal <= 0) {
      return { value: null, parts: { first_pass: firstPass, first_total: firstTotal } };
    }
    return {
      value: Math.round((fpyFromFirstInspections({ firstPass, firstTotal }) / 100) * 10000) / 10000,
      parts: { first_pass: firstPass, first_total: firstTotal },
    };
  },

  /**
   * Factory-grain FPY — DELEGATES to the canonical kpi.fpyAggregateSql SQL
   * fragment (all inspections in window) + kpi.fpyFromFirstInspections math.
   */
  "kpi.fpyAggregateSql": async (args) => {
    const db = await getDb();
    if (!db) throw new MetricComputeError("DB_UNAVAILABLE", "database unavailable");
    const where = and(
      gte(productInspections.inspectionTime, args.from),
      lte(productInspections.inspectionTime, args.to),
    );
    const res = await db.execute(fpyAggregateSql({ where }));
    const row = executeRows(res)[0] ?? {};
    const firstTotal = Number(row.first_total) || 0;
    const firstPass = Number(row.first_pass) || 0;
    if (firstTotal <= 0) {
      return { value: null, parts: { first_pass: firstPass, first_total: firstTotal } };
    }
    return {
      value: Math.round((fpyFromFirstInspections({ firstPass, firstTotal }) / 100) * 10000) / 10000,
      parts: { first_pass: firstPass, first_total: firstTotal },
    };
  },

  /**
   * DPMO (equipment + factory) — fetches the DECLARED input counts
   * (measurement_results: 1 row = 1 opportunity, result='NG' = defect — doc 27
   * gap A8 convention) and DELEGATES the formula to the canonical kpi.dpmo.
   */
  "kpi.dpmo": async (args) => {
    const db = await getDb();
    if (!db) throw new MetricComputeError("DB_UNAVAILABLE", "database unavailable");
    if (args.scope === "equipment" && args.scopeId == null) {
      throw new MetricComputeError("SCOPE_ID_REQUIRED", `scope "equipment" requires scopeId (machine id)`);
    }
    const machineFilter =
      args.scope === "equipment"
        ? sql` AND pi."machineId" = ${args.scopeId}`
        : sql``;
    const rows = executeRows(
      await db.execute(sql`
        SELECT COUNT(mr.id)::int AS opportunities,
               COUNT(mr.id) FILTER (WHERE mr."result" = 'NG')::int AS defects
        FROM measurement_results mr
        JOIN product_inspections pi ON pi.id = mr."inspectionId"
        WHERE pi."inspectionTime" >= ${args.from.toISOString()}
          AND pi."inspectionTime" <= ${args.to.toISOString()}${machineFilter}
      `),
    ) as Array<{ opportunities: number; defects: number }>;
    const opportunities = Number(rows[0]?.opportunities) || 0;
    const defects = Number(rows[0]?.defects) || 0;
    if (opportunities <= 0) {
      // Honest-null: no evaluated measurement points ≠ zero defects.
      return { value: null, parts: { defects, opportunities } };
    }
    return {
      value: Math.round(dpmoMath({ defects, opportunities }) * 100) / 100,
      parts: { defects, opportunities },
    };
  },
};

// ════════════════════════════════════════════════════════════════════════════
// Definition loading + validation (cached at init)
// ════════════════════════════════════════════════════════════════════════════

export const METRIC_CONTRACTS_DIR = path.resolve(process.cwd(), "contracts", "metrics");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse ONE YAML file (single- or multi-document) into validated definitions.
 * Exported for tests. Throws with the offending file/field on invalid structure.
 */
export function parseMetricDefinitions(yamlText: string, fileName: string): MetricDefinition[] {
  const docs = parseAllDocuments(yamlText);
  const out: MetricDefinition[] = [];
  for (const doc of docs) {
    if (doc.errors?.length) {
      throw new Error(`Metric definition ${fileName}: YAML parse error — ${doc.errors[0].message}`);
    }
    const raw = doc.toJS() as unknown;
    if (raw == null) continue; // empty document (e.g. trailing ---)
    if (!isPlainObject(raw)) {
      throw new Error(`Metric definition ${fileName}: each document must be a mapping`);
    }
    const where = `Metric definition ${fileName}${typeof raw.metric === "string" ? ` (${raw.metric})` : ""}`;
    if (typeof raw.metric !== "string" || raw.metric.trim() === "") {
      throw new Error(`${where}: "metric" is required (non-empty string)`);
    }
    if (typeof raw.version !== "number" || !Number.isInteger(raw.version) || raw.version < 1) {
      throw new Error(`${where}: "version" is required (integer ≥ 1)`);
    }
    if (
      !Array.isArray(raw.scope) ||
      raw.scope.length === 0 ||
      raw.scope.some((s) => typeof s !== "string" || s.trim() === "")
    ) {
      throw new Error(`${where}: "scope" is required (non-empty array of strings)`);
    }
    if (typeof raw.formula !== "string" || raw.formula.trim() === "") {
      throw new Error(`${where}: "formula" is required (non-empty string)`);
    }
    const impl = raw.implementation;
    const implOk =
      (typeof impl === "string" && impl.trim() !== "") ||
      (isPlainObject(impl) &&
        Object.keys(impl).length > 0 &&
        Object.values(impl).every((v) => typeof v === "string" && v.trim() !== ""));
    if (!implOk) {
      throw new Error(`${where}: "implementation" is required (string or {scope: string} mapping)`);
    }
    let inputs: MetricInputDef[] | undefined;
    if (raw.inputs != null) {
      if (!Array.isArray(raw.inputs)) throw new Error(`${where}: "inputs" must be an array`);
      inputs = raw.inputs.map((i, idx) => {
        if (!isPlainObject(i) || typeof i.name !== "string" || typeof i.source !== "string") {
          throw new Error(`${where}: inputs[${idx}] must have string "name" and "source"`);
        }
        return { name: i.name, source: i.source };
      });
    }
    out.push({
      metric: raw.metric.trim(),
      version: raw.version,
      scope: (raw.scope as string[]).map((s) => s.trim()),
      formula: raw.formula.trim(),
      implementation: typeof impl === "string" ? impl.trim() : (impl as Record<string, string>),
      inputs,
      notes: typeof raw.notes === "string" ? raw.notes.trim() : undefined,
    });
  }
  return out;
}

/** Resolve the implementation pointer for one scope of a definition. */
function implementationKeyFor(def: MetricDefinition, scope: string): string | null {
  if (typeof def.implementation === "string") return def.implementation;
  return def.implementation[scope] ?? null;
}

function loadRegistry(dir: string): Map<string, MetricDefinition> {
  if (!fs.existsSync(dir)) {
    throw new Error(`Metric contracts directory not found: ${dir}`);
  }
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort();
  const byName = new Map<string, MetricDefinition>();
  for (const file of files) {
    const defs = parseMetricDefinitions(fs.readFileSync(path.join(dir, file), "utf8"), file);
    for (const def of defs) {
      const key = def.metric.toLowerCase();
      if (byName.has(key)) {
        throw new Error(`Metric "${def.metric}" defined more than once (duplicate in ${file})`);
      }
      // FAIL FAST: every declared scope must map to a WIRED canonical handler —
      // a definition must never point at a function that does not exist.
      for (const scope of def.scope) {
        const implKey = implementationKeyFor(def, scope);
        if (!implKey) {
          throw new Error(`Metric "${def.metric}" (${file}): scope "${scope}" has no implementation pointer`);
        }
        if (!IMPLEMENTATIONS[implKey]) {
          throw new Error(
            `Metric "${def.metric}" (${file}): implementation "${implKey}" is not wired in metricRegistry.IMPLEMENTATIONS`,
          );
        }
      }
      byName.set(key, def);
    }
  }
  if (byName.size === 0) {
    throw new Error(`No metric definitions found in ${dir}`);
  }
  return byName;
}

let cache: Map<string, MetricDefinition> | null = null;

function registry(): Map<string, MetricDefinition> {
  if (!cache) cache = loadRegistry(METRIC_CONTRACTS_DIR);
  return cache;
}

/** Test seam: drop the cache so the next call re-reads contracts/metrics. */
export function _resetMetricRegistryForTests(): void {
  cache = null;
}

// ════════════════════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════════════════════

/** All governed definitions (registry view for the semantics router/UI). */
export function listMetrics(): Array<
  Pick<MetricDefinition, "metric" | "version" | "scope" | "formula" | "inputs"> & {
    definition_version: string;
  }
> {
  return [...registry().values()].map((d) => ({
    metric: d.metric,
    version: d.version,
    scope: d.scope,
    formula: d.formula,
    inputs: d.inputs,
    definition_version: `${d.metric}@v${d.version}`,
  }));
}

/** Full definition by name (case-insensitive); undefined when unknown. */
export function getDefinition(name: string): MetricDefinition | undefined {
  return registry().get(name.trim().toLowerCase());
}

/**
 * "definition_version" for a metric ("OEE@v1"), FAIL-SAFE: returns null instead
 * of throwing so read-screens (factory command KPI strip) can stamp provenance
 * without taking a dependency on registry health.
 */
export function getMetricDefinitionVersion(name: string): string | null {
  try {
    const def = getDefinition(name);
    return def ? `${def.metric}@v${def.version}` : null;
  } catch {
    return null;
  }
}

/**
 * Compute a metric through its governed definition → MetricResult (spec §10.2).
 * DELEGATES to the canonical implementation; honest errors for unknown metric /
 * undeclared scope; honest-null values when inputs are absent.
 */
export async function computeMetric(
  name: string,
  params: { scope: string; scopeId?: number; from: Date; to: Date },
): Promise<MetricResult> {
  const def = getDefinition(name);
  if (!def) {
    throw new MetricComputeError("METRIC_NOT_FOUND", `Unknown metric "${name}" — see semantics.list`);
  }
  const scope = params.scope.trim();
  if (!def.scope.includes(scope)) {
    throw new MetricComputeError(
      "UNSUPPORTED_SCOPE",
      `Metric "${def.metric}" (v${def.version}) does not define scope "${scope}" — supported scopes: [${def.scope.join(", ")}]`,
    );
  }
  const implKey = implementationKeyFor(def, scope);
  const impl = implKey ? IMPLEMENTATIONS[implKey] : undefined;
  if (!impl) {
    // Load-time validation makes this unreachable; keep an honest guard anyway.
    throw new MetricComputeError(
      "UNSUPPORTED_SCOPE",
      `Metric "${def.metric}": no canonical implementation wired for scope "${scope}"`,
    );
  }
  const outcome = await impl({ scope, scopeId: params.scopeId, from: params.from, to: params.to }, def.metric);
  return {
    metric: def.metric,
    scope,
    ...(outcome.path ? { path: outcome.path } : {}),
    window: { from: params.from.toISOString(), to: params.to.toISOString() },
    value: outcome.value,
    ...(outcome.parts ? { parts: outcome.parts } : {}),
    definition_version: `${def.metric}@v${def.version}`,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Integrity guard — formula changed without a version bump
// ════════════════════════════════════════════════════════════════════════════

/** Whitespace-collapsed sha256 of a formula (stable fingerprint). */
export function formulaHash(formula: string): string {
  return createHash("sha256").update(formula.replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

/** Current { "OEE@v1": <sha256(formula)> } fingerprints of every definition. */
export function definitionFingerprints(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of registry().values()) {
    out[`${d.metric}@v${d.version}`] = formulaHash(d.formula);
  }
  return out;
}

/**
 * Compare current definitions against PINNED fingerprints (the snapshot lives
 * in metricRegistry.test.ts — reviewed in Git like the definitions themselves).
 *
 *   • same key ("OEE@v1") + different hash  → the formula changed WITHOUT a
 *     version bump — the exact drift this guard exists to catch;
 *   • key absent from the pinned snapshot   → new metric/version awaiting review
 *     (update the snapshot deliberately after bumping).
 */
export function verifyDefinitionsIntegrity(
  pinned: Record<string, string>,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  const current = definitionFingerprints();
  for (const [key, hash] of Object.entries(current)) {
    const pin = pinned[key];
    if (pin == null) {
      violations.push(
        `${key}: not pinned — new metric or bumped version; review and update the pinned snapshot`,
      );
    } else if (pin !== hash) {
      violations.push(
        `${key}: formula changed WITHOUT a version bump — bump "version" in contracts/metrics and re-pin`,
      );
    }
  }
  return { ok: violations.length === 0, violations };
}
