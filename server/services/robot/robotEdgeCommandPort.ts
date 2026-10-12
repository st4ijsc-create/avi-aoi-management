/**
 * doc 81 Đợt 10 task D (design §2.8 / §2.11) — central's console actions on a robot an EDGE node owns. Central holds no driver
 * session for it, so the operator's STOP, lock and clear go to the owning node as signed commands, queued by group B's
 * edgeNodeCommands (robot_motion_lock_requests → pull/progress `commands[]`). This module is the PORT robotRouter talks to:
 *   • `robotEdgeOwner(robotId)` — the owning node now (narrow projection, bounded); null = central / unknown (the caller keeps
 *     its existing central path — e.g. "robot not active");
 *   • `edgeDeviceRequestPort()` — the queue. The default adapter calls B's `enqueueEdgeDeviceRequest` (lazy import, B's file is
 *     not edited here); `setEdgeDeviceRequestPort` replaces it (tests, or a future transport).
 * The port never sends anything to a device; the edge applies the command (a STOP is sent there even if its signature check
 * fails — L-7; a clear needs a valid, unexpired command and the generation match).
 */
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { withDeadline } from "../ot/drivers/boundedClose";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

export type EdgeDeviceRequestKind = "lock" | "clear" | "stop";
export interface EdgeDeviceRequestInput {
  kind: EdgeDeviceRequestKind;
  robotId?: number;
  adapterId?: number;
  /** required for `clear` (≥ 1): the lock generation the operator saw */
  expectedGeneration?: number;
  reason: string;
  requestedBy: number;
}
export interface EdgeDeviceRequestQueued {
  requestId: number;
  edgeNodeId: number;
  ownerEpoch: number;
}
/** Failure codes of the queue (B's EdgeRequestError.code): the device is not edge-owned / bad input / owner changed / DB. */
export type EdgeDeviceRequestErrorCode = "notEdgeOwned" | "invalid" | "stale" | "unavailable";
export interface EdgeDeviceRequestPort {
  /** queue one request for the node that owns the device NOW; throws an error carrying `code` (EdgeDeviceRequestErrorCode) */
  enqueue(input: EdgeDeviceRequestInput): Promise<EdgeDeviceRequestQueued>;
}

let port: EdgeDeviceRequestPort | null = null;
export function setEdgeDeviceRequestPort(p: EdgeDeviceRequestPort | null): void {
  port = p;
}

/** The queue: the installed port, else the adapter over group B's edgeNodeCommands.enqueueEdgeDeviceRequest. */
export function edgeDeviceRequestPort(): EdgeDeviceRequestPort {
  if (port) return port;
  return {
    async enqueue(input) {
      const mod = (await import("../edge/edgeNodeCommands")) as unknown as {
        enqueueEdgeDeviceRequest: (i: EdgeDeviceRequestInput) => Promise<EdgeDeviceRequestQueued>;
      };
      return mod.enqueueEdgeDeviceRequest(input);
    },
  };
}

/** The error code of a queue failure (unknown ⇒ "unavailable"). */
export function edgeDeviceRequestErrorCode(err: unknown): EdgeDeviceRequestErrorCode {
  const c = (err as { code?: unknown } | null)?.code;
  return c === "notEdgeOwned" || c === "invalid" || c === "stale" || c === "unavailable" ? c : "unavailable";
}

/**
 * The edge node that owns `robotId` now, or null (central-owned, unknown robot, a DB without 0374, or the read failed /
 * timed out — the caller then keeps its central path). Bounded by STOP_DB_STEP_DEADLINE_MS. Never throws.
 */
export async function robotEdgeOwner(robotId: number): Promise<number | null> {
  try {
    const read = (async () => {
      const { robotOwnership } = await import("../edge/edgeControlSchema");
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select().from(robotOwnership).where(eq(robotOwnership.id, robotId)).limit(1);
      const owner = (row as { id?: unknown; edgeNodeId?: unknown } | undefined)?.edgeNodeId;
      return (row as { id?: unknown } | undefined)?.id === robotId && typeof owner === "number" && Number.isSafeInteger(owner) && owner > 0 ? owner : null;
    })();
    return await withDeadline(read, STOP_DB_STEP_DEADLINE_MS, `robot ${robotId} edge owner`);
  } catch {
    return null;
  }
}
