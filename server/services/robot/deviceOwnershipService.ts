/**
 * doc 81 Đợt 10 task D (design §2.12, ruling R-10-i, L-7) — the ownership change of a robot / OT adapter, and what CENTRAL owes
 * the device right after it moves to central.
 *
 * changeDeviceOwner: ONE transaction (the WORM history names the actor — setEdgeOwnershipActor), UPDATE …"edgeNodeId". The DB
 * (mig 0374) does the rest atomically: refuses while a job / command is in flight, bumps the owner epoch, relocks a robot
 * ('ownerChanged' under the new authority + epoch), and CARRIES unacknowledged STOP requests of the previous ownership to a new
 * EDGE owner. A refusal (23514) is answered as `refused`.
 *
 * R-10-i — when the device moves to CENTRAL, a STOP request the old edge never acknowledged must not merely stay visible: central
 * EXECUTES it, right after the transfer commits (nothing is awaited before the STOP but the bounded read of which STOPs are
 * pending): a robot ⇒ the canonical abort through central's robot path (robotManager session ⇒ dispatchRobotJob; no session —
 * central skipped the robot while the edge owned it — ⇒ a transient driver session, abort, disconnect); an adapter ⇒ its PINNED
 * stop values (loadStopPins) through central's OT device stage (running driver, else a transient session to the adapter's
 * current row). One STOP per device answers every pending request of it; each request is then acknowledged through A's guarded
 * helper (ackCentralStop: done | failed). A STOP that could not be sent ⇒ `failed` + a CRITICAL operator alert (the request row
 * stays, with outcome failed — visible, never deleted). Dry-run mode (ROBOT_/OT_CONTROL_ENABLED off) records it simulated (done),
 * as central's dispatchers do.
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
  /** the acks that could not be written (the request then stays pending — visible to B's surfacing) */
  ackErrors: number[];
}
export type ChangeOwnerResult =
  | { ok: true; ownerEpoch: number; toEdgeNodeId: number | null; centralStops: CentralStopOutcome | null }
  | { ok: false; reason: "refused" | "not_found" | "unavailable"; detail: string };

/** Bound of one transient session (connect + stop + disconnect) of a device central did not hold. */
export const CENTRAL_STOP_SESSION_DEADLINE_MS = 10_000;

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
      return Number(r[0].ownerEpoch);
    });
  } catch (err) {
    if ((err as { notFound?: boolean }).notFound) return { ok: false, reason: "not_found", detail: `${a.kind} ${a.deviceId} not found` };
    if (isEdgeControlRefusal(err)) return { ok: false, reason: "refused", detail: errText(err) };
    return { ok: false, reason: "unavailable", detail: errText(err) };
  }
  const centralStops = a.toEdgeNodeId === null ? await executePendingCentralStops(a.kind, a.deviceId, a.actorUserId) : null;
  return { ok: true, ownerEpoch: epoch, toEdgeNodeId: a.toEdgeNodeId, centralStops };
}

/**
 * R-10-i — execute the unacknowledged STOP requests of a device that is CENTRAL-owned now (device_pending_stops.centralMustExecute),
 * then acknowledge them. Null when none is pending. Never throws (a failure is the `failed` outcome + an alert).
 */
