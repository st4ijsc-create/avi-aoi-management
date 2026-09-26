/**
 * Phase E3a — Factory Control Plane: FOE DIGITAL-TWIN SIMULATOR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A PURE, DETERMINISTIC "simulate before deploy" twin for FOE workflows. It walks a
 * portable WorkflowDefinition EXACTLY like the real executor (foeEngine.ts) — same
 * control-flow (sequence/parallel/branch/wait/gate/delay), same precondition/interlock
 * semantics, same safe condition evaluator — but instead of dispatching ANY command it
 * PREDICTS the execution: the per-machine PackML state evolution, the step timeline,
 * timing estimates and interlock/issue warnings.
 *
 * ABSOLUTE PURITY (non-negotiable — E3b "Visual Studio" depends on it):
 *   • NO equipmentRegistry.sendCommand / dispatcher / DB / network calls. This module
 *     imports NONE of them — it only imports PURE model code (workflowModel evaluator,
 *     packml transitions, capabilityModel resolution).
 *   • DETERMINISTIC: a VIRTUAL clock starting at 0 (no Date.now), no Math.random.
 *   • FAIL-SAFE: never throws. A malformed definition → { ok:false, valid:false, errors }.
 *
 * It MIRRORS the executor's control-flow, never its side-effects.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  validateWorkflow,
  evaluateCondition,
  type WorkflowDefinition,
  type WorkflowStep,
  type Condition,
  type EvalContext,
  type ValidationError,
} from "./workflowModel";
import { getCapabilitiesForMachine } from "../../equipment/capabilityModel";
import {
  nextOnCommand,
  settleState,
  asPackmlCommand,
  type PackmlState,
  type PackmlCommand,
} from "../../equipment/packml";

// ── Public result shape (EXACT — E3b binds to this) ──────────────────────────────

/** Status of one simulated step in the predicted timeline. */
export type SimStepStatus = "ok" | "warning" | "blocked" | "skipped" | "gate";

/** Kinds of warnings the twin can raise. */
export type SimWarningKind =
  | "invalid_machine" // command/wait references an unknown machine (no machineType supplied)
  | "unsupported_command" // command verb not in the machine's E0 capability
  | "non_packml_command" // command executed but does not map to a PackML transition
  | "illegal_transition" // PackML command not legal from the machine's predicted state
  | "would_timeout" // wait_state/wait_telemetry never satisfied → times out in sim
  | "assumed_telemetry" // wait_telemetry evaluated against assumed/absent telemetry
  | "precondition_fail" // a step's precondition/interlock did not hold
  | "needs_human" // a hitl_gate pause point
  | "malformed_step"; // a structurally-bad step encountered during the walk

/** ONE entry in the predicted execution timeline (ordered by startMs). */
export interface SimTimelineEntry {
  stepId: string;
  stepType: string;
  machineId?: number;
  command?: string;
  /** Virtual-clock start (ms, deterministic — sim starts at 0). */
  startMs: number;
  /** Virtual-clock end (ms). */
  endMs: number;
  status: SimStepStatus;
  /** The machine's PREDICTED PackML state AFTER this step (command/wait steps). */
  predictedState?: PackmlState;
  /** Human-facing note (e.g. the branch path taken, the gate prompt, why blocked). */
  note?: string;
}

/** ONE predicted issue/warning (keyed to the step that raised it). */
export interface SimWarning {
  stepId: string;
  kind: SimWarningKind;
  message: string;
}

/** A single (atMs,state) point in a machine's predicted PackML trace. */
export interface SimStatePoint {
  atMs: number;
  state: PackmlState;
}

/**
 * The full prediction returned by `simulateWorkflow`. THIS SHAPE IS A CONTRACT — the
 * E3b Visual Studio renders directly from it; do not break it.
 */
export interface SimulationResult {
  /** True when the walk completed with no blocked steps (warnings allowed). */
  ok: boolean;
  /** True when validateWorkflow found no structural/semantic errors. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
  /** The predicted, ordered execution timeline. */
  timeline: SimTimelineEntry[];
  /** All predicted issues/warnings. */
  warnings: SimWarning[];
  /** Total predicted wall-clock duration (ms) of the workflow. */
  totalDurationMs: number;
  /** Per-machine predicted PackML state trace over the virtual clock. */
  machineStateTrace: Record<number, SimStatePoint[]>;
}

