/**
 * doc 81 Đợt 5 task E fix 1 (ruling R-5-j, review #7/#14) — the ONE place that walks a workflow's step tree and decides
 * which command steps are STOPs. Before this the walk existed three times (foeEngine.allStepsOf, foeScope.walk,
 * foeGateApproval.allSteps) and the stop classification three times (stopStepIdsOf, isStopCommandStep, execCommand);
 * a drift between them would desynchronise the scope exemption, the E4 bound and the dispatch.
 *
 * TWO classifications, for two different jobs — never mixed:
 *   • `isStopCandidate` — "this step MAY be a stop; let the dispatcher decide". The robot job a step maps to is a stop job,
 *     or an OT step whose command TYPE is stop-typed. Used ONLY where the engine stays out of the way of a STOP at RUN time
 *     (no gate demanded by the engine, bounded bookkeeping): the dispatcher re-decides with the real data there (an
 *     unpinned OT stop is refused unless a counting gate backs it). Nothing is EXEMPTED on this classification.
 *   • `verifiedStopStepIds` — the REAL classification, for every EXEMPTION a definition gets because a step is a STOP
 *     (factory scope at start / approval, the start-time definition checks): a robot step whose job is a stop job, or an
 *     OT step that is a PINNED stop — its writes are exactly the adapter's stop pins (stop-pin rows + values, the OT
 *     dispatcher's own `classifyOtStop` over `loadStopPins`). An unpinned stop-typed OT step can write any tag (R-4-x), so
 *     it is NOT a stop here. Any lookup failure ⇒ not verified (fail-closed: no exemption), and `failed` says so.
 */
import { and, eq, inArray } from "drizzle-orm";
import { deviceAdapters } from "../../../../drizzle/schema";
import { getCapabilitiesForMachine, type CommandDescriptor, type EquipmentCapability } from "../../equipment/capabilityModel";
import type { EquipmentCommand } from "../../equipment/equipmentAdapter";
import { toRobotJob } from "../../equipment/robotJobMapping";
import { isStopJob } from "../../robot/stopJob";
import { FOE_ENGINE_TOOL, type FoeGateApproval } from "../../ot/otActionBinding";
import type { MachineForValidation, WorkflowDefinition, WorkflowStep } from "./workflowModel";

/** Every step of a tree, depth-first (children, branches, compensation). THE walk. */
export function allStepsOf(steps: WorkflowStep[] | undefined, out: WorkflowStep[] = []): WorkflowStep[] {
  for (const s of steps ?? []) {
    out.push(s);
    const node = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    allStepsOf(node.steps, out);
    allStepsOf(node.then, out);
    allStepsOf(node.else, out);
    if (s.compensation) allStepsOf([s.compensation], out);
  }
  return out;
}

/** Robot / AGV adapter kinds (robotId, never adapterId). */
export function isRobotKind(kind: string): boolean {
  return kind === "robot" || kind === "vda5050";
}

/** Doc 25 T1 — the ai_pending_actions id of an FOE command (varchar 64). */
export function orchestrationActionId(idempotencyKey: string): string {
  const id = `foe-${idempotencyKey}`;
  return id.length <= 64 ? id : id.slice(0, 64);
}

/** Minimal principal shape (foeEngine.FoeUser). */
export interface StepUser {
  id: number;
  role: string;
  name?: string | null;
}

/**
 * The EquipmentCommand an FOE command step becomes (moved here from foeEngine — re-exported there; ONE mapping for the
 * dispatch, the stop classification and the binding hash). requester = run owner, confirmer = the gate approver
 * (absent approval ⇒ legacy: both `user`).
 */
export function buildEquipmentCommand(
  descriptor: CommandDescriptor,
  capability: EquipmentCapability,
  machineId: number,
  args: Record<string, unknown>,
  idempotencyKey: string,
  user: StepUser,
  approval?: FoeGateApproval,
): EquipmentCommand {
  const isRobot = isRobotKind(capability.adapterKind);
  const cmd: EquipmentCommand = {
    name: descriptor.name,
    machineId,
    idempotencyKey,
    hitl: {
      actionId: orchestrationActionId(idempotencyKey),
      tool: FOE_ENGINE_TOOL,
      requestedBy: approval ? approval.runOwner ?? 0 : user.id || 0,
      confirmedBy: approval ? approval.approvedBy : user.id || 0,
    },
  };
  if (isRobot) {
    // fix round 2 (R-4-m) — never default to the machine id (different id space).
    cmd.robotId = typeof args.robotId === "number" ? args.robotId : undefined;
    if (descriptor.name === "run_job" && typeof args.jobType === "string") {
      cmd.job = { jobType: args.jobType as never, params: (args.params as Record<string, unknown>) ?? {} };
    }
  } else {
    // fix round 1 (R-4-d) — never default to the machine id; the engine resolves the bound adapter.
    cmd.adapterId = typeof args.adapterId === "number" ? args.adapterId : undefined;
    if (Array.isArray(args.writes)) {
      cmd.writes = (args.writes as Array<{ tagKey: string; value: unknown }>).filter((w) => w && typeof w.tagKey === "string");
    } else if (typeof args.tagKey === "string") {
      cmd.writes = [{ tagKey: args.tagKey, value: args.value }];
    }
  }
  return cmd;
}

