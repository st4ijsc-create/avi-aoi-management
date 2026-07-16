/**
 * Point Result Evaluator — doc 31 Đợt E (MP6 / decision #2).
 *
 * Historically the AOI/AVI ingest path TRUSTED the machine's per-point verdict
 * (`measurement.result`) verbatim and NEVER looked at the point def's stored
 * limits. That made the rich 3D/solder/xray/position limit columns
 * (heightMin/Max, volumeMin/Max, coplanarityMax, voidPctMax, tiltMax, …) and the
 * `criteria` jsonb dead — they were authored but never gated a result.
 *
 * This module is the missing CONSUMER. Given a point def's limits + criteria and
 * the incoming measured values, it decides whether any configured spec is
 * violated. It is:
 *   • PURE — no DB, no I/O, never throws.
 *   • MONOTONIC — it can only DOWNGRADE a machine "OK" to "NG" (when a configured
 *     limit is actually violated). It NEVER upgrades NG→OK and NEVER touches NTF
 *     (a human disposition). So the machine stays authoritative for failures; the
 *     server only adds failures the machine's own limits imply.
 *   • CONSERVATIVE — a dimension is only judged when BOTH a limit is configured
 *     AND the corresponding value is present. Missing either ⇒ that dimension is
 *     skipped (not a violation).
 *
 * Wired into machineApiRouters.processInspectionSubmission (and reusable by the
 * AOI-ZIP path). Flag-gated by POINT_LIMIT_EVAL_ENABLED (default ON) so a site
 * can revert to pure machine-authoritative verdicts if needed.
 */

export type ResultVerdict = "OK" | "NG" | "NTF";

/** Limit-bearing fields read off a measurement_point_defs row (decimals as strings). */
export interface PointLimitSource {
  lowerLimit?: string | number | null;
  upperLimit?: string | number | null;
  heightMin?: string | number | null;
  heightMax?: string | number | null;
  areaMin?: string | number | null;
  areaMax?: string | number | null;
  volumeMin?: string | number | null;
  volumeMax?: string | number | null;
  coplanarityMax?: string | number | null;
  warpageMax?: string | number | null;
  voidPctMax?: string | number | null;
  offsetXMax?: string | number | null;
  offsetYMax?: string | number | null;
  tiltMax?: string | number | null;
  thicknessMin?: string | number | null;
  thicknessMax?: string | number | null;
  criteria?: unknown[] | null;
}

/** Measured values as they arrive on an ingest measurement element. */
export interface MeasurementValues {
  measuredValue?: string | number | null;
  measuredValueText?: string | null;
  valueZ?: string | number | null;
  valueHeight?: string | number | null;
  valueArea?: string | number | null;
  valueVolume?: string | number | null;
  valueVoidPct?: string | number | null;
  valueCoplanarity?: string | number | null;
  valueWarpage?: string | number | null;
  valueOffsetX?: string | number | null;
  valueOffsetY?: string | number | null;
  valueTilt?: string | number | null;
  valueThickness?: string | number | null;
}

export interface PointEvalResult {
  /** The final verdict after applying configured limits (monotonic vs machine). */
  result: ResultVerdict;
  /** True when at least one dimension/criterion was actually judged. */
  evaluated: boolean;
  /** True when the server changed the machine verdict (OK → NG). */
  overridden: boolean;
  /** Human-readable violation reasons (empty when all judged dimensions passed). */
  violations: string[];
}

