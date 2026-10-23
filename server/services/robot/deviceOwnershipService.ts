/**
 * doc 81 Đợt 10 task D (design §2.12, rulings R-10-i / R-10-v / R-10-w, L-7) — the ownership change of a robot / OT adapter, and
 * what CENTRAL owes the device right after it moves to central.
 *
 * changeDeviceOwner: ONE transaction (the WORM history names the actor — setEdgeOwnershipActor), UPDATE …"edgeNodeId", plus
 * pg NOTIFY 'device_owner_changed' (delivered at COMMIT). The DB (mig 0374) does the rest atomically: refuses while a job /
 * command is in flight, bumps the owner epoch, relocks a robot ('ownerChanged' under the new authority + epoch), and CARRIES
 * unacknowledged STOP requests of the previous ownership to a new EDGE owner. A refusal (23514) is answered as `refused`.
 *
 * R-10-i / R-10-w — STOPs owed to a device that is CENTRAL-owned now (device_pending_stops.centralMustExecute) are EXECUTED, not
 * merely left visible: right after a transfer made here, and by a SWEEP at central boot + every ≤ 10 s (startDeviceOwnershipSync)
 * that also catches a crash between commit and STOP, a failed ack, and a transfer made by any other path. Per device, ONE
 * transaction locks the device row FOR SHARE, then its pending requests FOR UPDATE SKIP LOCKED (Đợt 11 H — device before request,
 * the one lock order of mig 0377; one replica executes them; another sweep skips, never waits),
 * sends ONE STOP through central's path (robot: the canonical abort through robotManager's session, else a transient driver
 * session; adapter: its PINNED stop values through the OT device stage on the running driver, else a transient session), then
 * acks each request in its own savepoint through A's guarded edge_stop_ack_central (done | failed; actor = the transferring admin,
 * else the requester). A STOP that could not be sent ⇒ `failed` (the row stays, visible) + a DURABLE critical alert
 * (criticalStopAlert: alert stream + safety-critical inbox). Dry-run (central control off) is NEVER reported done: the attempt is recorded NOT sent, the requests stay pending, and a truthful alert says so (R-10-bd, NF5-5).
 *
 * R-10-v — ownership is applied LIVE: this process attaches / detaches its robotManager / otManager session at once (central → edge
 * ⇒ its polling, ingest and session stop now); other replicas follow the NOTIFY; a reconcile every ≤ 30 s is the backstop.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { withDeadline } from "../ot/drivers/boundedClose";
import { DbUnavailableError } from "../../_core/dbErrors";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

export type DeviceKind = "robot" | "adapter";
export interface CentralStopOutcome {
  requestIds: number[];
  outcome: "done" | "failed";
  sent: "sent" | "simulated" | "failed";
  detail: string;
  /** the acks that could not be written (the request then stays pending — the next sweep retries) */
  ackErrors: number[];
  /** fix review 5 (R-10-bd) — nothing reached the device (central control off / dry-run): recorded NOT sent, requests left PENDING */
  notSent?: true;
}
export type ChangeOwnerResult =
  | { ok: true; ownerEpoch: number; toEdgeNodeId: number | null; centralStops: CentralStopOutcome | null }
  | { ok: false; reason: "refused" | "not_found" | "unavailable"; detail: string };

/**
 * doc 81 Đợt 11 H fix 1 (review H-R1, L-7) — the longest the sweep waits for the device row lock (SET LOCAL lock_timeout: the
 * SERVER cancels the wait with 55P03, so the transaction ends at once — a JS deadline alone left the ROLLBACK queued behind the
 * blocked statement). Not obtained ⇒ the central STOP is sent anyway; only its record / ack waits for a later sweep.
 */
export const CENTRAL_STOP_DEVICE_LOCK_TIMEOUT_MS = STOP_DB_STEP_DEADLINE_MS;
const isLockNotAvailable = (e: unknown): boolean => {
  const x = e as { code?: string; cause?: { code?: string } } | null;
  return x?.code === "55P03" || x?.cause?.code === "55P03";
};

/** Bound of one transient session (connect + stop + disconnect) of a device central did not hold. */
export const CENTRAL_STOP_SESSION_DEADLINE_MS = 10_000;
let sessionDeadlineMs = CENTRAL_STOP_SESSION_DEADLINE_MS;
/** Test seam — a shorter transient-session bound. */
export function _setCentralStopSessionDeadlineMsForTests(ms: number | null): void {
  sessionDeadlineMs = ms ?? CENTRAL_STOP_SESSION_DEADLINE_MS;
}
export const DEVICE_OWNER_CHANNEL = "device_owner_changed";
export const DEVICE_OWNER_RECONCILE_MS = 30_000;
export const PENDING_STOP_SWEEP_MS = 10_000;
/** final fix wave (M-2) — "0374 missing" was already logged by the sweep (reset once the pending set reads again) */
let pendingSchemaMissingLogged = false;
/**
 * doc 81 Đợt 11 final fix wave (R-11-k 4, final review M-3) — the GLOBAL sweep's "device row busy ⇒ STOP sent anyway" branch: the
 * STOP is still sent EVERY pass (idempotent, L-7), but its operator alert is raised ONCE per device per lock EPISODE (and again only
 * when the send outcome changes). An episode ends when a pass obtains the device lock, or when the device has no pending STOP left.
 * Key `${kind}:${id}` → the outcome already alerted ("sent" | "simulated" | "failed").
 */
