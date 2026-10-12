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
import { z } from "zod";
import { EDGE_PULL_COMMANDS_MAX, edgeCommandSchema } from "./edgeProtocol";
import { ackEdgeStop, robotMotionLockRequests, robotOwnership, adapterOwnership, isEdgeControlRefusal, type RobotMotionLockRequestRow } from "./edgeControlSchema";
import { auditNode, centralDb, centralSigner, signForNode, type Db } from "./edgeCentralCommon";
import type { EdgeNodePrincipal } from "./edgeNodeCredentials";
import type { EdgeSignedEnvelope } from "./edgeSigning";

export type EdgeRequestKind = "lock" | "clear" | "stop";

// ── R-10-p — the ONE unsigned envelope (contract addition: edgeProtocol's pull / progress answers carry it as `unsignedStops`) ──
export const EDGE_UNSIGNED_STOP_TYP = "cmd-stop-unsigned" as const;
const zPos = z.number().int().positive().max(2_147_483_647);
/** A STOP central could not sign (no signer): ONLY kind stop, ONLY these keys. The edge sends it (L-7) and logs an anomaly. */
export const edgeUnsignedStopSchema = z.strictObject({
  typ: z.literal(EDGE_UNSIGNED_STOP_TYP),
  requestId: zPos,
  nodeId: zPos,
  credentialId: zPos,
  ownerEpoch: zPos,
  target: z.union([z.strictObject({ robotId: zPos }), z.strictObject({ adapterId: zPos })]),
});
export type EdgeUnsignedStop = z.infer<typeof edgeUnsignedStopSchema>;

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

async function ownerOf(d: Db, robot: number | null, adapter: number | null): Promise<{ edgeNodeId: number | null; ownerEpoch: number } | null> {
  const [o] =
    robot !== null
      ? await d.select({ edgeNodeId: robotOwnership.edgeNodeId, ownerEpoch: robotOwnership.ownerEpoch }).from(robotOwnership).where(eq(robotOwnership.id, robot)).limit(1)
      : await d.select({ edgeNodeId: adapterOwnership.edgeNodeId, ownerEpoch: adapterOwnership.ownerEpoch }).from(adapterOwnership).where(eq(adapterOwnership.id, adapter as number)).limit(1);
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
  let d: Db;
  try {
    d = await centralDb();
  } catch {
    throw fail("unavailable", "database unavailable");
  }
  const attempts = stop ? 3 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const owner = await ownerOf(d, robot, adapter);
      lastOwner = owner;
      if (!owner || owner.edgeNodeId == null) throw fail("notEdgeOwned", "the device is not owned by an edge node");
      const ttl = input.ttlMs ?? edgeRequestTtlMs(input.kind);
      const [row] = await d
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
      return { requestId: row.id, edgeNodeId: owner.edgeNodeId, ownerEpoch: owner.ownerEpoch };
    } catch (err) {
      if (err instanceof EdgeRequestError) throw err;
      if (isEdgeControlRefusal(err)) {
        if (i + 1 < attempts) continue; // a STOP: the owner changed between the read and the insert — re-read, re-queue
        throw fail("stale", "the device's owner changed — retry");
      }
      throw fail("unavailable", "the request could not be queued (database or migration 0374)");
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
}

/**
 * THIS node's deliverable requests, STOPs first. Each is re-sent until acknowledged (lock / clear also until expired); the edge
 * de-duplicates by requestId. Never throws: a read error ⇒ nothing this time (logged at error level; the next pull — bounded by
 * limits.pullMs ≤ 60 s — retries).
 */
export async function commandsForNode(node: EdgeNodePrincipal): Promise<NodeCommands> {
  const out: NodeCommands = { signed: [], unsignedStops: [] };
  try {
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
          await d.update(robotMotionLockRequests).set({ deliveredAt: new Date() }).where(and(eq(robotMotionLockRequests.id, r.id), eq(robotMotionLockRequests.edgeNodeId, node.nodeId), isNull(robotMotionLockRequests.deliveredAt)));
        } catch (err) {
          if (!isEdgeControlRefusal(err)) throw err;
          if (!isStop) {
            await expireOne(d, r.id);
            continue;
          }
          // a STOP is sent even when its delivery stamp is refused (L-7)
        }
      }
      out.signed.push(signForNode(signer, "cmd", edgeCommandSchema, payload, node));
    }
    return out;
  } catch (err) {
    console.error(`[EdgeCommands] commands for node ${node.nodeCode} not read — pending STOPs wait for the next pull: ${(err as Error)?.message ?? err}`);
    return out;
  }
}

