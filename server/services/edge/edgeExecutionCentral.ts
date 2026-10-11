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
 *                 must equal the assignment's), central's BINDING DIGEST now, and the claim sequence to claim; plus the
 *                 node's current claims with `abortRequested` (central aborted it, or a gate rejection claimed it).
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
import { centralStopped } from "./edgeCoordinator";
import { runEdgeAssignments, isEdgeSchemaMissing, type RunEdgeAssignment } from "./edgeExecutionSchema";
export { readEdgeAssignment, edgeAssignedRunIdsAmong } from "./edgeExecutionSchema";
import { hashEdgeSecret, sameDigest, type EdgeNodePrincipal } from "./edgeNodeCredentials";

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
export async function resolveAssignableNode(code: string, callerScope: FoeScope): Promise<{ kind: "node"; id: number } | { kind: "none" } | { kind: "unverified" }> {
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
  /** central's binding digest of that definition NOW (null ⇒ cannot be computed ⇒ the claim will be refused) */
  bindingDigest?: string | null;
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
      runs.push({ ...base, definition: def, bindingDigest: await computeBindingDigest(d, def) });
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