const busyEpisodeAlerted = new Map<string, string>();
/** test seam — the devices whose busy-episode alert was raised (R-11-k 4) */
export function _busyEpisodeAlertsForTests(): string[] {
  return [...busyEpisodeAlerted.keys()];
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*@/gi, "$1***@").slice(0, 240);
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? (r as Array<Record<string, unknown>>) : (((r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>));

/**
 * doc 81 Đợt 10 task D fix review 3 — ruling R-10-am (from B). A device is handed only to an edge node of ITS OWN factory: the
 * device's factory (robot: COALESCE(its station's line, its own line) → workshop → factory; adapter: machine → station → line →
 * workshop → factory) must equal the node's factoryCode. Either side NULL / empty ⇒ refused; the chain unreadable ⇒ refused
 * (fail-closed). Read in the owner-change transaction, the node row FOR SHARE. Returns null when allowed, else the refusal text.
 * A missing device ⇒ "not found" (thrown as such). Transfers back to central (toEdgeNodeId null) are never gated by this.
 */
async function ownerFactoryRefusal(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, kind: DeviceKind, deviceId: number, nodeId: number): Promise<string | null> {
  let node: Array<Record<string, unknown>>;
  let dev: Array<Record<string, unknown>>;
  try {
    node = rowsOf(await tx.execute(sql`SELECT "factoryCode" FROM public.edge_nodes WHERE id = ${nodeId} FOR SHARE`));
    dev = rowsOf(
      kind === "robot"
        ? await tx.execute(sql`SELECT f.code AS "factoryCode" FROM public.robots r
            LEFT JOIN public.stations s ON s.id = r."stationId"
            LEFT JOIN public.production_lines l ON l.id = COALESCE(s."lineId", r."lineId")
            LEFT JOIN public.workshops w ON w.id = l."workshopId"
            LEFT JOIN public.factories f ON f.id = w."factoryId"
            WHERE r.id = ${deviceId}`)
        : await tx.execute(sql`SELECT f.code AS "factoryCode" FROM public.device_adapters a
            LEFT JOIN public.machines m ON m.id = a."machineId"
            LEFT JOIN public.stations s ON s.id = m."stationId"
            LEFT JOIN public.production_lines l ON l.id = s."lineId"
            LEFT JOIN public.workshops w ON w.id = l."workshopId"
            LEFT JOIN public.factories f ON f.id = w."factoryId"
            WHERE a.id = ${deviceId}`),
    );
  } catch (err) {
    return `the factory of ${kind} ${deviceId} / edge node ${nodeId} could not be read (${errText(err)}) — refused (fail-closed)`;
  }
  if (dev.length === 0) throw Object.assign(new Error("device not found"), { notFound: true });
  if (node.length === 0) return `edge node ${nodeId} not found — refused`;
  const nodeFactory = typeof node[0].factoryCode === "string" ? node[0].factoryCode.trim() : "";
  const devFactory = typeof dev[0].factoryCode === "string" ? dev[0].factoryCode.trim() : "";
  if (!nodeFactory) return `edge node ${nodeId} has no factoryCode — a device is handed only to a node of its own factory`;
  if (!devFactory) return `${kind} ${deviceId} has no factory (station / line / workshop chain incomplete) — refused`;
  if (nodeFactory !== devFactory) return `${kind} ${deviceId} belongs to factory ${devFactory}; edge node ${nodeId} serves factory ${nodeFactory} — refused`;
  return null;
}

export async function changeDeviceOwner(a: { kind: DeviceKind; deviceId: number; toEdgeNodeId: number | null; actorUserId: number; actorName: string }): Promise<ChangeOwnerResult> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "unavailable", detail: "database unavailable" };
  const { setEdgeOwnershipActor, isEdgeControlRefusal } = await import("../edge/edgeControlSchema");
  let epoch: number;
  try {
    epoch = await db.transaction(async (tx) => {
      await setEdgeOwnershipActor(tx, `${a.actorName} (#${a.actorUserId})`);
      if (a.toEdgeNodeId !== null) {
        const refusal = await ownerFactoryRefusal(tx, a.kind, a.deviceId, a.toEdgeNodeId); // R-10-am
        if (refusal) throw Object.assign(new Error(refusal), { factoryRefusal: true });
      }
      const r = rowsOf(
        a.kind === "robot"
          ? await tx.execute(sql`UPDATE public.robots SET "edgeNodeId" = ${a.toEdgeNodeId} WHERE id = ${a.deviceId} RETURNING "ownerEpoch"`)
          : await tx.execute(sql`UPDATE public.device_adapters SET "edgeNodeId" = ${a.toEdgeNodeId} WHERE id = ${a.deviceId} RETURNING "ownerEpoch"`),
      );
      if (r.length === 0) throw Object.assign(new Error("device not found"), { notFound: true });
      // R-10-v — every replica applies it (delivered at COMMIT only)
      await tx.execute(sql`SELECT pg_notify(${DEVICE_OWNER_CHANNEL}, ${JSON.stringify({ kind: a.kind, id: a.deviceId, to: a.toEdgeNodeId, epoch: Number(r[0].ownerEpoch) })})`);
      return Number(r[0].ownerEpoch);
    });
  } catch (err) {
    if ((err as { factoryRefusal?: boolean }).factoryRefusal) return { ok: false, reason: "refused", detail: errText(err) };
    if ((err as { notFound?: boolean }).notFound) return { ok: false, reason: "not_found", detail: `${a.kind} ${a.deviceId} not found` };
    // fix review 4 — the DB guard's own reason (drizzle wraps it as "Failed query: …" with the PostgresError as cause)
    if (isEdgeControlRefusal(err)) return { ok: false, reason: "refused", detail: errText((err as { cause?: unknown }).cause ?? err) };
    return { ok: false, reason: "unavailable", detail: errText(err) };
  }
  // L-7 — the owed STOP first (it never waits for the session attach); then the live session change in this process
  const centralStops = a.toEdgeNodeId === null ? await executePendingCentralStops(a.kind, a.deviceId, a.actorUserId) : null;
  await applyOwnershipLocally(a.kind, a.deviceId, a.toEdgeNodeId);
  return { ok: true, ownerEpoch: epoch, toEdgeNodeId: a.toEdgeNodeId, centralStops };
}

/** R-10-i / R-10-w — the owed STOPs of ONE device (null: none pending, or another replica holds them now). Never throws. */
export async function executePendingCentralStops(kind: DeviceKind, deviceId: number, actorUserId: number | null): Promise<CentralStopOutcome | null> {
  const out = await sweepPendingCentralStops({ device: { kind, id: deviceId }, actorUserId });
  return out[0] ?? null;
}

/**
 * R-10-w — THE sweep of device_pending_stops where centralMustExecute (every device, or one). The pending-set read failing ⇒ for a
 * named device the STOP is sent anyway + alert; for the global sweep it is logged (the next pass retries). Never throws.
 */
