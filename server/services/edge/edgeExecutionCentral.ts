/**
 * doc 81 Đợt 9 task S2 (owner decision 2026-10-12, "edge workflow execution — do it fully") — the CENTRAL half of the
 * per-node edge execution protocol. Every function takes the node AUTHENTICATED by its own credential (edgeNodeCredentials
 * .authenticateEdgeNodeToken — never an API key, never a node code from the body) and only ever sees that node's runs.
 *
 * TOPOLOGY (decided here, documented in docs/EDGE_GATEWAY.md §Run execution): the edge gateway's DATABASE_URL is the central
 * control-plane DB (deploy/edge/docker-compose.edge.yml, pre-existing). The edge therefore executes THE CENTRAL RUN ROW (same
 * run id, same workflow id — the ID mapping of mig 0370) with the shared engine, so every gate is the SAME code over the SAME
 * rows as central: approval with the Group R identity rule, binding digest, program checksum (read through the edge's own
 * driver), R-4-x and the STOP exemptions. HTTP carries what the DB cannot: WHO may take which run (the claim), liveness, and
 * central's abort / reject signal. A copy run is never created (edgeRuntime.executeAssignedRun stays latent).
 *
 * The protocol (all answers for a run that is not assigned to the calling node — missing, another node's, outside the node's
 * factory — are the SAME 404 `not_found`: no existence oracle):
 *   • pull      — the node's claimable runs ('queued' + assigned to it), each with the DEFINITION SNAPSHOT (head; its hash
 *                 must equal the assignment's) and the claim sequence to claim; plus the node's current claims with
 *                 `abortRequested` (central aborted it, or a gate rejection claimed it). Final wave F2: NO binding digest — the
 *                 device configuration (program checksums: an S7 block-info read per controller) is read only at the claim,
 *                 never on every pull. A run left unclaimed beyond EDGE_UNCLAIMED_HOLD_MS goes to 'held' ("edge
 *                 unreachable", visible; a person may Continue or abort it) — so it leaves the pull and polling for it ends.
 *   • claim     — compare-and-set: run 'queued' → 'running', claimSeq n → n+1, a NEW claim token (only its SHA-256 is
 *                 stored), progressSeq 0. Refused: another claimSeq / status (409 claim_conflict), a redeploy since the
 *                 assignment or a snapshot other than the edge's (409 definition_changed), central's digest ≠ the edge's or
 *                 either is null (409 binding_changed — the two views of the device configuration must agree).
 *   • progress  — {claimSeq, claimToken, seq}: the claim must be CURRENT (else 409 claim_stale) and seq must be greater
 *                 than the last accepted one (else 409 replayed — a captured report replayed is refused, the row's
 *                 sequence never moves back: trigger). Records liveness only — results are the rows the edge's engine
 *                 wrote; the report is checked against them (`consistent`). Answer: `abortRequested`.
 *   • complete  — the same checks; the run row must show the segment ENDED (completed / failed / aborted / awaiting_confirm /
 *                 held) — a forged "complete" for a run still walking is refused (409 not_finished) and changes nothing.
 *                 Clears the claim token (no later report with it is accepted).
 *   • release   — the edge refuses to execute what it claimed (its own checks failed): run 'running' → 'held' (a person
 *                 may Continue), claim cleared.
 *   • interrupted — the edge restarted and holds no walker for one of its claims: only once the claim is STALE (no
 *                 progress for EDGE_CLAIM_STALE_MS, so a live walker of the same node is never cut off) ⇒ 'held'
 *                 (interrupted; 'compensating' ⇒ 'failed', as central's restart rule), claim cleared.
 * Revoked credential ⇒ 401 for everything (the route). Central's abort is never gated by any of this (L-7): it writes
 * 'aborted' and sends what it can; the edge learns it from the next answer (or from the run row, edgeRunGuard).
 */
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, like, sql } from "drizzle-orm";
import { abortResendAllowed } from "@shared/foeAbortResend"; // the engine's own re-send window (R-6-d), read the same way
import { getDb } from "../../db/connection";
import { orchestrationRuns, orchestrationRunSteps, orchestrationWorkflows } from "../../../drizzle/schema";
import { computeBindingDigest, hashWorkflowDefinition } from "../orchestration/foe/foeGateApproval";
import type { WorkflowDefinition } from "../orchestration/foe/workflowModel";
import type { FoeScope } from "../orchestration/foe/foeScope";
import { centralStopped, edgeRuntimeEnabled as edgeRuntimeEnabledNow } from "./edgeCoordinator";
import { runEdgeAssignments, isEdgeSchemaMissing, type RunEdgeAssignment } from "./edgeExecutionSchema";
export { readEdgeAssignment, edgeAssignedRunIdsAmong } from "./edgeExecutionSchema";
import { hashEdgeSecret, sameDigest, type EdgeNodePrincipal } from "./edgeNodeCredentials";
// doc 81 Đợt 10 task B — protocol v2
import { users } from "../../../drizzle/schema";
import { computeBindingDetail, findStepDeep, runStartedViaApi, FOE_REJECT_CLAIM_CTX_KEY } from "../orchestration/foe/foeGateApproval";
import {
  EDGE_PROTOCOL_VERSION,
  edgeClaimRequestSchema,
  edgeCompleteRequestSchema,
  edgeError,
  edgeInterruptedRequestSchema,
  edgePullRequestSchema,
  edgeProgressRequestSchema,
  edgeReleaseRequestSchema,
  edgeRunPackageSchema,
  edgeSweepPictureSchema,
  edgeRunStream,
  parseEdgeBody,
  type EdgeClaimAnswer,
  type EdgeCompleteAnswer,
  type EdgeNodeClaim,
  type EdgeProgressAnswer,
  type EdgePullAnswer,
  type EdgePulledRun,
} from "./edgeProtocol";
import {
  centralSigner,
  devicesOfNode,
  isEdgeUnavailableError,
  nodeProtocolVersion,
  ownedAdapterIds,
  ownedRobotIds,
  protocolVersionAnswer,
  signForNode,
  edgeUnavailable as edgeUnavailableV2,
  runNotFound,
  type Db as CentralDbHandle,
} from "./edgeCentralCommon";
import { edgeNodeProgramReports } from "./edgeControlSchema";
import { analyseDefinition, loadMachineMap, readPriorPicture } from "./edgeRunAnalysis";
import { assignedDefinition, cursorLastSeq } from "./edgeReportsCentral";
import { resolveEngineSink } from "./edgeEngineSink";
import { commandsForNode, type EdgeUnsignedStop as EdgeUnsignedStopEnvelope } from "./edgeNodeCommands";
import type { EdgeSignedEnvelope } from "./edgeSigning";

export const EDGE_PULL_LIMIT = 20;
/** A run status at which an execution segment on the edge has ENDED (the engine's walk returned). */
export const EDGE_SEGMENT_END_STATUSES = new Set(["completed", "failed", "aborted", "awaiting_confirm", "held"]);
const CLAIM_TOKEN_RE = /^ect_[A-Za-z0-9_-]{43}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** How long a claim may go without progress before its node may declare it interrupted (default 30 s, [5 s, 10 min]). */
export function edgeClaimStaleMs(): number {
  const n = parseInt(process.env.EDGE_CLAIM_STALE_MS || "30000", 10);
  return Number.isFinite(n) ? Math.min(600_000, Math.max(5_000, n)) : 30_000;
}

