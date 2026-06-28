/**
 * Phase E2 — Factory Control Plane: FACTORY ORCHESTRATION ENGINE (FOE) — WORKFLOW MODEL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A PORTABLE, ISA-88-ish JSON workflow definition + a SAFE (no `eval`) expression
 * evaluator + a structural/semantic validator. This module is PURE DATA + PURE
 * FUNCTIONS — it has NO side-effects, opens NO device path, and issues NO command.
 * The executor (foeEngine.ts) walks a definition and dispatches each `command` step
 * through the EXISTING E0 equipmentRegistry.sendCommand (HITL + dry-run preserved).
 *
 * A workflow = an ordered list of STEPS. Step types (a real, bounded set):
 *   • command       — { machineId, command, args } → equipmentRegistry.sendCommand
 *   • sequence      — child steps run one after another
 *   • parallel      — child steps run concurrently (Promise.allSettled)
 *   • branch        — { condition, then[], else[] } — pick a path by a condition
 *   • wait_state    — wait until a machine reaches a PackML state (or timeout)
 *   • wait_telemetry— wait until a telemetry condition holds (or timeout)
 *   • hitl_gate     — pause the run awaiting a human decision (resume via API)
 *   • delay         — { ms }
 *
 * Each step MAY declare:
 *   • precondition / interlock — a condition that MUST hold before the step runs
 *     (else the run HOLDS or ABORTS per onPreconditionFail).
 *   • compensation — a step to run if THIS step fails (saga-style undo).
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  getCapabilitiesForMachine,
  type EquipmentCapability,
} from "../../equipment/capabilityModel";
import { PACKML_STATES, type PackmlState } from "../../equipment/packml";

// ── Condition expression (safe — a tiny comparator, NO eval) ───────────────────

/** Comparison operators the evaluator supports. */
export type CompareOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in" | "nin" | "exists";

/** Where the LEFT operand of a comparison is read from. */
export type OperandSource = "param" | "telemetry" | "state" | "const" | "context";

/**
 * ONE leaf comparison. `source`+`key` resolve the left value from the run's
 * params / latest telemetry / machine state / context; `op` compares it to `value`.
 * Example: { source:"telemetry", machineId:5, key:"ng_count", op:"gt", value:0 }.
 */
export interface LeafCondition {
  source: OperandSource;
  /** machine to read telemetry/state from (required for source telemetry/state). */
  machineId?: number;
  /** the param/telemetry/context key (the literal value for source "const"). */
  key: string;
  op: CompareOp;
  /** right operand (a primitive or an array for in/nin). */
  value?: unknown;
}

/** A boolean combinator over child conditions (AND/OR/NOT). */
export interface CompositeCondition {
  all?: Condition[];
  any?: Condition[];
  not?: Condition;
}

/** A condition is either a leaf comparison or a composite combinator. */
export type Condition = LeafCondition | CompositeCondition;

/** What to do when a step's precondition/interlock does NOT hold. */
export type OnPreconditionFail = "hold" | "abort" | "skip";

// ── Steps ──────────────────────────────────────────────────────────────────────

export type StepType =
  | "command"
  | "sequence"
  | "parallel"
  | "branch"
  | "wait_state"
  | "wait_telemetry"
  | "hitl_gate"
  | "delay";

/** Fields every step shares. `id` is unique within a workflow definition. */
export interface BaseStep {
  id: string;
  type: StepType;
  label?: string;
  /** A condition that MUST hold before this step runs (interlock). */
  precondition?: Condition;
  /** Behaviour when the precondition fails (default: "hold"). */
  onPreconditionFail?: OnPreconditionFail;
  /** A compensation step run if THIS step fails (saga undo). */
  compensation?: WorkflowStep;
  /** Max retry attempts for this step on failure (default 0 — no retry). */
  maxAttempts?: number;
}

/** Issue ONE command to ONE machine, routed via equipmentRegistry.sendCommand. */
export interface CommandStep extends BaseStep {
  type: "command";
  machineId: number;
  /** Canonical command verb (must be in the machine's capability). */
  command: string;
  /** Command args (tag writes / job spec / recipe code …) — passed to the dispatcher. */
  args?: Record<string, unknown>;
}

/** Run child steps sequentially. */
export interface SequenceStep extends BaseStep {
  type: "sequence";
  steps: WorkflowStep[];
}

/** Run child steps concurrently (Promise.allSettled). */
export interface ParallelStep extends BaseStep {
  type: "parallel";
  steps: WorkflowStep[];
  /** If true, the FIRST failing branch fails the parallel; else fail only if all fail. */
  failFast?: boolean;
}

/** Pick a path by a condition. */
export interface BranchStep extends BaseStep {
  type: "branch";
  condition: Condition;
  then: WorkflowStep[];
  else?: WorkflowStep[];
}

