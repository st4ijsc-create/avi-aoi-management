/**
 * doc 81 Đợt 10 task B (design §2.8 / §2.11; rulings R-10-k, R-10-o, R-10-p) — the CENTRAL → EDGE command queue: console
 * STOP / lock / clear of an EDGE-OWNED device become `robot_motion_lock_requests` rows (mig 0374, bound to the device's owner
 * + owner epoch), delivered to the owning node on its pull and progress answers, acknowledged through its `events` stream.
 *
 *   • enqueueEdgeDeviceRequest — Group D's robotRouter calls it for an edge-owned robot (clear / lock / stop) or adapter (stop).
 *     A STOP is never a silent no-op (R-10-k): a stale owner is re-read and the STOP re-queued for the CURRENT owner (bounded
 *     retries); a device that is central's now ⇒ EdgeRequestError{code notEdgeOwned, fallback.centralStop: true}; any other
 *     failure of a STOP ⇒ the error carries fallback.centralStop: true too — the caller sends a central STOP when it has a
 *     session, and alerts when it has none.
 *   • commandsForNode — THIS node's requests only (WHERE edgeNodeId = node, re-checked per row): every unacked STOP head
 *     (carriedToId NULL) regardless of expiry or epoch, FIRST (L-7: expiry only makes a STOP overdue); lock / clear only while
 *     unexpired and at the device's current (owner, epoch). With central's signer: all signed (typ cmd). WITHOUT it: the STOPs
 *     only, as the explicit UNSIGNED envelope `cmd-stop-unsigned` (edgeUnsignedStopSchema) over the authenticated node channel;
 *     a lock / clear is never sent unsigned.
 *   • ackEdgeCommand — R-10-o: accepted only for a row of THIS node whose target and owner epoch equal the ack's, and an
 *     `unsigned` ack only for a STOP (in the UPDATE's own WHERE); anything else ⇒ refused, the request stays pending.
 *   • lockRequestOutstanding — the /authorize gate `lock_requested`.
 *   • expireEdgeRequests — the sweeper: lock / clear only (a STOP is NEVER expired — the query excludes kind 'stop'); overdue
 *     STOPs are reported at error level instead.
 */
import { and, asc, desc, eq, gt, isNull, lte, ne, or, sql } from "drizzle-orm";
import { EDGE_PULL_COMMANDS_MAX, EDGE_UNSIGNED_STOP_TYP, edgeCommandSchema, edgeUnsignedStopSchema, type EdgeUnsignedStop } from "./edgeProtocol";
import { ackEdgeStop, robotMotionLockRequests, robotOwnership, adapterOwnership, isEdgeControlRefusal, lockStopRequestDevices, type RobotMotionLockRequestRow } from "./edgeControlSchema";
import { auditNode, centralDb, centralSigner, signForNode, type Db } from "./edgeCentralCommon";
import { STOP_DB_STEP_DEADLINE_MS } from "../robot/stopJob";
import type { EdgeNodePrincipal } from "./edgeNodeCredentials";
import type { EdgeSignedEnvelope } from "./edgeSigning";

export type EdgeRequestKind = "lock" | "clear" | "stop";

// R-10-p / M-8 — the ONE unsigned-STOP envelope is edgeProtocol's (`cmd-stop-unsigned`); re-exported for callers of this module.
export { EDGE_UNSIGNED_STOP_TYP, edgeUnsignedStopSchema, type EdgeUnsignedStop };

/** F2 — a STOP enqueue never waits longer than the STOP DB-step bound (robot/stopJob STOP_DB_STEP_DEADLINE_MS) per attempt. */
export const STOP_ENQUEUE_BOUND_MS = STOP_DB_STEP_DEADLINE_MS;

/** Default validity of a request: a clear (raises energy) is short-lived; a lock / stop stays deliverable longer. */
export function edgeRequestTtlMs(kind: EdgeRequestKind): number {
  const env = kind === "clear" ? process.env.EDGE_CLEAR_REQUEST_TTL_MS : process.env.EDGE_LOCK_REQUEST_TTL_MS;
  const def = kind === "clear" ? 60_000 : 600_000;
  const n = parseInt(env || String(def), 10);
  return Number.isFinite(n) ? Math.min(86_400_000, Math.max(5_000, n)) : def;
}