export async function sweepPendingCentralStops(opts: { device?: { kind: DeviceKind; id: number }; actorUserId?: number | null } = {}): Promise<CentralStopOutcome[]> {
  const results: CentralStopOutcome[] = [];
  let devices: Array<{ kind: DeviceKind; id: number }>;
  try {
    const db = await getDb();
    if (!db) throw new DbUnavailableError("database unavailable (pending STOP devices)");
    if (opts.device) devices = [opts.device];
    else {
      const rows = rowsOf(await withDeadline(db.execute(sql`SELECT DISTINCT "robotId", "adapterId" FROM public.device_pending_stops WHERE "centralMustExecute" AND outcome IS NULL`), 5 * STOP_DB_STEP_DEADLINE_MS, "pending STOP devices"));
      devices = rows.map((r) => (r.robotId != null ? { kind: "robot" as const, id: Number(r.robotId) } : { kind: "adapter" as const, id: Number(r.adapterId) }));
    }
  } catch (err) {
    if (opts.device) {
      const sent = await sendCentralStop(opts.device.kind, opts.device.id);
      const notSent = sent.sent === "simulated"; // fix review 6 (NF5-5)
      void raiseCentralStopAlert(opts.device.kind, opts.device.id, opts.actorUserId ? [opts.actorUserId] : [], notSent ? `pending STOP requests could not be read (${errText(err)}) and the STOP was NOT SENT: central control is off (${sent.detail}) — stop the equipment on site (hardware E-STOP)` : `pending STOP requests could not be read (${errText(err)}); a STOP was ${sent.sent} anyway`);
      return [{ requestIds: [], outcome: sent.ok && sent.sent === "sent" ? "done" : "failed", sent: sent.sent, detail: sent.detail, ackErrors: [], ...(notSent ? { notSent: true as const } : {}) }];
    }
    // final fix wave (M-2) — a DB without 0374 (the new build deployed before the migrations) is said ONCE, not every 10 s
    const { isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
    if (!isEdgeControlSchemaMissing(err)) console.error(`[DeviceOwner] pending-STOP sweep could not read device_pending_stops: ${errText(err)}`);
    else if (!pendingSchemaMissingLogged) {
      pendingSchemaMissingLogged = true;
      console.warn(`[DeviceOwner] pending-STOP sweep: device_pending_stops is not there (migration 0374 not applied yet) — retried silently every pass until it is: ${errText(err)}`);
    }
    return results;
  }
  pendingSchemaMissingLogged = false;
  if (!opts.device) {
    // R-11-k (4) — a device with no pending STOP left ends its busy episode (a later episode alerts again)
    const live = new Set(devices.map((d) => `${d.kind}:${d.id}`));
    for (const k of [...busyEpisodeAlerted.keys()]) if (!live.has(k)) busyEpisodeAlerted.delete(k);
  }
  for (const dev of devices) {
    const r = await executeDeviceStopsLocked(dev.kind, dev.id, opts.actorUserId ?? null, opts.device !== undefined);
    if (r) results.push(r);
  }
  return results;
}

async function executeDeviceStopsLocked(kind: DeviceKind, deviceId: number, actorUserId: number | null, deviceScoped = false): Promise<CentralStopOutcome | null> {
  // fix review 2 (N4) — for a NAMED device (a transfer just made here), not knowing the pending set never means "no STOP": the
  // STOP is sent anyway and alerted (the periodic sweep acks the requests later). The global sweep just retries next pass.
  // fix 1 (H-R1): `force` — the device row lock was not obtained within its bound: the STOP is sent for the global sweep too
  const sendAnyway = async (why: string, force = false): Promise<CentralStopOutcome | null> => {
    if (!deviceScoped && !force) {
      console.error(`[DeviceOwner] pending-STOP execution for ${kind} ${deviceId} failed: ${why} (the next sweep retries)`);
      return null;
    }
    const sent = await sendCentralStop(kind, deviceId);
    // fix review 6 (NF5-5) — a simulated STOP (central control off) is NOT done: reported failed + notSent, and said so
    const notSent = sent.sent === "simulated";
    // R-11-k (4) — the global sweep's busy-device branch: the STOP above is sent every pass; the alert once per lock episode
    const episodeKey = `${kind}:${deviceId}`;
    const repeat = force && !deviceScoped && busyEpisodeAlerted.get(episodeKey) === sent.sent;
    if (force && !deviceScoped) busyEpisodeAlerted.set(episodeKey, sent.sent);
    if (!repeat) void raiseCentralStopAlert(kind, deviceId, actorUserId ? [actorUserId] : [], notSent ? `the pending STOP requests could not be read/locked (${why}) and the STOP was NOT SENT: central control is off (${sent.detail}) — stop the equipment on site (hardware E-STOP)` : `the pending STOP requests could not be read/locked (${why}); a STOP was ${sent.sent} anyway (${sent.detail}) — the requests are acknowledged by the next sweep`);
    return { requestIds: [], outcome: sent.ok && sent.sent === "sent" ? "done" : "failed", sent: sent.sent, detail: sent.detail, ackErrors: [], ...(notSent ? { notSent: true as const } : {}) };
  };
  const db = await getDb().catch(() => null);
  if (!db) return sendAnyway("database unavailable");
  let outcome: CentralStopOutcome | null = null;
  let recipients: number[] = [];
  let picked = false;
  /** R-10-ay — requests central executes because the device's EDGE owner answered notOwnedHere (it cannot list the device) */
  let cannotList: number[] = [];
  let notSentAlert = false;
  let deviceBusy = false;
  try {
    await db.transaction(async (tx) => {
      const pick =
        kind === "robot"
          ? sql`SELECT q.id, q."requestedBy", (SELECT bool_or(v."ownerCannotList") FROM public.device_pending_stops v WHERE v."requestId" = q.id) AS "cannotList" FROM public.robot_motion_lock_requests q
                 WHERE q.id IN (SELECT "requestId" FROM public.device_pending_stops WHERE "robotId" = ${deviceId} AND "centralMustExecute")
                   AND q."ackedAt" IS NULL ORDER BY q.id FOR UPDATE OF q SKIP LOCKED`
          : sql`SELECT q.id, q."requestedBy", (SELECT bool_or(v."ownerCannotList") FROM public.device_pending_stops v WHERE v."requestId" = q.id) AS "cannotList" FROM public.robot_motion_lock_requests q
                 WHERE q.id IN (SELECT "requestId" FROM public.device_pending_stops WHERE "adapterId" = ${deviceId} AND "centralMustExecute")
                   AND q."ackedAt" IS NULL ORDER BY q.id FOR UPDATE OF q SKIP LOCKED`;
      // doc 81 Đợt 11 task H (mig 0377, one lock order): the DEVICE row FOR SHARE before its request rows — an owner change locks
      // device → requests, and edge_stop_ack_central below takes the device; holding the requests while waiting for the device
      // deadlocked with it (40P01). FOR SHARE waits only on a writer of that row (the bounded owner change / a status write).
      // fix 1 (review H-R1, L-7): bounded by the SERVER (lock_timeout ⇒ 55P03), never by a JS deadline alone
      await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${CENTRAL_STOP_DEVICE_LOCK_TIMEOUT_MS}ms'`));
      try {
        await withDeadline(
          tx.execute(kind === "robot" ? sql`SELECT 1 FROM public.robots WHERE id = ${deviceId} FOR SHARE` : sql`SELECT 1 FROM public.device_adapters WHERE id = ${deviceId} FOR SHARE`),
          5 * STOP_DB_STEP_DEADLINE_MS,
          "pending STOP device lock",
        );
      } catch (err) {
        if (isLockNotAvailable(err)) deviceBusy = true;
        throw err;
      }
      await tx.execute(sql`SET LOCAL lock_timeout TO DEFAULT`);
      busyEpisodeAlerted.delete(`${kind}:${deviceId}`); // R-11-k (4) — the device row lock was obtained: its busy episode (if any) ended
      const pending = rowsOf(await withDeadline(tx.execute(pick), 5 * STOP_DB_STEP_DEADLINE_MS, "pending STOP pick")).map((r) => ({ requestId: Number(r.id), requestedBy: Number(r.requestedBy), cannotList: r.cannotList === true }));
      picked = true;
      if (pending.length === 0) return;
      const sent = await sendCentralStop(kind, deviceId);
      // fix review 5 (R-10-bd) — "simulated" (central control OFF / dry-run) is NOT a STOP: the attempt is recorded NOT sent, the
      // requests stay PENDING (never acked done — their owner / a person still has to act) and a truthful alert is raised (rate-limited)
      if (sent.sent === "simulated") {
        const key = `${kind}:${deviceId}`;
        if (rateLimited(notSentRecorded, key, NOT_SENT_RECORD_EVERY_MS)) {
          outcome = { requestIds: pending.map((p) => p.requestId), outcome: "failed", sent: "simulated", detail: sent.detail, ackErrors: [], notSent: true };
          return;
        }
        try {
          await tx.transaction(async (sp) => recordCentralStopAttempt(sp, { kind, deviceId, ok: false, detail: `NOT SENT — central control is off (${sent.detail})` }));
        } catch (err) {
          console.error(`[DeviceOwner] the not-sent central STOP attempt on ${kind} ${deviceId} could not be recorded: ${errText(err)}`);
        }
        outcome = { requestIds: pending.map((p) => p.requestId), outcome: "failed", sent: "simulated", detail: sent.detail, ackErrors: [], notSent: true };
        recipients = [...new Set(pending.map((p) => p.requestedBy).concat(actorUserId ? [actorUserId] : []))];
        cannotList = pending.filter((p) => p.cannotList).map((p) => p.requestId);
        notSentAlert = true;
        return;
      }
      const result: "done" | "failed" = sent.ok && sent.sent === "sent" ? "done" : "failed";
      const ackErrors: number[] = [];
      // R-10-ba — the attempt is recorded ONCE (WORM evidence), then every pending request is acked against it
      let executionId: number | null = null;
      try {
        executionId = await tx.transaction(async (sp) => recordCentralStopAttempt(sp, { kind, deviceId, ok: result === "done", detail: `${sent.sent}: ${sent.detail}` }));
      } catch (err) {
        console.error(`[DeviceOwner] the central STOP attempt on ${kind} ${deviceId} (${sent.sent}) could not be recorded — its requests stay pending: ${errText(err)}`);
      }
      for (const p of pending) {
        try {
          if (executionId === null) throw new CentralStopNotRecordedError(p.requestId);
          const ex = executionId;
          await tx.transaction(async (sp) => ackStopExecutedCentrally(sp, { requestId: p.requestId, outcome: result, executionId: ex }));
        } catch (err) {
          ackErrors.push(p.requestId);
          console.error(`[DeviceOwner] STOP request #${p.requestId} (${kind} ${deviceId}) was ${sent.sent} but its acknowledgement failed — it stays pending: ${errText(err)}`);
        }
      }
      outcome = { requestIds: pending.map((p) => p.requestId), outcome: result, sent: sent.sent, detail: sent.detail, ackErrors };
      recipients = [...new Set(pending.map((p) => p.requestedBy).concat(actorUserId ? [actorUserId] : []))];
      cannotList = pending.filter((p) => p.cannotList).map((p) => p.requestId);
    });
  } catch (err) {
    // fix 1 (H-R1): the device row was held beyond its bound ⇒ the STOP is SENT now (named device AND global sweep); the
    // requests stay pending — the next sweep records the attempt and acks them
    if (!picked) return sendAnyway(deviceBusy ? `the device row was busy beyond ${CENTRAL_STOP_DEVICE_LOCK_TIMEOUT_MS} ms (${errText(err)})` : errText(err), deviceBusy);
    console.error(`[DeviceOwner] pending-STOP execution for ${kind} ${deviceId} failed after the STOP: ${errText(err)}`);
  }
  const o = outcome as CentralStopOutcome | null;
  if (o && notSentAlert) {
    void raiseCentralStopAlert(kind, deviceId, recipients, `the STOP was NOT SENT: central control is off (${o.detail}) — requests ${o.requestIds.map((i) => `#${i}`).join(", ")} stay PENDING${cannotList.length > 0 ? " (its edge owner cannot list the device)" : ""}. Stop the equipment on site (hardware E-STOP) or enable central control`);
    return o;
  }
  if (o?.notSent) return o; // rate-limited repeat of the not-sent case (recorded + alerted within the last window)
  // fix review 5 (NF4-5 b) — the cannot-list alert is rate-limited per device (it used to repeat on every ≤ 10 s pass)
  if (o && cannotList.length > 0 && !rateLimited(cannotListAlerted, `${kind}:${deviceId}`, CANNOT_LIST_ALERT_EVERY_MS)) {
    // fix review 4 (R-10-ay, L-7) — central executed the STOP of a device its EDGE owner cannot list: always a durable alert
    void raiseEdgeCannotListAlert(kind, deviceId, recipients, `edge owner cannot list ${kind} ${deviceId}: its owner answered "notOwnedHere" to STOP request(s) ${cannotList.map((i) => `#${i}`).join(", ")}; central executed the STOP on a transient session (${o.outcome}: ${o.detail}). Fix the device's factory / line assignment or move its ownership.`);
  }
  if (o && (o.outcome === "failed" || o.ackErrors.length > 0)) {
    void raiseCentralStopAlert(
      kind,
      deviceId,
      recipients,
      o.outcome === "failed"
        ? `the STOP owed after the transfer to central could NOT be sent (${o.detail}) — requests ${o.requestIds.map((i) => `#${i}`).join(", ")} marked failed`
        : `the STOP was sent but requests ${o.ackErrors.map((i) => `#${i}`).join(", ")} could not be acknowledged`,
    );
  }
  return o;
}

/** The console / sweep STOP of a robot through central's path (its session, else a transient one, bounded). Never throws. */
export async function sendCentralRobotStop(
  robotId: number,
  /** fix review 4 (NF-2) — the robot row read the caller STARTED already (in parallel with its owner read, one bound) */
  pre?: { row?: Promise<import("./robotStopRow").RobotStopRowRead> },
): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  try {
    return await sendRobotStop(robotId, pre?.row);
  } catch (err) {
    return { ok: false, sent: "failed", detail: errText(err) };
  }
}

/** One STOP to the device through central's path. Never throws. */
async function sendCentralStop(kind: DeviceKind, deviceId: number): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  try {
    return kind === "robot" ? await sendRobotStop(deviceId) : await sendAdapterStop(deviceId);
  } catch (err) {
    return { ok: false, sent: "failed", detail: errText(err) };
  }
}

async function sendRobotStop(robotId: number, prefetched?: Promise<import("./robotStopRow").RobotStopRowRead>): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  const { getActiveRobot } = await import("./robotManager");
  if (getActiveRobot(robotId)) {
    const { dispatchRobotJob } = await import("./robotCommandDispatcher");
    const r = await dispatchRobotJob({ robotId, job: { jobType: "abort", params: {} }, triggerKind: "manual", requestedBy: 0, confirmedBy: 0, idempotencyKey: undefined });
    return r.ok ? { ok: true, sent: r.status === "simulated" ? "simulated" : "sent", detail: `robot_jobs #${r.jobId ?? "?"} ${r.status}` } : { ok: false, sent: "failed", detail: r.error ?? r.status };
  }
  // no session (central skipped the robot while an edge owned it): a transient one, bounded
  if (process.env.ROBOT_CONTROL_ENABLED !== "true") return { ok: true, sent: "simulated", detail: "dry-run (ROBOT_CONTROL_ENABLED off) — nothing sent" };
  // R-10-ak — the row read before the send is bounded by the STOP bound; unreadable ⇒ failed (the caller alerts)
  // NF-2 — one bounded read (prefetched by the console at request entry, in parallel with its owner read)
  const { prefetchRobotStopRow } = await import("./robotStopRow");
  const read = await (prefetched ?? prefetchRobotStopRow(robotId));
  if (!read.ok) {
    return { ok: false, sent: "failed", detail: `NO STOP WAS SENT: no session here and the robot's connection settings could not be read (${read.error}) — no session could be opened (documented limit: a no-session STOP needs the DB)` };
  }
  const row = read.row;
  if (!row) return { ok: false, sent: "failed", detail: "robot row not found" };
  const { createRobotDriver } = await import("./driverRegistry");
  const { runRobotDeviceStage } = await import("./robotDeviceRun");
  const driver = createRobotDriver(row.vendor as never);
  const work = (async () => {
    await driver.connect({ endpoint: row.endpoint, options: (row.connectionOptions ?? undefined) as Record<string, unknown> | undefined });
    try {
      return await runRobotDeviceStage({ robotId, driver, job: { jobType: "abort", params: {} }, motion: false, timeoutMs: Math.max(1000, Number(process.env.ROBOT_CONTROL_TIMEOUT_MS) || 10_000) });
    } finally {
      await driver.disconnect().catch(() => undefined);
    }
  })();
  const st = await withDeadline(work, sessionDeadlineMs, `robot ${robotId} transient STOP session`);
  return st.status === "done" ? { ok: true, sent: "sent", detail: "abort sent on a transient session" } : { ok: false, sent: "failed", detail: st.errorText ?? "abort not confirmed" };
}

