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
  /**
   * Doc 51 P2 (CASE #11) — the ENGINEERING unit the point def's limits are
   * expressed in (measurement_point_defs.unit, e.g. "mm"). The gate below only
   * compares `measuredValue` against lowerLimit/upperLimit AFTER the measured
   * value has been converted into THIS unit (see evaluatePointResult opts).
   * Absent/empty ⇒ no target unit known ⇒ the value is gated as-received (exact
   * legacy behaviour — no machine sends a unit today).
   */
  unit?: string | null;
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
  /**
   * Doc 51 P2 (CASE #11) — the unit the MACHINE measured `measuredValue` in
   * (e.g. "mil"). When it differs from the point def's unit, `measuredValue` is
   * converted to the def's unit BEFORE the spec gate so a mil-vs-mm mismatch
   * cannot silently downgrade a good board to NG. Absent ⇒ no conversion.
   */
  unit?: string | null;
  /**
   * Optional explicit scale factor from the machine's unit to the canonical unit
   * (mm for lengths). Overrides the built-in unit table for `unit` — lets a
   * machine emitting a non-standard/custom unit still be converted correctly.
   */
  unitScaleToCanonical?: string | number | null;
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
  /**
   * Doc 51 P2 (CASE #11) — the measured value carried a unit that could NOT be
   * reconciled with the point def's unit (different dimensions, or an unknown
   * unit with no explicit scale), so the 1D `value` spec gate was SKIPPED for
   * this point (never silently NG). The caller surfaces this as telemetry.
   */
  unitMismatch: boolean;
}

/** Feature flag — convert `measuredValue` into the point def's unit before the
 *  1D spec gate. Default ON: it is inert for every machine that does not send a
 *  `unit` (i.e. the entire installed base today), and only ever CORRECTS a gate
 *  for a machine that opts into declaring units, so ON is backward-compatible. */
export function isUnitConvertEnabled(): boolean {
  return (process.env.INGEST_UNIT_CONVERT_ENABLED ?? "true").toLowerCase() !== "false";
}

/**
 * Doc 51 P2 (CASE #11) — LENGTH unit → millimetres (the canonical length unit).
 * Returns null for an unknown unit (⇒ not convertible via the table). Only LENGTH
 * units live here on purpose: converting across dimensions (e.g. a volume unit to
 * mm) is a category error the gate must REFUSE, not fudge.
 */
export function lengthUnitToMm(unit: string | null | undefined): number | null {
  if (unit == null) return null;
  const u = String(unit).trim().toLowerCase().replace(/[\s.]/g, "");
  switch (u) {
    case "mm":
    case "millimeter":
    case "millimetre":
    case "millimeters":
    case "millimetres":
      return 1;
    case "mil":
    case "mils":
    case "thou":
      return 0.0254; // 1 mil = 1/1000 inch
    case "micron":
    case "microns":
    case "um":
    case "µm":
    case "μm":
    case "micrometer":
    case "micrometre":
      return 0.001;
    case "nm":
    case "nanometer":
    case "nanometre":
      return 0.000001;
    case "cm":
    case "centimeter":
    case "centimetre":
      return 10;
    case "m":
    case "meter":
    case "metre":
      return 1000;
    case "in":
    case "inch":
    case "inches":
    case "\"":
      return 25.4;
    default:
      return null;
  }
}

/** Normalised (trimmed/lowercased) unit token, or "" when absent. */
function normUnit(u: string | null | undefined): string {
  return u == null ? "" : String(u).trim().toLowerCase();
}

export interface UnitConversion {
  /** measuredValue expressed in the point def's unit, or null when skipped. */
  value: number | null;
  /** true ⇒ units differ but could not be reconciled → caller SKIPS the value gate. */
  mismatch: boolean;
}

/**
 * Doc 51 P2 (CASE #11) — express `value` (measured in `m.unit`) in the point
 * def's `def.unit`. Rules:
 *   • either unit absent, or the two are the SAME token ⇒ no conversion (gate as-is).
 *   • both LENGTH units (or an explicit unitScaleToCanonical) ⇒ convert.
 *   • otherwise (different dimension / unknown unit, no explicit scale) ⇒ REFUSE:
 *     return mismatch=true so the caller skips the 1D gate instead of comparing
 *     raw-vs-raw and downgrading a good board to NG.
 * Pure — never throws.
 */