// ── doc 81 Đợt 10 final fix wave (I-3, R-10-br) — is the owning node reachable for a STOP, as central sees it? ──────────
/** Pulls (v2) seen by THIS process, per node (ms). The precise evidence: commands travel on the pull. */
const lastPullAt = new Map<number, number>();
/** Pull evidence older than this is forgotten (the node then counts by its heartbeat only). */
const PULL_EVIDENCE_KEEP_MS = 10 * 60_000;
export function noteEdgeNodePull(nodeId: number, at: number = Date.now()): void {
  if (!Number.isSafeInteger(nodeId) || nodeId <= 0) return;
  lastPullAt.set(nodeId, at);
  if (lastPullAt.size > 5_000) for (const [k, t] of lastPullAt) if (at - t > PULL_EVIDENCE_KEEP_MS) lastPullAt.delete(k);
}
/** Tests only. */
export function __resetEdgeNodePullsForTests(): void {
  lastPullAt.clear();
}
const envInt = (name: string, def: number, min: number, max: number): number => {
  const n = parseInt(process.env[name] || String(def), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
/** The pull interval central tells its nodes (edgeConfigCentral limits.pullMs, EDGE_PULL_MS — same bounds). */
export function edgeNodePullMs(): number {
  return envInt("EDGE_PULL_MS", 2_000, 500, 60_000);
}
/** The heartbeat interval central tells its nodes (limits.heartbeatMs, EDGE_HEARTBEAT_MS — same bounds). */
function edgeNodeHeartbeatMs(): number {
  return envInt("EDGE_HEARTBEAT_MS", 10_000, 1_000, 600_000);
}
/**
 * The bound within which a queued STOP must be acknowledged by its node: 3 pull intervals + the round trip / shipping slack
 * (EDGE_STOP_ACK_SLACK_MS, default 2 s). Past it ⇒ a DURABLE critical alert (alertUndeliveredStops), once per request.
 */
export function edgeStopAckDeadlineMs(): number {
  return 3 * edgeNodePullMs() + envInt("EDGE_STOP_ACK_SLACK_MS", 2_000, 0, 60_000);
}
export interface EdgeNodeReach {
  reachable: boolean;
  /** pull: a pull seen by THIS process; heartbeat: the node's DB heartbeat; none: never seen; unreadable: the read failed */
  basis: "pull" | "heartbeat" | "none" | "unreadable";
  ageMs: number | null;
}
/**
 * Reachable ⇔ the node pulled THIS process within 3 × pullMs; with no pull evidence here (another replica serves it, or this
 * process just started) ⇔ its heartbeat is younger than max(3 × pullMs, 2 × heartbeatMs). Unreadable ⇒ NOT reachable (the
 * caller then treats the STOP as possibly undelivered: warning + central fallback + alert — never a false "accepted").
 */
export async function edgeNodeReachability(nodeId: number, now: number = Date.now()): Promise<EdgeNodeReach> {
  const pulled = lastPullAt.get(nodeId);
  if (pulled !== undefined && now - pulled <= PULL_EVIDENCE_KEEP_MS) {
    const ageMs = Math.max(0, now - pulled);
    return { reachable: ageMs <= 3 * edgeNodePullMs(), basis: "pull", ageMs };
  }
  try {
    const d = await centralDb();
    const { edgeNodes } = await import("../../../drizzle/schema");
    // drizzle's own timestamp mapping (the app writes this naive column through drizzle, in UTC — never a raw read)
    const [row] = await d.select({ at: edgeNodes.lastHeartbeatAt }).from(edgeNodes).where(eq(edgeNodes.id, nodeId)).limit(1);
    const at = row?.at;
    const t = at == null ? NaN : new Date(at).getTime();
    if (!Number.isFinite(t)) return { reachable: false, basis: "none", ageMs: null };
    const ageMs = Math.max(0, now - t);
    return { reachable: ageMs <= Math.max(3 * edgeNodePullMs(), 2 * edgeNodeHeartbeatMs()), basis: "heartbeat", ageMs };
  } catch {
    return { reachable: false, basis: "unreadable", ageMs: null };
  }
}

/** What a caller must do when a STOP could not be queued for an edge (R-10-k): send it centrally, never drop it. */
export interface EdgeStopFallback {
  /** true for every failed STOP: the caller sends a central STOP now (when it has a session) and alerts otherwise */
  centralStop: true;
  /** the device's owner as read last (null owner = central); null when it could not be read */
  currentOwner: { edgeNodeId: number | null; ownerEpoch: number } | null;
}

export class EdgeRequestError extends Error {
  constructor(
    public readonly code: "notEdgeOwned" | "invalid" | "stale" | "unavailable",
    message: string,
    /** set for a kind-stop request — see EdgeStopFallback */
    public readonly fallback?: EdgeStopFallback,
  ) {
    super(message);
    this.name = "EdgeRequestError";
  }
}

async function ownerOf(d: Db, robot: number | null, adapter: number | null, opts: { share?: boolean } = {}): Promise<{ edgeNodeId: number | null; ownerEpoch: number } | null> {
  // `share` (a STOP enqueue): the device row is read FOR SHARE in the enqueue transaction — the owner read and the insert see
  // ONE ownership, and a concurrent owner change makes the STOP wait at most lock_timeout (F2), never forever
  const rq = d.select({ edgeNodeId: robotOwnership.edgeNodeId, ownerEpoch: robotOwnership.ownerEpoch }).from(robotOwnership).where(eq(robotOwnership.id, robot as number)).limit(1);
  const aq = d.select({ edgeNodeId: adapterOwnership.edgeNodeId, ownerEpoch: adapterOwnership.ownerEpoch }).from(adapterOwnership).where(eq(adapterOwnership.id, adapter as number)).limit(1);
  const [o] = robot !== null ? await (opts.share ? rq.for("share") : rq) : await (opts.share ? aq.for("share") : aq);
  return o ? { edgeNodeId: o.edgeNodeId ?? null, ownerEpoch: Number(o.ownerEpoch) } : null;
}

/**
 * Queue a request for the node that OWNS the device now. robot: lock / clear (expectedGeneration) / stop; adapter: stop only.
 * Throws EdgeRequestError (notEdgeOwned: central's / missing device; stale: the owner kept changing; unavailable: DB / 0374;
 * invalid). For a STOP: the stale case is retried against the fresh owner first, and every error carries `fallback`.
 */
export async function enqueueEdgeDeviceRequest(input: {
  kind: EdgeRequestKind;
  robotId?: number;
  adapterId?: number;
  expectedGeneration?: number;
  reason: string;
  requestedBy: number;
  ttlMs?: number;
}): Promise<{ requestId: number; edgeNodeId: number; ownerEpoch: number }> {
  const stop = input.kind === "stop";
  let lastOwner: EdgeStopFallback["currentOwner"] = null;
  const fail = (code: EdgeRequestError["code"], message: string) => new EdgeRequestError(code, message, stop ? { centralStop: true, currentOwner: lastOwner } : undefined);
  const robot = Number.isSafeInteger(input.robotId) && (input.robotId as number) > 0 ? (input.robotId as number) : null;
  const adapter = Number.isSafeInteger(input.adapterId) && (input.adapterId as number) > 0 ? (input.adapterId as number) : null;
  if ((robot === null) === (adapter === null)) throw fail("invalid", "exactly one of robotId / adapterId is required");
  if (adapter !== null && !stop) throw fail("invalid", "an adapter request can only be a stop");
  if (input.kind === "clear" && !(Number.isSafeInteger(input.expectedGeneration) && (input.expectedGeneration as number) >= 1)) {
    throw fail("invalid", "a clear needs the expected lock generation");
  }
  if (!(Number.isSafeInteger(input.requestedBy) && input.requestedBy > 0)) throw fail("invalid", "requestedBy must be a user");
  // I-7 — the edge runtime is off: no node can pull anything (every node route answers 503) ⇒ nothing is queued; a STOP gets
  // the central fallback (never a silent success)
  const { edgeRuntimeEnabled } = await import("./edgeCoordinator");
  if (!edgeRuntimeEnabled()) throw fail("unavailable", "the edge runtime is disabled (EDGE_RUNTIME_ENABLED) — no edge node can receive the request");
  let d: Db;
  try {
    d = await centralDb();
  } catch {
    throw fail("unavailable", "database unavailable");
  }
  const attempts = stop ? 3 : 1;
  const ttl = input.ttlMs ?? edgeRequestTtlMs(input.kind);
  const insertRequest = (x: Db, owner: { edgeNodeId: number; ownerEpoch: number }) =>
    x
      .insert(robotMotionLockRequests)
      .values({
        robotId: robot,
        adapterId: adapter,
        edgeNodeId: owner.edgeNodeId,
        ownerEpoch: owner.ownerEpoch,
        kind: input.kind,
        expectedGeneration: input.kind === "clear" ? (input.expectedGeneration as number) : null,
        reason: String(input.reason ?? "").slice(0, 300),
        requestedBy: input.requestedBy,
        expiresAt: new Date(Date.now() + Math.max(5_000, ttl)),
      })
      .returning({ id: robotMotionLockRequests.id });
  const one = async (x: Db) => {
    const owner = await ownerOf(x, robot, adapter, { share: stop });
    lastOwner = owner;
    if (!owner || owner.edgeNodeId == null) throw fail("notEdgeOwned", "the device is not owned by an edge node");
    const [row] = await insertRequest(x, owner as { edgeNodeId: number; ownerEpoch: number });
    return { requestId: row.id, edgeNodeId: owner.edgeNodeId, ownerEpoch: owner.ownerEpoch };
  };
  const { withDeadline } = await import("../ot/drivers/boundedClose");
  for (let i = 0; i < attempts; i++) {
    try {
      if (!stop) return await one(d);
      // F2 — a STOP: lock_timeout + statement_timeout = the STOP DB bound inside the transaction, and the attempt bounded as a
      // whole (connection wait included); a timeout ⇒ the central fallback, never a hang
      return await withDeadline(
        d.transaction(async (tx) => {
          await tx.execute(sql`SELECT set_config('lock_timeout', ${`${STOP_ENQUEUE_BOUND_MS}ms`}, true), set_config('statement_timeout', ${`${STOP_ENQUEUE_BOUND_MS}ms`}, true)`);
          return one(tx as unknown as Db);
        }),
        STOP_ENQUEUE_BOUND_MS * 2,
        "edge STOP enqueue",
      );
    } catch (err) {
      if (err instanceof EdgeRequestError) throw err;
      if (isEdgeControlRefusal(err)) {
        if (i + 1 < attempts) continue; // a STOP: the owner changed between the read and the insert — re-read, re-queue
        throw fail("stale", "the device's owner changed — retry");
      }
      throw fail("unavailable", stop ? "the STOP could not be queued within the STOP bound (lock / statement timeout or DB)" : "the request could not be queued (database or migration 0374)");
    }
  }
  throw fail("stale", "the device's owner kept changing");
}

/** The signed command of one request row (null for a row that cannot be expressed — never delivered). */
export function commandPayloadOf(r: RobotMotionLockRequestRow): Record<string, unknown> | null {
  const base = { requestId: r.id, nodeId: r.edgeNodeId, ownerEpoch: Number(r.ownerEpoch), issuedAt: new Date(r.createdAt).getTime(), expiresAt: new Date(r.expiresAt).getTime() };
  if (r.kind === "stop") return { ...base, kind: "stop", target: r.robotId != null ? { robotId: r.robotId } : { adapterId: r.adapterId } };
  if (r.robotId == null) return null;
  if (r.kind === "lock") return { ...base, kind: "lock", robotId: r.robotId, reason: String(r.reason ?? "").slice(0, 300) };
  if (r.kind === "clear" && r.expectedGeneration != null) {
    return { ...base, kind: "clear", robotId: r.robotId, expectedGeneration: r.expectedGeneration, clearedBy: r.requestedBy, reason: String(r.reason ?? "").slice(0, 300) };
  }
  return null;
}

/** The unsigned STOP of a row (kind stop only; null otherwise). */
export function unsignedStopOf(r: RobotMotionLockRequestRow, node: Pick<EdgeNodePrincipal, "nodeId" | "credentialId">): EdgeUnsignedStop | null {
  if (r.kind !== "stop" || r.edgeNodeId !== node.nodeId) return null;
  const p = edgeUnsignedStopSchema.safeParse({
    typ: EDGE_UNSIGNED_STOP_TYP,
    requestId: r.id,
    nodeId: r.edgeNodeId,
    credentialId: node.credentialId,
    ownerEpoch: Number(r.ownerEpoch),
    target: r.robotId != null ? { robotId: r.robotId } : { adapterId: r.adapterId },
  });
  return p.success ? p.data : null;
}

export interface NodeCommands {
  /** signed (typ cmd) — every deliverable request when central's signer is available */
  signed: EdgeSignedEnvelope[];
  /** R-10-k / R-10-p — ONLY when the signer is unavailable: the node's unacked STOPs, unsigned */
  unsignedStops: EdgeUnsignedStop[];
  /** M-3 — some row could not be expressed / signed / stamped this time (each logged at error level); the others are here */
  incomplete: boolean;
}

/**
 * THIS node's deliverable requests, STOPs first. Each is re-sent until acknowledged (lock / clear also until expired); the edge
 * de-duplicates by requestId. M-3 — a READ failure THROWS (pull / progress answer 503: the edge must never take "no commands"
 * for "none pending"); a failure of ONE row skips that row only, is logged at error level and sets `incomplete`.
 */
export async function commandsForNode(node: EdgeNodePrincipal): Promise<NodeCommands> {
  const out: NodeCommands = { signed: [], unsignedStops: [], incomplete: false };
  const stampLater: number[] = [];
  {
    const d = await centralDb();
    const signer = centralSigner();
    const rows = await d
      .select()
      .from(robotMotionLockRequests)
      .where(
        and(
          eq(robotMotionLockRequests.edgeNodeId, node.nodeId),
          isNull(robotMotionLockRequests.ackedAt),
          or(
            and(eq(robotMotionLockRequests.kind, "stop"), isNull(robotMotionLockRequests.carriedToId)), // every STOP head, overdue or not
            and(ne(robotMotionLockRequests.kind, "stop"), sql`${robotMotionLockRequests.expiresAt} > now()`),
          ),
        ),
      )
      .orderBy(sql`CASE WHEN ${robotMotionLockRequests.kind} = 'stop' THEN 0 ELSE 1 END`, asc(robotMotionLockRequests.createdAt), asc(robotMotionLockRequests.id))
      .limit(EDGE_PULL_COMMANDS_MAX);
    for (const r of rows) {
      try {
      if (r.edgeNodeId !== node.nodeId) {
        // defence in depth: the WHERE already scopes by node
        await auditNode(node, "EDGE_ANOMALY", { type: "edge_node", id: node.nodeId }, { anomaly: "command_row_of_other_node", requestId: r.id }, "failure");
        continue;
      }
      const isStop = r.kind === "stop";
      if (!isStop && !(await stillOwned(d, r))) {
        if (r.deliveredAt == null) await expireOne(d, r.id);
        continue;
      }
      if (!signer) {
        const u = isStop ? unsignedStopOf(r, node) : null;
        if (u) out.unsignedStops.push(u);
        continue; // a lock / clear is never sent without a signature
      }
      const payload = commandPayloadOf(r);
      if (!payload) continue;
      if (r.deliveredAt == null) {
        try {
          await stampDelivered(d, r.id, node.nodeId);
        } catch (err) {
          if (isStop) {
            // R-10-as N-4 (L-7) — the stamp is not needed to sign: a STOP is sent whatever the stamp did (refused, timed out
            // on a row lock, DB error); it is stamped again after the answer is built, else on the next pull
            stampLater.push(r.id);
          } else {
            if (!isEdgeControlRefusal(err)) throw err;
            await expireOne(d, r.id);
            continue;
          }
        }
      }
      out.signed.push(signForNode(signer, "cmd", edgeCommandSchema, payload, node));
      } catch (err) {
        out.incomplete = true;
        console.error(`[EdgeCommands] ⚠ request #${r.id} (${r.kind}) for node ${node.nodeCode} not delivered this pull: ${(err as Error)?.message ?? err}`);
      }
    }
    for (const id of stampLater) {
      // best effort, bounded: a STOP whose stamp still fails stays undelivered-looking and is stamped on a later pull
      await stampDelivered(d, id, node.nodeId).catch((err) =>
        console.warn(`[EdgeCommands] STOP #${id} for node ${node.nodeCode} sent; its delivery stamp failed (${(err as Error)?.message ?? err}) — stamped on a later pull`),
      );
    }
    return out;
  }
}

async function stillOwned(d: Db, r: RobotMotionLockRequestRow): Promise<boolean> {
  const o = await ownerOf(d, r.robotId ?? null, r.adapterId ?? null);
  return !!o && o.edgeNodeId === r.edgeNodeId && o.ownerEpoch === Number(r.ownerEpoch);
}

/** The bound of one delivery stamp: a row lock held elsewhere (an ack in flight) never stalls a pull. */
export const DELIVERY_STAMP_LOCK_MS = 250;

/** Stamp `deliveredAt` of ONE request of the node (first delivery only), under a short lock timeout. Throws on any failure. */
async function stampDelivered(d: Db, id: number, nodeId: number): Promise<void> {
  await d.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('lock_timeout', ${`${DELIVERY_STAMP_LOCK_MS}ms`}, true)`);
    await tx
      .update(robotMotionLockRequests)
      .set({ deliveredAt: new Date() })
      .where(and(eq(robotMotionLockRequests.id, id), eq(robotMotionLockRequests.edgeNodeId, nodeId), isNull(robotMotionLockRequests.deliveredAt)));
  });
}

/** Expire ONE lock / clear (never a STOP — the WHERE excludes it). */
async function expireOne(d: Db, id: number): Promise<void> {
  try {
    await d
      .update(robotMotionLockRequests)
      .set({ ackedAt: new Date(), outcome: "expired" })
      .where(and(eq(robotMotionLockRequests.id, id), ne(robotMotionLockRequests.kind, "stop"), isNull(robotMotionLockRequests.ackedAt)));
  } catch {
    /* a delivered request expires only at / after its expiry (trigger) — the sweeper does it then */
  }
}

export interface EdgeAckInput {
  requestId: number;
  /** notOwnedHere (R-10-au) — the edge's VERIFIED config does not list the target: NEVER terminal (see ackEdgeCommand) */
  outcome: "done" | "refused" | "failed" | "expired" | "notOwnedHere";
  generation: number | null;
  at: number;
  target?: { robotId?: number; adapterId?: number } | null;
  ownerEpoch?: number | null;
  unsigned?: boolean;
}

/**
 * The node's ack of a request (events stream `command_ack`). R-10-o / R-10-p — a lock / clear is recorded only when the row is
 * this node's, its target and owner epoch equal the ack's, it is unacked, and the ack is signed-channel (all in the write's own
 * WHERE). false ⇒ refused (the request stays PENDING).
 * R-10-as N-3 — EVERY ack of a STOP (malformed, of another node's STOP, `expired`, …) and every ack of a request central does
 * not know goes to A's guarded `edge_stop_ack_edge`, which writes the WORM refusal evidence (edge_stop_ack_refusals) itself.
 * R-10-as N-5 — on the CALLER's transaction (a savepoint of the stream batch): no second pool connection. A batch that rolls back
 * (503) takes its acks and their evidence with it; its cursor did not move, so the edge re-sends and both are written then.
 */
export async function ackEdgeCommand(tx: Db, nodeId: number, rec: EdgeAckInput): Promise<boolean> {
  const t = rec.target ?? null;
  const robotId = t && typeof t.robotId === "number" ? t.robotId : null;
  const adapterId = t && typeof t.adapterId === "number" ? t.adapterId : null;
  const epochOk = typeof rec.ownerEpoch === "number" && Number.isSafeInteger(rec.ownerEpoch) && rec.ownerEpoch > 0;
  const wellFormed = (robotId === null) !== (adapterId === null) && epochOk;
  // the request of ANY node: another node's STOP is refused by A's function — with evidence (reason other_node)
  const [head] = await tx
    .select({ kind: robotMotionLockRequests.kind, edgeNodeId: robotMotionLockRequests.edgeNodeId, ackedAt: robotMotionLockRequests.ackedAt, outcome: robotMotionLockRequests.outcome, robotId: robotMotionLockRequests.robotId, adapterId: robotMotionLockRequests.adapterId, ownerEpoch: robotMotionLockRequests.ownerEpoch })
    .from(robotMotionLockRequests)
    .where(eq(robotMotionLockRequests.id, rec.requestId))
    .limit(1);
  if (!head || head.kind === "stop") {
    // the same ack re-sent under a new seq (already recorded) is not a second ack
    const same = !!head && wellFormed && head.edgeNodeId === nodeId && head.ackedAt != null && head.outcome === rec.outcome && (head.robotId ?? null) === robotId && (head.adapterId ?? null) === adapterId && Number(head.ownerEpoch) === rec.ownerEpoch;
    if (same) return true;
    return ackStopRequest(tx, { nodeId, requestId: rec.requestId, robotId, adapterId, ownerEpoch: epochOk ? (rec.ownerEpoch as number) : null, outcome: rec.outcome, generation: rec.generation, unsigned: rec.unsigned === true });
  }
  // fail-closed: a lock / clear ack that does not name exactly one target and its owner epoch is never recorded; R-10-au —
  // `notOwnedHere` never closes a request (the lock stays pending until delivered to its owner or expired by the sweeper)
  if (!wellFormed || head.edgeNodeId !== nodeId || rec.outcome === "notOwnedHere") return false;
  // the same lock / clear ack re-sent (already recorded: same node, outcome, target and owner epoch) is not a second ack: ok, no anomaly
  if (head.ackedAt != null && head.outcome === rec.outcome && (head.robotId ?? null) === robotId && (head.adapterId ?? null) === adapterId && Number(head.ownerEpoch) === rec.ownerEpoch && rec.unsigned !== true) return true;
  const outcome: "done" | "refused" | "failed" | "expired" = rec.outcome;
  try {
    return await tx.transaction(async (sp) => {
      if (rec.unsigned === true) return false; // R-10-p — an unsigned ack is for a STOP only
      const rows = await sp
        .update(robotMotionLockRequests)
        .set({ ackedAt: new Date(), outcome, ackGeneration: outcome === "done" ? rec.generation : null })
        .where(
          and(
            eq(robotMotionLockRequests.id, rec.requestId),
            eq(robotMotionLockRequests.edgeNodeId, nodeId),
            ne(robotMotionLockRequests.kind, "stop"),
            isNull(robotMotionLockRequests.ackedAt),
            robotId !== null ? eq(robotMotionLockRequests.robotId, robotId) : eq(robotMotionLockRequests.adapterId, adapterId as number),
            eq(robotMotionLockRequests.ownerEpoch, rec.ownerEpoch as number),
          ),
        )
        .returning({ id: robotMotionLockRequests.id });
      return rows.length > 0;
    });
  } catch (err) {
    if (isEdgeControlRefusal(err)) return false;
    throw err;
  }
}

/**
 * R-10-aa — THE one place a STOP request is acknowledged: A's guarded `public.edge_stop_ack_edge` (a direct UPDATE of a STOP's ack
 * columns is refused by the DB). It records the ack only for a pending STOP of THIS node whose target (robot XOR adapter) and
 * owner epoch equal the node's report, outcome done | refused | failed; ANY other ack (malformed, other node, mismatch, not
 * pending) ⇒ false + a refusal row. Runs in a SAVEPOINT of `tx` (N-5: the caller's connection), so an error never aborts the batch.
 * Every outcome goes through it (A fix review 7: it never raises on an outcome): `expired` ⇒ refusal row `bad_outcome` (a STOP
 * never expires, R-10-k); R-10-au `notOwnedHere` ⇒ refusal row `not_owned_here`, NEVER terminal — the STOP stays pending for its
 * current owner / central, is re-delivered to this node every pull while it is this node's, and the caller records an anomaly.
 * The row locks it takes (device FOR SHARE, then request FOR UPDATE — 0377's one lock order) are held until the batch commits (N-5);
 * the events batch takes the devices, then the request rows in ascending id order first (F-B2-4 + Đợt 11 H, eventsForNode), so two
 * batches never lock them in opposite orders and an owner change never deadlocks with them.
 */
export async function ackStopRequest(
  tx: Db,
  a: { nodeId: number; requestId: number; robotId: number | null; adapterId: number | null; ownerEpoch: number | null; outcome: "done" | "refused" | "failed" | "expired" | "notOwnedHere"; generation: number | null; unsigned: boolean },
): Promise<boolean> {
  return tx.transaction(async (sp) =>
    ackEdgeStop(sp as never, {
      requestId: a.requestId,
      nodeId: a.nodeId,
      robotId: a.robotId,
      adapterId: a.adapterId,
      ownerEpoch: a.ownerEpoch as number, // null ⇒ A's function records `malformed`
      outcome: a.outcome as "done", // any outcome: A's function refuses (with evidence) what it does not accept
      unsigned: a.unsigned,
      generation: a.outcome === "done" ? a.generation : null,
    }),
  );
}

/**
 * F-B2-4 — the request rows a batch's acks will lock, locked FIRST in ascending id order (a no-op for rows already held): two
 * batches naming the same requests in opposite orders queue instead of deadlocking. Unknown ids lock nothing.
 * doc 81 Đợt 11 task H (mig 0377, one lock order): their DEVICE rows are locked FOR SHARE before them (lockStopRequestDevices) —
 * an owner change locks device → requests, so a batch holding a request while its ack waited for the device deadlocked (40P01).
 */
export async function lockAckRequestsInOrder(tx: Db, requestIds: readonly number[]): Promise<void> {
  const ids = [...new Set(requestIds.filter((x) => Number.isSafeInteger(x) && x > 0))].sort((a, b) => a - b);
  if (ids.length === 0) return;
  await lockStopRequestDevices(tx as never, ids);
  await tx.execute(sql`SELECT id FROM robot_motion_lock_requests WHERE id IN ${sql.raw(`(${ids.join(",")})`)} ORDER BY id FOR UPDATE`);
}

/**
 * The /authorize gate `lock_requested`: the robot's LATEST request at its CURRENT owner epoch is a lock or a stop that was not
 * acknowledged `done`. Once done, the node's lock event mirrors the lock row (gate `motion_locked`) until the node clears it.
 */
export async function lockRequestOutstanding(d: Db, robotId: number, ownerEpoch: number): Promise<boolean> {
  const [latest] = await d
    .select({ kind: robotMotionLockRequests.kind, outcome: robotMotionLockRequests.outcome })
    .from(robotMotionLockRequests)
    .where(and(eq(robotMotionLockRequests.robotId, robotId), eq(robotMotionLockRequests.ownerEpoch, ownerEpoch)))
    .orderBy(desc(robotMotionLockRequests.id))
    .limit(1);
  return !!latest && (latest.kind === "lock" || latest.kind === "stop") && latest.outcome !== "done";
}

/**
 * M-9 — an OT write is refused while a console STOP of the ADAPTER at its current owner epoch is not acknowledged `done`.
 */
export async function adapterStopOutstanding(d: Db, adapterId: number, ownerEpoch: number): Promise<boolean> {
  const [latest] = await d
    .select({ outcome: robotMotionLockRequests.outcome })
    .from(robotMotionLockRequests)
    .where(and(eq(robotMotionLockRequests.adapterId, adapterId), eq(robotMotionLockRequests.ownerEpoch, ownerEpoch), eq(robotMotionLockRequests.kind, "stop")))
    .orderBy(desc(robotMotionLockRequests.id))
    .limit(1);
  return !!latest && latest.outcome !== "done";
}

/**
 * Sweeper: expire LOCK / CLEAR requests past their expiry, and undelivered ones whose owner / epoch changed. A STOP is never
 * expired (the query excludes kind 'stop'); overdue STOPs are logged at error level. Returns how many were expired.
 */
export async function expireEdgeRequests(): Promise<number> {
  const d = await centralDb();
  const due = await d
    .select()
    .from(robotMotionLockRequests)
    .where(and(ne(robotMotionLockRequests.kind, "stop"), isNull(robotMotionLockRequests.ackedAt), or(lte(robotMotionLockRequests.expiresAt, sql`now()`), isNull(robotMotionLockRequests.deliveredAt))))
    .limit(500);
  let n = 0;
  for (const r of due) {
    if (r.kind === "stop") continue; // never — even if the query changed
    const expired = new Date(r.expiresAt).getTime() <= Date.now();
    if (!expired && (r.deliveredAt != null || (await stillOwned(d, r)))) continue;
    try {
      const rows = await d
        .update(robotMotionLockRequests)
        .set({ ackedAt: new Date(), outcome: "expired" })
        .where(and(eq(robotMotionLockRequests.id, r.id), ne(robotMotionLockRequests.kind, "stop"), isNull(robotMotionLockRequests.ackedAt)))
        .returning({ id: robotMotionLockRequests.id });
      n += rows.length;
    } catch (err) {
      if (!isEdgeControlRefusal(err)) throw err;
    }
  }
  const overdue = await overdueStops(d);
  if (overdue.length > 0) {
    console.error(`[EdgeCommands] ⚠ ${overdue.length} STOP request(s) past their expiry and NOT acknowledged (still delivered every pull): ${overdue.slice(0, 20).map((o) => `#${o.id}→node ${o.edgeNodeId}`).join(", ")}`);
  }
  return n;
}

/** STOP requests already alerted as undelivered by THIS process (one alert per request; bounded). */
const undeliveredAlerted = new Map<number, number>();
/** Tests only. */
export function __resetUndeliveredStopAlertsForTests(): void {
  undeliveredAlerted.clear();
}
/** How often the health checker runs alertUndeliveredStops (EDGE_STOP_DELIVERY_CHECK_MS; default = the pull interval). */
export function edgeStopDeliveryCheckMs(): number {
  return envInt("EDGE_STOP_DELIVERY_CHECK_MS", edgeNodePullMs(), 500, 60_000);
}

/** The dedup key of the "STOP not acknowledged" alert of request `id` — ALSO the durable marker the sweep reads (A2(j)): an inbox row carrying it in
 *  `metadata.dedupKey` means that request was alerted. One definition for the alert and the marker query. */
export function khoaCanhBaoStopChuaGiao(requestId: number): string {
  return `${TIEN_TO_KHOA_STOP_CHUA_GIAO}${requestId}`;
}
const TIEN_TO_KHOA_STOP_CHUA_GIAO = "stop_undelivered:request:";

/**
 * doc 81 Đợt 10 final fix wave (I-3, R-10-br, L-7) — the sweep of STOP requests the owning edge has NOT acknowledged within the ack
 * deadline (edgeStopAckDeadlineMs: 3 × pullMs + slack): each gets ONE durable critical alert (alert stream + a safety-critical
 * inbox row to the requester, retried until persisted; dedup key `stop_undelivered:request:<id>` — the same key the console paths use
 * when they already knew the node was unreachable (commandDispatcher raiseOtStopAlert, robotEdgeCommandPort); since the A2(j) polish round they
 * pass `khuTrungBenVung` too, so their inbox row carries the marker and the sweep does not alert that request a second time). The STOP stays pending and is still delivered
 * every pull (never expired, R-10-k). Returns how many alerts this pass raised. A read failure throws (the caller logs it).
 *
 * SCADA R1b-2b-2a A2(j) — read TO THE END, not `ORDER BY id LIMIT 200` (the oldest 200 were re-read every pass and skipped by the in-memory set, so
 * the 201st and every newer unacked STOP was never alerted). Now:
 *   • only the NOT-YET-ALERTED heads are read: the durable marker is the alert's own inbox row (`notifications.metadata->>'dedupKey'` =
 *     khoaCanhBaoStopChuaGiao(id), written because the alert carries `khuTrungBenVung`) — no new column. A restart therefore neither re-alerts
 *     (rows already alerted are not even read: no alert-stream storm) nor skips (a head whose row never landed is read and alerted again — once
 *     per process, the in-memory set covers the gap until the async row lands);
 *   • ascending id cursor, page by page (docHetTheoTrang), with a very large page budget; reaching it ⇒ everything read is alerted + one admin alert;
 *   • polish round — at most TRAN_CANH_BAO_STOP_MOI_LUOT alerts per pass (an outage can leave hundreds overdue at once: no alert burst). Safe
 *     because of the marker: what is not alerted this pass has no inbox row and is not in the in-memory set ⇒ it is read again next pass.
 * The in-memory set (`undeliveredAlerted`) only bridges the gap until the async inbox row lands; it is bounded at 20 000 ids (oldest evicted). In the
 * FALLBACK mode (marker read failed) an evicted id can be alerted once more — its inbox row is still not duplicated (`khuTrungBenVung`), only the
 * alert-stream notice / log line repeats; the fallback is logged every pass it is used.
 */
/** Most "STOP not acknowledged" alerts one sweep pass raises; the rest are alerted on the next passes (none lost — see alertUndeliveredStops). */
export const TRAN_CANH_BAO_STOP_MOI_LUOT = 200;
export async function alertUndeliveredStops(now: number = Date.now()): Promise<number> {
  const d = await centralDb();
  const deadlineMs = edgeStopAckDeadlineMs();
  const { docHetTheoTrang, baoDocCatBot } = await import("./docHetTheoTrang");
  const docTrang = (danhDau: boolean) => (sau: number | null, n: number) =>
    d
      .select({ id: robotMotionLockRequests.id, edgeNodeId: robotMotionLockRequests.edgeNodeId, robotId: robotMotionLockRequests.robotId, adapterId: robotMotionLockRequests.adapterId, requestedBy: robotMotionLockRequests.requestedBy, createdAt: robotMotionLockRequests.createdAt, deliveredAt: robotMotionLockRequests.deliveredAt })
      .from(robotMotionLockRequests)
      .where(
        and(
          eq(robotMotionLockRequests.kind, "stop"),
          isNull(robotMotionLockRequests.ackedAt),
          isNull(robotMotionLockRequests.carriedToId),
          lte(robotMotionLockRequests.createdAt, new Date(now - deadlineMs)),
          sql`${robotMotionLockRequests.createdAt} > now() - interval '24 hours'`,
          sau === null ? undefined : gt(robotMotionLockRequests.id, sau),
          // the durable marker: this request's alert already has its inbox row (the requester's)
          !danhDau ? undefined : sql`NOT EXISTS (SELECT 1 FROM notifications n WHERE n."userId" = ${robotMotionLockRequests.requestedBy} AND n.metadata->>'dedupKey' = ${TIEN_TO_KHOA_STOP_CHUA_GIAO} || ${robotMotionLockRequests.id}::text)`,
        ),
      )
      .orderBy(asc(robotMotionLockRequests.id))
      .limit(n);
  let doc: { hang: Awaited<ReturnType<ReturnType<typeof docTrang>>>; catBot: boolean };
  try {
    doc = await docHetTheoTrang(docTrang(true), (r) => r.id);
  } catch (err) {
    // the marker read failed (e.g. the inbox table) ⇒ never go silent: read without it (the in-memory set and the alert's own durable dedup still apply)
    console.error(`[EdgeCommands] undelivered-STOP sweep: the durable-marker read failed (${String((err as Error)?.message ?? err).slice(0, 160)}) — reading without it`);
    doc = await docHetTheoTrang(docTrang(false), (r) => r.id);
  }
  const { hang: rows, catBot } = doc;
  if (catBot) {
    baoDocCatBot({
      kind: "stop_undelivered_list_cut",
      title: "Unacknowledged STOP sweep could not read every request",
      message: `The sweep of STOP requests not acknowledged by their edge node read ${rows.length} rows and stopped at its page budget — more are unread this pass. Check the edge nodes; use the machines' E-STOP where needed.`,
      dedupKey: "stop_undelivered_list_cut",
    });
  }
  for (const [id, at] of undeliveredAlerted) if (now - at > 48 * 3_600_000) undeliveredAlerted.delete(id);
  let raised = 0;
  let hoan = 0;
  for (const r of rows) {
    if (undeliveredAlerted.has(r.id)) continue;
    if (raised >= TRAN_CANH_BAO_STOP_MOI_LUOT) {
      hoan++; // not marked anywhere ⇒ read and alerted on a later pass
      continue;
    }
    undeliveredAlerted.set(r.id, now);
    if (undeliveredAlerted.size > 20_000) undeliveredAlerted.delete(undeliveredAlerted.keys().next().value as number);
    const target = r.robotId != null ? `robot ${r.robotId}` : `adapter ${r.adapterId}`;
    const ageS = Math.round((now - new Date(r.createdAt).getTime()) / 1000);
    const message =
      `STOP request #${r.id} for ${target} is NOT acknowledged by its edge node ${r.edgeNodeId} after ${ageS} s (bound ${Math.round(deadlineMs / 1000)} s; ` +
      `${r.deliveredAt ? "delivered, no acknowledgement" : "never picked up — the node is not pulling"}). It stays queued and is re-delivered every pull. ` +
      `Check the edge node and the device; use the machine's E-STOP if it is still moving.`;
    const { raiseCriticalStopAlert } = await import("../robot/criticalStopAlert");
    void raiseCriticalStopAlert({
      kind: "stop_undelivered",
      title: `STOP not acknowledged — ${target}`,
      message,
      recipients: [r.requestedBy],
      dedupKey: khoaCanhBaoStopChuaGiao(r.id),
      source: r.robotId != null ? "robot" : "ot",
      entityType: r.robotId != null ? "robot" : "ot_command",
      entityId: (r.robotId ?? r.adapterId) as number,
      retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
      // A2(j) — the inbox row carries metadata.dedupKey = the durable marker the read above skips on (and a duplicate row is never written)
      khuTrungBenVung: {},
    });
    raised++;
  }
  if (hoan > 0) console.error(`[EdgeCommands] ${hoan} more unacknowledged STOP(s) past the per-pass alert budget (${TRAN_CANH_BAO_STOP_MOI_LUOT}) — alerted on the next pass(es)`);
  return raised;
}

