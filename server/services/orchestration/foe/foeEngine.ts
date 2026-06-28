/**
 * Phase E2 — Factory Control Plane: FACTORY ORCHESTRATION ENGINE (FOE) — EXECUTOR.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The BUILD-OWN ISA-88-style workflow RUNTIME. It walks a portable WorkflowDefinition
 * (workflowModel.ts) and sequences COMMANDS ACROSS MULTIPLE MACHINES with interlocks,
 * HITL gates and saga compensation — dispatching EVERY control through the EXISTING
 * E0 equipmentRegistry.sendCommand (commandDispatcher / robotCommandDispatcher).
 *
 * SAFETY (ABSOLUTE — non-negotiable):
 *   • A `command` step NEVER opens a device path. It calls
 *     equipmentRegistry.getAdapter(kind).sendCommand(...) which honours the global
 *     OT_CONTROL_ENABLED / ROBOT_CONTROL_ENABLED dry-run gates + the HITL trigger.
 *     With control OFF (the default) the WHOLE workflow runs in SIMULATION and writes
 *     NOTHING — ideal for testing.
 *   • The engine is FLAG-GATED by FOE_ENABLED (default OFF). deployWorkflow/startRun
 *     return a disabled result when off.
 *   • FAIL-SAFE: an executor error NEVER crashes the process. The run transitions to
 *     'failed' with the error recorded.
 *   • DETERMINISTIC: no random control flow.
 *
 * Persistence: orchestration_workflows / _runs / _run_steps (drizzle). The executor
 * persists each step's state as it walks.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import {
  orchestrationWorkflows,
  orchestrationRuns,
  orchestrationRunSteps,
  machines,
  type OrchestrationRun,
} from "../../../../drizzle/schema";
import {
  validateWorkflow,
  evaluateCondition,
  type WorkflowDefinition,
  type WorkflowStep,
  type Condition,
  type EvalContext,
  type ValidationError,
  type MachineForValidation,
} from "./workflowModel";
import {
  getCapabilitiesForMachine,
  type EquipmentCapability,
  type CommandDescriptor,
} from "../../equipment/capabilityModel";
import {
  equipmentRegistry,
  type EquipmentCommand,
  type EquipmentCommandResult,
} from "../../equipment/equipmentAdapter";
import { asPackmlState } from "../../equipment/packml";

// ── Flag ────────────────────────────────────────────────────────────────────────

/** Read the flag at call time so config toggles / tests take effect. */
export function foeEnabled(): boolean {
  return process.env.FOE_ENABLED === "true" || process.env.FOE_ENABLED === "1";
}

// ── Public result shapes ─────────────────────────────────────────────────────────

export interface FoeUser {
  id: number;
  role: string;
  name?: string | null;
}

export interface DeployResult {
  ok: boolean;
  enabled: boolean;
  workflowId?: number;
  ref?: string;
  version?: number;
  errors?: ValidationError[];
  message?: string;
}

export interface StartRunResult {
  ok: boolean;
  enabled: boolean;
  runId?: number;
  status?: OrchestrationRun["status"];
  message?: string;
  errors?: ValidationError[];
}

export interface RunView {
  run: OrchestrationRun;
  steps: Array<{
    stepId: string;
    stepType: string;
    status: string;
    attempt: number;
    result: Record<string, unknown> | null;
    error: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }>;
}

/** Human gate decision used to resume a run paused at a hitl_gate / held step. */
export interface GateDecision {
  approved: boolean;
  note?: string;
}

// ── Internal exec context (in-memory; mirrors run.contextJson) ──────────────────

interface RunContext {
  runId: number;
  def: WorkflowDefinition;
  params: Record<string, unknown>;
  context: Record<string, unknown>;
  user: FoeUser;
  /** Resolved machine rows by id (for capability + adapter). */
  machineById: Map<number, MachineForValidation>;
  /** Latest telemetry cache used by condition evaluation (machineId|key → value). */
  telemetry: Map<string, unknown>;
  /** Latest device state cache (machineId → state). */
  states: Map<number, string>;
  /** When set, the walk pauses (a hitl_gate reached) at this step id. */
  pausedAtStepId?: string;
  /** True once an abort/fatal interlock has been requested — unwind toward 'failed'. */
  aborting?: boolean;
}

