/**
 * doc 81 Đợt 10 task B (design §2.6, §2.11) — central's side of the edge JOURNAL REPLAY: POST runs/:id/report (the run
 * stream `run:<runId>:<claimSeq>`) and POST locks/events (the `events` stream). Robot states (`robot_state`) use the same
 * cursor (edgeIngestCentral).
 *
 * ORDERING (mig 0373 `edge_node_report_cursors`, one cursor per (node, stream, epoch)): a record with seq = last + 1 is
 * applied, seq ≤ last is acknowledged as a duplicate, a higher first seq ⇒ 409 gap {expectedSeq} (nothing applied — the edge
 * resends from the cursor). A NEW epoch is accepted only from seq 1 (else 409 epoch_rejected) and is audited
 * (EDGE_JOURNAL_EPOCH) when the stream had another epoch. A batch is applied in ONE transaction with its cursor advance.
 *
 * RUN REPORTS — central is the only writer of run rows; the edge's records are EVIDENCE checked against central's own reading:
 *   • the run must be the caller's (else THE 404); the claim of the stream must be current (token) — or an EARLIER claim of
 *     this node (STALE: its records are still recorded as evidence — step rows, abort rows, ledger — but never change the run
 *     row or its context); a wrong token for the live claim, or a claim that never existed ⇒ 409 claim_stale;
 *   • step rows: only steps of the assigned definition; never a hitl_gate row (central writes gates — an edge can never forge
 *     an approval; every result is also stamped approvalSource "edge"), never an `abort:` row (those come as abort_stop);
 *     the engine's guards (edgeEngineSink: running never overwrites a finished row; a completed abort row is never failed);
 *   • a NON-STOP command's result (a dispatcher result recorded, or the step completed) must quote a jti central issued for
 *     (this node, run, claim, step[, attempt]) — else 409 unauthorised_actuation + EDGE_ANOMALY audit (nothing applied);
 *   • ledger records: central writes robot_jobs / command_log itself (result.edge = {nodeId, jti}), ONE per jti (a second
 *     report of the same jti ⇒ 409 replayed); a STOP needs no jti and is recorded as source edge:<node>; a device the node
 *     does not own (now) is never written (anomaly, skipped);
 *   • context patches (current claim only, run not centrally stopped): merged, server-only keys stripped.
 * EVENTS — lock events through the guarded 0374 functions only (authority edge:<node> + owner epoch + generation); command
 * acks for the node's own requests; stops / refusals / anomalies audited. A record about a device the node does not own is
 * never applied (anomaly, skipped — it never blocks the stream).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { commandLog, orchestrationRunSteps, orchestrationRuns, orchestrationWorkflowVersions, orchestrationWorkflows, robotJobs } from "../../../drizzle/schema";
import {
  EDGE_PROTOCOL_VERSION,
  edgeError,
  edgeEventsRequestSchema,
  edgeReportRequestSchema,
  parseEdgeBody,
  parseEdgeStream,
  type EdgeAnswer,
  type EdgeEventRecord,
  type EdgeRunReportRecord,
  type EdgeStreamAnswer,
} from "./edgeProtocol";
import { applyEdgeMotionLock, clearEdgeMotionLock, edgeNodeReportCursors, edgeNodeReportRecords, edgeStepAuthorizations, isEdgeControlRefusal, robotOwnership, type EdgeStepAuthorizationRow } from "./edgeControlSchema";
import { runEdgeAssignments, type RunEdgeAssignment } from "./edgeExecutionSchema";
import { hashEdgeSecret, sameDigest, type EdgeNodePrincipal } from "./edgeNodeCredentials";
import { adapterOwners, auditNode, centralDb, edgeUnavailable, isEdgeUnavailableError, nodeProtocolVersion, protocolVersionAnswer, robotOwners, runInNodeScope, runNotFound, type Db } from "./edgeCentralCommon";
import { analyseDefinition, loadMachineMap } from "./edgeRunAnalysis";
import { edgeContextPatchOf } from "./edgeContextPolicy";
import { edgeCanonicalJson } from "./edgeSigning";
import { resolveEngineSink, type EdgeStepRowWrite } from "./edgeEngineSink";
import { ackEdgeCommand, lockAckRequestsInOrder } from "./edgeNodeCommands";
import type { WorkflowDefinition, WorkflowStep } from "../orchestration/foe/workflowModel";

export class StreamAnswer extends Error {
  constructor(public readonly answer: EdgeAnswer<never>) {
    super(answer.code ?? "refused");
  }
}

type Audit = { action: string; entity: { type: string; id: number | null }; details: Record<string, unknown>; status?: "success" | "failure" };

/**
 * R-10-ag — sha256 hex of a record's canonical JSON (the content a seq stands for). R-10-as — null when the canonical encoder
 * refuses the record (forbidden key, too deep, …): there is NO fallback encoding (an order-dependent one could fake or hide a
 * conflict) — the caller refuses that record with an anomaly.
 */