/**
 * doc 81 Đợt 10 final fix wave (I-4, R-10-ay) — central's fallback STOP of an adapter (its PINNED stop values; the running driver,
 * else a transient session, bounded) for the OT dispatcher when a STOP for an EDGE-owned adapter could not be queued. Never throws.
 */
export async function sendCentralAdapterStop(adapterId: number): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  try {
    return await sendAdapterStop(adapterId);
  } catch (err) {
    return { ok: false, sent: "failed", detail: errText(err) };
  }
}

async function sendAdapterStop(adapterId: number): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  const db = await getDb();
  if (!db) return { ok: false, sent: "failed", detail: "database unavailable (stop pins)" };
  const { loadStopPins } = await import("../ot/stopPin");
  const pins = await loadStopPins(db, adapterId);
  if (pins.length === 0) return { ok: false, sent: "failed", detail: "the adapter has no pinned stop tag — a software STOP is not possible; use the hardware E-STOP" };
  if (process.env.OT_CONTROL_ENABLED !== "true") return { ok: true, sent: "simulated", detail: "dry-run (OT_CONTROL_ENABLED off) — nothing written" };
  const { deviceTags } = await import("../../../drizzle/schema");
  const tagRows = await db.select().from(deviceTags).where(eq(deviceTags.adapterId, adapterId));
  const resolved = pins.map((p) => {
    const t = tagRows.find((x) => x.tagKey === p.tagKey)!;
    return { write: { tagKey: p.tagKey, value: p.value }, address: t.address, dataType: t.dataType ?? undefined, scale: t.scale != null ? Number(t.scale) : undefined, offset: t.offset != null ? Number(t.offset) : undefined };
  });
  const { getActiveDriver } = await import("../ot/otManager");
  const { executeOtDeviceWrite } = await import("../ot/otDeviceWrite");
  const { NO_CONFIRMER } = await import("../ot/commandDispatcher");
  const write = (driver: Parameters<typeof executeOtDeviceWrite>[0]["driver"]) =>
    executeOtDeviceWrite({
      input: { adapterId, machineId: null, commandType: "stop", writes: resolved.map((r) => r.write), triggeredBy: { kind: "hitl", requestedBy: NO_CONFIRMER }, idempotencyKey: `owner-transfer-stop:${adapterId}:${Date.now()}` },
      driver,
      resolved,
      driverWrites: resolved.map((r) => ({ tagKey: r.write.tagKey, address: r.address, value: r.write.value, dataType: r.dataType as never, scale: r.scale, offset: r.offset })),
      timeoutMs: Number(process.env.OT_CONTROL_TIMEOUT_MS ?? 5000) || 5000,
      stopTyped: true,
      ledger: { intentIds: [], confirmedBy: NO_CONFIRMER },
    });
  const running = getActiveDriver(adapterId);
  let executed: Awaited<ReturnType<typeof executeOtDeviceWrite>>;
  if (running) executed = await write(running);
  else {
    const { loadEnabledAdapters } = await import("../ot/deviceAdapter");
    // R-10-ay — the adapter may be EDGE-owned (its owner cannot list it): central's transient STOP loads it anyway
    const a = (await loadEnabledAdapters({ includeEdgeOwned: true })).find((x) => x.adapterId === adapterId);
    if (!a) return { ok: false, sent: "failed", detail: "the adapter is not enabled / not loadable — no session to send the STOP" };
    const { createDriver } = await import("../ot/driverRegistry");
    const driver = createDriver(a.protocol);
    const work = (async () => {
      await driver.connect(a.connection);
      try {
        return await write(driver);
      } finally {
        await driver.disconnect().catch(() => undefined);
      }
    })();
    executed = await withDeadline(work, sessionDeadlineMs, `adapter ${adapterId} transient STOP session`);
  }
  const allOk = executed.outcomes.length > 0 && executed.outcomes.every((o) => o.ok);
  return allOk ? { ok: true, sent: "sent", detail: `pinned stop written (${pins.map((p) => p.tagKey).join(", ")})` } : { ok: false, sent: "failed", detail: executed.timedOut ? "pinned stop write timed out" : "pinned stop write failed" };
}

