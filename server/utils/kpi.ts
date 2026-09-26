/**
 * server/utils/kpi.ts — CANONICAL AOI/AVI KPI definitions
 * (doc 27 — gaps A2/A3/A4/A8, §11 decision #4, LOCKED 2026-07-04)
 *
 * ONE source of truth for yield/FPY/DPMO math and for factory-timezone
 * date bucketing. Every screen, API, report and materialized view MUST
 * derive its numbers from these helpers (TS side) or from the SQL
 * fragments below (DB side) so that identical inputs always produce
 * identical numbers.
 *
 * ── Canonical definitions (decision #4) ────────────────────────────────
 *
 * FINAL YIELD  = (OK + NTF) / total inspections.
 *   NTF ("no trouble found" — machine called NG, human review cleared it)
 *   counts as PASS in the final yield, per SMT convention.
 *
 * FPY (true First Pass Yield) = first inspections that passed / first
 *   inspections, where "first inspection" = the earliest inspection row
 *   per board serial inside the queried window (ORDER BY inspectionTime,
 *   id). Only overallResult = 'OK' counts as a first pass:
 *   - NTF is EXCLUDED from the FPY numerator (the machine flagged the
 *     board; it did not pass untouched) but stays in the denominator.
 *   - Re-tests (2nd..nth rows for the same serial) are excluded entirely.
 *   LIMITATION (honest): the schema has no explicit retest linkage
 *   (product_inspections has serialNumber only — no retestOf/attempt
 *   column), so "first inspection" is detected as first-record-per-serial
 *   WITHIN THE QUERY WINDOW. A board whose true first inspection happened
 *   before the window start is counted by its first in-window record.
 *   Boards with an empty-string serial cannot be grouped and are excluded
 *   from FPY (they still count in final yield).
 *
 * DPMO = defects / opportunities × 1,000,000.
 *   opportunities = number of measurement points evaluated (one
 *   measurement_results row = one opportunity). Full IPC-style
 *   opportunity modelling (components × joints per board) requires the
 *   component library / panel master data that does not exist yet — that
 *   modelling is DEFERRED to gap M12 (doc 27 §2). Until then callers must
 *   pass the evaluated measurement-point count, NOT the board count,
 *   whenever point-level data is available.
 *
 * SIGMA LEVEL = Φ⁻¹(1 − defectRate) + 1.5 (industry 1.5σ shift
 *   convention); perfect quality is capped at 6σ.
 *
 * ── Factory-timezone bucketing ─────────────────────────────────────────
 *
 * All day/hour/shift/day-of-week buckets must be computed in the FACTORY
 * timezone (env FACTORY_TZ, default Asia/Ho_Chi_Minh), NOT in UTC and NOT
 * in the DB session timezone. Otherwise daily charts split at 07:00 VN.
 *
 * Storage semantics (verified empirically 2026-07-04): the inspection
 * columns are `timestamp WITHOUT time zone`. The app's canonical write
 * path (drizzle typed inserts — createProductInspection, used by machine
 * ingest) serializes JS Dates via toISOString(), i.e. naive timestamps
 * hold the **UTC wall time** regardless of the server's local timezone.
 * That is why day-bucketing the raw column split days at 07:00 VN (gap A2)
 * and why the historical one-off +7h data patch existed (doc 27 §6 A1; the
 * patch SQL was removed from the repo root in the Đợt-4 cleanup).
 * The read side therefore interprets stored values as UTC by default;
 * override with env FACTORY_DB_STORAGE_TZ only for legacy datasets that
 * were written as local wall time (e.g. raw-driver/seed scripts, which
 * serialize with the process-local offset — a documented inconsistency).
 *
 * Canonical SQL pattern (session-independent):
 *   date_trunc('day', (ts AT TIME ZONE <storageTz>) AT TIME ZONE <factoryTz>)
 * The first AT TIME ZONE turns the naive value into a timestamptz
 * (interpreting it in the storage timezone), the second converts it to
 * factory-local naive wall time, which is then safe to truncate/format.
 *
 * The timezone names are validated against Intl and inlined as literals
 * (sql.raw) — NOT bind parameters — so the same expression can appear in
 * SELECT and GROUP BY without PostgreSQL complaining about mismatched
 * parameter numbers.
 *
 * Timezone resolution is shared with the report schedulers via
 * server/utils/factoryTime.ts (getFactoryTimezone: env FACTORY_TZ,
 * default Asia/Ho_Chi_Minh, validated with fallback). This module keeps
 * only the SQL-specific validation (assertValidTimezone throws — used to
 * reject injection in tz literals) and the storage-tz resolution.
 */
