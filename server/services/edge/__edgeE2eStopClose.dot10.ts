/**
 * A2 test (R1b-2b-2a) item 1 + fix round 1 (AMENDMENT 2) — the teardown step of the F1 edge e2e harness that closes the STOP
 * requests of THIS run's devices before they are removed. Not a test file: imported by __edgeE2eHarness.dot10.ts (teardown, BEFORE
 * the harness's own simulators close — fix round 1 R1) and by its DB test (ROLLBACK, with injected dependencies).
 *
 * Why: a device with a pending STOP is undeletable (mig 0374 device_keep_pending_stop) and stayed ENABLED on _test (requests #5150,
 * #51720, #51721 — all unacked). The harness's old statement handed every `"ackedAt" IS NULL` STOP to edge_stop_resolve, which
 * accepts ONLY an acked refused / failed STOP ⇒ it raised on the first one and the single statement closed nothing.
 *
 * Per run, with the L-7 pending predicate of device_keep_pending_stop:
 *   1. an UNACKED STOP cannot be closed by a person (edge_stop_resolve refuses by design) — its device must take it. The run's edges
 *      are stopped by now, so the device goes back to CENTRAL the product's way (changeDeviceOwner → null, actor = the run's admin;
 *      central EXECUTES the owed STOP and acks it done | failed via edge_stop_ack_central — R-10-i / R-10-w); a device already
 *      central-owned: executePendingCentralStops. FAIL-CLOSED guard first (AMENDMENT 2 item 1): only a device that carries THIS
 *      run's marker (its code is one of the run's own codes) AND whose endpoint is a simulator / loopback one (`sim://`, `stub://`,
 *      `tcp://127.0.0.1:<port>`, `tcp://localhost:<port>`) — anything else is logged and kept, its owner is never changed.
 *      The ack is awaited under ONE bounded deadline for the whole step (AMENDMENT 2 item 2): on timeout ⇒ logged, device kept,
 *      the teardown goes on (never hangs); a DEFINITE failure (owner change refused / threw) ends that device's wait at once
 *      (logged, kept) so the rest of the budget stays for later devices. This process's central session of the device is detached.
 *   2. every REFUSED / FAILED unresolved STOP (step 1's failures included) of a device that carries THIS run's code (the same
 *      own-run check as step 1 — resolving another run's STOP is a human path; logged, not resolved): edge_stop_resolve by the
 *      run's admin, ONE request per statement (the function itself refuses anything else).
 *   ⇒ the requests of other runs (#5150 / #51720 / #51721 …) are never acted on in step 1 OR step 2, even if an id leaked into the lists.
 *   3. whatever is still pending: logged by id; the DB then refuses the device delete and the device stays — never forced.
 */
import type postgres from "postgres";

type Sql = postgres.Sql | postgres.TransactionSql;
export type DeviceKind = "robot" | "adapter";

/**
 * 30 s for the WHOLE step (all devices). Per device the hand-back is one owner-change transaction + central's STOP: a transient
 * session bounded by CENTRAL_STOP_SESSION_DEADLINE_MS (10 s), the driver timeouts ROBOT_CONTROL_TIMEOUT_MS / OT_CONTROL_TIMEOUT_MS
 * (5 s in the harness's CENTRAL_ENV) and DB steps of STOP_DB_STEP_DEADLINE_MS (1 s) ⇒ ≈ 15 s worst case for one device; 30 s is 2×
 * that, half of the 60 s the teardown already grants each edge to stop, and keeps the teardown inside the suites' 240 s afterAll.
 */
export const TEARDOWN_STOP_ACK_DEADLINE_MS = 30_000;
export const TEARDOWN_STOP_POLL_MS = 200;

/** AMENDMENT 2 item 1 (b) — the simulator / loopback endpoints central may reach in a teardown. */
export function isSimOrLoopbackEndpoint(endpoint: string | null | undefined): boolean {
  const e = String(endpoint ?? "").trim();
  return /^sim:\/\//.test(e) || /^stub:\/\//.test(e) || /^tcp:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/?$/.test(e);
}

/** AMENDMENT 2 item 1 — may this device be handed back to central for its owed STOP? (a) THIS run's marker, (b) sim / loopback. */
export function mayReturnToCentral(dev: { code: string; endpoint: string | null }, runCodes: ReadonlySet<string>): { ok: true } | { ok: false; reason: string } {
  if (!runCodes.has(dev.code)) return { ok: false, reason: `code ${dev.code} is not one of this run's devices` };
  if (!isSimOrLoopbackEndpoint(dev.endpoint)) return { ok: false, reason: `endpoint ${dev.endpoint} is not a simulator / loopback endpoint` };
  return { ok: true };
}

