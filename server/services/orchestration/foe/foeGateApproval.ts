/**
 * doc 81 Đợt 4 Task A5 + fix round 1 (rulings R-4-e … R-4-i) — WHICH gate approval lets an OT/robot step of an
 * orchestration run execute. ONE definition, used by:
 *   • the engine (foeEngine.execCommand → findSeparateGateApproval), before it creates the authorisation row, and
 *   • both dispatchers (commandDispatcher.reserveRealWrite / robotCommandDispatcher.reserveRobotJob), which RE-DERIVE
 *     the run owner and the gate approver from the DB rows (run + gate + workflow) inside the reservation transaction —
 *     never from what the engine wrote into the action's previewJson (R-4-i).
 *
 * A gate approval COUNTS only when ALL hold (fail-closed — anything else does not count):
 *   1. the `_run_steps` row is 'completed' and its step id is a `hitl_gate` in the definition being executed;
 *   2. resultJson = { approved: true, approvedBy: <positive int>, approvalSource: "server", defHash } — `approvalSource`
 *      is written ONLY by resumeRun's own approval path (ctx.user); an absent source, or "edge" (edgeCoordinator stamps
 *      every synced step row), or "system" (auto-resume, user 0) never counts (R-4-h, R-4-g);
 *   3. approvedBy ≠ the run owner (orchestration_runs.startedBy); a run with NO owner ⇒ nothing counts (R-4-f);
 *   4. defHash = hash of the definition being executed (R-4-e): a redeploy after the approval makes it STALE;
 *   5. doc 81 Đợt 5 task E3 (item 25) — bindingDigest = computeBindingDigest() of the CURRENT device configuration the
 *      definition's command steps resolve to (adapter, tags, robot): any change since the approval makes it STALE, and a
 *      digest that cannot be computed (DB error) or is absent (an approval recorded before E3) never counts.
 * Reasons when nothing counts: ownerUnknown › staleApproval › approvedByOwner › noGate.
 *
 * doc 81 Đợt 5 task E1 (item 24, owner decision option C) — a run started through an API key (runStartedViaApi) never
 * gets a counting approval at all (reason `apiRun`): the person holding a key is invisible to the server, so "approved by
 * someone other than the run owner" cannot be established (the holder may BE the approver). Both layers refuse it — the
 * engine before it creates the authorisation row, and foeApprovalDbRefusal (the dispatchers, from the DB rows).
 * STOPs (L-7): the engine never refuses a STOP step for `apiRun` (it is sent exactly as before, without an approval);
 * the dispatchers never call foeApprovalDbRefusal for a PINNED OT stop or for any robot stop. What still reaches it is an
 * UNPINNED OT stop-typed write — the OT dispatcher already treats that as needing four-eyes (it may write any tag), and
 * an API run cannot provide four-eyes, so it is refused like every other non-STOP write (R-4-x: an exemption for STOP
 * never extends to a write that is not a verified stop).
 */
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  orchestrationRunSteps,
  orchestrationRuns,
  orchestrationWorkflows,
  machines,
  deviceAdapters,
  deviceTags,
  robots,
} from "../../../../drizzle/schema";
import { getCapabilitiesForMachine } from "../../equipment/capabilityModel";
import { allStepsOf } from "./foeStepClass"; // doc 81 Đợt 5 task E fix 1 — THE step walk
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";

/** resultJson.approvalSource written by resumeRun's approval path (the only one that counts). */
export const FOE_APPROVAL_SOURCE_SERVER = "server";
/** Stamped by edgeCoordinator.syncRunResult on EVERY synced step result (never counts). */
export const FOE_APPROVAL_SOURCE_EDGE = "edge";
/** Written when user 0 (system auto-resume / API) resolves a gate (never counts). */
export const FOE_APPROVAL_SOURCE_SYSTEM = "system";

export type GateRequiredReason = "noGate" | "approvedByOwner" | "staleApproval" | "ownerUnknown" | "apiRun";

/**
 * doc 81 Đợt 5 task E1 — the SERVER-ONLY marker of a run started through an API key (or by any non-user principal).
 * Written by foeEngine.startRun into BOTH `paramsJson[FOE_API_RUN_PARAM]` and `contextJson.startedViaApi`, never taken
 * from the caller as a way to LIFT the restriction. paramsJson is written once (at the INSERT) and nothing else writes it,
 * while contextJson is overwritten by an edge result sync (edgeCoordinator.syncRunResult) — so EITHER marker set ⇒ API run
 * (fail-closed: an edge payload can wipe contextJson but cannot remove the params marker).
 */