import { sql, type SQL } from "drizzle-orm";
import { productInspections } from "../../drizzle/schema";
import { getFactoryTimezone, wallClockToUtc } from "./factoryTime";
import { FINAL_YIELD_PASS_RESULTS, finalYield, fpyFromFirstInspections } from "@shared/kpiYield";

export { getFactoryTimezone };
// Task 15: the pure TS formulas now live in shared/kpiYield.ts (ONE source
// of truth reachable from client/src, which cannot import server-only
// modules). Re-exported here so every existing `from "./kpi"` import (and
// the SQL fragment builders below, which reference FINAL_YIELD_PASS_RESULTS'
// meaning but not the binding itself) keeps working unchanged.
export { FINAL_YIELD_PASS_RESULTS, finalYield, fpyFromFirstInspections };

// ═══════════════════════════════════════════════════════════════════════
// Date-window resolution (doc 27 W5-A — factory-TZ windows for endpoints)
// ═══════════════════════════════════════════════════════════════════════

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve a query window sent by the UI to UTC instants.
 *
 * Date pickers send date-ONLY strings ("YYYY-MM-DD"). Interpreting those with
 * `new Date(s)` yields UTC midnight, which in a UTC+7 factory shifts the
 * window by 7 hours (gap A2 at the FILTER level, not just the bucket level).
 * This helper interprets date-only strings as FACTORY-local calendar days:
 *   start = startDay 00:00 factory time, end = endDay + 1 day 00:00 factory
 * time (end-exclusive → the whole end day is included).
 *
 * Full ISO timestamps (anything not matching YYYY-MM-DD) are passed through
 * to `new Date()` unchanged, so precise callers keep exact semantics.
 */
