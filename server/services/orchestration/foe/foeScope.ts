/**
 * doc 81 Đợt 5 task E2 (item 26, owner decision 2026-10-10) — FACTORY SCOPE of orchestration.
 *
 * Orchestration tables carry no factory column; a definition's factory is what it TOUCHES. Its targets are:
 *   • every machine it references — command steps, wait_state steps and every telemetry/state condition
 *     (precondition, branch, wait_telemetry) — (`validateWorkflow().referencedMachineIds` is unioned in, fail-closed);
 *   • the robot named by each robot-kind command step (`args.robotId`);
 *   • the adapter named explicitly by an OT command step (`args.adapterId`): such a step writes through THAT adapter,
 *     whose machine may be in another factory than `step.machineId` (R-4-d) — so the adapter's machine is a target too.
 * Each target is marked `nonStop` unless EVERY reference to it sits in a STOP command step (L-7 bookkeeping).
 *
 * Who may do what (the ONE rule, applied by foeEngine + orchestrationRouter + api/v1):
 *   • deploy / rollback (and deleting a workflow): ALL targets in the actor's scope — STOPs included (deploy is never urgent);
 *   • start, approve (resume), and every READ: the NON-STOP targets in scope. An out-of-scope target referenced only by
 *     STOP steps is allowed (L-7) and audited at start/approval. A run/workflow outside that rule is "not found" for the actor.
 *
 * Scope source (`FoeScope`): null = unrestricted (admin is resolved to null by the shared resolver; a `global` API key);
 * a user ⇒ `{ userId, userRole }` (same resolver as every other tRPC scope: `idsTrongPhamVi`); an API key declared
 * `factory` ⇒ `{ tenantScope }`; a non-user principal with no explicit scope ⇒ an EMPTY tenant scope (nothing in scope —
 * fail-closed; e.g. the QT template loader can only register target-free definitions). Robots are in scope through their
 * line or station (an orphan robot is in nobody's restricted scope — same rule as commandCenterScope.scopedRobotIds).
 * Any lookup error ⇒ every target counts as out of scope (fail-closed).
 */
import { inArray } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { idsTrongPhamVi, type PhamViDoc } from "../../../db/hierarchy";
import { deviceAdapters, robots } from "../../../../drizzle/schema";
import { getCapabilitiesForMachine } from "../../equipment/capabilityModel";
import { validateWorkflow, type Condition, type MachineForValidation, type WorkflowDefinition, type WorkflowStep } from "./workflowModel";

/** null = unrestricted. */
export type FoeScope = PhamViDoc | null;

/** The scope of a principal when the caller states none: a real user ⇒ their assignments; anything else ⇒ empty. */
export function resolveUserFoeScope(user: { id: number; role: string }): FoeScope {
  if (Number.isInteger(user.id) && user.id > 0) return { userId: user.id, userRole: String(user.role ?? "") };
  return { tenantScope: {} };
}

export interface FoeTargets {
  /** id → true when at least one reference is outside a STOP step. */
  machines: Map<number, boolean>;
  robots: Map<number, boolean>;
  adapters: Map<number, boolean>;
}

export interface OutOfScope {
  machines: number[];
  robots: number[];
  adapters: number[];
}

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isRobotKind = (kind: string) => kind === "robot" || kind === "vda5050";

function walk(steps: WorkflowStep[] | undefined, out: WorkflowStep[] = []): WorkflowStep[] {
  for (const s of steps ?? []) {
    out.push(s);
    const node = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    walk(node.steps, out);
    walk(node.then, out);
    walk(node.else, out);
    if (s.compensation) walk([s.compensation], out);
  }
  return out;
}

function conditionMachines(c: Condition | undefined, acc: number[]): void {
  if (!c) return;
  const comp = c as { all?: Condition[]; any?: Condition[]; not?: Condition };
  if (comp.all || comp.any || comp.not) {
    (comp.all ?? []).forEach((x) => conditionMachines(x, acc));
    (comp.any ?? []).forEach((x) => conditionMachines(x, acc));
    if (comp.not) conditionMachines(comp.not, acc);
    return;
  }
  const leaf = c as { source?: string; machineId?: unknown };
  if ((leaf.source === "telemetry" || leaf.source === "state") && posInt(leaf.machineId)) acc.push(leaf.machineId);
}

/** PURE — the targets of a definition (see the header). `stops` = ids of its STOP command steps. */
export function collectTargets(def: WorkflowDefinition, machineMap: Map<number, MachineForValidation>, stops: Set<string>): FoeTargets {
  const t: FoeTargets = { machines: new Map(), robots: new Map(), adapters: new Map() };
  const mark = (m: Map<number, boolean>, id: number, nonStop: boolean) => m.set(id, (m.get(id) ?? false) || nonStop);
  for (const step of walk(def?.steps)) {
    const nonStop = !stops.has(step.id);
    const own: number[] = [];
    if ((step.type === "command" || step.type === "wait_state") && posInt(step.machineId)) own.push(step.machineId);
    if (step.type === "branch" || step.type === "wait_telemetry") conditionMachines(step.condition, own);
    conditionMachines(step.precondition, own);
    for (const id of own) mark(t.machines, id, nonStop);
    if (step.type === "command") {
      const m = machineMap.get(step.machineId);
      const kind = m ? getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never }).adapterKind : null;
      const args = (step.args ?? {}) as Record<string, unknown>;
      // unknown machine kind ⇒ count BOTH ids it might use (fail-closed)
      if ((kind === null || isRobotKind(kind)) && posInt(args.robotId)) mark(t.robots, args.robotId, nonStop);
      if ((kind === null || !isRobotKind(kind)) && posInt(args.adapterId)) mark(t.adapters, args.adapterId, nonStop);
    }
  }
  // Anything the validator sees that the walk above did not ⇒ a non-stop target (fail-closed).
  for (const id of validateWorkflow(def, null).referencedMachineIds) if (!t.machines.has(id)) t.machines.set(id, true);
  return t;
}