export interface CloseStopsDeps {
  sql: Sql;
  actorUserId: number;
  robots: number[];
  adapters: number[];
  /** the codes of THIS run's devices (RA/RB/RC-<DAU>, AA/AB-<DAU>) */
  runCodes: ReadonlySet<string>;
  own: {
    changeDeviceOwner(a: { kind: DeviceKind; deviceId: number; toEdgeNodeId: null; actorUserId: number; actorName: string }): Promise<{ ok: boolean; reason?: string; detail?: string }>;
    executePendingCentralStops(kind: DeviceKind, deviceId: number, actorUserId: number | null): Promise<unknown>;
  };
  detach(kind: DeviceKind, id: number): Promise<void>;
  deadlineMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}
export interface CloseStopsReport {
  /** devices whose owed STOP was acked after the hand-back / central execution */
  handled: string[];
  /** devices the guard refused (never handed back) */
  refused: Array<{ device: string; reason: string }>;
  /** devices whose ack did not come before the deadline (kept) */
  timedOut: string[];
  /** polish — devices whose hand-back FAILED definitely (owner change refused / threw): kept, not waited for */
  failed: Array<{ device: string; reason: string }>;
  /** polish — acked refused / failed STOPs NOT resolved because their device is not one of this run's (a human path) */
  notOwnNotResolved: number[];
  /** refused / failed requests resolved by the run's admin */
  resolved: number[];
  /** requests still pending at the end (their device stays) */
  stillPending: number[];
  /** every pending request seen at the start (ids) */
  pendingAtStart: number[];
}

const PENDING_SQL_NOTE = "L-7 predicate of mig 0374 device_keep_pending_stop";

/** The pending STOP requests of the given device ids only (the run's own lists). */
export async function pendingStopsOf(sql: Sql, robots: number[], adapters: number[]): Promise<Array<{ id: number; kind: DeviceKind; deviceId: number; unacked: boolean }>> {
  const rows = await sql`
    SELECT q.id, q."robotId", q."adapterId", (q."ackedAt" IS NULL) AS unacked FROM robot_motion_lock_requests q
     WHERE (q."robotId" IN ${sql(robots.length ? robots : [0])} OR q."adapterId" IN ${sql(adapters.length ? adapters : [0])})
       AND q.kind = 'stop' AND q."carriedToId" IS NULL
       AND (q."ackedAt" IS NULL OR (q.outcome IN ('refused', 'failed') AND q."resolvedAt" IS NULL))
     ORDER BY q.id`;
  return rows.map((q) => ({ id: Number(q.id), kind: q.robotId != null ? ("robot" as const) : ("adapter" as const), deviceId: Number(q.robotId ?? q.adapterId), unacked: q.unacked === true }));
}