/**
 * The OT dispatcher's OWN stop-type predicate (commandDispatcher.isStopCommandType), imported lazily (heavy module; test
 * suites replace it). Unavailable ⇒ false.
 */
export async function isOtStopCommandType(name: string): Promise<boolean> {
  try {
    const mod = await import("../../ot/commandDispatcher");
    return typeof mod.isStopCommandType === "function" && mod.isStopCommandType(name) === true;
  } catch {
    return false;
  }
}

/** Capability + descriptor of a command step (null: not a command / unknown machine / unsupported command). */
export function commandOf(step: WorkflowStep, machineMap: Map<number, MachineForValidation>) {
  if (step.type !== "command") return null;
  const m = machineMap.get(step.machineId);
  if (!m) return null;
  const cap = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never });
  const descriptor = cap.supportedCommands.find((c) => c.name === step.command);
  return descriptor ? { step, cap, descriptor } : null;
}

/** Robot step whose job is a stop job (the robot dispatcher's own classification). */
export function isRobotStopStep(c: NonNullable<ReturnType<typeof commandOf>>): boolean {
  return isRobotKind(c.cap.adapterKind) && isStopJob(toRobotJob(buildEquipmentCommand(c.descriptor, c.cap, c.step.machineId, c.step.args ?? {}, "probe", { id: 0, role: "system" })));
}

/** RUN-TIME candidate (see the header): may be a stop — the dispatcher decides with the real data. No DB. */
export async function isStopCandidate(step: WorkflowStep, machineMap: Map<number, MachineForValidation>): Promise<boolean> {
  const c = commandOf(step, machineMap);
  if (!c) return false;
  if (isRobotKind(c.cap.adapterKind)) return isRobotStopStep(c);
  return isOtStopCommandType(c.descriptor.name);
}

/** Does a subtree (the step itself, its children, branches, compensation) contain a stop CANDIDATE? */
export async function subtreeHasStopCandidate(step: WorkflowStep, machineMap: Map<number, MachineForValidation>): Promise<boolean> {
  for (const s of allStepsOf([step])) if (await isStopCandidate(s, machineMap)) return true;
  return false;
}

type DbLike = { select: (...a: any[]) => any };

/**
 * The VERIFIED stops of a definition (see the header): robot stop-job steps + OT steps that are PINNED stops on the adapter
 * they write through (explicit args.adapterId, else the single enabled adapter of the machine — foeEngine.withResolvedAdapter).
 * `failed` ⇒ some lookup failed: those steps are NOT in `ids` (no exemption).
 */
export async function verifiedStopStepIds(
  def: Pick<WorkflowDefinition, "steps">,
  machineMap: Map<number, MachineForValidation>,
  db: DbLike | null,
): Promise<{ ids: Set<string>; failed: boolean }> {
  const ids = new Set<string>();
  let failed = false;
  const otCandidates: Array<NonNullable<ReturnType<typeof commandOf>>> = [];
  for (const s of allStepsOf(def?.steps)) {
    const c = commandOf(s, machineMap);
    if (!c) continue;
    if (isRobotKind(c.cap.adapterKind)) {
      if (isRobotStopStep(c)) ids.add(s.id);
    } else if (await isOtStopCommandType(c.descriptor.name)) otCandidates.push(c);
  }
  if (otCandidates.length === 0) return { ids, failed };
  if (!db) return { ids, failed: true };
  try {
    const { classifyOtStop } = await import("../../ot/commandDispatcher");
    const { loadStopPins } = await import("../../ot/stopPin");
    const machineIds = [...new Set(otCandidates.filter((c) => typeof (c.step.args ?? {}).adapterId !== "number").map((c) => c.step.machineId))];
    const bound = machineIds.length
      ? ((await db.select().from(deviceAdapters).where(and(inArray(deviceAdapters.machineId, machineIds), eq(deviceAdapters.isEnabled, true)))) as Array<{ id: number; machineId: number | null; isEnabled?: boolean }>)
      : [];
    const pinsByAdapter = new Map<number, Awaited<ReturnType<typeof loadStopPins>> | null>();
    for (const c of otCandidates) {
      const args = (c.step.args ?? {}) as Record<string, unknown>;
      const enabled = bound.filter((a) => a.machineId === (c.step as { machineId: number }).machineId && a.isEnabled !== false);
      const adapterId = typeof args.adapterId === "number" ? args.adapterId : enabled.length === 1 ? enabled[0].id : null;
      if (adapterId == null) continue; // unresolvable ⇒ the dispatcher would refuse it ⇒ not a verified stop
      if (!pinsByAdapter.has(adapterId)) {
        try {
          pinsByAdapter.set(adapterId, await loadStopPins(db as never, adapterId));
        } catch {
          pinsByAdapter.set(adapterId, null);
          failed = true;
        }
      }
      const writes = buildEquipmentCommand(c.descriptor, c.cap, (c.step as { machineId: number }).machineId, args, "probe", { id: 0, role: "system" }).writes ?? [];
      if (classifyOtStop(c.descriptor.name, writes, pinsByAdapter.get(adapterId) ?? null).pinnedStop) ids.add(c.step.id);
    }
  } catch {
    failed = true;
  }
  return { ids, failed };
}
