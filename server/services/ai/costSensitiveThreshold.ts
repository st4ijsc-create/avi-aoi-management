/**
 * W5-B1 (doc 44, gap G4.15) — COST-SENSITIVE / RISK-BASED DECISION THRESHOLD.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SYNAPSE LDS-L4 §8.2 ("Chất lượng bằng thị giác"):
 *   "Ngưỡng theo rủi ro: ưu tiên độ nhạy (không bỏ sót lỗi) hơn độ chính xác
 *    tuyệt đối; lỗi nghi ngờ → đẩy sang người."
 *
 * A single fixed confidence cutoff treats a hairline CRACK the same as a cosmetic
 * scratch. That is wrong when the COST of missing a defect scales with its
 * severity. This module turns the triage cutoff into a Bayes-risk decision:
 * for a severe class we are willing to flag / review at a LOWER defect
 * probability (higher recall), for a benign class at a higher one.
 *
 * PURE + deterministic (no I/O, no Date) → fully unit-testable. The flag
 * COST_SENSITIVE_THRESHOLD_ENABLED (default OFF) is read ONLY by the wiring in
 * the caller (aiQualityGate.processQualityGate); this module never changes
 * behaviour on its own and, by contract, only ever makes a verdict MORE
 * conservative (recall-first) — it never downgrades a defect to OK.
 *
 * WHY THE THRESHOLD MOVES WITH SEVERITY
 *   Balancing the expected cost of PASS (miss) vs FLAG (false call):
 *     p·fn·s = (1−p)·fp   ⇒   p* = fp / (fn·s + fp)
 *   Larger severity s ⇒ smaller p* ⇒ we cross into "flag/review" at a lower
 *   defect probability. That is exactly "hạ ngưỡng ưu tiên recall lớp nặng".
 * ════════════════════════════════════════════════════════════════════════════
 */

import { normalizeLabel } from "../aiMetrics";

// ─── Flag ────────────────────────────────────────────────────────────────────

/** Default OFF — integrating callers keep today's fixed-threshold behaviour. */
export function isCostSensitiveThresholdEnabled(): boolean {
  return String(process.env.COST_SENSITIVE_THRESHOLD_ENABLED ?? "false").toLowerCase() === "true"
    || process.env.COST_SENSITIVE_THRESHOLD_ENABLED === "1";
}

// ─── Types ───────────────────────────────────────────────────────────────────

/** Costs of the three triage outcomes (relative units; only ratios matter). */
export interface CostMatrix {
  /** Cost of MISSING a defect (declare OK while it is NG) — per unit severity. */
  falseNegative: number;
  /** Cost of a FALSE CALL (declare NG while it is OK). */
  falsePositive: number;
  /** Cost of routing to a human reviewer. */
  review: number;
}

/** label (any casing) → severity ≥ 0. Absent/0 ⇒ the label is not a defect class. */
export type SeverityMap = Record<string, number>;

export type CostAction = "flag" | "pass" | "review";

export interface CostThresholdDecision {
  action: CostAction;
  /** The dominant defect label driving the decision (normalized), or null when none. */
  label: string | null;
  /** Total probability mass on defect (severity-listed) labels. */
  defectProbability: number;
  /** Confidence-weighted severity of the plausible defect(s). */
  severity: number;
  /** Expected cost of each action (min wins). */
  expectedCost: Record<CostAction, number>;
  /** Severity-adjusted crossover probability p* = fp/(fn·s+fp) — the effective threshold. */
  effectiveThreshold: number;
  rationale: string;
}

export interface DecideThresholdOptions {
  /**
   * Deadband around the flag/pass crossover routed to a human instead of an
   * automated flag/pass (0..1 of probability). Default 0.15 → "lỗi nghi ngờ →
   * đẩy sang người". Set 0 to disable the review band (pure two-way decision).
   */
  reviewBand?: number;
}

// ─── Defaults (env-tunable, still pure once resolved) ────────────────────────

