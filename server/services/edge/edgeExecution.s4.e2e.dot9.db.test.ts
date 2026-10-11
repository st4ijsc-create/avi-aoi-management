/**
 * doc 81 Đợt 9 task S4 — END TO END, TWO PROCESSES over HTTP (127.0.0.1, port 0), `_test` DB:
 *   • THIS process plays CENTRAL: the real /api/v1 router (node protocol), the real engine (start / approve / abort);
 *   • a SPAWNED process plays the EDGE (edgeE2eChild.dot9.test.ts): the real EdgeExecutionAgent with node A's credential,
 *     the real engine and robot dispatcher; its robot is a counting fake living in THAT process (robot_jobs rows with status
 *     'done' can only come from it — central has no robot).
 * Scenarios: assign → pull → run → complete (with a central approval in between); abort mid-run (non-STOP never sent, STOP
 * sent by the edge, never resurrected); replayed progress / claim / complete (refused, rows never move back); an out-of-scope
 * node (B sees nothing of A's, its answers equal "missing"; A never takes B's run); offline (no new run claimed; a central
 * abort written while offline still stops the walking run's non-STOP steps and its STOP goes out); credential revoked (the
 * node can take nothing more).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// CENTRAL's robot route: central cannot reach the line's robot — every attempt fails, and LATE (1.5 s): central's own abort sweep
// records its failure only AFTER the edge has confirmed the same STOP (the order a real WAN produces), so the E2E measures
// that a confirmed STOP is never shown as failed by the other process's later failure.
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: () => ({
    driver: {
      vendor: "sim",
      isConnected: () => true,
      runJob: async () => {
        await new Promise((r) => setTimeout(r, 1500));
        throw new Error("central cannot reach the line's robot");
      },
      abort: async () => {
        await new Promise((r) => setTimeout(r, 1500));
        throw new Error("central cannot reach the line's robot");
      },
      health: async () => ({ vendor: "sim", connected: false }),
    },
  }),
}));
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const DAU = `S94-${Date.now()}`;
const ENV: Record<string, string | undefined> = {
  EDGE_RUNTIME_ENABLED: "true",
  FOE_ENABLED: "true",
  FOE_SIM_GATE_REQUIRED: "false",
  EDGE_CLAIM_STALE_MS: "5000",
  // central's robot route really tries (and fails, late) — see the robotManager mock above
  ROBOT_CONTROL_ENABLED: "true",
  ROBOT_COMMISSIONING_REQUIRED: "false",
  ROBOT_CONTROL_TIMEOUT_MS: "5000",
};
const saved: Record<string, string | undefined> = {};
const ids: Record<string, number> = {};
const u = { owner: 0, approver: 0, admin: 0 };
const tokens: Record<string, string> = {};
const wfIds: number[] = [];
const captured: Array<{ path: string; body: any }> = [];
let offline = false;
let sql: ReturnType<typeof postgres>;
let srv: Server;
let base = "";
let child: ChildProcess | null = null;
let childExit: Promise<number | null> = Promise.resolve(null);
let dir = "";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > until) throw new Error(`timed out waiting for: ${what}`);
    await sleep(100);
  }
}
async function post(p: string, body: unknown, token?: string) {
  const res = await fetch(`${base}/api/v1${p}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const run = async (id: number) => (await sql`SELECT status, error FROM orchestration_runs WHERE id = ${id}`)[0];
const assignment = async (id: number) => (await sql`SELECT * FROM orchestration_run_edge_assignments WHERE "runId" = ${id}`)[0];
async function robotDone(runId: number) {
  const rows = await sql`SELECT "jobType", count(*)::int AS n FROM robot_jobs WHERE "idempotencyKey" LIKE ${`run${runId}-%`} AND status = 'done' GROUP BY "jobType"`;
  const by = Object.fromEntries(rows.map((r) => [String(r.jobType), Number(r.n)]));
  return { motions: (by.custom ?? 0) as number, stops: (by.abort ?? 0) as number };
}
const motion = (id: string) => ({ id, type: "command", machineId: ids.robotMachine, command: "start", args: { robotId: ids.robot } });
const stop = (id: string) => ({ id, type: "command", machineId: ids.robotMachine, command: "abort", args: { robotId: ids.robot } });
async function startFor(tag: string, steps: unknown[], nodeId = ids.nodeA) {
  const ref = `${DAU}-${tag}`;
  const def = { ref, name: ref, steps };
  const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey") VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active', 'global') RETURNING id`;
  wfIds.push(Number(wf.id));
  const { startRun } = await import("../orchestration/foe/foeEngine");
  const r = await startRun(ref, {}, { id: u.owner, role: "admin", name: "owner" }, { edgeNodeId: nodeId });
  expect(r).toMatchObject({ ok: true, status: "queued" });
  return r.runId!;
}
/** The edge walked to the gate and reported it: approve centrally (another person). */
async function approveAtGate(runId: number, gateId = "g0") {
  await waitFor(`run ${runId} paused at its gate on the edge and reported`, async () => {
    const r = await run(runId);
    const a = await assignment(runId);
    return r.status === "awaiting_confirm" && a.claimTokenHash === null;
  });
  const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
  const view = await getRun(runId, { bindingDigest: true });
  const res = await resumeRun(runId, { approved: true, expectedStepId: gateId, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, { id: u.approver, role: "admin", name: "approver" });
  expect(res).toMatchObject({ ok: true, status: "queued" });
}
async function abortCentrally(runId: number) {
  const { abortRun } = await import("../orchestration/foe/foeEngine");
  const r = await abortRun(runId, { id: u.admin, role: "admin", name: "central operator" }, "stop the cell");
  expect(r.status).toBe("aborted");
}

describe.skipIf(!DB_URL)("doc 81 Đợt 9 S4 — central + edge in two processes over HTTP (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    for (const k of ["owner", "approver", "admin"] as const) {
      u[k] = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${k}`}, ${`${DAU}-${k}`}, ${`S94 ${k}`}, 'admin', true) RETURNING id`);
    }
    for (const f of ["A", "B"]) {
      ids[`factory${f}`] = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F${f}-${DAU}`}, ${`S94 ${f}`}, true) RETURNING id`);
      ids[`ws${f}`] = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids[`factory${f}`]}, ${`W${f}-${DAU}`}, 'S94 ws') RETURNING id`);
      ids[`line${f}`] = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids[`ws${f}`]}, ${`L${f}-${DAU}`}, 'S94 line') RETURNING id`);
      ids[`st${f}`] = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids[`line${f}`]}, ${`S${f}-${DAU}`}, 'S94 st') RETURNING id`);
      ids[`node${f}`] = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`N${f}-${DAU}`}, ${`S94 node ${f}`}, ${`F${f}-${DAU}`}, 'online') RETURNING id`);
    }
    ids.robotMachine = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stA}, ${"MR-" + DAU}, 'S94 robot cell', 'ROBOT', true) RETURNING id`);
    ids.machineB = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.stB}, ${"MB-" + DAU}, 'S94 B machine', 'AOI', true) RETURNING id`);
    ids.robot = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${"R-" + DAU}, 'S94 robot', 'sim', 'sim://s94', true, ${ids.lineA}, ${ids.stA}) RETURNING id`);
    const { issueNodeCredential } = await import("./edgeNodeCredentials");
    tokens.A = (await issueNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.admin, reason: "provision A" })).token;
    tokens.B = (await issueNodeCredential({ nodeCode: `NB-${DAU}`, actorUserId: u.admin, reason: "provision B" })).token;

    // CENTRAL: the real v1 router; a recorder (to replay what the edge really sent) and an "offline" switch in front of it
    const { createV1Router } = await import("../../api/v1/router");
    const app = express();
    app.use("/api/v1/edge/node", express.json(), (req, res, next) => {
      if (offline) {
        req.socket.destroy(); // the network is gone — not an HTTP answer
        return;
      }
      if (req.headers.authorization === `Bearer ${tokens.A}`) captured.push({ path: req.path, body: req.body });
      next();
    });
    app.use("/api/v1", createV1Router());
    srv = await new Promise<Server>((resolve) => {
      const s = createServer(app).listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;

    // EDGE: a separate process
    dir = mkdtempSync(path.join(os.tmpdir(), "s9-edge-e2e-"));
    const log = openSync(path.join(dir, "edge.log"), "w");
    writeFileSync(path.join(dir, "node-a.cred"), `${tokens.A}\n`, { mode: 0o600 });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      S9_EDGE_E2E_CHILD: "1",
      S9_EDGE_E2E_DIR: dir,
      S9_EDGE_E2E_ROBOT_ID: String(ids.robot),
      TEST_DATABASE_URL: DB_URL, // the child's vitest.setup derives the SAME _test DB
      EDGE_EXECUTION_ENABLED: "true",
      EDGE_RUNTIME_ENABLED: "true",
      FOE_ENABLED: "true",
      EDGE_CENTRAL_URL: base,
      EDGE_NODE_CREDENTIAL_FILE: path.join(dir, "node-a.cred"), // a FILE (never an env var — the agent refuses one)
      EDGE_PULL_INTERVAL_MS: "200",
      EDGE_ABORT_POLL_MS: "150",
      EDGE_REQUEST_TIMEOUT_MS: "2000",
      EDGE_STOP_RESEND_MIN_MS: "1000",
      EDGE_GUARD_DEADLINE_MS: "10000", // see edgeExecution.s3: a loaded shared test DB must not turn into 'unknown'
      ROBOT_SAFETY_PREFLIGHT_ENABLED: "false", // see edgeExecution.s3 (measured SAFETY_UNKNOWN under a loaded parallel run)
      ROBOT_CONTROL_ENABLED: "true",
      ROBOT_COMMISSIONING_REQUIRED: "false",
      ROBOT_CONTROL_TIMEOUT_MS: "5000",
    };
    delete env.DATABASE_URL; // vitest.setup reads the dev URL string only to name the _test DB; TEST_DATABASE_URL wins
    for (const k of ["SEC_PLATFORM", "FIELD_V2_ENABLED", "VITEST", "VITEST_POOL_ID", "VITEST_WORKER_ID"]) delete env[k];
    child = spawn(process.execPath, [path.resolve("node_modules/vitest/vitest.mjs"), "run", "server/services/edge/edgeE2eChild.dot9.test.ts"], { cwd: process.cwd(), env, stdio: ["ignore", log, log] });
    childExit = new Promise((resolve) => child!.on("exit", (code) => resolve(code)));
    closeSync(log);
    await waitFor("the edge process to be up", async () => existsSync(path.join(dir, "ready")), 90_000);
  }, 180_000);

  afterAll(async () => {
    if (dir && !existsSync(path.join(dir, "stop"))) writeFileSync(path.join(dir, "stop"), "1");
    const code = await Promise.race([childExit, sleep(60_000).then(() => "timeout")]);
    if (code === "timeout") child?.kill();
    await new Promise<void>((r) => (srv ? srv.close(() => r()) : r()));
    for (const w of wfIds) {
      const runs = await sql`SELECT id FROM orchestration_runs WHERE "workflowId" = ${w}`;
      for (const r of runs) {
        await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${`foe-run${r.id}-%`}`.catch(() => undefined);
        await sql`DELETE FROM robot_jobs WHERE "idempotencyKey" LIKE ${`run${r.id}-%`}`.catch(() => undefined);
        await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${r.id}`;
        await sql`DELETE FROM orchestration_runs WHERE id = ${r.id}`;
      }
      await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`;
    }
    await sql`DELETE FROM robot_jobs WHERE "robotId" = ${ids.robot}`.catch(() => undefined);
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${ids.robot}`.catch(() => undefined);
    for (const f of ["A", "B"]) if (ids[`node${f}`]) await sql`DELETE FROM edge_nodes WHERE id = ${ids[`node${f}`]}`;
    if (ids.robot) await sql`DELETE FROM robots WHERE id = ${ids.robot}`.catch(() => undefined);
    for (const m of [ids.robotMachine, ids.machineB]) if (m) await sql`DELETE FROM machines WHERE id = ${m}`;
    for (const f of ["A", "B"]) {
      if (ids[`st${f}`]) await sql`DELETE FROM stations WHERE id = ${ids[`st${f}`]}`;
      if (ids[`line${f}`]) await sql`DELETE FROM production_lines WHERE id = ${ids[`line${f}`]}`;
      if (ids[`ws${f}`]) await sql`DELETE FROM workshops WHERE id = ${ids[`ws${f}`]}`;
      if (ids[`factory${f}`]) await sql`DELETE FROM factories WHERE id = ${ids[`factory${f}`]}`;
    }
    await sql`DELETE FROM users WHERE id IN ${sql(Object.values(u).filter(Boolean))}`.catch(() => undefined);
    await sql.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 120_000);

  it("★ assign → pull → run → complete: the EDGE process walks the central run (gate approved centrally), its robot gets the motion and the STOP", async () => {
    const id = await startFor("complete", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), stop("s1")]);
    await approveAtGate(id);
    await waitFor("run completed on the edge and reported", async () => (await run(id)).status === "completed" && (await assignment(id)).claimTokenHash === null);
    expect(await robotDone(id)).toEqual({ motions: 1, stops: 1 });
    const a = await assignment(id);
    expect(a.claimSeq).toBe(2); // two segments: up to the gate, then after the approval
    const [cred] = await sql`SELECT id FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.nodeA} AND status = 'active'`;
    expect(a.claimedByCredentialId).toBe(cred.id);
    const steps = await sql`SELECT "stepId", status FROM orchestration_run_steps WHERE "runId" = ${id} ORDER BY "stepId"`;
    expect(steps.map((s) => [s.stepId, s.status])).toEqual([["g0", "completed"], ["m1", "completed"], ["s1", "completed"]]);
  });

  it("★ abort mid-run: the non-STOP step after the abort is NEVER sent, the STOP is sent by the edge, the run stays aborted; replays are refused", async () => {
    const id = await startFor("abort", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "d1", type: "delay", ms: 3000 }, motion("m2"), stop("s1")]);
    await approveAtGate(id);
    await waitFor("m1 sent by the edge", async () => (await robotDone(id)).motions === 1);
    await waitFor("a progress report of the live claim", async () => captured.some((c) => c.path === `/runs/${id}/progress`));
    // ── replayed progress (a captured request, sent again): refused, the row never moves back ──
    const last = [...captured].reverse().find((c) => c.path === `/runs/${id}/progress`)!;
    const before = Number((await assignment(id)).progressSeq);
    const replay = await post(`/edge/node/runs/${id}/progress`, last.body, tokens.A);
    expect(replay.status).toBe(409);
    expect(replay.json.error.code).toBe("replayed");
    expect(Number((await assignment(id)).progressSeq)).toBeGreaterThanOrEqual(before);
    const claimReq = captured.find((c) => c.path === `/runs/${id}/claim`)!;
    expect((await post(`/edge/node/runs/${id}/claim`, claimReq.body, tokens.A)).status).toBe(409);
    // ── the abort ──
    await abortCentrally(id);
    await waitFor("the STOP sent by the edge's sweep", async () => (await robotDone(id)).stops >= 1, 10_000);
    await sleep(3500); // past the end of the 3 s delay: m2 would have been sent by now
    expect((await robotDone(id)).motions).toBe(1);
    await waitFor("the edge reported the segment end", async () => (await assignment(id)).claimTokenHash === null);
    expect((await run(id)).status).toBe("aborted");
    // central DID try (its robot route failed, late) — and the STOP the edge confirmed is not shown as failed by that later
    // failure, so it is not re-sent either: exactly ONE STOP reached the robot
    const centralTries = await sql`SELECT count(*)::int AS n FROM robot_jobs WHERE "idempotencyKey" LIKE ${`run${id}-%`} AND "jobType" = 'abort' AND status = 'failed'`;
    expect(centralTries[0].n).toBe(1);
    await sleep(1500); // > EDGE_STOP_RESEND_MIN_MS: a wrongly "failed" row would have been re-sent by now
    expect((await robotDone(id)).stops).toBe(1);
    const stopRow = (await sql`SELECT status FROM orchestration_run_steps WHERE "runId" = ${id} AND "stepId" = 'abort:s1'`)[0];
    expect(stopRow?.status).toBe("completed");
    // ── a captured "complete", replayed: the claim is gone ──
    const done = captured.find((c) => c.path === `/runs/${id}/complete`)!;
    expect((await post(`/edge/node/runs/${id}/complete`, done.body, tokens.A)).status).toBe(409);
    expect((await run(id)).status).toBe("aborted"); // never resurrected
  });

  it("★ L-7 across processes: aborted while PAUSED after actuating — central cannot reach the robot, the EDGE re-sends the STOP", async () => {
    const id = await startFor("pausedAbort", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "g1", type: "hitl_gate", prompt: "more?" }, stop("s1")]);
    await approveAtGate(id);
    await waitFor("m1 sent and the run paused at g1 on the edge", async () => (await run(id)).status === "awaiting_confirm" && (await robotDone(id)).motions === 1 && (await assignment(id)).claimTokenHash === null);
    await abortCentrally(id); // central's sweep: no robot here ⇒ abort:s1 failed
    await waitFor("the STOP re-sent by the edge", async () => (await robotDone(id)).stops >= 1, 15_000);
    await waitFor("abort:s1 confirmed", async () => (await sql`SELECT status FROM orchestration_run_steps WHERE "runId" = ${id} AND "stepId" = 'abort:s1'`)[0]?.status === "completed", 10_000);
    expect((await robotDone(id)).motions).toBe(1);
    expect((await robotDone(id)).stops).toBe(1); // re-sent once, then confirmed: not again
    expect((await run(id)).status).toBe("aborted");
  });

  it("★ out-of-scope node: B sees nothing of A's runs and its answers equal 'missing'; A never takes a run assigned to B", async () => {
    const forB = await startFor("forB", [{ id: "w1", type: "wait_state", machineId: ids.machineB, targetStates: ["IDLE"], timeoutMs: 1 }], ids.nodeB);
    const forA = await startFor("forA", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1")]);
    const pulledB = await post("/edge/node/pull", {}, tokens.B);
    expect(pulledB.json.data.runs.map((r: any) => r.runId)).toEqual([forB]);
    const asB = await post(`/edge/node/runs/${forA}/claim`, { claimSeq: 0, defHash: "a".repeat(64), bindingDigest: "b".repeat(64) }, tokens.B);
    const missing = await post(`/edge/node/runs/2000000000/claim`, { claimSeq: 0, defHash: "a".repeat(64), bindingDigest: "b".repeat(64) }, tokens.B);
    expect(asB.status).toBe(404);
    expect(JSON.stringify(asB.json).replace(String(forA), "N")).toBe(JSON.stringify(missing.json).replace("2000000000", "N"));
    await sleep(1500); // ~7 pull cycles of the edge
    expect((await run(forB)).status).toBe("queued");
    expect((await assignment(forB)).claimSeq).toBe(0);
    await approveAtGate(forA); // A did take its own run meanwhile
    await abortCentrally(forA);
  });

  it("★ offline: no new run is claimed; a central abort written while offline still stops the walking run's non-STOP steps and its STOP goes out", async () => {
    const walking = await startFor("offlineWalk", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "d1", type: "delay", ms: 3000 }, motion("m2"), stop("s1")]);
    await approveAtGate(walking);
    await waitFor("m1 sent by the edge", async () => (await robotDone(walking)).motions === 1);
    offline = true;
    try {
      const fresh = await startFor("offlineNew", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1")]);
      await abortCentrally(walking); // written to the run row; no HTTP answer can carry it now
      await waitFor("the STOP sent by the edge although central is unreachable", async () => (await robotDone(walking)).stops >= 1, 10_000);
      await sleep(3500);
      expect((await robotDone(walking)).motions).toBe(1); // m2 never sent
      expect((await run(fresh)).status).toBe("queued"); // nothing new started offline
      expect((await assignment(fresh)).claimSeq).toBe(0);
      offline = false;
      await waitFor("the fresh run claimed once central is back", async () => (await run(fresh)).status === "awaiting_confirm", 15_000);
      await abortCentrally(fresh);
    } finally {
      offline = false;
    }
    await waitFor("the walking run's segment end reported after reconnect", async () => (await assignment(walking)).claimTokenHash === null, 15_000);
    expect((await run(walking)).status).toBe("aborted");
  });

  it("★ credential revoked: the node can take nothing more (pull 401), its run stays queued", async () => {
    const { revokeNodeCredential } = await import("./edgeNodeCredentials");
    await revokeNodeCredential({ nodeCode: `NA-${DAU}`, actorUserId: u.admin, reason: "node decommissioned" });
    expect((await post("/edge/node/pull", {}, tokens.A)).status).toBe(401);
    const id = await startFor("revoked", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1")]);
    await sleep(2000); // ~10 pull cycles
    expect((await run(id)).status).toBe("queued");
    expect((await assignment(id)).claimSeq).toBe(0);
    // the edge process: stop it and read what its robot received over the whole suite
    writeFileSync(path.join(dir, "stop"), "1");
    expect(await Promise.race([childExit, sleep(60_000).then(() => "timeout")])).toBe(0);
    const report = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8"));
    expect(report.pid).not.toBe(process.pid);
    const totals = await sql`SELECT "jobType", count(*)::int AS n FROM robot_jobs WHERE "robotId" = ${ids.robot} AND status = 'done' GROUP BY "jobType"`;
    const by = Object.fromEntries(totals.map((r) => [String(r.jobType), Number(r.n)]));
    expect(report.motions).toBe(by.custom ?? 0); // every motion the DB says was done came from the EDGE process's robot
    expect(report.stops).toBeGreaterThanOrEqual(by.abort ?? 0);
  });
});