export interface EdgeAnswer<T = unknown> {
  http: number;
  code?: string;
  message?: string;
  data?: T;
}
const notFound = (runId: number): EdgeAnswer<never> => ({ http: 404, code: "not_found", message: `Run ${runId} not found.` });
const unavailable: EdgeAnswer<never> = { http: 503, code: "edge_unavailable", message: "Edge execution is not available (database or migration 0370)." };

/** Internal control-flow signals (caught in this module; never reach a user). */
class EdgeDbUnavailable extends Error {}
class EdgeReplayed extends Error {}

async function db() {
  const d = await getDb();
  if (!d) throw new EdgeDbUnavailable("db unavailable");
  return d;
}

/** The factory scope of a node: its factoryCode, or unrestricted when it has none (only an unrestricted user may assign to it). */
export function nodeScopeOf(node: { factoryCode?: string | null }): FoeScope {
  const code = typeof node.factoryCode === "string" ? node.factoryCode.trim() : "";
  return code ? { tenantScope: { factoryCode: code } } : null;
}

/**
 * The node a caller may hand a run to: it exists, and its factory is inside the caller's scope (strict). A node with no factory
 * code ⇒ only an unrestricted caller. Missing / outside ⇒ "none" (the same answer); the scope cannot be resolved ⇒ "unverified".
 */
export async function resolveAssignableNode(
  code: string,
  callerScope: FoeScope,
): Promise<{ kind: "node"; id: number } | { kind: "none" } | { kind: "unverified" } | { kind: "unavailable" }> {
  // doc 81 Đợt 10 N6 — the edge runtime is off: no node could ever pull the run ⇒ the start is refused (nothing created).
  if (!edgeRuntimeEnabledNow()) return { kind: "unavailable" };
  try {
    const [{ edgeNodes }, { idsTrongPhamVi }] = await Promise.all([import("../../../drizzle/schema"), import("../../db/hierarchy")]);
    const d = await db();
    const [node] = await d.select({ id: edgeNodes.id, factoryCode: edgeNodes.factoryCode }).from(edgeNodes).where(eq(edgeNodes.code, String(code ?? "").trim())).limit(1);
    const callerIds = callerScope === null ? null : await idsTrongPhamVi("factory", callerScope, { strict: true });
    if (!node) return { kind: "none" };
    if (callerIds === null) return { kind: "node", id: node.id };
    const ns = nodeScopeOf(node);
    if (ns === null) return { kind: "none" };
    const nodeIds = await idsTrongPhamVi("factory", ns, { strict: true });
    if (!nodeIds || nodeIds.length === 0) return { kind: "none" };
    return nodeIds.every((id) => callerIds.includes(id)) ? { kind: "node", id: node.id } : { kind: "none" };
  } catch {
    return { kind: "unverified" };
  }
}

/** The node's view of a run: its assignment row (this node only) — else null. */
async function assignmentForNode(d: Awaited<ReturnType<typeof db>>, node: EdgeNodePrincipal, runId: number): Promise<RunEdgeAssignment | null> {
  if (!Number.isInteger(runId) || runId <= 0) return null;
  const [row] = await d.select().from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).limit(1);
  return row ?? null;
}

async function workflowHead(d: Awaited<ReturnType<typeof db>>, workflowId: number) {
  const [wf] = await d
    .select({ id: orchestrationWorkflows.id, ref: orchestrationWorkflows.ref, version: orchestrationWorkflows.version, definitionJson: orchestrationWorkflows.definitionJson, status: orchestrationWorkflows.status })
    .from(orchestrationWorkflows)
    .where(eq(orchestrationWorkflows.id, workflowId))
    .limit(1);
  return wf ?? null;
}

/** Defence in depth: the run's non-STOP targets must sit in the NODE's factory (the assigner was checked at assignment). */
async function runInNodeScope(run: { workflowId: number; paramsJson: unknown }, node: EdgeNodePrincipal): Promise<boolean> {
  try {
    const { runVisibleTo } = await import("../orchestration/foe/foeEngine");
    return (await runVisibleTo(run, nodeScopeOf(node))) === true;
  } catch {
    return false;
  }
}

async function auditEdge(node: EdgeNodePrincipal, action: string, runId: number, details: Record<string, unknown>): Promise<void> {
  try {
    const { createAuditLog } = await import("../../db/system");
    await createAuditLog({ userId: null, userName: `edge:${node.nodeCode}`, action, entityType: "orchestration_run", entityId: runId, entityName: node.nodeCode, details: { credentialId: node.credentialId, ...details } });
  } catch (err) {
    console.error(`[EdgeExec] audit ${action} run ${runId} not written: ${(err as Error)?.message ?? err}`);
  }
}

// ── pull ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PulledRun {
  runId: number;
  workflowId: number;
  workflowRef: string | null;
  workflowVersion: number;
  defHash: string;
  claimSeq: number;
  /** the definition snapshot (absent when it no longer matches the assignment: `refused`) */
  definition?: WorkflowDefinition;
  refused?: "definitionChanged";
}
export interface NodeClaim {
  runId: number;
  claimSeq: number;
  status: string;
  abortRequested: boolean;
  /** no progress for EDGE_CLAIM_STALE_MS (the node may declare it interrupted) */
  stale: boolean;
}