/** Wait until a machine reaches a PackML state (or timeout). */
export interface WaitStateStep extends BaseStep {
  type: "wait_state";
  machineId: number;
  /** Target PackML state(s) — satisfied when the machine is in any of them. */
  targetStates: PackmlState[];
  timeoutMs: number;
  pollMs?: number;
}

/** Wait until a telemetry condition holds (or timeout). */
export interface WaitTelemetryStep extends BaseStep {
  type: "wait_telemetry";
  condition: Condition;
  timeoutMs: number;
  pollMs?: number;
}

/** Pause the run awaiting a human decision (resume via API). */
export interface HitlGateStep extends BaseStep {
  type: "hitl_gate";
  /** Operator-facing prompt. */
  prompt: string;
  /** Optional roles allowed to resolve the gate (advisory — RBAC is enforced at the API). */
  approverRoles?: string[];
}

/** A fixed delay. */
export interface DelayStep extends BaseStep {
  type: "delay";
  ms: number;
}

export type WorkflowStep =
  | CommandStep
  | SequenceStep
  | ParallelStep
  | BranchStep
  | WaitStateStep
  | WaitTelemetryStep
  | HitlGateStep
  | DelayStep;

/** A run-level parameter declaration (for the Studio / validation). */
export interface WorkflowParam {
  name: string;
  dataType: "bool" | "int" | "float" | "string" | "json";
  required?: boolean;
  default?: unknown;
}

/** The portable workflow definition (deployed + persisted as definitionJson). */
export interface WorkflowDefinition {
  /** Stable code/ref (unique). */
  ref: string;
  name: string;
  version?: number;
  description?: string;
  params?: WorkflowParam[];
  /** The ordered top-level steps (an implicit sequence). */
  steps: WorkflowStep[];
}

// ── Evaluation context + safe comparator ───────────────────────────────────────

/**
 * The runtime snapshot a condition is evaluated against. The executor supplies live
 * telemetry/state via callbacks (so the model stays pure). All getters are sync —
 * the executor pre-fetches what a condition references.
 */
export interface EvalContext {
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  /** Latest telemetry value for (machineId,key), or undefined. */
  getTelemetry?: (machineId: number | undefined, key: string) => unknown;
  /** Current PackML/device state for a machine, or undefined. */
  getState?: (machineId: number | undefined) => string | undefined;
}

function isComposite(c: Condition): c is CompositeCondition {
  return (
    typeof (c as CompositeCondition).all !== "undefined" ||
    typeof (c as CompositeCondition).any !== "undefined" ||
    typeof (c as CompositeCondition).not !== "undefined"
  );
}

/** Resolve the LEFT operand of a leaf condition from the eval context. */
function resolveOperand(leaf: LeafCondition, ctx: EvalContext): unknown {
  switch (leaf.source) {
    case "const":
      return leaf.value !== undefined ? leaf.value : leaf.key;
    case "param":
      return ctx.params?.[leaf.key];
    case "context":
      return ctx.context?.[leaf.key];
    case "telemetry":
      return ctx.getTelemetry ? ctx.getTelemetry(leaf.machineId, leaf.key) : undefined;
    case "state":
      return ctx.getState ? ctx.getState(leaf.machineId) : undefined;
    default:
      return undefined;
  }
}

/** Coerce both sides to numbers for an ordered comparison (NaN → not comparable). */
function asNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** Loose equality that treats number/string-number pairs as equal (deterministic). */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  const na = asNum(a);
  const nb = asNum(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  return String(a) === String(b);
}

/** Evaluate ONE leaf comparison (fail-safe; an unknown op → false). */
function evalLeaf(leaf: LeafCondition, ctx: EvalContext): boolean {
  const left = resolveOperand(leaf, ctx);
  const right = leaf.value;
  switch (leaf.op) {
    case "exists":
      return left !== undefined && left !== null;
    case "eq":
      return looseEq(left, right);
    case "neq":
      return !looseEq(left, right);
    case "lt":
      return asNum(left) < asNum(right);
    case "lte":
      return asNum(left) <= asNum(right);
    case "gt":
      return asNum(left) > asNum(right);
    case "gte":
      return asNum(left) >= asNum(right);
    case "in":
      return Array.isArray(right) && right.some((v) => looseEq(left, v));
    case "nin":
      return Array.isArray(right) && !right.some((v) => looseEq(left, v));
    default:
      return false;
  }
}

/**
 * Evaluate a condition (leaf or composite) against the context. PURE + fail-safe:
 * NEVER throws — a malformed condition resolves to `false` (interlocks fail CLOSED).
 */