export interface ScopeJudge {
  /** true ⇒ nothing is ever out of scope (null scope, admin, `global` key). */
  unrestricted: boolean;
  /** The targets OUTSIDE the scope (`nonStopOnly` ⇒ only targets with a non-STOP reference are considered). */
  outOf(t: FoeTargets, opts?: { nonStopOnly?: boolean }): Promise<OutOfScope>;
}

/**
 * ONE scope resolution (machine / line / station id sets through the shared `idsTrongPhamVi`) reused for many definitions
 * (list filtering). Never throws: a failed resolution or lookup ⇒ every considered target is out of scope (fail-closed).
 */
export async function makeScopeJudge(scope: FoeScope): Promise<ScopeJudge> {
  const pick = (m: Map<number, boolean>, nonStopOnly?: boolean) =>
    [...m.entries()].filter(([, nonStop]) => !nonStopOnly || nonStop).map(([id]) => id);
  const wanted = (t: FoeTargets, o?: { nonStopOnly?: boolean }): OutOfScope => ({
    machines: pick(t.machines, o?.nonStopOnly),
    robots: pick(t.robots, o?.nonStopOnly),
    adapters: pick(t.adapters, o?.nonStopOnly),
  });
  const none: OutOfScope = { machines: [], robots: [], adapters: [] };
  if (scope === null) return { unrestricted: true, outOf: async () => none };
  let sets: { machines: Set<number>; lines: Set<number>; stations: Set<number> } | null;
  try {
    const machineIds = await idsTrongPhamVi("machine", scope);
    if (machineIds === null) return { unrestricted: true, outOf: async () => none }; // the shared resolver: unrestricted
    const [lines, stations] = await Promise.all([idsTrongPhamVi("line", scope), idsTrongPhamVi("station", scope)]);
    sets = { machines: new Set(machineIds), lines: new Set(lines ?? []), stations: new Set(stations ?? []) };
  } catch {
    sets = null;
  }
  const adapterMachine = new Map<number, number | null>();
  const robotPlace = new Map<number, { lineId: number | null; stationId: number | null } | null>();
  return {
    unrestricted: false,
    async outOf(t, o) {
      const want = wanted(t, o);
      if (!sets) return want;
      try {
        const d = await getDb();
        const needA = want.adapters.filter((id) => !adapterMachine.has(id));
        const needR = want.robots.filter((id) => !robotPlace.has(id));
        if ((needA.length > 0 || needR.length > 0) && !d) return want;
        if (needA.length > 0) {
          const rows = await d!.select().from(deviceAdapters).where(inArray(deviceAdapters.id, needA));
          for (const id of needA) adapterMachine.set(id, null);
          for (const r of rows) adapterMachine.set(r.id, r.machineId ?? null);
        }
        if (needR.length > 0) {
          const rows = await d!.select().from(robots).where(inArray(robots.id, needR));
          for (const id of needR) robotPlace.set(id, null);
          for (const r of rows) robotPlace.set(r.id, { lineId: r.lineId ?? null, stationId: r.stationId ?? null });
        }
        const S = sets;
        return {
          machines: want.machines.filter((id) => !S.machines.has(id)),
          adapters: want.adapters.filter((id) => {
            const mid = adapterMachine.get(id);
            return !(posInt(mid) && S.machines.has(mid));
          }),
          robots: want.robots.filter((id) => {
            const r = robotPlace.get(id);
            return !(r && ((r.lineId != null && S.lines.has(r.lineId)) || (r.stationId != null && S.stations.has(r.stationId))));
          }),
        };
      } catch {
        return want;
      }
    },
  };
}

/** One-shot form of makeScopeJudge(scope).outOf(...). */
export async function outOfScopeTargets(scope: FoeScope, t: FoeTargets, opts: { nonStopOnly?: boolean } = {}): Promise<OutOfScope> {
  return (await makeScopeJudge(scope)).outOf(t, opts);
}

export const isOutOfScopeEmpty = (o: OutOfScope) => o.machines.length + o.robots.length + o.adapters.length === 0;

/** The step ids that reference an out-of-scope target (for the refusal message). */
export function stepsTouching(def: WorkflowDefinition, o: OutOfScope, stops: Set<string>, nonStopOnly: boolean): string[] {
  const m = new Set(o.machines);
  const r = new Set(o.robots);
  const a = new Set(o.adapters);
  const ids: string[] = [];
  for (const step of walk(def?.steps)) {
    if (nonStopOnly && stops.has(step.id)) continue;
    const own: number[] = [];
    if ((step.type === "command" || step.type === "wait_state") && posInt(step.machineId)) own.push(step.machineId);
    if (step.type === "branch" || step.type === "wait_telemetry") conditionMachines(step.condition, own);
    conditionMachines(step.precondition, own);
    const args = (step.type === "command" ? step.args ?? {} : {}) as Record<string, unknown>;
    if (own.some((id) => m.has(id)) || (posInt(args.robotId) && r.has(args.robotId)) || (posInt(args.adapterId) && a.has(args.adapterId))) {
      ids.push(step.id);
    }
  }
  return ids;
}