export async function pullForNode(
  node: EdgeNodePrincipal,
): Promise<EdgeAnswer<{ node: string; runs: PulledRun[]; claims: NodeClaim[]; stopsUnconfirmed: number[] }>> {
  try {
    const d = await db();
    await holdUnclaimedEdgeRuns(node.nodeId).catch(() => undefined); // F2 — bounded queueing (never blocks the pull)
    const queued = await d
      .select({ a: runEdgeAssignments, run: { id: orchestrationRuns.id, workflowId: orchestrationRuns.workflowId, workflowRef: orchestrationRuns.workflowRef, status: orchestrationRuns.status, paramsJson: orchestrationRuns.paramsJson } })
      .from(runEdgeAssignments)
      .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
      .where(and(eq(runEdgeAssignments.edgeNodeId, node.nodeId), eq(orchestrationRuns.status, "queued")))
      .orderBy(asc(runEdgeAssignments.assignedAt))
      .limit(EDGE_PULL_LIMIT);
    const runs: PulledRun[] = [];
    for (const { a, run } of queued) {
      if (!(await runInNodeScope(run, node))) continue; // not this node's to see (same as not assigned)
      const base = { runId: a.runId, workflowId: a.workflowId, workflowRef: run.workflowRef ?? null, workflowVersion: a.workflowVersion, defHash: a.defHash, claimSeq: a.claimSeq };
      const wf = await workflowHead(d, a.workflowId);
      const def = wf?.definitionJson as WorkflowDefinition | undefined;
      if (!wf || !def || hashWorkflowDefinition(def) !== a.defHash) {
        runs.push({ ...base, refused: "definitionChanged" });
        continue;
      }
      runs.push({ ...base, definition: def }); // F2 — no controller read here (the digest is compared fresh at the claim)
    }
    const claimedRows = await d
      .select({ a: runEdgeAssignments, run: { id: orchestrationRuns.id, status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson } })
      .from(runEdgeAssignments)
      .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
      .where(and(eq(runEdgeAssignments.edgeNodeId, node.nodeId), isNotNull(runEdgeAssignments.claimTokenHash)))
      .limit(200);
    const staleBefore = Date.now() - edgeClaimStaleMs();
    const claims: NodeClaim[] = claimedRows.map(({ a, run }) => {
      const last = (a.lastProgressAt ?? a.claimedAt) as Date | null;
      return {
        runId: a.runId,
        claimSeq: a.claimSeq,
        status: run.status,
        abortRequested: centralStopped(run),
        stale: !last || new Date(last).getTime() < staleBefore,
      };
    });
    // L-7 — runs THIS node executed that central ABORTED after their last segment here ended (no walker of them is left on the
    // node, so no signal can reach one): central's own sweep could not confirm some STOP (a failed `abort:<id>` row — central
    // usually cannot reach the line's devices). The node re-sends exactly those through its dispatchers (the engine's resend:
    // never a STOP already confirmed, only within ABORT_RESEND_WINDOW_MS — the same window, read the same way, as an abort retry).
    const abortedRows = await d
      .select({ runId: runEdgeAssignments.runId, finishedAt: orchestrationRuns.finishedAt })
      .from(runEdgeAssignments)
      .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
      .where(and(eq(runEdgeAssignments.edgeNodeId, node.nodeId), eq(orchestrationRuns.status, "aborted")))
      .orderBy(desc(orchestrationRuns.finishedAt))
      .limit(50);
    const recent = abortedRows.filter((r) => abortResendAllowed(r.finishedAt)).map((r) => r.runId);
    const stopsUnconfirmed = recent.length
      ? [
          ...new Set(
            (
              await d
                .select({ runId: orchestrationRunSteps.runId })
                .from(orchestrationRunSteps)
                .where(and(inArray(orchestrationRunSteps.runId, recent), like(orchestrationRunSteps.stepId, "abort:%"), eq(orchestrationRunSteps.status, "failed")))
            ).map((r) => r.runId),
          ),
        ]
      : [];
    return { http: 200, data: { node: node.nodeCode, runs, claims, stopsUnconfirmed } };
  } catch (err) {
    if (!isEdgeSchemaMissing(err)) console.error(`[EdgeExec] pull for node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return unavailable;
  }
}

// ── F2: a run no node claims is held, visibly (bounded queueing) ───────────────────────────────────────────────────────

/** How long a run assigned to a node may stay 'queued' (unclaimed) before it is held as "edge unreachable" (default 10 min, [5 s, 24 h]). */
export function edgeUnclaimedHoldMs(): number {
  const n = parseInt(process.env.EDGE_UNCLAIMED_HOLD_MS || "600000", 10);
  return Number.isFinite(n) ? Math.min(86_400_000, Math.max(5_000, n)) : 600_000;
}

/** The context mark of a run held because its node never claimed it (read by the run view / Studio). */
export const EDGE_UNREACHABLE_CTX_KEY = "edgeUnreachable";
/** doc 81 Đợt 10 N4 — the context mark of a queued run whose (alive) node has not claimed it yet ("capacity" | "node"); the
 *  key constants live in edgeProgramReportRule.ts (one set, cleared together by a Continue). */
export { EDGE_WAITING_CTX_KEY } from "./edgeProgramReportRule";
import { EDGE_WAITING_CTX_KEY } from "./edgeProgramReportRule";

/**
 * doc 81 Đợt 9 final wave F2 (final review I2) — every run assigned to a node (`nodeId`, or every node — the central health
 * scheduler) that has been 'queued' and unclaimed longer than EDGE_UNCLAIMED_HOLD_MS (since it was queued: max(assignedAt, the
 * run's last update)) ⇒ 'held', error "edge node X did not claim run N …", context `edgeUnreachable` + interrupted. The write is
 * conditional ('queued' only): a claim landing meanwhile wins, an abort stays 'aborted'. Nothing was dispatched for such a run
 * in this segment (it was never claimed), so there is nothing to STOP. Continue re-queues it (resumeRun), abort ends it.
 * Returns the held run ids. Throws on a DB error (callers catch: it never blocks a pull or the scheduler).
 */
export async function holdUnclaimedEdgeRuns(nodeId?: number): Promise<number[]> {
  const d = await db();
  const bound = edgeUnclaimedHoldMs();
  const { edgeNodes } = await import("../../../drizzle/schema");
  const due = await d
    .select({ runId: runEdgeAssignments.runId, nodeCode: edgeNodes.code, lastHeartbeatAt: edgeNodes.lastHeartbeatAt, healthJson: edgeNodes.healthJson })
    .from(runEdgeAssignments)
    .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
    .innerJoin(edgeNodes, eq(edgeNodes.id, runEdgeAssignments.edgeNodeId))
    .where(
      and(
        nodeId !== undefined ? eq(runEdgeAssignments.edgeNodeId, nodeId) : undefined,
        eq(orchestrationRuns.status, "queued"),
        sql`${runEdgeAssignments.claimTokenHash} IS NULL`,
        // on the DB clock; the run's updatedAt is a naive UTC timestamp (AT TIME ZONE 'UTC' — never the session zone)
        sql`GREATEST(${runEdgeAssignments.assignedAt}, ${orchestrationRuns.updatedAt} AT TIME ZONE 'UTC') < now() - (${bound} * interval '1 millisecond')`,
      ),
    )
    .limit(100);
  const held: number[] = [];
  for (const r of due) {
    // doc 81 Đợt 10 N4 — a node whose heartbeat is FRESH is alive: its runs are never held as "unreachable". At its run
    // capacity (heartbeat capacity.liveRuns ≥ maxRuns) the run is marked "waiting for edge capacity"; otherwise "waiting for
    // the edge node" (it is up but has not claimed — its own checks may be refusing it). Only a STALE heartbeat holds.
    const hb = r.lastHeartbeatAt ? new Date(r.lastHeartbeatAt).getTime() : NaN;
    if (Number.isFinite(hb) && Date.now() - hb < edgeHeartbeatStaleMs()) {
      const cap = ((r.healthJson ?? {}) as { capacity?: { liveRuns?: unknown; maxRuns?: unknown } }).capacity;
      const atCapacity = typeof cap?.liveRuns === "number" && typeof cap?.maxRuns === "number" && cap.maxRuns > 0 && cap.liveRuns >= cap.maxRuns;
      const reason = atCapacity ? "capacity" : "node";
      const mark = { [EDGE_WAITING_CTX_KEY]: reason, edgeWaitingAt: new Date().toISOString(), edgeWaitingNode: r.nodeCode };
      await d
        .update(orchestrationRuns)
        .set({ contextJson: sql`COALESCE(${orchestrationRuns.contextJson}, '{}'::jsonb) || ${JSON.stringify(mark)}::jsonb` })
        .where(and(eq(orchestrationRuns.id, r.runId), eq(orchestrationRuns.status, "queued"), sql`COALESCE(${orchestrationRuns.contextJson} ->> ${EDGE_WAITING_CTX_KEY}, '') <> ${reason}`));
      continue;
    }
    const minutes = Math.round(bound / 60_000);
    const error = `Edge node ${r.nodeCode} did not claim run ${r.runId} within ${minutes} min (edge unreachable, or its checks keep refusing it — e.g. its device configuration differs from central's); held — Continue to re-queue it for the node, or abort it.`;
    const mark = { [EDGE_UNREACHABLE_CTX_KEY]: true, edgeUnreachableAt: new Date().toISOString(), edgeUnreachableNode: r.nodeCode, interrupted: true, interruptedAt: new Date().toISOString(), interruptedFrom: "queued", interruptedBy: "edge unreachable" };
    const moved = await d
      .update(orchestrationRuns)
      .set({ status: "held", error, contextJson: sql`COALESCE(${orchestrationRuns.contextJson}, '{}'::jsonb) || ${JSON.stringify(mark)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(orchestrationRuns.id, r.runId), eq(orchestrationRuns.status, "queued")))
      .returning({ id: orchestrationRuns.id });
    if (moved.length === 0) continue;
    held.push(r.runId);
    console.warn(`[EdgeExec] run ${r.runId}: ${error}`);
    try {
      const { createAuditLog } = await import("../../db/system");
      await createAuditLog({ userId: null, userName: "system: edge claim bound", action: "EDGE_RUN_UNCLAIMED_HELD", entityType: "orchestration_run", entityId: r.runId, entityName: r.nodeCode, details: { boundMs: bound } });
    } catch (err) {
      console.error(`[EdgeExec] audit EDGE_RUN_UNCLAIMED_HELD run ${r.runId} not written: ${(err as Error)?.message ?? err}`);
    }
  }
  return held;
}

// ── claim ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function claimForNode(
  node: EdgeNodePrincipal,
  runId: number,
  body: { claimSeq?: unknown; defHash?: unknown; bindingDigest?: unknown },
): Promise<EdgeAnswer<{ runId: number; claimSeq: number; claimToken: string }>> {
  try {
    const d = await db();
    const a0 = await assignmentForNode(d, node, runId);
    if (!a0) return notFound(runId);
    const [run0] = await d.select({ workflowId: orchestrationRuns.workflowId, paramsJson: orchestrationRuns.paramsJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run0 || !(await runInNodeScope(run0, node))) return notFound(runId);
    const claimSeq = body.claimSeq;
    if (typeof claimSeq !== "number" || !Number.isInteger(claimSeq) || claimSeq < 0) return { http: 400, code: "bad_request", message: "`claimSeq` (integer) is required." };
    if (typeof body.defHash !== "string" || !HEX64.test(body.defHash)) return { http: 400, code: "bad_request", message: "`defHash` is required." };
    // the definition: the head must still be the assigned snapshot, and the edge must hold that same snapshot
    const wf = await workflowHead(d, a0.workflowId);
    const def = wf?.definitionJson as WorkflowDefinition | undefined;
    if (!wf || !def || hashWorkflowDefinition(def) !== a0.defHash || body.defHash !== a0.defHash) {
      return { http: 409, code: "definition_changed", message: `Run ${runId}: the workflow was redeployed after the assignment (or the edge holds another snapshot) — it cannot be claimed.` };
    }
    // the device configuration: central's view and the edge's view must agree (computed BEFORE the transaction — it may read
    // controllers, bounded); either side null ⇒ cannot decide ⇒ refused
    const centralDigest = await computeBindingDigest(d, def);
    if (centralDigest === null || typeof body.bindingDigest !== "string" || body.bindingDigest !== centralDigest) {
      return { http: 409, code: "binding_changed", message: `Run ${runId}: the device configuration seen by the edge differs from central's (or could not be read) — not claimed.` };
    }
    const token = `ect_${randomBytes(32).toString("base64url")}`;
    const out = await d.transaction(async (tx) => {
      const [a] = await tx.select().from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).for("update").limit(1);
      if (!a) return notFound(runId);
      if (a.claimSeq !== claimSeq) return { http: 409, code: "claim_conflict", message: `Run ${runId}: claim ${claimSeq} is not the next claim (now ${a.claimSeq}).` } as EdgeAnswer;
      const moved = await tx
        .update(orchestrationRuns)
        .set({ status: "running", startedAt: sql`COALESCE(${orchestrationRuns.startedAt}, now())`, updatedAt: new Date() })
        .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.status, "queued")))
        .returning({ id: orchestrationRuns.id });
      if (moved.length === 0) return { http: 409, code: "claim_conflict", message: `Run ${runId} is not waiting to be claimed.` } as EdgeAnswer;
      await tx
        .update(runEdgeAssignments)
        .set({ claimSeq: a.claimSeq + 1, claimTokenHash: hashEdgeSecret(token), claimedByCredentialId: node.credentialId, claimedAt: new Date(), progressSeq: 0, lastProgressAt: new Date() })
        .where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.claimSeq, a.claimSeq)));
      return { http: 200, data: { runId, claimSeq: a.claimSeq + 1, claimToken: token } } as EdgeAnswer<{ runId: number; claimSeq: number; claimToken: string }>;
    });
    if (out.http === 200) await auditEdge(node, "EDGE_RUN_CLAIM", runId, { claimSeq: (out.data as { claimSeq: number }).claimSeq });
    return out as EdgeAnswer<{ runId: number; claimSeq: number; claimToken: string }>;
  } catch (err) {
    if (!isEdgeSchemaMissing(err)) console.error(`[EdgeExec] claim of run ${runId} by node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return unavailable;
  }
}

// ── progress / complete / release (all bound to the CURRENT claim) ─────────────────────────────────────────────────────

interface ClaimBody {
  claimSeq?: unknown;
  claimToken?: unknown;
  seq?: unknown;
}
type ClaimCheck = { ok: true; a: RunEdgeAssignment; tokenHash: string; seq: number } | { ok: false; answer: EdgeAnswer };

async function checkCurrentClaim(d: Awaited<ReturnType<typeof db>>, node: EdgeNodePrincipal, runId: number, body: ClaimBody, needSeq = true): Promise<ClaimCheck> {
  const a = await assignmentForNode(d, node, runId);
  if (!a) return { ok: false, answer: notFound(runId) };
  if (typeof body.claimToken !== "string" || !CLAIM_TOKEN_RE.test(body.claimToken) || typeof body.claimSeq !== "number") {
    return { ok: false, answer: { http: 400, code: "bad_request", message: "`claimSeq` and `claimToken` are required." } };
  }
  const tokenHash = hashEdgeSecret(body.claimToken);
  if (a.claimSeq !== body.claimSeq || !sameDigest(tokenHash, a.claimTokenHash)) {
    const [run] = await d.select({ status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    return { ok: false, answer: { http: 409, code: "claim_stale", message: `Run ${runId}: this claim is no longer current — stop walking it.`, data: { abortRequested: run ? centralStopped(run) : true } } };
  }
  const seq = body.seq;
  if (needSeq && (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq <= 0)) {
    return { ok: false, answer: { http: 400, code: "bad_request", message: "`seq` (positive integer) is required." } };
  }
  if (needSeq && (seq as number) <= Number(a.progressSeq)) {
    return { ok: false, answer: { http: 409, code: "replayed", message: `Run ${runId}: report ${seq} was already received (last ${a.progressSeq}) — refused.` } };
  }
  return { ok: true, a, tokenHash, seq: needSeq ? (seq as number) : Number(a.progressSeq) };
}

/** CAS: advance progressSeq (and optionally clear the token) only while the claim and its sequence are as checked. */
async function advance(d: Awaited<ReturnType<typeof db>>, runId: number, c: { a: RunEdgeAssignment; tokenHash: string; seq: number }, clearToken: boolean): Promise<boolean> {
  const rows = await d
    .update(runEdgeAssignments)
    .set({ progressSeq: c.seq, lastProgressAt: new Date(), ...(clearToken ? { claimTokenHash: null } : {}) })
    .where(
      and(
        eq(runEdgeAssignments.runId, runId),
        eq(runEdgeAssignments.claimSeq, c.a.claimSeq),
        eq(runEdgeAssignments.claimTokenHash, c.tokenHash),
        sql`${runEdgeAssignments.progressSeq} < ${c.seq}`,
      ),
    )
    .returning({ runId: runEdgeAssignments.runId });
  return rows.length > 0;
}

export async function progressForNode(
  node: EdgeNodePrincipal,
  runId: number,
  body: ClaimBody & { status?: unknown; currentStepId?: unknown },
): Promise<EdgeAnswer<{ abortRequested: boolean; status: string; consistent: boolean }>> {
  try {
    const d = await db();
    const c = await checkCurrentClaim(d, node, runId, body);
    if (!c.ok) return c.answer as EdgeAnswer<never>;
    if (!(await advance(d, runId, c, false))) return { http: 409, code: "replayed", message: `Run ${runId}: report ${c.seq} was already received — refused.` };
    const [run] = await d.select({ status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return notFound(runId) as EdgeAnswer<never>;
    return { http: 200, data: { abortRequested: centralStopped(run), status: run.status, consistent: body.status === run.status } };
  } catch (err) {
    if (!isEdgeSchemaMissing(err)) console.error(`[EdgeExec] progress of run ${runId} by node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return unavailable as EdgeAnswer<never>;
  }
}

