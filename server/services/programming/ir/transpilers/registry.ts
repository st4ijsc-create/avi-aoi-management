/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) — TRANSPILER REGISTRY + hard safety gate.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Maps a target (device type) → a transpiler, and enforces the design's HARD GATE:
 * the semantic safety linter runs FIRST and any error-severity diagnostic BLOCKS
 * transpile (no code is generated). This is the "Safety Linter → pass → Transpiler"
 * step of §11.1's flow, done BEFORE codegen — not after.
 *
 * PURE: no device I/O. The output still only reaches hardware via the existing
 * programmingService deploy gate.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Flow, TargetDeviceType } from "../irModel";
import { lintFlow, type LintDiagnostic, type LimitProfile } from "../irSafetyLinter";
import { transpileToUrscript, type TranspileResult } from "./irToUrscript";
import { transpileToRos2 } from "./irToRos2";

export type TranspileTarget = "urscript" | "ros2";

/** A transpiler function: Flow → { code, irCommentMap }. */
export type Transpiler = (flow: Flow) => TranspileResult;

/** Which native target a device type transpiles to by default. */
const DEVICE_TYPE_TO_TARGET: Record<TargetDeviceType, TranspileTarget> = {
  "universal-robots": "urscript",
  ros2: "ros2",
  generic: "urscript", // a generic flow defaults to URScript (most portable pilot target).
};

const TRANSPILERS: Record<TranspileTarget, Transpiler> = {
  urscript: transpileToUrscript,
  ros2: transpileToRos2,
};

/** All targets a flow can be transpiled to (for UI target-pickers). */
export const TRANSPILE_TARGETS: TranspileTarget[] = ["urscript", "ros2"];

/** Resolve the default transpile target for a flow's device type. */
export function defaultTargetFor(deviceType: TargetDeviceType): TranspileTarget {
  return DEVICE_TYPE_TO_TARGET[deviceType] ?? "urscript";
}

export interface GatedTranspileResult {
  ok: boolean;
  /** Present only when ok (lint passed). */
  code?: string;
  irCommentMap?: Record<string, string>;
  target: TranspileTarget;
  /** The linter findings (errors here mean ok:false and no code). */
  diagnostics: LintDiagnostic[];
}

/**
 * Lint-then-transpile. The linter is the HARD GATE: if it reports any error, this returns
 * ok:false with the diagnostics and NO code — the transpiler is never invoked. Callers
 * (programmingService compile) must treat ok:false as a failed build.
 */
export function transpileFlow(
  flow: Flow,
  target?: TranspileTarget,
  limitOverride?: Partial<LimitProfile>,
): GatedTranspileResult {
  const resolvedTarget = target ?? defaultTargetFor(flow.target_device_type);
  const lint = lintFlow(flow, limitOverride);
  if (!lint.ok) {
    return { ok: false, target: resolvedTarget, diagnostics: lint.diagnostics };
  }
  const transpiler = TRANSPILERS[resolvedTarget];
  if (!transpiler) {
    return {
      ok: false,
      target: resolvedTarget,
      diagnostics: [{ blockId: "?", severity: "error", rule: "no-transpiler", message: `No transpiler for target "${resolvedTarget}".` }],
    };
  }
  const { code, irCommentMap } = transpiler(flow);
  return { ok: true, code, irCommentMap, target: resolvedTarget, diagnostics: lint.diagnostics };
}