// ── Options ──────────────────────────────────────────────────────────────────────

/** Assumed telemetry the twin evaluates wait_telemetry / conditions against. */
export interface AssumedTelemetry {
  /** machineId → (key → value). */
  [machineId: number]: Record<string, unknown>;
}

/** Tunable simulation inputs (all optional — sensible deterministic defaults). */
export interface SimulateOptions {
  /**
   * Known machine rows (id → machineType + capabilities) so the twin can resolve E0
   * capability (which command verbs map to PackML). Pure: supplied, never DB-loaded.
   */
  machines?: Array<{ id: number; machineType: string; capabilities?: unknown }>;
  /** Per-command duration overrides (ms), keyed by command verb. */
  commandDurations?: Record<string, number>;
  /** Default duration (ms) for a command step (when no per-command override). */
  defaultCommandMs?: number;
  /** Default duration (ms) for a hitl_gate (the human pause is 0 in sim by default). */
  gateMs?: number;
  /** Assumed telemetry values the twin evaluates conditions against. */
  assumedTelemetry?: AssumedTelemetry;
  /** Assumed run params (also available to the condition evaluator). */
  params?: Record<string, unknown>;
}

const DEFAULT_COMMAND_MS = 2000;

// ── Internal simulation state ────────────────────────────────────────────────────

interface SimState {
  /** Predicted PackML state per machine (default Idle). */
  states: Map<number, PackmlState>;
  /** Per-machine predicted trace. */
  trace: Map<number, SimStatePoint[]>;
  /** machineId → machineType (+capabilities) for capability resolution. */
  machines: Map<number, { id: number; machineType: string; capabilities?: unknown }>;
  timeline: SimTimelineEntry[];
  warnings: SimWarning[];
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  assumed: AssumedTelemetry;
  opts: Required<Pick<SimulateOptions, "defaultCommandMs" | "gateMs">> & {
    commandDurations: Record<string, number>;
  };
  /** Set once an abort interlock fires — subsequent steps are skipped. */
  aborted: boolean;
}

/** A machine's predicted state, defaulting to Idle and recording it on first touch. */
function stateOf(sim: SimState, machineId: number): PackmlState {
  let s = sim.states.get(machineId);
  if (s === undefined) {
    s = "Idle";
    sim.states.set(machineId, s);
    recordTrace(sim, machineId, 0, s);
  }
  return s;
}

function recordTrace(sim: SimState, machineId: number, atMs: number, state: PackmlState): void {
  let t = sim.trace.get(machineId);
  if (!t) {
    t = [];
    sim.trace.set(machineId, t);
  }
  // Collapse a duplicate (same time + state) — keep the trace clean + deterministic.
  const last = t[t.length - 1];
  if (last && last.atMs === atMs && last.state === state) return;
  t.push({ atMs, state });
}

/** Advance a machine to a new predicted state at a given clock, recording the trace. */
function setState(sim: SimState, machineId: number, atMs: number, state: PackmlState): void {
  sim.states.set(machineId, state);
  recordTrace(sim, machineId, atMs, state);
}

function warn(sim: SimState, stepId: string, kind: SimWarningKind, message: string): void {
  sim.warnings.push({ stepId, kind, message });
}

/** Build the safe-evaluator context from the PREDICTED sim state + assumed telemetry. */
function evalCtxOf(sim: SimState): EvalContext {
  return {
    params: sim.params,
    context: sim.context,
    getTelemetry: (machineId, key) => {
      if (machineId == null) return undefined;
      return sim.assumed[machineId]?.[key];
    },
    getState: (machineId) => (machineId == null ? undefined : sim.states.get(machineId)),
  };
}

// ── per-step duration estimation (deterministic) ─────────────────────────────────

function commandDuration(sim: SimState, command: string): number {
  const override = sim.opts.commandDurations[command];
  return Number.isFinite(override) ? (override as number) : sim.opts.defaultCommandMs;
}