/**
 * Default cost matrix. fn ≫ fp encodes "a miss is far worse than a false call"
 * (recall-first). Overridable via COST_FN / COST_FP / COST_REVIEW.
 */
export function defaultCostMatrix(): CostMatrix {
  const fn = Number(process.env.COST_FN);
  const fp = Number(process.env.COST_FP);
  const rv = Number(process.env.COST_REVIEW);
  return {
    falseNegative: Number.isFinite(fn) && fn > 0 ? fn : 10,
    falsePositive: Number.isFinite(fp) && fp > 0 ? fp : 1,
    review: Number.isFinite(rv) && rv >= 0 ? rv : 2,
  };
}

/**
 * Build a severity map from the configured NG labels. Every NG label defaults to
 * severity 1; an optional JSON override in NTF_DEFECT_SEVERITY_MAP
 * ({"<label>": <severity>}) raises specific classes (e.g. {"crack":3}).
 * Matching is case/diacritic-insensitive via normalizeLabel.
 */
export function buildSeverityMap(ngLabels: string[], overrides?: SeverityMap): SeverityMap {
  const map: SeverityMap = {};
  for (const l of ngLabels) {
    const key = normalizeLabel(l);
    if (key) map[key] = 1;
  }
  const envOverrides = overrides ?? parseSeverityMapEnv();
  for (const [k, v] of Object.entries(envOverrides)) {
    const key = normalizeLabel(k);
    if (key && Number.isFinite(v) && v >= 0) map[key] = v;
  }
  return map;
}

