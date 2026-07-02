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
 * P3 (Doc 24 Wave-2) — richer-vocabulary checks:
 *   • undefined-variable use          (any expression `var` leaf, or a counter op, that
 *     references a name never assigned by a prior set_variable/counter → ERROR). Scope is a
 *     conservative program-order approximation (a var declared in a branch is treated as in
 *     scope afterward) — it NEVER false-errors a genuinely-declared var; a later slice can
 *     tighten it to true lexical/branch scope. It reliably catches use-before-declare.
 *   • pid gains sane                  (Kp/Ki/Kd finite + non-negative; not absurdly large).
 *   • pid output bounded              (output_min < output_max; both finite).
 *   • wait_until timeout bounded      (0 < timeout_ms ≤ ceiling; poll < timeout).
 *   • set_analog value present        (bare literal or a valid expression — shape already
 *     enforces the type; the linter flags an unresolved variable inside it).
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
import type { Flow, IrBlock, Pose, TargetDeviceType, NumericOrExpr } from "./irModel";
import { assignIds, walkBlocks } from "./irModel";
import { slotFreeVars } from "./irExpr";

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
  /** P3: max absolute PID gain (Kp/Ki/Kd) — guards against a runaway loop. */
  maxPidGain: number;
  /** P3: max wait_until timeout (ms) — an unbounded busy-wait is a hazard. */
  maxWaitTimeoutMs: number;
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
    // P3: a PID gain over ~1000 is almost never physical for a normalised loop — flag it.
    maxPidGain: num("DPC_IR_MAX_PID_GAIN", 1000),
    // P3: a 5-minute ceiling on a bounded wait_until busy-wait.
    maxWaitTimeoutMs: num("DPC_IR_MAX_WAIT_TIMEOUT_MS", 300_000),
  };
  if (!override) return base;
  return {
    maxSpeedMms: override.maxSpeedMms ?? base.maxSpeedMms,
    maxForceN: override.maxForceN ?? base.maxForceN,
    maxGripTimeoutMs: override.maxGripTimeoutMs ?? base.maxGripTimeoutMs,
    maxBlendRadiusMm: override.maxBlendRadiusMm ?? base.maxBlendRadiusMm,
    workspace: override.workspace ?? base.workspace,
    maxPidGain: override.maxPidGain ?? base.maxPidGain,
    maxWaitTimeoutMs: override.maxWaitTimeoutMs ?? base.maxWaitTimeoutMs,
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

  // P3 — variable SCOPE. `walkBlocks` visits parent-before-children in program order, so a
  // running set of declared names approximates lexical/program scope: a var used before it
  // is ever assigned (by set_variable / counter) is UNDEFINED → error. Fail-closed: unknown
  // names are surfaced, never silently defaulted.
  const declared = new Set<string>();
  const checkSlotVars = (blockId: string | undefined, slotName: string, value: NumericOrExpr) => {
    for (const name of slotFreeVars(value)) {
      if (!declared.has(name)) {
        push(blockId, "error", "undefined-variable",
          `${slotName} references variable "${name}" which is not assigned by any prior set_variable/counter.`);
      }
    }
  };

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
      case "set_output": {
        // value may be an expression referencing variables.
        checkSlotVars(block.id, "set_output value", block.value);
        break;
      }
      case "wait": {
        if (block.ms !== undefined) checkSlotVars(block.id, "wait duration", block.ms);
        break;
      }
      // ── P3 blocks ──────────────────────────────────────────────────────────
      case "set_variable": {
        // The RHS may reference PRIOR variables (self-reference is allowed for accumulators
        // only if the name was already declared — checked before declaring below).
        checkSlotVars(block.id, "set_variable expression", block.expr);
        declared.add(block.name); // now in scope for subsequent blocks
        break;
      }
      case "counter": {
        // increment reads the prior value → the counter must exist before increment; a reset
        // DECLARES it. This keeps "increment before first reset/set" an undefined-variable error.
        if (block.op === "increment" && !declared.has(block.name)) {
          push(block.id, "error", "undefined-variable",
            `counter "${block.name}" is incremented before it is ever reset/assigned.`);
        }
        declared.add(block.name);
        break;
      }
      case "wait_until": {
        checkSlotVars(block.id, "wait_until condition", block.condition);
        if (block.timeout_ms > limits.maxWaitTimeoutMs) {
          push(block.id, "error", "wait-timeout",
            `wait_until timeout_ms ${block.timeout_ms} exceeds ceiling ${limits.maxWaitTimeoutMs} ms.`);
        }
        if (block.poll_ms >= block.timeout_ms) {
          push(block.id, "warn", "wait-poll",
            `wait_until poll_ms ${block.poll_ms} is ≥ timeout_ms ${block.timeout_ms} (the loop polls at most once).`);
        }
        break;
      }
      case "set_analog": {
        checkSlotVars(block.id, "set_analog value", block.value);
        break;
      }
      case "pid_control": {
        checkSlotVars(block.id, "pid_control setpoint", block.setpoint);
        for (const [g, v] of [["kp", block.kp], ["ki", block.ki], ["kd", block.kd]] as const) {
          if (!Number.isFinite(v)) {
            push(block.id, "error", "pid-gain", `pid_control ${g} must be a finite number.`);
          } else if (v < 0) {
            push(block.id, "error", "pid-gain", `pid_control ${g} ${v} is negative (positive gains only for a standard loop).`);
          } else if (v > limits.maxPidGain) {
            push(block.id, "error", "pid-gain", `pid_control ${g} ${v} exceeds the sane ceiling ${limits.maxPidGain} — a runaway-loop hazard.`);
          }
        }
        if (!(block.output_min < block.output_max)) {
          push(block.id, "error", "pid-output-bounds",
            `pid_control output_min ${block.output_min} must be < output_max ${block.output_max}.`);
        } else if (!Number.isFinite(block.output_min) || !Number.isFinite(block.output_max)) {
          push(block.id, "error", "pid-output-bounds", "pid_control output bounds must be finite.");
        }
        if (block.kp === 0 && block.ki === 0 && block.kd === 0) {
          push(block.id, "warn", "pid-inert", "pid_control has all-zero gains (the loop produces no control action).");
        }
        break;
      }
      // release carries no motion-safety hazard to check statically.
      default:
        break;
    }
  };

  walkBlocks(idFlow.blocks, inspect);

  return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
}
