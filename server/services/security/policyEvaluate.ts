/**
 * evaluatePolicy — the standardized SYNAPSE §11.2 evaluation entrypoint.
 * doc 44 Batch W3-A1 (gaps G3.11 + G3.12 + G3.16).
 *
 *   evaluate(subject, action, resource, context)
 *     → { decision: PERMIT|DENY, obligations[], reason_code, policy_ref, latency_ms }
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SYNCHRONOUS by design: the OT command gate (policyGate.evaluateCommandPolicy)
 * is sync and 2 parallel agents depend on its exact signature/behaviour — so the
 * hot path never awaits. Rule source resolution:
 *   • POLICY_STORE_ENABLED=true → the in-memory DB snapshot (policyStore, TTL
 *     30 s background refresh); until first load → DEFAULT_POLICIES fallback.
 *   • OFF (default) → DEFAULT_POLICIES — bit-identical to the legacy engine.
 *
 * DEFAULT-DENY GROUPS (G3.11, spec "Default-deny: không có chính sách cho phép
 * rõ ràng → TỪ CHỐI"): env POLICY_DEFAULT_DENY_ACTIONS (CSV of glob patterns,
 * e.g. "ot.command.*,robot.*,deploy.*"; default EMPTY = legacy default-allow).
 * An action matching a pattern with NO explicit allow/require_approval match →
 * DENY (NO_MATCHING_ALLOW_POLICY). Actions outside every pattern keep the
 * legacy default-allow (transition phase).
 *
 * FAIL-SAFE (never fail-open for guarded actions): if evaluation THROWS,
 * an action inside the default-deny group → DENY (EVALUATOR_ERROR); outside →
 * legacy pass-through PERMIT + server-side error log.
 *
 * LATENCY (G3.16): every call is measured with process.hrtime.bigint() and fed
 * into the policy-eval-p95 SLO ring (policyLatency). Decision-log writes and
 * snapshot refreshes are fire-and-forget — never inside the measured hot path's
 * blocking work (spec SLO ≤ 20 ms; evaluation is pure in-process).
 *
 * AUDIT (spec "Audit bất biến: mọi quyết định (PERMIT/DENY) ghi log"):
 *   • DENY / require-approval PERMIT → ALWAYS written (append-only, fail-safe);
 *   • plain PERMIT → written when the action is in the default-deny group, or
 *     always when POLICY_AUDIT_PERMIT_ALL=true (volume guard for the
 *     transition phase — flip the env to satisfy the full spec).
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  DEFAULT_POLICIES,
  decideStandard,
  parseDefaultDenyPatterns,
  actionInDefaultDenyGroup,
  POLICY_REASON_CODES,
  type PolicyRule,
  type StandardDecision,
} from "./policyEngine";
import { getPolicySnapshotSync, policyAuditPermitAll, writePolicyDecisionLog } from "./policyStore";
import { recordPolicyEvalLatency } from "./policyLatency";

/** Spec §11.2 decision + measured latency (+ legacy-compat extras). */
export interface PolicyEvaluationResult extends StandardDecision {
  latency_ms: number;
}

export interface EvaluatePolicyOptions {
  /** Caller correlation id → policy_decision_log.request_id. */
  requestId?: string | null;
  /** Explicit rule set (dry-run / tests). Default: store snapshot ?? DEFAULT_POLICIES. */
  policies?: readonly PolicyRule[];
  /** Skip the decision-log write entirely (pure what-if evaluation). */
  skipAudit?: boolean;
}

/** Active rule source: DB snapshot when the store is ON+loaded, else defaults. */
function resolveActiveRules(): readonly PolicyRule[] {
  const snap = getPolicySnapshotSync();
  return snap ?? DEFAULT_POLICIES;
}

/**
 * Build the condition-evaluation input. The caller's `context` is spread at the
 * TOP level (legacy paths like "zone.density"/"step.type" keep resolving exactly
 * as before) and ALSO nested under `context` (spec-style paths like
 * "context.fat_passed"). `subject`/`resource` are addressable too. A caller
 * context that carries its own `action` key keeps it verbatim (bit-compat with
 * the legacy gate input `{ action, ...policyContext }`).
 */
function buildEvalInput(
  subject: string,
  action: string,
  resource: string | null,
  context: Record<string, unknown>,
): { action?: unknown } & Record<string, unknown> {
  const input: Record<string, unknown> = {
    subject,
    resource: resource ?? undefined,
    context,
    ...context,
  };
  if (!("action" in context)) input.action = action;
  return input;
}

/**
 * Standardized policy evaluation (SYNAPSE §11.2). PURE decision + measured
 * latency; side effects (SLO feed, append-only audit) are fail-safe and
 * non-blocking. Never throws.
 */
export function evaluatePolicy(
  subject: string,
  action: string,
  resource: string | null | undefined,
  context: Record<string, unknown> = {},
  opts: EvaluatePolicyOptions = {},
): PolicyEvaluationResult {
  const t0 = process.hrtime.bigint();
  const denyPatterns = parseDefaultDenyPatterns(process.env.POLICY_DEFAULT_DENY_ACTIONS);
  const inDenyGroup = actionInDefaultDenyGroup(action, denyPatterns);

  let core: StandardDecision;
  try {
    const rules = opts.policies ?? resolveActiveRules();
    core = decideStandard(buildEvalInput(subject, action, resource ?? null, context), action, resource ?? null, rules, denyPatterns);
  } catch (err) {
    // FAIL-SAFE: guarded action group → DENY (never fail-open); outside the
    // group → legacy pass-through (allow) + honest server-side log.
    console.error("[policy] evaluator error:", err instanceof Error ? err.message : String(err));
    core = inDenyGroup
      ? {
          decision: "DENY",
          obligations: [],
          reason_code: POLICY_REASON_CODES.EVALUATOR_ERROR,
          policy_ref: null,
          reason: "policy evaluator error — fail-closed (action is in the default-deny group)",
          effect: "deny",
          matched: [],
        }
      : {
          decision: "PERMIT",
          obligations: [],
          reason_code: POLICY_REASON_CODES.EVALUATOR_ERROR,
          policy_ref: null,
          reason: "policy evaluator error — legacy pass-through (action outside the default-deny group)",
          effect: "allow",
          matched: [],
        };
  }

  const latencyMs = Math.round((Number(process.hrtime.bigint() - t0) / 1e6) * 1000) / 1000;
  recordPolicyEvalLatency(latencyMs); // G3.16 — feeds the policy-eval-p95 SLO

  if (!opts.skipAudit) {
    const mustLog =
      core.decision === "DENY" || // every DENY
      core.obligations.length > 0 || // every require-approval PERMIT
      inDenyGroup || // PERMIT of a guarded action
      policyAuditPermitAll(); // operator opted into full-PERMIT audit
    if (mustLog) {
      writePolicyDecisionLog({
        requestId: opts.requestId ?? null,
        subject,
        action,
        resource: resource ?? null,
        decision: core.decision,
        reasonCode: core.reason_code,
        policyRef: core.policy_ref,
        obligations: core.obligations,
        latencyMs,
        context,
      });
    }
  }

  return { ...core, latency_ms: latencyMs };
}
