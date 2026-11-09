/**
 * A2(n) T7b-1d lượt sửa 1 (H29, dieu-phoi 09/11) — the one definition of the SEC_PLATFORM flag, in a module that imports nothing: reading it loads nothing, so a walk or an Abort with the flag off never waits on the policy's module.
 * policyGate exports it again. moduleLaStopCensus holds this: no import here, no second reading of the variable.
 */
/** Is the platform-grade security enforcement active? */
export function secPlatformEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEC_PLATFORM === "true" || env.SEC_PLATFORM === "1";
}
