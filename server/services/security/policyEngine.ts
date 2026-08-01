/**
 * OPA-lite policy engine — SYNAPSE §5.11.2 "policy-as-code" (doc 33 §3.4 / F5 · H1 Security).
 *
 * Declarative, versioned, TESTABLE policies for high-risk actions (override, skip-step,
 * recipe-write, zone changes). Instead of embedding a full OPA server, this evaluates a
 * small, SERIALIZABLE rule model against an input context — the same rules can later live in
 * the DB and be edited via a governance workflow. Mirrors the SDD's Rego examples:
 *   deny         { action == "skip_step"; step.type == "AOI"; product.class == 3 }
 *   require_approval { action == "manual_override"; zone.density > threshold }
 *
 * Non-breaking (F5): this is a pure evaluator used by callers that OPT IN (e.g. the write-gate
 * can consult it before a risky command). It never mutates and never throws on bad input.
 *
 * Precedence: any matching DENY wins → denied; else any matching REQUIRE_APPROVAL → needs
 * approval; else allowed. Fail-safe default for a MISSING field depends on the operator.
 */

export type PolicyEffect = "deny" | "require_approval" | "allow";
export type CompareOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "exists" | "truthy";

/** A single condition on the input context; conditions within a policy are AND-ed. */
export interface PolicyCondition {
  /** Dotted path into the input, e.g. "product.class", "zone.density". */
  path: string;
  op: CompareOp;
  /** Comparison value (unused for `exists`/`truthy`). */
  value?: unknown;
}

export interface Policy {
  id: string;
  /** Effect when ALL conditions match. */
  effect: Exclude<PolicyEffect, "allow">;
  conditions: PolicyCondition[];
  /** Human reason surfaced to the operator + audit. */
  reason: string;
  /** SemVer-ish version of the rule (governance). */
  version: string;
  /** Optional: only evaluate when input.action equals one of these (fast filter). */
  actions?: string[];
  enabled?: boolean;
}

export interface PolicyDecision {
  effect: PolicyEffect;
  /** Policy that determined the decision (null when allowed by default). */
  policyId: string | null;
  reason: string;
  /** All policies that matched (for audit/debug). */
  matched: { id: string; effect: PolicyEffect; reason: string }[];
}

/** Resolve a dotted path from an object (safe; returns undefined on any miss). */
export function resolvePath(input: unknown, path: string): unknown {
  let cur: unknown = input;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Evaluate one condition against input. Missing fields fail comparisons (fail-safe). */
export function evalCondition(input: unknown, c: PolicyCondition): boolean {
  const actual = resolvePath(input, c.path);
  switch (c.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "truthy":
      return !!actual;
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(actual as never);
    case "nin":
      return Array.isArray(c.value) && !c.value.includes(actual as never);
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = toNum(actual);
      const b = toNum(c.value);
      if (a === null || b === null) return false; // missing/non-numeric → no match (fail-safe)
      return c.op === "gt" ? a > b : c.op === "gte" ? a >= b : c.op === "lt" ? a < b : a <= b;
    }
    default:
      return false;
  }
}

/** Does a policy match the input (all conditions AND-ed; action filter honored)? */
export function policyMatches(input: { action?: string } & Record<string, unknown>, p: Policy): boolean {
  if (p.enabled === false) return false;
  if (p.actions && p.actions.length > 0 && !p.actions.includes(input.action ?? "")) return false;
  if (p.conditions.length === 0) return false; // an empty policy never matches (avoid accidental deny-all)
  return p.conditions.every((c) => evalCondition(input, c));
}

/**
 * Evaluate all policies against an input context. Deny wins over require_approval over allow.
 * Pure + never throws.
 */
export function evaluatePolicies(
  input: { action?: string } & Record<string, unknown>,
  policies: readonly Policy[],
): PolicyDecision {
  const matched: PolicyDecision["matched"] = [];
  let denied: Policy | null = null;
  let approval: Policy | null = null;
  for (const p of policies) {
    if (policyMatches(input, p)) {
      matched.push({ id: p.id, effect: p.effect, reason: p.reason });
      if (p.effect === "deny" && !denied) denied = p;
      else if (p.effect === "require_approval" && !approval) approval = p;
    }
  }
  if (denied) return { effect: "deny", policyId: denied.id, reason: denied.reason, matched };
  if (approval)
    return { effect: "require_approval", policyId: approval.id, reason: approval.reason, matched };
  return { effect: "allow", policyId: null, reason: "no matching policy", matched };
}