/**
 * doc 81 Đợt 10 task D fix review 4 (R-10-ba, A fix round 9 pending) — THE one place the sweep acknowledges a STOP central executed:
 * A's round 9: the sweep RECORDS its central STOP attempt (edge_stop_record_central_execution, WORM, executor
 * 'central-stop-sweep') and acks each request against that execution id (edge_stop_ack_central(request, outcome, execution)) —
 * adopted HERE only. Users never ack (a person closes a STOP via
 * edge_stop_resolve).
 */
async function recordCentralStopAttempt(tx: unknown, a: { kind: DeviceKind; deviceId: number; ok: boolean; detail: string }): Promise<number> {
  const { recordCentralStopExecution } = await import("../edge/edgeControlSchema");
  return recordCentralStopExecution(tx as never, a);
}
async function ackStopExecutedCentrally(tx: unknown, a: { requestId: number; outcome: "done" | "failed"; executionId: number }): Promise<void> {
  const { ackCentralStop } = await import("../edge/edgeControlSchema");
  await ackCentralStop(tx as never, a);
}

/** fix review 5 — per-key rate limit (true = already done within `everyMs`; otherwise marks it now). */
const notSentRecorded = new Map<string, number>();
const cannotListAlerted = new Map<string, number>();
export const NOT_SENT_RECORD_EVERY_MS = 10 * 60_000;
export const CANNOT_LIST_ALERT_EVERY_MS = 10 * 60_000;
function rateLimited(m: Map<string, number>, key: string, everyMs: number): boolean {
  const last = m.get(key);
  if (last !== undefined && Date.now() - last < everyMs) return true;
  m.set(key, Date.now());
  return false;
}
/** Test seam. */
export function _resetSweepRateLimitsForTests(): void {
  notSentRecorded.clear();
  cannotListAlerted.clear();
}

