/**
 * doc 81 Đợt 1B final wave (item 3, final review Important #1) — ONE safety-preflight policy
 * for BOTH dispatchers.
 *
 * Before this module the OT dispatcher read `OT_SAFETY_PREFLIGHT_ENABLED` and the robot
 * dispatcher read no flag at all, while a comment on the robot side claimed the OT path "lets
 * UNKNOWN pass" (false since Task 6). An operator benching a line with the documented OT flag
 * found OT writes pass but robot motion still refused, with no flag to reach for. The two sides
 * also named the same condition differently (SAFETY_BLOCKED/UNKNOWN vs SAFETY_PLC_BLOCKED/NOT_OK).
 *
 * Rule, identical on both sides:
 *   • the preflight is ON unless the side's flag is EXACTLY the string "false" (any other value,
 *     including "0"/"off"/"", keeps it ON — fail-closed); each side has ITS OWN flag with the
 *     same default, so a bench can open one plane without the other;
 *   • a reading of BLOCKED refuses with SAFETY_BLOCKED; anything that is not OK (UNKNOWN, a read
 *     error, a hung read) refuses with SAFETY_UNKNOWN. OK is the only state that lets a real
 *     write / motion through.
 * Both dispatchers import these functions; a third read-site with a different default is the
 * defect this file exists to prevent.
 */

/** The env flag each side reads (documented in .env.example under the OT control block). */
export const SAFETY_PREFLIGHT_FLAGS = {
  ot: "OT_SAFETY_PREFLIGHT_ENABLED",
  robot: "ROBOT_SAFETY_PREFLIGHT_ENABLED",
} as const;

/** Read at RUNTIME (operators/tests toggle). ON unless exactly "false". */
function flagEnabled(name: string): boolean {
  return process.env[name] !== "false";
}

/** OT dispatcher (commandDispatcher 5a-safety). */
export function isOtSafetyPreflightEnabled(): boolean {
  return flagEnabled(SAFETY_PREFLIGHT_FLAGS.ot);
}

/** Robot dispatcher (robotCommandDispatcher 4a-safety). Same default and semantics as OT. */
export function isRobotSafetyPreflightEnabled(): boolean {
  return flagEnabled(SAFETY_PREFLIGHT_FLAGS.robot);
}

/** The one refusal vocabulary both ledgers / UIs / alerts key on. */
export type SafetyPreflightReason = "SAFETY_BLOCKED" | "SAFETY_UNKNOWN";

/**
 * Map a preflight reading that is NOT "OK" onto the refusal reason. BLOCKED (a tripped safety
 * PLC) ⇒ SAFETY_BLOCKED; everything else (UNKNOWN: no configured/readable safety PLC; ERROR: the
 * read threw or hung) ⇒ SAFETY_UNKNOWN. Calling it with "OK" is a programming error.
 */
export function safetyPreflightReason(state: string): SafetyPreflightReason {
  if (state === "OK") throw new RangeError("safetyPreflightReason: OK is not a refusal");
  return state === "BLOCKED" ? "SAFETY_BLOCKED" : "SAFETY_UNKNOWN";
}
