/**
 * doc 81 Đợt 10 task E fix review 1 (I-5) + fix review 2 (R-1 / R-2 / N-1 / N-2, R-10-ar) — the edge's devices follow its
 * VERIFIED config, not only the one at boot:
 *   • booted with central down and no cache ⇒ health `unconfigured` (never `online`), no device runs; the first config that
 *     arrives (heartbeat ⇒ newer version ⇒ refresh) STARTS the devices;
 *   • a robot that leaves the node is released ONLY when it was LOCKED locally AND its STOP (D's dispatch) succeeded — a failed
 *     STOP keeps it attached + locked, a TRUTHFUL alert, and the release is retried; a central STOP for it in the same pull runs
 *     FIRST (fast path, before the refresh);
 *   • an adapter that leaves the node gets its PINNED STOP (pins of the verified row it was started from) before its session
 *     closes — a failed STOP write keeps it attached + alert + retry; kept devices keep their sessions (one device at a time).
 * REAL gateway boot, robotManager (edge mode) + SIM robot driver WITH a motion lock, OT manager + stub adapter, D's dispatch;
 * no DB (EDGE_DB_TRAP=throw, 0 hits).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  for (const k of Object.keys(process.env)) if (k === "DATABASE_URL" || k === "TEST_DATABASE_URL" || k.startsWith("PG")) delete process.env[k];
  process.env.EDGE_DB_TRAP = "throw";
});
vi.mock("../unsPublisher", () => ({
  isUnsPublisherConnected: () => false,
  initUnsPublisher: () => undefined,
  shutdownUnsPublisher: async () => undefined,
  publishNdeathGraceful: async () => undefined,
  publishNormalized: () => undefined,
  publishSparkplugDData: () => undefined,
}));

import "../../edge/edgeRole";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeCentral, KIT_TOKEN } from "./edgeFakeCentral.testkit";

const central = new FakeCentral(7, 31);
const B0 = central.makeConfig();
/** what the node owns at boot: robots 12 + 13, adapters 21 + 22 (22: a WRONG fingerprint ⇒ D's pinned STOP fails closed) */
const BOOT = {
  robots: [...B0.robots, { ...B0.robots[0], id: 13, code: "rb-13", endpoint: "sim://13" }],
  adapters: [...B0.adapters, { ...B0.adapters[0], id: 22, code: "plc-22", endpoint: "stub://plc-22", connectionFingerprint: "0".repeat(64), tags: B0.adapters[0].tags.map((t) => ({ ...t, id: t.id + 100 })) }],
};
central.setConfig(BOOT);
let dir = "";
const shared: { rt?: import("./edgeGatewayRuntime").EdgeRuntime } = {};
const KEYS = ["EDGE_RECONCILE_RETRY_MS", "EDGE_ATTACH_ALERT_EVERY_MS", "ROBOT_GATEWAY_ENABLED", "ROBOT_CONTROL_ENABLED", "OT_GATEWAY_ENABLED", "OT_CONTROL_ENABLED", "OT_CONN_HA_ENABLED", "EDGE_EXECUTION_ENABLED", "EDGE_CENTRAL_URL", "EDGE_NODE_CREDENTIAL_FILE", "EDGE_CENTRAL_NODE_ID", "EDGE_CENTRAL_CREDENTIAL_ID", "EDGE_KEYSET_PIN_FILE", "EDGE_JOURNAL_DIR", "EDGE_GATEWAY_LIVENESS_FILE", "EDGE_UNS_STORE_FORWARD_FILE", "OT_STORE_FORWARD_ENABLED", "OT_STORE_FORWARD_FILE"] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "edge-reconcile-"));
  await fs.writeFile(path.join(dir, "node.cred"), KIT_TOKEN, { mode: 0o600 });
  await fs.writeFile(path.join(dir, "pin.json"), JSON.stringify(central.pin));
  Object.assign(process.env, {
    ROBOT_GATEWAY_ENABLED: "true",
    ROBOT_CONTROL_ENABLED: "true",
    OT_GATEWAY_ENABLED: "true",
    OT_CONTROL_ENABLED: "true",
    EDGE_RECONCILE_RETRY_MS: "300",
    EDGE_ATTACH_ALERT_EVERY_MS: "1500",
    EDGE_CENTRAL_URL: "https://central.test", // final fix wave M-4: plain http to a non-loopback host is refused
    EDGE_NODE_CREDENTIAL_FILE: path.join(dir, "node.cred"),
    EDGE_CENTRAL_NODE_ID: "7",
    EDGE_CENTRAL_CREDENTIAL_ID: "31",
    EDGE_KEYSET_PIN_FILE: path.join(dir, "pin.json"),
    EDGE_JOURNAL_DIR: path.join(dir, "journal"),
    EDGE_GATEWAY_LIVENESS_FILE: path.join(dir, "alive.json"),
    EDGE_UNS_STORE_FORWARD_FILE: path.join(dir, "uns.jsonl"),
  });
  delete process.env.EDGE_EXECUTION_ENABLED; // commands-only agent
  delete process.env.OT_CONN_HA_ENABLED;
  delete process.env.OT_STORE_FORWARD_ENABLED;
  delete process.env.OT_STORE_FORWARD_FILE;
});
afterAll(async () => {
  const { stopEdgeGateway, _resetForTests } = await import("./edgeGatewayRuntime");
  await stopEdgeGateway();
  _resetForTests();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("doc 81 Đợt 10 E fix reviews 1-3 — devices follow the verified config; release is fail-safe; one robot at a time", () => {
  it("★ no config ⇒ unconfigured; late config starts devices; release: lock + STOP first, a failed STOP keeps the device attached (truthful alert) and is retried; adapters get their pinned STOP", async () => {
    const { SimRobotDriver } = await import("../robot/drivers/simRobotDriver");
    const { StubDriver } = await import("../ot/drivers/stubDriver");
    // doc 81 Đợt 12 N fix 1 (M-2) — the PRODUCT sim lock (no prototype patch); a STOP that succeeds goes through the product
    // driver, so its confirmed-STOP clear (and the quiesce's re-lock + quiescing state) are exercised
    const order: string[] = [];
    let robotStopFails = false;
    const realRunJob = SimRobotDriver.prototype.runJob;
    vi.spyOn(SimRobotDriver.prototype, "runJob").mockImplementation(async function (this: InstanceType<typeof SimRobotDriver>, job: { jobType: string }) {
      order.push(`robot:${job.jobType}${robotStopFails ? ":fail" : ""}`);
      if (robotStopFails) return { ok: false, status: "failed" as const, error: "controller rejected" };
      return job.jobType === "abort" ? realRunJob.call(this, job as never) : { ok: true, status: "done" as const };
    });
    let otStopFails = true;
    const writes = vi.spyOn(StubDriver.prototype, "writeTags").mockImplementation(async (w: Array<{ tagKey: string }>) => {
      order.push(`ot:${w.map((x) => x.tagKey).join(",")}${otStopFails ? ":fail" : ""}`);
      return w.map((x) => ({ tagKey: x.tagKey, ok: !otStopFails, status: otStopFails ? "failed" : "done" })) as never;
    });
    const rm = await import("../robot/robotManager");
    const om = await import("../ot/otManager");
    const gw = await import("./edgeGatewayRuntime");
    // G-2 (R-10-az) — group D's REAL per-robot lifecycle (ab252ccaa): attachEdgeRobot(row) / detachEdgeRobot(id) → {ok, reason?};
    // the connects are counted per endpoint — robot 14 (sim://14) never connects
    rm._setEdgeRobotBackoffBaseMsForTests(100);
    const connects: string[] = [];
    const realConnect = SimRobotDriver.prototype.connect;
    vi.spyOn(SimRobotDriver.prototype, "connect").mockImplementation(async function (this: InstanceType<typeof SimRobotDriver>, c: { endpoint: string }) {
      connects.push(c.endpoint);
      if (c.endpoint === "sim://14") throw new Error("sim://14 unreachable");
      return realConnect.call(this, c as never);
    });
    const conn = await import("../../db/connection");
    const alerts = async () => {
      await rt.journal.flush();
      await rt.shipper.flushAll();
      return central.received.locksEvents.filter((r) => r.kind === "anomaly" && String(r.code).startsWith("EDGE_DEVICE_")).map((r) => `${r.code}: ${r.detail}`);
    };

    central.down = true;
    const handles = await gw.bootstrapEdgeGateway({ fetchImpl: central.fetchImpl });
    const rt = handles.runtime!;
    shared.rt = rt;
    expect(rt.config.current()).toBeNull();
    expect((await gw.getEdgeGatewayHealth()).status).toBe("unconfigured");
    expect(rm.activeRobotIds()).toEqual([]);

    // central comes back: the heartbeat sees a config version ⇒ refresh ⇒ the devices start
    central.down = false;
    await gw.sendHeartbeat();
    await vi.waitFor(() => expect(rm.activeRobotIds().sort()).toEqual([12, 13]), { timeout: 5_000, interval: 20 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeDefined(), { timeout: 5_000, interval: 20 });
    await vi.waitFor(() => expect(om.getActiveDriver(22)).toBeDefined(), { timeout: 5_000, interval: 20 });
    const robot13 = rm.getActiveRobot(13)!; // the HEALTHY robot: its session must never be cycled below
    expect((await gw.getEdgeGatewayHealth()).status).not.toBe("unconfigured");
    const robot12 = rm.getActiveRobot(12)!;
    // doc 81 Đợt 12 N fix 1 (M-2) — ONE lock: the reconciler's lock is the product driver's own (no split-brain test double)
    expect((robot12.driver as unknown as { motionLock: unknown }).motionLock).toBe(robot12.driver.motionLockController!());

    // ── ownership change: robot 12 AND adapter 21 leave; the SAME pull carries a central STOP for robot 12; the robot's
    //    release STOP fails at first, the adapter's pinned STOP write fails at first
    const base = BOOT;
    central.setConfig({ robots: base.robots.filter((r) => r.id === 13), adapters: [] });
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 140, kind: "stop", target: { robotId: 12 } }))];
    const agent = (await import("./edgeExecutionAgent")).currentEdgeExecutionAgent()!;
    order.length = 0;
    order.push("tick");
    robotStopFails = false;
    const firstTick = agent.tick();
    await vi.waitFor(() => expect(order).toContain("robot:abort"), { timeout: 5_000, interval: 5 });
    robotStopFails = true; // the command STOP went; the release STOP that follows the refresh fails
    await firstTick;
    // Đợt 12 N fix 1 (M-2) — central holds the ack now: it stops re-delivering request 140 (a re-delivery is re-acked by design on
    // a 2 s back-off; the product sim STOP's 200 ms run made this flow outlast that back-off)
    central.commands = [];
    await gw.reconcileDevices(rt, "test barrier");
    expect(order.slice(0, 2)).toEqual(["tick", "robot:abort"]); // the central STOP ran FIRST (fast path)
    expect(order).toContain("robot:abort:fail");
    expect(order).toContain("ot:run:fail");
    // nothing released: both kept attached, the robot LOCKED locally
    expect(rm.activeRobotIds().sort()).toEqual([12, 13]);
    expect(om.getActiveDriver(21)).toBeDefined();
    expect(om.getActiveDriver(22)).toBeDefined();
    expect(robot12.driver.motionLockController!().isLocked()).toBe(true); // locked (still persistUnknown from the fresh journal, or ownershipRemoved)
    const failed = await alerts();
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: robot 12") && /KEPT attached and locked/.test(a) && /STOP FAILED/.test(a))).toBe(true);
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: adapter 21") && /KEPT attached/.test(a) && /pinned STOP NOT sent \/ FAILED/.test(a))).toBe(true);
    // F-4 — adapter 22's running connection is not its verified row's: D's pipeline refuses the pinned STOP (fail-closed), no write
    // M-4 — the alert names the REAL cause (D's `detail`), not a generic refusal code
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASE_FAILED: adapter 22") && /pinned STOP NOT sent \/ FAILED \(stop_not_pinned:adapter_connection_stale\)/.test(a))).toBe(true);
    expect(order.filter((o) => o.startsWith("ot:")).every((o) => o.startsWith("ot:run"))).toBe(true);
    expect(failed.some((a) => a.startsWith("EDGE_DEVICE_RELEASED"))).toBe(false); // never a false "released"

    // the STOP now succeeds but the robot can NOT be locked locally (a lock-less driver) ⇒ still kept, alert says why
    robotStopFails = false;
    const ctrl = robot12.driver.motionLockController;
    (robot12.driver as { motionLockController?: unknown }).motionLockController = undefined;
    await gw.reconcileDevices(rt, "no lock");
    expect(rm.activeRobotIds().sort()).toEqual([12, 13]);
    expect((await alerts()).some((a) => /^EDGE_DEVICE_RELEASE_FAILED: robot 12 .*KEPT attached: NOT locked: the driver has no motion lock; STOP done/.test(a))).toBe(true);
    (robot12.driver as { motionLockController?: unknown }).motionLockController = ctrl;
    // the cause is fixed ⇒ the RETRY TIMER (N-2, EDGE_RECONCILE_RETRY_MS) releases both, each after a successful STOP
    otStopFails = false;
    await vi.waitFor(() => expect(rm.activeRobotIds()).toEqual([13]), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeUndefined(), { timeout: 5_000, interval: 50 });
    expect(om.getActiveDriver(22)).toBeDefined(); // the stale-connection adapter stays attached (fail-closed)
    const after = await alerts();
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: robot 12 .*locked \(generation \d+[^)]*\), STOP done, session closed/.test(a))).toBe(true);
    // M-2 (Đợt 12 N) — the quiesce's lock reaches the detach. Final fix wave R-12-e I-2: a confirmed STOP no longer clears a QUIESCE
    // lock (it was cleared, then re-taken after the STOP's journal write — a window for a signed motion): kept, never re-taken
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: robot 12 .*re-taken after the STOP/.test(a))).toBe(false);
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: adapter 21 .*pinned STOP \w+ \(run\), session closed/.test(a))).toBe(true);
    expect(writes).toHaveBeenCalled();
    // central re-delivers a STOP until it holds the ack, and the agent re-acks by design (immediate, then a 2 s back-off; central is
    // idempotent) - so under load 1..n acks may arrive: every one is "done", at least one
    const stopAcks = central.received.locksEvents.filter((r) => r.kind === "command_ack" && r.requestId === 140).map((r) => r.outcome);
    expect(stopAcks.length).toBeGreaterThanOrEqual(1);
    expect(stopAcks.every((x) => x === "done")).toBe(true);

    // ── F-2: robot 12 comes back and robot 14 is added (it never connects) — each through D's per-robot attach; the healthy
    //    robot 13 keeps its session the whole time (no gateway restart, no cycling), robot 14 is retried with a back-off
    // adapter 21 comes back too: its first attach FAILS ⇒ not recorded, retried (fix review 3)
    const otAttaches: number[] = [];
    gw.setEdgeOtLifecycle({
      attach: async (a) => {
        otAttaches.push(a.adapterId);
        return otAttaches.length > 1 ? om.attachOtAdapter(a) : false;
      },
      detach: (id) => om.detachOtAdapter(id),
    });
    const ROBOT14 = { ...base.robots[0], id: 14, code: "rb-14", endpoint: "sim://14" };
    const c12 = connects.filter((e) => e === "sim://12").length; // its boot connect
    central.setConfig({ robots: [...base.robots, ROBOT14], adapters: base.adapters.filter((a) => a.id === 21) });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    await vi.waitFor(() => expect(rm.getActiveRobot(12)).toBeDefined(), { timeout: 5_000, interval: 50 });
    expect(rm.getActiveRobot(12)).not.toBe(robot12); // a NEW session built by D from the verified row
    expect(rm.getActiveRobot(14)).toBeUndefined();
    await vi.waitFor(() => expect(otAttaches.filter((id) => id === 21).length).toBeGreaterThanOrEqual(2), { timeout: 5_000, interval: 50 });
    await vi.waitFor(() => expect(om.getActiveDriver(21)).toBeDefined(), { timeout: 5_000, interval: 50 });
    gw.setEdgeOtLifecycle(null);
    expect(rm.getActiveRobot(13)).toBe(robot13);
    const alerts14At = (await alerts()).filter((x) => x.startsWith("EDGE_DEVICE_ATTACH_FAILED: robot 14")).length;
    await new Promise((r) => setTimeout(r, 2_500)); // several retry windows (EDGE_RECONCILE_RETRY_MS=300, back-off doubling)
    const tries14 = connects.filter((e) => e === "sim://14").length;
    expect(tries14).toBeGreaterThan(1); // retried …
    expect(tries14).toBeLessThan(9); // … with a back-off, not every pass
    expect(connects.filter((e) => e === "sim://12")).toHaveLength(c12 + 1); // ONE re-attach; then not touched again
    expect(rm.getActiveRobot(13)).toBe(robot13); // never cycled by the robot that cannot connect
    // F-2 leftover — the attach failure is alerted AGAIN on a bounded interval (EDGE_ATTACH_ALERT_EVERY_MS=1500), never per
    // attempt (attempts at ~0 / 0.3 / 0.9 / 2.1 s ⇒ alerts at ~0 and ~2.1 s only)
    const a14 = (await alerts()).filter((x) => x.startsWith("EDGE_DEVICE_ATTACH_FAILED: robot 14"));
    expect(alerts14At).toBeGreaterThanOrEqual(1);
    expect(a14.length).toBeGreaterThan(alerts14At);
    expect(a14.length).toBeLessThan(tries14 + 1);
    expect(a14.length).toBeLessThanOrEqual(2);
    expect(a14[0]).toMatch(/owned but NOT attached on this edge \((connect_failed|backoff)/);
    // … and a central STOP for it is answered notOwnedHere (no session here ⇒ central's fallback executes it, R-10-ay)
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 141, kind: "stop", target: { robotId: 14 } }))];
    const t14 = await agent.tick();
    expect(t14.commands.map((c) => [c.requestId, c.outcome])).toEqual([[141, "notOwnedHere"]]);
    central.commands = [];
    await rt.journal.flush();
    await rt.shipper.flushAll();
    expect(central.received.locksEvents.filter((r) => r.kind === "command_ack" && r.requestId === 141).map((r) => r.outcome)).toEqual(["notOwnedHere"]);

    // a rename keeps a session (no attach / detach)
    const nConnects = connects.filter((e) => e !== "sim://14").length;
    central.setConfig({ robots: base.robots.map((r) => ({ ...r, name: "renamed", updatedAt: 99 })), adapters: base.adapters.filter((a) => a.id === 21) });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    expect(rm.getActiveRobot(13)).toBe(robot13);
    expect(connects.filter((e) => e !== "sim://14")).toHaveLength(nConnects);

    // ── G-1 (R-10-az): robot 13's SETTINGS change while still owned ⇒ lock → STOP (D's dispatch) → detach (checked) → attach.
    //    (a) the STOP fails ⇒ the OLD session is kept, locked, alert, nothing detached / attached
    const robot12b = rm.getActiveRobot(12)!;
    order.length = 0;
    robotStopFails = true;
    const changed = (poll: number) => ({ robots: base.robots.map((r) => (r.id === 13 ? { ...r, pollIntervalMs: poll } : r)), adapters: base.adapters.filter((a) => a.id === 21) });
    central.setConfig(changed(777));
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "settings");
    expect(order).toContain("robot:abort:fail");
    expect(rm.getActiveRobot(13)).toBe(robot13);
    expect(robot13.driver.motionLockController!().isLocked()).toBe(true);
    expect((await alerts()).some((x) => /^EDGE_DEVICE_ATTACH_FAILED: robot 13 settings changed .*OLD session is KEPT \(locked\): locked .*STOP FAILED .*session not detached/.test(x))).toBe(true);
    //    (b) the STOP works but D's detach REFUSES (`not_locked`: it sees the lock released) ⇒ the old session is kept, no attach
    robotStopFails = false;
    const lc13 = robot13.driver.motionLockController!();
    const realIsLocked = lc13.isLocked.bind(lc13);
    let refuseOnce = true;
    lc13.isLocked = () => {
      // our check right after the lock passes; the check inside D's detachEdgeRobot is refused once
      if (refuseOnce && (new Error().stack ?? "").includes("detachEdgeRobot")) {
        refuseOnce = false;
        return false;
      }
      return realIsLocked();
    };
    await new Promise((r) => setTimeout(r, 750)); // past robot 13's back-off (a NEW cause is alerted at once)
    const connectsBefore = connects.length;
    await gw.reconcileDevices(rt, "settings");
    expect(refuseOnce).toBe(false);
    expect(rm.getActiveRobot(13)).toBe(robot13);
    expect(connects.filter((e) => e !== "sim://14").length).toBe(connectsBefore - connects.slice(0, connectsBefore).filter((e) => e === "sim://14").length);
    //    (c) the retry: every step succeeds ⇒ a NEW session from the new row; robot 12 never touched
    await vi.waitFor(() => expect(rm.getActiveRobot(13)).not.toBe(robot13), { timeout: 5_000, interval: 50 });
    lc13.isLocked = realIsLocked;
    expect(rm.getActiveRobot(13)!.pollIntervalMs).toBe(777);
    // the lock taken for the reconfigure is persisted (journal) ⇒ the NEW session starts LOCKED: fail-closed, a signed clear resumes motion
    expect(rm.getActiveRobot(13)!.driver.motionLockController!().isLocked()).toBe(true);
    expect(rm.getActiveRobot(12)).toBe(robot12b);
    const g1 = await alerts();
    expect(g1.some((x) => /^EDGE_DEVICE_ATTACH_FAILED: robot 13 settings changed .*detach REFUSED \(not_locked\) — session kept/.test(x))).toBe(true);
    // the whole run: D was never asked to detach an UNLOCKED robot except the forced refusal above
    expect(g1.filter((x) => /detach REFUSED/.test(x))).toHaveLength(1);

    rm._setEdgeRobotBackoffBaseMsForTests(null);
    expect(conn.edgeDbTrapCount()).toBe(0);
  }, 90_000);

  it("★ fix review 5 (N4-1): a live robot session the reconciler did not record is tracked — not wanted ⇒ lock + STOP + detach; wanted ⇒ re-attached from the verified row, no false alert (N4-2): an owned adapter with NO live session ⇒ its STOP is notOwnedHere", async () => {
    const rt = shared.rt!;
    const rm = await import("../robot/robotManager");
    const om = await import("../ot/otManager");
    const gw = await import("./edgeGatewayRuntime");
    const agent = (await import("./edgeExecutionAgent")).currentEdgeExecutionAgent()!;
    process.env.EDGE_RECONCILE_RETRY_MS = "600000"; // no retry timer races this test (the next one is scheduled 10 min out)
    await new Promise((r) => setTimeout(r, 400));
    await gw.reconcileDevices(rt, "settle");
    const anomalies = async () => {
      await rt.journal.flush();
      await rt.shipper.flushAll();
      return central.received.locksEvents.filter((r) => r.kind === "anomaly" && String(r.code).startsWith("EDGE_DEVICE_")).map((r) => `${r.code}: ${r.detail}`);
    };
    const before = (await anomalies()).length;
    const cur = central.makeConfig();
    // the drift N4-1 describes (a session started from a NEWER snapshot than the reconciler's `want`): robots 15 and 16 have
    // live sessions this reconciler never recorded
    const row = (id: number) => ({ ...cur.robots[0], id, code: `rb-${id}`, endpoint: `sim://${id}` });
    expect(await rm.attachEdgeRobot(row(15))).toMatchObject({ ok: true });
    expect(await rm.attachEdgeRobot(row(16))).toMatchObject({ ok: true });
    const s16 = rm.getActiveRobot(16)!;
    central.setConfig({ robots: [...cur.robots, row(16)], adapters: cur.adapters });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    // 15 (not wanted): released through the checked path — locked, STOPped, detached
    expect(rm.getActiveRobot(15)).toBeUndefined();
    const after = (await anomalies()).slice(before);
    expect(after.some((a) => /^EDGE_DEVICE_RELEASED: robot 15 .*locked \(generation \d+[^)]*\), STOP done, session closed/.test(a))).toBe(true);
    // 16 (wanted): quiesced + re-attached from the verified row — tracked, never a false "NOT attached" alert
    expect(rm.getActiveRobot(16)).toBeDefined();
    expect(rm.getActiveRobot(16)).not.toBe(s16);
    expect(after.some((a) => /robot 16/.test(a) && /NOT attached|KEPT/.test(a))).toBe(false);
    // … so when 16 leaves the node it IS released (lock + STOP + detach), never left connected
    central.setConfig({ robots: cur.robots, adapters: cur.adapters });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "barrier");
    expect(rm.getActiveRobot(16)).toBeUndefined();
    expect((await anomalies()).some((a) => /^EDGE_DEVICE_RELEASED: robot 16 .*STOP done, session closed/.test(a))).toBe(true);

    // N4-2 — adapter 21 is owned and recorded by the reconciler, but its driver has dropped: no LIVE session ⇒ notOwnedHere
    const d21 = om.getActiveAdapter(21)!.driver;
    const conn = vi.spyOn(d21, "isConnected").mockReturnValue(false);
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 142, kind: "stop", target: { adapterId: 21 } }))];
    expect((await agent.tick()).commands.map((c) => [c.requestId, c.outcome])).toEqual([[142, "notOwnedHere"]]);
    conn.mockRestore();
    central.commands = [central.sign("cmd", central.commandPayload({ requestId: 143, kind: "stop", target: { adapterId: 21 } }))];
    expect((await agent.tick()).commands.map((c) => [c.requestId, c.outcome])).toEqual([[143, "sent"]]);
    central.commands = [];
    await rt.journal.flush();
    await rt.shipper.flushAll();
    expect(central.received.locksEvents.filter((r) => r.kind === "command_ack" && (r.requestId === 142 || r.requestId === 143)).map((r) => [r.requestId, r.outcome])).toEqual([
      [142, "notOwnedHere"],
      [143, "done"],
    ]);
    expect((await import("../../db/connection")).edgeDbTrapCount()).toBe(0);
  }, 60_000);

  it("★ R-12-e M-5: a reconfigure whose quiesce FAILED leaves the old session quiescing (durable alert, listed in the node health); the settings REVERTED meanwhile (the key matches again) ⇒ the next pass still takes it down and re-attaches — never stuck refusing motion until an edge restart", async () => {
    const rt = shared.rt!;
    const rm = await import("../robot/robotManager");
    const gw = await import("./edgeGatewayRuntime");
    process.env.EDGE_RECONCILE_RETRY_MS = "100";
    const cur = central.makeConfig();
    central.setConfig({ robots: cur.robots, adapters: cur.adapters });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "settle");
    const id = cur.robots[0].id;
    const s0 = rm.getActiveRobot(id)!;
    expect(s0).toBeDefined();
    const orig = s0.driver.runJob.bind(s0.driver);
    let stopFails = true;
    s0.driver.runJob = async (j: { jobType: string }) => (j.jobType === "abort" && stopFails ? { ok: false, status: "failed" as const, error: "controller rejected" } : orig(j as never));
    central.setConfig({ robots: cur.robots.map((r) => (r.id === id ? { ...r, pollIntervalMs: 888 } : r)), adapters: cur.adapters });
    await gw.sendHeartbeat();
    await gw.reconcileDevices(rt, "settings");
    expect(rm.getActiveRobot(id)).toBe(s0); // the quiesce failed: the OLD session is kept …
    expect(rm.robotQuiescing(id)).not.toBeNull(); // … quiescing (refuses motion)
    expect((await gw.getEdgeGatewayHealth()).robotsQuiescing.map((q) => q.robotId)).toContain(id); // visible
    await rt.journal.flush();
    await rt.shipper.flushAll();
    expect(central.received.locksEvents.some((r) => r.kind === "anomaly" && String(r.code) === "EDGE_DEVICE_ATTACH_FAILED" && new RegExp(`robot ${id} settings changed .*QUIESCING`).test(String(r.detail)))).toBe(true); // durable
    // the owner REVERTS the settings: the session key matches again — the quiescing session must still be taken down
    central.setConfig({ robots: cur.robots, adapters: cur.adapters });
    await gw.sendHeartbeat();
    stopFails = false;
    await new Promise((r) => setTimeout(r, 400)); // past the per-robot back-off
    await gw.reconcileDevices(rt, "reverted");
    await vi.waitFor(() => expect(rm.getActiveRobot(id)).not.toBe(s0), { timeout: 5_000, interval: 50 });
    expect(rm.getActiveRobot(id)).toBeDefined(); // re-attached from the verified row
    expect(rm.robotQuiescing(id)).toBeNull();
    expect((await gw.getEdgeGatewayHealth()).robotsQuiescing).toEqual([]);
    process.env.EDGE_RECONCILE_RETRY_MS = "600000";
  }, 60_000);

  it("★ G-2 (R-10-az): only `{ ok: true }` from D's lifecycle is ok — a bare true, a truthy non-boolean, undefined are NOT; reason + detail carried", async () => {
    const { lifecycleResult } = await import("./edgeGatewayRuntime");
    expect(lifecycleResult({ ok: true }, "x")).toEqual({ ok: true });
    expect(lifecycleResult(true, "outside")).toEqual({ ok: false, reason: "outside" });
    expect(lifecycleResult({ ok: "yes" }, "outside")).toEqual({ ok: false, reason: "outside" });
    expect(lifecycleResult(undefined, "outside")).toEqual({ ok: false, reason: "outside" });
    expect(lifecycleResult({ ok: false, reason: "not_locked" }, "x")).toEqual({ ok: false, reason: "not_locked" });
    expect(lifecycleResult({ ok: false, reason: "error", detail: "boom" }, "x")).toEqual({ ok: false, reason: "error: boom" });
  });
});
