/**
 * shared/kpiYield.ts — CANONICAL final-yield / FPY math (pure TS, no
 * server-only deps: no drizzle, no `SQL`).
 *
 * Moved out of server/utils/kpi.ts (Task 15, doc 27 decision #4 origin) so
 * `client/src` has ONE place to import the formula from instead of
 * hand-rolling `(ok+ntf)/total*100` on every screen. server/utils/kpi.ts
 * re-exports these two functions (and the constant) from here — it remains
 * the canonical home for everything server-only: the SQL fragment builders
 * (`finalYieldPctSql`, `firstInspectionsSql`, `fpyAggregateSql`, ...) and
 * the factory-timezone bucketing helpers, none of which are duplicated
 * here. See server/utils/kpi.ts's module docblock for the full canonical
 * definitions (decision #4) and the honest FPY limitations.
 *
 * FINAL YIELD  = (OK + NTF) / total inspections. NTF ("no trouble found")
 *   counts as PASS in the final yield, per SMT convention.
 * FPY (true First Pass Yield) = first inspections that passed / first
 *   inspections. NTF is NOT a first pass — do not use finalYield() for FPY.
 */

/** Kết quả được tính là PASS trong FINAL yield (quyết định #4: OK + NTF). */
export const FINAL_YIELD_PASS_RESULTS = ["OK", "NTF"] as const;

/**
 * CANONICAL final yield %, decision #4: NTF counts as PASS.
 * finalYield({ok: 90, ntf: 5, total: 100}) === 95.
 * Unrounded — callers round for display (roundPct).
 */
export function finalYield(counts: { ok: number; ntf: number; total: number }): number {
  const { ok, ntf, total } = counts;
  if (!(total > 0)) return 0;
  return ((ok + ntf) / total) * 100;
}

/**
 * CANONICAL true First Pass Yield % from first-inspection counts.
 * `firstPass` = first inspections with overallResult = 'OK' (NTF is NOT a
 * first pass); `firstTotal` = distinct serials (first inspections).
 * Unrounded.
 */
export function fpyFromFirstInspections(counts: { firstPass: number; firstTotal: number }): number {
  const { firstPass, firstTotal } = counts;
  if (!(firstTotal > 0)) return 0;
  return (firstPass / firstTotal) * 100;
}
