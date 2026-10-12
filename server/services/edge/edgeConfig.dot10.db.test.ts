/**
 * doc 81 Đợt 10 task B — the signed config, pull, claim (run package), heartbeat and command queue of protocol v2 on the REAL
 * `_test` DB, verified with the EDGE's trust path (pinned keyset from the keyring files + edgeTrust's typed verifiers).
 * Covered: A3 scope — A's config holds only A's devices, none of B's codes or secrets (string scan); D4 — A's sealed
 * password arrives decrypted; the config / keyset verify and chain on the edge; notModified; the claim's signed run package
 * (verified stops, no server-only context key, ownership refused for a foreign target, N5 rate limit); the pull's signed
 * commands only to the owner; the v2 heartbeat (identity never changed by the node; v1 / legacy paths refused for a v2 node);
 * N4 (a fresh heartbeat is never "unreachable"; capacity is said); N6 (runtime off ⇒ unavailable).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupKit, kitSteps, type Kit } from "./__edgeCentralKit.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;

describe.skipIf(!onTest)("doc 81 Đợt 10 B — config / pull / claim / heartbeat (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("B10CFG");
  }, 120_000);
  afterAll(async () => {
    await k?.teardown();
  }, 120_000);

  it("★ A3/D4: A's signed config verifies on A's edge, holds ONLY A's devices (decrypted secret), none of B's codes or secrets; notModified by hash", async () => {
    const { configForNode } = await import("./edgeConfigCentral");
    const { verifyEdgeConfig } = await import("./edgeTrust");
    const pA = await k.principal("A");
    const r = await configForNode(pA, {});
    expect(r.http, JSON.stringify(r)).toBe(200);
    const env = (r.data as { config: unknown }).config;
    const store = await k.store(k.ids.nodeA);
    const v = verifyEdgeConfig(store, env, { credentialId: pA.credentialId, lastConfigVersion: null });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const cfg = (v as { config: Record<string, any> }).config;
    expect(cfg.node).toMatchObject({ id: k.ids.nodeA, code: `NA-${k.DAU}`, credentialId: pA.credentialId, factoryCode: `F-${k.DAU}` });
    expect(cfg.adapters.map((a: { id: number }) => a.id)).toEqual([k.ids.adapterA]);
    expect(cfg.robots.map((x: { id: number }) => x.id)).toEqual([k.ids.robotA]);
    expect(cfg.adapters[0].connectionOptions.password).toBe("A-PLC-SECRET");
    expect(cfg.adapters[0].tags.find((t: { tagKey: string }) => t.tagKey === "stop_cmd").stopValue).toBe(true);
    const text = JSON.stringify(r.data);
    for (const foreign of [`AB-${k.DAU}`, `RB-${k.DAU}`, `NB-${k.DAU}`, "B-PLC-SECRET", "B-ROBOT-SECRET"]) expect(text).not.toContain(foreign);
    // the keyset in the config chains on the edge's store
    expect(store.acceptKeysetUpdate(cfg.keyset).ok).toBe(true);
    // B's config of B is not A's
    const rb = await configForNode(await k.principal("B"), {});
    expect(JSON.stringify(rb.data)).not.toContain("A-PLC-SECRET");
    // the hash it holds ⇒ notModified
    expect(await configForNode(pA, { configHash: (r.data as { configHash: string }).configHash })).toMatchObject({ http: 200, data: { notModified: true } });
    // a change bumps the version (strictly increasing)
    await k.sql`UPDATE device_tags SET address = 'D101', "updatedAt" = now() WHERE "adapterId" = ${k.ids.adapterA} AND "tagKey" = 'speed_sp'`;
    const r2 = await configForNode(pA, { configHash: (r.data as { configHash: string }).configHash });
    const v2 = verifyEdgeConfig(store, (r2.data as { config: unknown }).config, { credentialId: pA.credentialId, lastConfigVersion: cfg.configVersion });
    expect(v2.ok, JSON.stringify(v2)).toBe(true);
    expect((v2 as { config: { configVersion: number } }).config.configVersion).toBeGreaterThan(cfg.configVersion);
    // a v1 node ⇒ protocol_version; strict body
    expect((await configForNode(await k.principal("V1"), {})).code).toBe("protocol_version");
    expect((await configForNode(pA, { nodeId: k.ids.nodeB })).http).toBe(400);
  });

  it("★ node scope of the ownership scans: A's owned set never holds B's robots / adapters (and the reverse)", async () => {
    const { devicesOfNode, ownedRobotIds, ownedAdapterIds, centralDb } = await import("./edgeCentralCommon");
    const d = await centralDb();
    const a = await devicesOfNode(d, k.ids.nodeA);
    const b = await devicesOfNode(d, k.ids.nodeB);
    expect(a).toEqual({ robots: [k.ids.robotA], adapters: [k.ids.adapterA] });
    expect(b).toEqual({ robots: [k.ids.robotB], adapters: [k.ids.adapterB] });
    expect([...(await ownedRobotIds(d, k.ids.nodeA, [k.ids.robotA, k.ids.robotB]))]).toEqual([k.ids.robotA]);
    expect([...(await ownedAdapterIds(d, k.ids.nodeA, [k.ids.adapterA, k.ids.adapterB]))]).toEqual([k.ids.adapterA]);
  });

  it("★ R-10-au: the pull's configVersion is LIVE — with a long config cache, a device given to the node moves the version in the very next pull (unchanged ownership ⇒ the cached version)", async () => {
    const { pullForNodeV2 } = await import("./edgeExecutionCentral");
    const { __resetEdgeConfigCacheForTests } = await import("./edgeConfigCentral");
    const prevMs = process.env.EDGE_CONFIG_CACHE_MS;
    process.env.EDGE_CONFIG_CACHE_MS = "600000";
    __resetEdgeConfigCacheForTests();
    let extra = 0;
    try {
      const v = async () => {
        const r = await pullForNodeV2(await k.principal("A"), {});
        expect(r.http, JSON.stringify(r)).toBe(200);
        return (r.data as { configVersion: number }).configVersion;
      };
      const v1 = await v();
      expect(v1).toBeGreaterThan(0);
      expect(await v()).toBe(v1); // cached: nothing changed
      extra = Number((await k.sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "edgeNodeId") VALUES (${`RAU-${k.DAU}`}, 'kit au robot', 'sim', 'sim://au', true, ${k.ids.line}, ${k.ids.st}, ${k.ids.nodeA}) RETURNING id`)[0].id);
      const v2 = await v();
      expect(v2).toBeGreaterThan(v1); // live: the new device moves it at once, the 10-minute cache notwithstanding
    } finally {
      if (prevMs === undefined) delete process.env.EDGE_CONFIG_CACHE_MS;
      else process.env.EDGE_CONFIG_CACHE_MS = prevMs;
      __resetEdgeConfigCacheForTests();
      if (extra) {
        await k.sql`UPDATE robots SET "edgeNodeId" = NULL WHERE id = ${extra}`.catch(() => undefined);
        await k.sql`DELETE FROM robots WHERE id = ${extra}`.catch((err) => console.warn(`[test] au robot kept: ${(err as Error).message}`));
      }
    }
  });

  it("★ I-3 / I-4 (R-10-am): two factories — only PLC rows EXPLICITLY guarding A's devices (or A's factory-wide row) ship, as a projection; a robot owned by A but placed in ANOTHER factory never ships, cannot be authorised or ingested", async () => {
    const { configForNode } = await import("./edgeConfigCentral");
    const { verifyEdgeConfig } = await import("./edgeTrust");
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const f2 = await one(k.sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F2-${k.DAU}`}, 'kit other', true) RETURNING id`);
    const w2 = await one(k.sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f2}, ${`W2-${k.DAU}`}, 'kit ws2') RETURNING id`);
    const l2 = await one(k.sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w2}, ${`L2-${k.DAU}`}, 'kit line2') RETURNING id`);
    const st2 = await one(k.sql`INSERT INTO stations ("lineId", code, name) VALUES (${l2}, ${`S2-${k.DAU}`}, 'kit st2') RETURNING id`);
    const foreignRobot = await one(k.sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "edgeNodeId", "connectionOptions") VALUES (${`RX-${k.DAU}`}, 'kit foreign robot', 'sim', 'sim://x', true, ${l2}, ${st2}, ${k.ids.nodeA}, ${k.sql.json({ password: "F2-ROBOT-SECRET" })}) RETURNING id`);
    const plc = (code: string, cols: Record<string, number | null>) =>
      one(k.sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "robotId", "stationId", "lineId", "factoryId", enabled, notes, "corporateCode")
                VALUES (${`${code}-${k.DAU}`}, ${`name ${code}`}, 'generic', 'sim', ${`tcp://${code}`}, ${cols.robotId ?? null}, ${cols.stationId ?? null}, ${cols.lineId ?? null}, ${cols.factoryId ?? null}, true, 'SECRET NOTE', 'CORP') RETURNING id`);
    const ids = {
      robotA: await plc("P-RA", { robotId: k.ids.robotA }),
      stationA: await plc("P-SA", { stationId: k.ids.st }),
      factoryA: await plc("P-FA", { factoryId: k.ids.factory }),
      factory2: await plc("P-F2", { factoryId: f2 }),
      station2: await plc("P-S2", { stationId: st2 }),
      robotB: await plc("P-RB", { robotId: k.ids.robotB }),
      untargeted: await plc("P-UN", {}),
      foreignRobot: await plc("P-RX", { robotId: foreignRobot }),
      // names A's robot but is labelled with ANOTHER factory: inconsistent ⇒ never shipped (fail closed)
      robotAInF2: await plc("P-RAF2", { robotId: k.ids.robotA, factoryId: f2 }),
    };
    try {
      const pA = await k.principal("A");
      const r = await configForNode(pA, {});
      expect(r.http, JSON.stringify(r)).toBe(200);
      const v = verifyEdgeConfig(await k.store(k.ids.nodeA), (r.data as { config: unknown }).config, { credentialId: pA.credentialId, lastConfigVersion: null });
      expect(v.ok, JSON.stringify(v)).toBe(true);
      const cfg = (v as { config: Record<string, any> }).config;
      const shipped = cfg.safetyPlcConfigs.map((c: { id: number }) => c.id).sort((a: number, b: number) => a - b);
      // robotB's row guards B's robot — but robot B sits on A's station: still not A's device ⇒ only by station row
      expect(shipped).toEqual([ids.robotA, ids.stationA, ids.factoryA].sort((a, b) => a - b));
      const text = JSON.stringify(r.data);
      for (const leak of ["SECRET NOTE", "CORP", `P-RAF2-${k.DAU}`, `P-F2-${k.DAU}`, `P-S2-${k.DAU}`, `P-UN-${k.DAU}`, `RX-${k.DAU}`, "F2-ROBOT-SECRET", "name P-RA"]) expect(text, leak).not.toContain(leak);
      expect(cfg.robots.map((x: { id: number }) => x.id)).not.toContain(foreignRobot);
      // the foreign-factory robot: refused at ingest and in ownership scans
      const { robotStateForNode } = await import("./edgeIngestCentral");
      const e = Array.from({ length: 32 }, () => "a").join("");
      expect((await robotStateForNode(pA, { epoch: e, stream: "robot_state", records: [{ seq: 1, robotId: foreignRobot, ts: Date.now(), estop: false }] })).http).toBe(200);
      expect(Number((await k.sql`SELECT count(*)::int AS n FROM robot_telemetry WHERE "robotId" = ${foreignRobot}`)[0].n)).toBe(0);
      const { deviceInNodeFactory, centralDb } = await import("./edgeCentralCommon");
      expect(await deviceInNodeFactory(await centralDb(), k.ids.nodeA, "robot", foreignRobot)).toBe(false);
      expect(await deviceInNodeFactory(await centralDb(), k.ids.nodeA, "robot", k.ids.robotA)).toBe(true);
    } finally {
      await k.sql`DELETE FROM safety_plc_configs WHERE id IN ${k.sql(Object.values(ids))}`;
      await k.sql`DELETE FROM robot_telemetry WHERE "robotId" = ${foreignRobot}`;
      await k.sql`DELETE FROM robots WHERE id = ${foreignRobot}`.catch((err) => console.warn(`[test] foreign robot kept: ${(err as Error).message}`));
      await k.sql`DELETE FROM stations WHERE id = ${st2}`.catch(() => undefined);
      await k.sql`DELETE FROM production_lines WHERE id = ${l2}`.catch(() => undefined);
      await k.sql`DELETE FROM workshops WHERE id = ${w2}`.catch(() => undefined);
      await k.sql`DELETE FROM factories WHERE id = ${f2}`.catch(() => undefined);
    }
  });

  it("★ claim (v2): a signed run package the edge verifies — verified STOPs (robot abort, pinned OT stop), no server-only context key; foreign target ⇒ not_owned; N5 rate limit", async () => {
    const s = kitSteps(k);
    const c = await import("./edgeExecutionCentral");
    const { verifyEdgeRunPackage } = await import("./edgeTrust");
    const run = await k.newRun("pkg", "A", [s.gate, s.otWrite, s.otPinnedStop, s.otUnpinnedStop, s.robotStop]);
    await k.sql`UPDATE orchestration_runs SET "contextJson" = ${k.sql.json({ foeRejectClaim: "server-secret", branchX: "then" })} WHERE id = ${run.runId}`;
    const pA = await k.principal("A");
    const r = await c.claimForNodeV2(pA, run.runId, { claimSeq: 0, defHash: run.defHash, programChecks: k.readings([k.ids.adapterA]) });
    expect(r.http, JSON.stringify(r)).toBe(200);
    const v = verifyEdgeRunPackage(await k.store(k.ids.nodeA), r.data!.package, { runId: run.runId, claimSeq: r.data!.claimSeq, credentialId: pA.credentialId } as never);
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const pkg = (v as { pkg: Record<string, any> }).pkg;
    expect(pkg.verifiedStops.map((x: { stepId: string }) => x.stepId).sort()).toEqual(["p1", "s1"]);
    expect(pkg.verifiedStops.find((x: { stepId: string }) => x.stepId === "p1")).toMatchObject({ kind: "ot", adapterId: k.ids.adapterA, pins: [{ tagKey: "stop_cmd", value: true }] });
    expect(pkg.context).toEqual({ branchX: "then" });
    expect(pkg.owner).toEqual({ id: k.u.owner, role: "admin" });
    expect(pkg.resolvedAdapters.map((x: { stepId: string }) => x.stepId).sort()).toEqual(["o1", "p1", "p2"]);
    // node B cannot verify it as its own
    expect(verifyEdgeRunPackage(await k.store(k.ids.nodeB), r.data!.package, { runId: run.runId, claimSeq: r.data!.claimSeq, credentialId: pA.credentialId } as never).ok).toBe(false);
    // a run targeting B's adapter, assigned to A ⇒ not claimed
    const bad = await k.newRun("foreign", "A", [s.otWriteB]);
    expect((await c.claimForNodeV2(pA, bad.runId, { claimSeq: 0, defHash: bad.defHash, programChecks: [] })).code).toBe("not_owned");
    expect((await k.sql`SELECT status FROM orchestration_runs WHERE id = ${bad.runId}`)[0].status).toBe("queued");
    // N5 — a second attempt within the interval is refused BEFORE any work
    process.env.EDGE_CLAIM_MIN_INTERVAL_MS = "60000";
    try {
      c.__resetClaimRateForTests();
      expect((await c.claimForNodeV2(pA, bad.runId, { claimSeq: 0, defHash: bad.defHash, programChecks: [] })).code).toBe("not_owned");
      expect((await c.claimForNodeV2(pA, bad.runId, { claimSeq: 0, defHash: bad.defHash, programChecks: [] })).code).toBe("rate_limited");
    } finally {
      process.env.EDGE_CLAIM_MIN_INTERVAL_MS = "0";
    }
    // B claims A's run ⇒ the same 404 as a missing run
    const b = await c.claimForNodeV2(await k.principal("B"), run.runId, { claimSeq: 1, defHash: run.defHash, programChecks: [] });
    expect(b.http).toBe(404);
  });

  it("★ pull (v2): a central lock request reaches ONLY the owner, signed; deliveredAt stamped once; signature verifies on the edge", async () => {
    const c = await import("./edgeExecutionCentral");
    const { verifyEdgeCommand } = await import("./edgeTrust");
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const q = await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "operator lock", requestedBy: k.u.admin });
    const pA = await k.principal("A");
    const a = await c.pullForNodeV2(pA, {});
    expect(a.http, JSON.stringify(a)).toBe(200);
    const store = await k.store(k.ids.nodeA);
    const verified = a.data!.commands.map((env) => verifyEdgeCommand(store, env, { credentialId: pA.credentialId } as never)).filter((x) => x.ok) as Array<{ command: { requestId: number; kind: string } }>;
    expect(verified.map((x) => x.command.requestId)).toContain(q.requestId);
    expect(verified.find((x) => x.command.requestId === q.requestId)!.command.kind).toBe("lock");
    expect((await k.sql`SELECT "deliveredAt" FROM robot_motion_lock_requests WHERE id = ${q.requestId}`)[0].deliveredAt).not.toBeNull();
    const b = await c.pullForNodeV2(await k.principal("B"), {});
    // the payloads B receives (canonical JSON text inside each envelope) never name A's request
    expect(b.data!.commands.map((env) => JSON.parse(env.payload).requestId)).not.toContain(q.requestId);
    expect(b.data!.commands.every((env) => JSON.parse(env.payload).nodeId === k.ids.nodeB)).toBe(true);
    const pB = await k.principal("B");
    const bStore = await k.store(k.ids.nodeB);
    // A's signed commands never verify on B's edge (node binding)
    expect(a.data!.commands.every((env) => verifyEdgeCommand(bStore, env, { credentialId: pB.credentialId } as never).ok === false)).toBe(true);
    expect(a.data).toMatchObject({ node: `NA-${k.DAU}`, protocolVersion: 2, keysetVersion: 1 });
    expect(a.data!.configVersion).toBeGreaterThan(0);
    // the v1 handler is never used for a v2 node through the route (byVersion) — the v2 pull refuses a v1 node
    expect((await c.pullForNodeV2(await k.principal("V1"), {})).code).toBe("protocol_version");
  });

  it("★ pull (v2): an aborted run with an unconfirmed STOP ships a SIGNED sweep picture (credentialId, abortedAt) to its node only", async () => {
    const s = kitSteps(k);
    const c = await import("./edgeExecutionCentral");
    const { verifyEdgeSweepPicture } = await import("./edgeTrust");
    const run = await k.newRun("sweep", "A", [s.gate, s.robotStop]);
    await k.sql`UPDATE orchestration_runs SET status = 'aborted', "finishedAt" = now() WHERE id = ${run.runId}`;
    await k.sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson") VALUES (${run.runId}, 'abort:s1', 'command', 'failed', 0, ${k.sql.json({ stepId: "s1" })})`;
    const pA = await k.principal("A");
    const a = await c.pullForNodeV2(pA, {});
    const mine = a.data!.stopsUnconfirmed.find((x) => x.runId === run.runId);
    expect(mine).toBeTruthy();
    const v = verifyEdgeSweepPicture(await k.store(k.ids.nodeA), mine!.picture, { credentialId: pA.credentialId, runId: run.runId });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const pic = (v as { picture: Record<string, any> }).picture;
    expect(typeof pic.abortedAt).toBe("number");
    expect(pic.verifiedStops.map((x: { stepId: string }) => x.stepId)).toContain("s1");
    const b = await c.pullForNodeV2(await k.principal("B"), {});
    expect(b.data!.stopsUnconfirmed.map((x) => x.runId)).not.toContain(run.runId);
  });

  it("★ heartbeat (v2) from the principal: liveness / capacity recorded, identity untouched; self-registration and the legacy heartbeat refused for v2", async () => {
    const coord = await import("./edgeCoordinator");
    const pA = await k.principal("A");
    const before = (await k.sql`SELECT name, "factoryCode", "assignedLineCodes" FROM edge_nodes WHERE id = ${k.ids.nodeA}`)[0];
    const hb = await coord.heartbeatFromNode(pA, {
      protocolVersion: 2,
      status: "online",
      version: "10.0.0",
      capacity: { liveRuns: 2, maxRuns: 2 },
      journal: { epoch: "0".repeat(32), backlog: 0, bytes: 10, full: false },
      configHash: null,
      keysetVersion: 1,
      wallClockMs: Date.now(),
      uptimeMs: 1000,
    });
    expect(hb.http, JSON.stringify(hb)).toBe(200);
    expect(hb.data).toMatchObject({ keysetVersion: 1 });
    const row = (await k.sql`SELECT name, "factoryCode", "assignedLineCodes", status, "healthJson", version FROM edge_nodes WHERE id = ${k.ids.nodeA}`)[0];
    expect({ name: row.name, factoryCode: row.factoryCode, assignedLineCodes: row.assignedLineCodes }).toEqual(before);
    expect(row.version).toBe("10.0.0");
    expect((typeof row.healthJson === "string" ? JSON.parse(row.healthJson) : row.healthJson).capacity).toEqual({ liveRuns: 2, maxRuns: 2 });
    // strict: a node cannot send its name / factory
    expect((await coord.heartbeatFromNode(pA, { factoryCode: "X" })).http).toBe(400);
    // the legacy code-based paths are refused for a v2 node
    expect((await coord.registerNode({ code: `NA-${k.DAU}`, name: "renamed", factoryCode: "OTHER" })).ok).toBe(false);
    expect((await coord.heartbeat({ code: `NA-${k.DAU}` })).ok).toBe(false);
    expect((await k.sql`SELECT name, "factoryCode" FROM edge_nodes WHERE id = ${k.ids.nodeA}`)[0]).toMatchObject({ name: before.name, factoryCode: before.factoryCode });
  });

  it("★ N4: an unclaimed run of a node with a FRESH heartbeat at capacity is NOT held — it says 'waiting for edge capacity'; a stale node's run is held", async () => {
    const s = kitSteps(k);
    const c = await import("./edgeExecutionCentral");
    process.env.EDGE_UNCLAIMED_HOLD_MS = "5000";
    try {
      const run = await k.newRun("n4", "A", [s.gate]);
      await new Promise((r) => setTimeout(r, 5_600)); // > EDGE_UNCLAIMED_HOLD_MS (5 s, the floor)
      // A heartbeat at capacity just now (previous test)
      await c.holdUnclaimedEdgeRuns(k.ids.nodeA);
      const [r1] = await k.sql`SELECT status, "contextJson" FROM orchestration_runs WHERE id = ${run.runId}`;
      expect(r1.status).toBe("queued");
      expect((typeof r1.contextJson === "string" ? JSON.parse(r1.contextJson) : r1.contextJson).edgeWaiting).toBe("capacity");
      // the heartbeat goes stale ⇒ held as unreachable
      await k.sql`UPDATE edge_nodes SET "lastHeartbeatAt" = now() - interval '2 hours' WHERE id = ${k.ids.nodeA}`;
      expect(await c.holdUnclaimedEdgeRuns(k.ids.nodeA)).toContain(run.runId);
      expect((await k.sql`SELECT status FROM orchestration_runs WHERE id = ${run.runId}`)[0].status).toBe("held");
    } finally {
      delete process.env.EDGE_UNCLAIMED_HOLD_MS;
    }
  }, 30_000);

  it("★ N6: EDGE_RUNTIME_ENABLED off ⇒ resolveAssignableNode answers `unavailable` (a start is refused, nothing created)", async () => {
    const c = await import("./edgeExecutionCentral");
    process.env.EDGE_RUNTIME_ENABLED = "false";
    try {
      expect(await c.resolveAssignableNode(`NA-${k.DAU}`, null)).toEqual({ kind: "unavailable" });
    } finally {
      process.env.EDGE_RUNTIME_ENABLED = "true";
    }
    expect(await c.resolveAssignableNode(`NA-${k.DAU}`, null)).toEqual({ kind: "node", id: k.ids.nodeA });
  });
});