async function stillOwned(d: Db, r: RobotMotionLockRequestRow): Promise<boolean> {
  const o = await ownerOf(d, r.robotId ?? null, r.adapterId ?? null);
  return !!o && o.edgeNodeId === r.edgeNodeId && o.ownerEpoch === Number(r.ownerEpoch);
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
  outcome: "done" | "refused" | "failed" | "expired";
  generation: number | null;
  at: number;
  target?: { robotId?: number; adapterId?: number } | null;
  ownerEpoch?: number | null;
  unsigned?: boolean;
}

/**
 * The node's ack of ITS request (events stream `command_ack`). R-10-o / R-10-p — recorded only when the row is this node's,
 * its target and owner epoch equal the ack's, it is unacked, and an `unsigned` ack is for a STOP (all in the write's own WHERE).
 * false ⇒ refused (the request stays PENDING). Runs in a savepoint of the caller's transaction. A lock / clear is acked here;
 * a STOP only through ackStopRequest (R-10-aa: the single switch point to A's guarded function).
 */
export async function ackEdgeCommand(tx: Db, nodeId: number, rec: EdgeAckInput): Promise<boolean> {
  const t = rec.target ?? null;
  const robotId = t && typeof t.robotId === "number" ? t.robotId : null;
  const adapterId = t && typeof t.adapterId === "number" ? t.adapterId : null;
  // fail-closed: an ack that does not name exactly one target and its owner epoch is never recorded
  if ((robotId === null) === (adapterId === null) || !(typeof rec.ownerEpoch === "number" && Number.isSafeInteger(rec.ownerEpoch) && rec.ownerEpoch > 0)) return false;
  const target = robotId !== null ? { robotId } : { adapterId: adapterId as number };
  try {
    return await tx.transaction(async (sp) => {
      const [row] = await sp
        .select({ kind: robotMotionLockRequests.kind })
        .from(robotMotionLockRequests)
        .where(and(eq(robotMotionLockRequests.id, rec.requestId), eq(robotMotionLockRequests.edgeNodeId, nodeId)))
        .limit(1);
      if (!row) return false;
      if (row.kind === "stop") return ackStopRequest(sp as unknown as Db, nodeId, rec.requestId, target, rec.ownerEpoch as number, rec.outcome, rec.generation, rec.unsigned === true);
      if (rec.unsigned === true) return false; // R-10-p — an unsigned ack is for a STOP only
      const rows = await sp
        .update(robotMotionLockRequests)
        .set({ ackedAt: new Date(), outcome: rec.outcome, ackGeneration: rec.outcome === "done" ? rec.generation : null })
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
 * R-10-aa — THE one place a STOP request is acknowledged: A's guarded `public.edge_stop_ack_edge` (fix review 3; a direct UPDATE
 * of a STOP's ack columns is refused by the DB). It records the ack only for a pending STOP of THIS node whose target (robot XOR
 * adapter) and owner epoch equal the node's report, outcome done | refused | failed (never expired), and records whether it
 * came over the unsigned channel. false ⇒ nothing changed (the request stays pending; the caller audits an anomaly).
 */
export async function ackStopRequest(
  tx: Db,
  nodeId: number,
  requestId: number,
  target: { robotId: number } | { adapterId: number },
  ownerEpoch: number,
  outcome: "done" | "refused" | "failed" | "expired",
  generation: number | null,
  unsigned: boolean,
): Promise<boolean> {
  if (outcome === "expired") return false; // a STOP is never expired (R-10-k)
  return ackEdgeStop(tx as never, {
    requestId,
    nodeId,
    robotId: "robotId" in target ? target.robotId : null,
    adapterId: "adapterId" in target ? target.adapterId : null,
    ownerEpoch,
    outcome,
    unsigned,
    generation: outcome === "done" ? generation : null,
  });
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