/** Outcome of executing a step subtree. */
type StepOutcome =
  | { kind: "ok" }
  | { kind: "skipped" }
  | { kind: "paused"; stepId: string } // hitl_gate / held → run pauses
  | { kind: "failed"; error: string }
  | { kind: "aborted"; error: string };

// ── db helpers (fail-safe) ───────────────────────────────────────────────────────

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not connected");
  return d;
}

async function loadMachines(ids: number[]): Promise<Map<number, MachineForValidation>> {
  const map = new Map<number, MachineForValidation>();
  if (ids.length === 0) return map;
  const d = await getDb();
  if (!d) return map;
  const rows = await d.select().from(machines);
  for (const m of rows) {
    if (ids.includes(m.id)) {
      map.set(m.id, { id: m.id, machineType: m.machineType, capabilities: m.capabilities });
    }
  }
  return map;
}

async function setRunStatus(
  runId: number,
  status: OrchestrationRun["status"],
  patch: Partial<OrchestrationRun> = {},
): Promise<void> {
  const d = await getDb();
  if (!d) return;
  await d
    .update(orchestrationRuns)
    .set({ status, updatedAt: new Date(), ...patch })
    .where(eq(orchestrationRuns.id, runId));
}

async function upsertStep(
  runId: number,
  stepId: string,
  stepType: string,
  patch: {
    status: string;
    attempt?: number;
    result?: Record<string, unknown> | null;
    error?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
  },
): Promise<void> {
  const d = await getDb();
  if (!d) return;
  // Upsert on (runId, stepId) — the table has a unique constraint there.
  await d
    .insert(orchestrationRunSteps)
    .values({
      runId,
      stepId,
      stepType,
      status: patch.status as never,
      attempt: patch.attempt ?? 0,
      resultJson: patch.result ?? null,
      error: patch.error ?? null,
      startedAt: patch.startedAt ?? null,
      finishedAt: patch.finishedAt ?? null,
    })
    .onConflictDoUpdate({
      target: [orchestrationRunSteps.runId, orchestrationRunSteps.stepId],
      set: {
        status: patch.status as never,
        attempt: patch.attempt ?? 0,
        resultJson: patch.result ?? null,
        error: patch.error ?? null,
        startedAt: patch.startedAt ?? undefined,
        finishedAt: patch.finishedAt ?? undefined,
      },
    });
}

async function persistContext(rc: RunContext): Promise<void> {
  const d = await getDb();
  if (!d) return;
  await d
    .update(orchestrationRuns)
    .set({
      contextJson: {
        ...rc.context,
        telemetry: Object.fromEntries(rc.telemetry),
        states: Object.fromEntries(rc.states),
      },
      updatedAt: new Date(),
    })
    .where(eq(orchestrationRuns.id, rc.runId));
}

// ── condition / telemetry helpers ────────────────────────────────────────────────

function evalCtxOf(rc: RunContext): EvalContext {
  return {
    params: rc.params,
    context: rc.context,
    getTelemetry: (machineId, key) =>
      machineId == null ? rc.telemetry.get(`*|${key}`) : rc.telemetry.get(`${machineId}|${key}`),
    getState: (machineId) => (machineId == null ? undefined : rc.states.get(machineId)),
  };
}

/**
 * Best-effort refresh of the telemetry/state caches a step's condition references.
 * Reads via the EquipmentAdapter (read-only). Fail-safe — never throws.
 */
async function refreshReadbacks(rc: RunContext, machineId: number | undefined): Promise<void> {
  if (machineId == null) return;
  const m = rc.machineById.get(machineId);
  if (!m) return;
  try {
    const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
    const adapter = equipmentRegistry.getAdapter(cap.adapterKind);
    if (adapter.getState) {
      const st = await adapter.getState({});
      const packml = asPackmlState(st.state);
      if (packml) rc.states.set(machineId, packml);
    }
    const samples = await adapter.readTelemetry({});
    for (const s of samples) rc.telemetry.set(`${machineId}|${s.key}`, s.value);
  } catch {
    // read failure → leave caches as-is; conditions fail-closed.
  }
}

