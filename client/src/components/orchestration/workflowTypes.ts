/**
 * Phase E3b — Visual Orchestration Studio: client-side workflow model + tree ops.
 *
 * A thin, EDITOR-FRIENDLY mirror of the server WorkflowDefinition
 * (server/services/orchestration/foe/workflowModel.ts). The editor keeps a loose,
 * always-buildable `StudioDef` in state (partial fields allowed mid-edit) and
 * `serializeDef` strips empties so the produced JSON validates server-side.
 *
 * This module is PURE — no React, no tRPC. The page binds to it.
 */

export type StepKind =
  | "command"
  | "sequence"
  | "parallel"
  | "branch"
  | "wait_state"
  | "wait_telemetry"
  | "hitl_gate"
  | "delay";

export const STEP_KINDS: StepKind[] = [
  "command",
  "sequence",
  "parallel",
  "branch",
  "wait_state",
  "wait_telemetry",
  "hitl_gate",
  "delay",
];

/** The 17 PackML states (mirrors server packml.ts PACKML_STATES). */
export const PACKML_STATES = [
  "Idle", "Starting", "Execute", "Completing", "Complete",
  "Holding", "Held", "Unholding", "Suspending", "Suspended",
  "Unsuspending", "Aborting", "Aborted", "Clearing", "Stopping",
  "Stopped", "Resetting",
] as const;

/** Comparison operators the server safe-evaluator supports. */
export const COMPARE_OPS = ["eq", "neq", "lt", "lte", "gt", "gte", "in", "nin", "exists"] as const;

/**
 * A single editor step — a superset of every server step type, with all
 * type-specific fields optional (the editor fills them in over time).
 */
/** Hành vi khi precondition/interlock KHÔNG thỏa (mirror server OnPreconditionFail). */
export type OnPreconditionFail = "hold" | "abort" | "skip";
export const ON_PRECONDITION_FAIL: OnPreconditionFail[] = ["hold", "abort", "skip"];

export interface StudioStep {
  id: string;
  type: StepKind;
  label?: string;
  // ── base (mọi loại) — mirror server BaseStep ──
  precondition?: Record<string, unknown>;
  onPreconditionFail?: OnPreconditionFail;
  compensation?: StudioStep;
  maxAttempts?: number;
  // command
  machineId?: number;
  command?: string;
  args?: Record<string, unknown>;
  // sequence / parallel
  steps?: StudioStep[];
  failFast?: boolean;
  // branch
  condition?: Record<string, unknown>;
  then?: StudioStep[];
  else?: StudioStep[];
  // wait_state / wait_telemetry
  targetStates?: string[];
  timeoutMs?: number;
  pollMs?: number;
  // delay
  ms?: number;
  // hitl_gate
  prompt?: string;
  approverRoles?: string[];
}

export interface StudioParam {
  name: string;
  dataType: "bool" | "int" | "float" | "string" | "json";
  required?: boolean;
  default?: unknown;
}

export interface StudioDef {
  ref: string;
  name: string;
  version?: number;
  description?: string;
  params?: StudioParam[];
  steps: StudioStep[];
}

// ── per-type display metadata (type-colored cards) ───────────────────────────

export const STEP_META: Record<StepKind, {
  labelKey: string;
  labelDefault: string;
  border: string;
  bg: string;
  iconBg: string;
  iconColor: string;
}> = {
  command:        { labelKey: "studio.type.command",       labelDefault: "Lệnh",            border: "border-blue-500/40",   bg: "bg-blue-500/5",   iconBg: "bg-blue-500/15",   iconColor: "text-blue-600" },
  sequence:       { labelKey: "studio.type.sequence",      labelDefault: "Tuần tự",         border: "border-slate-400/40", bg: "bg-slate-400/5", iconBg: "bg-slate-400/15", iconColor: "text-slate-600" },
  parallel:       { labelKey: "studio.type.parallel",      labelDefault: "Song song",       border: "border-indigo-500/40", bg: "bg-indigo-500/5", iconBg: "bg-indigo-500/15", iconColor: "text-indigo-600" },
  branch:         { labelKey: "studio.type.branch",        labelDefault: "Rẽ nhánh",        border: "border-amber-500/40",  bg: "bg-amber-500/5",  iconBg: "bg-amber-500/15",  iconColor: "text-amber-600" },
  wait_state:     { labelKey: "studio.type.wait_state",    labelDefault: "Chờ trạng thái",  border: "border-cyan-500/40",   bg: "bg-cyan-500/5",   iconBg: "bg-cyan-500/15",   iconColor: "text-cyan-600" },
  wait_telemetry: { labelKey: "studio.type.wait_telemetry", labelDefault: "Chờ telemetry",  border: "border-teal-500/40",   bg: "bg-teal-500/5",   iconBg: "bg-teal-500/15",   iconColor: "text-teal-600" },
  hitl_gate:      { labelKey: "studio.type.hitl_gate",     labelDefault: "Cổng duyệt",      border: "border-violet-500/40", bg: "bg-violet-500/5", iconBg: "bg-violet-500/15", iconColor: "text-violet-600" },
  delay:          { labelKey: "studio.type.delay",         labelDefault: "Chờ (delay)",     border: "border-rose-500/40",   bg: "bg-rose-500/5",   iconBg: "bg-rose-500/15",   iconColor: "text-rose-600" },
};

// ── factories ────────────────────────────────────────────────────────────────

export function emptyDef(): StudioDef {
  return { ref: "", name: "", version: 1, steps: [] };
}

