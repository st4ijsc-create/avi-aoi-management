/**
 * doc 81 Đợt 10 task F1 (design §5a; rulings R-10-aq, R-10-bi) — the TWO-PROCESS, NO-DB end-to-end suite.
 *   CENTRAL = this process: the real /api/v1 node protocol v2 + engine + the real tRPC robot router behind createContext, on its
 *     own port, against `aoi_management_test`;
 *   EDGE = `server/edge/edgeGatewayMain.ts` in a spawned process with NO DATABASE_URL / PG* / JWT_SECRET /
 *     SECRET_ENCRYPTION_KEY and EDGE_DB_TRAP=throw (edgeE2eChild.dot10.test.ts) — they talk only over HTTP.
 *   DEVICES: the SIM robot (edge process), an OT Modbus TCP simulator and a SAFETY-PLC Modbus TCP simulator (port 0, this
 *     process), the PLC's config shipped in the signed config — the safety preflight is ON on both sides (R-10-aq).
 * Provisioning through the operator CLIs (signing key generate + pin, node credential issue), ownership through the admin
 * service. See __edgeE2eHarness.dot10.ts for the instruments; every scenario asserts device counts (the simulators / the
 * edge's counted SIM driver — independent of the product) AND central rows.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const H = vi.hoisted(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "f1-dot10-e2e-session-secret-0123456789abcdef";
  return { dbMode: "ok" as "ok" | "hang", prefix: "\u0000never" };
});
// central's DB can be made to HANG (the L-7 console-STOP bound); at every other moment it is the real _test DB
vi.mock("../../db/connection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/connection")>();
  return {
    ...actual,
    getDb: async (...args: unknown[]) => {
      if (H.dbMode === "hang") return new Promise<never>(() => undefined);
      return (actual.getDb as (...a: unknown[]) => unknown)(...args);
    },
  };
});
// central's robot gateway loads only THIS suite's robots (the shared _test DB holds many other suites' robots) — isolation only
vi.mock("../robot/robotAdapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../robot/robotAdapter")>();
  return { ...actual, loadEnabledRobots: async (...a: Parameters<typeof actual.loadEnabledRobots>) => (await actual.loadEnabledRobots(...a)).filter((r) => String(r.code).includes(H.prefix)) };
});

import { setupCentral, waitFor, sleep, noDbEvidence, type Central, type EdgeProc, type CentralTestHooks } from "./__edgeE2eHarness.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let c: Central;
let edge: EdgeProc;
/** central's own SIM robot sessions (live session of robot C; transient sessions after a transfer to central) */
const central = { calls: [] as Array<{ jobType: string; robotId: number | null; at: number }> };

const motionsOf = (e: EdgeProc, robotId: number) => (e.counts()?.motions ?? []).filter((m) => m.robotId === robotId);
const stopsOf = (e: EdgeProc, robotId: number) => (e.counts()?.stops ?? []).filter((m) => m.robotId === robotId);
/** central's robot_jobs rows written from the edge's NON-STOP ledger records (keyed by the jti; actionId foe-run<id>-<step>-a<n>) */
async function robotJobs(runId: number) {
  const rows = await c.sql`SELECT "jobType", status, count(*)::int AS n FROM robot_jobs WHERE "actionId" LIKE ${`foe-run${runId}-%`} GROUP BY "jobType", status ORDER BY 1, 2`;
  return rows.map((r) => `${r.jobType}:${r.status}:${r.n}`);
}
/** central's ledger rows of the edge's STOP ledger records (no jti: keyed edge-stop:<node>:<idempotencyKey>:<seq>) + the anomalies refusing them */
async function stopLedger(runId: number) {
  const robot = await c.sql`SELECT "jobType", status FROM robot_jobs WHERE "idempotencyKey" LIKE ${`edge-stop:%:run${runId}-%`} ORDER BY id`;
  const ot = await c.sql`SELECT "commandType", status FROM command_log WHERE "idempotencyKey" LIKE ${`edge-stop:%:run${runId}-%`} ORDER BY id`;
  // audit_logs.details is TEXT (JSON written by createAuditLog): filtered as text, parsed here
  const refused = (await c.sql`SELECT details FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityType" = 'orchestration_run' AND "entityId" = ${runId} AND details LIKE '%"anomaly":"stop_ledger_refused"%' ORDER BY id`).map((r) => JSON.parse(String(r.details)) as { stepId: string });
  return { robot: robot.map((r) => `${r.jobType}:${r.status}`), ot: ot.map((r) => `${r.commandType}:${r.status}`), refused: refused.map((r) => r.stepId) };
}
let completeRunId = 0;