// ── command building (mirrors api/v1 buildCommand; HITL trigger synthesized) ─────

function buildEquipmentCommand(
  descriptor: CommandDescriptor,
  capability: EquipmentCapability,
  machineId: number,
  args: Record<string, unknown>,
  idempotencyKey: string,
  user: FoeUser,
): EquipmentCommand {
  const isRobot = capability.adapterKind === "robot" || capability.adapterKind === "vda5050";
  const cmd: EquipmentCommand = {
    name: descriptor.name,
    machineId,
    idempotencyKey,
    // FOE is an automated multi-step actor; the dispatcher STILL applies its dry-run
    // gate. actionId tags the audit trail; requestedBy carries the run's user.
    hitl: { actionId: `foe-${idempotencyKey}`, requestedBy: user.id || 0 },
  };
  if (isRobot) {
    cmd.robotId = typeof args.robotId === "number" ? args.robotId : machineId;
    if (descriptor.name === "run_job" && typeof args.jobType === "string") {
      cmd.job = { jobType: args.jobType as never, params: (args.params as Record<string, unknown>) ?? {} };
    }
  } else {
    cmd.adapterId = typeof args.adapterId === "number" ? args.adapterId : machineId;
    if (Array.isArray(args.writes)) {
      cmd.writes = (args.writes as Array<{ tagKey: string; value: unknown }>).filter(
        (w) => w && typeof w.tagKey === "string",
      );
    } else if (typeof args.tagKey === "string") {
      cmd.writes = [{ tagKey: args.tagKey, value: args.value }];
    }
  }
  return cmd;
}

// ── the step walker ───────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Run a precondition/interlock for a step. Returns null if it holds, else an outcome. */
async function checkPrecondition(rc: RunContext, step: WorkflowStep): Promise<StepOutcome | null> {
  if (!step.precondition) return null;
  // refresh any machine readbacks the condition needs
  await refreshConditionReadbacks(rc, step.precondition);
  const ok = evaluateCondition(step.precondition, evalCtxOf(rc));
  if (ok) return null;
  const mode = step.onPreconditionFail ?? "hold";
  if (mode === "skip") return { kind: "skipped" };
  if (mode === "abort") return { kind: "aborted", error: `Precondition failed for step "${step.id}" (abort).` };
  return { kind: "failed", error: `Precondition (interlock) failed for step "${step.id}" (hold).` };
}

async function refreshConditionReadbacks(rc: RunContext, c: Condition | undefined): Promise<void> {
  if (!c) return;
  const ids = new Set<number>();
  collect(c, ids);
  for (const id of ids) await refreshReadbacks(rc, id);
  function collect(cond: Condition, acc: Set<number>): void {
    const comp = cond as { all?: Condition[]; any?: Condition[]; not?: Condition };
    if (comp.all || comp.any || comp.not) {
      (comp.all ?? []).forEach((x) => collect(x, acc));
      (comp.any ?? []).forEach((x) => collect(x, acc));
      if (comp.not) collect(comp.not, acc);
      return;
    }
    const leaf = cond as { source?: string; machineId?: number };
    if ((leaf.source === "telemetry" || leaf.source === "state") && typeof leaf.machineId === "number") {
      acc.add(leaf.machineId);
    }
  }
}