export async function completeForNode(
  node: EdgeNodePrincipal,
  runId: number,
  body: ClaimBody & { status?: unknown },
): Promise<EdgeAnswer<{ abortRequested: boolean; status: string }>> {
  try {
    const d = await db();
    const c = await checkCurrentClaim(d, node, runId, body);
    if (!c.ok) return c.answer as EdgeAnswer<never>;
    const [run] = await d.select({ status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run) return notFound(runId) as EdgeAnswer<never>;
    // the RUN ROW decides — never the report: a run still walking is not "complete", whatever the edge says
    if (!EDGE_SEGMENT_END_STATUSES.has(run.status)) {
      return { http: 409, code: "not_finished", message: `Run ${runId} is ${run.status} — its segment has not ended; nothing changed.` };
    }
    if (!(await advance(d, runId, c, true))) return { http: 409, code: "replayed", message: `Run ${runId}: report ${c.seq} was already received — refused.` };
    await auditEdge(node, "EDGE_RUN_SEGMENT_DONE", runId, { claimSeq: c.a.claimSeq, status: run.status, reported: typeof body.status === "string" ? body.status : null });
    return { http: 200, data: { abortRequested: centralStopped(run), status: run.status } };
  } catch (err) {
    if (!isEdgeSchemaMissing(err)) console.error(`[EdgeExec] complete of run ${runId} by node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return unavailable as EdgeAnswer<never>;
  }
}

function interruptedContext(ctx: unknown, from: string, why: string): Record<string, unknown> {
  return { ...((ctx as Record<string, unknown> | null) ?? {}), interrupted: true, interruptedAt: new Date().toISOString(), interruptedFrom: from, interruptedBy: why };
}

/** The edge will not execute what it claimed (its own checks failed): 'running' → 'held', claim cleared. */
export async function releaseForNode(
  node: EdgeNodePrincipal,
  runId: number,
  body: ClaimBody & { reason?: unknown },
): Promise<EdgeAnswer<{ status: string }>> {
  try {
    const d = await db();
    const c = await checkCurrentClaim(d, node, runId, body);
    if (!c.ok) return c.answer as EdgeAnswer<never>;
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 300) : "unspecified";
    const out = await d.transaction(async (tx) => {
      const [run] = await tx.select({ status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).for("update").limit(1);
      if (!run) return notFound(runId);
      if (run.status === "running") {
        await tx
          .update(orchestrationRuns)
          .set({ status: "held", error: `Edge node ${node.nodeCode} did not execute run ${runId}: ${reason}`, contextJson: interruptedContext(run.contextJson, "running", `edge release: ${reason}`), updatedAt: new Date() })
          .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.status, "running")));
      }
      const ok = await tx
        .update(runEdgeAssignments)
        .set({ progressSeq: c.seq, lastProgressAt: new Date(), claimTokenHash: null })
        .where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.claimSeq, c.a.claimSeq), eq(runEdgeAssignments.claimTokenHash, c.tokenHash), sql`${runEdgeAssignments.progressSeq} < ${c.seq}`))
        .returning({ runId: runEdgeAssignments.runId });
      if (ok.length === 0) throw new EdgeReplayed("replayed"); // rolls the transaction back; mapped below
      return { http: 200, data: { status: run.status === "running" ? "held" : run.status } } as EdgeAnswer<{ status: string }>;
    });
    if (out.http === 200) await auditEdge(node, "EDGE_RUN_RELEASE", runId, { claimSeq: c.a.claimSeq, reason });
    return out as EdgeAnswer<{ status: string }>;
  } catch (err) {
    if (err instanceof EdgeReplayed) return { http: 409, code: "replayed", message: `Run ${runId}: report already received — refused.` };
    if (!isEdgeSchemaMissing(err)) console.error(`[EdgeExec] release of run ${runId} by node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return unavailable as EdgeAnswer<never>;
  }
}

/**
 * The node restarted and holds no walker for a claim of its own. Only a STALE claim (no progress for EDGE_CLAIM_STALE_MS) can
 * be declared interrupted — a live walker of the same node keeps it fresh — then 'running' ⇒ 'held' (interrupted, a person may
 * Continue), 'compensating' ⇒ 'failed' (central's restart rule); the claim is cleared either way.
 */
export async function interruptedForNode(node: EdgeNodePrincipal, runId: number, body: { claimSeq?: unknown }): Promise<EdgeAnswer<{ status: string }>> {
  try {
    const d = await db();
    const a = await assignmentForNode(d, node, runId);
    if (!a) return notFound(runId) as EdgeAnswer<never>;
    if (typeof body.claimSeq !== "number" || body.claimSeq !== a.claimSeq || !a.claimTokenHash) {
      return { http: 409, code: "claim_stale", message: `Run ${runId}: no such current claim.` };
    }
    const last = (a.lastProgressAt ?? a.claimedAt) as Date | null;
    if (last && new Date(last).getTime() >= Date.now() - edgeClaimStaleMs()) {
      return { http: 409, code: "claim_live", message: `Run ${runId}: the claim reported progress less than ${edgeClaimStaleMs()} ms ago — not interrupted.` };
    }
    const out = await d.transaction(async (tx) => {
      const [run] = await tx.select({ status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).for("update").limit(1);
      if (!run) return notFound(runId);
      let status = run.status as string;
      if (run.status === "running" || run.status === "compensating") {
        status = run.status === "running" ? "held" : "failed";
        await tx
          .update(orchestrationRuns)
          .set({
            status: status as never,
            error: `Interrupted on edge node ${node.nodeCode} (was ${run.status}); ${status === "held" ? "awaiting manual resume" : "not auto-resumed"}.`,
            contextJson: interruptedContext(run.contextJson, run.status, "edge restart"),
            ...(status === "failed" ? { finishedAt: new Date() } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.status, run.status)));
      }
      await tx.update(runEdgeAssignments).set({ claimTokenHash: null }).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.claimSeq, a.claimSeq)));
      return { http: 200, data: { status } } as EdgeAnswer<{ status: string }>;
    });
    if (out.http === 200) await auditEdge(node, "EDGE_RUN_INTERRUPTED", runId, { claimSeq: a.claimSeq, status: (out.data as { status: string }).status });
    return out as EdgeAnswer<{ status: string }>;
  } catch (err) {
    if (!isEdgeSchemaMissing(err)) console.error(`[EdgeExec] interrupted of run ${runId} by node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return unavailable as EdgeAnswer<never>;
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 10 task B — PROTOCOL v2 (design §2.3–2.8): the edge holds NO database login. Central is the only writer of the
// run row, its step rows, approvals, ledgers and audit; the edge gets SIGNED objects (edgeSigning / edgeProtocol): the run
// package at the claim, sweep pictures and commands on the pull / progress. Every body is parsed with its STRICT schema.
// The v1 handlers above stay for v1 nodes (D11, one release); a v2 node is served ONLY by these (the route decides by the
// node's protocolVersion — a v1 claim is never accepted for a v2 node).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** N4 — a node whose last heartbeat is older than this is stale (only then are its unclaimed runs held as unreachable). */
export function edgeHeartbeatStaleMs(): number {
  const n = parseInt(process.env.EDGE_HEARTBEAT_STALE_MS || "60000", 10);
  return Number.isFinite(n) ? Math.min(3_600_000, Math.max(5_000, n)) : 60_000;
}
/** N5 — the minimum interval between two claim attempts of one node on one run. */
export function edgeClaimMinIntervalMs(): number {
  const n = parseInt(process.env.EDGE_CLAIM_MIN_INTERVAL_MS || "1000", 10);
  return Number.isFinite(n) ? Math.min(60_000, Math.max(0, n)) : 1_000;
}
const lastClaimAttempt = new Map<string, number>();
/** Tests only. */
export function __resetClaimRateForTests(): void {
  lastClaimAttempt.clear();
}

/** The run context shipped in a package: the server-only rejection claim token is never shipped. */
function packageContext(ctx: unknown): Record<string, unknown> {
  const src = (ctx ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) if (k !== FOE_REJECT_CLAIM_CTX_KEY) out[k] = v;
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}
const plainJson = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

async function v2Gate(d: CentralDbHandle, node: EdgeNodePrincipal, opts: { signerOptional?: boolean } = {}): Promise<EdgeAnswer<never> | null> {
  const v = await nodeProtocolVersion(d, node.nodeId);
  if (v !== EDGE_PROTOCOL_VERSION) return protocolVersionAnswer(v);
  // R-10-k — pull and progress still answer without the signer: they carry the node's pending STOPs (unsigned)
  if (!opts.signerOptional && !centralSigner()) return edgeUnavailableV2;
  return null;
}

/** The commands part of a pull / progress answer (unsignedStops only when there are any — i.e. only without a signer). */
async function commandFields(node: EdgeNodePrincipal): Promise<{ commands: EdgeSignedEnvelope[]; unsignedStops?: EdgeUnsignedStopEnvelope[] }> {
  const c = await commandsForNode(node);
  return c.unsignedStops.length > 0 ? { commands: c.signed, unsignedStops: c.unsignedStops } : { commands: c.signed };
}

/** The picture both the run package and a sweep picture carry (runPicture of edgeProtocol). */
async function runPicture(d: CentralDbHandle, node: EdgeNodePrincipal, runId: number, defHash: string, def: WorkflowDefinition) {
  const machineMap = await loadMachineMap(d, def);
  const analysis = await analyseDefinition(d, runId, def, machineMap);
  const prior = await readPriorPicture(d, runId);
  return {
    analysis,
    picture: {
      runId,
      nodeId: node.nodeId,
      defHash,
      definition: plainJson(def) as unknown as Record<string, unknown>,
      machines: [...machineMap.values()].sort((a, b) => a.id - b.id).map((m) => ({ id: m.id, machineType: m.machineType, capabilities: plainJson(m.capabilities ?? null) })),
      verifiedStops: analysis.verifiedStops,
      stopsUnsure: analysis.stopsUnsure,
      prior,
      issuedAt: Date.now(),
    },
  };
}

/** Is a fresh program reading wanted from the node (a run of it is queued / awaiting approval and an owned adapter has none)? */
async function programCheckWanted(d: CentralDbHandle, node: EdgeNodePrincipal): Promise<boolean> {
  try {
    const waiting = await d
      .select({ runId: runEdgeAssignments.runId })
      .from(runEdgeAssignments)
      .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
      .where(and(eq(runEdgeAssignments.edgeNodeId, node.nodeId), inArray(orchestrationRuns.status, ["queued", "awaiting_confirm"])))
      .limit(1);
    if (waiting.length === 0) return false;
    const { edgeProgramReportMaxAgeMs } = await import("./edgeConfigCentral");
    const owned = await devicesOfNode(d, node.nodeId);
    if (owned.adapters.length === 0) return false;
    const fresh = await d
      .select({ adapterId: edgeNodeProgramReports.adapterId })
      .from(edgeNodeProgramReports)
      .where(and(eq(edgeNodeProgramReports.edgeNodeId, node.nodeId), sql`${edgeNodeProgramReports.receivedAt} > now() - (${Math.floor(edgeProgramReportMaxAgeMs() / 2)} * interval '1 millisecond')`));
    const have = new Set(fresh.map((r) => r.adapterId));
    return owned.adapters.some((id) => !have.has(id));
  } catch {
    return false;
  }
}

/** The sweep picture payload; `abortedAt` (Group C's addition to the schema) is carried once the schema has it. */
function sweepPayload(picture: Record<string, unknown>, finishedAt: Date | string | null | undefined): Record<string, unknown> {
  const base = { kind: "sweep_picture", ...picture };
  const at = finishedAt == null ? NaN : new Date(finishedAt).getTime();
  return "abortedAt" in (edgeSweepPictureSchema as unknown as { shape: Record<string, unknown> }).shape && Number.isFinite(at) ? { ...base, abortedAt: at } : base;
}

/** POST /edge/node/pull (v2). */
export async function pullForNodeV2(node: EdgeNodePrincipal, body: unknown): Promise<EdgeAnswer<EdgePullAnswer>> {
  const parsed = parseEdgeBody(edgePullRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  try {
    const d = await db();
    const refused = await v2Gate(d, node, { signerOptional: true });
    if (refused) return refused;
    const signer = centralSigner();
    await holdUnclaimedEdgeRuns(node.nodeId).catch(() => undefined);
    const queued = await d
      .select({ a: runEdgeAssignments, run: { id: orchestrationRuns.id, workflowId: orchestrationRuns.workflowId, workflowRef: orchestrationRuns.workflowRef, paramsJson: orchestrationRuns.paramsJson } })
      .from(runEdgeAssignments)
      .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
      .where(and(eq(runEdgeAssignments.edgeNodeId, node.nodeId), eq(orchestrationRuns.status, "queued")))
      .orderBy(asc(runEdgeAssignments.assignedAt))
      .limit(EDGE_PULL_LIMIT);
    const runs: EdgePulledRun[] = [];
    for (const { a, run } of signer ? queued : []) {
      // (no signer ⇒ no run can be claimed now: none is offered)
      if (!(await runInNodeScope(run, node))) continue;
      const base = { runId: a.runId, workflowId: a.workflowId, workflowRef: run.workflowRef ?? null, workflowVersion: a.workflowVersion, defHash: a.defHash, claimSeq: a.claimSeq };
      const wf = await workflowHead(d, a.workflowId);
      const def = wf?.definitionJson as WorkflowDefinition | undefined;
      runs.push(!wf || !def || hashWorkflowDefinition(def) !== a.defHash ? { ...base, refused: "definitionChanged" as const } : base);
    }
    const claimedRows = await d
      .select({ a: runEdgeAssignments, run: { status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson } })
      .from(runEdgeAssignments)
      .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
      .where(and(eq(runEdgeAssignments.edgeNodeId, node.nodeId), isNotNull(runEdgeAssignments.claimTokenHash)))
      .limit(200);
    const staleBefore = Date.now() - edgeClaimStaleMs();
    const claims: EdgeNodeClaim[] = claimedRows
      .filter(({ a }) => a.claimSeq > 0)
      .map(({ a, run }) => {
        const last = (a.lastProgressAt ?? a.claimedAt) as Date | null;
        return { runId: a.runId, claimSeq: a.claimSeq, status: run.status as EdgeNodeClaim["status"], abortRequested: centralStopped(run), stale: !last || new Date(last).getTime() < staleBefore };
      });
    // L-7 — aborted runs of this node whose STOPs central could not confirm: a SIGNED sweep picture each (the node re-sends)
    const abortedRows = await d
      .select({ a: runEdgeAssignments, finishedAt: orchestrationRuns.finishedAt })
      .from(runEdgeAssignments)
      .innerJoin(orchestrationRuns, eq(orchestrationRuns.id, runEdgeAssignments.runId))
      .where(and(eq(runEdgeAssignments.edgeNodeId, node.nodeId), eq(orchestrationRuns.status, "aborted")))
      .orderBy(desc(orchestrationRuns.finishedAt))
      .limit(50);
    const recent = abortedRows.filter((r) => abortResendAllowed(r.finishedAt));
    const failedIds = recent.length
      ? new Set(
          (
            await d
              .select({ runId: orchestrationRunSteps.runId })
              .from(orchestrationRunSteps)
              .where(and(inArray(orchestrationRunSteps.runId, recent.map((r) => r.a.runId)), like(orchestrationRunSteps.stepId, "abort:%"), eq(orchestrationRunSteps.status, "failed")))
          ).map((r) => r.runId),
        )
      : new Set<number>();
    const stopsUnconfirmed: Array<{ runId: number; picture: EdgeSignedEnvelope }> = [];
    for (const r of signer ? recent : []) {
      if (!failedIds.has(r.a.runId)) continue;
      const def = await assignedDefinition(d, r.a);
      if (!def) continue;
      const { picture } = await runPicture(d, node, r.a.runId, r.a.defHash, def);
      stopsUnconfirmed.push({ runId: r.a.runId, picture: signForNode(signer!, "runpkg", edgeSweepPictureSchema, sweepPayload(picture, r.finishedAt), node) });
    }
    const { currentConfigVersion } = await import("./edgeConfigCentral");
    return {
      http: 200,
      data: {
        node: node.nodeCode,
        protocolVersion: EDGE_PROTOCOL_VERSION,
        configVersion: await currentConfigVersion(node),
        keysetVersion: signer ? signer.keyset.version : 0,
        programCheckRequested: await programCheckWanted(d, node),
        runs,
        claims,
        stopsUnconfirmed,
        ...(await commandFields(node)),
      },
    };
  } catch (err) {
    if (!isEdgeUnavailableError(err) && !(err instanceof EdgeDbUnavailable)) console.error(`[EdgeExec] v2 pull for node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailableV2;
  }
}

/**
 * POST /edge/node/runs/:runId/claim (v2). N5 — cheapest first: the per-(node, run) minimum interval, then the assignment, the
 * claim sequence, the run status and the snapshot (no device / digest work before these); then the scope, the device
 * OWNERSHIP of every target (409 not_owned), the node's program readings (stored — D7), and the SIGNED run package is built
 * BEFORE the compare-and-set so a committed claim always comes with its package.
 */
export async function claimForNodeV2(node: EdgeNodePrincipal, runId: number, body: unknown): Promise<EdgeAnswer<EdgeClaimAnswer>> {
  const key = `${node.nodeId}:${runId}`;
  const now = Date.now();
  const prev = lastClaimAttempt.get(key);
  if (prev !== undefined && now - prev < edgeClaimMinIntervalMs()) return edgeError("rate_limited", `Claim attempts on run ${runId} are limited to one per ${edgeClaimMinIntervalMs()} ms.`);
  lastClaimAttempt.set(key, now);
  if (lastClaimAttempt.size > 10_000) for (const [k, t] of lastClaimAttempt) if (now - t > 60_000) lastClaimAttempt.delete(k);
  const parsed = parseEdgeBody(edgeClaimRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  const req = parsed.data;
  try {
    const d = await db();
    const refused = await v2Gate(d, node);
    if (refused) return refused;
    const signer = centralSigner()!;
    const a0 = await assignmentForNode(d, node, runId);
    if (!a0) return runNotFound(runId);
    const [run0] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run0) return runNotFound(runId);
    if (a0.claimSeq !== req.claimSeq) return edgeError("claim_conflict", `Run ${runId}: claim ${req.claimSeq} is not the next claim (now ${a0.claimSeq}).`);
    if (run0.status !== "queued") return edgeError("claim_conflict", `Run ${runId} is not waiting to be claimed.`);
    if (req.defHash !== a0.defHash) return edgeError("definition_changed", `Run ${runId}: the edge holds another snapshot than the assignment — it cannot be claimed.`);
    const wf = await workflowHead(d, a0.workflowId);
    const def = wf?.definitionJson as WorkflowDefinition | undefined;
    if (!wf || !def || hashWorkflowDefinition(def) !== a0.defHash) return edgeError("definition_changed", `Run ${runId}: the workflow was redeployed after the assignment — it cannot be claimed.`);
    if (!(await runInNodeScope(run0, node))) return runNotFound(runId);
    // ownership of every target (design §2.12 — checked at the start and again at every /authorize)
    const { picture, analysis } = await runPicture(d, node, runId, a0.defHash, def);
    const [ownR, ownA] = await Promise.all([ownedRobotIds(d, node.nodeId, analysis.robotIds), ownedAdapterIds(d, node.nodeId, analysis.adapterIds)]);
    const foreign = [...analysis.robotIds.filter((id) => !ownR.has(id)).map((id) => `robot ${id}`), ...analysis.adapterIds.filter((id) => !ownA.has(id)).map((id) => `adapter ${id}`)];
    if (foreign.length) return edgeError("not_owned", `Run ${runId} targets devices this node does not own (${foreign.slice(0, 5).join(", ")}) — not claimed.`);
    // D7 — the node's readings of its adapters (fresh for this claim) are stored; central never reads them itself
    const { edgeProgramPreFor } = await import("./edgeAuthorizeCentral");
    const detail = await computeBindingDetail(d, def, await edgeProgramPreFor(d, node, req.programChecks)); // R-10-m — the one rule
    const [owner] = typeof run0.startedBy === "number" && run0.startedBy > 0 ? await d.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, run0.startedBy)).limit(1) : [];
    const stepRows = await d.select().from(orchestrationRunSteps).where(eq(orchestrationRunSteps.runId, runId));
    const approvals = stepRows
      .filter((r) => r.status === "completed" && typeof (r.resultJson as { approvedBy?: unknown } | null)?.approvedBy === "number" && (r.resultJson as { approvalSource?: unknown }).approvalSource === "server")
      .map((r) => ({ gateStepId: r.stepId, approvedBy: (r.resultJson as { approvedBy: number }).approvedBy, approvedAt: r.finishedAt ? new Date(r.finishedAt).getTime() : 0 }))
      .slice(0, 200);
    const claimSeq = req.claimSeq + 1;
    const pkg = signForNode(
      signer,
      "runpkg",
      edgeRunPackageSchema,
      {
        kind: "run_package",
        ...picture,
        claimSeq,
        workflowId: a0.workflowId,
        workflowVersion: a0.workflowVersion,
        params: plainJson((run0.paramsJson ?? {}) as Record<string, unknown>),
        context: packageContext(run0.contextJson),
        owner: owner && owner.isActive !== false && typeof owner.role === "string" && owner.role ? { id: owner.id, role: owner.role } : null,
        startedViaApi: runStartedViaApi(run0),
        resolvedAdapters: analysis.resolvedAdapters,
        approvals,
        bindingDigest: detail.digest,
      },
      node,
    );
    const token = `ect_${randomBytes(32).toString("base64url")}`;
    const out = await d.transaction(async (tx) => {
      const [a] = await tx.select().from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).for("update").limit(1);
      if (!a) return runNotFound(runId) as EdgeAnswer;
      if (a.claimSeq !== req.claimSeq) return edgeError("claim_conflict", `Run ${runId}: claim ${req.claimSeq} is not the next claim (now ${a.claimSeq}).`) as EdgeAnswer;
      const moved = await tx
        .update(orchestrationRuns)
        .set({ status: "running", startedAt: sql`COALESCE(${orchestrationRuns.startedAt}, now())`, updatedAt: new Date() })
        .where(and(eq(orchestrationRuns.id, runId), eq(orchestrationRuns.status, "queued")))
        .returning({ id: orchestrationRuns.id });
      if (moved.length === 0) return edgeError("claim_conflict", `Run ${runId} is not waiting to be claimed.`) as EdgeAnswer;
      await tx
        .update(runEdgeAssignments)
        .set({ claimSeq, claimTokenHash: hashEdgeSecret(token), claimedByCredentialId: node.credentialId, claimedAt: new Date(), progressSeq: 0, lastProgressAt: new Date() })
        .where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.claimSeq, a.claimSeq)));
      return { http: 200, data: { runId, claimSeq, claimToken: token, package: pkg } } as EdgeAnswer<EdgeClaimAnswer>;
    });
    if (out.http === 200) await auditEdge(node, "EDGE_RUN_CLAIM", runId, { claimSeq, protocolVersion: EDGE_PROTOCOL_VERSION, bindingDigest: detail.digest });
    return out as EdgeAnswer<EdgeClaimAnswer>;
  } catch (err) {
    if (!isEdgeUnavailableError(err) && !(err instanceof EdgeDbUnavailable)) console.error(`[EdgeExec] v2 claim of run ${runId} by node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailableV2;
  }
}

/** POST /edge/node/runs/:runId/progress (v2) — liveness + abortRequested + the node's signed commands. */
export async function progressForNodeV2(node: EdgeNodePrincipal, runId: number, body: unknown): Promise<EdgeAnswer<EdgeProgressAnswer>> {
  const parsed = parseEdgeBody(edgeProgressRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  try {
    const d = await db();
    const refused = await v2Gate(d, node, { signerOptional: true });
    if (refused) return refused;
    const r = await progressForNode(node, runId, parsed.data);
    if (r.http !== 200 || !r.data) return r as EdgeAnswer<never>;
    return { http: 200, data: { abortRequested: r.data.abortRequested, status: r.data.status as EdgeProgressAnswer["status"], consistent: r.data.consistent, ...(await commandFields(node)) } };
  } catch (err) {
    if (!isEdgeUnavailableError(err) && !(err instanceof EdgeDbUnavailable)) console.error(`[EdgeExec] v2 progress of run ${runId} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailableV2;
  }
}

