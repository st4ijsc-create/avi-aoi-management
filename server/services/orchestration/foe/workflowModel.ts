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
  /**
   * Optional roles allowed to APPROVE the gate. doc 80 ORC-03 — ENFORCED by foeEngine.resumeRun:
   * an approver whose role is not listed is refused FORBIDDEN (admin is always allowed).
   */
  approverRoles?: string[];
  /**
   * doc 80 ORC-03 — four-eyes: when true, the user who STARTED the run may not approve this gate
   * (no admin exemption — four-eyes means a second person). Default false (unchanged behavior).
   */
  fourEyes?: boolean;
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
  /** Machine-readable code (optional) so a client can show its own translated sentence. Only set by `kiemTraKyTuIdBuoc`. */
  code?: string;
  /** For `STEP_ID_FORBIDDEN_CHAR`: the offending characters, readable (e.g. `"," and ")"`). */
  kyTu?: string;
  /** For `STEP_ID_TOO_LONG`: the actual length of the id / the longest length accepted. */
  doDai?: number;
  toiDa?: number;
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
 * Luật ĐẦU VÀO cho step id MỚI (chỉ đường GHI định nghĩa gọi hàm này; `validateWorkflow` KHÔNG đổi hành vi nên đường đọc / chạy /
 * mô phỏng / advisor vẫn nhận định nghĩa cũ). Lý do: trung tâm đọc danh sách id từ chữ `EDGE_OUTCOME_UNKNOWN(a,b,…)`; id chứa
 * "," hoặc ")" làm regex tách sai hoặc cắt danh sách ⇒ đọc thiếu. "(" và xuống dòng bị cấm cùng lý do (làm vỡ khuôn dòng).
 */
export const KY_TU_CAM_TRONG_STEP_ID: ReadonlyArray<{ ky: string; ten: string }> = [
  { ky: ",", ten: '","' },
  { ky: "(", ten: '"("' },
  { ky: ")", ten: '")"' },
  { ky: "\n", ten: "line feed (\\n)" },
  { ky: "\r", ten: "carriage return (\\r)" },
];
export const STEP_ID_FORBIDDEN_CHAR = "STEP_ID_FORBIDDEN_CHAR";
export const STEP_ID_TOO_LONG = "STEP_ID_TOO_LONG";
export const STEP_ID_ABORT_PREFIX = "STEP_ID_ABORT_PREFIX";
export const STEP_ID_RESERVED_MARKER = "STEP_ID_RESERVED_MARKER";
/**
 * Độ dài tối đa của step id MỚI = giới hạn thật: cột `orchestration_run_steps.stepId` là varchar(128) và `zStepId` max(128).
 * Hàng abort `abort:<stepId>` KHÔNG cần chừa tiền tố: `abortRowId` (foeEngine.ts) băm id dài (cắt + "~" + 10 hex sha256 của cả id)
 * nên hàng abort luôn ≤ 128. (Bản đầu đặt 121 dựa trên tiền đề sai "abort:" + id ≤ 128; HST sửa thành 128.)
 */
export const STEP_ID_TOI_DA = 128;
/** Bằng `ABORT_ROW_PREFIX` của foeRunStore.ts (không import vì foeRunStore import workflowModel; test ghim hai hằng bằng nhau). */
export const TIEN_TO_HANG_ABORT = "abort:";
/** Dấu rider nội bộ của luồng kết cục-không-rõ (A2(n)): id không được chứa chuỗi này (so khớp phân biệt hoa thường). */
export const DAU_HIEU_RIENG_STEP_ID = "[[A2N";
/** Khoá i18n `errors.reason.*` theo mã lỗi (đường duplicateWorkflow ném INVALID_VALUE với reason này). */
export const LY_DO_I18N_THEO_MA: Readonly<Record<string, string>> = {
  [STEP_ID_FORBIDDEN_CHAR]: "stepIdKyTuCam",
  [STEP_ID_TOO_LONG]: "stepIdQuaDai",
  [STEP_ID_ABORT_PREFIX]: "stepIdTienToAbort",
  [STEP_ID_RESERVED_MARKER]: "stepIdDauHieuRieng",
};

/**
 * Luật ĐẦU VÀO step id MỚI (xem `KY_TU_CAM_TRONG_STEP_ID`): ký tự cấm, dài ≤ 128, không bắt đầu "abort:", không chứa "[[A2N".
 * Mỗi step vi phạm MỖI luật ⇒ MỘT lỗi riêng (path `steps[i].id` / `….compensation.id`, mã + thông báo nêu ĐÚNG lý do).
 * Không ném lỗi với định nghĩa méo.
 */
export function kiemTraKyTuIdBuoc(def: WorkflowDefinition): ValidationError[] {
  const errors: ValidationError[] = [];
  const duyet = (s: unknown, path: string): void => {
    if (!s || typeof s !== "object") return;
    const step = s as Record<string, unknown>;
    if (typeof step.id === "string") {
      const id = step.id;
      const dau = `Step id ${JSON.stringify(id.length > 40 ? `${id.slice(0, 40)}…` : id)} at ${path}.id`;
      const gap = KY_TU_CAM_TRONG_STEP_ID.filter((k) => id.includes(k.ky));
      if (gap.length) {
        const ds = gap.map((k) => k.ten).join(" and ");
        errors.push({
          path: `${path}.id`,
          code: STEP_ID_FORBIDDEN_CHAR,
          kyTu: ds,
          message: `${dau} contains the forbidden character ${ds}: a new step id may not contain "," "(" ")" or a line break — rename the step id, then deploy again.`,
        });
      }
      if (id.length > STEP_ID_TOI_DA) {
        errors.push({
          path: `${path}.id`,
          code: STEP_ID_TOO_LONG,
          doDai: id.length,
          toiDa: STEP_ID_TOI_DA,
          message: `${dau} is ${id.length} characters long: a new step id may be at most ${STEP_ID_TOI_DA} — rename the step id, then deploy again.`,
        });
      }
      if (id.startsWith(TIEN_TO_HANG_ABORT)) {
        errors.push({
          path: `${path}.id`,
          code: STEP_ID_ABORT_PREFIX,
          message: `${dau} starts with "${TIEN_TO_HANG_ABORT}", which is reserved for the central abort rows: a new step id may not start with it — rename the step id, then deploy again.`,
        });
      }
      if (id.includes(DAU_HIEU_RIENG_STEP_ID)) {
        errors.push({
          path: `${path}.id`,
          code: STEP_ID_RESERVED_MARKER,
          message: `${dau} contains the reserved marker "${DAU_HIEU_RIENG_STEP_ID}": a new step id may not contain it — rename the step id, then deploy again.`,
        });
      }
    }
    if (step.compensation) duyet(step.compensation, `${path}.compensation`);
    for (const k of ["steps", "then", "else"] as const) {
      const con = step[k];
      if (Array.isArray(con)) con.forEach((c, i) => duyet(c, `${path}.${k}[${i}]`));
    }
  };
  const goc = def && typeof def === "object" ? (def as { steps?: unknown }).steps : undefined;
  if (Array.isArray(goc)) goc.forEach((s, i) => duyet(s, `steps[${i}]`));
  return errors;
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