/** R-10-ba — a request is never acked without a recorded central STOP execution. */
class CentralStopNotRecordedError extends Error {
  constructor(requestId: number) {
    super(`no recorded central STOP execution for request #${requestId} — it stays pending`);
    this.name = "CentralStopNotRecordedError";
  }
}

/** R-10-ay — "edge owner cannot list device X" (durable, critical). */
function raiseEdgeCannotListAlert(kind: DeviceKind, deviceId: number, recipients: number[], message: string): Promise<void> {
  return import("./criticalStopAlert").then(({ raiseCriticalStopAlert }) =>
    raiseCriticalStopAlert({
      kind: "edge_owner_cannot_list",
      title: `Edge owner cannot list ${kind} ${deviceId}`,
      message,
      recipients,
      dedupKey: `edge_owner_cannot_list:${kind}:${deviceId}:${Date.now()}`,
      source: kind === "robot" ? "robot" : "ot",
      entityType: kind === "robot" ? "robot" : "ot_command",
      entityId: deviceId,
      retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
    }),
  );
}

/** Durable CRITICAL operator alert (criticalStopAlert: alert stream + safety-critical inbox). */
function raiseCentralStopAlert(kind: DeviceKind, deviceId: number, recipients: number[], what: string): Promise<void> {
  return import("./criticalStopAlert").then(({ raiseCriticalStopAlert }) =>
    raiseCriticalStopAlert({
      kind: "central_stop_after_transfer",
      title: `STOP owed after transfer — ${kind} ${deviceId}`,
      message: `STOP owed to ${kind} ${deviceId} after its ownership moved to central: ${what}. Check the equipment on site now.`,
      recipients,
      dedupKey: `central_stop_after_transfer:${kind}:${deviceId}`,
      source: kind === "robot" ? "robot" : "ot",
      entityType: kind === "robot" ? "robot" : "ot_command",
      entityId: deviceId,
    }),
  );
}

// ── R-10-v — live application of ownership (this process + other replicas) ──────────────────────────────────────────

/** Attach / detach this process's central session of the device. Never throws. */
export async function applyOwnershipLocally(kind: DeviceKind, deviceId: number, toEdgeNodeId: number | null): Promise<void> {
  try {
    if (kind === "robot") {
      const m = await import("./robotManager");
      if (toEdgeNodeId === null) await m.attachRobot(deviceId);
      else await m.detachRobot(deviceId);
    } else {
      const m = await import("../ot/otManager");
      if (toEdgeNodeId === null) {
        if (!m.isOtGatewayOn() || m.getActiveAdapter(deviceId)) return;
        const { loadEnabledAdapters } = await import("../ot/deviceAdapter");
        const a = (await loadEnabledAdapters()).find((x) => x.adapterId === deviceId);
        if (a) await m.attachOtAdapter(a);
      } else await m.detachOtAdapter(deviceId);
    }
  } catch (err) {
    console.error(`[DeviceOwner] applying the new owner of ${kind} ${deviceId} in this process failed (the reconcile retries): ${errText(err)}`);
  }
}

/** The owner epoch of each enabled device at the last reconcile pass. */
const seenEpoch = { robot: new Map<number, number>(), adapter: new Map<number, number>() };
/**
 * doc 81 Đợt 12 N fix 1 (M-3) — robots whose attach THIS reconcile tried and that FAILED (e.g. released from an edge while its
 * driver could not connect): retried on every later pass while still central-owned, enabled and without a session — no restart
 * needed (its persisted ownerChanged lock becomes live — shown + clearable — once attached). Dropped when it succeeds, goes to an
 * edge or is disabled. (A robot that only failed at BOOT is still not retried here.)
 */
const robotAttachRetry = new Set<number>();
/** Test seam. */
export function _resetOwnershipReconcileForTests(): void {
  robotAttachRetry.clear();
  seenEpoch.robot.clear();
  seenEpoch.adapter.clear();
  busyEpisodeAlerted.clear();
}

/**
 * R-10-v backstop — this process's sessions vs the ownership columns: a session to an EDGE-owned device is detached; a
 * central-owned enabled device whose owner epoch CHANGED since the last pass and has no session here is attached. A device that
 * only failed to connect at boot (epoch unchanged) is not retried by this. Never throws.
 */
