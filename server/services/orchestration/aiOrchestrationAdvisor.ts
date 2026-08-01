/**
 * Phase E5 — Factory Control Plane: AI-ASSISTED ORCHESTRATION ADVISOR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The AI side of the loop: given a goal / problem context + the AVAILABLE machines
 * and their E0 capabilities, the deep local model PROPOSES a multi-machine
 * WorkflowDefinition (GBNF/JSON-schema-constrained), which is then VALIDATED
 * (validateWorkflow) and SIMULATED on the digital twin (simulateWorkflow) BEFORE it
 * is ever shown to a human. `optimizeWorkflow` takes an existing definition and
 * suggests improvements (parallelize, add interlocks, reorder) — also validate +
 * simulate before returning.
 *
 * HITL ABSOLUTE — this module ONLY proposes a portable WorkflowDefinition. It opens
 * NO device path, issues NO command, and NEVER calls deployWorkflow / startRun. The
 * human reviews the proposal in the Studio and deploys/runs it through the EXISTING
 * orchestration router (which carries its own RBAC + HITL/dry-run dispatcher).
 *
 * FAIL-SAFE — flag off / AI unavailable / model emits an invalid def → an HONEST
 * degraded result (`available:false` or `valid:false` + message). NEVER throws.
 * DETERMINISTIC-ISH — temperature 0, fixed prompt scaffolding.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  validateWorkflow,
  type WorkflowDefinition,
  type ValidationError,
} from "./foe/workflowModel";
import {
  simulateWorkflow,
  type SimulationResult,
} from "./foe/foeSimulator";
import {
  getCapabilitiesForMachine,
  type EquipmentCapability,
} from "../equipment/capabilityModel";
import { route } from "../aiModelRouter";

export type AdvisorLang = "vi" | "en" | "zh";

/** A machine row the advisor reasons over (id + type + per-machine capability override). */
export interface AdvisorMachine {
  id: number;
  name?: string | null;
  machineType: string;
  capabilities?: unknown;
}

/** Optional problem/RCA context that steers the proposal. */
export interface AdvisorContext {
  defectType?: string;
  incidentId?: string | number;
  machineId?: number;
  /** A pre-formatted RCA / causal-graph hint block (built by the caller, e.g. router). */
  hint?: string;
}

export interface SuggestWorkflowInput {
  goal?: string;
  /** Restrict the proposal to these machines (else all supplied machines are eligible). */
  machineIds?: number[];
  context?: AdvisorContext;
  lang?: AdvisorLang;
  /** The known machines (id + machineType + capabilities). The router supplies these. */
  machines: AdvisorMachine[];
}

export interface AdvisorResult {
  /** True when the AI engine could actually run (GGUF available + flag on). */
  available: boolean;
  /** The candidate definition (best-effort; may be invalid — inspect `valid`). null when none. */
  workflow: WorkflowDefinition | null;
  /** True when validateWorkflow found no errors against the supplied machines. */
  valid: boolean;
  /** Human-readable validation errors (empty when valid). */
  validationErrors: string[];
  /** The twin simulation of the proposal (null when no workflow). */
  simulation: SimulationResult | null;
  /** The AI's rationale for the proposal (localized; may be empty). */
  rationale: string;
  /** A localized status / degrade message when not available or not valid. */
  message?: string;
}

export interface OptimizeWorkflowInput {
  workflow: WorkflowDefinition;
  machines: AdvisorMachine[];
  /** Optional optimization goal (e.g. "shorten cycle time", "add interlocks"). */
  goal?: string;
  lang?: AdvisorLang;
}

export interface OptimizeResult extends AdvisorResult {
  /** A human-readable diff/summary of what changed vs the input workflow. */
  diff: string[];
}

// ── Flag (default OFF) ───────────────────────────────────────────────────────────

/**
 * Master switch (opt-in). When OFF, suggest/optimize are SAFE NO-OPs returning an
 * honest `available:false` degraded result — never call the model.
 */
