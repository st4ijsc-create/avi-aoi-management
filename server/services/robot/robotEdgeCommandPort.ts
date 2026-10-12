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
 * fix review 1 (R-10-v, M-2) — the owner read as FOUR outcomes, so a STOP never mistakes "could not read" for "central":
 * edge node id · central (row found, no edge owner) · missing (no robot row / a DB without 0374) · unknown (error / timeout).
 */
export type RobotOwnerRead = { edge: number } | { central: true } | { missing: true } | { unknown: string };
export async function robotOwnerRead(robotId: number): Promise<RobotOwnerRead> {
  try {
    const read = (async (): Promise<RobotOwnerRead> => {
      const { robotOwnership, isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
      const db = await getDb();
      if (!db) return { unknown: "database unavailable" };
      try {
        const [row] = await db.select().from(robotOwnership).where(eq(robotOwnership.id, robotId)).limit(1);
        const r = row as { id?: unknown; edgeNodeId?: unknown } | undefined;
        if (!r || r.id !== robotId) return { missing: true };
        const owner = r.edgeNodeId;
        return typeof owner === "number" && Number.isSafeInteger(owner) && owner > 0 ? { edge: owner } : { central: true };
      } catch (err) {
        if (isEdgeControlSchemaMissing(err)) return { missing: true };
        throw err;
      }
    })();
    return await withDeadline(read, STOP_DB_STEP_DEADLINE_MS, `robot ${robotId} owner`);
  } catch (err) {
    return { unknown: String((err as Error)?.message ?? err).slice(0, 160) };
  }
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

/**
 * doc 81 Đợt 10 task D — ruling R-10-k (L-7): a console STOP for a robot an EDGE node owned when it was looked up. It must NEVER
 * become a silent no-op:
 *   1. queue it for the node that owns the robot now (B's edgeNodeCommands);
 *   2. the queue refused / failed (stale | notEdgeOwned | unavailable | anything) ⇒ BOTH, at once:
 *        • if central holds a session for the robot ⇒ the STOP goes out through central's path immediately (`centralStop`);
 *        • the queue is retried ONCE for the CURRENT owner (the owner may have changed between the lookup and the insert);
 *   3. neither worked ⇒ a CRITICAL operator alert + an error the user sees (use the hardware E-STOP).
 * Never throws.
 */
export interface ConsoleStopOutcome {
  ok: boolean;
  via: "edge_queue" | "edge_queue_retry" | "central" | "central+edge_queue_retry" | "none";
  requestId?: number;
  edgeNodeId?: number;
  centralStatus?: string;
  /** set when ok === false — shown to the user */
  error?: "EDGE_STOP_NOT_QUEUED";
  detail?: string;
}
export async function sendConsoleStopForEdgeRobot(a: {
  robotId: number;
  requestedBy: number;
  reason: string;
  /** central's STOP for the robot, evaluated at failure time: resolves null when central holds no session for it */
  centralStop: () => Promise<{ ok: boolean; status: string } | null>;
  alert?: (message: string) => void;
}): Promise<ConsoleStopOutcome> {
  // R-10-ak — every await before the send / the answer is under the STOP bound
  const enqueue = () => withDeadline(edgeDeviceRequestPort().enqueue({ kind: "stop", robotId: a.robotId, reason: a.reason, requestedBy: a.requestedBy }), STOP_DB_STEP_DEADLINE_MS, `robot ${a.robotId} STOP enqueue`);
  let firstError: string;
  try {
    const q = await enqueue();
    return { ok: true, via: "edge_queue", requestId: q.requestId, edgeNodeId: q.edgeNodeId };
  } catch (err) {
    firstError = edgeDeviceRequestErrorCode(err);
  }
  // L-7 — the central STOP (when a session exists) and the re-queue run together; neither waits for the other
  const central = Promise.resolve()
    .then(() => a.centralStop())
    .then(
      (r) => r,
      (e) => ({ ok: false, status: String((e as Error)?.message ?? e).slice(0, 120) }),
    );
  const retry = enqueue().then(
    (q) => ({ ok: true as const, q }),
    (e) => ({ ok: false as const, code: edgeDeviceRequestErrorCode(e) }),
  );
  const [c, r] = await Promise.all([central, retry]);
  const centralOk = c?.ok === true;
  if (r.ok) {
    return { ok: true, via: centralOk ? "central+edge_queue_retry" : "edge_queue_retry", requestId: r.q.requestId, edgeNodeId: r.q.edgeNodeId, ...(c ? { centralStatus: c.status } : {}) };
  }
  if (centralOk) return { ok: true, via: "central", centralStatus: c!.status };
  const detail = `console STOP for robot ${a.robotId} could not be delivered: queue ${firstError} then ${r.code}${c ? `, central STOP ${c.status}` : ", central holds no session"}`;
  const message = `${detail}. Use the hardware E-STOP on the machine now.`;
  console.error(`[Robot] CRITICAL: ${message}`);
  try {
    (a.alert ?? ((m: string) => defaultStopAlert(m, a.robotId, a.requestedBy)))(message);
  } catch {
    /* the error below still reaches the user */
  }
  return { ok: false, via: "none", error: "EDGE_STOP_NOT_QUEUED", detail };
}

/** M-4 (fix review 1) — DURABLE: the alert stream AND a safety-critical inbox row to the requester (criticalStopAlert). */
function defaultStopAlert(message: string, robotId: number, requestedBy: number): void {
  void import("./criticalStopAlert")
    .then(({ raiseCriticalStopAlert }) =>
      raiseCriticalStopAlert({ kind: "console_stop_undelivered", title: `STOP not delivered — robot ${robotId}`, message, recipients: [requestedBy], dedupKey: `console_stop_undelivered:robot:${robotId}:${Date.now()}`, source: "robot", entityType: "robot", entityId: robotId }),
    )
    .catch(() => undefined);
}

/**
 * doc 81 Đợt 10 task D fix review 2 — ruling R-10-ak (L-7): a console STOP for a robot this process holds NO session for (central
 * owner, or the owner could not be read). Before the send nothing waits longer than the STOP bound:
 *   • the central transient-session STOP is STARTED at once (its row read is bounded inside; its connect + abort carry the session
 *     deadline), and — owner unknown — the edge enqueue runs IN PARALLEL under STOP_DB_STEP_DEADLINE_MS;
 *   • the answer is given at CONSOLE_STOP_REPLY_BOUND_MS at the latest, with a PARTIAL result (each leg: done / failed / pending);
 *   • a durable critical alert is raised at the answer (the partial state), and again if the central leg later FAILS.
 * Never throws.
 */
export const CONSOLE_STOP_REPLY_BOUND_MS = 2 * STOP_DB_STEP_DEADLINE_MS;
type Leg<T> = { state: "done"; value: T } | { state: "failed"; error: string } | { state: "pending" };
export interface NoSessionStopOutcome {
  ok: boolean;
  central: Leg<{ ok: boolean; sent: string; detail: string }>;
  queued: Leg<EdgeDeviceRequestQueued> | null;
  /** set when ok === false — shown to the user */
  error?: "EDGE_STOP_NOT_QUEUED";
}
export async function sendConsoleStopNoSession(a: {
  robotId: number;
  requestedBy: number;
  reason: string;
  ownerUnknown: string | null;
  centralStop: (robotId: number) => Promise<{ ok: boolean; sent: string; detail: string }>;
  alert?: (message: string, critical: boolean) => void;
  replyBoundMs?: number;
}): Promise<NoSessionStopOutcome> {
  const alert = a.alert ?? ((m: string) => defaultStopAlert(m, a.robotId, a.requestedBy));
  const track = <T,>(p: Promise<T>) => {
    const leg: { v: Leg<T> } = { v: { state: "pending" } };
    const done = p.then(
      (value) => void (leg.v = { state: "done", value }),
      (e) => void (leg.v = { state: "failed", error: String((e as Error)?.message ?? e).slice(0, 160) }),
    );
    return { leg, done };
  };
  const central = track(Promise.resolve().then(() => a.centralStop(a.robotId)));
  const queued =
    a.ownerUnknown !== null
      ? track(withDeadline(edgeDeviceRequestPort().enqueue({ kind: "stop", robotId: a.robotId, reason: `${a.reason} (owner unknown)`, requestedBy: a.requestedBy }), STOP_DB_STEP_DEADLINE_MS, `robot ${a.robotId} STOP enqueue`))
      : null;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    Promise.all([central.done, queued?.done]),
    new Promise<void>((r) => {
      timer = setTimeout(r, a.replyBoundMs ?? CONSOLE_STOP_REPLY_BOUND_MS);
    }),
  ]);
  clearTimeout(timer);
  const c = central.leg.v;
  const q = queued ? queued.leg.v : null;
  const centralOk = c.state === "done" && c.value.ok;
  const queuedOk = q?.state === "done";
  const ok = centralOk || queuedOk || c.state === "pending";
  const describe = (l: Leg<unknown> | null, name: string) =>
    l === null ? "" : l.state === "done" ? `${name}: ${JSON.stringify(l.value).slice(0, 160)}` : l.state === "failed" ? `${name}: FAILED (${l.error})` : `${name}: still in progress`;
  const message =
    `Console STOP for robot ${a.robotId}: this server held no session for it (${a.ownerUnknown !== null ? `owner unreadable: ${a.ownerUnknown}` : "central-owned"}); ` +
    [describe(c, "transient-session STOP"), describe(q, "edge queue")].filter(Boolean).join("; ") +
    (centralOk || queuedOk ? "." : " — use the hardware E-STOP on the machine now if the robot is still moving.");
  try {
    alert(message, !(centralOk || queuedOk));
  } catch {
    /* the answer below still reaches the user */
  }
  if (c.state === "pending") {
    // the transient session is still running — if it ends badly, a second alert
    void central.done.then(() => {
      const late = central.leg.v;
      if (late.state === "failed" || (late.state === "done" && !late.value.ok)) {
        try {
          alert(`Console STOP for robot ${a.robotId}: the transient-session STOP finished WITHOUT confirmation (${late.state === "failed" ? late.error : late.value.detail}). Use the hardware E-STOP on the machine now.`, true);
        } catch {
          /* logged by the alert itself */
        }
      }
    });
  }
  return { ok, central: c, queued: q, ...(ok ? {} : { error: "EDGE_STOP_NOT_QUEUED" as const }) };
}