/** Steps 1–3 above. Never throws for one device; a DB error of the step itself propagates (the harness logs it). */
export async function closeOwnStops(d: CloseStopsDeps): Promise<CloseStopsReport> {
  const log = d.log ?? ((l: string) => console.warn(l));
  const now = d.now ?? Date.now;
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = now() + (d.deadlineMs ?? TEARDOWN_STOP_ACK_DEADLINE_MS);
  const rep: CloseStopsReport = { handled: [], refused: [], timedOut: [], failed: [], resolved: [], stillPending: [], pendingAtStart: [], notOwnNotResolved: [] };

  const start = await pendingStopsOf(d.sql, d.robots, d.adapters);
  rep.pendingAtStart = start.map((q) => q.id);
  const devices = new Map<string, { kind: DeviceKind; id: number }>();
  for (const q of start) if (q.unacked) devices.set(`${q.kind}:${q.deviceId}`, { kind: q.kind, id: q.deviceId });

  for (const [key, dev] of devices) {
    const [row] = dev.kind === "robot" ? await d.sql`SELECT code, endpoint, "edgeNodeId" FROM robots WHERE id = ${dev.id}` : await d.sql`SELECT code, endpoint, "edgeNodeId" FROM device_adapters WHERE id = ${dev.id}`;
    const g = row ? mayReturnToCentral({ code: String(row.code), endpoint: (row.endpoint as string | null) ?? null }, d.runCodes) : ({ ok: false, reason: "device row not found" } as const);
    if (!g.ok) {
      rep.refused.push({ device: key, reason: g.reason });
      log(`[F1] teardown: ${key} kept, owner NOT returned to central for its owed STOP — ${g.reason}`);
      continue;
    }
    if (now() >= deadline) {
      rep.timedOut.push(key);
      log(`[F1] teardown: ${key} kept — the teardown STOP deadline had passed before its turn; owner not returned`);
      continue;
    }
    let settled = false;
    const fx: { failure: string | null } = { failure: null };
    const work = (async () => {
      if (row.edgeNodeId != null) {
        const r = await d.own.changeDeviceOwner({ kind: dev.kind, deviceId: dev.id, toEdgeNodeId: null, actorUserId: d.actorUserId, actorName: "F1 admin (teardown)" });
        if (!r.ok) fx.failure = `not handed to central for its owed STOP (${r.reason}: ${r.detail})`;
      } else await d.own.executePendingCentralStops(dev.kind, dev.id, d.actorUserId);
    })()
      .catch((e) => {
        fx.failure = `owed STOP hand-back threw: ${(e as Error).message}`;
      })
      .finally(() => {
        settled = true;
      });
    // A call given up at the deadline keeps running in the background (a promise cannot be cancelled). It is the TIMEOUT case only
    // (a definite failure ends the wait at once, below) and it is bounded by the product's own deadlines — the transient STOP
    // session (CENTRAL_STOP_SESSION_DEADLINE_MS 10 s), the driver timeout (5 s in CENTRAL_ENV) and 1 s DB steps, ≈ 15 s — so it
    // ends on its own; the teardown never waits for it and never hangs.
    void work;
    let acked = false;
    for (;;) {
      if (settled && fx.failure !== null) break; // polish: a definite failure — stop waiting now, the budget stays for later devices
      if (settled) {
        acked = !(await pendingStopsOf(d.sql, dev.kind === "robot" ? [dev.id] : [], dev.kind === "adapter" ? [dev.id] : [])).some((q) => q.unacked);
        if (acked) break;
      }
      if (now() >= deadline) break;
      await sleep(TEARDOWN_STOP_POLL_MS);
    }
    if (acked) rep.handled.push(key);
    else if (fx.failure !== null) {
      rep.failed.push({ device: key, reason: fx.failure });
      log(`[F1] teardown: ${key} kept — ${fx.failure}; not waited for further`);
    } else {
      rep.timedOut.push(key);
      log(`[F1] teardown: ${key} kept — its owed STOP was not acked before the teardown deadline (${d.deadlineMs ?? TEARDOWN_STOP_ACK_DEADLINE_MS} ms); not waited for further`);
    }
    await d.detach(dev.kind, dev.id).catch(() => undefined);
  }

  for (const q of await pendingStopsOf(d.sql, d.robots, d.adapters)) {
    if (q.unacked) continue;
    // polish — the same own-run check as step 1: resolving ANOTHER run's STOP is a human path, never this teardown's
    const [dv] = q.kind === "robot" ? await d.sql`SELECT code FROM robots WHERE id = ${q.deviceId}` : await d.sql`SELECT code FROM device_adapters WHERE id = ${q.deviceId}`;
    if (!dv || !d.runCodes.has(String(dv.code))) {
      rep.notOwnNotResolved.push(q.id);
      log(`[F1] teardown: STOP #${q.id} NOT resolved — ${q.kind} ${q.deviceId} (${dv ? String(dv.code) : "no row"}) is not one of this run's devices (a person resolves it)`);
      continue;
    }
    try {
      await d.sql`SELECT public.edge_stop_resolve(${q.id}, ${d.actorUserId}, 'F1 e2e teardown')`;
      rep.resolved.push(q.id);
    } catch (e) {
      log(`[F1] teardown: STOP #${q.id} not resolved: ${(e as Error).message}`);
    }
  }
  const left = await pendingStopsOf(d.sql, d.robots, d.adapters);
  rep.stillPending = left.map((q) => q.id);
  if (left.length) log(`[F1] teardown: STOP request(s) still pending (${PENDING_SQL_NOTE}) — their device stays (the DB refuses its delete): ${left.map((q) => `#${q.id} (${q.kind} ${q.deviceId})`).join(", ")}`);
  log(`[F1] teardown STOPs: pending at start [${rep.pendingAtStart.join(", ")}], handled ${rep.handled.length}, resolved [${rep.resolved.join(", ")}], still pending [${rep.stillPending.join(", ")}], refused ${rep.refused.length}, failed ${rep.failed.length}, timed out ${rep.timedOut.length}, not own (not resolved) [${rep.notOwnNotResolved.join(", ")}]`);
  return rep;
}
