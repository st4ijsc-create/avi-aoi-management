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
 *     dispatcher's own `classifyOtStop` over the stop pins) over a running connection that matches the adapter row (the
 *     dispatcher's `runningConnectionMatchesAdapterRow`, E fix 2 / N6). An unpinned stop-typed OT step can write any tag
 *     (R-4-x), so it is NOT a stop here. Any lookup failure ⇒ not verified (fail-closed: no exemption), and `failed` says so.
 *
 * doc 81 Đợt 5 final wave F3 — a step whose writes ARE the adapter's stop pins but whose running connection does not match
 * the adapter row (adapter down / reconnecting / stale), or whose pins / connection could not be read, is NOT verified
 * (no exemption — unchanged) and is reported in `unsure`: it is not KNOWN to be a non-stop either. Scope decisions that
 * must tell "decided out" from "could not decide" (read visibility, abort / reject) treat a definition that is out of scope
 * ONLY because of such steps as UNDECIDED, never as "out of scope" (foeEngine.decideDefinition).
 */
import { and, eq, inArray } from "drizzle-orm";
import { deviceAdapters, deviceTags } from "../../../../drizzle/schema";
import type { StopPin, StopPinTagRow } from "../../ot/stopPin"; // types only — the module is loaded lazily (heavy, cycle-free)
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
type OtCandidate = NonNullable<ReturnType<typeof commandOf>>;

/**
 * doc 81 Đợt 5 task E fix 2 (review N3, N6) — a BATCHED verifier of stops for one call (one list / one start): the OT
 * candidates of ALL the definitions it is given are resolved with ONE bound-adapter read and ONE stop-pin read (device_tags
 * of every adapter involved — `stopPinsFromTagRows`, the same rule as `loadStopPins`), and every adapter's RUNNING
 * connection is checked once (`runningConnectionMatchesAdapterRow` — the OT dispatcher's own R-1D-k check, reused): a
 * pin matched over a stale connection is NOT a pinned stop for the dispatcher, so it is not a verified stop here either.
 * Any lookup failure ⇒ those steps are not verified and `failed` is set (no exemption).
 */
export interface StopVerification {
  /** VERIFIED stops (the only ones an exemption may use). */
  ids: Set<string>;
  /** true ⇔ some step could not be verified for a reason other than "it is not a stop" (= `unsure` is not empty). */
  failed: boolean;
  /** final wave F3 — steps that may be stops but could not be verified (pins unreadable, connection down / stale / unknown). */
  unsure: Set<string>;
}

export interface StopVerifier {
  verified(def: Pick<WorkflowDefinition, "steps">, machineMap: Map<number, MachineForValidation>): Promise<StopVerification>;
}

