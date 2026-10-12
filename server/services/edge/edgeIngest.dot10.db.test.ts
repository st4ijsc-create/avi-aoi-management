/**
 * doc 81 Đợt 10 task B — central ingest on the REAL `_test` DB: telemetry, robot states (with the CENTRALLY derived e-stop and
 * D6 trust), program checks. Covered: only OWNED devices are written (A3 — B's samples / states / readings for A's devices
 * write 0 rows), A5 (a trust field ⇒ 400; an e-stop without a (node, robot) maker-checker approval ⇒ a PLAIN safety event,
 * no trust row; with an approval of the current digest and a trusted vendor ⇒ the trusted origin edge_robot_telemetry; a
 * digest change ⇒ plain again), the robot_state cursor.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupKit, type Kit } from "./__edgeCentralKit.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
const count = async (q: Promise<Array<{ n: number }>>) => Number((await q)[0].n);
const epoch = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

describe.skipIf(!onTest)("doc 81 Đợt 10 B — ingest (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("B10ING");
  }, 120_000);
  afterAll(async () => {
    await k?.teardown();
  }, 120_000);

  it("★ telemetry: A's samples of its adapter are stored (machine / device from central's row); A's samples of B's adapter ⇒ 0 rows", async () => {
    const { telemetryForNode } = await import("./edgeIngestCentral");
    const ts = Date.now() - 1000;
    const ok = await telemetryForNode(await k.principal("A"), { samples: [{ adapterId: k.ids.adapterA, tagKey: "speed_sp", ts, value: 42, quality: "good" }] });
    expect(ok).toMatchObject({ http: 200, data: { accepted: 1, refused: 0 } });
    const rows = await k.sql`SELECT "machineId", "deviceId", metric FROM ot_telemetry WHERE "deviceId" = ${`AA-${k.DAU}`}`;
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ machineId: k.ids.mOtA, metric: "speed_sp" });
    const foreign = await telemetryForNode(await k.principal("A"), { samples: [{ adapterId: k.ids.adapterB, tagKey: "speed_sp", ts, value: 1 }] });
    expect(foreign).toMatchObject({ http: 200, data: { accepted: 0, refused: 1 } });
    expect(await count(k.sql`SELECT count(*)::int AS n FROM ot_telemetry WHERE "deviceId" = ${`AB-${k.DAU}`}`)).toBe(0);
    // strict: machineId / deviceId / trust keys are refused (central derives them)
    expect((await telemetryForNode(await k.principal("A"), { samples: [{ adapterId: k.ids.adapterA, tagKey: "x", ts, value: 1, machineId: 1 }] })).http).toBe(400);
  });

  it("★ A5a/A3: a trust field ⇒ 400; B's state of A's robot ⇒ nothing written; A's own states ⇒ rows + registry; the e-stop is PLAIN without an approval", async () => {
    const { robotStateForNode } = await import("./edgeIngestCentral");
    const ep = epoch();
    const st = (seq: number, estop: boolean, over: Record<string, unknown> = {}) => ({ seq, robotId: k.ids.robotA, ts: Date.now(), mode: "auto", busy: false, estop, ...over });
    for (const bad of [{ trusted: true }, { origin: "robot_telemetry" }, { safetyCritical: true }]) {
      expect((await robotStateForNode(await k.principal("A"), { epoch: ep, stream: "robot_state", records: [st(1, true, bad)] })).http).toBe(400);
    }
    expect((await robotStateForNode(await k.principal("B"), { epoch: epoch(), stream: "robot_state", records: [st(1, true)] })).http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM robot_telemetry WHERE "robotId" = ${k.ids.robotA}`)).toBe(0);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM safety_events WHERE "robotId" = ${k.ids.robotA}`)).toBe(0);
    const r = await robotStateForNode(await k.principal("A"), { epoch: ep, stream: "robot_state", records: [st(1, false), st(2, true), st(3, true)] });
    expect(r).toMatchObject({ http: 200, data: { ackedSeq: 3, applied: 3 } });
    expect(await count(k.sql`SELECT count(*)::int AS n FROM robot_telemetry WHERE "robotId" = ${k.ids.robotA}`)).toBe(3);
    expect((await k.sql`SELECT status FROM robots WHERE id = ${k.ids.robotA}`)[0].status).toBe("estop");
    // ONE event (the transition), plain: no trust row
    const ev = await k.sql`SELECT id FROM safety_events WHERE "robotId" = ${k.ids.robotA}`;
    expect(ev.length).toBe(1);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM safety_event_trust WHERE "eventId" = ${ev[0].id}`)).toBe(0);
  });

  it("★ D6: with a maker-checker approval of the CURRENT digest and a trusted vendor the e-stop is recorded under edge_robot_telemetry; a digest change ⇒ plain again", async () => {
    const { robotStateForNode, edgeRobotTrustDigest } = await import("./edgeIngestCentral");
    const { requestEdgeRobotTrust, approveEdgeRobotTrust } = await import("./edgeControlSchema");
    const { getDb } = await import("../../db/connection");
    const d = (await getDb())!;
    const [robot] = await k.sql`SELECT id, code, vendor, model, kind, endpoint, "connectionOptions", "stationId", "lineId" FROM robots WHERE id = ${k.ids.robotA}`;
    const digest = edgeRobotTrustDigest(k.ids.nodeA, robot as never);
    await requestEdgeRobotTrust(d as never, { nodeId: k.ids.nodeA, robotId: k.ids.robotA, digest, editorUserId: k.u.admin });
    await approveEdgeRobotTrust(d as never, { nodeId: k.ids.nodeA, robotId: k.ids.robotA, digest, approverUserId: k.u.admin2 });
    const ep = epoch();
    const st = (seq: number, estop: boolean) => ({ seq, robotId: k.ids.robotA, ts: Date.now() + seq, estop });
    expect((await robotStateForNode(await k.principal("A"), { epoch: ep, stream: "robot_state", records: [st(1, false), st(2, true)] })).http).toBe(200);
    const [ev] = await k.sql`SELECT id FROM safety_events WHERE "robotId" = ${k.ids.robotA} ORDER BY id DESC LIMIT 1`;
    const trust = await k.sql`SELECT origin FROM safety_event_trust WHERE "eventId" = ${ev.id}`;
    expect(trust.map((t) => t.origin)).toEqual(["edge_robot_telemetry"]);
    // the robot's endpoint changes ⇒ the approved digest no longer matches ⇒ plain
    await k.sql`UPDATE robots SET endpoint = 'tcp://10.0.0.2' WHERE id = ${k.ids.robotA}`;
    expect((await robotStateForNode(await k.principal("A"), { epoch: ep, stream: "robot_state", records: [st(3, false), st(4, true)] })).http).toBe(200);
    const [ev2] = await k.sql`SELECT id FROM safety_events WHERE "robotId" = ${k.ids.robotA} ORDER BY id DESC LIMIT 1`;
    expect(ev2.id).not.toBe(ev.id);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM safety_event_trust WHERE "eventId" = ${ev2.id}`)).toBe(0);
  });

  it("★ program checks (D7): A's readings of its adapter are stored (stamped with the owner epoch); a reading of B's adapter is refused, 0 rows", async () => {
    const { programChecksForNode } = await import("./edgeIngestCentral");
    const r = await programChecksForNode(await k.principal("A"), { readings: [...k.readings([k.ids.adapterA]), { adapterId: k.ids.adapterB, status: "verified", checksum: "x", readAt: Date.now() }] });
    expect(r).toMatchObject({ http: 200, data: { accepted: 1, refused: [k.ids.adapterB] } });
    const rows = await k.sql`SELECT "adapterId", checksum, "ownerEpoch" FROM edge_node_program_reports WHERE "edgeNodeId" = ${k.ids.nodeA}`;
    expect(rows.map((x) => x.adapterId)).toEqual([k.ids.adapterA]);
    expect(Number(rows[0].ownerEpoch)).toBeGreaterThanOrEqual(1);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM edge_node_program_reports WHERE "adapterId" = ${k.ids.adapterB}`)).toBe(0);
    expect((await programChecksForNode(await k.principal("V1"), { readings: k.readings([k.ids.adapterA]) })).code).toBe("protocol_version");
  });
});