// ── command-verb → PackML command resolution (pure) ──────────────────────────────

/**
 * Resolve the PackML command a `command` step maps to, using the machine's E0
 * capability when its machineType is known, else a verb-name fallback. Returns:
 *   • a PackmlCommand when the verb drives a PackML transition,
 *   • "non_packml" when the verb is a valid command but NOT a state move (select_recipe…),
 *   • "unsupported" when the verb is not in the machine's capability,
 *   • "unknown_machine" when no machineType is known for the machine.
 */
type CmdResolution =
  | { kind: "packml"; command: PackmlCommand }
  | { kind: "non_packml" }
  | { kind: "unsupported" }
  | { kind: "unknown_machine" };

function resolveCommand(sim: SimState, machineId: number, verb: string): CmdResolution {
  const machine = sim.machines.get(machineId);
  if (!machine) {
    // No machineType known → capability cannot be resolved; treat the machine as unknown.
    return { kind: "unknown_machine" };
  }
  const cap = getCapabilitiesForMachine({
    machineType: machine.machineType,
    capabilities: machine.capabilities as never,
  });
  const descriptor = cap.supportedCommands.find((c) => c.name === verb);
  if (!descriptor) return { kind: "unsupported" };
  const pk = asPackmlCommand(descriptor.packmlCommand);
  if (pk) return { kind: "packml", command: pk };
  return { kind: "non_packml" };
}

// ── precondition / interlock (mirrors executor's checkPrecondition) ──────────────

type PreOutcome = null | { mode: "skip" } | { mode: "abort" } | { mode: "hold" };

function checkPrecondition(sim: SimState, step: WorkflowStep): PreOutcome {
  if (!step.precondition) return null;
  const ok = evaluateCondition(step.precondition, evalCtxOf(sim));
  if (ok) return null;
  const mode = step.onPreconditionFail ?? "hold";
  return { mode };
}

// ── the simulated step walker (mirrors foeEngine's control-flow) ─────────────────

/**
 * Simulate ONE step subtree starting at `startMs`. Returns the clock AFTER the step.
 * Fail-safe: a malformed step records a warning + a blocked entry, never throws.
 */
function simStep(sim: SimState, step: WorkflowStep, startMs: number): number {
  if (!step || typeof step !== "object") {
    warn(sim, "?", "malformed_step", "Encountered a non-object step.");
    sim.timeline.push({
      stepId: "?",
      stepType: "?",
      startMs,
      endMs: startMs,
      status: "blocked",
      note: "Malformed step (not an object).",
    });
    return startMs;
  }

  // Already aborting → record the step as skipped (0 duration) and move on.
  if (sim.aborted) {
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      startMs,
      endMs: startMs,
      status: "skipped",
      note: "Skipped — workflow aborting after a prior interlock abort.",
    });
    return startMs;
  }

  // Precondition / interlock — evaluated against the PREDICTED state BEFORE the step.
  const pre = checkPrecondition(sim, step);
  if (pre) {
    warn(sim, step.id, "precondition_fail", `Precondition failed (action: ${pre.mode}).`);
    if (pre.mode === "skip") {
      sim.timeline.push({
        stepId: step.id,
        stepType: step.type,
        startMs,
        endMs: startMs,
        status: "skipped",
        note: "Precondition failed → onPreconditionFail=skip.",
      });
      return startMs;
    }
    if (pre.mode === "abort") sim.aborted = true;
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      startMs,
      endMs: startMs,
      status: "blocked",
      note: `Precondition (interlock) failed → onPreconditionFail=${pre.mode}.`,
    });
    return startMs;
  }

  switch (step.type) {
    case "command":
      return simCommand(sim, step, startMs);
    case "delay": {
      const ms = Number.isFinite(step.ms) ? Math.max(0, step.ms) : 0;
      sim.timeline.push({
        stepId: step.id,
        stepType: step.type,
        startMs,
        endMs: startMs + ms,
        status: "ok",
        note: `Delay ${ms}ms.`,
      });
      return startMs + ms;
    }
    case "sequence":
      return simSequence(sim, step.steps ?? [], startMs, step);
    case "parallel":
      return simParallel(sim, step, startMs);
    case "branch":
      return simBranch(sim, step, startMs);
    case "wait_state":
      return simWaitState(sim, step, startMs);
    case "wait_telemetry":
      return simWaitTelemetry(sim, step, startMs);
    case "hitl_gate": {
      warn(sim, step.id, "needs_human", `Human gate: ${step.prompt ?? "(no prompt)"}`);
      const ms = sim.opts.gateMs;
      sim.timeline.push({
        stepId: step.id,
        stepType: step.type,
        startMs,
        endMs: startMs + ms,
        status: "gate",
        note: `Pause for human decision: ${step.prompt ?? "(no prompt)"}`,
      });
      return startMs + ms;
    }
    default: {
      warn(sim, (step as { id?: string }).id ?? "?", "malformed_step", `Unknown step type "${(step as { type?: string }).type}".`);
      sim.timeline.push({
        stepId: (step as { id?: string }).id ?? "?",
        stepType: String((step as { type?: string }).type),
        startMs,
        endMs: startMs,
        status: "blocked",
        note: `Unknown step type "${(step as { type?: string }).type}".`,
      });
      return startMs;
    }
  }
}

