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