export function advisorEnabled(): boolean {
  const v = (process.env.AI_ORCHESTRATION_ADVISOR_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

// ── Localized messages ───────────────────────────────────────────────────────────

function msgDisabled(lang: AdvisorLang): string {
  switch (lang) {
    case "en":
      return "AI orchestration advisor is disabled (AI_ORCHESTRATION_ADVISOR_ENABLED off). It only proposes — a human still reviews and deploys.";
    case "zh":
      return "AI 编排顾问已禁用（AI_ORCHESTRATION_ADVISOR_ENABLED 关闭）。它仅提出建议——仍由人工审核并部署。";
    case "vi":
    default:
      return "Trợ lý AI điều phối đang TẮT (AI_ORCHESTRATION_ADVISOR_ENABLED off). AI chỉ đề xuất — con người vẫn duyệt và triển khai.";
  }
}

function msgUnavailable(lang: AdvisorLang): string {
  switch (lang) {
    case "en":
      return "The local AI model is not available (offline model not loaded). Could not produce a workflow proposal.";
    case "zh":
      return "本地 AI 模型不可用（离线模型未加载）。无法生成工作流建议。";
    case "vi":
    default:
      return "Mô hình AI cục bộ chưa khả dụng (model offline chưa nạp). Chưa thể tạo đề xuất quy trình.";
  }
}

function msgInvalid(lang: AdvisorLang): string {
  switch (lang) {
    case "en":
      return "The AI could not produce a VALID workflow (it failed validation/simulation even after a repair retry). Nothing was deployed — please refine the goal or build it manually in the Studio.";
    case "zh":
      return "AI 未能生成有效的工作流（重试修复后仍未通过校验/仿真）。未部署任何内容——请细化目标或在工作室中手动构建。";
    case "vi":
    default:
      return "AI chưa tạo được quy trình HỢP LỆ (không qua xác thực/mô phỏng kể cả sau một lần sửa lại). KHÔNG có gì được triển khai — hãy tinh chỉnh mục tiêu hoặc tự soạn trong Studio.";
  }
}

function msgEmptyMachines(lang: AdvisorLang): string {
  switch (lang) {
    case "en":
      return "No eligible machines were supplied — the advisor needs at least one machine with E0 capabilities to propose a workflow.";
    case "zh":
      return "未提供可用设备——顾问至少需要一台具有 E0 能力的设备才能提出工作流。";
    case "vi":
    default:
      return "Không có máy hợp lệ — trợ lý cần ít nhất một máy có năng lực E0 để đề xuất quy trình.";
  }
}

// ── JSON schema (GBNF-constrained output shape) ──────────────────────────────────
//
// A STRICT subset of WorkflowDefinition the decoder is constrained to. We keep the
// command/wait/branch/sequence/parallel/hitl_gate/delay step types, but each step is
// a flat object whose `type` is an enum so the model can only emit valid kinds. The
// post-validate pass (validateWorkflow) enforces deeper semantics (verb-in-capability,
// machine exists, unique ids, …). Nested steps are bounded to a small depth via a
// recursive-ish flattened schema (sequence/parallel/branch carry child arrays).

const LEAF_CONDITION_SCHEMA = {
  type: "object",
  properties: {
    source: { type: "string", enum: ["telemetry", "state", "param", "const", "context"] },
    machineId: { type: "number" },
    key: { type: "string" },
    op: { type: "string", enum: ["eq", "neq", "lt", "lte", "gt", "gte", "in", "nin", "exists"] },
    value: {},
  },
  required: ["source", "key", "op"],
} as const;

/**
 * Build the workflow JSON schema with a bounded recursion `depth`. The GBNF JSON-schema
 * grammar API does not support unbounded recursion, so we materialise the step schema to
 * a fixed maximum nesting depth (children of a container are themselves valid steps until
 * the depth budget is exhausted, after which only leaf steps are allowed).
 */
function buildStepSchema(depth: number): object {
  const childSchema = depth > 0 ? buildStepSchema(depth - 1) : buildLeafStepSchema();
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      type: {
        type: "string",
        enum: ["command", "sequence", "parallel", "branch", "wait_state", "wait_telemetry", "hitl_gate", "delay"],
      },
      label: { type: "string" },
      // command
      machineId: { type: "number" },
      command: { type: "string" },
      args: { type: "object" },
      // sequence/parallel
      steps: { type: "array", items: childSchema },
      failFast: { type: "boolean" },
      // branch
      condition: LEAF_CONDITION_SCHEMA,
      then: { type: "array", items: childSchema },
      else: { type: "array", items: childSchema },
      // wait_state
      targetStates: { type: "array", items: { type: "string" } },
      timeoutMs: { type: "number" },
      // hitl_gate
      prompt: { type: "string" },
      // delay
      ms: { type: "number" },
    },
    required: ["id", "type"],
  };
}