export function edgeRecordHash(rec: unknown): string | null {
  let text: string;
  try {
    text = edgeCanonicalJson(rec);
  } catch {
    return null;
  }
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** What `apply` may answer for a record it accepted but did not apply (the cursor still advances — I-6). */
export type StreamRecordOutcome = void | { anomaly: string };

/**
 * Apply a stream batch under its cursor in ONE transaction. `apply` runs per NEW record (seq > cursor) in order; throwing
 * StreamAnswer refuses the whole batch (rolled back, cursor unchanged) — reserved for malformed / unauthorised input; a record
 * that is merely not applicable answers `{ anomaly }` (audited, listed in `outcomes`, the cursor advances: one record never
 * wedges the stream). R-10-ag — every applied record's content hash is stored (edge_node_report_records); a record with
 * seq ≤ cursor is a duplicate ONLY when its hash equals the stored one: different content ⇒ 409 seq_conflict + EDGE_ANOMALY
 * (both hashes), nothing written; no stored hash (accepted before 0373 r4) ⇒ duplicate + anomaly (unverifiable). `audits` are
 * written after the outcome (committed or refused) — a refusal's anomaly audit survives its rollback.
 */
export async function applyStream<R extends { seq: number }>(
  d: Db,
  node: EdgeNodePrincipal,
  stream: string,
  epoch: string,
  records: readonly R[],
  apply: (tx: Db, rec: R, audits: Audit[]) => Promise<StreamRecordOutcome>,
  /** runs once in the batch's transaction after the cursor row is locked, before any record (F-B2-4: ordered row locks) */
  prelock?: (tx: Db) => Promise<void>,
): Promise<EdgeAnswer<EdgeStreamAnswer>> {
  const audits: Audit[] = [];
  let newEpoch = false;
  try {
    const out = await d.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      const where = and(eq(edgeNodeReportCursors.edgeNodeId, node.nodeId), eq(edgeNodeReportCursors.stream, stream), eq(edgeNodeReportCursors.epoch, epoch));
      let [cur] = await tx.select({ lastSeq: edgeNodeReportCursors.lastSeq }).from(edgeNodeReportCursors).where(where).for("update").limit(1);
      if (!cur) {
        if (records[0].seq !== 1) throw new StreamAnswer(edgeError("epoch_rejected", `A new journal epoch must start at seq 1 (stream ${stream}).`, { expectedSeq: 1 }));
        await tx.insert(edgeNodeReportCursors).values({ edgeNodeId: node.nodeId, stream, epoch, lastSeq: 0 }).onConflictDoNothing();
        [cur] = await tx.select({ lastSeq: edgeNodeReportCursors.lastSeq }).from(edgeNodeReportCursors).where(where).for("update").limit(1);
        newEpoch = true;
      }
      const last = Number(cur.lastSeq);
      if (records[0].seq > last + 1) throw new StreamAnswer(edgeError("gap", `Stream ${stream}: expected seq ${last + 1}, got ${records[0].seq} — resend from the cursor.`, { expectedSeq: last + 1 }));
      if (prelock) await prelock(tx);
      let applied = 0;
      let duplicates = 0;
      let top = last;
      const outcomes: Array<{ seq: number; outcome: "anomaly"; code: string }> = [];
      const old = records.filter((r) => r.seq <= last).map((r) => r.seq);
      const stored = old.length
        ? new Map(
            (
              await tx
                .select({ seq: edgeNodeReportRecords.seq, contentHash: edgeNodeReportRecords.contentHash })
                .from(edgeNodeReportRecords)
                .where(and(eq(edgeNodeReportRecords.edgeNodeId, node.nodeId), eq(edgeNodeReportRecords.stream, stream), eq(edgeNodeReportRecords.epoch, epoch), inArray(edgeNodeReportRecords.seq, old)))
            ).map((r) => [Number(r.seq), r.contentHash] as const),
          )
        : new Map<number, string>();
      for (const rec of records) {
        const hash = edgeRecordHash(rec);
        if (hash === null) {
          // R-10-as — no canonical form ⇒ the record is REFUSED (never applied, no hash stored), recorded as an anomaly; the
          // cursor still moves past it (one record never wedges the stream)
          audits.push({ action: "EDGE_ANOMALY", entity: { type: "edge_node", id: node.nodeId }, details: { anomaly: "record_unencodable", stream, epoch, seq: rec.seq }, status: "failure" });
          if (rec.seq > last) {
            outcomes.push({ seq: rec.seq, outcome: "anomaly", code: "record_unencodable" });
            top = rec.seq;
          } else duplicates++;
          continue;
        }
        if (rec.seq <= last) {
          const was = stored.get(rec.seq);
          if (was !== undefined && was !== hash) {
            audits.push({ action: "EDGE_ANOMALY", entity: { type: "edge_node", id: node.nodeId }, details: { anomaly: "seq_conflict", stream, epoch, seq: rec.seq, storedHash: was, receivedHash: hash }, status: "failure" });
            throw new StreamAnswer(edgeError("seq_conflict", `Stream ${stream}: seq ${rec.seq} was received with DIFFERENT content — refused and recorded.`, { seq: rec.seq, storedHash: was, receivedHash: hash }));
          }
          if (was === undefined) audits.push({ action: "EDGE_ANOMALY", entity: { type: "edge_node", id: node.nodeId }, details: { anomaly: "duplicate_unverifiable", stream, epoch, seq: rec.seq }, status: "failure" });
          duplicates++;
          continue;
        }
        const o = await apply(tx, rec, audits);
        if (o && typeof o === "object" && "anomaly" in o) outcomes.push({ seq: rec.seq, outcome: "anomaly", code: o.anomaly.slice(0, 64) });
        await tx.insert(edgeNodeReportRecords).values({ edgeNodeId: node.nodeId, stream, epoch, seq: rec.seq, contentHash: hash });
        applied++;
        top = rec.seq;
      }
      if (top > last) await tx.update(edgeNodeReportCursors).set({ lastSeq: top, updatedAt: new Date() }).where(where);
      return { ackedSeq: top, applied, duplicates, ...(outcomes.length ? { outcomes } : {}) };
    });
    if (newEpoch) {
      const others = await d.select({ epoch: edgeNodeReportCursors.epoch }).from(edgeNodeReportCursors).where(and(eq(edgeNodeReportCursors.edgeNodeId, node.nodeId), eq(edgeNodeReportCursors.stream, stream)));
      if (others.some((o) => o.epoch !== epoch)) audits.push({ action: "EDGE_JOURNAL_EPOCH", entity: { type: "edge_node", id: node.nodeId }, details: { stream, epoch, previousEpochs: others.filter((o) => o.epoch !== epoch).length } });
    }
    return { http: 200, data: out };
  } catch (err) {
    if (err instanceof StreamAnswer) return err.answer;
    throw err;
  } finally {
    for (const a of audits) await auditNode(node, a.action, a.entity, a.details, a.status ?? "success");
  }
}