export function evaluateCondition(condition: Condition | undefined, ctx: EvalContext): boolean {
  if (!condition) return true; // no condition → holds
  try {
    if (isComposite(condition)) {
      if (Array.isArray(condition.all)) {
        if (!condition.all.every((c) => evaluateCondition(c, ctx))) return false;
      }
      if (Array.isArray(condition.any)) {
        if (condition.any.length && !condition.any.some((c) => evaluateCondition(c, ctx))) return false;
      }
      if (condition.not) {
        if (evaluateCondition(condition.not, ctx)) return false;
      }
      return true;
    }
    return evalLeaf(condition, ctx);
  } catch {
    return false;
  }
}

// ── Validation ──────────────────────────────────────────────────────────────────

export interface ValidationError {
  /** Dotted path to the offending node (e.g. "steps[1].machineId"). */
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  /** Distinct machineIds referenced by command/wait steps (for capability checks). */
  referencedMachineIds: number[];
}

/** A minimal machine-row shape the validator needs (machineType + capabilities). */
export interface MachineForValidation {
  id: number;
  machineType: string;
  capabilities?: unknown;
}

const VALID_STATE_SET = new Set<string>(PACKML_STATES as readonly string[]);

function pushIdUnique(seen: Set<string>, id: string, path: string, errors: ValidationError[]): void {
  if (!id || typeof id !== "string") {
    errors.push({ path: `${path}.id`, message: "Step id is required and must be a non-empty string." });
    return;
  }
  if (seen.has(id)) {
    errors.push({ path: `${path}.id`, message: `Duplicate step id "${id}".` });
  }
  seen.add(id);
}

/**
 * Recursively validate a step's STRUCTURE + collect referenced machineIds. Capability
 * checks (command exists on the machine) are done in a second pass once machines load.
 */
function validateStep(
  step: WorkflowStep,
  path: string,
  seenIds: Set<string>,
  machineRefs: Set<number>,
  errors: ValidationError[],
): void {
  if (!step || typeof step !== "object") {
    errors.push({ path, message: "Step must be an object." });
    return;
  }
  pushIdUnique(seenIds, step.id, path, errors);

  if (step.maxAttempts !== undefined && (!Number.isInteger(step.maxAttempts) || step.maxAttempts < 0)) {
    errors.push({ path: `${path}.maxAttempts`, message: "maxAttempts must be a non-negative integer." });
  }
  if (step.compensation) {
    validateStep(step.compensation, `${path}.compensation`, seenIds, machineRefs, errors);
  }

  switch (step.type) {
    case "command": {
      if (!Number.isInteger(step.machineId) || step.machineId <= 0) {
        errors.push({ path: `${path}.machineId`, message: "command step needs a positive machineId." });
      } else {
        machineRefs.add(step.machineId);
      }
      if (!step.command || typeof step.command !== "string") {
        errors.push({ path: `${path}.command`, message: "command step needs a command verb." });
      }
      break;
    }
    case "sequence":
    case "parallel": {
      if (!Array.isArray(step.steps) || step.steps.length === 0) {
        errors.push({ path: `${path}.steps`, message: `${step.type} step needs a non-empty steps[].` });
      } else {
        step.steps.forEach((s, i) => validateStep(s, `${path}.steps[${i}]`, seenIds, machineRefs, errors));
      }
      break;
    }
    case "branch": {
      if (!step.condition) {
        errors.push({ path: `${path}.condition`, message: "branch step needs a condition." });
      } else {
        collectConditionMachines(step.condition, machineRefs);
      }
      if (!Array.isArray(step.then) || step.then.length === 0) {
        errors.push({ path: `${path}.then`, message: "branch step needs a non-empty then[]." });
      } else {
        step.then.forEach((s, i) => validateStep(s, `${path}.then[${i}]`, seenIds, machineRefs, errors));
      }
      if (Array.isArray(step.else)) {
        step.else.forEach((s, i) => validateStep(s, `${path}.else[${i}]`, seenIds, machineRefs, errors));
      }
      break;
    }
    case "wait_state": {
      if (!Number.isInteger(step.machineId) || step.machineId <= 0) {
        errors.push({ path: `${path}.machineId`, message: "wait_state step needs a positive machineId." });
      } else {
        machineRefs.add(step.machineId);
      }
      if (!Array.isArray(step.targetStates) || step.targetStates.length === 0) {
        errors.push({ path: `${path}.targetStates`, message: "wait_state step needs targetStates[]." });
      } else {
        step.targetStates.forEach((s, i) => {
          if (!VALID_STATE_SET.has(s)) {
            errors.push({ path: `${path}.targetStates[${i}]`, message: `Unknown PackML state "${s}".` });
          }
        });
      }
      if (!Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0) {
        errors.push({ path: `${path}.timeoutMs`, message: "wait_state step needs a positive timeoutMs." });
      }
      break;
    }
    case "wait_telemetry": {
      if (!step.condition) {
        errors.push({ path: `${path}.condition`, message: "wait_telemetry step needs a condition." });
      } else {
        collectConditionMachines(step.condition, machineRefs);
      }
      if (!Number.isFinite(step.timeoutMs) || step.timeoutMs <= 0) {
        errors.push({ path: `${path}.timeoutMs`, message: "wait_telemetry step needs a positive timeoutMs." });
      }
      break;
    }
    case "hitl_gate": {
      if (!step.prompt || typeof step.prompt !== "string") {
        errors.push({ path: `${path}.prompt`, message: "hitl_gate step needs a prompt." });
      }
      break;
    }
    case "delay": {
      if (!Number.isFinite(step.ms) || step.ms < 0) {
        errors.push({ path: `${path}.ms`, message: "delay step needs a non-negative ms." });
      }
      break;
    }
    default: {
      errors.push({ path: `${path}.type`, message: `Unknown step type "${(step as { type?: string }).type}".` });
    }
  }

  if (step.precondition) collectConditionMachines(step.precondition, machineRefs);
}

