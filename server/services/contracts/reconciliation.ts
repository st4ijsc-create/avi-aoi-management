/**
 * Reconciliation engine — SYNAPSE §5.9.2 "đối soát" (doc 33 §3.5 / F7 · H5).
 *
 * Enterprise integration must reconcile daily — production vs MES, consumption vs ERP, line
 * inventory vs WMS — and raise an investigation ticket on drift instead of silently "self-
 * healing" (SDD §5.9.2). This is the pure comparison engine + report model; the daily cron and
 * the real data sources (MES/ERP/WMS adapters) wire on top later.
 */

export interface ReconcileInput {
  /** Metric name → value from OUR system (SYNAPSE). */
  internal: Record<string, number>;
  /** Metric name → value from the external system of record (MES/ERP/WMS). */
  external: Record<string, number>;
  /** Absolute tolerance per metric (default 0 = exact). */
  toleranceAbs?: number;
  /** Relative tolerance (fraction, e.g. 0.01 = 1%). Applied as max(abs, rel*expected). */
  toleranceRel?: number;
}

export interface Discrepancy {
  key: string;
  internal: number | null;
  external: number | null;
  delta: number | null;
  withinTolerance: boolean;
  reason: "match" | "over-tolerance" | "missing-internal" | "missing-external";
}

export interface ReconciliationReport {
  ok: boolean;
  checked: number;
  discrepancies: Discrepancy[];
  /** Only the out-of-tolerance ones → an investigation ticket per each (never auto-fix). */
  tickets: Discrepancy[];
}

/** Reconcile two metric maps. Pure. */
export function reconcile(input: ReconcileInput): ReconciliationReport {
  const tolAbs = input.toleranceAbs ?? 0;
  const tolRel = input.toleranceRel ?? 0;
  const keys = new Set([...Object.keys(input.internal), ...Object.keys(input.external)]);
  const discrepancies: Discrepancy[] = [];

  for (const key of [...keys].sort()) {
    const hasI = key in input.internal;
    const hasE = key in input.external;
    const iv = hasI ? input.internal[key] : null;
    const ev = hasE ? input.external[key] : null;

    if (!hasI) {
      discrepancies.push({ key, internal: null, external: ev, delta: null, withinTolerance: false, reason: "missing-internal" });
      continue;
    }
    if (!hasE) {
      discrepancies.push({ key, internal: iv, external: null, delta: null, withinTolerance: false, reason: "missing-external" });
      continue;
    }
    const delta = (iv as number) - (ev as number);
    const tol = Math.max(tolAbs, tolRel * Math.abs(ev as number));
    const within = Math.abs(delta) <= tol;
    discrepancies.push({
      key,
      internal: iv,
      external: ev,
      delta,
      withinTolerance: within,
      reason: within ? "match" : "over-tolerance",
    });
  }

  const tickets = discrepancies.filter((d) => !d.withinTolerance);
  return { ok: tickets.length === 0, checked: discrepancies.length, discrepancies, tickets };
}