/** Parse NTF_DEFECT_SEVERITY_MAP env JSON (best-effort; {} on any error). */
export function parseSeverityMapEnv(): SeverityMap {
  const raw = process.env.NTF_DEFECT_SEVERITY_MAP;
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const out: SeverityMap = {};
    for (const [k, v] of Object.entries(obj)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

// ─── Core pure decision ──────────────────────────────────────────────────────

/**
 * Cost-sensitive triage decision for one prediction distribution.
 *
 * @param probs       class distribution [{label, confidence}] (need not be sorted;
 *                    confidences need not sum to 1 — defect mass is taken as-is).
 * @param costMatrix  outcome costs (see CostMatrix).
 * @param severityMap defect-label → severity. Labels not present are NON-defect
 *                    (their mass is treated as "OK" probability).
 * @param opts        reviewBand (deadband → human).
 *
 * @returns the min-expected-cost action + full audit. `action`:
 *   - "pass"   → treat as OK (defect risk below the severity-adjusted threshold),
 *   - "flag"   → treat as a defect (NG),
 *   - "review" → send to a human (grey zone near the crossover, or review is cheapest).
 */
export function decideThreshold(
  probs: Array<{ label: string; confidence: number }>,
  costMatrix: CostMatrix,
  severityMap: SeverityMap,
  opts: DecideThresholdOptions = {},
): CostThresholdDecision {
  const reviewBand = clamp01(opts.reviewBand ?? 0.15);
  const fn = Math.max(costMatrix.falseNegative, 0);
  const fp = Math.max(costMatrix.falsePositive, 0);
  const rv = Math.max(costMatrix.review, 0);

  // Aggregate the probability mass + confidence-weighted severity over defect labels.
  let defectMass = 0;
  let weightedSeverity = 0;
  let topLabel: string | null = null;
  let topConf = -1;
  for (const p of probs) {
    const key = normalizeLabel(p.label);
    const sev = severityMap[key];
    if (sev == null || sev <= 0) continue; // non-defect label → OK mass
    const conf = Number.isFinite(p.confidence) ? Math.max(p.confidence, 0) : 0;
    defectMass += conf;
    weightedSeverity += conf * sev;
    if (conf > topConf) { topConf = conf; topLabel = key; }
  }
  const p = clamp01(defectMass);
  const severity = defectMass > 0 ? weightedSeverity / defectMass : 0;

  // Severity-adjusted crossover: p* = fp / (fn·s + fp). No defect labels ⇒ never flag.
  const denom = fn * severity + fp;
  const effectiveThreshold = severity > 0 && denom > 0 ? fp / denom : 1;

  const costPass = p * fn * severity;      // expected cost of declaring OK
  const costFlag = (1 - p) * fp;           // expected cost of declaring NG
  const costReview = rv;                   // fixed reviewer cost
  const expectedCost: Record<CostAction, number> = {
    pass: round6(costPass),
    flag: round6(costFlag),
    review: round6(costReview),
  };

  // Grey-zone deadband: near the flag/pass crossover, prefer a human.
  const nearCrossover = severity > 0 && Math.abs(p - effectiveThreshold) <= reviewBand;

  let action: CostAction;
  let rationale: string;
  if (severity <= 0 || defectMass <= 0) {
    action = "pass";
    rationale = "No defect-class probability mass — treat as OK.";
  } else if (nearCrossover && costReview <= Math.max(costPass, costFlag)) {
    action = "review";
    rationale =
      `Defect prob ${p.toFixed(3)} within ±${reviewBand} of severity-adjusted ` +
      `threshold ${effectiveThreshold.toFixed(3)} (severity ${severity.toFixed(2)}) → human review.`;
  } else if (costReview < costPass && costReview < costFlag) {
    action = "review";
    rationale = `Review is the min-cost action (review ${costReview} < pass ${costPass.toFixed(3)}, flag ${costFlag.toFixed(3)}).`;
  } else if (costPass <= costFlag) {
    action = "pass";
    rationale =
      `Defect prob ${p.toFixed(3)} below severity-adjusted threshold ${effectiveThreshold.toFixed(3)} ` +
      `(severity ${severity.toFixed(2)}) → OK.`;
  } else {
    action = "flag";
    rationale =
      `Defect prob ${p.toFixed(3)} above severity-adjusted threshold ${effectiveThreshold.toFixed(3)} ` +
      `(severity ${severity.toFixed(2)}) → flag NG (recall-first).`;
  }

  return { action, label: topLabel, defectProbability: p, severity, expectedCost, effectiveThreshold, rationale };
}

// ─── Triage wiring helper (recall-first, never relaxes) ──────────────────────

export type GateDecision = "AUTO_OK" | "AUTO_NG" | "NEEDS_REVIEW" | "MANUAL";

export interface TriageOverride {
  decision: GateDecision;
  /** true when cost-sensitivity changed the base decision. */
  overridden: boolean;
  reason?: string;
  cost: CostThresholdDecision;
}

/**
 * Apply the cost-sensitive layer on TOP of a base triage decision. Contract:
 * RECALL-FIRST + NEVER RELAXES — it can only pull an over-confident AUTO_OK back
 * to human review when a severe defect is plausible; it never turns an NG/review
 * into an OK, and never auto-rejects (escalation target is NEEDS_REVIEW, per
 * spec §8.2 "lỗi nghi ngờ → đẩy sang người"). Callers gate this behind
 * isCostSensitiveThresholdEnabled() so OFF ⇒ base decision is returned untouched.
 */
export function applyCostSensitiveTriage(input: {
  baseDecision: GateDecision;
  predictions: Array<{ label: string; confidence: number }>;
  severityMap: SeverityMap;
  costMatrix?: CostMatrix;
  opts?: DecideThresholdOptions;
}): TriageOverride {
  const cost = decideThreshold(
    input.predictions,
    input.costMatrix ?? defaultCostMatrix(),
    input.severityMap,
    input.opts,
  );

  // Only an over-confident OK is dangerous; everything else already ≥ this level
  // of conservatism, so it is passed through unchanged.
  if (input.baseDecision === "AUTO_OK" && (cost.action === "flag" || cost.action === "review")) {
    return {
      decision: "NEEDS_REVIEW",
      overridden: true,
      reason:
        `Cost-sensitive override: ${cost.rationale} ` +
        `(base decision AUTO_OK escalated to NEEDS_REVIEW).`,
      cost,
    };
  }
  return { decision: input.baseDecision, overridden: false, cost };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