function simCommand(
  sim: SimState,
  step: Extract<WorkflowStep, { type: "command" }>,
  startMs: number,
): number {
  const dur = commandDuration(sim, step.command);
  const endMs = startMs + dur;
  const res = resolveCommand(sim, step.machineId, step.command);

  if (res.kind === "unknown_machine") {
    warn(sim, step.id, "invalid_machine", `No machineType known for machine ${step.machineId}; cannot resolve capability.`);
    // Still record the step; predicted state unknown (we leave the machine state as-is).
    const cur = stateOf(sim, step.machineId);
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      machineId: step.machineId,
      command: step.command,
      startMs,
      endMs,
      status: "warning",
      predictedState: cur,
      note: `Machine ${step.machineId} unknown — command "${step.command}" executed without a predicted PackML transition.`,
    });
    return endMs;
  }

  if (res.kind === "unsupported") {
    warn(sim, step.id, "unsupported_command", `Machine ${step.machineId} does not support command "${step.command}".`);
    const cur = stateOf(sim, step.machineId);
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      machineId: step.machineId,
      command: step.command,
      startMs,
      endMs: startMs,
      status: "blocked",
      predictedState: cur,
      note: `Unsupported command "${step.command}" on machine ${step.machineId}.`,
    });
    return startMs;
  }

  if (res.kind === "non_packml") {
    // e.g. select_recipe — "command executed", no state move.
    const cur = stateOf(sim, step.machineId);
    warn(sim, step.id, "non_packml_command", `Command "${step.command}" is not a PackML state transition (executed as a parameter/recipe op).`);
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      machineId: step.machineId,
      command: step.command,
      startMs,
      endMs,
      status: "ok",
      predictedState: cur,
      note: `Non-PackML command "${step.command}" executed (no state change).`,
    });
    return endMs;
  }

  // PackML command → predict the transition from the current predicted state.
  const cur = stateOf(sim, step.machineId);
  const next = nextOnCommand(cur, res.command);
  if (!next) {
    warn(
      sim,
      step.id,
      "illegal_transition",
      `PackML command "${res.command}" is not legal from state "${cur}" on machine ${step.machineId}.`,
    );
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      machineId: step.machineId,
      command: step.command,
      startMs,
      endMs: startMs,
      status: "blocked",
      predictedState: cur,
      note: `Illegal PackML transition: "${res.command}" from "${cur}".`,
    });
    return startMs;
  }

  // Apply the transition mid-step, then settle the transient ACTING state by step end.
  const midMs = startMs + Math.floor(dur / 2);
  setState(sim, step.machineId, midMs, next);
  const settled = settleState(next);
  const finalState = settled ?? next;
  if (settled) setState(sim, step.machineId, endMs, settled);

  sim.timeline.push({
    stepId: step.id,
    stepType: step.type,
    machineId: step.machineId,
    command: step.command,
    startMs,
    endMs,
    status: "ok",
    predictedState: finalState,
    note: `PackML "${res.command}": ${cur} → ${next}${settled ? ` → ${settled}` : ""}.`,
  });
  return endMs;
}