export async function makeStopVerifier(
  db: DbLike | null,
  defs: ReadonlyArray<Pick<WorkflowDefinition, "steps"> | null | undefined>,
  machineMap: Map<number, MachineForValidation>,
): Promise<StopVerifier> {
  // pass 1 — every OT stop-typed candidate of every definition (no DB)
  const candidates: OtCandidate[] = [];
  for (const def of defs) {
    for (const s of allStepsOf(def?.steps)) {
      const c = commandOf(s, machineMap);
      if (c && !isRobotKind(c.cap.adapterKind) && (await isOtStopCommandType(c.descriptor.name))) candidates.push(c);
    }
  }
  let batchFailed = false;
  const bound: Array<{ id: number; machineId: number | null }> = [];
  const pinsByAdapter = new Map<number, StopPin[]>();
  const connectionOk = new Map<number, boolean>();
  const fns: {
    classifyOtStop?: (name: string, writes: Array<{ tagKey: string; value: unknown }>, pins: StopPin[] | null) => { pinnedStop: boolean };
    connectionCheck?: (db: never, adapterId: number) => Promise<boolean>;
  } = {};
  const adapterOf = (c: OtCandidate): number | null => {
    const args = (c.step.args ?? {}) as Record<string, unknown>;
    if (typeof args.adapterId === "number") return args.adapterId;
    const enabled = bound.filter((a) => a.machineId === (c.step as { machineId: number }).machineId);
    return enabled.length === 1 ? enabled[0].id : null;
  };
  if (candidates.length > 0) {
    if (!db) batchFailed = true;
    else {
      try {
        const disp = await import("../../ot/commandDispatcher");
        const { stopPinsFromTagRows } = await import("../../ot/stopPin");
        fns.classifyOtStop = disp.classifyOtStop as never;
        fns.connectionCheck = disp.runningConnectionMatchesAdapterRow as never;
        const machineIds = [...new Set(candidates.filter((c) => typeof (c.step.args ?? {}).adapterId !== "number").map((c) => (c.step as { machineId: number }).machineId))];
        if (machineIds.length) {
          const rows = (await db.select().from(deviceAdapters).where(and(inArray(deviceAdapters.machineId, machineIds), eq(deviceAdapters.isEnabled, true)))) as Array<{ id: number; machineId: number | null; isEnabled?: boolean }>;
          for (const r of rows) if (r.isEnabled !== false) bound.push({ id: r.id, machineId: r.machineId });
        }
        const adapterIds = [...new Set(candidates.map(adapterOf).filter((v): v is number => v != null))];
        if (adapterIds.length) {
          // ONE read for every adapter's stop pins — the SAME rows + rule `loadStopPins` uses (enabled, writable).
          const tagRows = (await db
            .select({
              adapterId: deviceTags.adapterId,
              tagKey: deviceTags.tagKey,
              dataType: deviceTags.dataType,
              stopValue: deviceTags.stopValue,
              writable: deviceTags.writable,
              isEnabled: deviceTags.isEnabled,
            })
            .from(deviceTags)
            .where(and(inArray(deviceTags.adapterId, adapterIds), eq(deviceTags.isEnabled, true), eq(deviceTags.writable, true)))) as Array<{ adapterId: number } & StopPinTagRow>;
          for (const id of adapterIds) {
            const mine = tagRows.filter((r) => r.adapterId === id).sort((a, b) => (a.tagKey < b.tagKey ? -1 : a.tagKey > b.tagKey ? 1 : 0));
            pinsByAdapter.set(id, stopPinsFromTagRows(mine));
          }
        }
      } catch {
        batchFailed = true;
      }
    }
  }
  return {
    async verified(def, map) {
      const ids = new Set<string>();
      const unsure = new Set<string>();
      for (const s of allStepsOf(def?.steps)) {
        const c = commandOf(s, map);
        if (!c) continue;
        if (isRobotKind(c.cap.adapterKind)) {
          if (isRobotStopStep(c)) ids.add(s.id);
          continue;
        }
        if (!(await isOtStopCommandType(c.descriptor.name))) continue;
        const classifyOtStop = fns.classifyOtStop;
        const connectionCheck = fns.connectionCheck;
        if (batchFailed || !classifyOtStop || !connectionCheck || !db) {
          unsure.add(s.id);
          continue;
        }
        const adapterId = adapterOf(c);
        if (adapterId == null) continue; // unresolvable ⇒ the dispatcher would refuse it ⇒ not a verified stop
        const pins = pinsByAdapter.get(adapterId) ?? null;
        if (pins === null) {
          unsure.add(s.id);
          continue;
        }
        const writes = buildEquipmentCommand(c.descriptor, c.cap, (c.step as { machineId: number }).machineId, (c.step.args ?? {}) as Record<string, unknown>, "probe", { id: 0, role: "system" }).writes ?? [];
        if (!classifyOtStop(c.descriptor.name, writes, pins).pinnedStop) continue;
        if (!connectionOk.has(adapterId)) {
          try {
            connectionOk.set(adapterId, (await connectionCheck(db as never, adapterId)) === true);
          } catch {
            connectionOk.set(adapterId, false);
          }
        }
        // F3 — pinned, but the running connection is not confirmed (false or failed): not verified, and not known to be a
        // non-stop either ⇒ unsure (never decided "out of scope" on this).
        if (connectionOk.get(adapterId) === true) ids.add(s.id);
        else unsure.add(s.id);
      }
      return { ids, failed: unsure.size > 0, unsure };
    },
  };
}

/** The VERIFIED stops of ONE definition (a one-definition batch). See makeStopVerifier. */
export async function verifiedStopStepIds(
  def: Pick<WorkflowDefinition, "steps">,
  machineMap: Map<number, MachineForValidation>,
  db: DbLike | null,
): Promise<StopVerification> {
  try {
    return await (await makeStopVerifier(db, [def], machineMap)).verified(def, machineMap);
  } catch {
    // nothing could be classified: every OT command step is unsure (no exemption on a failed call)
    const unsure = new Set<string>();
    for (const s of allStepsOf(def?.steps)) {
      const c = commandOf(s, machineMap);
      if (c && !isRobotKind(c.cap.adapterKind)) unsure.add(s.id);
    }
    return { ids: new Set(), failed: true, unsure };
  }
}
