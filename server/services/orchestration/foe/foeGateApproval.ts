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
 *   4. defHash = hash of the definition being executed (R-4-e): a redeploy after the approval makes it STALE.
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
import { eq } from "drizzle-orm";
import { orchestrationRunSteps, orchestrationRuns, orchestrationWorkflows } from "../../../../drizzle/schema";
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
): GateEvaluation {
  if (!posInt(runOwner)) return { ok: false, reason: "ownerUnknown" };
  let sawStale = false;
  let sawOwner = false;
  const approvals: CountingApproval[] = [];
  for (const r of rows) {
    if (r.status !== "completed") continue;
    const node = findStepDeep(def.steps, r.stepId);
    if (!node || node.type !== "hitl_gate") continue;
    const res = (r.resultJson ?? null) as { approved?: unknown; approvedBy?: unknown; approvalSource?: unknown; defHash?: unknown } | null;
    if (!res || res.approved !== true || res.approvalSource !== FOE_APPROVAL_SOURCE_SERVER || !posInt(res.approvedBy)) continue;
    if (res.approvedBy === runOwner) {
      sawOwner = true;
      continue;
    }
    if (res.defHash !== defHash) {
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
    const ev = evaluateGateApprovals(rows, def, hashWorkflowDefinition(def), owner);
    if (!ev.ok) return `no counting gate approval for this run (FOE_GATE_REQUIRED ${ev.reason})`;
    if (!ev.approvals.some((a) => a.approvedBy === pending.userId)) {
      return "orchestration action's confirmer is not the approver of a counting gate of its run";
    }
    return null;
  } catch {
    return "gate approval could not be verified (DB error) — fail-closed";
  }
}