/** The last applied seq of (node, stream, epoch); 0 when the cursor does not exist. */
export async function cursorLastSeq(d: Db, nodeId: number, stream: string, epoch: string): Promise<number> {
  const [c] = await d
    .select({ lastSeq: edgeNodeReportCursors.lastSeq })
    .from(edgeNodeReportCursors)
    .where(and(eq(edgeNodeReportCursors.edgeNodeId, nodeId), eq(edgeNodeReportCursors.stream, stream), eq(edgeNodeReportCursors.epoch, epoch)))
    .limit(1);
  return c ? Number(c.lastSeq) : 0;
}

/** The definition the assignment was made for: the head when it still hashes to defHash, else that version's snapshot. */
export async function assignedDefinition(d: Db, a: Pick<RunEdgeAssignment, "workflowId" | "workflowVersion" | "defHash">): Promise<WorkflowDefinition | null> {
  const { hashWorkflowDefinition } = await import("../orchestration/foe/foeGateApproval");
  const [wf] = await d.select({ def: orchestrationWorkflows.definitionJson }).from(orchestrationWorkflows).where(eq(orchestrationWorkflows.id, a.workflowId)).limit(1);
  const head = wf?.def as WorkflowDefinition | undefined;
  if (head && Array.isArray(head.steps) && hashWorkflowDefinition(head) === a.defHash) return head;
  const vs = await d
    .select({ def: orchestrationWorkflowVersions.definitionJson })
    .from(orchestrationWorkflowVersions)
    .where(and(eq(orchestrationWorkflowVersions.workflowId, a.workflowId), eq(orchestrationWorkflowVersions.version, a.workflowVersion)));
  for (const v of vs) {
    const def = v.def as WorkflowDefinition | undefined;
    if (def && Array.isArray(def.steps) && hashWorkflowDefinition(def) === a.defHash) return def;
  }
  return null;
}

/** foeEngine.abortRowId (pure; the `abort:<step>` row id within 128 characters). */
export function abortRowIdOf(stepId: string): string {
  const full = `abort:${stepId}`;
  if (full.length <= 128) return full;
  const hash = createHash("sha256").update(stepId).digest("hex").slice(0, 10);
  return `abort:${stepId.slice(0, 128 - 6 - hash.length - 1)}~${hash}`;
}

function findStep(steps: WorkflowStep[] | undefined, id: string): WorkflowStep | undefined {
  for (const s of steps ?? []) {
    if (s.id === id) return s;
    const n = s as { steps?: WorkflowStep[]; then?: WorkflowStep[]; else?: WorkflowStep[] };
    const hit = findStep(n.steps, id) ?? findStep(n.then, id) ?? findStep(n.else, id) ?? (s.compensation ? findStep([s.compensation], id) : undefined);
    if (hit) return hit;
  }
  return undefined;
}

/** R-10-n / R-10-ae — THE context filter is Group C's (edge/edgeContextPolicy.ts): report endpoint and parity harness share it. */
export { EDGE_CONTEXT_ALLOWED_KEY } from "./edgeContextPolicy";

const ROBOT_JOB_STATUSES = new Set(["done", "failed", "simulated", "rejected"]);
const OT_COMMAND_STATUSES = new Set(["simulated", "acked", "failed", "timeout", "rejected", "acked_verified", "acked_unverified"]);

const boundedKey = (k: string) => (k.length <= 128 ? k : `${k.slice(0, 111)}~${createHash("sha256").update(k).digest("hex").slice(0, 16)}`);

/** The jti of a non-STOP result: issued to THIS node for this run, claim and step (and attempt when the record names one). */
async function jtiFor(tx: Db, node: EdgeNodePrincipal, runId: number, claimSeq: number, stepId: string, attempt: number, jti: string | null): Promise<EdgeStepAuthorizationRow | null> {
  if (!jti) return null;
  const [row] = (await tx.select().from(edgeStepAuthorizations).where(eq(edgeStepAuthorizations.jti, jti)).limit(1)) as EdgeStepAuthorizationRow[];
  if (!row) return null;
  if (row.edgeNodeId !== node.nodeId || row.runId !== runId || row.claimSeq !== claimSeq || row.stepId !== stepId) return null;
  if (attempt > 0 && row.attempt !== attempt) return null;
  return row;
}

function unauthorised(runId: number, stepId: string, audits: Audit[], detail: Record<string, unknown>): never {
  audits.push({ action: "EDGE_ANOMALY", entity: { type: "orchestration_run", id: runId }, details: { anomaly: "unauthorised_actuation", stepId, ...detail }, status: "failure" });
  throw new StreamAnswer(edgeError("unauthorised_actuation", `Run ${runId} step "${stepId}": a non-STOP command result without an authorisation issued for it — refused and recorded.`));
}