/** test-only central pieces (CentralTestHooks): the console's tRPC router and a real engineer session */
const hooks: CentralTestHooks = {
  async trpcRouter() {
    const [{ router }, { robotRouter }] = await Promise.all([import("../../_core/trpc"), import("../../routers/robotRouter")]);
    return router({ robot: robotRouter });
  },
  async mintSession(sql, userId, openId) {
    const { sdk } = await import("../../_core/sdk");
    const t = await sdk.signSession({ openId, appId: "f1-e2e", name: "F1 engineer" }, { expiresInMs: 60 * 60 * 1000 });
    await sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${userId}, ${t}, now() + interval '1 hour', true)`;
    return t;
  },
};

describe.skipIf(!onTest)("doc 81 Đợt 10 F1 — central + edge in two processes, the edge with NO DB (design §5a)", () => {
  beforeAll(async () => {
    c = await setupCentral("F1E", { hooks });
    H.prefix = c.DAU;
    // central's SIM sessions are counted too (the robot it owns; a transient session after an ownership move)
    const { SimRobotDriver } = await import("../robot/drivers/simRobotDriver");
    const proto = SimRobotDriver.prototype as unknown as { connect: (cfg: { endpoint?: string }) => Promise<void>; runJob: (j: { jobType: string }) => Promise<unknown>; abort: () => Promise<void> };
    const of = (self: { _ep?: string }) => {
      const m = /#(\d+)$/.exec(self._ep ?? "");
      return m ? Number(m[1]) : null;
    };
    const [oc, orj, oab] = [proto.connect, proto.runJob, proto.abort];
    proto.connect = async function (this: { _ep?: string }, cfg) {
      this._ep = String(cfg?.endpoint ?? "");
      return oc.call(this, cfg);
    };
    proto.runJob = async function (this: { _ep?: string }, j) {
      central.calls.push({ jobType: String(j?.jobType), robotId: of(this), at: Date.now() });
      return orj.call(this, j);
    };
    proto.abort = async function (this: { _ep?: string }) {
      central.calls.push({ jobType: "driver.abort", robotId: of(this), at: Date.now() });
      return oab.call(this);
    };
    edge = await c.spawnEdge("a1");
    await c.clearEdgeLock(c.ids.robotA, edge); // the new authority starts LOCKED (fresh journal / ownerChanged) — the operator clears it
  }, 300_000);
  afterAll(async () => {
    H.dbMode = "ok";
    try {
      const { stopRobots } = await import("../robot/robotManager");
      await stopRobots();
    } catch {
      /* not started */
    }
    await c?.teardown();
  }, 240_000);

  it("★ provisioning by the CLIs: the edge runs on the pinned keyset + its credential file, config verified, devices of ITS node only", async () => {
    const k = edge.counts()!;
    expect(k.configVersion).toBeGreaterThan(0);
    expect(k.robots.map((r) => r.id)).toEqual([c.ids.robotA]); // never robot B (node B) nor robot C (central)
    expect(k.adapters).toEqual([c.ids.adapterA]);
    // the keyset pin came from the CLI (root key only) and the central signer is that key
    const pin = JSON.parse((await import("node:fs")).readFileSync(c.pinFile, "utf8"));
    expect(pin.kind).toBe("avi-edge-pin+v1");
    expect(pin.keyset.keys.map((x: { kid: string }) => x.kid)).toEqual([c.kid]);
    // the heartbeat reached central over HTTP (v2: from the credential's principal)
    expect(c.front.captured.some((x) => x.path === "/heartbeat" && x.auth === "A" && x.status === 200)).toBe(true);
    expect(c.front.captured.some((x) => x.path === "/config" && x.auth === "A" && x.status === 200)).toBe(true);
  });

  it("★ claim → signed package → per-step authorize → run (robot + OT write + pinned OT STOP + robot STOP, safety preflight ON) → reports → complete", async () => {
    const s = c.steps;
    const plcReads0 = c.plc.reads;
    const id = await c.startRun("complete", [s.gate(), s.move("m1"), s.otWrite("o1", 7), s.otStop("p1"), s.stop("s1")]);
    completeRunId = id;
    await c.approveAtGate(id);
    await waitFor(`run ${id} completed on the edge and reported`, async () => (await c.run(id)).status === "completed" && (await c.assignment(id)).claimTokenHash === null, 60_000);
    // devices (independent oracles)
    expect(motionsOf(edge, c.ids.robotA).map((m) => m.jobType)).toEqual(["custom"]);
    expect(stopsOf(edge, c.ids.robotA).map((m) => m.jobType)).toEqual(["abort"]);
    expect(c.ot.writes.map((w) => `${w.kind}:${w.addr}=${w.value}`)).toEqual(["register:0=7", "coil:0=true"]);
    expect(c.plc.reads).toBeGreaterThan(plcReads0); // the safety PLC was read for the real actuation
    // central rows
    const a = await c.assignment(id);
    expect(a.claimSeq).toBe(2); // segment 1 up to the gate, segment 2 after the approval
    expect(a.claimedByCredentialId).toBe(c.credentialIds.A);
    const rows = await c.stepRows(id);
    expect(rows.map((r) => [r.stepId, r.status])).toEqual([["g0", "completed"], ["m1", "completed"], ["o1", "completed"], ["p1", "completed"], ["s1", "completed"]]);
    expect(rows.find((r) => r.stepId === "m1")!.resultJson.approvalSource).toBe("edge");
    // one signed authorisation per NON-STOP step, each with its result reported once; none for the STOPs (L-7)
    const auths = await c.sql`SELECT "stepId", "claimSeq", attempt, kind, "resultReportedAt" IS NOT NULL AS reported FROM edge_step_authorizations WHERE "runId" = ${id} ORDER BY "stepId"`;
    expect(auths.map((x) => [x.stepId, x.kind, x.reported])).toEqual([["m1", "robot", true], ["o1", "ot", true]]);
    // central wrote the NON-STOP ledgers from the edge's reports, one row per jti (STOP ledgers: see BUG F1-1 below)
    expect(await robotJobs(id)).toEqual(["custom:done:1"]);
    const ot = await c.sql`SELECT "commandType", status, "idempotencyKey" LIKE 'edge:%' AS "byJti" FROM command_log WHERE "adapterId" = ${c.ids.adapterA} AND "actionId" LIKE ${`foe-run${id}-%`} ORDER BY id`;
    expect(ot.map((r) => [r.commandType, r.byJti])).toEqual([["write_tag", true]]);
    // telemetry of the OWNED adapter and robot state arrived over HTTP (central ingest)
    await waitFor("ot_telemetry rows of adapter A", async () => Number((await c.sql`SELECT count(*)::int AS n FROM ot_telemetry WHERE "deviceId" = ${c.codes.adapterA}`)[0].n) > 0, 30_000);
    await waitFor("robot_telemetry rows of robot A", async () => Number((await c.sql`SELECT count(*)::int AS n FROM robot_telemetry WHERE "robotId" = ${c.ids.robotA}`)[0].n) > 0, 30_000);
  }, 180_000);

  // BUG F1-1 (found by this suite, NOT fixed here — routed): the edge's STOP ledger records carry no `ownerEpoch`
  // (robot/robotEdgeDispatch.ts:66-80 and ot/otEdgeDispatch.ts:193-203 build `{kind:"ledger", …}` without it; the schema has it
  // optional, edgeProtocol.ts:666), while central refuses a STOP ledger whose ownerEpoch is missing / not the device's current one
  // (edge/edgeReportsCentral.ts:371-375 → EDGE_ANOMALY "stop_ledger_refused", nothing written). Every STOP the edge executes in a
  // run therefore leaves NO robot_jobs / command_log row centrally and a false anomaly — the STOP itself is sent (L-7 holds) and
  // its step row is completed. it.fails: this asserts the CORRECT outcome and turns red (to be flipped to `it`) once fixed.
  it("BUG F1-1 (fixed: doc 81 dot 10 D fix review 8, R-10-bn) — an edge STOP's ledger row is written centrally (robot abort + pinned OT stop), no stop_ledger_refused anomaly", async () => {
    expect(completeRunId).toBeGreaterThan(0);
    const got = await stopLedger(completeRunId);
    console.log(`[F1] BUG F1-1 measured: ${JSON.stringify(got)}`); // today: { robot: [], ot: [], refused: ["p1", "s1"] }
    expect(got).toEqual({ robot: ["abort:done"], ot: ["stop:acked"], refused: [] });
  });

  it("★ R-10-aq — the EDGE's OWN safety preflight (signed config, no DB): an e-stop raised after central's check and before the send ⇒ the motion is NOT sent", async () => {
    const s = c.steps;
    const before = motionsOf(edge, c.ids.robotA).length;
    const id = await c.startRun("edgePreflight", [s.gate(), s.move("m1")]);
    // the authorize answer is held 600 ms; while it is held (central has ALREADY read the PLC clean and signed) the e-stop is
    // pressed — from then on only the EDGE's own preflight can see it
    let authorized = 0;
    c.front.delayMs.set(`^/runs/${id}/authorize$`, 600);
    c.front.tamper.set(`^/runs/${id}/authorize$`, (answer) => {
      if (answer?.ok === true) authorized++;
      c.plc.coils.set(0, true); // coil:1 = e-stop ACTIVE
      return undefined;
    });
    try {
      await c.approveAtGate(id);
      await waitFor(`run ${id} ended on the edge`, async () => ["failed", "held", "aborted"].includes((await c.run(id)).status) && (await c.assignment(id)).claimTokenHash === null, 60_000);
    } catch (err) {
      console.log("DIAG", authorized, JSON.stringify(await c.run(id)), JSON.stringify(await c.stepRows(id)), JSON.stringify(c.front.captured.filter((x) => x.path.includes(String(id))).map((x) => [x.path, x.status, JSON.stringify(x.answer).slice(0, 300), JSON.stringify(x.body).slice(0, 600)])));
      throw err;
    } finally {
      c.front.delayMs.clear();
      c.front.tamper.clear();
      c.plc.coils.set(0, false);
    }
    expect(authorized).toBe(1); // central's own preflight was clean: it signed
    expect(motionsOf(edge, c.ids.robotA).length).toBe(before); // never reached the robot
    const m1 = (await c.stepRows(id)).find((r) => r.stepId === "m1")!;
    expect(`${m1.status} ${m1.error}`).toMatch(/SAFETY/);
    // the authorisation WAS issued (central's view was clean) — and its result is the edge's refusal, never a send
    expect(Number((await c.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${id}`)[0].n)).toBe(1);
    expect(await robotJobs(id)).not.toContain("custom:done:1");
  }, 120_000);

  it("★ central console MOTION on the edge-owned robot is refused (ROBOT_OWNED_BY_EDGE); nothing reaches the robot", async () => {
    const before = motionsOf(edge, c.ids.robotA).length;
    const r = await c.trpc("robot.actuate", { robotId: c.ids.robotA, command: "start" }, await c.engineerSession());
    expect(JSON.stringify(r.json)).toMatch(/ROBOT_OWNED_BY_EDGE/);
    expect(JSON.stringify(r.json)).not.toMatch(/"status":"done"/);
    await sleep(1_000);
    expect(motionsOf(edge, c.ids.robotA).length).toBe(before);
    expect(central.calls.filter((x) => x.robotId === c.ids.robotA)).toEqual([]);
  });

  it("★ central abort mid-run: the next NON-STOP step is never sent, the STOP is sent by the edge exactly once, the run stays aborted", async () => {
    const s = c.steps;
    const m0 = motionsOf(edge, c.ids.robotA).length;
    const s0 = stopsOf(edge, c.ids.robotA).length;
    const id = await c.startRun("abort", [s.gate(), s.move("m1"), s.delay("d1", 3000), s.move("m2"), s.stop("s1")]);
    await c.approveAtGate(id);
    await edge.waitCounts("m1 sent by the edge", (k) => k.motions.filter((m) => m.robotId === c.ids.robotA).length === m0 + 1);
    await c.abort(id);
    await edge.waitCounts("the run's STOP sent by the edge's sweep", (k) => k.stops.filter((m) => m.robotId === c.ids.robotA).length >= s0 + 1, 15_000);
    await sleep(3_500); // past the 3 s delay: m2 would have been sent by now
    expect(motionsOf(edge, c.ids.robotA).length).toBe(m0 + 1); // m2 NEVER sent
    expect(stopsOf(edge, c.ids.robotA).length).toBe(s0 + 1); // exactly one STOP
    await waitFor("abort:s1 confirmed centrally from the edge's report", async () => (await c.stepRows(id)).find((r) => r.stepId === "abort:s1")?.status === "completed", 20_000);
    expect((await c.run(id)).status).toBe("aborted");
    expect((await c.stepRows(id)).find((r) => r.stepId === "m2")?.status).not.toBe("completed");
    // m2 never even got an authorisation (central said stopped)
    expect((await c.sql`SELECT "stepId" FROM edge_step_authorizations WHERE "runId" = ${id} ORDER BY 1`).map((r) => r.stepId)).toEqual(["m1"]);
  }, 120_000);

  it("★ a console STOP from central to the edge-owned robot: queued, delivered on the pull, executed by the edge, acked done", async () => {
    const s0 = stopsOf(edge, c.ids.robotA).length;
    const t0 = Date.now();
    const r = await c.trpc("robot.consoleStop", { robotId: c.ids.robotA, command: "stop" }, await c.engineerSession());
    const out = r.json?.result?.data?.json;
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(out).toMatchObject({ ok: true, status: "queued_on_edge", queuedOnEdge: { edgeNodeId: c.ids.nodeA } });
    const reqId = Number(out.queuedOnEdge.requestId);
    const k = await edge.waitCounts("the edge executed the console STOP", (x) => (x.stops.filter((m) => m.robotId === c.ids.robotA).length > s0 ? x : null), 10_000);
    const sentAt = k.stops.filter((m) => m.robotId === c.ids.robotA)[s0].at;
    expect(sentAt - t0).toBeLessThan(3_000); // console → central queue → pull (200 ms cadence) → robot
    await waitFor("the STOP request acked done by its owner", async () => (await c.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${reqId}`)[0]?.outcome === "done", 15_000);
    const [row] = await c.sql`SELECT kind, "edgeNodeId", "deliveredAt" IS NOT NULL AS delivered, "ackedAt" IS NOT NULL AS acked, "centralExecutionId" FROM robot_motion_lock_requests WHERE id = ${reqId}`;
    expect(row).toMatchObject({ kind: "stop", edgeNodeId: c.ids.nodeA, delivered: true, acked: true, centralExecutionId: null });
    await sleep(1_500);
    expect(stopsOf(edge, c.ids.robotA).length).toBe(s0 + 1); // executed once (re-deliveries are re-acked, never re-run)
  }, 60_000);

  it("★ central DOWN (hanging): the walking run's STOP still goes out locally within the L-7 bound; the next NON-STOP step is HELD; reconnect replays every report exactly once", async () => {
    const s = c.steps;
    const m0 = motionsOf(edge, c.ids.robotA).length;
    const s0 = stopsOf(edge, c.ids.robotA).length;
    const id = await c.startRun("offline", [s.gate(), s.move("m1"), s.delay("d1", 1500), s.stop("s1"), s.move("m2")]);
    await c.approveAtGate(id);
    const k1 = await edge.waitCounts("m1 sent", (k) => (k.motions.filter((m) => m.robotId === c.ids.robotA).length === m0 + 1 ? k : null));
    c.setMode("hang"); // central stops answering: every node request now waits for the edge's own timeout (2 s)
    const downAt = Date.now();
    let s1At = 0;
    try {
      const k2 = await edge.waitCounts("s1 (a STOP) sent while central is down", (k) => (k.stops.filter((m) => m.robotId === c.ids.robotA).length === s0 + 1 ? k : null), 10_000);
      s1At = k2.stops.filter((m) => m.robotId === c.ids.robotA)[s0].at;
      const m1At = k1.motions.filter((m) => m.robotId === c.ids.robotA)[m0].at;
      // L-7: the STOP waits for nothing central — at most the journal's STOP bound (STOP_DB_STEP_DEADLINE_MS) beyond its due time
      const { STOP_DB_STEP_DEADLINE_MS } = await import("../robot/stopJob");
      expect(s1At - m1At).toBeLessThan(200 /* the SIM job */ + 1500 /* d1 */ + STOP_DB_STEP_DEADLINE_MS);
      expect(s1At).toBeGreaterThan(downAt);
      await sleep(4_000); // m2's /authorize cannot be answered (2 s timeout) ⇒ held, nothing sent
      expect(motionsOf(edge, c.ids.robotA).length).toBe(m0 + 1);
      expect((await c.run(id)).status).toBe("running"); // central learnt nothing yet
    } finally {
      c.setMode("up");
    }
    await waitFor("the held segment end reported after reconnect", async () => (await c.run(id)).status === "held" && (await c.assignment(id)).claimTokenHash === null, 30_000);
    const run = await c.run(id);
    expect(JSON.stringify(run)).toMatch(/centralUnreachable/);
    // every report replayed EXACTLY once: one ledger row per step, step rows as walked
    expect(await robotJobs(id)).toEqual(["custom:done:1"]);
    const rows = await c.stepRows(id);
    expect(rows.filter((r) => r.stepId === "s1").map((r) => r.status)).toEqual(["completed"]);
    expect(rows.find((r) => r.stepId === "m2")?.status).not.toBe("completed");
    // no seq was applied twice and none conflicted
    const dupSeqs = await c.sql`SELECT stream, epoch, seq, count(*)::int AS n FROM edge_node_report_records WHERE "edgeNodeId" = ${c.ids.nodeA} GROUP BY 1, 2, 3 HAVING count(*) > 1`;
    expect(dupSeqs).toEqual([]);
    // a person continues: m2 is authorised and sent now
    await c.continueHeld(id);
    await waitFor(`run ${id} completed after Continue`, async () => (await c.run(id)).status === "completed", 60_000);
    expect(motionsOf(edge, c.ids.robotA).length).toBe(m0 + 2);
    expect(await robotJobs(id)).toEqual(["custom:done:2"]);
  }, 180_000);

  it("★ L-7 console STOP with the central DB HANGING: a robot central holds a live session for is stopped at once; an edge-owned robot gets a bounded, truthful answer", async () => {
    // robot C is central's: its gateway attaches it (a live session in THIS process)
    process.env.ROBOT_GATEWAY_ENABLED = "true";
    const { startRobots, activeRobotIds } = await import("../robot/robotManager");
    await startRobots();
    await waitFor("robot C attached centrally", () => activeRobotIds().includes(c.ids.robotC), 15_000);
    const session = await c.engineerSession();
    // a normal STOP first (DB up): the degraded-auth memory of this session is warmed by the full chain (R-10-bf)
    const warm = await c.trpc("robot.consoleStop", { robotId: c.ids.robotC, command: "stop" }, session);
    expect(warm.json?.result?.data?.json, JSON.stringify(warm.json)).toMatchObject({ ok: true });
    const { STOP_AUTH_BOUND_MS } = await import("../robot/robotStopAuthMemo");
    const { CONSOLE_STOP_REPLY_BOUND_MS } = await import("../robot/robotEdgeCommandPort");
    H.dbMode = "hang";
    try {
      const n0 = central.calls.filter((x) => x.robotId === c.ids.robotC).length;
      const t0 = Date.now();
      const r = await c.trpc("robot.consoleStop", { robotId: c.ids.robotC, command: "stop" }, session);
      const replyMs = Date.now() - t0;
      const sent = central.calls.filter((x) => x.robotId === c.ids.robotC)[n0];
      expect(sent, JSON.stringify(r.json)).toBeDefined();
      expect(sent.at - t0).toBeLessThan(STOP_AUTH_BOUND_MS + 700); // the auth bound + slack: no DB read before the send
      expect(replyMs).toBeLessThan(CONSOLE_STOP_REPLY_BOUND_MS);
      expect(r.json?.result?.data?.json).toMatchObject({ ok: true, degradedAuth: true });
      // the edge-owned robot: its STOP goes through central's queue, which hangs ⇒ bounded, never a false "done"
      const e0 = stopsOf(edge, c.ids.robotA).length;
      const t1 = Date.now();
      const r2 = await c.trpc("robot.consoleStop", { robotId: c.ids.robotA, command: "stop" }, session);
      const reply2 = Date.now() - t1;
      expect(reply2).toBeLessThan(CONSOLE_STOP_REPLY_BOUND_MS + 1_500);
      const body = JSON.stringify(r2.json);
      expect(body).not.toMatch(/"status":"(done|queued_on_edge)"/);
      expect(body).toMatch(/EDGE_STOP_NOT_QUEUED|hardware E-STOP|still in progress|FAILED/);
      expect(stopsOf(edge, c.ids.robotA).length).toBe(e0); // nothing could reach the edge: the documented limit, said so
    } finally {
      H.dbMode = "ok";
    }
  }, 120_000);

  it("★ edge restart mid-run (crash): journal recovered under a NEW epoch, no seq reused, the run held → Continue; the consumed jti never reused", async () => {
    const s = c.steps;
    const m0 = motionsOf(edge, c.ids.robotA).length;
    const epochBefore = edge.counts()!.journal!.epoch;
    const id = await c.startRun("restart", [s.gate(), s.move("m1"), s.delay("d1", 6000), s.move("m2"), s.stop("s1")]);
    await c.approveAtGate(id);
    await edge.waitCounts("m1 sent", (k) => k.motions.filter((m) => m.robotId === c.ids.robotA).length === m0 + 1);
    await waitFor("m1 reported to central", async () => (await c.stepRows(id)).find((r) => r.stepId === "m1")?.status === "completed", 15_000);
    const lastBeforeKill = edge.counts()!;
    expect(noDbEvidence({ ...lastBeforeKill, removedFromEnv: [], connectsAll: 0, probe: "", trapAfterProbe: 0 })).toMatchObject({ trap: 0, pgConnects: 0, pgConstructed: 0 });
    await edge.kill(); // a crash: no clean journal close
    const old = edge;
    edge = await c.spawnEdge("a2", { journalDir: old.journalDir });
    const epochAfter = edge.counts()!.journal!.epoch;
    expect(epochAfter).not.toBe(epochBefore); // every open is a new epoch (fix review 2 N-5)
    await c.clearEdgeLock(c.ids.robotA, edge); // whatever the restart left (fail-closed), the operator clears it
    // the old claim is declared interrupted ⇒ held; a person continues
    await c.continueHeld(id, 60_000);
    await waitFor(`run ${id} completed after the restart`, async () => (await c.run(id)).status === "completed", 60_000);
    expect(motionsOf(old, c.ids.robotA).length + motionsOf(edge, c.ids.robotA).length - m0).toBe(2); // m1 (old process) + m2 (new); m1 never re-sent
    expect(motionsOf(edge, c.ids.robotA).length).toBe(1);
    // report cursors: the new epoch started at seq 1 and nothing of either epoch was applied twice / conflicted
    const cursors = await c.sql`SELECT epoch, stream, "lastSeq" FROM edge_node_report_cursors WHERE "edgeNodeId" = ${c.ids.nodeA} AND epoch IN ${c.sql([epochBefore, epochAfter])}`;
    expect(new Set(cursors.map((r) => r.epoch))).toEqual(new Set([epochBefore, epochAfter]));
    const firstNew = await c.sql`SELECT stream, min(seq)::int AS first FROM edge_node_report_records WHERE "edgeNodeId" = ${c.ids.nodeA} AND epoch = ${epochAfter} GROUP BY stream`;
    expect(firstNew.every((r) => r.first === 1)).toBe(true);
    const conflicts = await c.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE '%EDGE_ANOMALY%' AND details::text LIKE '%seq_conflict%' AND "createdAt" > now() - interval '30 minutes' AND details::text LIKE ${`%${c.ids.nodeA}%`}`;
    expect(conflicts[0].n).toBe(0);
    // jti: one per (claim, step, attempt), each reported once; m1's was never used again
    const auths = await c.sql`SELECT jti, "stepId", "claimSeq", "resultReportedAt" IS NOT NULL AS reported FROM edge_step_authorizations WHERE "runId" = ${id} ORDER BY "issuedAt"`;
    expect(auths.map((a) => a.stepId)).toEqual(["m1", "m2"]);
    expect(new Set(auths.map((a) => a.jti)).size).toBe(2);
    expect(auths.every((a) => a.reported)).toBe(true);
    expect(await robotJobs(id)).toEqual(["custom:done:2"]);
  }, 240_000);

  it("★ ownership moved edge → central with a STOP pending for the edge: CENTRAL executes it (transient session), acked with its execution record; the edge releases the robot", async () => {
    c.setMode("drop"); // the edge cannot pull: the console STOP stays pending for it
    let reqId = 0;
    try {
      const r = await c.trpc("robot.consoleStop", { robotId: c.ids.robotA, command: "stop" }, await c.engineerSession());
      const out = r.json?.result?.data?.json;
      expect(out, JSON.stringify(r.json)).toMatchObject({ status: "queued_on_edge" });
      reqId = Number(out.queuedOnEdge.requestId);
      const e0 = stopsOf(edge, c.ids.robotA).length;
      const n0 = central.calls.filter((x) => x.robotId === c.ids.robotA).length;
      const { changeDeviceOwner } = await import("../robot/deviceOwnershipService");
      const moved = await changeDeviceOwner({ kind: "robot", deviceId: c.ids.robotA, toEdgeNodeId: null, actorUserId: c.u.admin, actorName: "F1 admin" });
      expect(moved, JSON.stringify(moved)).toMatchObject({ ok: true, toEdgeNodeId: null });
      expect((moved as { centralStops: { outcome: string; requestIds: number[] } }).centralStops).toMatchObject({ outcome: "done" });
      expect((moved as { centralStops: { requestIds: number[] } }).centralStops.requestIds).toContain(reqId);
      expect(central.calls.filter((x) => x.robotId === c.ids.robotA).length).toBeGreaterThan(n0); // central's session sent it
      const [row] = await c.sql`SELECT outcome, "ackedAt" IS NOT NULL AS acked, "centralExecutionId" FROM robot_motion_lock_requests WHERE id = ${reqId}`;
      expect(row.outcome).toBe("done");
      expect(row.centralExecutionId).not.toBeNull();
      const [ex] = await c.sql`SELECT "deviceKind", "deviceId", ok, executor FROM central_stop_executions WHERE id = ${row.centralExecutionId}`;
      expect(ex).toMatchObject({ deviceKind: "robot", deviceId: c.ids.robotA, ok: true, executor: "central-stop-sweep" });
      expect(stopsOf(edge, c.ids.robotA).length).toBe(e0); // the edge never got it
    } finally {
      c.setMode("up");
    }
    // the edge sees the new config: robot A is not its own any more ⇒ released (locked, STOPped, session closed)
    await edge.waitCounts("robot A released by the edge", (k) => !k.robots.some((r) => r.id === c.ids.robotA), 30_000);
    await sleep(1_500);
    expect(Number((await c.sql`SELECT count(*)::int AS n FROM edge_stop_ack_refusals WHERE "requestId" = ${reqId}`)[0].n)).toBe(0);
    expect((await c.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${reqId}`)[0].outcome).toBe("done");
  }, 120_000);

  it("★ the edge process never touched the DB: 0 trap hits, 0 connects to the PG port, no postgres client — and a deliberate getDb() throws", async () => {
    const rep = await edge.stop();
    expect(noDbEvidence(rep)).toEqual({ trap: 0, pgConnects: 0, pgConstructed: 0, probe: "EDGE_DB_TRAP", removedFromEnv: ["DATABASE_URL"] });
    expect(rep.trapAfterProbe).toBe(1); // the instrument is live
    expect(rep.connectsAll).toBeGreaterThan(0); // the tripwire saw the edge's real connects (central HTTP, Modbus)
  }, 120_000);
});