/** Feature flag — default ON so authored 3D limits actually gate results. */
export function isPointLimitEvalEnabled(): boolean {
  return (process.env.POINT_LIMIT_EVAL_ENABLED ?? "true").toLowerCase() !== "false";
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Canonical criteria metric → measurement value resolver. `criteria` items carry
 * a free-text `metric` name (see criteriaItemSchema in productRouters). We map a
 * documented set of canonical names to the measurement's value columns. Unknown
 * metrics resolve to `undefined` and are SKIPPED (never a violation) — documented
 * behaviour so criteria on data we don't carry can't fail a good board.
 */
function resolveMetricNumeric(metric: string, m: MeasurementValues): number | null | undefined {
  const key = metric.trim().toLowerCase().replace(/[\s_-]/g, "");
  switch (key) {
    case "value":
    case "measuredvalue":
    case "measurement":
      return toNum(m.measuredValue);
    case "z":
    case "positionz":
    case "valuez":
      return toNum(m.valueZ);
    case "height":
    case "valueheight":
    case "solderheight":
      return toNum(m.valueHeight);
    case "area":
    case "valuearea":
      return toNum(m.valueArea);
    case "volume":
    case "valuevolume":
    case "soldervolume":
      return toNum(m.valueVolume);
    case "void":
    case "voidpct":
    case "voidpercent":
    case "valuevoidpct":
      return toNum(m.valueVoidPct);
    case "coplanarity":
    case "valuecoplanarity":
      return toNum(m.valueCoplanarity);
    case "warpage":
    case "valuewarpage":
      return toNum(m.valueWarpage);
    case "offsetx":
    case "valueoffsetx":
      return toNum(m.valueOffsetX);
    case "offsety":
    case "valueoffsety":
      return toNum(m.valueOffsetY);
    case "tilt":
    case "valuetilt":
      return toNum(m.valueTilt);
    case "thickness":
    case "valuethickness":
      return toNum(m.valueThickness);
    default:
      return undefined; // unknown metric — skip
  }
}

function resolveMetricText(metric: string, m: MeasurementValues): string | undefined {
  const key = metric.trim().toLowerCase().replace(/[\s_-]/g, "");
  if (key === "value" || key === "measuredvalue" || key === "text" || key === "measuredvaluetext") {
    if (m.measuredValueText != null) return String(m.measuredValueText);
    if (m.measuredValue != null) return String(m.measuredValue);
    return undefined;
  }
  const n = resolveMetricNumeric(metric, m);
  return n == null ? undefined : String(n);
}

function resolveMetricBoolean(metric: string, m: MeasurementValues): boolean | undefined {
  const text = resolveMetricText(metric, m);
  if (text === undefined) return undefined;
  const t = text.trim().toLowerCase();
  if (["true", "1", "ok", "pass", "yes", "present"].includes(t)) return true;
  if (["false", "0", "ng", "fail", "no", "absent"].includes(t)) return false;
  const n = Number(t);
  if (Number.isFinite(n)) return n !== 0;
  return undefined;
}

interface CriteriaItem {
  kind: "numeric_range" | "boolean_check" | "text_match";
  metric: string;
  min?: string | number;
  max?: string | number;
  expected?: boolean | string;
  mode?: "exact" | "contains" | "regex";
}

function evaluateCriterion(c: CriteriaItem, m: MeasurementValues): string | null {
  if (!c || typeof c !== "object" || !c.metric) return null;
  if (c.kind === "numeric_range") {
    const v = resolveMetricNumeric(c.metric, m);
    if (v === undefined || v === null) return null; // metric not carried — skip
    const min = toNum(c.min);
    const max = toNum(c.max);
    if (min !== null && v < min) return `criteria:${c.metric} ${v} < ${min}`;
    if (max !== null && v > max) return `criteria:${c.metric} ${v} > ${max}`;
    return null;
  }
  if (c.kind === "boolean_check") {
    const v = resolveMetricBoolean(c.metric, m);
    if (v === undefined) return null;
    if (typeof c.expected === "boolean" && v !== c.expected) {
      return `criteria:${c.metric} expected ${c.expected} got ${v}`;
    }
    return null;
  }
  if (c.kind === "text_match") {
    const v = resolveMetricText(c.metric, m);
    if (v === undefined) return null;
    const expected = String(c.expected ?? "");
    const mode = c.mode ?? "exact";
    let ok = true;
    if (mode === "exact") ok = v === expected;
    else if (mode === "contains") ok = v.includes(expected);
    else if (mode === "regex") {
      try {
        ok = new RegExp(expected).test(v);
      } catch {
        ok = true; // invalid pattern — do not fail a good board on a config typo
      }
    }
    if (!ok) return `criteria:${c.metric} "${v}" !~ ${mode}("${expected}")`;
    return null;
  }
  return null;
}

/** One [value, min, max] range check → violation string or null. */
function checkRange(
  label: string,
  value: number | null,
  min: number | null,
  max: number | null,
): string | null {
  if (value === null) return null;
  if (min !== null && value < min) return `${label} ${value} < min ${min}`;
  if (max !== null && value > max) return `${label} ${value} > max ${max}`;
  return null;
}

/**
 * Evaluate a single point's measurement against its configured limits + criteria.
 * `machineResult` is the verdict the machine reported. The returned `result` is
 * that verdict unless it was "OK" and a configured spec was violated (→ "NG").
 */
export function evaluatePointResult(
  def: PointLimitSource,
  m: MeasurementValues,
  machineResult: ResultVerdict,
): PointEvalResult {
  const violations: string[] = [];
  let evaluated = false;

  const judge = (label: string, value: number | null, min: number | null, max: number | null) => {
    if (value === null) return;
    if (min === null && max === null) return;
    evaluated = true;
    const v = checkRange(label, value, min, max);
    if (v) violations.push(v);
  };

  // 1D dimensional / electrical spec (measuredValue vs LSL/USL).
  judge("value", toNum(m.measuredValue), toNum(def.lowerLimit), toNum(def.upperLimit));
  // 3D / solder / SPI ranges.
  judge("height", toNum(m.valueHeight), toNum(def.heightMin), toNum(def.heightMax));
  judge("area", toNum(m.valueArea), toNum(def.areaMin), toNum(def.areaMax));
  judge("volume", toNum(m.valueVolume), toNum(def.volumeMin), toNum(def.volumeMax));
  judge("thickness", toNum(m.valueThickness), toNum(def.thicknessMin), toNum(def.thicknessMax));
  // Max-only ceilings (xray / position).
  judge("coplanarity", toNum(m.valueCoplanarity), null, toNum(def.coplanarityMax));
  judge("warpage", toNum(m.valueWarpage), null, toNum(def.warpageMax));
  judge("voidPct", toNum(m.valueVoidPct), null, toNum(def.voidPctMax));
  judge("offsetX", toNum(m.valueOffsetX), null, toNum(def.offsetXMax));
  judge("offsetY", toNum(m.valueOffsetY), null, toNum(def.offsetYMax));
  judge("tilt", toNum(m.valueTilt), null, toNum(def.tiltMax));

  // Structured `criteria` jsonb.
  if (Array.isArray(def.criteria)) {
    for (const raw of def.criteria) {
      const c = raw as CriteriaItem;
      if (c && typeof c === "object" && c.kind && c.metric) {
        const value = c.kind === "numeric_range"
          ? resolveMetricNumeric(c.metric, m)
          : c.kind === "boolean_check"
            ? resolveMetricBoolean(c.metric, m)
            : resolveMetricText(c.metric, m);
        if (value !== undefined && value !== null) evaluated = true;
        const v = evaluateCriterion(c, m);
        if (v) violations.push(v);
      }
    }
  }

  // Monotonic application: only an OK can be downgraded.
  let result = machineResult;
  let overridden = false;
  if (machineResult === "OK" && violations.length > 0) {
    result = "NG";
    overridden = true;
  }

  return { result, evaluated, overridden, violations };
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P1 (QĐ#2) — SPEC-GATE BY THE CONFIG SNAPSHOT, not by LIVE limits.
//
// THE SPLIT-BRAIN this addresses: `evaluatePointResult` above is fed the point
// def resolved LIVE from the DB — i.e. the limits AS THEY ARE NOW. But a board
// may have been graded by the machine under an OLDER recipe (it declares
// pointsConfigVersion=V, the product has since moved to a newer version) and
// then buffered / retried / re-graded. Gating that board against the CURRENT
// (often tightened) limits retro-fails boards the machine legitimately passed —
// the server's OK/NG stops reflecting the config the board was actually measured
// under.
//
// ⚠ HONEST LIMITATION (documented, by design of the existing schema):
//   `measurement_point_versions` records a PER-POINT edit history (its `version`
//   is a per-point counter) with a `changedAt` timestamp. It does NOT record the
//   product's `pointsConfigVersion` at each edit, so there is NO stored mapping
//   from a declared product-version V to an exact snapshot. A precise "limits at
//   product-version V" reconstruction would need a schema change (record the
//   product version on each snapshot row, or a product-config-version history
//   table) — OUT OF THIS ZONE; see the P1 report.
//
//   What we CAN do without a schema change: reconstruct the limits that were
//   LIVE at a given INSTANT from the per-point edit history, and use the board's
//   server-received instant as that anchor. This closes the most common and most
//   damaging case — a limit TIGHTENED after a board was measured (board still in
//   flight / buffered / being re-graded) — because that edit's snapshot carries a
//   `changedAt` AFTER the board's instant. When the history cannot confirm the
//   older limits (no snapshot at/after the board's instant), we return `null` so
//   the caller SKIPS the gate for that point (safe: the machine's verdict stands)
//   rather than silently gating a stale board against newer limits.
// ════════════════════════════════════════════════════════════════════════════

/** One edit-history row: the point's state BEFORE the edit + when it was replaced. */
export interface PointLimitSnapshot {
  /**
   * measurement_point_versions.changedAt — the instant this snapshot's state was
   * OVERWRITTEN by an edit. The snapshot therefore holds the limits that were
   * LIVE up TO this instant.
   */
  changedAt: Date;
  /** The point def's previous state (measurement_point_versions.snapshotJson). */
  limits: PointLimitSource;
}

export type SnapshotGateBasis = "snapshot" | "missing";

export interface SnapshotGateResolution {
  /** Limits to gate with, or `null` when the caller MUST skip the gate (basis "missing"). */
  limits: PointLimitSource | null;
  basis: SnapshotGateBasis;
}

/**
 * Reconstruct the limit-bearing config that was LIVE at `atInstant` for ONE point
 * from its ordered edit-snapshot history.
 *
 * Rule: the limits live at instant t = the snapshotJson of the EARLIEST snapshot
 * whose `changedAt >= t` (that snapshot is precisely the state that was live up to
 * that edit). If NO snapshot exists at/after t — the point was never edited, or
 * every edit predates the board — we CANNOT prove the board's older limits differ
 * from live, and we refuse to gate a stale board against limits that may be newer
 * than the era it was measured in. Return `null` ⇒ caller skips the gate.
 *
 * Pure — no DB, never throws. `snapshots` may be in any order.
 */
export function resolveLimitsAtInstant(
  snapshots: PointLimitSnapshot[],
  atInstant: Date,
): SnapshotGateResolution {
  if (!Array.isArray(snapshots) || snapshots.length === 0) {
    return { limits: null, basis: "missing" };
  }
  const t = atInstant.getTime();
  if (!Number.isFinite(t)) return { limits: null, basis: "missing" };

  let best: PointLimitSnapshot | null = null;
  for (const s of snapshots) {
    if (!s || !(s.changedAt instanceof Date)) continue;
    const c = s.changedAt.getTime();
    if (!Number.isFinite(c)) continue;
    if (c >= t && (best === null || c < best.changedAt.getTime())) {
      best = s;
    }
  }
  if (best === null) return { limits: null, basis: "missing" };
  return { limits: best.limits ?? {}, basis: "snapshot" };
}