export const FOE_API_RUN_PARAM = "__foeStartedViaApi";

/** doc 81 Đợt 5 task E1 — was this run started through an API key? (either server-written marker ⇒ yes) */
export function runStartedViaApi(run: { paramsJson?: unknown; contextJson?: unknown } | null | undefined): boolean {
  const params = run?.paramsJson as Record<string, unknown> | null | undefined;
  const ctx = run?.contextJson as Record<string, unknown> | null | undefined;
  return params?.[FOE_API_RUN_PARAM] === true || ctx?.startedViaApi === true;
}

/** Canonical JSON (keys sorted, recursive) ⇒ a definition hash independent of key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalize(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

/** Stable sha256 of a WorkflowDefinition (sim-gate binding + gate-approval binding, R-4-e). */
export function hashWorkflowDefinition(def: WorkflowDefinition): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(def))).digest("hex");
}

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(canonicalize(v ?? null))).digest("hex");
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));

/**
 * doc 81 Đợt 5 task E3 (item 25, owner: follow the survey) — the BINDING DIGEST of a definition: what its command steps
 * resolve to in the device configuration RIGHT NOW, computed on the server only (never taken from a client):
 *   • the machine (id, machineType, hash of capabilities — it decides OT vs robot routing);
 *   • OT step: the resolved adapter — explicit args.adapterId, else the single ENABLED adapter bound to the machine
 *     (exactly foeEngine.withResolvedAdapter) — with its updatedAt / isEnabled / machineId, and every tag row the step
 *     writes (args.writes[].tagKey / args.tagKey on that adapter): id, address, dataType, scale, offset, updatedAt
 *     (a missing tag is recorded as missing);
 *   • robot step: the robot row (id, vendor, endpoint, hash of connectionOptions; NOT updatedAt/status, which the
 *     runtime bumps on every connection change).
 * Stored in the gate's resultJson at approval and recomputed by BOTH checks (engine + dispatchers): a different digest ⇒
 * staleApproval. RESIDUAL (documented, doc 81 §14): a program stored INSIDE a robot controller / PLC is invisible here.
 * null ⇒ could not be computed (fail-closed: an approval never counts against null).
 */