export function convertMeasuredValueToDefUnit(
  value: number,
  m: MeasurementValues,
  def: PointLimitSource,
): UnitConversion {
  const mu = normUnit(m.unit);
  const du = normUnit(def.unit);
  if (mu === "" || du === "" || mu === du) return { value, mismatch: false };
  const explicit = toNum(m.unitScaleToCanonical);
  const fromCanon = explicit !== null && explicit > 0 ? explicit : lengthUnitToMm(mu);
  const toCanon = lengthUnitToMm(du);
  if (fromCanon == null || toCanon == null || toCanon === 0) {
    return { value: null, mismatch: true };
  }
  return { value: (value * fromCanon) / toCanon, mismatch: false };
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
  opts?: { convertUnits?: boolean },
): PointEvalResult {
  const violations: string[] = [];
  let evaluated = false;
  let unitMismatch = false;

  const judge = (label: string, value: number | null, min: number | null, max: number | null) => {
    if (value === null) return;
    if (min === null && max === null) return;
    evaluated = true;
    const v = checkRange(label, value, min, max);
    if (v) violations.push(v);
  };

  // 1D dimensional / electrical spec (measuredValue vs LSL/USL).
  // Doc 51 P2 (CASE #11) — reconcile the measured unit with the def's unit first.
  // When they cannot be reconciled we SKIP this gate (unitMismatch) rather than
  // compare a mil reading against an mm limit and downgrade a good board.
  let valueForGate = toNum(m.measuredValue);
  if (opts?.convertUnits && valueForGate !== null) {
    const conv = convertMeasuredValueToDefUnit(valueForGate, m, def);
    if (conv.mismatch) {
      unitMismatch = true;
      valueForGate = null; // do NOT gate this point on incomparable units
    } else {
      valueForGate = conv.value;
    }
  }
  judge("value", valueForGate, toNum(def.lowerLimit), toNum(def.upperLimit));
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

  return { result, evaluated, overridden, violations, unitMismatch };
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
  /**
   * Doc 51 P2 batch-2 (§12.2 #2, migration 0282) — the product's pointsConfigVersion
   * that `limits` were live UNDER (the last product version before the edit that
   * created this snapshot bumped it +1). Enables VERSION-EXACT reconstruction:
   * gate a board declaring version V with the snapshot whose stamp is the smallest
   * value >= V. NULL/absent (legacy rows, or 0282 not applied) ⇒ this snapshot is
   * invisible to the version path and the caller falls back to the instant path.
   */
  productPointsConfigVersion?: number | null;
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

// ════════════════════════════════════════════════════════════════════════════
// Doc 51 P2 batch-2 (§12.2 #2) — VERSION-EXACT reconstruction (completes QĐ#2).
//
// P1 (resolveLimitsAtInstant) anchors on the board's server-received INSTANT
// because measurement_point_versions had no product-version mapping. Migration
// 0282 adds `productPointsConfigVersion` to each snapshot (the product version the
// pre-edit limits were live UNDER), so we can now gate a board by the EXACT config
// version the machine declared, not by an instant proxy.
//
// THE PICK (mirror of the instant rule, in version space):
//   Each stamped snapshot holds the limits live UP TO its stamp `s` (they were
//   replaced when the product moved to s+1). A board declaring version V used the
//   limits whose covering snapshot is the one with the SMALLEST stamp s >= V.
//     • found            → gate by that snapshot's limits            (basis "version").
//     • stamped exist but none >= V → the point was NOT edited since V, so its LIVE
//       limits ARE the V-era limits → gate by live                  (basis "live").
//     • no stamped snapshots at all (legacy/unmigrated data)        → fall back to the
//       instant reconstruction (basis "instant"/"missing" from resolveLimitsAtInstant).
//
// Pure — no DB, never throws.
// ════════════════════════════════════════════════════════════════════════════

export type GateLimitBasis = "version" | "live" | "instant" | "missing";

export interface GateLimitResolution {
  /** Limits to gate with, or `null` when the caller MUST skip the gate (basis "missing"). */
  limits: PointLimitSource | null;
  basis: GateLimitBasis;
}

/**
 * Resolve the limits to spec-gate a board with, preferring VERSION-EXACT (0282)
 * over the instant proxy (P1) and falling back safely when neither can confirm an
 * older config.
 */
export function resolveGateLimitsForBoard(args: {
  snapshots: PointLimitSnapshot[];
  /** The point def's CURRENT (live) limits — used when the point is unchanged since V. */
  liveLimits: PointLimitSource;
  /** The machine-declared product pointsConfigVersion, or null when unknown. */
  declaredVersion?: number | null;
  /** The board's server-received instant — the P1 fallback anchor. */
  atInstant: Date;
}): GateLimitResolution {
  const { snapshots, liveLimits, declaredVersion, atInstant } = args;

  // VERSION path — only when we know the declared version AND at least one snapshot
  // carries a 0282 stamp (otherwise this point's history predates the provenance).
  if (declaredVersion != null && Number.isFinite(declaredVersion) && Array.isArray(snapshots)) {
    const stamped = snapshots.filter(
      (s): s is PointLimitSnapshot & { productPointsConfigVersion: number } =>
        !!s && typeof s.productPointsConfigVersion === "number" && Number.isFinite(s.productPointsConfigVersion),
    );
    if (stamped.length > 0) {
      let best: (PointLimitSnapshot & { productPointsConfigVersion: number }) | null = null;
      for (const s of stamped) {
        const v = s.productPointsConfigVersion;
        if (v >= declaredVersion && (best === null || v < best.productPointsConfigVersion)) {
          best = s;
        }
      }
      if (best !== null) return { limits: best.limits ?? {}, basis: "version" };
      // Stamped snapshots exist but none covers V ⇒ the point has not been edited
      // since version V ⇒ its live limits ARE the limits it had at V.
      return { limits: liveLimits, basis: "live" };
    }
  }

  // FALLBACK — instant-based reconstruction (P1). Unchanged behaviour.
  const inst = resolveLimitsAtInstant(snapshots, atInstant);
  return { limits: inst.limits, basis: inst.basis === "snapshot" ? "instant" : "missing" };
}