/** Generate a unique step id within the definition (e.g. "command-1"). */
function genId(kind: StepKind, def: StudioDef): string {
  const used = new Set<string>();
  const walk = (steps: StudioStep[] | undefined) => {
    for (const s of steps ?? []) {
      used.add(s.id);
      walk(s.steps);
      walk(s.then);
      walk(s.else);
      if (s.compensation) used.add(s.compensation.id);
    }
  };
  walk(def.steps);
  let n = 1;
  let id = `${kind}-${n}`;
  while (used.has(id)) { n += 1; id = `${kind}-${n}`; }
  return id;
}

export function newStep(kind: StepKind, def: StudioDef): StudioStep {
  const base: StudioStep = { id: genId(kind, def), type: kind };
  switch (kind) {
    case "command": return { ...base, args: {} };
    case "sequence":
    case "parallel": return { ...base, steps: [] };
    case "branch": return { ...base, condition: { source: "telemetry", key: "", op: "gt", value: 0 }, then: [], else: [] };
    case "wait_state": return { ...base, targetStates: [], timeoutMs: 30000 };
    case "wait_telemetry": return { ...base, condition: { source: "telemetry", key: "", op: "gt", value: 0 }, timeoutMs: 30000 };
    case "hitl_gate": return { ...base, prompt: "" };
    case "delay": return { ...base, ms: 1000 };
    default: return base;
  }
}

export function cloneDef<T>(d: T): T {
  return JSON.parse(JSON.stringify(d)) as T;
}

// ── tree operations (mutate-in-place on a cloned tree) ───────────────────────

export function findStep(steps: StudioStep[], id: string): StudioStep | null {
  for (const s of steps) {
    if (s.id === id) return s;
    const lists = [s.steps, s.then, s.else];
    for (const l of lists) {
      if (l) { const found = findStep(l, id); if (found) return found; }
    }
  }
  return null;
}

export function updateStep(steps: StudioStep[], id: string, patch: Partial<StudioStep>): void {
  const target = findStep(steps, id);
  if (target) Object.assign(target, patch);
}

export function deleteStep(steps: StudioStep[], id: string): boolean {
  const idx = steps.findIndex((s) => s.id === id);
  if (idx >= 0) { steps.splice(idx, 1); return true; }
  for (const s of steps) {
    if (s.steps && deleteStep(s.steps, id)) return true;
    if (s.then && deleteStep(s.then, id)) return true;
    if (s.else && deleteStep(s.else, id)) return true;
  }
  return false;
}

/** Move a step up (-1) or down (+1) within its own sibling list. */
export function moveStep(steps: StudioStep[], id: string, dir: -1 | 1): boolean {
  const idx = steps.findIndex((s) => s.id === id);
  if (idx >= 0) {
    const j = idx + dir;
    if (j < 0 || j >= steps.length) return true; // at bound — no-op, but handled here
    [steps[idx], steps[j]] = [steps[j], steps[idx]];
    return true;
  }
  for (const s of steps) {
    if (s.steps && moveStep(s.steps, id, dir)) return true;
    if (s.then && moveStep(s.then, id, dir)) return true;
    if (s.else && moveStep(s.else, id, dir)) return true;
  }
  return false;
}

/** Append a child step into a container's slot (steps/then/else). */
export function addChild(steps: StudioStep[], parentId: string, slot: "steps" | "then" | "else", child: StudioStep): void {
  const parent = findStep(steps, parentId);
  if (!parent) return;
  const list = (parent[slot] ?? []) as StudioStep[];
  list.push(child);
  parent[slot] = list;
}

// ── serialize → server WorkflowDefinition (strip editor-only empties) ─────────

function serializeStep(s: StudioStep): Record<string, unknown> {
  const out: Record<string, unknown> = { id: s.id, type: s.type };
  if (s.label) out.label = s.label;
  // ── base optional fields (mirror server BaseStep) — chỉ emit khi có giá trị ──
  if (s.precondition) out.precondition = s.precondition;
  if (s.onPreconditionFail) out.onPreconditionFail = s.onPreconditionFail;
  if (s.compensation) out.compensation = serializeStep(s.compensation);
  if (typeof s.maxAttempts === "number" && s.maxAttempts > 0) out.maxAttempts = s.maxAttempts;
  switch (s.type) {
    case "command":
      out.machineId = s.machineId;
      out.command = s.command;
      if (s.args && Object.keys(s.args).length) out.args = s.args;
      break;
    case "sequence":
    case "parallel":
      out.steps = (s.steps ?? []).map(serializeStep);
      if (s.type === "parallel" && s.failFast) out.failFast = true;
      break;
    case "branch":
      out.condition = s.condition;
      out.then = (s.then ?? []).map(serializeStep);
      if (s.else && s.else.length) out.else = s.else.map(serializeStep);
      break;
    case "wait_state":
      out.machineId = s.machineId;
      out.targetStates = s.targetStates ?? [];
      out.timeoutMs = s.timeoutMs ?? 30000;
      if (typeof s.pollMs === "number" && s.pollMs > 0) out.pollMs = s.pollMs;
      break;
    case "wait_telemetry":
      out.condition = s.condition;
      out.timeoutMs = s.timeoutMs ?? 30000;
      if (typeof s.pollMs === "number" && s.pollMs > 0) out.pollMs = s.pollMs;
      break;
    case "hitl_gate":
      out.prompt = s.prompt ?? "";
      if (s.approverRoles && s.approverRoles.length) out.approverRoles = s.approverRoles;
      break;
    case "delay":
      out.ms = s.ms ?? 0;
      break;
  }
  return out;
}

/** Build the portable server-shape WorkflowDefinition from the editor state. */
export function serializeDef(def: StudioDef): Record<string, unknown> {
  const out: Record<string, unknown> = {
    ref: def.ref,
    name: def.name,
    steps: def.steps.map(serializeStep),
  };
  if (def.version != null) out.version = def.version;
  if (def.description) out.description = def.description;
  if (def.params && def.params.length) out.params = def.params;
  return out;
}