export async function computeBindingDigest(db: DbLike, def: Pick<WorkflowDefinition, "steps">): Promise<string | null> {
  try {
    const cmds = allStepsOf(def?.steps).filter(
      (s): s is Extract<WorkflowStep, { type: "command" }> => s.type === "command" && posInt((s as { machineId?: unknown }).machineId),
    );
    if (cmds.length === 0) return sha([]);
    const machineIds = [...new Set(cmds.map((s) => s.machineId))];
    const mRows = (await db.select().from(machines).where(inArray(machines.id, machineIds))) as Array<Record<string, any>>;
    const mById = new Map(mRows.map((m) => [m.id as number, m] as const));
    const kindOf = (mid: number): "robot" | "ot" | null => {
      const m = mById.get(mid);
      if (!m) return null;
      const k = getCapabilitiesForMachine({ machineType: m.machineType, capabilities: m.capabilities as never }).adapterKind;
      return k === "robot" || k === "vda5050" ? "robot" : "ot";
    };
    const otMachines = [...new Set(cmds.filter((s) => kindOf(s.machineId) === "ot").map((s) => s.machineId))];
    const bound = otMachines.length
      ? ((await db.select().from(deviceAdapters).where(inArray(deviceAdapters.machineId, otMachines))) as Array<Record<string, any>>)
      : [];
    const resolveAdapter = (s: Extract<WorkflowStep, { type: "command" }>): number | null => {
      const explicit = (s.args ?? {}).adapterId;
      if (typeof explicit === "number") return explicit;
      const enabled = bound.filter((a) => a.machineId === s.machineId && a.isEnabled === true);
      return enabled.length === 1 ? (enabled[0].id as number) : null;
    };
    const resolved = new Map(cmds.filter((s) => kindOf(s.machineId) === "ot").map((s) => [s.id, resolveAdapter(s)] as const));
    const adapterIds = [...new Set([...resolved.values()].filter((v): v is number => posInt(v)))];
    const aRows = adapterIds.length
      ? ((await db.select().from(deviceAdapters).where(inArray(deviceAdapters.id, adapterIds))) as Array<Record<string, any>>)
      : [];
    const aById = new Map(aRows.map((a) => [a.id as number, a] as const));
    const tRows = adapterIds.length
      ? ((await db.select().from(deviceTags).where(inArray(deviceTags.adapterId, adapterIds))) as Array<Record<string, any>>)
      : [];
    const robotIds = [
      ...new Set(cmds.filter((s) => kindOf(s.machineId) === "robot").map((s) => (s.args ?? {}).robotId).filter((v): v is number => posInt(v))),
    ];
    const rRows = robotIds.length ? ((await db.select().from(robots).where(inArray(robots.id, robotIds))) as Array<Record<string, any>>) : [];
    const rById = new Map(rRows.map((r) => [r.id as number, r] as const));
    const tagKeysOf = (args: Record<string, unknown>): string[] => {
      const keys = Array.isArray(args.writes)
        ? (args.writes as Array<{ tagKey?: unknown }>).map((w) => w?.tagKey).filter((k): k is string => typeof k === "string")
        : typeof args.tagKey === "string"
          ? [args.tagKey]
          : [];
      return [...new Set(keys)].sort();
    };
    const entries = cmds
      .map((s) => {
        const m = mById.get(s.machineId);
        const kind = kindOf(s.machineId);
        const args = (s.args ?? {}) as Record<string, unknown>;
        const base = {
          stepId: s.id,
          command: s.command,
          machine: m ? { id: m.id, machineType: m.machineType, caps: sha(m.capabilities) } : { id: s.machineId, missing: true },
          kind,
        };
        if (kind === "ot") {
          const aid = resolved.get(s.id) ?? null;
          const a = aid != null ? aById.get(aid) : undefined;
          return {
            ...base,
            adapter: aid == null ? null : a ? { id: a.id, machineId: a.machineId ?? null, isEnabled: a.isEnabled === true, updatedAt: iso(a.updatedAt) } : { id: aid, missing: true },
            tags: tagKeysOf(args).map((k) => {
              const t = aid == null ? undefined : tRows.find((r) => r.adapterId === aid && r.tagKey === k);
              return t
                ? { tagKey: k, id: t.id, address: t.address, dataType: t.dataType, scale: t.scale == null ? null : String(t.scale), offset: t.offset == null ? null : String(t.offset), updatedAt: iso(t.updatedAt) }
                : { tagKey: k, missing: true };
            }),
          };
        }
        if (kind === "robot") {
          const rid = args.robotId;
          const r = posInt(rid) ? rById.get(rid) : undefined;
          return { ...base, robot: !posInt(rid) ? null : r ? { id: r.id, vendor: r.vendor, endpoint: r.endpoint ?? null, conn: sha(r.connectionOptions) } : { id: rid, missing: true } };
        }
        return base;
      })
      .sort((x, y) => (x.stepId < y.stepId ? -1 : x.stepId > y.stepId ? 1 : 0));
    return sha(entries);
  } catch {
    return null;
  }
}

/** Depth-first lookup of a step by id anywhere in the tree (children, branches, compensation). */
export function findStepDeep(steps: WorkflowStep[] | undefined, id: string): WorkflowStep | undefined {
  for (const s of steps ?? []) {
    if (s.id === id) return s;
    const node = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    const hit =
      findStepDeep(node.steps, id) ??
      findStepDeep(node.then, id) ??
      findStepDeep(node.else, id) ??
      (s.compensation ? findStepDeep([s.compensation], id) : undefined);
    if (hit) return hit;
  }
  return undefined;
}

export interface GateRowLike {
  stepId: string;
  status: string;
  resultJson: unknown;
  finishedAt?: Date | string | null;
}

export interface CountingApproval {
  approvedBy: number;
  gateStepId: string;
  at: number;
}

export type GateEvaluation = { ok: true; approvals: CountingApproval[] } | { ok: false; reason: GateRequiredReason };

const posInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