/**
 * POST /edge/node/runs/:runId/complete (v2) — the edge's segment outcome. The claim must be current and its run stream must be
 * reported through `reportedThrough` (else 409 gap); central applies the outcome with the engine's rules (edgeEngineSink —
 * `completed` only when the rows show every top-level step done; `paused` at a hitl_gate of the definition) and clears the
 * claim token, in ONE transaction. A centrally stopped run keeps its status.
 */
export async function completeForNodeV2(node: EdgeNodePrincipal, runId: number, body: unknown): Promise<EdgeAnswer<EdgeCompleteAnswer>> {
  const parsed = parseEdgeBody(edgeCompleteRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  const req = parsed.data;
  try {
    const d = await db();
    const refused = await v2Gate(d, node);
    if (refused) return refused;
    const c = await checkCurrentClaim(d, node, runId, req);
    if (!c.ok) return c.answer as EdgeAnswer<never>;
    const last = await cursorLastSeq(d, node.nodeId, edgeRunStream(runId, req.claimSeq), req.epoch);
    if (last < req.reportedThrough) return edgeError("gap", `Run ${runId}: reports through ${req.reportedThrough} are not all received (cursor ${last}) — resend them first.`, { expectedSeq: last + 1 });
    const def = await assignedDefinition(d, c.a);
    if (!def) return edgeError("definition_changed", `Run ${runId}: the assigned definition can no longer be read.`);
    if (req.outcome === "paused") {
      const gate = findStepDeep(def.steps, req.gateStepId as string);
      if (!gate || gate.type !== "hitl_gate") return edgeError("step_invalid", `"${req.gateStepId}" is not an approval gate of run ${runId}.`);
    }
    const sink = await resolveEngineSink();
    const out = await d.transaction(async (tx) => {
      const r = await sink.applyEdgeSegmentEnd(tx as unknown as CentralDbHandle, runId, {
        outcome: req.outcome,
        gateStepId: req.gateStepId,
        heldReason: req.heldReason,
        error: req.error,
        nodeCode: node.nodeCode,
        claimSeq: req.claimSeq,
        def,
      });
      if (!r.ok) return edgeError("not_finished", r.message) as EdgeAnswer;
      if (!(await advance(tx as unknown as Awaited<ReturnType<typeof db>>, runId, c, true))) throw new EdgeReplayed("replayed");
      const [run] = await tx.select({ status: orchestrationRuns.status, contextJson: orchestrationRuns.contextJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
      return { http: 200, data: { abortRequested: run ? centralStopped(run) : true, status: (run?.status ?? r.status) as EdgeCompleteAnswer["status"] } } as EdgeAnswer<EdgeCompleteAnswer>;
    });
    if (out.http === 200) await auditEdge(node, "EDGE_RUN_SEGMENT_DONE", runId, { claimSeq: req.claimSeq, outcome: req.outcome, status: (out.data as EdgeCompleteAnswer).status, ...(req.heldReason ? { heldReason: req.heldReason } : {}) });
    return out as EdgeAnswer<EdgeCompleteAnswer>;
  } catch (err) {
    if (err instanceof EdgeReplayed) return edgeError("replayed", `Run ${runId}: report already received — refused.`);
    if (!isEdgeUnavailableError(err) && !(err instanceof EdgeDbUnavailable)) console.error(`[EdgeExec] v2 complete of run ${runId} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailableV2;
  }
}

/** POST release / interrupted (v2): strict bodies, then the shared handlers (unchanged semantics). */
export async function releaseForNodeV2(node: EdgeNodePrincipal, runId: number, body: unknown): Promise<EdgeAnswer<{ status: string }>> {
  const parsed = parseEdgeBody(edgeReleaseRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  try {
    const refused = await v2Gate(await db(), node);
    if (refused) return refused;
  } catch {
    return edgeUnavailableV2;
  }
  return releaseForNode(node, runId, parsed.data);
}
export async function interruptedForNodeV2(node: EdgeNodePrincipal, runId: number, body: unknown): Promise<EdgeAnswer<{ status: string }>> {
  const parsed = parseEdgeBody(edgeInterruptedRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  try {
    const refused = await v2Gate(await db(), node);
    if (refused) return refused;
  } catch {
    return edgeUnavailableV2;
  }
  return interruptedForNode(node, runId, parsed.data);
}

/** heartbeat answer — whether a fresh program reading is wanted from the node (never throws). */
export async function programCheckRequestedFor(node: EdgeNodePrincipal): Promise<boolean> {
  try {
    return await programCheckWanted(await db(), node);
  } catch {
    return false;
  }
}
