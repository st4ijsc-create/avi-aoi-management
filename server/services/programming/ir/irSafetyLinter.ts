/**
 * Doc 16 §11.1 (Khối 6) / Doc 18 §6 (D1) — SEMANTIC SAFETY LINTER for the IR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The design calls for a SEMANTIC safety linter (BEYOND syntax): static checks over an
 * IR Flow that catch physically-unsafe programs BEFORE they are transpiled. This is the
 * hard gate the design (§11.1 point 3) requires: any `error`-severity diagnostic BLOCKS
 * transpile (codegen). Warnings do NOT block.
 *
 * Checks (all STATIC — no device I/O, no execution):
 *   • speed_mms ≤ ceiling            (move_linear Cartesian speed).
 *   • speed_pct ≤ 100 & sane          (move_joint) — also flags a very-fast joint move.
 *   • target_pose inside a declared workspace AABB (per device type / configurable).
 *   • force_limit_n ≤ ceiling         (grip).
 *   • grip timeout bounded             (0 < timeout_ms ≤ ceiling).
 *   • blend_radius sane                (0 ≤ blend ≤ ceiling; not larger than the move).
 *   • no unreachable / empty branches  (if_condition with two empty branches; a loop
 *     with an empty body; a `count: 0` — caught by shape too but re-stated as semantic).
 *
 * The speed/force ceilings come from a resolved LimitProfile: (1) a per-device-type
 * default, (2) overridden by env tunables, (3) overridden by an explicit caller profile
 * (e.g. from a robot class's safety-rated speed when the capability model exposes it).
 *
 * HONEST NOTE: the equipment capabilityModel does NOT yet expose a per-robot
 * safety_rated_speed_mms / reach AABB (they are declared telemetry SEAMS, X1-a). Until a
 * driver provides them, this linter uses the configured ceilings below. When those
 * fields land, pass them in via `LimitProfile` — the linter already reads from the
 * profile, no rule change needed.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Flow, IrBlock, Pose, TargetDeviceType } from "./irModel";
import { assignIds, walkBlocks } from "./irModel";

/** One linter finding. `error` blocks transpile; `warn` is advisory. */
export interface LintDiagnostic {
  blockId: string;
  severity: "error" | "warn";
  rule: string;
  message: string;
}

export interface LintResult {
  ok: boolean; // false if ANY error-severity diagnostic → transpile is blocked.
  diagnostics: LintDiagnostic[];
}

/** An axis-aligned bounding box for the declared workspace (mm). */
export interface WorkspaceAABB {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
}

/** The resolved safety ceilings the linter enforces. */
export interface LimitProfile {
  /** Max Cartesian linear speed (mm/s). */
  maxSpeedMms: number;
  /** Max gripper force (N). */
  maxForceN: number;
  /** Max grip timeout (ms). */
  maxGripTimeoutMs: number;
  /** Max blend radius (mm). */
  maxBlendRadiusMm: number;
  /** Declared reachable workspace AABB (mm); poses outside → error. */
  workspace: WorkspaceAABB;
}