/** Leaf-only step schema (no child arrays) — terminates the bounded recursion. */
function buildLeafStepSchema(): object {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      type: {
        type: "string",
        enum: ["command", "wait_state", "wait_telemetry", "hitl_gate", "delay"],
      },
      label: { type: "string" },
      machineId: { type: "number" },
      command: { type: "string" },
      args: { type: "object" },
      condition: LEAF_CONDITION_SCHEMA,
      targetStates: { type: "array", items: { type: "string" } },
      timeoutMs: { type: "number" },
      prompt: { type: "string" },
      ms: { type: "number" },
    },
    required: ["id", "type"],
  };
}

const WORKFLOW_SCHEMA = {
  type: "object",
  properties: {
    ref: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
    rationale: { type: "string" },
    steps: { type: "array", items: buildStepSchema(3) },
  },
  required: ["ref", "name", "steps"],
} as const;

// ── Prompt building (deterministic) ──────────────────────────────────────────────

/** Render ONE machine's capability summary (only valid command verbs + telemetry). */
function describeMachine(m: AdvisorMachine, cap: EquipmentCapability): string {
  const cmds = cap.supportedCommands.map((c) => c.name).join(", ");
  const tele = cap.telemetryTags.map((t) => t.key).join(", ");
  const states = cap.supportedStates.join("/");
  return [
    `  - machineId=${m.id} (${m.name ?? m.machineType}, type=${m.machineType})`,
    `      commands: [${cmds}]`,
    `      telemetry: [${tele}]`,
    `      states: ${states}`,
  ].join("\n");
}

function buildSuggestPrompt(
  input: SuggestWorkflowInput,
  eligible: Array<{ m: AdvisorMachine; cap: EquipmentCapability }>,
): string {
  const lang = input.lang ?? "vi";
  const machineBlock = eligible.map(({ m, cap }) => describeMachine(m, cap)).join("\n");
  const ctxLines: string[] = [];
  if (input.goal) ctxLines.push(`GOAL: ${input.goal}`);
  if (input.context?.defectType) ctxLines.push(`DEFECT: ${input.context.defectType}`);
  if (input.context?.incidentId != null) ctxLines.push(`INCIDENT: ${input.context.incidentId}`);
  if (input.context?.machineId != null) ctxLines.push(`FOCUS MACHINE: ${input.context.machineId}`);
  if (input.context?.hint) ctxLines.push(`RCA/CAUSAL HINTS:\n${input.context.hint}`);

  return [
    "You are an industrial process-orchestration planner for the SYNAPSE factory control plane.",
    "Design a SAFE multi-machine workflow (ISA-88-style) that achieves the goal/problem below.",
    "You may ONLY use the machines and the command verbs listed (do NOT invent commands or machineIds).",
    "Each step needs a UNIQUE short `id`. Use these step types:",
    "  - command { machineId, command, args }     — one command to one machine",
    "  - sequence { steps[] } / parallel { steps[] }  — group steps (parallel = independent steps)",
    "  - branch { condition, then[], else? }       — pick a path by a telemetry/state/param condition",
    "  - wait_state { machineId, targetStates[], timeoutMs }  — wait for a PackML state",
    "  - wait_telemetry { condition, timeoutMs }   — wait for a telemetry condition",
    "  - hitl_gate { prompt }                      — pause for a human decision (use before risky actions)",
    "  - delay { ms }",
    "SAFETY: prefer adding a hitl_gate before high-risk start/stop/abort, and a precondition/interlock",
    "where a machine must be in a safe state. Parallelize ONLY independent steps. Keep it minimal.",
    "",
    "AVAILABLE MACHINES (use ONLY these):",
    machineBlock || "  (none)",
    "",
    "CONTEXT:",
    ctxLines.length ? ctxLines.join("\n") : "  (no extra context — produce a sensible default coordination workflow)",
    "",
    `Reply language for name/description/rationale: ${lang}.`,
    "Return ONLY JSON matching the schema: { ref, name, description, rationale, steps:[...] }.",
    "ref must be a short kebab-case code. Put your reasoning in `rationale`. No markdown, no prose outside JSON.",
  ].join("\n");
}

