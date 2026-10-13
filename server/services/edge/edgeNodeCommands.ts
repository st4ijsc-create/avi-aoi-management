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
import { and, asc, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { EDGE_PULL_COMMANDS_MAX, EDGE_UNSIGNED_STOP_TYP, edgeCommandSchema, edgeUnsignedStopSchema, type EdgeUnsignedStop } from "./edgeProtocol";
import { ackEdgeStop, robotMotionLockRequests, robotOwnership, adapterOwnership, isEdgeControlRefusal, type RobotMotionLockRequestRow } from "./edgeControlSchema";
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
 * The row locks it takes (request FOR UPDATE, device FOR SHARE) are held until the batch commits (N-5); the events batch takes
 * the request rows in ascending id order first (F-B2-4, eventsForNode), so two batches never lock them in opposite orders.
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
 */
export async function lockAckRequestsInOrder(tx: Db, requestIds: readonly number[]): Promise<void> {
  const ids = [...new Set(requestIds.filter((x) => Number.isSafeInteger(x) && x > 0))].sort((a, b) => a - b);
  if (ids.length === 0) return;
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

/** Unacked STOP heads past their expiry (still delivered; reported, never expired). */
export async function overdueStops(d: Db): Promise<Array<{ id: number; edgeNodeId: number }>> {
  return d
    .select({ id: robotMotionLockRequests.id, edgeNodeId: robotMotionLockRequests.edgeNodeId })
    .from(robotMotionLockRequests)
    .where(and(eq(robotMotionLockRequests.kind, "stop"), isNull(robotMotionLockRequests.ackedAt), isNull(robotMotionLockRequests.carriedToId), lte(robotMotionLockRequests.expiresAt, sql`now()`)))
    .limit(200);
}