/** Execute ONE step subtree. Persists state; routes commands via E0. Fail-safe. */
async function execStep(rc: RunContext, step: WorkflowStep): Promise<StepOutcome> {
  if (rc.aborting) return { kind: "aborted", error: "Run is aborting." };

  // Precondition / interlock
  const pre = await checkPrecondition(rc, step);
  if (pre) {
    if (pre.kind === "skipped") {
      await upsertStep(rc.runId, step.id, step.type, { status: "skipped", finishedAt: new Date() });
    } else {
      await upsertStep(rc.runId, step.id, step.type, {
        status: pre.kind === "aborted" ? "failed" : "held",
        error: "error" in pre ? pre.error : null,
        finishedAt: new Date(),
      });
    }
    return pre;
  }

  await upsertStep(rc.runId, step.id, step.type, { status: "running", startedAt: new Date() });

  let outcome: StepOutcome;
  const maxAttempts = Math.max(1, (step.maxAttempts ?? 0) + 1);
  let attempt = 0;
  // retry loop (deterministic; only command/wait steps benefit, others run once)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    outcome = await runStepBody(rc, step, attempt);
    if (outcome.kind !== "failed" || attempt >= maxAttempts) break;
  }

  // persist terminal step state (paused steps stay 'awaiting_confirm'/'held')
  if (outcome.kind === "ok") {
    await upsertStep(rc.runId, step.id, step.type, { status: "completed", attempt, finishedAt: new Date() });
  } else if (outcome.kind === "skipped") {
    await upsertStep(rc.runId, step.id, step.type, { status: "skipped", attempt, finishedAt: new Date() });
  } else if (outcome.kind === "paused") {
    // step-level status already set by the body (awaiting_confirm)
  } else {
    // failed / aborted → run compensation if declared
    await upsertStep(rc.runId, step.id, step.type, {
      status: "failed",
      attempt,
      error: "error" in outcome ? outcome.error : null,
      finishedAt: new Date(),
    });
    if (step.compensation) {
      await runCompensation(rc, step);
    }
  }
  return outcome;
}