export async function reconcileDeviceOwnership(): Promise<{ attached: string[]; detached: string[] }> {
  const out = { attached: [] as string[], detached: [] as string[] };
  try {
    const db = await getDb();
    if (!db) return out;
    const robotRows = rowsOf(await db.execute(sql`SELECT id, "edgeNodeId", "ownerEpoch" FROM public.robots WHERE "isEnabled" = true`));
    const adapterRows = rowsOf(await db.execute(sql`SELECT id, "edgeNodeId", "ownerEpoch" FROM public.device_adapters WHERE "isEnabled" = true`));
    const rm = await import("./robotManager");
    const om = await import("../ot/otManager");
    const activeRobots = new Set(rm.activeRobotIds());
    // M-3 — a robot no longer listed (disabled / deleted) leaves the retry set
    const listed = new Set(robotRows.map((r) => Number(r.id)));
    for (const id of [...robotAttachRetry]) if (!listed.has(id)) robotAttachRetry.delete(id);
    for (const r of robotRows) {
      const id = Number(r.id);
      const ep = Number(r.ownerEpoch);
      const prev = seenEpoch.robot.get(id);
      // fix review 4 (NF-3) — epochs are only SEEN while the gateway is on: a pass that ran before startRobots / startOt never
      // turns the first-pass rule ("not tried at start ⇒ attach") off for the pass after the gateway came on
      if (rm.isCentralRobotGatewayOn()) seenEpoch.robot.set(id, ep);
      if (r.edgeNodeId != null) robotAttachRetry.delete(id); // M-3 — an edge's now
      if (r.edgeNodeId != null && activeRobots.has(id)) {
        if (await rm.detachRobot(id)) out.detached.push(`robot:${id}`);
      } else if (
        r.edgeNodeId == null &&
        !activeRobots.has(id) &&
        (robotAttachRetry.has(id) || (prev !== undefined ? prev !== ep : rm.isCentralRobotGatewayOn() && !rm.robotTriedAtStart(id)))
      ) {
        if (await rm.attachRobot(id)) {
          robotAttachRetry.delete(id);
          out.attached.push(`robot:${id}`);
        } else if (rm.isCentralRobotGatewayOn()) robotAttachRetry.add(id); // M-3 — retried on the next pass
      } else if (activeRobots.has(id)) robotAttachRetry.delete(id);
    }
    for (const a of adapterRows) {
      const id = Number(a.id);
      const ep = Number(a.ownerEpoch);
      const prev = seenEpoch.adapter.get(id);
      if (om.isOtGatewayOn()) seenEpoch.adapter.set(id, ep); // NF-3 — see above
      const has = om.getActiveAdapter(id) !== undefined;
      if (a.edgeNodeId != null && has) {
        if (await om.detachOtAdapter(id)) out.detached.push(`adapter:${id}`);
      } else if (a.edgeNodeId == null && !has && (prev !== undefined ? prev !== ep : om.isOtGatewayOn() && !om.otAdapterTriedAtStart(id))) {
        await applyOwnershipLocally("adapter", id, null);
        if (om.getActiveAdapter(id) !== undefined) out.attached.push(`adapter:${id}`);
      }
    }
  } catch (err) {
    const { isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
    if (!isEdgeControlSchemaMissing(err)) console.error(`[DeviceOwner] ownership reconcile failed: ${errText(err)}`);
  }
  return out;
}

/**
 * doc 81 Đợt 10 task D fix review 4 (R-10-ay) — the ROOT CAUSE of "edge owner cannot list device X": the device's factory (robot:
 * COALESCE(station line, robot line) → workshop → factory; adapter: machine → station → line → workshop → factory) no longer
 * matches its EDGE owner's factoryCode (moved / cleared after R-10-am's check at transfer time). Each mismatch is a durable critical
 * alert, ONCE per (device, owner, device factory, node factory) in this process. Runs with the ownership reconcile. Never throws.
 */
const factoryDriftAlerted = new Set<string>();
export async function checkEdgeOwnedFactoryDrift(): Promise<Array<{ kind: DeviceKind; id: number; edgeNodeId: number; deviceFactory: string | null; nodeFactory: string | null }>> {
  const out: Array<{ kind: DeviceKind; id: number; edgeNodeId: number; deviceFactory: string | null; nodeFactory: string | null }> = [];
  try {
    const db = await getDb();
    if (!db) return out;
    const rows = rowsOf(
      await withDeadline(
        db.execute(sql`
          SELECT 'robot' AS kind, r.id, r."edgeNodeId", n."factoryCode" AS "nodeFactory", f.code AS "deviceFactory", true AS "factoryDrift"
            FROM public.robots r JOIN public.edge_nodes n ON n.id = r."edgeNodeId"
            LEFT JOIN public.stations s ON s.id = r."stationId"
            LEFT JOIN public.production_lines l ON l.id = COALESCE(s."lineId", r."lineId")
            LEFT JOIN public.workshops w ON w.id = l."workshopId"
            LEFT JOIN public.factories f ON f.id = w."factoryId"
           WHERE f.code IS NULL OR NULLIF(btrim(n."factoryCode"), '') IS NULL OR f.code <> btrim(n."factoryCode")
          UNION ALL
          SELECT 'adapter', a.id, a."edgeNodeId", n."factoryCode", f.code, true
            FROM public.device_adapters a JOIN public.edge_nodes n ON n.id = a."edgeNodeId"
            LEFT JOIN public.machines m ON m.id = a."machineId"
            LEFT JOIN public.stations s ON s.id = m."stationId"
            LEFT JOIN public.production_lines l ON l.id = s."lineId"
            LEFT JOIN public.workshops w ON w.id = l."workshopId"
            LEFT JOIN public.factories f ON f.id = w."factoryId"
           WHERE f.code IS NULL OR NULLIF(btrim(n."factoryCode"), '') IS NULL OR f.code <> btrim(n."factoryCode")`),
        5 * STOP_DB_STEP_DEADLINE_MS,
        "edge-owned factory drift",
      ),
    );
    let recipients: number[] | null = null;
    // fix review 5 (NF4-5 a) — a drift that CLEARED re-arms: a new drift of that device alerts again
    const nowDrifting = new Set(rows.filter((r) => r.factoryDrift === true).map((r) => `${r.kind === "adapter" ? "adapter" : "robot"}:${Number(r.id)}:`));
    for (const k of [...factoryDriftAlerted]) if (![...nowDrifting].some((p) => k.startsWith(p))) factoryDriftAlerted.delete(k);
    for (const r of rows) {
      if (r.factoryDrift !== true) continue;
      const d = { kind: (r.kind === "adapter" ? "adapter" : "robot") as DeviceKind, id: Number(r.id), edgeNodeId: Number(r.edgeNodeId), deviceFactory: (r.deviceFactory as string | null) ?? null, nodeFactory: (r.nodeFactory as string | null) ?? null };
      out.push(d);
      const key = `${d.kind}:${d.id}:${d.edgeNodeId}:${d.deviceFactory}:${d.nodeFactory}`;
      if (factoryDriftAlerted.has(key)) continue;
      factoryDriftAlerted.add(key);
      // durable = an inbox row for the people who can act (active admins / supervisors)
      recipients ??= rowsOf(await withDeadline(Promise.resolve(db.execute(sql`SELECT id FROM public.users WHERE "isActive" = true AND role IN ('admin', 'supervisor')`)), STOP_DB_STEP_DEADLINE_MS, "drift alert recipients").catch(() => [])).map((u) => Number(u.id));
      const to = recipients;
      void import("./criticalStopAlert").then(({ raiseCriticalStopAlert }) =>
        raiseCriticalStopAlert({
          kind: "edge_owner_factory_drift",
          title: `${d.kind} ${d.id}: factory changed while edge node ${d.edgeNodeId} owns it`,
          message: `${d.kind} ${d.id} is owned by edge node ${d.edgeNodeId} (factory ${d.nodeFactory ?? "NONE"}) but now belongs to factory ${d.deviceFactory ?? "NONE"} — the node will not list it (its STOPs fall back to central). Move its ownership or restore its factory / line assignment.`,
          recipients: to,
          dedupKey: `edge_owner_factory_drift:${key}`,
          // cảnh báo TRẠNG THÁI: bộ nhớ `factoryDriftAlerted` rỗng sau mỗi lần khởi động ⇒ phải khử trùng BỀN VỮNG (không nhân hàng mỗi lần boot)
          khuTrungBenVung: {},
          retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
          source: d.kind === "robot" ? "robot" : "ot",
          entityType: d.kind === "robot" ? "robot" : "ot_command",
          entityId: d.id,
        }),
      );
    }
  } catch (err) {
    const { isEdgeControlSchemaMissing } = await import("../edge/edgeControlSchema");
    if (!isEdgeControlSchemaMissing(err)) console.error(`[DeviceOwner] factory-drift check failed: ${errText(err)}`);
  }
  return out;
}
/** Test seam — the (device, owner, factories) keys currently alerted (a key leaves when its drift clears: re-armed). */
export function _factoryDriftAlertedKeysForTests(): string[] {
  return [...factoryDriftAlerted];
}
/** Test seam. */
export function _resetFactoryDriftAlertsForTests(): void {
  factoryDriftAlerted.clear();
}

/**
 * Central boot (server/_core/index.ts — the controller's integration hunk, after startRobots / startOt): the pending-STOP sweep at
 * once and every ≤ 10 s (R-10-w), the ownership reconcile every ≤ 30 s (R-10-v), and a LISTEN on 'device_owner_changed' through
 * the app pool's own postgres client (no new connection) that applies another replica's change at once. Never on the edge.
 * Returns the stop function.
 */
/** N6 — the LISTEN registration is bounded and retried in the background. */
export const DEVICE_OWNER_LISTEN_DEADLINE_MS = 5_000;
export const DEVICE_OWNER_LISTEN_RETRY_MS = 30_000;

/**
 * Central boot (server/_core/index.ts — the controller's integration hunk; call it WITHOUT awaiting, it never blocks the server's
 * listen): LISTEN 'device_owner_changed' first (bounded by DEVICE_OWNER_LISTEN_DEADLINE_MS, retried every 30 s in the background
 * when it fails), THEN the first reconcile (R-10-al: a change committed between startRobots / startOt and the LISTEN is applied —
 * devices those never tried are attached) and the first pending-STOP sweep; afterwards the sweep every ≤ 10 s (R-10-w) and the
 * reconcile every ≤ 30 s (R-10-v). Never on the edge. Returns the stop function.
 */
export async function startDeviceOwnershipSync(
  opts: {
    sweepMs?: number;
    reconcileMs?: number;
    listenDeadlineMs?: number;
    /** doc 81 Đợt 12 task P fix 1 (R-12-b) — channel-listener seams (tests) */
    listenClient?: () => Promise<import("../ops/pgChannelListener").PgListenClient | null>;
    notifyClient?: () => Promise<import("../ops/pgChannelListener").PgNotifyClient | null>;
    listenRetryMs?: number;
    pingMs?: number;
    pingDeadlineMs?: number;
    listenAlert?: (a: import("../ops/pgChannelListener").ChannelListenerAlert) => void;
  } = {},
): Promise<() => Promise<void>> {
  const { isEdgeProcessRole } = await import("../../db/connection");
  if (isEdgeProcessRole()) return async () => undefined;
  let stopped = false;
  let sweeping = false;
  const sweep = () => {
    if (sweeping || stopped) return;
    sweeping = true;
    void sweepPendingCentralStops().finally(() => (sweeping = false));
  };
  let reconciling = false;
  const reconcile = () => {
    if (reconciling || stopped) return;
    reconciling = true;
    void reconcileDeviceOwnership()
      .then(() => checkEdgeOwnedFactoryDrift()) // R-10-ay — the root cause, alerted
      .finally(() => (reconciling = false));
  };
  // doc 81 Đợt 12 task P fix 1 (R-12-b) — the shared channel listener: bounded LISTEN retried in the background, a HEARTBEAT (a
  // failed postgres.js auto re-LISTEN drops the channel silently — now detected), an alert per lost episode, a reconnect.
  const { startChannelListener } = await import("../ops/pgChannelListener");
  const chan = await startChannelListener({
    channel: DEVICE_OWNER_CHANNEL,
    tag: "DeviceOwner",
    onPayload: (payload: string) => {
      try {
        const m = JSON.parse(payload) as { kind: DeviceKind; id: number; to: number | null };
        if ((m.kind === "robot" || m.kind === "adapter") && Number.isSafeInteger(m.id)) {
          void applyOwnershipLocally(m.kind, m.id, m.to ?? null).then(() => (m.to == null ? sweep() : undefined));
        } else reconcile();
      } catch {
        reconcile();
      }
    },
    // the app pool's postgres client (its LISTEN runs on postgres.js's own dedicated connection); heartbeats go through the
    // dedicated notify client (connection.getNotifyClient), never the app pool
    listenClient: opts.listenClient ?? (async () => {
      const db = (await getDb()) as unknown as { $client?: { listen?: (ch: string, fn: (payload: string) => void, onlisten?: () => void) => Promise<{ unlisten: () => Promise<void> }> } } | null;
      const client = db?.$client;
      if (!client || typeof client.listen !== "function") throw new DbUnavailableError("no LISTEN-capable client");
      return client as { listen: NonNullable<typeof client.listen> };
    }),
    notifyClient: opts.notifyClient,
    listenDeadlineMs: opts.listenDeadlineMs ?? DEVICE_OWNER_LISTEN_DEADLINE_MS,
    retryMs: opts.listenRetryMs ?? DEVICE_OWNER_LISTEN_RETRY_MS,
    pingMs: opts.pingMs,
    pingDeadlineMs: opts.pingDeadlineMs,
    alert: opts.listenAlert,
    lostMeaning: `Until it reconnects, ownership changes made by OTHER replicas reach this one only through the ${DEVICE_OWNER_RECONCILE_MS / 1000} s reconcile.`,
    // doc 81 Đợt 12 final fix wave (R-12-e M-4) — the gap's notifications were lost: reconcile now, not at the next 30 s pass
    onRecovered: () => {
      if (!reconciling) reconcile();
      else setTimeout(reconcile, 1_000).unref?.();
    },
  });
  deviceOwnerListener = chan;
  // R-10-al — the first reconcile runs right AFTER the LISTEN: nothing committed in between is lost
  reconcile();
  // fix review 4 (NF-3) — and again once startOt has finished (central starts OT only after the HTTP listen): adapters its load
  // never tried (a failed load, central-owned since) are attached then, not never
  let offOt: () => void = () => undefined;
  try {
    const { onOtGatewayStarted } = await import("../ot/otManager");
    offOt = onOtGatewayStarted(() => {
      if (!reconciling) reconcile();
      else setTimeout(reconcile, 1_000).unref?.();
    });
  } catch (err) {
    console.warn(`[DeviceOwner] OT gateway-start hook unavailable (${errText(err)}) — the ${DEVICE_OWNER_RECONCILE_MS / 1000} s reconcile covers it`);
  }
  sweep();
  const t1 = setInterval(sweep, Math.min(PENDING_STOP_SWEEP_MS, opts.sweepMs ?? PENDING_STOP_SWEEP_MS));
  const t2 = setInterval(reconcile, Math.min(DEVICE_OWNER_RECONCILE_MS, opts.reconcileMs ?? DEVICE_OWNER_RECONCILE_MS));
  for (const t of [t1, t2]) if (typeof t.unref === "function") t.unref();
  return async () => {
    stopped = true;
    offOt();
    clearInterval(t1);
    clearInterval(t2);
    if (deviceOwnerListener === chan) deviceOwnerListener = null;
    await chan.stop();
  };
}

/** doc 81 Đợt 12 task P fix 1 (R-12-b, M-3) — the `device_owner_changed` listener's status (system health); null when not started. */
let deviceOwnerListener: import("../ops/pgChannelListener").ChannelListener | null = null;
export function deviceOwnerListenerStatus(): import("../ops/pgChannelListener").ChannelListenerStatus | null {
  return deviceOwnerListener?.status() ?? null;
}