function simSequence(
  sim: SimState,
  steps: WorkflowStep[],
  startMs: number,
  container?: WorkflowStep,
): number {
  let clock = startMs;
  for (const child of steps) {
    // After an abort interlock, remaining steps are still WALKED so the Studio sees them
    // recorded as 'skipped' (simStep handles the aborted branch with 0 duration).
    clock = simStep(sim, child, clock);
  }
  // A sequence container itself contributes no extra time (it spans its children).
  void container;
  return clock;
}

function simParallel(
  sim: SimState,
  step: Extract<WorkflowStep, { type: "parallel" }>,
  startMs: number,
): number {
  const children = step.steps ?? [];
  let maxEnd = startMs;
  // Children SHARE the start time; the branch duration = max(child durations).
  for (const child of children) {
    const childEnd = simStep(sim, child, startMs);
    if (childEnd > maxEnd) maxEnd = childEnd;
  }
  sim.timeline.push({
    stepId: step.id,
    stepType: step.type,
    startMs,
    endMs: maxEnd,
    status: "ok",
    note: `Parallel of ${children.length} branch(es); duration = max child = ${maxEnd - startMs}ms.`,
  });
  return maxEnd;
}

function simBranch(
  sim: SimState,
  step: Extract<WorkflowStep, { type: "branch" }>,
  startMs: number,
): number {
  const take = evaluateCondition(step.condition, evalCtxOf(sim));
  sim.context[`branch:${step.id}`] = take ? "then" : "else";
  const path = take ? step.then ?? [] : step.else ?? [];
  sim.timeline.push({
    stepId: step.id,
    stepType: step.type,
    startMs,
    endMs: startMs,
    status: "ok",
    note: `Branch condition → "${take ? "then" : "else"}" path.`,
  });
  return simSequence(sim, path, startMs, step);
}

function simWaitState(
  sim: SimState,
  step: Extract<WorkflowStep, { type: "wait_state" }>,
  startMs: number,
): number {
  const targets = new Set<string>((step.targetStates ?? []) as string[]);
  const cur = stateOf(sim, step.machineId);
  // If a prior step already drove the machine into a target state → resolves instantly.
  if (targets.has(cur)) {
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      machineId: step.machineId,
      startMs,
      endMs: startMs,
      status: "ok",
      predictedState: cur,
      note: `Already in target state "${cur}" — wait resolves immediately.`,
    });
    return startMs;
  }
  // Otherwise it would time out (the twin does not run machines forward on its own).
  const timeoutMs = Number.isFinite(step.timeoutMs) ? Math.max(0, step.timeoutMs) : 0;
  warn(
    sim,
    step.id,
    "would_timeout",
    `wait_state on machine ${step.machineId} for [${[...targets].join(", ")}] would time out (predicted state "${cur}").`,
  );
  sim.timeline.push({
    stepId: step.id,
    stepType: step.type,
    machineId: step.machineId,
    startMs,
    endMs: startMs + timeoutMs,
    status: "warning",
    predictedState: cur,
    note: `Would time out after ${timeoutMs}ms (state "${cur}" not in target set).`,
  });
  return startMs + timeoutMs;
}

function simWaitTelemetry(
  sim: SimState,
  step: Extract<WorkflowStep, { type: "wait_telemetry" }>,
  startMs: number,
): number {
  const satisfied = evaluateCondition(step.condition, evalCtxOf(sim));
  if (satisfied) {
    sim.timeline.push({
      stepId: step.id,
      stepType: step.type,
      startMs,
      endMs: startMs,
      status: "ok",
      note: "wait_telemetry satisfied by assumed telemetry — resolves immediately.",
    });
    return startMs;
  }
  const timeoutMs = Number.isFinite(step.timeoutMs) ? Math.max(0, step.timeoutMs) : 0;
  // Distinguish "assumed telemetry present but false" vs "would time out".
  warn(
    sim,
    step.id,
    "would_timeout",
    `wait_telemetry not satisfied by assumed telemetry → would time out after ${timeoutMs}ms.`,
  );
  sim.timeline.push({
    stepId: step.id,
    stepType: step.type,
    startMs,
    endMs: startMs + timeoutMs,
    status: "warning",
    note: `Condition not satisfied by assumed telemetry — would time out after ${timeoutMs}ms.`,
  });
  return startMs + timeoutMs;
}