function buildOptimizePrompt(input: OptimizeWorkflowInput, machineBlock: string): string {
  const lang = input.lang ?? "vi";
  return [
    "You are optimizing an EXISTING industrial workflow for the SYNAPSE factory control plane.",
    "Improve it WITHOUT changing its goal: parallelize independent steps, add missing safety",
    "interlocks/preconditions, add hitl_gate before risky actions, and reorder to shorten cycle time.",
    "You may ONLY use the machines and command verbs listed (do NOT invent commands or machineIds).",
    "Keep every step id UNIQUE. Preserve the workflow's `ref` (you may bump a version in the name).",
    input.goal ? `OPTIMIZATION GOAL: ${input.goal}` : "OPTIMIZATION GOAL: shorter cycle time + safer interlocks.",
    "",
    "AVAILABLE MACHINES (use ONLY these):",
    machineBlock || "  (none)",
    "",
    "CURRENT WORKFLOW (JSON):",
    safeJson(input.workflow),
    "",
    `Reply language for name/description/rationale: ${lang}.`,
    "Return ONLY JSON matching the schema: { ref, name, description, rationale, steps:[...] }.",
    "Put a concise explanation of WHAT you changed and WHY in `rationale`. No markdown.",
  ].join("\n");
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 0);
  } catch {
    return "{}";
  }
}

// ── Model output → WorkflowDefinition normalization ──────────────────────────────

/** The raw shape the model returns (super-set of WorkflowDefinition + a rationale field). */
interface RawWorkflow {
  ref?: unknown;
  name?: unknown;
  description?: unknown;
  rationale?: unknown;
  steps?: unknown;
}

/**
 * Coerce the raw model output into a WorkflowDefinition + extracted rationale. We do NOT
 * deep-validate here (validateWorkflow does that) — we only shape the top-level fields so
 * the validator gets a well-typed object. Fail-safe: missing fields → empty/defaults.
 */
function normalize(raw: RawWorkflow): { def: WorkflowDefinition; rationale: string } {
  const ref = typeof raw.ref === "string" && raw.ref.trim() ? raw.ref.trim() : "ai-proposed-workflow";
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : "AI-proposed workflow";
  const description = typeof raw.description === "string" ? raw.description : undefined;
  const rationale = typeof raw.rationale === "string" ? raw.rationale : "";
  const steps = Array.isArray(raw.steps) ? (raw.steps as WorkflowDefinition["steps"]) : [];
  const def: WorkflowDefinition = { ref, name, steps };
  if (description) def.description = description;
  return { def, rationale };
}

// ── Validate + simulate a candidate (the gate every proposal passes through) ─────

function machineRows(machines: AdvisorMachine[]): Array<{ id: number; machineType: string; capabilities?: unknown }> {
  return machines.map((m) => ({ id: m.id, machineType: m.machineType, capabilities: m.capabilities }));
}

function validateAndSimulate(
  def: WorkflowDefinition,
  machines: AdvisorMachine[],
): { valid: boolean; validationErrors: string[]; simulation: SimulationResult } {
  const rows = machineRows(machines);
  const validation = validateWorkflow(def, rows.length ? rows : null);
  const validationErrors = validation.errors.map((e: ValidationError) => `${e.path}: ${e.message}`);
  // The twin is PURE + fail-safe — always safe to run for a preview.
  const simulation = simulateWorkflow(def, {}, { machines: rows });
  return { valid: validation.ok, validationErrors, simulation };
}

// ── generateJSON call (one place — easy to mock in tests) ─────────────────────────

/**
 * Run the deep planning model with a GBNF/JSON-schema-constrained decoder. Returns the
 * raw object or throws (callers wrap in try/catch). Uses the router to pick the deep tier.
 */
async function callModel(prompt: string): Promise<RawWorkflow> {
  // Route as a deep planning/RCA task → deep model tier. (route() is pure; we only read it
  // to derive the deep model id + a sane context budget — keeps behaviour consistent with
  // the rest of the AI stack.)
  const decision = route({ task: "rca", requiredQuality: "high", text: prompt });
  const { generateJSON } = await import("../aiGgufEngine");
  const { data } = await generateJSON<RawWorkflow>(
    WORKFLOW_SCHEMA,
    {
      prompt,
      maxTokens: 1536,
      temperature: 0,
      topP: 0.8,
      contextSize: decision.contextSize,
    },
    decision.modelId,
  );
  return data ?? {};
}