// ── X-14 (main:AGENTS-ngoai-le.md:24; buoc3/tam/x14-thiet-ke.md, words approved by HST 17/11) — the TIMED alerts of a STOP an Abort left unconfirmed ──────────
/** Most aborted runs with a due timed alert one pass raises; the rest wait for the next passes, the earliest abort first (none starved: ⌈R/10⌉ passes, G26). */
export const TRAN_RUN_X14_MOI_LUOT = 10;
/** The queries one pass may spend analysing definitions for the lighter words (3 + k a run, DO-67; G25); past it, the usual words — never one alert fewer. */
export const NGAN_SACH_PHAN_TICH_X14 = 300;
/** Timed alerts raised by THIS process (bridges the gap until the inbox row, the durable marker, lands); bounded. */
const daBaoX14 = new Map<string, number>();
/** X-EDGE-ABORT-TUOI — `mocChuX14`: the start of the window in the words (foeKetCucKhongRo.mocChu: a run with a rejection claim ⇒ the long words; else MOC_CUA_SO). */
type ViecX14 = { run: { id: number; startedBy: number | null }; id: string; moc: "som" | "het"; chu: "A" | "C" | "E" | "F" | "G1" | "G2"; ageS: number; conLai: number; mocChuX14: string };

/**
 * X-14 — the words (tam/x14-thiet-ke.md mục 3, verbatim). `q`: the node acknowledged a STOP request for the step's adapter after the abort (G19): the lighter
 * words [B] / [D], never silence. Ids printed short (idGonCua / rutGonGiua): the title stays far under notifications.title's 255 (G22), the body under 800. Pure.
 */