// ════════════════════════════════════════════════════════════════════════════
// W3-A1 (doc 44 G3.11 + G3.12) — standardized SYNAPSE §11.2 decision model.
//
// evaluate(subject, action, resource, context) → PERMIT | DENY
//   (+ obligations[], reason_code, policy_ref)
//
// This section is PURE + ADDITIVE: the legacy `evaluatePolicies` above is kept
// bit-for-bit (its callers keep their behaviour); the new core below is a
// superset that additionally understands
//   • effect "allow" rules (needed for default-deny groups: an action inside a
//     default-deny group is PERMITted only by an EXPLICIT matching allow rule),
//   • glob-ish action/resource patterns ("ot.command.*"),
//   • priorities (higher wins within the same effect; ties keep source order —
//     stable sort → DEFAULT_POLICIES keep their legacy first-match semantics).
// ════════════════════════════════════════════════════════════════════════════

/** Superset rule model (store/as-code rules + the legacy DEFAULT_POLICIES). */
export interface PolicyRule {
  id: string;
  /** Unlike legacy `Policy`, "allow" is a valid effect (explicit allow rules). */
  effect: PolicyEffect;
  conditions: PolicyCondition[];
  /** Human reason surfaced to the operator + audit. */
  reason: string;
  version: string;
  /** Legacy exact-match action filter (kept for DEFAULT_POLICIES compat). */
  actions?: string[];
  /** Glob-ish action pattern, `*` = any run of chars (e.g. "ot.command.*"). */
  actionPattern?: string | null;
  /** Glob-ish resource pattern; absent/null → matches any resource. */
  resourcePattern?: string | null;
  /** Higher evaluates first within the same effect class (default 0). */
  priority?: number;
  enabled?: boolean;
}

/** Spec §11.2 decision (superset: `reason`/`effect`/`matched` kept for the legacy wrapper). */
export interface StandardDecision {
  decision: "PERMIT" | "DENY";
  obligations: string[];
  reason_code: string;
  policy_ref: string | null;
  /** Human reason (legacy `PolicyDecision.reason` surface). */
  reason: string;
  /** Legacy effect view (allow | deny | require_approval) for bit-compat mapping. */
  effect: PolicyEffect;
  /** All rules that matched (audit/debug). */
  matched: { id: string; effect: PolicyEffect; reason: string }[];
}

/** Standard reason codes (spec §12.3 PolicyDecision.reason_code vocabulary). */
export const POLICY_REASON_CODES = {
  POLICY_DENIED: "POLICY_DENIED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  POLICY_ALLOWED: "POLICY_ALLOWED",
  NO_MATCHING_ALLOW_POLICY: "NO_MATCHING_ALLOW_POLICY",
  DEFAULT_ALLOW: "DEFAULT_ALLOW",
  EVALUATOR_ERROR: "EVALUATOR_ERROR",
} as const;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Glob-ish pattern match: `*` matches any run of characters; everything else is
 * literal. No `*` → exact string equality. Empty pattern never matches.
 */
export function matchesActionPattern(value: string, pattern: string): boolean {
  if (!pattern) return false;
  if (!pattern.includes("*")) return value === pattern;
  const rx = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return rx.test(value);
}

/**
 * Parse the POLICY_DEFAULT_DENY_ACTIONS CSV (e.g. "ot.command.*,robot.*").
 * Default EMPTY → default-deny disabled (legacy default-allow, transition phase).
 */
export function parseDefaultDenyPatterns(csv: string | undefined | null): string[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/** Is `action` inside the default-deny group (matches ANY configured pattern)? */
export function actionInDefaultDenyGroup(action: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchesActionPattern(action, p));
}

/**
 * Does a superset rule match? AND of: enabled, legacy `actions` filter (exact,
 * `input.action ?? ""` — bit-identical to `policyMatches`), `actionPattern` glob
 * on the caller-normalized action string, `resourcePattern` glob, conditions.
 *
 * Empty-conditions guard (mirrors `policyMatches`): a deny/require_approval rule
 * with NO conditions never matches (avoid accidental deny-all). An ALLOW rule
 * with no conditions is a deliberate scope grant and may match — but ONLY when
 * it is action-scoped (has `actions` or `actionPattern`); a fully unscoped,
 * unconditioned allow would silently disable default-deny.
 */
export function ruleMatches(
  input: { action?: unknown } & Record<string, unknown>,
  action: string,
  resource: string | null,
  rule: PolicyRule,
): boolean {
  if (rule.enabled === false) return false;
  if (rule.actions && rule.actions.length > 0 && !rule.actions.includes((input.action as string | undefined) ?? "")) {
    return false;
  }
  if (rule.actionPattern && !matchesActionPattern(action, rule.actionPattern)) return false;
  if (rule.resourcePattern && !matchesActionPattern(resource ?? "", rule.resourcePattern)) return false;
  if (rule.conditions.length === 0) {
    return rule.effect === "allow" && Boolean(rule.actionPattern || (rule.actions && rule.actions.length > 0));
  }
  return rule.conditions.every((c) => evalCondition(input, c));
}