export async function executePendingCentralStops(kind: DeviceKind, deviceId: number, actorUserId: number): Promise<CentralStopOutcome | null> {
  let pending: Array<{ requestId: number; requestedBy: number }> = [];
  try {
    const db = await getDb();
    if (!db) throw new Error("database unavailable");
    const q =
      kind === "robot"
        ? sql`SELECT "requestId", "requestedBy" FROM public.device_pending_stops WHERE "robotId" = ${deviceId} AND "centralMustExecute"`
        : sql`SELECT "requestId", "requestedBy" FROM public.device_pending_stops WHERE "adapterId" = ${deviceId} AND "centralMustExecute"`;
    pending = rowsOf(await withDeadline(db.execute(q), STOP_DB_STEP_DEADLINE_MS, "pending STOPs read")).map((r) => ({ requestId: Number(r.requestId), requestedBy: Number(r.requestedBy) }));
  } catch (err) {
    // the pending set is unknown: send the STOP anyway (energy-reducing, harmless when nothing was pending) and alert
    const sent = await sendCentralStop(kind, deviceId);
    raiseCentralStopAlert(kind, deviceId, [], actorUserId, `pending STOP requests could not be read (${errText(err)}); a STOP was ${sent.sent} anyway`);
    return { requestIds: [], outcome: sent.ok ? "done" : "failed", sent: sent.sent, detail: sent.detail, ackErrors: [] };
  }
  if (pending.length === 0) return null;
  const sent = await sendCentralStop(kind, deviceId);
  const outcome: "done" | "failed" = sent.ok ? "done" : "failed";
  const ackErrors: number[] = [];
  const { ackCentralStop } = await import("../edge/edgeControlSchema");
  const db = await getDb();
  for (const p of pending) {
    try {
      if (!db) throw new Error("database unavailable");
      await withDeadline(ackCentralStop(db as never, { requestId: p.requestId, outcome, actorUserId }), STOP_DB_STEP_DEADLINE_MS, "central STOP ack");
    } catch (err) {
      ackErrors.push(p.requestId);
      console.error(`[DeviceOwner] STOP request #${p.requestId} (${kind} ${deviceId}) was ${sent.sent} but its acknowledgement failed — it stays pending: ${errText(err)}`);
    }
  }
  if (!sent.ok || ackErrors.length > 0) {
    raiseCentralStopAlert(
      kind,
      deviceId,
      [...new Set(pending.map((p) => p.requestedBy).concat(actorUserId))],
      actorUserId,
      !sent.ok ? `the STOP owed after the transfer to central could NOT be sent (${sent.detail}) — requests ${pending.map((p) => `#${p.requestId}`).join(", ")} marked failed` : `the STOP was sent but requests ${ackErrors.map((i) => `#${i}`).join(", ")} could not be acknowledged`,
    );
  }
  return { requestIds: pending.map((p) => p.requestId), outcome, sent: sent.sent, detail: sent.detail, ackErrors };
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
  const db = await getDb();
  if (!db) return { ok: false, sent: "failed", detail: "database unavailable (robot row)" };
  const { robots } = await import("../../../drizzle/schema");
  const [row] = await db.select().from(robots).where(eq(robots.id, robotId)).limit(1);
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
  const st = await withDeadline(work, CENTRAL_STOP_SESSION_DEADLINE_MS, `robot ${robotId} transient STOP session`);
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
    executed = await withDeadline(work, CENTRAL_STOP_SESSION_DEADLINE_MS, `adapter ${adapterId} transient STOP session`);
  }
  const allOk = executed.outcomes.length > 0 && executed.outcomes.every((o) => o.ok);
  return allOk ? { ok: true, sent: "sent", detail: `pinned stop written (${pins.map((p) => p.tagKey).join(", ")})` } : { ok: false, sent: "failed", detail: executed.timedOut ? "pinned stop write timed out" : "pinned stop write failed" };
}

/** CRITICAL operator alert (unified alert stream + safety-critical inbox), fire-and-forget, bounded. */
function raiseCentralStopAlert(kind: DeviceKind, deviceId: number, recipients: number[], _actor: number, what: string): void {
  const message = `STOP owed to ${kind} ${deviceId} after its ownership moved to central: ${what}. Check the equipment on site now.`;
  console.error(`[DeviceOwner] CRITICAL: ${message}`);
  const work = (async () => {
    const { publishAnomalyDetected } = await import("../ecosystem/ecosystemEvents");
    publishAnomalyDetected({ kind: "central_stop_after_transfer", severity: "critical", source: kind === "robot" ? "robot" : "ot", machineId: null, message }, kind === "robot" ? "robot" : "ot");
    const { sendNotification } = await import("../notificationService");
    for (const userId of recipients.filter((u) => Number.isSafeInteger(u) && u > 0)) {
      await sendNotification(
        userId,
        { type: "ALERT", priority: "URGENT", title: `STOP owed after transfer — ${kind} ${deviceId}`, message, entityType: kind === "robot" ? "robot" : "ot_command", entityId: deviceId, metadata: { kind, deviceId } },
        { safetyCritical: true, capExempt: "ot_stop_unverified", dedupKey: `central_stop_after_transfer:${kind}:${deviceId}` },
      );
    }
  })();
  void withDeadline(work, 10_000, "central STOP alert").catch((err) => console.error(`[DeviceOwner] alert failed or is stuck: ${errText(err)}`));
}
