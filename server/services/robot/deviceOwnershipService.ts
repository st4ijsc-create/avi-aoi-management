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
 * transaction locks its pending requests FOR UPDATE SKIP LOCKED (one replica executes them; another sweep skips, never waits),
 * sends ONE STOP through central's path (robot: the canonical abort through robotManager's session, else a transient driver
 * session; adapter: its PINNED stop values through the OT device stage on the running driver, else a transient session), then
 * acks each request in its own savepoint through A's guarded edge_stop_ack_central (done | failed; actor = the transferring admin,
 * else the requester). A STOP that could not be sent ⇒ `failed` (the row stays, visible) + a DURABLE critical alert
 * (criticalStopAlert: alert stream + safety-critical inbox). Dry-run mode records it simulated (done), as central's dispatchers do.
 *
 * R-10-v — ownership is applied LIVE: this process attaches / detaches its robotManager / otManager session at once (central → edge
 * ⇒ its polling, ingest and session stop now); other replicas follow the NOTIFY; a reconcile every ≤ 30 s is the backstop.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { withDeadline } from "../ot/drivers/boundedClose";
import { STOP_DB_STEP_DEADLINE_MS } from "./stopJob";

export type DeviceKind = "robot" | "adapter";
export interface CentralStopOutcome {
  requestIds: number[];
  outcome: "done" | "failed";
  sent: "sent" | "simulated" | "failed";
  detail: string;
  /** the acks that could not be written (the request then stays pending — the next sweep retries) */
  ackErrors: number[];
}
export type ChangeOwnerResult =
  | { ok: true; ownerEpoch: number; toEdgeNodeId: number | null; centralStops: CentralStopOutcome | null }
  | { ok: false; reason: "refused" | "not_found" | "unavailable"; detail: string };

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
    if (!db) throw new Error("database unavailable");
    if (opts.device) devices = [opts.device];
    else {
      const rows = rowsOf(await withDeadline(db.execute(sql`SELECT DISTINCT "robotId", "adapterId" FROM public.device_pending_stops WHERE "centralMustExecute" AND outcome IS NULL`), 5 * STOP_DB_STEP_DEADLINE_MS, "pending STOP devices"));
      devices = rows.map((r) => (r.robotId != null ? { kind: "robot" as const, id: Number(r.robotId) } : { kind: "adapter" as const, id: Number(r.adapterId) }));
    }
  } catch (err) {
    if (opts.device) {
      const sent = await sendCentralStop(opts.device.kind, opts.device.id);
      void raiseCentralStopAlert(opts.device.kind, opts.device.id, opts.actorUserId ? [opts.actorUserId] : [], `pending STOP requests could not be read (${errText(err)}); a STOP was ${sent.sent} anyway`);
      return [{ requestIds: [], outcome: sent.ok ? "done" : "failed", sent: sent.sent, detail: sent.detail, ackErrors: [] }];
    }
    console.error(`[DeviceOwner] pending-STOP sweep could not read device_pending_stops: ${errText(err)}`);
    return results;
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
  const sendAnyway = async (why: string): Promise<CentralStopOutcome | null> => {
    if (!deviceScoped) {
      console.error(`[DeviceOwner] pending-STOP execution for ${kind} ${deviceId} failed: ${why} (the next sweep retries)`);
      return null;
    }
    const sent = await sendCentralStop(kind, deviceId);
    void raiseCentralStopAlert(kind, deviceId, actorUserId ? [actorUserId] : [], `the pending STOP requests could not be read/locked (${why}); a STOP was ${sent.sent} anyway (${sent.detail}) — the requests are acknowledged by the next sweep`);
    return { requestIds: [], outcome: sent.ok ? "done" : "failed", sent: sent.sent, detail: sent.detail, ackErrors: [] };
  };
  const db = await getDb().catch(() => null);
  if (!db) return sendAnyway("database unavailable");
  let outcome: CentralStopOutcome | null = null;
  let recipients: number[] = [];
  let picked = false;
  /** R-10-ay — requests central executes because the device's EDGE owner answered notOwnedHere (it cannot list the device) */
  let cannotList: number[] = [];
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
      const pending = rowsOf(await withDeadline(tx.execute(pick), 5 * STOP_DB_STEP_DEADLINE_MS, "pending STOP pick")).map((r) => ({ requestId: Number(r.id), requestedBy: Number(r.requestedBy), cannotList: r.cannotList === true }));
      picked = true;
      if (pending.length === 0) return;
      const sent = await sendCentralStop(kind, deviceId);
      const result: "done" | "failed" = sent.ok ? "done" : "failed";
      const ackErrors: number[] = [];
      // R-10-ba — the attempt is recorded ONCE (WORM evidence), then every pending request is acked against it
      let executionId: number | null = null;
      try {
        executionId = await tx.transaction(async (sp) => recordCentralStopAttempt(sp, { kind, deviceId, ok: sent.ok, detail: `${sent.sent}: ${sent.detail}` }));
      } catch (err) {
        console.error(`[DeviceOwner] the central STOP attempt on ${kind} ${deviceId} (${sent.sent}) could not be recorded — its requests stay pending: ${errText(err)}`);
      }
      for (const p of pending) {
        try {
          if (executionId === null) throw new Error("no recorded central STOP execution");
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
    if (!picked) return sendAnyway(errText(err));
    console.error(`[DeviceOwner] pending-STOP execution for ${kind} ${deviceId} failed after the STOP: ${errText(err)}`);
  }
  const o = outcome as CentralStopOutcome | null;
  if (o && cannotList.length > 0) {
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
/** Test seam. */
export function _resetOwnershipReconcileForTests(): void {
  seenEpoch.robot.clear();
  seenEpoch.adapter.clear();
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
    for (const r of robotRows) {
      const id = Number(r.id);
      const ep = Number(r.ownerEpoch);
      const prev = seenEpoch.robot.get(id);
      // fix review 4 (NF-3) — epochs are only SEEN while the gateway is on: a pass that ran before startRobots / startOt never
      // turns the first-pass rule ("not tried at start ⇒ attach") off for the pass after the gateway came on
      if (rm.isCentralRobotGatewayOn()) seenEpoch.robot.set(id, ep);
      if (r.edgeNodeId != null && activeRobots.has(id)) {
        if (await rm.detachRobot(id)) out.detached.push(`robot:${id}`);
      } else if (r.edgeNodeId == null && !activeRobots.has(id) && (prev !== undefined ? prev !== ep : rm.isCentralRobotGatewayOn() && !rm.robotTriedAtStart(id))) {
        if (await rm.attachRobot(id)) out.attached.push(`robot:${id}`);
      }
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
    for (const r of rows) {
      if (r.factoryDrift !== true) continue;
      const d = { kind: (r.kind === "adapter" ? "adapter" : "robot") as DeviceKind, id: Number(r.id), edgeNodeId: Number(r.edgeNodeId), deviceFactory: (r.deviceFactory as string | null) ?? null, nodeFactory: (r.nodeFactory as string | null) ?? null };
      out.push(d);
      const key = `${d.kind}:${d.id}:${d.edgeNodeId}:${d.deviceFactory}:${d.nodeFactory}`;
      if (factoryDriftAlerted.has(key)) continue;
      factoryDriftAlerted.add(key);
      // durable = an inbox row for the people who can act (active admins / supervisors)
      recipients ??= rowsOf(await Promise.resolve(db.execute(sql`SELECT id FROM public.users WHERE "isActive" = true AND role IN ('admin', 'supervisor')`)).catch(() => [])).map((u) => Number(u.id));
      const to = recipients;
      void import("./criticalStopAlert").then(({ raiseCriticalStopAlert }) =>
        raiseCriticalStopAlert({
          kind: "edge_owner_factory_drift",
          title: `${d.kind} ${d.id}: factory changed while edge node ${d.edgeNodeId} owns it`,
          message: `${d.kind} ${d.id} is owned by edge node ${d.edgeNodeId} (factory ${d.nodeFactory ?? "NONE"}) but now belongs to factory ${d.deviceFactory ?? "NONE"} — the node will not list it (its STOPs fall back to central). Move its ownership or restore its factory / line assignment.`,
          recipients: to,
          dedupKey: `edge_owner_factory_drift:${key}`,
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
export async function startDeviceOwnershipSync(opts: { sweepMs?: number; reconcileMs?: number; listenDeadlineMs?: number } = {}): Promise<() => Promise<void>> {
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
  let unlisten: (() => Promise<void>) | null = null;
  let retry: NodeJS.Timeout | null = null;
  const listenOnce = async (): Promise<boolean> => {
    try {
      const sub = await withDeadline(
        (async () => {
          const db = (await getDb()) as unknown as { $client?: { listen?: (ch: string, fn: (payload: string) => void) => Promise<{ unlisten: () => Promise<void> }> } } | null;
          const client = db?.$client;
          if (!client || typeof client.listen !== "function") throw new Error("no LISTEN-capable client");
          return client.listen(DEVICE_OWNER_CHANNEL, (payload: string) => {
            try {
              const m = JSON.parse(payload) as { kind: DeviceKind; id: number; to: number | null };
              if ((m.kind === "robot" || m.kind === "adapter") && Number.isSafeInteger(m.id)) {
                void applyOwnershipLocally(m.kind, m.id, m.to ?? null).then(() => (m.to == null ? sweep() : undefined));
              } else reconcile();
            } catch {
              reconcile();
            }
          });
        })(),
        opts.listenDeadlineMs ?? DEVICE_OWNER_LISTEN_DEADLINE_MS,
        `LISTEN ${DEVICE_OWNER_CHANNEL}`,
      );
      if (stopped) {
        await sub.unlisten().catch(() => undefined);
        return true;
      }
      unlisten = () => sub.unlisten();
      return true;
    } catch (err) {
      console.warn(`[DeviceOwner] LISTEN ${DEVICE_OWNER_CHANNEL} unavailable (${errText(err)}) — retrying in ${DEVICE_OWNER_LISTEN_RETRY_MS / 1000} s; the ${DEVICE_OWNER_RECONCILE_MS / 1000} s reconcile covers the gap`);
      return false;
    }
  };
  const ensureListen = async () => {
    if (await listenOnce()) return;
    retry = setTimeout(() => void ensureListen(), DEVICE_OWNER_LISTEN_RETRY_MS);
    if (typeof retry.unref === "function") retry.unref();
  };
  await ensureListen();
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
    if (retry) clearTimeout(retry);
    const u = unlisten as (() => Promise<void>) | null;
    if (u) await u().catch(() => undefined);
  };
}
