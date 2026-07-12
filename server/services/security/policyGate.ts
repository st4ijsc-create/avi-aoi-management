/**
 * Policy-as-code write-gate adapter — SYNAPSE §5.11.2 (doc 33 integration wave / I2).
 *
 * Bridges the pure F5 policy engine into the real command write-gate. A high-risk command's
 * context is evaluated against the active rule set; a `deny` blocks the write, a `require_approval`
 * blocks unless a four-eyes approval is present. Gated by SEC_PLATFORM (default OFF → allow-all,
 * fully non-breaking). Every non-allow verdict is emitted to the F6 decision-trace.
 *
 * W3-A1 (doc 44 G3.12): `evaluateCommandPolicy` is now a THIN WRAPPER over the standardized
 * evaluatePolicy(subject, action, resource, context) → PERMIT/DENY (+ obligations, reason_code,
 * policy_ref, latency_ms). BACKWARD-COMPATIBLE 100%: signature and legacy-mode behaviour are
 * preserved bit-for-bit (SEC_PLATFORM off → allow-all; DEFAULT_POLICIES semantics, deny >
 * require_approval > allow, "no matching policy" default-allow) — the new default-deny groups
 * (POLICY_DEFAULT_DENY_ACTIONS) and DB policy store (POLICY_STORE_ENABLED) are opt-in, default OFF.
 */
import { evaluatePolicy } from "./policyEvaluate";
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

  // Standardized evaluation (G3.12). `context` is passed verbatim (it carries its
  // own `action` key exactly as before), so condition paths resolve bit-identically.
  const actionStr = typeof context.action === "string" ? context.action : "";
  const d = evaluatePolicy("command", actionStr, null, context);

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
  if (d.effect === "deny") return { allow: false, effect: "deny", reason: d.reason, policyId: d.policy_ref };
  if (d.effect === "require_approval") {
    return opts.approved
      ? { allow: true, effect: "require_approval", reason: `approved: ${d.reason}`, policyId: d.policy_ref }
      : { allow: false, effect: "require_approval", reason: d.reason, policyId: d.policy_ref };
  }
  // Legacy default-allow surface: with no explicit allow rule d.reason is exactly
  // "no matching policy" and policy_ref null — bit-identical to the old return.
  return { allow: true, effect: "allow", reason: d.reason, policyId: d.policy_ref };
}
