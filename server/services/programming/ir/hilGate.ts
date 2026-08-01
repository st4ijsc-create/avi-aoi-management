/**
 * Doc 24 Tier-2 (Programming) — HARDWARE-IN-THE-LOOP (HIL) pre-deploy stage.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A SECOND gate that composes ON TOP OF the Simulation Gate for the IR deploy path. For a
 * Universal-Robots target it runs the EXACT transpiled URScript through the existing URSim
 * harness (`validateUrscriptOnUrsim` → send program to a VIRTUAL controller + poll
 * accept/run) BEFORE a deploy is allowed to proceed. It is the strongest pre-hardware proof
 * short of a physical arm: a syntactically-broken transpile is rejected by the real UR
 * runtime, so `accepted`/`running` never go true and HIL FAILS → the deploy is blocked.
 *
 * COMPOSITION (never weakens the sim-gate):
 *     Simulation Gate PASS  (hard precondition, unchanged)
 *        └─▶ HIL stage       (this module — 2nd gate, UR only, flag-gated)
 *              └─▶ deploy     (still 'simulated' by default in the IR adapter)
 *
 * FLAG: DPC_HIL_ENABLED (default OFF). OFF → this is a no-op that NEVER blocks (today's
 * behaviour). ON → for a UR target the HIL result is REQUIRED to pass; a HIL failure blocks
 * the deploy. Non-UR targets are not gated by HIL (URSim is UR-specific) and pass through.
 *
 * SAFETY: HIL only ever touches the VIRTUAL URSim controller — it opens NO real-hardware
 * path. The real deploy gate (DPC_DEPLOY_ENABLED + HITL) is unchanged and orthogonal.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  validateUrscriptOnUrsim,
  ursimEndpointFromEnv,
  type UrsimValidationResult,
  type UrsimValidationOptions,
} from "../../robot/ursim/ursimHarness";
import type { UrsimEndpoint } from "../../robot/ursim/ursimClient";

/** Runtime flag (default OFF → today's behaviour: HIL is a no-op that never blocks). */
export function dpcHilEnabled(): boolean {
  return process.env.DPC_HIL_ENABLED === "true" || process.env.DPC_HIL_ENABLED === "1";
}

export type HilSkipReason = "flag-off" | "not-ur" | "no-endpoint";

export interface HilStageResult {
  /** True ⇔ the HIL stage actually contacted a (virtual) URSim controller. */
  ran: boolean;
  /**
   * The gate verdict. `true` ⇒ deploy may proceed; `false` ⇒ deploy is BLOCKED. A skipped
   * stage (flag off / non-UR target) reports pass:true (does not block). A stage that SHOULD
   * have run but could not (no endpoint configured) reports pass:false — fail-closed.
   */
  pass: boolean;
  /** Human-readable why-passed / why-skipped / why-failed. */
  reason?: string;
  /** Present when the stage was skipped rather than executed. */
  skipped?: HilSkipReason;
  /** The raw URSim validation contract when the stage ran (honest; never fabricated). */
  validation?: UrsimValidationResult;
}

/** Injectable seams so a test can point HIL at a mock URSim without env/hardware. */
export interface HilStageDeps {
  /** URSim validator (default: validateUrscriptOnUrsim). */
  validate?: (urscript: string, endpoint: UrsimEndpoint, opts?: UrsimValidationOptions) => Promise<UrsimValidationResult>;
  /** Endpoint resolver (default: ursimEndpointFromEnv — reads URSIM_HOST/ports). */
  resolveEndpoint?: () => UrsimEndpoint | null;
  /** Validation timing overrides (poll/run-wait) — handy to keep tests fast. */
  validationOptions?: UrsimValidationOptions;
}

/**
 * Run the HIL pre-deploy stage for a transpiled program. PURE with respect to real
 * hardware — the only device path is the VIRTUAL URSim controller, and only when the flag
 * is on and the target is UR. Never throws: a transport failure surfaces as pass:false.
 */
export async function runHilStage(
  urscript: string,
  targetIsUr: boolean,
  deps: HilStageDeps = {},
): Promise<HilStageResult> {
  // Flag OFF → no-op that NEVER blocks (byte-for-byte today's deploy behaviour).
  if (!dpcHilEnabled()) {
    return { ran: false, pass: true, skipped: "flag-off", reason: "DPC_HIL_ENABLED off — HIL pre-deploy stage skipped." };
  }
  // URSim is a Universal-Robots controller — a non-UR target is not gated by HIL.
  if (!targetIsUr) {
    return { ran: false, pass: true, skipped: "not-ur", reason: "HIL (URSim) applies to Universal-Robots targets only — skipped (not blocking)." };
  }
  const resolveEndpoint = deps.resolveEndpoint ?? ursimEndpointFromEnv;
  const endpoint = resolveEndpoint();
  // Flag ON + UR but no endpoint configured → fail-closed. We required a HIL proof and cannot
  // obtain one; refusing is the safe outcome (never a fabricated pass).
  if (!endpoint) {
    return {
      ran: false,
      pass: false,
      skipped: "no-endpoint",
      reason: "DPC_HIL_ENABLED on but no URSim endpoint configured (set URSIM_HOST + ports) — HIL could not run; blocking.",
    };
  }
  const validate = deps.validate ?? validateUrscriptOnUrsim;
  const validation = await validate(urscript, endpoint, deps.validationOptions);
  const pass = !validation.error && (validation.running || validation.accepted);
  return {
    ran: true,
    pass,
    validation,
    reason: pass
      ? `URSim virtual controller accepted + ran the program (robotMode=${validation.robotMode ?? "?"}, programState=${validation.programState ?? "?"}).`
      : validation.error
        ? `URSim HIL error: ${validation.error}`
        : "URSim virtual controller did not accept/run the program — a broken transpile is rejected here (HIL fail).",
  };
}