async function isAiAvailable(): Promise<boolean> {
  try {
    const { isGgufAvailable } = await import("../aiGgufEngine");
    return await isGgufAvailable();
  } catch {
    return false;
  }
}

// ── PUBLIC: suggestWorkflow ──────────────────────────────────────────────────────

/**
 * PROPOSE a multi-machine WorkflowDefinition for a goal/problem. The model is constrained
 * to the workflow schema and only sees the eligible machines + their E0 capabilities; the
 * result is VALIDATED + SIMULATED before return. If the first proposal is invalid, ONE
 * repair retry is attempted (feeding the validation errors back); still invalid → an honest
 * "could not produce a valid workflow" degraded result. NEVER deploys/runs. NEVER throws.
 */
export async function suggestWorkflow(input: SuggestWorkflowInput): Promise<AdvisorResult> {
  const lang = input.lang ?? "vi";
  const base: AdvisorResult = {
    available: false,
    workflow: null,
    valid: false,
    validationErrors: [],
    simulation: null,
    rationale: "",
  };

  // Flag OFF → safe no-op (never touch the model).
  if (!advisorEnabled()) {
    return { ...base, message: msgDisabled(lang) };
  }

  // Filter to eligible machines (machineIds restriction, if any).
  const allowed = input.machineIds && input.machineIds.length ? new Set(input.machineIds) : null;
  const eligible = (input.machines ?? [])
    .filter((m) => (allowed ? allowed.has(m.id) : true))
    .map((m) => ({ m, cap: getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never }) }));

  if (eligible.length === 0) {
    return { ...base, available: true, message: msgEmptyMachines(lang) };
  }

  if (!(await isAiAvailable())) {
    return { ...base, message: msgUnavailable(lang) };
  }

  const eligibleMachines = eligible.map((e) => e.m);
  let raw: RawWorkflow;
  try {
    raw = await callModel(buildSuggestPrompt(input, eligible));
  } catch {
    // Inference failure → honest degrade (no crash).
    return { ...base, available: true, message: msgUnavailable(lang) };
  }

  let { def, rationale } = normalize(raw);
  let { valid, validationErrors, simulation } = validateAndSimulate(def, eligibleMachines);

  // Repair-or-reject: one retry feeding the validation errors back to the model.
  if (!valid) {
    try {
      const repairPrompt = buildRepairPrompt(input, eligible, def, validationErrors);
      const raw2 = await callModel(repairPrompt);
      const norm2 = normalize(raw2);
      const sim2 = validateAndSimulate(norm2.def, eligibleMachines);
      if (sim2.valid) {
        def = norm2.def;
        rationale = norm2.rationale || rationale;
        valid = sim2.valid;
        validationErrors = sim2.validationErrors;
        simulation = sim2.simulation;
      } else {
        // keep the better-of-two for transparency, but flag it as invalid.
        validationErrors = sim2.validationErrors.length ? sim2.validationErrors : validationErrors;
      }
    } catch {
      // retry inference failed — fall through with the original (invalid) attempt.
    }
  }

  const result: AdvisorResult = {
    available: true,
    workflow: def,
    valid,
    validationErrors,
    simulation,
    rationale,
  };
  if (!valid) result.message = msgInvalid(lang);
  return result;
}

/** Build a repair prompt that asks the model to FIX the specific validation errors. */
function buildRepairPrompt(
  input: SuggestWorkflowInput,
  eligible: Array<{ m: AdvisorMachine; cap: EquipmentCapability }>,
  badDef: WorkflowDefinition,
  errors: string[],
): string {
  return [
    buildSuggestPrompt(input, eligible),
    "",
    "Your PREVIOUS attempt FAILED validation. Fix EXACTLY these errors and return corrected JSON:",
    ...errors.map((e) => `  - ${e}`),
    "PREVIOUS (invalid) JSON:",
    safeJson(badDef),
  ].join("\n");
}

// ── PUBLIC: optimizeWorkflow ─────────────────────────────────────────────────────