/**
 * Standardized evaluation core (spec §11.2). PURE — never mutates its inputs.
 * Precedence: deny > require_approval > explicit allow > group default:
 *   • matched deny            → DENY  + POLICY_DENIED
 *   • matched require_approval→ PERMIT + obligations:["require_approval"]
 *                               (explicit permit-with-obligation — the CALLER
 *                               enforces the approval, preserving old semantics)
 *   • matched allow           → PERMIT + POLICY_ALLOWED
 *   • no match, action in default-deny group → DENY + NO_MATCHING_ALLOW_POLICY
 *   • no match otherwise      → PERMIT + DEFAULT_ALLOW ("no matching policy" —
 *                               legacy transition behaviour, bit-compat).
 */
export function decideStandard(
  input: { action?: unknown } & Record<string, unknown>,
  action: string,
  resource: string | null,
  rules: readonly PolicyRule[],
  defaultDenyPatterns: readonly string[],
): StandardDecision {
  // Stable sort by priority desc — DEFAULT_POLICIES carry no priority (all 0),
  // so their legacy source order (first-match wins) is preserved exactly.
  const ordered = [...rules].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const matched: StandardDecision["matched"] = [];
  let denied: PolicyRule | null = null;
  let approval: PolicyRule | null = null;
  let allowed: PolicyRule | null = null;
  for (const rule of ordered) {
    if (ruleMatches(input, action, resource, rule)) {
      matched.push({ id: rule.id, effect: rule.effect, reason: rule.reason });
      if (rule.effect === "deny" && !denied) denied = rule;
      else if (rule.effect === "require_approval" && !approval) approval = rule;
      else if (rule.effect === "allow" && !allowed) allowed = rule;
    }
  }
  if (denied) {
    return {
      decision: "DENY",
      obligations: [],
      reason_code: POLICY_REASON_CODES.POLICY_DENIED,
      policy_ref: denied.id,
      reason: denied.reason,
      effect: "deny",
      matched,
    };
  }
  if (approval) {
    return {
      decision: "PERMIT",
      obligations: ["require_approval"],
      reason_code: POLICY_REASON_CODES.APPROVAL_REQUIRED,
      policy_ref: approval.id,
      reason: approval.reason,
      effect: "require_approval",
      matched,
    };
  }
  if (allowed) {
    return {
      decision: "PERMIT",
      obligations: [],
      reason_code: POLICY_REASON_CODES.POLICY_ALLOWED,
      policy_ref: allowed.id,
      reason: allowed.reason,
      effect: "allow",
      matched,
    };
  }
  if (actionInDefaultDenyGroup(action, defaultDenyPatterns)) {
    return {
      decision: "DENY",
      obligations: [],
      reason_code: POLICY_REASON_CODES.NO_MATCHING_ALLOW_POLICY,
      policy_ref: null,
      reason: `default-deny: action "${action}" is in the POLICY_DEFAULT_DENY_ACTIONS group and no allow policy matched`,
      effect: "deny",
      matched,
    };
  }
  return {
    decision: "PERMIT",
    obligations: [],
    reason_code: POLICY_REASON_CODES.DEFAULT_ALLOW,
    policy_ref: null,
    reason: "no matching policy",
    effect: "allow",
    matched,
  };
}

/**
 * Default first-party policy set (versioned). Mirrors SDD §5.11.2 examples. These are the
 * "sắt" rules for an electronics/AOI line; a governance workflow can extend them later.
 */
export const DEFAULT_POLICIES: readonly Policy[] = [
  {
    id: "deny-skip-aoi-class3",
    effect: "deny",
    version: "1.0.0",
    actions: ["skip_step"],
    reason: "Cấm bỏ bước kiểm AOI với sản phẩm class-3 (không thương lượng).",
    conditions: [
      { path: "step.type", op: "eq", value: "AOI" },
      { path: "product.class", op: "eq", value: 3 },
    ],
  },
  {
    id: "approve-override-crowded-zone",
    effect: "require_approval",
    version: "1.0.0",
    actions: ["manual_override"],
    reason: "Ghi đè khi robot đang ở zone đông người → cần phê duyệt quản lý (four-eyes).",
    conditions: [{ path: "zone.density", op: "gt", value: 0.7 }],
  },
  {
    id: "approve-recipe-write-production",
    effect: "require_approval",
    version: "1.0.0",
    actions: ["recipe_write"],
    reason: "Ghi recipe khi line đang chạy sản xuất → cần phê duyệt + khoá phiên bản.",
    conditions: [{ path: "line.state", op: "eq", value: "running" }],
  },
];
