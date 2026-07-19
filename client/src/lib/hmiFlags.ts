/**
 * doc 63 — HMI redesign (P0-P8) feature flags. Default-OFF so the app is byte-identical
 * until explicitly flipped per-deploy via VITE_* env, matching the project's existing flag
 * convention (see appLauncherFlag.ts). Enable for GATE-1 pilot validation on the target
 * 10.1" panel PC before wider rollout.
 */

/**
 * ISA-101 HMI upgrades (doc 63): colour-coded PackML/E10 state badges, freshness surface,
 * shell alert chip, severity token remap.
 *
 * DEFAULT **ON** kể từ 2026-07-19 — user chốt "go live test" (live test nội bộ chính là
 * phép kiểm GATE-1). Kill-switch: đặt VITE_HMI_ISA101_V2=false để về giao diện cũ.
 */
export function isIsa101V2(): boolean {
  return import.meta.env.VITE_HMI_ISA101_V2 !== "false";
}