/** PURE — the counting approvals (latest first) or why there is none. */
export function evaluateGateApprovals(
  rows: readonly GateRowLike[],
  def: Pick<WorkflowDefinition, "steps">,
  defHash: string,
  runOwner: number | null,
  /** doc 81 Đợt 5 task E3 — computeBindingDigest() of the definition NOW (null ⇒ not computable ⇒ nothing counts). */
  bindingDigest: string | null,
): GateEvaluation {
  if (!posInt(runOwner)) return { ok: false, reason: "ownerUnknown" };
  let sawStale = false;
  let sawOwner = false;
  const approvals: CountingApproval[] = [];
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const node = findStepDeep(def.steps, r.stepId);
    if (!node || node.type !== "hitl_gate") continue;
    const res = (r.resultJson ?? null) as {
      approved?: unknown;
      approvedBy?: unknown;
      approvalSource?: unknown;
      defHash?: unknown;
      bindingDigest?: unknown;
    } | null;
    if (!res || res.approved !== true || res.approvalSource !== FOE_APPROVAL_SOURCE_SERVER || !posInt(res.approvedBy)) continue;
    if (res.approvedBy === runOwner) {
      sawOwner = true;
      continue;
    }
    // E3 — the definition (R-4-e) AND the device configuration it resolves to must be what the approver approved.
    if (res.defHash !== defHash || bindingDigest === null || typeof res.bindingDigest !== "string" || res.bindingDigest !== bindingDigest) {
      sawStale = true;
      continue;
    }
    approvals.push({ approvedBy: res.approvedBy, gateStepId: r.stepId, at: r.finishedAt ? new Date(r.finishedAt).getTime() : 0 });
  }
  if (approvals.length > 0) return { ok: true, approvals: approvals.sort((a, b) => b.at - a.at) };
  return { ok: false, reason: sawStale ? "staleApproval" : sawOwner ? "approvedByOwner" : "noGate" };
}

type DbLike = { select: (...a: any[]) => any };

/**
 * R-4-i — the dispatchers' DB layer. `pending` is the ai_pending_actions row being consumed (tool 'foe.orchestration').
 * The action's previewJson only POINTS at the run (runId); owner, approver and definition are read from the DB.
 * Returns null when the action is backed by a counting approval whose approver IS the action's confirmer (and the
 * requester, when named, is the run owner); otherwise the refusal detail. Any DB error ⇒ refusal (fail-closed).
 */
export async function foeApprovalDbRefusal(
  db: DbLike,
  pending: { userId: number; previewJson: unknown },
  requestedBy?: number | null,
): Promise<string | null> {
  try {
    const ptr = (pending.previewJson as Record<string, unknown> | null)?.["__foeGateApproval"] as { runId?: unknown } | undefined;
    const runId = ptr?.runId;
    if (!posInt(runId)) return "orchestration action does not name its run — no separate gate approval can be verified";
    const [run] = await db.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return `orchestration run ${runId} not found — no separate gate approval can be verified`;
    // doc 81 Đợt 5 task E1 — an API-started run never actuates through a gate approval (option C).
    if (runStartedViaApi(run)) return "orchestration run was started through an API key (FOE_GATE_REQUIRED apiRun) — its OT/robot commands other than a STOP are never sent";
    const owner = (run as { startedBy: number | null }).startedBy ?? null;
    if (!posInt(owner)) return "orchestration run has no attributable owner (ownerUnknown) — OT/robot commands are refused";
    if (pending.userId === owner) return "orchestration action is confirmed by the run owner — a separate approval is required";
    if (posInt(requestedBy) && requestedBy !== owner) return "orchestration action's requester is not the run owner";
    const [wf] = await db
      .select()
      .from(orchestrationWorkflows)
      .where(eq(orchestrationWorkflows.id, (run as { workflowId: number }).workflowId))
      .limit(1);
    const def = (wf as { definitionJson?: WorkflowDefinition } | undefined)?.definitionJson;
    if (!def || !Array.isArray(def.steps)) return "orchestration workflow definition not found";
    const rows = (await db.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId))) as GateRowLike[];
    const ev = evaluateGateApprovals(rows, def, hashWorkflowDefinition(def), owner, await computeBindingDigest(db, def)); // E3
    if (!ev.ok) return `no counting gate approval for this run (FOE_GATE_REQUIRED ${ev.reason})`;
    if (!ev.approvals.some((a) => a.approvedBy === pending.userId)) {
      return "orchestration action's confirmer is not the approver of a counting gate of its run";
    }
    return null;
  } catch {
    return "gate approval could not be verified (DB error) — fail-closed";
  }
}
