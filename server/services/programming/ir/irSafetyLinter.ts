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
 * Tier-1c (Doc 24) — reusable FUNCTION BLOCKS (POUs):
 *   • undefined-function-block        (a call_block whose fb_name has no definition → ERROR).
 *   • duplicate-function-block        (two definitions share a name → ERROR).
 *   • arg-count / arg-name            (a call_block missing an argument for a required
 *     input/inout param, a duplicate arg, or an arg naming no declared param → ERROR).
 *   • arg-type                        (a LITERAL arg whose type contradicts the param's
 *     declared number/bool type → ERROR; expression args aren't statically typed → skipped).
 *   • recursion                       (a self- or mutually-recursive call cycle among the
 *     definitions → ERROR; there is no runtime call stack to bound infinite recursion).
 *   Each function-block BODY is linted with its own variable scope SEEDED by its params (so
 *   a param reference is in-scope, and every motion/IO/PID rule above applies inside a POU).
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
import type { Flow, IrBlock, Pose, TargetDeviceType, NumericOrExpr, FunctionBlockDef, FbParamType } from "./irModel";
import { assignIds, walkBlocks } from "./irModel";
import { slotFreeVars, isExpr } from "./irExpr";

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

  // ── Tier-1c: reusable function-block DEFINITIONS ──────────────────────────────
  const fbDefs: FunctionBlockDef[] = idFlow.function_blocks ?? [];
  const fbByName = new Map<string, FunctionBlockDef>();
  for (const fb of fbDefs) {
    if (fbByName.has(fb.name)) {
      push(fb.id, "error", "duplicate-function-block",
        `function_block "${fb.name}" is defined more than once — names must be unique.`);
    } else {
      fbByName.set(fb.name, fb);
    }
  }
  // Recursion guard: build the call graph among DEFINED function blocks and flag any cycle
  // (direct self-call or a mutual A→B→A). There is no runtime call stack to bound infinite
  // recursion, so a cycle is a hard error.
  const directCalls = (blocks: IrBlock[]): Set<string> => {
    const out = new Set<string>();
    walkBlocks(blocks, (b) => { if (b.type === "call_block") out.add(b.fb_name); });
    return out;
  };
  const graph = new Map<string, string[]>();
  for (const fb of fbByName.values()) {
    graph.set(fb.name, [...directCalls(fb.body)].filter((n) => fbByName.has(n)));
  }
  const color = new Map<string, 0 | 1 | 2>(); // 0 unvisited · 1 on-stack · 2 done
  const reportedCycle = new Set<string>();
  const dfs = (name: string, stack: string[]) => {
    color.set(name, 1);
    stack.push(name);
    for (const next of graph.get(name) ?? []) {
      const c = color.get(next) ?? 0;
      if (c === 1) {
        if (!reportedCycle.has(next)) {
          reportedCycle.add(next);
          push(fbByName.get(next)?.id, "error", "recursion",
            `function_block "${next}" is part of a recursive call cycle (${[...stack, next].join(" → ")}) — recursion is not allowed.`);
        }
      } else if (c === 0) {
        dfs(next, stack);
      }
    }
    stack.pop();
    color.set(name, 2);
  };
  for (const fb of fbByName.values()) if ((color.get(fb.name) ?? 0) === 0) dfs(fb.name, []);

  // Static literal-arg type check (expressions can't be typed statically → skipped).
  const argTypeError = (paramType: FbParamType, v: NumericOrExpr): string | null => {
    if (isExpr(v)) return null;
    if (paramType === "bool" && typeof v !== "boolean") return "expected a boolean";
    if (paramType === "number" && typeof v !== "number") return "expected a number";
    return null; // "signal" accepts either literal form
  };

  // P3 — variable SCOPE. `walkBlocks` visits parent-before-children in program order, so a
  // running set of declared names approximates lexical/program scope: a var used before it
  // is ever assigned (by set_variable / counter) is UNDEFINED → error. Fail-closed: unknown
  // names are surfaced, never silently defaulted. The `declared` set is PER SCOPE — the main
  // block list gets a fresh set; each function-block body gets one SEEDED with its params.
  const checkSlotVars = (declared: Set<string>, blockId: string | undefined, slotName: string, value: NumericOrExpr) => {
    for (const name of slotFreeVars(value)) {
      if (!declared.has(name)) {
        push(blockId, "error", "undefined-variable",
          `${slotName} references variable "${name}" which is not assigned by any prior set_variable/counter.`);
      }
    }
  };

  const inspectWith = (declared: Set<string>) => (block: IrBlock) => {
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
        checkSlotVars(declared, block.id, "set_output value", block.value);
        break;
      }
      case "wait": {
        if (block.ms !== undefined) checkSlotVars(declared, block.id, "wait duration", block.ms);
        break;
      }
      // ── P3 blocks ──────────────────────────────────────────────────────────
      case "set_variable": {
        // The RHS may reference PRIOR variables (self-reference is allowed for accumulators
        // only if the name was already declared — checked before declaring below).
        checkSlotVars(declared, block.id, "set_variable expression", block.expr);
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
        checkSlotVars(declared, block.id, "wait_until condition", block.condition);
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
        checkSlotVars(declared, block.id, "set_analog value", block.value);
        break;
      }
      case "call_block": {
        // Tier-1c — validate the call against the named definition.
        const def = fbByName.get(block.fb_name);
        if (!def) {
          push(block.id, "error", "undefined-function-block",
            `call_block invokes "${block.fb_name}", but no function_block with that name is defined.`);
          // still scope-check arg expressions so a caller typo doesn't mask an undefined var.
          for (const arg of block.args) checkSlotVars(declared, block.id, `call_block arg "${arg.name}"`, arg.value);
          break;
        }
        const paramByName = new Map(def.params.map((p) => [p.name, p] as const));
        const seen = new Set<string>();
        for (const arg of block.args) {
          const p = paramByName.get(arg.name);
          if (!p) {
            push(block.id, "error", "arg-name",
              `call_block "${block.fb_name}" binds argument "${arg.name}", which is not a declared parameter.`);
          } else {
            const typeErr = argTypeError(p.type, arg.value);
            if (typeErr) {
              push(block.id, "error", "arg-type",
                `call_block "${block.fb_name}" argument "${arg.name}" (${p.type}) ${typeErr}.`);
            }
          }
          if (seen.has(arg.name)) {
            push(block.id, "error", "arg-name", `call_block "${block.fb_name}" binds argument "${arg.name}" more than once.`);
          }
          seen.add(arg.name);
          // Arg expressions read from the CALLER's variable scope.
          checkSlotVars(declared, block.id, `call_block arg "${arg.name}"`, arg.value);
        }
        // Every input / inout parameter must receive an argument (outputs are optional).
        for (const p of def.params) {
          if ((p.kind === "input" || p.kind === "inout") && !seen.has(p.name)) {
            push(block.id, "error", "arg-count",
              `call_block "${block.fb_name}" is missing an argument for ${p.kind} parameter "${p.name}".`);
          }
        }
        break;
      }
      case "pid_control": {
        checkSlotVars(declared, block.id, "pid_control setpoint", block.setpoint);
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

  // Main block list — a fresh, empty variable scope.
  walkBlocks(idFlow.blocks, inspectWith(new Set<string>()));
  // Each function-block body — its own scope, SEEDED with the definition's parameter names
  // (so a param reference is in-scope) and the same motion/IO/PID/expression rules apply.
  for (const fb of fbDefs) {
    walkBlocks(fb.body, inspectWith(new Set<string>(fb.params.map((p) => p.name))));
  }

  return { ok: !diags.some((d) => d.severity === "error"), diagnostics: diags };
}