// ── public entry point ────────────────────────────────────────────────────────────

/**
 * PREDICT a workflow's execution WITHOUT any dispatch. PURE + DETERMINISTIC + FAIL-SAFE.
 *
 * @param def   the portable workflow definition
 * @param params  assumed run params (also passed via opts.params; this arg wins)
 * @param opts  tunable inputs (known machines, duration table, assumed telemetry)
 */
export function simulateWorkflow(
  def: WorkflowDefinition,
  params?: Record<string, unknown>,
  opts?: SimulateOptions,
): SimulationResult {
  // Validate first (structural only — capability checks need machine rows we may have).
  let validation;
  try {
    const machineRows = opts?.machines?.map((m) => ({
      id: m.id,
      machineType: m.machineType,
      capabilities: m.capabilities,
    }));
    validation = validateWorkflow(def, machineRows && machineRows.length ? machineRows : null);
  } catch (err) {
    return {
      ok: false,
      valid: false,
      errors: [err instanceof Error ? err.message : String(err)],
      timeline: [],
      warnings: [],
      totalDurationMs: 0,
      machineStateTrace: {},
    };
  }

  const errors = validation.errors.map((e: ValidationError) => `${e.path}: ${e.message}`);

  // Even when invalid, attempt a best-effort walk so the Studio can show partial timing —
  // but a fundamentally malformed def (no steps array) returns early.
  if (!def || typeof def !== "object" || !Array.isArray(def.steps)) {
    return {
      ok: false,
      valid: false,
      errors: errors.length ? errors : ["Definition must be an object with a steps[] array."],
      timeline: [],
      warnings: [],
      totalDurationMs: 0,
      machineStateTrace: {},
    };
  }

  const machineMap = new Map<number, { id: number; machineType: string; capabilities?: unknown }>();
  for (const m of opts?.machines ?? []) machineMap.set(m.id, m);

  const sim: SimState = {
    states: new Map(),
    trace: new Map(),
    machines: machineMap,
    timeline: [],
    warnings: [],
    params: { ...(opts?.params ?? {}), ...(params ?? {}) },
    context: {},
    assumed: opts?.assumedTelemetry ?? {},
    opts: {
      defaultCommandMs: Number.isFinite(opts?.defaultCommandMs)
        ? (opts?.defaultCommandMs as number)
        : DEFAULT_COMMAND_MS,
      gateMs: Number.isFinite(opts?.gateMs) ? (opts?.gateMs as number) : 0,
      commandDurations: opts?.commandDurations ?? {},
    },
    aborted: false,
  };

  let totalDurationMs = 0;
  try {
    totalDurationMs = simSequence(sim, def.steps, 0);
  } catch (err) {
    // FAIL-SAFE — a walk error never throws to the caller.
    // data-raw-ok: cảnh báo của BỘ MÔ PHỎNG kịch bản — công cụ cho kỹ sư đang dựng quy
    // trình, không phải bề mặt vận hành. Chuỗi gốc nói được bước nào dị dạng ở đâu.
    sim.warnings.push({ stepId: "?", kind: "malformed_step", message: err instanceof Error ? err.message : String(err) });
  }

  // ok = valid AND no blocked step in the timeline.
  const anyBlocked = sim.timeline.some((t) => t.status === "blocked");
  const machineStateTrace: Record<number, SimStatePoint[]> = {};
  for (const [id, pts] of sim.trace) machineStateTrace[id] = pts;

  return {
    ok: validation.ok && !anyBlocked,
    valid: validation.ok,
    errors,
    timeline: sim.timeline,
    warnings: sim.warnings,
    totalDurationMs,
    machineStateTrace,
  };
}