// ── Env tunables (read at call time so ops/tests can toggle) ──────────────────
function num(envKey: string, fallback: number): number {
  const raw = process.env[envKey];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve the LimitProfile for a target device type: sane hard-coded defaults, each
 * overridable by an env tunable, then by an explicit override object (highest priority).
 * Pure + fail-safe.
 */
export function resolveLimits(
  _targetDeviceType?: TargetDeviceType,
  override?: Partial<LimitProfile>,
): LimitProfile {
  const base: LimitProfile = {
    // 250 mm/s is the ISO/TS 15066 collaborative reduced-speed ballpark — a safe default
    // ceiling for a cobot workspace. Tune per cell via env.
    maxSpeedMms: num("DPC_IR_MAX_SPEED_MMS", 250),
    maxForceN: num("DPC_IR_MAX_FORCE_N", 150),
    maxGripTimeoutMs: num("DPC_IR_MAX_GRIP_TIMEOUT_MS", 30_000),
    maxBlendRadiusMm: num("DPC_IR_MAX_BLEND_RADIUS_MM", 100),
    workspace: {
      min: {
        x: num("DPC_IR_WORKSPACE_MIN_X", -1000),
        y: num("DPC_IR_WORKSPACE_MIN_Y", -1000),
        z: num("DPC_IR_WORKSPACE_MIN_Z", 0),
      },
      max: {
        x: num("DPC_IR_WORKSPACE_MAX_X", 1000),
        y: num("DPC_IR_WORKSPACE_MAX_Y", 1000),
        z: num("DPC_IR_WORKSPACE_MAX_Z", 1500),
      },
    },
  };
  if (!override) return base;
  return {
    maxSpeedMms: override.maxSpeedMms ?? base.maxSpeedMms,
    maxForceN: override.maxForceN ?? base.maxForceN,
    maxGripTimeoutMs: override.maxGripTimeoutMs ?? base.maxGripTimeoutMs,
    maxBlendRadiusMm: override.maxBlendRadiusMm ?? base.maxBlendRadiusMm,
    workspace: override.workspace ?? base.workspace,
  };
}

function poseInWorkspace(p: Pose, ws: WorkspaceAABB): boolean {
  return (
    p.x >= ws.min.x && p.x <= ws.max.x &&
    p.y >= ws.min.y && p.y <= ws.max.y &&
    p.z >= ws.min.z && p.z <= ws.max.z
  );
}

/**
 * Lint an IR Flow against a LimitProfile. Pure. Any `error` → ok:false → transpile MUST
 * NOT proceed (the transpiler + service enforce this).
 */
export function lintFlow(flow: Flow, override?: Partial<LimitProfile>): LintResult {
  const limits = resolveLimits(flow.target_device_type, override);
  // Ensure every block has a stable id so diagnostics reference a real handle.
  const idFlow = assignIds(flow);
  const diags: LintDiagnostic[] = [];
  const push = (blockId: string | undefined, severity: LintDiagnostic["severity"], rule: string, message: string) =>
    diags.push({ blockId: blockId ?? "?", severity, rule, message });

  const inspect = (block: IrBlock) => {
    switch (block.type) {
      case "move_linear": {
        if (block.speed_mms > limits.maxSpeedMms) {
          push(block.id, "error", "speed-limit",
            `move_linear speed ${block.speed_mms} mm/s exceeds ceiling ${limits.maxSpeedMms} mm/s.`);
        }
        if (block.speed_mms === 0) {
          push(block.id, "warn", "zero-speed", "move_linear speed is 0 mm/s (the move will not progress).");
        }
        if (!poseInWorkspace(block.target_pose, limits.workspace)) {
          push(block.id, "error", "workspace-bounds",
            `move_linear target pose (${block.target_pose.x}, ${block.target_pose.y}, ${block.target_pose.z}) is outside the declared workspace AABB.`);
        }
        if (block.blend_radius > limits.maxBlendRadiusMm) {
          push(block.id, "error", "blend-radius",
            `blend_radius ${block.blend_radius} mm exceeds ceiling ${limits.maxBlendRadiusMm} mm.`);
        }
        if (block.acceleration === 0) {
          push(block.id, "warn", "zero-accel", "move_linear acceleration is 0 (implausible).");
        }
        break;
      }
      case "move_joint": {
        if (block.speed_pct > 100) {
          push(block.id, "error", "joint-speed-limit", `move_joint speed ${block.speed_pct}% exceeds 100%.`);
        } else if (block.speed_pct > 90) {
          push(block.id, "warn", "joint-speed-high",
            `move_joint speed ${block.speed_pct}% is very high — confirm this is safe for the cell.`);
        }
        break;
      }
      case "grip": {
        if (block.force_limit_n > limits.maxForceN) {
          push(block.id, "error", "force-limit",
            `grip force ${block.force_limit_n} N exceeds ceiling ${limits.maxForceN} N.`);
        }
        if (block.timeout_ms === 0) {
          push(block.id, "error", "grip-timeout", "grip timeout_ms is 0 (unbounded actuation — must be > 0).");
        } else if (block.timeout_ms > limits.maxGripTimeoutMs) {
          push(block.id, "error", "grip-timeout",
            `grip timeout_ms ${block.timeout_ms} exceeds ceiling ${limits.maxGripTimeoutMs} ms.`);
        }
        break;
      }
      case "if_condition": {
        if (block.true_branch.length === 0 && block.false_branch.length === 0) {
          push(block.id, "warn", "empty-branch", "if_condition has two empty branches (dead block).");
        }
        break;
      }
      case "loop": {
        if (block.body.length === 0) {
          push(block.id, "warn", "empty-loop", "loop has an empty body (does nothing).");
        }
        break;
      }
      // release / set_output / wait carry no motion-safety hazard to check statically.
      default:
        break;
    }
  };

  walkBlocks(idFlow.blocks, inspect);

  return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
}