/** POST /edge/node/runs/:runId/report */
export async function reportForNode(node: EdgeNodePrincipal, runId: number, body: unknown): Promise<EdgeAnswer<EdgeStreamAnswer>> {
  const parsed = parseEdgeBody(edgeReportRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  const req = parsed.data;
  try {
    const d = await centralDb();
    const v = await nodeProtocolVersion(d, node.nodeId);
    if (v !== EDGE_PROTOCOL_VERSION) return protocolVersionAnswer(v);
    if (!Number.isInteger(runId) || runId <= 0) return runNotFound(runId);
    const [a] = await d.select().from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).limit(1);
    if (!a) return runNotFound(runId);
    const [run] = await d.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, runId)).limit(1);
    if (!run || !(await runInNodeScope(run, node))) return runNotFound(runId);
    const st = parseEdgeStream(req.stream);
    if (!st || st.kind !== "run" || st.runId !== runId) return edgeError("bad_request", "Invalid body — stream: must be run:<runId>:<claimSeq> of this run");
    // M-4 — proof of claim: only the CURRENT claim with its token reports; a report of an earlier / released / completed claim
    // ⇒ 409 claim_stale (the edge then turns its ledger into `actuation` evidence events — R-10-z)
    const tokenOk = a.claimTokenHash != null && sameDigest(hashEdgeSecret(req.claimToken), a.claimTokenHash);
    if (req.claimSeq !== a.claimSeq || !tokenOk) {
      const { centralStopped: stoppedNow } = await import("./edgeCoordinator");
      return edgeError("claim_stale", `Run ${runId}: this claim is no longer current — stop walking it.`, { abortRequested: stoppedNow(run) });
    }
    const def = await assignedDefinition(d, a);
    if (!def) return edgeError("definition_changed", `Run ${runId}: the assigned definition can no longer be read — reports cannot be checked.`);
    const machineMap = await loadMachineMap(d, def);
    const analysis = await analyseDefinition(d, runId, def, machineMap);
    const verifiedStopIds = new Set(analysis.verifiedStops.map((s) => s.stepId));
    const verifiedStops = new Map(analysis.verifiedStops.map((s) => [s.stepId, s] as const));
    const sink = await resolveEngineSink();
    const { centralStopped } = await import("./edgeCoordinator");
    const stopped = centralStopped(run);
    const edgeMark = (jti: string | null) => ({ nodeId: node.nodeId, claimSeq: req.claimSeq, ...(jti ? { jti } : {}) });

    return await applyStream<EdgeRunReportRecord>(d, node, req.stream, req.epoch, req.records, async (tx, rec, audits) => {
      if (rec.kind === "step") {
        const step = rec.stepId.startsWith("abort:") ? undefined : findStep(def.steps, rec.stepId);
        if (!step || step.type === "hitl_gate") {
          audits.push({ action: "EDGE_ANOMALY", entity: { type: "orchestration_run", id: runId }, details: { anomaly: step ? "gate_row_from_edge" : "unknown_step", stepId: rec.stepId, seq: rec.seq }, status: "failure" });
          return; // never written (a gate row is central's; an unknown step is not this run's)
        }
        const result = rec.result ?? undefined;
        const isCommand = step.type === "command";
        const actuated = rec.status === "completed" || typeof (result as { routedTo?: unknown } | undefined)?.routedTo === "string";
        if (isCommand && !verifiedStopIds.has(step.id) && actuated) {
          const row = await jtiFor(tx, node, runId, req.claimSeq, step.id, rec.attempt, rec.jti);
          if (!row) unauthorised(runId, step.id, audits, { seq: rec.seq, jti: rec.jti, status: rec.status });
        }
        const write: EdgeStepRowWrite = {
          stepId: step.id,
          stepType: step.type,
          status: rec.status,
          attempt: rec.attempt,
          startedAt: rec.startedAt == null ? null : new Date(rec.startedAt),
          finishedAt: rec.finishedAt == null ? null : new Date(rec.finishedAt),
          error: rec.error,
          result: result === undefined ? undefined : { ...result, approvalSource: "edge", edge: edgeMark(rec.jti) },
        };
        await sink.recordEdgeStepRows(tx, runId, [write]);
        return;
      }
      if (rec.kind === "abort_stop") {
        const step = findStep(def.steps, rec.stepId);
        if (!step || step.type !== "command" || !verifiedStopIds.has(step.id)) {
          audits.push({ action: "EDGE_ANOMALY", entity: { type: "orchestration_run", id: runId }, details: { anomaly: "unknown_stop_step", stepId: rec.stepId, seq: rec.seq }, status: "failure" });
          return;
        }
        const at = new Date(rec.at);
        await sink.recordEdgeStepRows(tx, runId, [
          {
            stepId: abortRowIdOf(step.id),
            stepType: "command",
            status: rec.status,
            attempt: 0,
            startedAt: at,
            finishedAt: at,
            error: rec.status === "failed" ? "STOP not confirmed by the edge node" : null,
            result: { ...(rec.result ?? {}), abortStop: rec.status === "completed" ? "sent" : "failed", stepId: step.id, source: `edge:${node.nodeId}`, approvalSource: "edge", edge: edgeMark(null) },
          },
        ]);
        return;
      }
      if (rec.kind === "context") {
        if (stopped) return; // centrally stopped: the run row is not the edge's to change
        const { patch, refusedKeys } = edgeContextPatchOf(rec.patch, (run.contextJson ?? {}) as Record<string, unknown>);
        if (refusedKeys.length) audits.push({ action: "EDGE_ANOMALY", entity: { type: "orchestration_run", id: runId }, details: { anomaly: "context_key_refused", keys: refusedKeys.slice(0, 20), seq: rec.seq }, status: "failure" });
        if (Object.keys(patch).length === 0) return;
        await tx
          .update(orchestrationRuns)
          .set({ contextJson: sql`COALESCE(${orchestrationRuns.contextJson}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
          .where(and(eq(orchestrationRuns.id, runId), sql`${orchestrationRuns.status} IN ('running', 'compensating')`));
        return;
      }
      // ledger
      await applyLedger(tx, node, runId, req.claimSeq, run.startedBy ?? null, rec, audits, edgeMark, verifiedStops);
    });
  } catch (err) {
    if (err instanceof StreamAnswer) return err.answer;
    if (!isEdgeUnavailableError(err)) console.error(`[EdgeReports] report of run ${runId} by node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailable;
  }
}

async function applyLedger(
  tx: Db,
  node: EdgeNodePrincipal,
  runId: number,
  claimSeq: number,
  runOwner: number | null,
  rec: Extract<EdgeRunReportRecord, { kind: "ledger" }>,
  audits: Audit[],
  edgeMark: (jti: string | null) => Record<string, unknown>,
  verifiedStops: ReadonlyMap<string, { kind: "robot"; robotId: number } | { kind: "ot"; adapterId: number }>,
): Promise<void> {
  const robot = "robotId" in rec.target ? rec.target : null;
  const ot = "adapterId" in rec.target ? rec.target : null;
  const { isStopCommandType } = await import("../ot/commandDispatcher");
  const { isStopJobType } = await import("../robot/stopJob");
  const isStop = rec.stop === true && (robot ? isStopJobType(robot.jobType) : isStopCommandType(ot!.commandType));
  const owner = robot ? (await robotOwners(tx, [robot.robotId])).get(robot.robotId) : (await adapterOwners(tx, [ot!.adapterId])).get(ot!.adapterId);
  if (!owner || owner.edgeNodeId !== node.nodeId) {
    audits.push({ action: "EDGE_ANOMALY", entity: { type: "orchestration_run", id: runId }, details: { anomaly: "ledger_not_owned", seq: rec.seq, target: rec.target }, status: "failure" });
    return;
  }
  if (isStop) {
    // a STOP record carries no jti: accepted only for a VERIFIED STOP step of the assigned snapshot, on the device that step
    // names, under the device's CURRENT owner epoch — anything else is an anomaly and is not written
    const vs = verifiedStops.get(rec.stepId);
    const targetOk = !!vs && (robot ? vs.kind === "robot" && vs.robotId === robot.robotId : vs.kind === "ot" && vs.adapterId === ot!.adapterId);
    const epoch = (rec as { ownerEpoch?: unknown }).ownerEpoch;
    if (!targetOk || typeof epoch !== "number" || epoch !== owner.ownerEpoch) {
      audits.push({ action: "EDGE_ANOMALY", entity: { type: "orchestration_run", id: runId }, details: { anomaly: "stop_ledger_refused", seq: rec.seq, stepId: rec.stepId, target: rec.target, ownerEpoch: epoch ?? null, verifiedStep: !!vs, targetOk }, status: "failure" });
      return;
    }
  }
  let auth: EdgeStepAuthorizationRow | null = null;
  if (!isStop) {
    auth = await jtiFor(tx, node, runId, claimSeq, rec.stepId, rec.attempt, rec.jti);
    const t = ((auth?.verdictJson ?? {}) as { target?: { robotId?: unknown; adapterId?: unknown } }).target;
    const sameTarget = !!auth && (robot ? auth.kind === "robot" && t?.robotId === robot.robotId : auth.kind === "ot" && t?.adapterId === ot!.adapterId);
    if (!auth || !sameTarget) unauthorised(runId, rec.stepId, audits, { seq: rec.seq, jti: rec.jti, ledger: true });
    if (auth.resultReportedAt != null) {
      audits.push({ action: "EDGE_ANOMALY", entity: { type: "orchestration_run", id: runId }, details: { anomaly: "jti_result_replayed", jti: auth.jti, seq: rec.seq }, status: "failure" });
      throw new StreamAnswer(edgeError("replayed", `Authorisation ${auth.jti} already has its result — refused.`));
    }
  }
  const approval = (auth?.approvalJson ?? null) as { approvedBy?: number } | null;
  const at = new Date(rec.at);
  const key = boundedKey(auth ? `edge:${auth.jti}` : `edge-stop:${node.nodeId}:${rec.idempotencyKey}:${rec.seq}`);
  const result = { ...(rec.result ?? {}), edge: { ...edgeMark(auth?.jti ?? null), stop: isStop, reportedStatus: rec.status } };
  if (robot) {
    const status = ROBOT_JOB_STATUSES.has(rec.status) ? rec.status : "failed";
    await tx
      .insert(robotJobs)
      .values({
        robotId: robot.robotId,
        jobType: (isStop ? "abort" : robot.jobType) as never,
        params: null,
        status: status as never,
        triggerKind: "hitl",
        actionId: auth ? `foe-${rec.idempotencyKey}`.slice(0, 64) : null,
        requestedBy: runOwner,
        confirmedBy: approval?.approvedBy ?? null,
        idempotencyKey: key,
        result,
        errorText: status === "failed" && rec.status !== "failed" ? `edge reported status "${rec.status}"` : null,
        startedAt: at,
        completedAt: at,
      })
      .onConflictDoNothing();
  } else {
    const status = OT_COMMAND_STATUSES.has(rec.status) ? rec.status : "failed";
    await tx
      .insert(commandLog)
      .values({
        actionId: auth ? `foe-${rec.idempotencyKey}`.slice(0, 64) : null,
        adapterId: ot!.adapterId,
        commandType: ot!.commandType,
        requestedValue: (rec.result as { writes?: unknown } | null)?.writes ?? null,
        requestedBy: runOwner ?? 0,
        confirmedBy: approval?.approvedBy ?? runOwner ?? 0,
        status: status as never,
        triggerKind: "hitl",
        approvedBy: approval?.approvedBy ?? null,
        ackValue: result,
        errorText: status === "failed" && rec.status !== "failed" ? `edge reported status "${rec.status}"` : null,
        idempotencyKey: key,
        sentAt: at,
        ackedAt: at,
      })
      .onConflictDoNothing();
  }
  if (auth) {
    await tx
      .update(edgeStepAuthorizations)
      .set({ resultReportedAt: new Date(), resultStatus: String(rec.status).slice(0, 32) })
      .where(and(eq(edgeStepAuthorizations.jti, auth.jti), sql`${edgeStepAuthorizations.resultReportedAt} IS NULL`));
  }
}

/**
 * B fix review 4 (R-10-bn, F1-4) — a STOP the edge re-sent from a signed sweep picture. Accepted only when it matches what
 * central signs as that picture NOW: the run is this node's assignment and centrally stopped (aborted), the step is a VERIFIED
 * STOP of the assigned definition with exactly that target (R-10-o), the device is this node's at the reported owner epoch,
 * and the picture's issuedAt is not before the abort nor in the future. Then: the step's STOP ledger row (robot_jobs abort /
 * command_log of the step's command; one confirmed row per (node, run, step) — re-sends add none; a failed one is its own row), and `completed` /
 * `simulated` confirm abort:<step> (the pull stops listing the run, the edge stops re-sending). `failed` writes the ledger row
 * only (abort:<step> stays failed; the edge keeps re-sending inside the window). Anything else ⇒ anomaly, nothing written.
 */
async function applySweepStop(tx: Db, node: EdgeNodePrincipal, rec: Extract<EdgeEventRecord, { kind: "sweep_stop" }>, audits: Audit[]): Promise<StreamRecordOutcome> {
  const refuse = (why: string, extra: Record<string, unknown> = {}): StreamRecordOutcome => {
    audits.push({ action: "EDGE_ANOMALY", entity: { type: "edge_node", id: node.nodeId }, details: { anomaly: "sweep_stop_refused", why, runId: rec.runId, stepId: rec.stepId, target: rec.target, ownerEpoch: rec.ownerEpoch, seq: rec.seq, ...extra }, status: "failure" });
    return { anomaly: "sweep_stop_refused" };
  };
  const [a] = await tx.select().from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, rec.runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).limit(1);
  if (!a) return refuse("not_assigned");
  const [run] = await tx.select().from(orchestrationRuns).where(eq(orchestrationRuns.id, rec.runId)).limit(1);
  if (!run || run.status !== "aborted") return refuse("run_not_aborted");
  const abortedAt = run.finishedAt ? new Date(run.finishedAt).getTime() : null;
  if (rec.pictureIssuedAt > Date.now() + 60_000 || (abortedAt !== null && rec.pictureIssuedAt + 60_000 < abortedAt)) return refuse("picture_time", { abortedAt });
  const def = await assignedDefinition(tx, a);
  if (!def) return refuse("definition_unreadable");
  const analysis = await analyseDefinition(tx, rec.runId, def, await loadMachineMap(tx, def));
  const vs = analysis.verifiedStops.find((s) => s.stepId === rec.stepId);
  const robotId = "robotId" in rec.target ? rec.target.robotId : null;
  const adapterId = "adapterId" in rec.target ? rec.target.adapterId : null;
  if (!vs || (vs.kind === "robot" ? vs.robotId !== robotId : vs.adapterId !== adapterId)) return refuse("not_the_pictures_stop", { verifiedStep: !!vs });
  const owner = robotId !== null ? (await robotOwners(tx, [robotId])).get(robotId) : (await adapterOwners(tx, [adapterId as number])).get(adapterId as number);
  if (!owner || owner.edgeNodeId !== node.nodeId || owner.ownerEpoch !== rec.ownerEpoch) return refuse("not_owned_at_epoch", { currentEpoch: owner?.ownerEpoch ?? null });
  const step = findStep(def.steps, rec.stepId);
  const at = new Date(rec.at);
  // one confirmed row per (node, run, step); a FAILED re-send is evidence of its own (keyed by its seq)
  const key = boundedKey(`edge-sweep-stop:${node.nodeId}:${rec.runId}:${rec.stepId}${rec.status === "failed" ? `:failed:${rec.seq}` : ""}`);
  const result = { edge: { nodeId: node.nodeId, sweep: true, stop: true, pictureIssuedAt: rec.pictureIssuedAt, reportedStatus: rec.status, ownerEpoch: rec.ownerEpoch, runId: rec.runId, stepId: rec.stepId } };
  if (robotId !== null) {
    const status = rec.status === "completed" ? "done" : rec.status;
    await tx
      .insert(robotJobs)
      .values({ robotId, jobType: "abort" as never, params: null, status: status as never, triggerKind: "hitl", actionId: null, requestedBy: run.startedBy ?? null, confirmedBy: null, idempotencyKey: key, result, errorText: status === "failed" ? "edge reported the re-sent STOP failed" : null, startedAt: at, completedAt: at })
      .onConflictDoNothing();
  } else {
    const status = rec.status === "completed" ? "acked" : rec.status;
    const commandType = String((step as { command?: unknown } | undefined)?.command ?? "stop").slice(0, 64);
    await tx
      .insert(commandLog)
      .values({ actionId: null, adapterId: adapterId as number, commandType, requestedValue: (vs as { pins?: unknown }).pins ?? null, requestedBy: run.startedBy ?? 0, confirmedBy: run.startedBy ?? 0, status: status as never, triggerKind: "hitl", approvedBy: null, ackValue: result, errorText: status === "failed" ? "edge reported the re-sent STOP failed" : null, idempotencyKey: key, sentAt: at, ackedAt: at })
      .onConflictDoNothing();
  }
  if (rec.status !== "failed") {
    const sink = await resolveEngineSink();
    const [row] = await tx.select({ status: orchestrationRunSteps.status }).from(orchestrationRunSteps).where(and(eq(orchestrationRunSteps.runId, rec.runId), eq(orchestrationRunSteps.stepId, abortRowIdOf(rec.stepId)))).limit(1);
    if (row?.status !== "completed") {
      await sink.recordEdgeStepRows(tx, rec.runId, [
        {
          stepId: abortRowIdOf(rec.stepId),
          stepType: "command",
          status: "completed",
          attempt: 0,
          startedAt: at,
          finishedAt: at,
          error: null,
          result: { abortStop: rec.status === "simulated" ? "simulated" : "sent", stepId: rec.stepId, source: `edge:${node.nodeId}`, via: "sweep_picture", pictureIssuedAt: rec.pictureIssuedAt, approvalSource: "edge", edge: { nodeId: node.nodeId, sweep: true } },
        },
      ]);
    }
  }
  audits.push({ action: "EDGE_STOP_SENT", entity: { type: "orchestration_run", id: rec.runId }, details: { source: "sweep_picture", stepId: rec.stepId, target: rec.target, status: rec.status, ownerEpoch: rec.ownerEpoch, at: rec.at } });
}

/** POST /edge/node/locks/events (the `events` stream). */
export async function eventsForNode(node: EdgeNodePrincipal, body: unknown): Promise<EdgeAnswer<EdgeStreamAnswer>> {
  const parsed = parseEdgeBody(edgeEventsRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  const req = parsed.data;
  try {
    const d = await centralDb();
    const v = await nodeProtocolVersion(d, node.nodeId);
    if (v !== EDGE_PROTOCOL_VERSION) return protocolVersionAnswer(v);
    return await applyStream<EdgeEventRecord>(d, node, req.stream, req.epoch, req.records, async (tx, rec, audits) => {
      const anomaly = (what: string, extra: Record<string, unknown>): { anomaly: string } => {
        audits.push({ action: "EDGE_ANOMALY", entity: { type: "edge_node", id: node.nodeId }, details: { anomaly: what, seq: rec.seq, ...extra }, status: "failure" });
        return { anomaly: what };
      };
      // M-5 — a run id an edge names is audited against the RUN only when it is this node's (its assignment); else against the node
      const runEntity = async (runId: number | null): Promise<{ type: string; id: number | null }> => {
        if (runId == null) return { type: "edge_node", id: node.nodeId };
        const [mine] = await tx.select({ runId: runEdgeAssignments.runId }).from(runEdgeAssignments).where(and(eq(runEdgeAssignments.runId, runId), eq(runEdgeAssignments.edgeNodeId, node.nodeId))).limit(1);
        return mine ? { type: "orchestration_run", id: runId } : { type: "edge_node", id: node.nodeId };
      };
      if (rec.kind === "lock") {
        const [o] = await tx.select({ n: robotOwnership.edgeNodeId, e: robotOwnership.ownerEpoch }).from(robotOwnership).where(eq(robotOwnership.id, rec.robotId)).limit(1);
        if (!o || o.n !== node.nodeId || Number(o.e) !== rec.ownerEpoch) return anomaly("lock_event_not_owned", { robotId: rec.robotId, ownerEpoch: rec.ownerEpoch });
        try {
          await tx.transaction(async (sp) => {
            if (rec.event === "locked") {
              const ok = await applyEdgeMotionLock(sp as never, { robotId: rec.robotId, nodeId: node.nodeId, ownerEpoch: rec.ownerEpoch, generation: rec.generation, reasonCode: rec.reasonCode, detail: `edge ${node.nodeCode} since ${new Date(rec.since).toISOString()}` });
              if (!ok) void anomaly("lock_event_superseded", { robotId: rec.robotId, generation: rec.generation });
            } else {
              const n = await clearEdgeMotionLock(sp as never, { robotId: rec.robotId, nodeId: node.nodeId, ownerEpoch: rec.ownerEpoch, generation: rec.generation });
              if (n === 0) void anomaly("lock_clear_matched_nothing", { robotId: rec.robotId, generation: rec.generation });
            }
          });
        } catch (err) {
          if (!isEdgeControlRefusal(err)) throw err;
          void anomaly("lock_event_refused", { robotId: rec.robotId, ownerEpoch: rec.ownerEpoch });
        }
        audits.push({ action: rec.event === "locked" ? "EDGE_MOTION_LOCKED" : "EDGE_MOTION_LOCK_CLEARED", entity: { type: "robot", id: rec.robotId }, details: { generation: rec.generation, reasonCode: rec.reasonCode, clearedBy: rec.clearedBy, requestId: rec.requestId } });
        return;
      }
      if (rec.kind === "stop") {
        const owned =
          "robotId" in rec.target ? (await robotOwners(tx, [rec.target.robotId])).get(rec.target.robotId)?.edgeNodeId === node.nodeId : (await adapterOwners(tx, [rec.target.adapterId])).get(rec.target.adapterId)?.edgeNodeId === node.nodeId;
        if (!owned) return anomaly("stop_event_not_owned", { target: rec.target });
        audits.push({ action: "EDGE_STOP_SENT", entity: "robotId" in rec.target ? { type: "robot", id: rec.target.robotId } : { type: "device_adapter", id: rec.target.adapterId }, details: { source: rec.source, outcome: rec.outcome, requestId: rec.requestId, at: rec.at, detail: rec.detail } });
        return;
      }
      if (rec.kind === "sweep_stop") return applySweepStop(tx, node, rec, audits);
      if (rec.kind === "refusal") {
        audits.push({ action: "EDGE_LOCAL_REFUSAL", entity: await runEntity(rec.runId), details: { runId: rec.runId, stepId: rec.stepId, reason: rec.reason, at: rec.at } });
        return;
      }
      if (rec.kind === "anomaly") {
        audits.push({ action: "EDGE_ANOMALY", entity: await runEntity(rec.runId), details: { anomaly: rec.code, reportedByEdge: true, runId: rec.runId, detail: rec.detail, at: rec.at }, status: "failure" });
        return;
      }
      if ((rec as { kind: string }).kind === "actuation") {
        // R-10-z — a ledger record of a run stream that lost its claim: EVIDENCE only (never run state), owned devices only
        const x = rec as unknown as { runId: number; claimSeq: number; stepId: string; attempt: number; jti: string | null; stop: boolean; target: { robotId?: number; adapterId?: number; jobType?: string; commandType?: string }; ownerEpoch?: number; outcome: string; at: number };
        const own = typeof x.target.robotId === "number" ? (await robotOwners(tx, [x.target.robotId])).get(x.target.robotId) : (await adapterOwners(tx, [x.target.adapterId as number])).get(x.target.adapterId as number);
        if (!own || own.edgeNodeId !== node.nodeId) return anomaly("actuation_not_owned", { target: x.target, runId: x.runId, stepId: x.stepId });
        const [auth] = x.jti ? await tx.select({ node: edgeStepAuthorizations.edgeNodeId, runId: edgeStepAuthorizations.runId, stepId: edgeStepAuthorizations.stepId }).from(edgeStepAuthorizations).where(eq(edgeStepAuthorizations.jti, x.jti)).limit(1) : [];
        audits.push({
          action: "EDGE_ACTUATION_WITHOUT_CLAIM",
          entity: await runEntity(x.runId),
          details: { runId: x.runId, claimSeq: x.claimSeq, stepId: x.stepId, attempt: x.attempt, jti: x.jti, jtiIssuedToThisNode: !!auth && auth.node === node.nodeId && auth.runId === x.runId && auth.stepId === x.stepId, stop: x.stop, target: x.target, ownerEpoch: x.ownerEpoch ?? null, ownerEpochCurrent: x.ownerEpoch === own.ownerEpoch, outcome: x.outcome, at: x.at },
        });
        return;
      }
      // command_ack
      const a = rec as unknown as Extract<EdgeEventRecord, { kind: "command_ack" }> & { target?: { robotId?: number; adapterId?: number }; ownerEpoch?: number; unsigned?: boolean };
      if (!(await ackEdgeCommand(tx, node.nodeId, { requestId: a.requestId, outcome: a.outcome, generation: a.generation, at: a.at, target: a.target ?? null, ownerEpoch: a.ownerEpoch ?? null, unsigned: a.unsigned === true }))) {
        // R-10-o / I-6 — refused: the request stays PENDING in the DB (re-delivered); the attempt is an anomaly; A's
        // edge_stop_ack_refusals row for a STOP is written in THIS batch's transaction (N-5 — a batch rolled back takes it with
        // it; its cursor did not move, the edge re-sends and it is written then); the stream moves on
        // R-10-au — `notOwnedHere` is never terminal: the STOP stays pending (re-delivered while this node's; D carries it to
        // the current owner / central) — its own anomaly code so an operator tells it from a refused ack
        return anomaly(a.outcome === "notOwnedHere" ? "ack_not_owned_here" : "command_ack_refused", { requestId: a.requestId, outcome: a.outcome, target: a.target ?? null, ownerEpoch: a.ownerEpoch ?? null, unsigned: a.unsigned === true });
      }
    }, (tx) =>
      // F-B2-4 — every request this batch acks, locked first in ascending id order (then each ack re-takes its own lock)
      lockAckRequestsInOrder(tx, req.records.filter((r) => r.kind === "command_ack").map((r) => (r as { requestId: number }).requestId)),
    );
  } catch (err) {
    if (err instanceof StreamAnswer) return err.answer;
    if (!isEdgeUnavailableError(err)) console.error(`[EdgeReports] events of node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailable;
  }
}