/** Walk a condition tree collecting any machineIds it reads telemetry/state from. */
function collectConditionMachines(c: Condition | undefined, refs: Set<number>): void {
  if (!c) return;
  if (isComposite(c)) {
    (c.all ?? []).forEach((x) => collectConditionMachines(x, refs));
    (c.any ?? []).forEach((x) => collectConditionMachines(x, refs));
    if (c.not) collectConditionMachines(c.not, refs);
    return;
  }
  if ((c.source === "telemetry" || c.source === "state") && Number.isInteger(c.machineId)) {
    refs.add(c.machineId as number);
  }
}

/**
 * Validate a workflow definition: STRUCTURE + that referenced machines exist + that
 * each command step's verb is in the machine's E0 capability. PURE + fail-safe.
 *
 * @param def       the workflow definition
 * @param machines  the resolved machine rows referenced (for capability checks). If
 *                  omitted, only structural validation runs (machine existence skipped).
 */
export function validateWorkflow(
  def: WorkflowDefinition,
  machines?: MachineForValidation[] | null,
): ValidationResult {
  const errors: ValidationError[] = [];
  const seenIds = new Set<string>();
  const machineRefs = new Set<number>();

  if (!def || typeof def !== "object") {
    return { ok: false, errors: [{ path: "$", message: "Definition must be an object." }], referencedMachineIds: [] };
  }
  if (!def.ref || typeof def.ref !== "string") {
    errors.push({ path: "ref", message: "Workflow ref is required." });
  }
  if (!def.name || typeof def.name !== "string") {
    errors.push({ path: "name", message: "Workflow name is required." });
  }
  if (!Array.isArray(def.steps) || def.steps.length === 0) {
    errors.push({ path: "steps", message: "Workflow needs a non-empty steps[]." });
  } else {
    def.steps.forEach((s, i) => validateStep(s, `steps[${i}]`, seenIds, machineRefs, errors));
  }

  // Second pass — machine existence + capability (only when machines provided).
  if (machines) {
    const byId = new Map<number, MachineForValidation>();
    for (const m of machines) byId.set(m.id, m);
    const capCache = new Map<number, EquipmentCapability>();
    const capOf = (m: MachineForValidation): EquipmentCapability => {
      let c = capCache.get(m.id);
      if (!c) {
        c = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
        capCache.set(m.id, c);
      }
      return c;
    };

    for (const id of machineRefs) {
      if (!byId.has(id)) {
        errors.push({ path: `machine:${id}`, message: `Referenced machine ${id} does not exist.` });
      }
    }

    // command verb must be supported by the machine's capability
    const checkCommandSteps = (steps: WorkflowStep[], path: string): void => {
      steps.forEach((step, i) => {
        const p = `${path}[${i}]`;
        if (step.type === "command") {
          const m = byId.get(step.machineId);
          if (m) {
            const cap = capOf(m);
            if (!cap.supportedCommands.some((c) => c.name === step.command)) {
              errors.push({
                path: `${p}.command`,
                message: `Machine ${step.machineId} (${m.machineType}) does not support command "${step.command}".`,
              });
            }
          }
        }
        if (step.type === "sequence" || step.type === "parallel") checkCommandSteps(step.steps, `${p}.steps`);
        if (step.type === "branch") {
          checkCommandSteps(step.then, `${p}.then`);
          if (step.else) checkCommandSteps(step.else, `${p}.else`);
        }
        if (step.compensation) checkCommandSteps([step.compensation], `${p}.compensation`);
      });
    };
    if (Array.isArray(def.steps)) checkCommandSteps(def.steps, "steps");
  }

  return { ok: errors.length === 0, errors, referencedMachineIds: [...machineRefs] };
}