/** Run the inner logic of a single step (after precondition + status=running). */
async function runStepBody(rc: RunContext, step: WorkflowStep, attempt: number): Promise<StepOutcome> {
  try {
    switch (step.type) {
      case "command":
        return await execCommand(rc, step, attempt);
      case "delay":
        await sleep(step.ms);
        return { kind: "ok" };
      case "sequence":
        return await execSequence(rc, step.steps);
      case "parallel":
        return await execParallel(rc, step.steps, step.failFast === true);
      case "branch": {
        await refreshConditionReadbacks(rc, step.condition);
        const take = evaluateCondition(step.condition, evalCtxOf(rc));
        rc.context[`branch:${step.id}`] = take ? "then" : "else";
        await upsertStep(rc.runId, step.id, step.type, {
          status: "running",
          result: { branch: take ? "then" : "else" },
        });
        const path = take ? step.then : step.else ?? [];
        return await execSequence(rc, path);
      }
      case "wait_state":
        return await execWaitState(rc, step);
      case "wait_telemetry":
        return await execWaitTelemetry(rc, step);
      case "hitl_gate": {
        // pause the run; persist step as awaiting_confirm; resumeRun continues it.
        await upsertStep(rc.runId, step.id, step.type, {
          status: "awaiting_confirm",
          result: { prompt: step.prompt, approverRoles: step.approverRoles ?? null },
        });
        rc.pausedAtStepId = step.id;
        return { kind: "paused", stepId: step.id };
      }
      default:
        return { kind: "failed", error: `Unknown step type "${(step as { type?: string }).type}".` };
    }
  } catch (err) {
    // FAIL-SAFE — a step throwing never crashes the executor.
    return { kind: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

async function execCommand(rc: RunContext, step: Extract<WorkflowStep, { type: "command" }>, attempt: number): Promise<StepOutcome> {
  const m = rc.machineById.get(step.machineId);
  if (!m) return { kind: "failed", error: `Machine ${step.machineId} not found.` };
  const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
  const descriptor = cap.supportedCommands.find((c) => c.name === step.command);
  if (!descriptor) {
    return { kind: "failed", error: `Command "${step.command}" not supported by machine ${step.machineId}.` };
  }
  const idempotencyKey = `run${rc.runId}-${step.id}-a${attempt}`;
  const cmd = buildEquipmentCommand(descriptor, cap, step.machineId, step.args ?? {}, idempotencyKey, rc.user);

  // ROUTE THROUGH E0 → existing HITL/dry-run dispatcher. NEVER a direct device path.
  const adapter = equipmentRegistry.getAdapter(cap.adapterKind);
  const result: EquipmentCommandResult = await adapter.sendCommand(cmd);

  await upsertStep(rc.runId, step.id, step.type, {
    status: "running",
    result: {
      routedTo: result.routedTo,
      status: result.status,
      accepted: result.ok,
      simulated: result.detail?.simulated ?? undefined,
      detail: result.detail ?? null,
    },
  });

  if (!result.ok) {
    return { kind: "failed", error: result.error ?? `Command "${step.command}" rejected (${result.status}).` };
  }
  return { kind: "ok" };
}

async function execSequence(rc: RunContext, steps: WorkflowStep[]): Promise<StepOutcome> {
  for (const child of steps) {
    const out = await execStep(rc, child);
    if (out.kind === "paused" || out.kind === "failed" || out.kind === "aborted") return out;
    // 'ok' / 'skipped' → continue
  }
  return { kind: "ok" };
}

async function execParallel(rc: RunContext, steps: WorkflowStep[], failFast: boolean): Promise<StepOutcome> {
  const results = await Promise.allSettled(steps.map((s) => execStep(rc, s)));
  const outcomes: StepOutcome[] = results.map((r) =>
    r.status === "fulfilled" ? r.value : { kind: "failed", error: String(r.reason) },
  );
  // A hitl_gate inside a parallel branch pauses the whole run.
  const paused = outcomes.find((o) => o.kind === "paused");
  if (paused) return paused;
  const aborted = outcomes.find((o) => o.kind === "aborted");
  if (aborted) return aborted;
  const failures = outcomes.filter((o) => o.kind === "failed") as Array<{ kind: "failed"; error: string }>;
  if (failures.length > 0) {
    if (failFast || failures.length === outcomes.length) {
      return { kind: "failed", error: `Parallel branch failed: ${failures.map((f) => f.error).join("; ")}` };
    }
  }
  return { kind: "ok" };
}

async function execWaitState(rc: RunContext, step: Extract<WorkflowStep, { type: "wait_state" }>): Promise<StepOutcome> {
  const deadline = Date.now() + step.timeoutMs;
  const pollMs = Math.max(1, step.pollMs ?? Math.min(250, step.timeoutMs));
  const targets = new Set<string>(step.targetStates as string[]);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await refreshReadbacks(rc, step.machineId);
    const current = rc.states.get(step.machineId);
    if (current && targets.has(current)) {
      await upsertStep(rc.runId, step.id, step.type, { status: "running", result: { reachedState: current } });
      return { kind: "ok" };
    }
    if (Date.now() >= deadline) {
      return { kind: "failed", error: `wait_state timeout (machine ${step.machineId} state="${current ?? "?"}").` };
    }
    await sleep(pollMs);
  }
}

async function execWaitTelemetry(rc: RunContext, step: Extract<WorkflowStep, { type: "wait_telemetry" }>): Promise<StepOutcome> {
  const deadline = Date.now() + step.timeoutMs;
  const pollMs = Math.max(1, step.pollMs ?? Math.min(250, step.timeoutMs));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await refreshConditionReadbacks(rc, step.condition);
    if (evaluateCondition(step.condition, evalCtxOf(rc))) {
      await upsertStep(rc.runId, step.id, step.type, { status: "running", result: { satisfied: true } });
      return { kind: "ok" };
    }
    if (Date.now() >= deadline) {
      return { kind: "failed", error: `wait_telemetry timeout for step "${step.id}".` };
    }
    await sleep(pollMs);
  }
}

/** Run a step's compensation (saga undo). Fail-safe — records but never throws. */
async function runCompensation(rc: RunContext, step: WorkflowStep): Promise<void> {
  if (!step.compensation) return;
  try {
    await setRunStatus(rc.runId, "compensating");
    const comp = step.compensation;
    // run the compensation step body once (no nested compensation cascade)
    await upsertStep(rc.runId, comp.id, comp.type, { status: "running", startedAt: new Date() });
    const out = await runStepBody(rc, comp, 1);
    await upsertStep(rc.runId, comp.id, comp.type, {
      status: out.kind === "ok" ? "compensated" : "failed",
      error: "error" in out ? out.error : null,
      finishedAt: new Date(),
    });
  } catch {
    // swallow — compensation failures must not crash the run unwind.
  }
}

// ── run driver: walk the top-level sequence from a resume point ──────────────────

/**
 * Drive the run: walk the top-level steps. Returns the terminal/paused run status.
 * Resume re-enters here; a hitl_gate that was just approved is treated as 'completed'
 * and the walk continues PAST it (the gate's id is recorded as resolved in context).
 */
async function driveRun(rc: RunContext): Promise<OrchestrationRun["status"]> {
  await setRunStatus(rc.runId, "running", { startedAt: new Date() });
  const out = await execSequence(rc, rc.def.steps);

  if (out.kind === "paused") {
    await setRunStatus(rc.runId, "awaiting_confirm", { currentStepId: out.stepId });
    await persistContext(rc);
    return "awaiting_confirm";
  }
  if (out.kind === "aborted") {
    await setRunStatus(rc.runId, "aborted", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "aborted";
  }
  if (out.kind === "failed") {
    await setRunStatus(rc.runId, "failed", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "failed";
  }
  await setRunStatus(rc.runId, "completed", { finishedAt: new Date() });
  await persistContext(rc);
  return "completed";
}

/**
 * Build a RunContext from a persisted run + its workflow. Loads referenced machines.
 * `resolvedGates` are gate stepIds already approved (so the walk skips past them).
 */
async function buildRunContext(
  run: OrchestrationRun,
  def: WorkflowDefinition,
  user: FoeUser,
): Promise<RunContext> {
  const validation = validateWorkflow(def, null);
  const machineMap = await loadMachines(validation.referencedMachineIds);
  const context = (run.contextJson as Record<string, unknown>) ?? {};
  const telemetry = new Map<string, unknown>(
    Object.entries((context.telemetry as Record<string, unknown>) ?? {}),
  );
  const states = new Map<number, string>(
    Object.entries((context.states as Record<string, string>) ?? {}).map(([k, v]) => [Number(k), v]),
  );
  return {
    runId: run.id,
    def,
    params: (run.paramsJson as Record<string, unknown>) ?? {},
    context,
    user,
    machineById: machineMap,
    telemetry,
    states,
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Deploy (validate + persist) a workflow definition. Upserts by ref (bumps version).
 * Flag-gated: FOE_ENABLED off → a disabled result (no persistence).
 */
export async function deployWorkflow(def: WorkflowDefinition, user: FoeUser): Promise<DeployResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  try {
    // structural validation first (no machines)
    const structural = validateWorkflow(def, null);
    if (!structural.ok) return { ok: false, enabled: true, errors: structural.errors };

    // semantic validation against the referenced machines
    const machineMap = await loadMachines(structural.referencedMachineIds);
    const full = validateWorkflow(def, [...machineMap.values()]);
    if (!full.ok) return { ok: false, enabled: true, errors: full.errors };

    const d = await db();
    const existing = await d
      .select()
      .from(orchestrationWorkflows)
      .where(eq(orchestrationWorkflows.ref, def.ref))
      .limit(1);
    const nextVersion = existing.length ? (existing[0].version ?? 1) + 1 : def.version ?? 1;
    const definitionJson: WorkflowDefinition = { ...def, version: nextVersion };

    if (existing.length) {
      await d
        .update(orchestrationWorkflows)
        .set({
          name: def.name,
          description: def.description ?? null,
          definitionJson,
          version: nextVersion,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(orchestrationWorkflows.id, existing[0].id));
      return { ok: true, enabled: true, workflowId: existing[0].id, ref: def.ref, version: nextVersion };
    }
    const [row] = await d
      .insert(orchestrationWorkflows)
      .values({
        ref: def.ref,
        name: def.name,
        description: def.description ?? null,
        definitionJson,
        version: nextVersion,
        status: "active",
        createdBy: user.id || null,
      })
      .returning();
    return { ok: true, enabled: true, workflowId: row.id, ref: def.ref, version: nextVersion };
  } catch (err) {
    return { ok: false, enabled: true, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Start a run of a deployed workflow (by ref). Creates the run row, then kicks the
 * executor. The executor is fail-safe — any error transitions the run to 'failed'.
 * Flag-gated. Returns once the run reaches a terminal/paused state (awaitable).
 */
export async function startRun(
  workflowRef: string,
  params: Record<string, unknown>,
  user: FoeUser,
): Promise<StartRunResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  let runId: number | undefined;
  try {
    const d = await db();
    const [wf] = await d
      .select()
      .from(orchestrationWorkflows)
      .where(eq(orchestrationWorkflows.ref, workflowRef))
      .limit(1);
    if (!wf) return { ok: false, enabled: true, message: `Workflow "${workflowRef}" not found.` };

    const def = wf.definitionJson as WorkflowDefinition;
    const [run] = await d
      .insert(orchestrationRuns)
      .values({
        workflowId: wf.id,
        workflowRef: wf.ref,
        status: "queued",
        paramsJson: params ?? {},
        contextJson: {},
        startedBy: user.id || null,
        startedAt: new Date(),
      })
      .returning();
    runId = run.id;

    const rc = await buildRunContext(run, def, user);
    const status = await driveRun(rc);
    return { ok: status !== "failed" && status !== "aborted", enabled: true, runId: run.id, status };
  } catch (err) {
    // FAIL-SAFE — never throw to the caller; mark the run failed if we created it.
    const message = err instanceof Error ? err.message : String(err);
    if (runId != null) {
      await setRunStatus(runId, "failed", { finishedAt: new Date(), error: message }).catch(() => undefined);
    }
    return { ok: false, enabled: true, runId, status: "failed", message };
  }
}

/** Fetch a run + its per-step audit (read-only). */
export async function getRun(runId: number): Promise<RunView | null> {
  const d = await getDb();
  if (!d) return null;
  const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
  if (!run) return null;
  const stepRows = await d
    .select()
    .from(orchestrationRunSteps)
    .where(eq(orchestrationRunSteps.runId, runId));
  return {
    run,
    steps: stepRows.map((s) => ({
      stepId: s.stepId,
      stepType: s.stepType,
      status: s.status,
      attempt: s.attempt,
      result: (s.resultJson as Record<string, unknown>) ?? null,
      error: s.error ?? null,
      startedAt: s.startedAt ?? null,
      finishedAt: s.finishedAt ?? null,
    })),
  };
}

/**
 * Resume a run paused at a hitl_gate (awaiting_confirm) or held. A decision of
 * {approved:false} aborts the run. On approval, the gate step is marked completed and
 * the walk re-runs from the top (already-completed steps are idempotent / re-dispatch
 * is dry-run-safe; the gate is skipped because it is now resolved). Flag-gated.
 */
export async function resumeRun(
  runId: number,
  decision: GateDecision,
  user: FoeUser,
): Promise<StartRunResult> {
  if (!foeEnabled()) {
    return { ok: false, enabled: false, message: "FOE is disabled (set FOE_ENABLED=true)." };
  }
  try {
    const d = await db();
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return { ok: false, enabled: true, message: `Run ${runId} not found.` };
    if (run.status !== "awaiting_confirm" && run.status !== "held") {
      return { ok: false, enabled: true, runId, status: run.status, message: `Run ${runId} is not resumable (status=${run.status}).` };
    }
    const gateStepId = run.currentStepId ?? undefined;

    if (!decision.approved) {
      await setRunStatus(runId, "aborted", {
        finishedAt: new Date(),
        error: `Gate "${gateStepId ?? "?"}" rejected by user ${user.id}.`,
      });
      if (gateStepId) {
        const [wf2] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1);
        await upsertStep(runId, gateStepId, "hitl_gate", { status: "failed", error: "Rejected", finishedAt: new Date() }).catch(() => undefined);
        void wf2;
      }
      return { ok: false, enabled: true, runId, status: "aborted" };
    }

    const [wf] = await d.select().from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, run.workflowId)).limit(1);
    if (!wf) return { ok: false, enabled: true, message: `Workflow ${run.workflowId} not found.` };
    const def = wf.definitionJson as WorkflowDefinition;

    // mark the gate resolved (completed) so the re-walk skips it
    if (gateStepId) {
      await upsertStep(runId, gateStepId, "hitl_gate", {
        status: "completed",
        result: { approved: true, note: decision.note ?? null, approvedBy: user.id },
        finishedAt: new Date(),
      });
    }

    const rc = await buildRunContext(run, def, user);
    // record resolved gates in context so the walker skips them
    const resolved = new Set<string>(((rc.context.resolvedGates as string[]) ?? []));
    if (gateStepId) resolved.add(gateStepId);
    rc.context.resolvedGates = [...resolved];

    const status = await driveRunFromResume(rc, resolved);
    return { ok: status !== "failed" && status !== "aborted", enabled: true, runId, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setRunStatus(runId, "failed", { finishedAt: new Date(), error: message }).catch(() => undefined);
    return { ok: false, enabled: true, runId, status: "failed", message };
  }
}

/**
 * Like driveRun, but a hitl_gate whose id is in `resolvedGates` is treated as already
 * completed (skipped) so the walk continues past it. This is the resume path.
 */
async function driveRunFromResume(rc: RunContext, resolvedGates: Set<string>): Promise<OrchestrationRun["status"]> {
  // wrap execStep's hitl_gate handling: monkey-patch via context flag.
  rc.context.__resolvedGates = [...resolvedGates];
  await setRunStatus(rc.runId, "running");
  const out = await execSequenceResume(rc, rc.def.steps, resolvedGates);

  if (out.kind === "paused") {
    await setRunStatus(rc.runId, "awaiting_confirm", { currentStepId: out.stepId });
    await persistContext(rc);
    return "awaiting_confirm";
  }
  if (out.kind === "aborted") {
    await setRunStatus(rc.runId, "aborted", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "aborted";
  }
  if (out.kind === "failed") {
    await setRunStatus(rc.runId, "failed", { finishedAt: new Date(), error: "error" in out ? out.error : null });
    await persistContext(rc);
    return "failed";
  }
  await setRunStatus(rc.runId, "completed", { finishedAt: new Date() });
  await persistContext(rc);
  return "completed";
}

/** Sequence walker for resume: a resolved hitl_gate is skipped, not re-paused. */
async function execSequenceResume(rc: RunContext, steps: WorkflowStep[], resolved: Set<string>): Promise<StepOutcome> {
  for (const child of steps) {
    if (child.type === "hitl_gate" && resolved.has(child.id)) {
      continue; // already approved → skip past
    }
    // For nested containers, recurse with the resolved set so inner gates skip too.
    const out =
      child.type === "sequence"
        ? await execSequenceResume(rc, child.steps, resolved)
        : await execStep(rc, child);
    if (out.kind === "paused" || out.kind === "failed" || out.kind === "aborted") return out;
  }
  return { kind: "ok" };
}

/** Abort a run (terminal). Records the reason; does not crash on a missing run. */
export async function abortRun(runId: number, user: FoeUser, reason?: string): Promise<StartRunResult> {
  try {
    const d = await getDb();
    if (!d) return { ok: false, enabled: foeEnabled(), runId, message: "DB unavailable." };
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return { ok: false, enabled: foeEnabled(), runId, message: `Run ${runId} not found.` };
    if (["completed", "failed", "aborted"].includes(run.status)) {
      return { ok: false, enabled: foeEnabled(), runId, status: run.status, message: `Run ${runId} already terminal.` };
    }
    await setRunStatus(runId, "aborted", {
      finishedAt: new Date(),
      error: reason ? `Aborted by user ${user.id}: ${reason}` : `Aborted by user ${user.id}.`,
    });
    return { ok: true, enabled: foeEnabled(), runId, status: "aborted" };
  } catch (err) {
    return { ok: false, enabled: foeEnabled(), runId, message: err instanceof Error ? err.message : String(err) };
  }
}
