/**
 * Policy-as-code write-gate adapter — SYNAPSE §5.11.2 (doc 33 integration wave / I2).
 *
 * Bridges the pure F5 policy engine into the real command write-gate. A high-risk command's
 * context is evaluated against DEFAULT_POLICIES; a `deny` blocks the write, a `require_approval`
 * blocks unless a four-eyes approval is present. Gated by SEC_PLATFORM (default OFF → allow-all,
 * fully non-breaking). Every non-allow verdict is emitted to the F6 decision-trace.
 */
import { evaluatePolicies, DEFAULT_POLICIES } from "./policyEngine";
import { recordDecision } from "../observability/decisionTrace";

/** Is the platform-grade security enforcement active? Default OFF. */
export function secPlatformEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEC_PLATFORM === "true" || env.SEC_PLATFORM === "1";
}

export interface PolicyGateResult {
  allow: boolean;
  effect: "allow" | "deny" | "require_approval";
  reason: string;
  policyId: string | null;
}

/**
 * Evaluate a command context against policy-as-code. Pure decision + best-effort trace.
 * @param opts.enabled  override the SEC_PLATFORM flag (for tests/callers)
 * @param opts.approved a four-eyes approval is present (satisfies require_approval)
 */
export function evaluateCommandPolicy(
  context: { action?: string } & Record<string, unknown>,
  opts: { enabled?: boolean; approved?: boolean } = {},
): PolicyGateResult {
  const enabled = opts.enabled ?? secPlatformEnabled();
  if (!enabled) return { allow: true, effect: "allow", reason: "SEC_PLATFORM off", policyId: null };

  const d = evaluatePolicies(context, DEFAULT_POLICIES);
  if (d.effect !== "allow") {
    try {
      recordDecision({
        decisionType: "policy-gate",
        subject: String(context.action ?? "device_write"),
        chosen: d.effect,
        candidates: d.matched.map((m) => ({ id: m.id, score: 0, eliminatedBy: m.effect })),
        version: "policy-v1",
        ts: Date.now(),
        note: d.reason,
      });
    } catch {
      /* trace is best-effort */
    }
  }
  if (d.effect === "deny") return { allow: false, effect: "deny", reason: d.reason, policyId: d.policyId };
  if (d.effect === "require_approval") {
    return opts.approved
      ? { allow: true, effect: "require_approval", reason: `approved: ${d.reason}`, policyId: d.policyId }
      : { allow: false, effect: "require_approval", reason: d.reason, policyId: d.policyId };
  }
  return { allow: true, effect: "allow", reason: "no matching policy", policyId: null };
}