function chuX14(v: ViecX14, id: string, ma: string, q: { id: number; adapterId: number | null; ackedAt: Date | string | null } | undefined, boundS: number): [string, string] {
  const r = v.run.id;
  const phut = Math.ceil(v.conLai / 60_000);
  const tay = "Check the machine on site and use its direct STOP / E-STOP.";
  const het = `Nothing sends it any more: 15 minutes from ${v.mocChuX14} have passed.`;
  const khong = `${v.chu === "F" ? "Step" : "STOP"} not sent — run ${r} step ${id}`;
  if (q && (v.chu === "A" || v.chu === "C"))
    return [`STOP not confirmed on the run — run ${r} step ${id} (edge node ${ma})`, `The run's STOP "${id}" (aborted run ${r}) is NOT confirmed on the run ${v.ageS} s after it became edge node ${ma}'s to send. Edge node ${ma} did acknowledge an adapter STOP request #${q.id} for the same adapter ${q.adapterId} at ${new Date(q.ackedAt ?? 0).toISOString()}, after the abort: that STOP request may come from this Abort or from a console / interlock STOP, and its acknowledgement does not say whether it reached the device or was only simulated. ${v.moc === "som" ? `The node can still send the run's STOP for about ${phut} more minute(s).` : "Nothing sends the run's STOP on its own any more (the node's re-send window is over)."} Check the machine on site and use its direct STOP / E-STOP if it is still running.`];
  if (v.chu === "A")
    return [`STOP not confirmed yet — run ${r} step ${id} (edge node ${ma})`, `STOP "${id}" of aborted run ${r} is NOT confirmed ${v.ageS} s after it became edge node ${ma}'s to send (bound ${boundS} s). Central did not send it: its adapter belongs to that node, and central has no connection to it. The node can still send it for about ${phut} more minute(s) (until 15 minutes from ${v.mocChuX14}), once it reaches central; it may be offline, or its STOP may have failed (a failed STOP has its own alert). Check the machine on site now and use its direct STOP / E-STOP if it is still running. A further press of Abort at central hands it to that node only if the run records a command whose outcome is unknown.`];
  if (v.chu === "C")
    return [`STOP not confirmed — run ${r} step ${id} (edge node ${ma})`, `STOP "${id}" of aborted run ${r} was NOT confirmed within 15 minutes from ${v.mocChuX14}. Central did not send it: its adapter belongs to edge node ${ma}, and central has no connection to it. The node did not confirm sending it either: it may be offline, or its STOP may have failed. Nothing sends it on its own any more: the node's re-send window is over. A further press of Abort at central hands it to that node only if the run records a command whose outcome is unknown. ${tay}`];
  if (v.chu === "E") return [khong, `STOP "${id}" of aborted run ${r} was NOT sent: central could not confirm the connection to its adapter at the Abort, and no press since sent it. ${het.slice(0, -1)}, and nothing sends it on its own when the connection comes back. ${tay}`];
  if (v.chu === "F") return [khong, `Step "${id}" of aborted run ${r} was NOT sent: its pins could not be read at the Abort, so it could not be verified as a pinned STOP, and no press since sent it. ${het} ${tay}`];
  if (v.chu === "G1") return [khong, `STOP "${id}" of aborted run ${r} was refused when the Abort handed it over, so it was NOT sent, and no press since sent it. ${het} ${tay}`];
  return [khong, `STOP "${id}" of aborted run ${r} got an error or no answer when the Abort handed it over: it may or may not have reached the device, and no press since sent it again. ${het} ${tay}`];
}

/**
 * X-14 — the timed sweep (after alertUndeliveredStops, same tick: edgeNodeHealthScheduler). READS ONLY; its only effects are the alerts (raiseCriticalStopAlert:
 * the inbox row = the durable marker, the alert stream) and this process's memory. One alert per (run, step, mark), key `stop_undelivered:run:<run>:<step>:<som|het>`:
 *   • `:som` — a run given to an edge node, a STOP the node is to send (the picture's own reading, laHangAbortChoAnh, less a STOP whose own row completed: a1),
 *     not confirmed past the early bound from m4 = max(finishedAt, lastProgressAt) when no claim holds it (a claim gone stale: from finishedAt; a fresh claim: its
 *     walker sweeps), while the node can still send it (inside ABORT_RESEND_WINDOW_MS);
 *   • `:het` — past the window (and under 24 h more), when nothing sends it on its own: that node STOP; and, on a run NOT latched when swept (a press there still
 *     sends, no window, B2), central's own traces: unverified ([E] its connection / [F] its pins, a node run's unflagged one too) and refused or unanswered ([G1] /
 *     [G2] by phanLoaiStopAbort, never by reading the text).
 * A trace that never landed (khongBen) is not seen (G18). Read failures throw (the caller logs); the marker read failing ⇒ alert from memory, never silent.
 */
export async function canhBaoStopRunQuaHan(now: number = Date.now()): Promise<number> {
  const d = await centralDb();
  const [{ inArray, gte, like }, S, { runEdgeAssignments: A }, { laHangAbortChoAnh, edgeClaimStaleMs }, { phanLoaiStopAbort, dauKhongXacNhan }, F, { ABORT_RESEND_WINDOW_MS: CUA, mocAbortMs, mocTuChoiMs }, { docHetTheoTrang, baoDocCatBot }, { allStepsOf }] = await Promise.all([
    import("drizzle-orm"),
    import("../../../drizzle/schema"),
    import("./edgeExecutionSchema"),
    import("./edgeExecutionCentral"),
    import("../orchestration/foe/foeRunStore"),
    import("../orchestration/foe/foeKetCucKhongRo"),
    import("@shared/foeAbortResend"),
    import("./docHetTheoTrang"),
    import("../orchestration/foe/foeStepClass"),
  ]);
  const R = S.orchestrationRuns;
  const RS = S.orchestrationRunSteps;
  const NGAY = 86_400_000;
  // the SQL window is wide (a naive timestamp may read hours off); the rule below is exact
  const doc = await docHetTheoTrang(
    (sau, n) => d.select().from(R).where(and(eq(R.status, "aborted"), gte(R.finishedAt, new Date(now - CUA - 2 * NGAY)), sau === null ? undefined : gt(R.id, sau))).orderBy(asc(R.id)).limit(n) as unknown as Promise<Array<typeof R.$inferSelect>>,
    (r) => r.id,
  );
  if (doc.catBot) baoDocCatBot({ kind: "stop_undelivered_run_list_cut", title: "Timed STOP alert sweep could not read every aborted run", message: `The sweep of aborted runs whose STOPs are not confirmed read ${doc.hang.length} runs and stopped at its page budget — the rest are unread this pass. Check the machines on site; use their direct STOP / E-STOP where needed.`, dedupKey: "stop_undelivered_run_list_cut" });
  const theoLo = async <T>(ids: number[], f: (lo: number[]) => Promise<T[]>): Promise<T[]> => {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += 200) out.push(...(await f(ids.slice(i, i + 200))));
    return out;
  };
  const vetAll = await theoLo(doc.hang.map((r) => r.id), (lo) => d.select().from(RS).where(and(inArray(RS.runId, lo), like(RS.stepId, "abort:%"), eq(RS.status, "failed"))));
  const coVet = [...new Set(vetAll.map((v) => v.runId))];
  if (!coVet.length) return 0;
  const [hangAll, asgs, dau] = await Promise.all([
    theoLo(coVet, (lo) => d.select().from(RS).where(inArray(RS.runId, lo))),
    theoLo(coVet, (lo) => d.select().from(A).where(inArray(A.runId, lo))),
    theoLo(coVet, (lo) => d.select().from(S.notifications).where(and(eq(S.notifications.type, "ALERT"), eq(S.notifications.entityType, "orchestration_run"), inArray(S.notifications.entityId, lo), gte(S.notifications.createdAt, new Date(now - CUA - 2 * NGAY))))).then(
      (rs) => new Set(rs.map((n) => String((n.metadata as { dedupKey?: unknown } | null)?.dedupKey ?? ""))),
      (err: unknown) => (console.error(`[EdgeCommands] timed STOP sweep: the durable-marker read failed (${String((err as Error)?.message ?? err).slice(0, 160)}) — alerting from this process's memory`), new Set<string>()),
    ),
  ]);
  const asgOf = new Map(asgs.map((a) => [a.runId, a] as const));
  const hanSom = Math.max(2 * edgeStopAckDeadlineMs(), edgeStopAckDeadlineMs() + 2 * edgeNodePullMs());
  const viec: ViecX14[] = [];
  for (const run of doc.hang.filter((r) => r.finishedAt && coVet.includes(r.id)).sort((x, y) => +new Date(x.finishedAt!) - +new Date(y.finishedAt!))) {
    const fin = new Date(run.finishedAt!).getTime();
    // X-EDGE-ABORT-TUOI — the age counts from the abort's ONE moment (a rejection's stamp first); the one-day window to alert still counts from the last write (fin)
    const mocTuoiAbort = mocAbortMs({ status: run.status, finishedAt: run.finishedAt, contextJson: run.contextJson }) ?? fin;
    const mocChuX14 = F.mocChu(mocTuChoiMs(run) !== null);
    const hang = hangAll.filter((h) => h.runId === run.id);
    const ctx = (run.contextJson ?? {}) as Record<string, unknown>;
    const chot = F.runDaChotKhongRo(ctx) || F.chotTuHang(hang, ctx.foeResumeState as never) !== null;
    const het = now - mocTuoiAbort > CUA && now - fin <= CUA + NGAY;
    const a = asgOf.get(run.id);
    const tuoi = a?.claimTokenHash != null && now - new Date(a.lastProgressAt ?? a.claimedAt ?? 0).getTime() < edgeClaimStaleMs();
    const moc = a?.claimTokenHash == null && a?.lastProgressAt ? Math.max(fin, new Date(a.lastProgressAt).getTime()) : fin;
    for (const v of vetAll.filter((x) => x.runId === run.id)) {
      const kq = (v.resultJson ?? {}) as { stepId?: unknown; abortStop?: unknown; adapterNut?: unknown };
      const id = String(kq.stepId ?? v.stepId.slice("abort:".length));
      const cua = hang.find((h) => h.stepId === id);
      const them = (m: ViecX14["moc"], chu: ViecX14["chu"]) => viec.push({ run, id, moc: m, chu, ageS: Math.round((now - moc) / 1000), conLai: mocTuoiAbort + CUA - now, mocChuX14 });
      if (a && laHangAbortChoAnh(v, true)) {
        if ((cua?.status === "completed" || cua?.status === "compensated") && dauKhongXacNhan(cua.resultJson) === null) continue; // a1: its own row went
        if (mocTuoiAbort + CUA - now > 0 && !tuoi && now >= moc + hanSom) them("som", "A");
        if (het) them("het", "C");
      } else if (het && !chot && kq.abortStop === "chuaXacMinh") them("het", kq.adapterNut === true ? "E" : "F");
      else if (het && !chot && !a && (kq.abortStop === "failed" || kq.abortStop === "chuaTraLoi")) {
        const p = phanLoaiStopAbort(id, { hang, ctx });
        them("het", p.lop === "coTheDaRa" || p.truoc === "coTheDaRa" ? "G2" : "G1");
      }
    }
  }
  const khoaX14 = (v: ViecX14) => `stop_undelivered:run:${v.run.id}:${v.id}:${v.moc}`;
  const con = viec.filter((v) => !dau.has(khoaX14(v)) && !daBaoX14.has(khoaX14(v)));
  const tatCa = [...new Set(con.map((v) => v.run.id))];
  const chon = tatCa.slice(0, TRAN_RUN_X14_MOI_LUOT);
  if (tatCa.length > chon.length) console.error(`[EdgeCommands] ${tatCa.length - chon.length} more aborted run(s) with a due timed STOP alert past the per-pass budget (${TRAN_RUN_X14_MOI_LUOT}) — alerted on the next pass(es)`);
  // G19 — the lighter words: a STOP request the node acknowledged (done, its own, a chain head) for the step's adapter after the abort; one cheap read first
  const nutChon = chon.filter((r) => asgOf.has(r));
  const maNut = [...new Set(nutChon.map((r) => asgOf.get(r)!.edgeNodeId))];
  const yc = maNut.length ? await d.select().from(robotMotionLockRequests).where(and(eq(robotMotionLockRequests.kind, "stop"), eq(robotMotionLockRequests.outcome, "done"), isNull(robotMotionLockRequests.centralExecutionId), isNull(robotMotionLockRequests.carriedToId), inArray(robotMotionLockRequests.edgeNodeId, maNut))) : [];
  const nhe = new Map<string, (typeof yc)[number]>();
  let ngan = NGAN_SACH_PHAN_TICH_X14;
  for (const r of nutChon) {
    const a = asgOf.get(r)!;
    const fin = new Date(doc.hang.find((x) => x.id === r)!.finishedAt!).getTime();
    const sau = yc.filter((q) => q.edgeNodeId === a.edgeNodeId && q.ackedAt != null && new Date(q.ackedAt).getTime() >= fin && new Date(q.createdAt).getTime() >= fin);
    if (!sau.length) continue;
    const { assignedDefinition } = await import("./edgeReportsCentral");
    const { loadMachineMap, analyseDefinition } = await import("./edgeRunAnalysis");
    const def = await assignedDefinition(d, a).catch(() => null);
    const chiPhi = 3 + allStepsOf(def?.steps).filter((s) => s.type === "command" && typeof (s as { args?: { adapterId?: unknown } }).args?.adapterId !== "number").length;
    if (!def || chiPhi > ngan) continue; // past the budget: the usual words ("in doubt, still alert")
    ngan -= chiPhi;
    const an = await analyseDefinition(d, r, def, await loadMachineMap(d, def)).catch(() => null);
    for (const ra of an?.resolvedAdapters ?? []) {
      const q = sau.filter((x) => x.adapterId === ra.adapterId).sort((x, y) => new Date(y.ackedAt!).getTime() - new Date(x.ackedAt!).getTime())[0];
      if (q) nhe.set(`${r}|${ra.stepId}`, q);
    }
  }
  const admins = (await d.select().from(S.users).where(and(eq(S.users.role, "admin"), eq(S.users.isActive, true))).limit(10)).map((u) => u.id);
  const nuts = new Map(maNut.length ? (await d.select().from(S.edgeNodes).where(inArray(S.edgeNodes.id, maNut))).map((n) => [n.id, n.code] as const) : []);
  const { raiseCriticalStopAlert } = await import("../robot/criticalStopAlert");
  if (daBaoX14.size > 20_000) daBaoX14.clear();
  let raised = 0;
  for (const v of con.filter((x) => chon.includes(x.run.id))) {
    const a = asgOf.get(v.run.id);
    const [title, message] = chuX14(v, F.idGonCua(v.id), F.rutGonGiua(nuts.get(a?.edgeNodeId ?? -1) ?? `#${a?.edgeNodeId}`, F.TRAN_TEN_NUT), a ? nhe.get(`${v.run.id}|${v.id}`) : undefined, Math.round(hanSom / 1000));
    daBaoX14.set(khoaX14(v), now);
    void raiseCriticalStopAlert({ kind: "stop_undelivered", title, message, recipients: [...new Set([...(v.run.startedBy ? [v.run.startedBy] : []), ...admins])], dedupKey: khoaX14(v), source: "ot", entityType: "orchestration_run", entityId: v.run.id, retryUntilPersisted: { everyMs: 30_000, attempts: 20 }, khuTrungBenVung: {} });
    raised++;
  }
  return raised;
}

/** Unacked STOP heads past their expiry (still delivered; reported, never expired). */
export async function overdueStops(d: Db): Promise<Array<{ id: number; edgeNodeId: number }>> {
  return d
    .select({ id: robotMotionLockRequests.id, edgeNodeId: robotMotionLockRequests.edgeNodeId })
    .from(robotMotionLockRequests)
    .where(and(eq(robotMotionLockRequests.kind, "stop"), isNull(robotMotionLockRequests.ackedAt), isNull(robotMotionLockRequests.carriedToId), lte(robotMotionLockRequests.expiresAt, sql`now()`)))
    .limit(200);
}