export function resolveFactoryDateWindow(
  startDate: string,
  endDate: string,
): { start: Date; end: Date; endExclusive: boolean } {
  const tz = getFactoryTimezone();
  let start: Date;
  let end: Date;
  let endExclusive = false;

  if (DATE_ONLY_RE.test(startDate.trim())) {
    const [y, m, d] = startDate.trim().split("-").map(Number);
    start = wallClockToUtc({ year: y, month: m, day: d }, tz);
  } else {
    start = new Date(startDate);
  }

  if (DATE_ONLY_RE.test(endDate.trim())) {
    const [y, m, d] = endDate.trim().split("-").map(Number);
    // Next factory-local midnight → whole end day included, end-exclusive.
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    end = wallClockToUtc(
      { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
      tz,
    );
    endExclusive = true;
  } else {
    end = new Date(endDate);
  }

  return { start, end, endExclusive };
}

// ═══════════════════════════════════════════════════════════════════════
// Timezone helpers
// ═══════════════════════════════════════════════════════════════════════

const validatedTimezones = new Set<string>();

/** Throws if `tz` is not a valid IANA timezone name; returns it otherwise. */
export function assertValidTimezone(tz: string): string {
  if (validatedTimezones.has(tz)) return tz;
  if (!/^[A-Za-z0-9_+\-/]+$/.test(tz)) {
    throw new Error(`Invalid timezone name: ${JSON.stringify(tz)}`);
  }
  // Intl throws RangeError for unknown IANA names.
  new Intl.DateTimeFormat("en-US", { timeZone: tz });
  validatedTimezones.add(tz);
  return tz;
}

/**
 * Timezone whose WALL TIME the naive DB timestamps represent.
 * Default: UTC — drizzle typed inserts (the canonical write path) store
 * Date values via toISOString(). Override with FACTORY_DB_STORAGE_TZ for
 * legacy datasets written as local wall time.
 */
export function getDbStorageTimezone(): string {
  return assertValidTimezone(process.env.FACTORY_DB_STORAGE_TZ || "UTC");
}

/** Validated timezone inlined as a SQL string literal (safe: IANA-checked). */
function tzLiteral(tz: string): SQL {
  return sql.raw(`'${assertValidTimezone(tz)}'`);
}

// A SQL expression: a drizzle sql`` chunk or anything embeddable in one
// (columns and aliased chunks implement the SQLWrapper protocol).
type SqlExpr = SQL | { getSQL(): SQL };

// ═══════════════════════════════════════════════════════════════════════
// SQL fragment builders — factory-timezone bucketing
// ═══════════════════════════════════════════════════════════════════════

/**
 * Naive stored timestamp → factory-local naive wall time.
 * `((col AT TIME ZONE <storageTz>) AT TIME ZONE <factoryTz>)`
 */
export function factoryLocalTsSql(col: SqlExpr): SQL {
  return sql`((${col} AT TIME ZONE ${tzLiteral(getDbStorageTimezone())}) AT TIME ZONE ${tzLiteral(getFactoryTimezone())})`;
}

/** Factory-local calendar date: `CAST(<local ts> AS DATE)`. */
export function factoryDateSql(col: SqlExpr): SQL {
  return sql`CAST(${factoryLocalTsSql(col)} AS DATE)`;
}

/** Factory-local day as text 'YYYY-MM-DD' (stable wire format for charts). */
export function factoryDayTextSql(col: SqlExpr): SQL {
  return sql`TO_CHAR(${factoryLocalTsSql(col)}, 'YYYY-MM-DD')`;
}

/** Factory-local hour bucket as text 'YYYY-MM-DD HH24:00'. */
export function factoryHourTextSql(col: SqlExpr): SQL {
  return sql`TO_CHAR(${factoryLocalTsSql(col)}, 'YYYY-MM-DD HH24:00')`;
}

const DATE_TRUNC_UNITS = new Set(["minute", "hour", "day", "week", "month", "quarter", "year"]);

/** Factory-local `date_trunc('<unit>', <local ts>)`. Unit is whitelisted. */
export function factoryDateTruncSql(unit: string, col: SqlExpr): SQL {
  if (!DATE_TRUNC_UNITS.has(unit)) throw new Error(`Unsupported date_trunc unit: ${unit}`);
  return sql`date_trunc(${sql.raw(`'${unit}'`)}, ${factoryLocalTsSql(col)})`;
}

/** Factory-local hour of day (0-23) — use for shift classification. */
export function factoryHourOfDaySql(col: SqlExpr): SQL {
  return sql`EXTRACT(HOUR FROM ${factoryLocalTsSql(col)})`;
}

/** Factory-local day of week (0=Sunday..6, PostgreSQL DOW). */
export function factoryDowSql(col: SqlExpr): SQL {
  return sql`EXTRACT(DOW FROM ${factoryLocalTsSql(col)})`;
}

// ═══════════════════════════════════════════════════════════════════════
// SQL fragment builders — canonical yield / FPY
// (FINAL_YIELD_PASS_RESULTS is pure TS — imported/re-exported from
// @shared/kpiYield above, not redefined here.)
// ═══════════════════════════════════════════════════════════════════════

/** `resultCol IN ('OK', 'NTF')` — the canonical final-yield pass condition. */
export function finalYieldPassCondSql(resultCol: SqlExpr): SQL {
  return sql`${resultCol} IN ('OK', 'NTF')`;
}

/**
 * Canonical final-yield percentage aggregate:
 * `ROUND(SUM(CASE WHEN result IN ('OK','NTF') THEN 1 ELSE 0 END) * 100.0
 *        / NULLIF(<countExpr>, 0), <digits>)`
 * `countExpr` defaults to COUNT(*); pass e.g. sql`COUNT(mr.id)` under
 * LEFT JOINs so NULL rows are not counted.
 */
export function finalYieldPctSql(
  resultCol: SqlExpr,
  opts: { countExpr?: SQL; digits?: number } = {},
): SQL {
  const countExpr = opts.countExpr ?? sql`COUNT(*)`;
  const digits = sql.raw(String(Math.max(0, Math.min(6, opts.digits ?? 2))));
  return sql`ROUND(SUM(CASE WHEN ${finalYieldPassCondSql(resultCol)} THEN 1 ELSE 0 END) * 100.0 / NULLIF(${countExpr}, 0), ${digits})`;
}

/**
 * Subquery selecting the FIRST inspection per serial (per machine when
 * `perMachine`), projected as:
 *   machine_id, result [, bucket]
 * See the FPY definition/limitations in the module docblock.
 * `where` receives normal drizzle conditions on product_inspections.
 * `bucketExpr` (optional) is any expression over product_inspections
 * columns (e.g. a factory*Sql fragment) projected as `bucket` — the
 * bucket/shift a board belongs to is that of its FIRST inspection.
 */
export function firstInspectionsSql(opts: {
  where?: SQL;
  bucketExpr?: SQL;
  perMachine?: boolean;
} = {}): SQL {
  const partition = opts.perMachine
    ? sql`${productInspections.machineId}, ${productInspections.serialNumber}`
    : sql`${productInspections.serialNumber}`;
  const serialUsable = sql`${productInspections.serialNumber} <> ''`;
  const where = opts.where ? sql`(${opts.where}) AND ${serialUsable}` : serialUsable;
  const bucket = opts.bucketExpr ? sql`, ${opts.bucketExpr} AS bucket` : sql``;
  return sql`SELECT DISTINCT ON (${partition}) ${productInspections.machineId} AS machine_id, ${productInspections.overallResult} AS result${bucket} FROM ${productInspections} WHERE ${where} ORDER BY ${partition}, ${productInspections.inspectionTime} ASC, ${productInspections.id} ASC`;
}

/**
 * Aggregate over first inspections:
 *   { first_total, first_pass } (both int) — optionally grouped.
 * groupBy: "none" (overall), "machine" (GROUP BY machine_id) or
 * "bucket" (GROUP BY the projected bucket expression).
 */
export function fpyAggregateSql(opts: {
  where?: SQL;
  bucketExpr?: SQL;
  groupBy?: "none" | "machine" | "bucket";
} = {}): SQL {
  const groupBy = opts.groupBy ?? "none";
  const firsts = firstInspectionsSql({
    where: opts.where,
    bucketExpr: opts.bucketExpr,
    perMachine: groupBy === "machine",
  });
  const agg = sql`COUNT(*)::int AS first_total, COUNT(*) FILTER (WHERE result = 'OK')::int AS first_pass`;
  if (groupBy === "machine") {
    return sql`SELECT machine_id, ${agg} FROM (${firsts}) AS firsts GROUP BY machine_id`;
  }
  if (groupBy === "bucket") {
    return sql`SELECT bucket, ${agg} FROM (${firsts}) AS firsts GROUP BY bucket`;
  }
  return sql`SELECT ${agg} FROM (${firsts}) AS firsts`;
}

// ═══════════════════════════════════════════════════════════════════════
// Pure TS math — the same formulas the SQL fragments implement
// ═══════════════════════════════════════════════════════════════════════

/** Round a percentage to `digits` decimals (default 2). */
export function roundPct(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

// finalYield / fpyFromFirstInspections moved to @shared/kpiYield (Task 15)
// and re-exported near the top of this file — not redefined here.

/**
 * CANONICAL DPMO. `opportunities` = measurement points evaluated (NOT
 * boards) — components×joints modelling deferred to gap M12 (see module
 * docblock). Unrounded.
 */
export function dpmo(counts: { defects: number; opportunities: number }): number {
  const { defects, opportunities } = counts;
  if (!(opportunities > 0)) return 0;
  const rate = Math.max(0, Math.min(1, defects / opportunities));
  return rate * 1_000_000;
}

/**
 * Inverse standard normal CDF (probit) via Acklam's rational approximation.
 * Returns z such that P(Z <= z) = p. (Moved here from spc.ts so the sigma
 * math has a single home; spc.ts re-exports it for back-compat.)
 */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/**
 * Sigma level from a DPMO value, 1.5σ shift convention.
 * Perfect quality (dpmo <= 0) capped at 6σ; total failure → 0.
 */
export function sigmaLevelFromDpmo(dpmoValue: number): number {
  const defectRate = dpmoValue / 1_000_000;
  if (defectRate <= 0) return 6;
  if (defectRate >= 1) return 0;
  return normInv(1 - defectRate) + 1.5;
}

/**
 * Six Sigma bundle from defect counts.
 * `units` = inspected samples; `opportunitiesPerUnit` = measurement points
 * evaluated per unit (default 1 — a single-point analysis where each
 * sample IS one opportunity). DPMO uses units × opportunitiesPerUnit.
 */
export function sixSigmaFromCounts(counts: {
  defects: number;
  units: number;
  opportunitiesPerUnit?: number;
}): { dpmo: number; sigmaLevel: number; yieldPercent: number; defectRate: number } {
  const oppPerUnit = counts.opportunitiesPerUnit ?? 1;
  const opportunities = counts.units * oppPerUnit;
  if (!(opportunities > 0)) return { dpmo: 0, sigmaLevel: 0, yieldPercent: 100, defectRate: 0 };
  const d = dpmo({ defects: counts.defects, opportunities });
  const defectRate = d / 1_000_000;
  return {
    dpmo: Math.round(d),
    sigmaLevel: Math.round(sigmaLevelFromDpmo(d) * 100) / 100,
    yieldPercent: Math.round((1 - defectRate) * 100 * 100) / 100,
    defectRate,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Row helpers for db.execute results (postgres-js returns arrays; some
// drivers wrap in { rows }). Shared so FPY call sites stay tiny.
// ═══════════════════════════════════════════════════════════════════════

export function executeRows(result: unknown): any[] {
  return ((result as any)?.rows ?? result ?? []) as any[];
}