/**
 * Suggest improvements to an EXISTING workflow (parallelize, interlocks, reorder). Returns
 * a revised WorkflowDefinition + a diff/rationale + a fresh simulation. Validate + simulate
 * before returning; invalid revision → honest degrade (the original is unchanged, the caller
 * keeps it). NEVER deploys/runs. NEVER throws.
 */
export async function optimizeWorkflow(input: OptimizeWorkflowInput): Promise<OptimizeResult> {
  const lang = input.lang ?? "vi";
  const base: OptimizeResult = {
    available: false,
    workflow: null,
    valid: false,
    validationErrors: [],
    simulation: null,
    rationale: "",
    diff: [],
  };

  if (!advisorEnabled()) {
    return { ...base, message: msgDisabled(lang) };
  }
  if (!input.workflow || typeof input.workflow !== "object" || !Array.isArray(input.workflow.steps)) {
    return { ...base, available: true, message: msgInvalid(lang) };
  }

  const machines = input.machines ?? [];
  const machineBlock = machines
    .map((m) => describeMachine(m, getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never })))
    .join("\n");

  if (!(await isAiAvailable())) {
    return { ...base, message: msgUnavailable(lang) };
  }

  let raw: RawWorkflow;
  try {
    raw = await callModel(buildOptimizePrompt(input, machineBlock));
  } catch {
    return { ...base, available: true, message: msgUnavailable(lang) };
  }

  const { def, rationale } = normalize(raw);
  // Preserve the original ref so the human's revision tracks the same workflow.
  if (input.workflow.ref && (!def.ref || def.ref === "ai-proposed-workflow")) def.ref = input.workflow.ref;

  const { valid, validationErrors, simulation } = validateAndSimulate(def, machines);
  const diff = computeDiff(input.workflow, def);

  const result: OptimizeResult = {
    available: true,
    workflow: def,
    valid,
    validationErrors,
    simulation,
    rationale,
    diff,
  };
  if (!valid) result.message = msgInvalid(lang);
  return result;
}

/** A shallow, human-readable diff between two definitions (counts + timing delta). */
function computeDiff(before: WorkflowDefinition, after: WorkflowDefinition): string[] {
  const out: string[] = [];
  const cb = countSteps(before.steps);
  const ca = countSteps(after.steps);
  if (cb.total !== ca.total) out.push(`steps: ${cb.total} → ${ca.total}`);
  if (cb.parallel !== ca.parallel) out.push(`parallel groups: ${cb.parallel} → ${ca.parallel}`);
  if (cb.gates !== ca.gates) out.push(`hitl gates: ${cb.gates} → ${ca.gates}`);
  if (cb.interlocks !== ca.interlocks) out.push(`interlocks/preconditions: ${cb.interlocks} → ${ca.interlocks}`);
  // estimated cycle time via the twin (best-effort, no machines → still comparable structurally).
  try {
    const simB = simulateWorkflow(before, {}, {});
    const simA = simulateWorkflow(after, {}, {});
    if (simB.totalDurationMs !== simA.totalDurationMs) {
      out.push(`est. duration: ${(simB.totalDurationMs / 1000).toFixed(1)}s → ${(simA.totalDurationMs / 1000).toFixed(1)}s`);
    }
  } catch {
    /* diff is advisory — ignore timing errors */
  }
  if (out.length === 0) out.push("no structural change detected (see rationale)");
  return out;
}

interface StepCounts {
  total: number;
  parallel: number;
  gates: number;
  interlocks: number;
}

function countSteps(steps: WorkflowDefinition["steps"] | undefined): StepCounts {
  const c: StepCounts = { total: 0, parallel: 0, gates: 0, interlocks: 0 };
  const walk = (arr: WorkflowDefinition["steps"] | undefined): void => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      if (!s || typeof s !== "object") continue;
      c.total++;
      if (s.precondition) c.interlocks++;
      switch (s.type) {
        case "parallel":
          c.parallel++;
          walk(s.steps);
          break;
        case "sequence":
          walk(s.steps);
          break;
        case "branch":
          walk(s.then);
          walk(s.else);
          break;
        case "hitl_gate":
          c.gates++;
          break;
        default:
          break;
      }
    }
  };
  walk(steps);
  return c;
}

/** Advisor status (flag) for UI gating — mirrors the orchestration.status pattern. */
export function advisorStatus(): { enabled: boolean } {
  return { enabled: advisorEnabled() };
}
