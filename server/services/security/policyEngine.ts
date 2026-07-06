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
