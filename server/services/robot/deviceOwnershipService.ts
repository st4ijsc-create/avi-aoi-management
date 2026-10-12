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

export async function changeDeviceOwner(a: { kind: DeviceKind; deviceId: number; toEdgeNodeId: number | null; actorUserId: number; actorName: string }): Promise<ChangeOwnerResult> {
  const db = await getDb();
  if (!db) return { ok: false, reason: "unavailable", detail: "database unavailable" };
  const { setEdgeOwnershipActor, isEdgeControlRefusal } = await import("../edge/edgeControlSchema");
  let epoch: number;
  try {
    epoch = await db.transaction(async (tx) => {
      await setEdgeOwnershipActor(tx, `${a.actorName} (#${a.actorUserId})`);
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
    if ((err as { notFound?: boolean }).notFound) return { ok: false, reason: "not_found", detail: `${a.kind} ${a.deviceId} not found` };
    if (isEdgeControlRefusal(err)) return { ok: false, reason: "refused", detail: errText(err) };
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
  const { ackCentralStop } = await import("../edge/edgeControlSchema");
  let outcome: CentralStopOutcome | null = null;
  let recipients: number[] = [];
  let picked = false;
  try {
    await db.transaction(async (tx) => {
      const pick =
        kind === "robot"
          ? sql`SELECT q.id, q."requestedBy" FROM public.robot_motion_lock_requests q
                 WHERE q.id IN (SELECT "requestId" FROM public.device_pending_stops WHERE "robotId" = ${deviceId} AND "centralMustExecute")
                   AND q."ackedAt" IS NULL ORDER BY q.id FOR UPDATE OF q SKIP LOCKED`
          : sql`SELECT q.id, q."requestedBy" FROM public.robot_motion_lock_requests q
                 WHERE q.id IN (SELECT "requestId" FROM public.device_pending_stops WHERE "adapterId" = ${deviceId} AND "centralMustExecute")
                   AND q."ackedAt" IS NULL ORDER BY q.id FOR UPDATE OF q SKIP LOCKED`;
      const pending = rowsOf(await withDeadline(tx.execute(pick), 5 * STOP_DB_STEP_DEADLINE_MS, "pending STOP pick")).map((r) => ({ requestId: Number(r.id), requestedBy: Number(r.requestedBy) }));
      picked = true;
      if (pending.length === 0) return;
      const sent = await sendCentralStop(kind, deviceId);
      const result: "done" | "failed" = sent.ok ? "done" : "failed";
      const ackErrors: number[] = [];
      for (const p of pending) {
        const actor = actorUserId && actorUserId > 0 ? actorUserId : p.requestedBy;
        try {
          await tx.transaction(async (sp) => ackCentralStop(sp as never, { requestId: p.requestId, outcome: result, actorUserId: actor }));
        } catch (err) {
          ackErrors.push(p.requestId);
          console.error(`[DeviceOwner] STOP request #${p.requestId} (${kind} ${deviceId}) was ${sent.sent} but its acknowledgement failed — it stays pending: ${errText(err)}`);
        }
      }
      outcome = { requestIds: pending.map((p) => p.requestId), outcome: result, sent: sent.sent, detail: sent.detail, ackErrors };
      recipients = [...new Set(pending.map((p) => p.requestedBy).concat(actorUserId ? [actorUserId] : []))];
    });
  } catch (err) {
    if (!picked) return sendAnyway(errText(err));
    console.error(`[DeviceOwner] pending-STOP execution for ${kind} ${deviceId} failed after the STOP: ${errText(err)}`);
  }
  const o = outcome as CentralStopOutcome | null;
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
export async function sendCentralRobotStop(robotId: number): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  return sendCentralStop("robot", robotId);
}

/** One STOP to the device through central's path. Never throws. */
async function sendCentralStop(kind: DeviceKind, deviceId: number): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  try {
    return kind === "robot" ? await sendRobotStop(deviceId) : await sendAdapterStop(deviceId);
  } catch (err) {
    return { ok: false, sent: "failed", detail: errText(err) };
  }
}

async function sendRobotStop(robotId: number): Promise<{ ok: boolean; sent: "sent" | "simulated" | "failed"; detail: string }> {
  const { getActiveRobot } = await import("./robotManager");
  if (getActiveRobot(robotId)) {
    const { dispatchRobotJob } = await import("./robotCommandDispatcher");
    const r = await dispatchRobotJob({ robotId, job: { jobType: "abort", params: {} }, triggerKind: "manual", requestedBy: 0, confirmedBy: 0, idempotencyKey: undefined });
    return r.ok ? { ok: true, sent: r.status === "simulated" ? "simulated" : "sent", detail: `robot_jobs #${r.jobId ?? "?"} ${r.status}` } : { ok: false, sent: "failed", detail: r.error ?? r.status };
  }
  // no session (central skipped the robot while an edge owned it): a transient one, bounded
  if (process.env.ROBOT_CONTROL_ENABLED !== "true") return { ok: true, sent: "simulated", detail: "dry-run (ROBOT_CONTROL_ENABLED off) — nothing sent" };
  // R-10-ak — the row read before the send is bounded by the STOP bound; unreadable ⇒ failed (the caller alerts)
  let row: { vendor: string; endpoint: string; connectionOptions: unknown } | undefined;
  try {
    row = await withDeadline(
      (async () => {
        const { robots } = await import("../../../drizzle/schema"); // inside the bound (a cold import counts too)
        const db = await getDb();
        if (!db) throw new Error("database unavailable (robot row)");
        return (await db.select().from(robots).where(eq(robots.id, robotId)).limit(1))[0];
      })(),
      STOP_DB_STEP_DEADLINE_MS,
      `robot ${robotId} row for a transient STOP`,
    );
  } catch (err) {
    return { ok: false, sent: "failed", detail: `the robot's connection settings could not be read (${errText(err)}) — no session could be opened` };
  }
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
    const a = (await loadEnabledAdapters()).find((x) => x.adapterId === adapterId);
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
      seenEpoch.robot.set(id, ep);
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
      seenEpoch.adapter.set(id, ep);
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
    void reconcileDeviceOwnership().finally(() => (reconciling = false));
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
  sweep();
  const t1 = setInterval(sweep, Math.min(PENDING_STOP_SWEEP_MS, opts.sweepMs ?? PENDING_STOP_SWEEP_MS));
  const t2 = setInterval(reconcile, Math.min(DEVICE_OWNER_RECONCILE_MS, opts.reconcileMs ?? DEVICE_OWNER_RECONCILE_MS));
  for (const t of [t1, t2]) if (typeof t.unref === "function") t.unref();
  return async () => {
    stopped = true;
    clearInterval(t1);
    clearInterval(t2);
    if (retry) clearTimeout(retry);
    const u = unlisten as (() => Promise<void>) | null;
    if (u) await u().catch(() => undefined);
  };
}
