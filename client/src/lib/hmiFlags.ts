/**
 * doc 63 — HMI redesign (P0-P8) feature flags. Default-OFF so the app is byte-identical
 * until explicitly flipped per-deploy via VITE_* env, matching the project's existing flag
 * convention (see appLauncherFlag.ts). Enable for GATE-1 pilot validation on the target
 * 10.1" panel PC before wider rollout.
 */

/**
 * ISA-101 HMI upgrades (doc 63): colour-coded PackML/E10 state badges, freshness surface,
 * severity token remap. Default OFF — set VITE_HMI_ISA101_V2=true to enable.
 */
export function isIsa101V2(): boolean {
  return import.meta.env.VITE_HMI_ISA101_V2 === "true";
}
