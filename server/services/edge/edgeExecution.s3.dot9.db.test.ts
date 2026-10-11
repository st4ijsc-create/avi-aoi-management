/**
 * doc 81 Đợt 9 task S3 — the EDGE walker (foeEngine.driveEdgeClaimedRun + the run guard + stopLiveRunForCentralAbort) on the
 * REAL `_test` DB with the REAL engine and the REAL robot dispatcher (the robot is an in-process counting fake driver):
 *   • it walks THE CENTRAL RUN (ID mapping) only under the claim its database shows — a wrong token / seq, a redeploy, an
 *     inactive owner ⇒ refused, nothing walked, nothing written;
 *   • the SAME gates as central: an un-approved gate pauses the run (no motion); after a central approval by someone else the
 *     next segment actuates; STOP steps are sent;
 *   • a central abort mid-run reaches the walker through the run guard (no HTTP) or the signal: the non-STOP step after the
 *     abort point is NEVER sent, the run's STOP step is still SENT, the run stays 'aborted' (never resurrected);
 *   • a revoked node credential stops the non-STOP steps; a STOP never asks the guard (it is still sent);
 *   • a stale claim (re-claimed elsewhere) ⇒ the walker lets go without writing the run row.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import postgres from "postgres";

const h = vi.hoisted(() => ({
  robotId: 0,
  motions: 0,
  stops: 0,
}));

vi.mock("../robot/robotEnabledGate", () => ({ readRobotEnabledForMotion: async () => true }));
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: (id: number) =>
    id === h.robotId
      ? {
          driver: {
            vendor: "sim",
            isConnected: () => true,
            runJob: async (job: { jobType: string }) => {
              if (job.jobType === "abort") h.stops++;
              else h.motions++;
              return { ok: true, status: "done", detail: { fake: true } };
            },
            abort: async () => {
              h.stops++;
            },
            health: async () => ({ vendor: "sim", connected: true }),
          },
        }
      : undefined,
}));
vi.mock("../safety/plc/safetyPlcAdapter", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../safety/plc/safetyPlcAdapter")>();
  return {
    ...orig,
    safetyPlcAdapterEnabled: () => true,
    listPlcConfigs: async () => [{ code: "S9-SPLC", backend: "modbus", endpoint: "tcp://192.0.2.1:502", statusMap: { estop: { address: "coil:1" } } }],
    backendForConfig: () => ({
      kind: "modbus" as const,
      label: () => "fake real PLC",
      read: async () => ({ estop: false }),
      readChecked: async () => ({ status: { estop: false }, unreadable: [] }),
    }),
  };
});

const DB_URL = process.env.DATABASE_URL;
const DAU = `S9E-${Date.now()}`;
const ENV: Record<string, string | undefined> = {
  EDGE_RUNTIME_ENABLED: "true",
  FOE_ENABLED: "true",
  FOE_SIM_GATE_REQUIRED: "false",
  ROBOT_CONTROL_ENABLED: "true",
  ROBOT_COMMISSIONING_REQUIRED: "false",
  ROBOT_CONTROL_TIMEOUT_MS: "5000",
  SEC_PLATFORM: undefined,
  FIELD_V2_ENABLED: undefined,
  // the robot safety preflight is measured by its own suites; under a full parallel run on one dev box its bounded read was
  // measured to answer UNKNOWN (SAFETY_UNKNOWN — correctly refused) on the first motion — off here so these tests measure the
  // edge gates. Exactly "false" is the documented off value (safetyPreflightPolicy).
  ROBOT_SAFETY_PREFLIGHT_ENABLED: "false",
  // the run guard's read bound (default 2 s): a full parallel suite on one dev DB can exceed it — then the guard is 'unknown'
  // and the non-STOP step is (correctly) refused. Widened here so the gate tests measure the gates, not the machine's load.
  EDGE_GUARD_DEADLINE_MS: "10000",
};
const saved: Record<string, string | undefined> = {};
const ids: Record<string, number> = {};
const u = { owner: 0, approver: 0, admin: 0 };
let sql: ReturnType<typeof postgres>;
let token = "";
const wfIds: number[] = [];
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const motion = (id: string) => ({ id, type: "command", machineId: ids.robotMachine, command: "start", args: { robotId: h.robotId } });
const stop = (id: string) => ({ id, type: "command", machineId: ids.robotMachine, command: "abort", args: { robotId: h.robotId } });

async function node() {
  const { authenticateEdgeNodeToken } = await import("./edgeNodeCredentials");
  const p = await authenticateEdgeNodeToken(token);
  if (!p) throw new Error("node credential not accepted");
  return p;
}
async function runStatus(id: number) {
  return String((await sql`SELECT status FROM orchestration_runs WHERE id = ${id}`)[0].status);
}
async function stepRow(id: number, stepId: string) {
  return (await sql`SELECT status, error, "resultJson" FROM orchestration_run_steps WHERE "runId" = ${id} AND "stepId" = ${stepId}`)[0];
}
/** Deploy, start for the node, claim (central functions, the node's own principal). */
async function startAndClaim(tag: string, steps: unknown[]) {
  const ref = `${DAU}-${tag}`;
  const def = { ref, name: ref, steps };
  const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey") VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active', 'global') RETURNING id`;
  wfIds.push(Number(wf.id));
  const { startRun } = await import("../orchestration/foe/foeEngine");
  const r = await startRun(ref, {}, { id: u.owner, role: "admin", name: "owner" }, { edgeNodeId: ids.node });
  expect(r).toMatchObject({ ok: true, status: "queued" });
  return { runId: r.runId!, def, ...(await claim(r.runId!)) };
}
async function claim(runId: number) {
  const c = await import("./edgeExecutionCentral");
  const n = await node();
  const p = (await c.pullForNode(n)).data!.runs.find((x) => x.runId === runId)!;
  const got = await c.claimForNode(n, runId, { claimSeq: p.claimSeq, defHash: p.defHash, bindingDigest: p.bindingDigest });
  expect(got.http).toBe(200);
  return { claimSeq: got.data!.claimSeq, token: got.data!.claimToken, tokenHash: sha(got.data!.claimToken), defHash: p.defHash };
}
async function drive(c: { runId: number; claimSeq: number; tokenHash: string; defHash: string }) {
  const { driveEdgeClaimedRun } = await import("../orchestration/foe/foeEngine");
  return driveEdgeClaimedRun(c.runId, { claimSeq: c.claimSeq, claimTokenHash: c.tokenHash, defHash: c.defHash });
}
/** The segment ended at the gate: report it, approve centrally (another person), claim the next segment. */
async function approveAndReclaim(c: { runId: number; claimSeq: number; token: string }, gateId: string) {
  const central = await import("./edgeExecutionCentral");
  expect((await central.completeForNode(await node(), c.runId, { claimSeq: c.claimSeq, claimToken: c.token, seq: 1, status: "awaiting_confirm" })).http).toBe(200);
  const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
  const view = await getRun(c.runId, { bindingDigest: true });
  const res = await resumeRun(c.runId, { approved: true, expectedStepId: gateId, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, { id: u.approver, role: "admin", name: "approver" });
  expect(res).toMatchObject({ ok: true, status: "queued" });
  return claim(c.runId);
}

describe.skipIf(!DB_URL)("doc 81 Đợt 9 S3 — the edge walker of the central run (real engine, real robot dispatcher, _test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await import("../ot/adapterFacade");
    await import("../ot/safetyTarget");
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    for (const [k, role] of [["owner", "admin"], ["approver", "admin"], ["admin", "admin"]] as const) {
      u[k] = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-${k}`}, ${`${DAU}-${k}`}, ${`S9 ${k}`}, ${role}, true) RETURNING id`);
    }
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + DAU}, 'S9E factory', true) RETURNING id`);
    ids.ws = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + DAU}, 'S9E ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.ws}, ${"L-" + DAU}, 'S9E line') RETURNING id`);
    ids.st = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + DAU}, 'S9E st') RETURNING id`);
    ids.robotMachine = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.st}, ${"MR-" + DAU}, 'S9E robot cell', 'ROBOT', true) RETURNING id`);
    h.robotId = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId") VALUES (${"R-" + DAU}, 'S9E robot', 'sim', 'sim://s9e', true, ${ids.line}, ${ids.st}) RETURNING id`);
    ids.node = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${"N-" + DAU}, 'S9E node', ${"F-" + DAU}, 'online') RETURNING id`);
    const { issueNodeCredential } = await import("./edgeNodeCredentials");
    token = (await issueNodeCredential({ nodeCode: `N-${DAU}`, actorUserId: u.admin, reason: "provision S3" })).token;
  }, 90_000);

  afterAll(async () => {
    for (const w of wfIds) {
      const runs = await sql`SELECT id FROM orchestration_runs WHERE "workflowId" = ${w}`;
      for (const r of runs) {
        await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${`foe-run${r.id}-%`}`.catch(() => undefined);
        await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${r.id}`;
        await sql`DELETE FROM orchestration_runs WHERE id = ${r.id}`;
      }
      await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" = ${w}`.catch(() => undefined);
      await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`;
    }
    await sql`DELETE FROM robot_jobs WHERE "robotId" = ${h.robotId}`.catch(() => undefined);
    await sql`DELETE FROM robot_motion_locks WHERE "robotId" = ${h.robotId}`.catch(() => undefined);
    if (ids.node) await sql`DELETE FROM edge_nodes WHERE id = ${ids.node}`;
    if (h.robotId) await sql`DELETE FROM robots WHERE id = ${h.robotId}`.catch(() => undefined);
    if (ids.robotMachine) await sql`DELETE FROM machines WHERE id = ${ids.robotMachine}`;
    if (ids.st) await sql`DELETE FROM stations WHERE id = ${ids.st}`;
    if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    if (ids.ws) await sql`DELETE FROM workshops WHERE id = ${ids.ws}`;
    if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    await sql`DELETE FROM users WHERE id IN ${sql(Object.values(u).filter(Boolean))}`.catch(() => undefined);
    await sql.end();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 90_000);

  beforeEach(() => {
    h.motions = 0;
    h.stops = 0;
  });

  it("★ ID mapping: a wrong claim token / seq, a redeploy, an inactive owner ⇒ refused; nothing walked, nothing written", async () => {
    const c = await startAndClaim("refuse", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1")]);
    const { driveEdgeClaimedRun } = await import("../orchestration/foe/foeEngine");
    expect((await driveEdgeClaimedRun(c.runId, { ...c, claimTokenHash: sha("ect_other") })).refused).toMatch(/claim/);
    expect((await driveEdgeClaimedRun(c.runId, { ...c, claimTokenHash: c.tokenHash, claimSeq: c.claimSeq + 1 })).refused).toMatch(/claim/);
    expect((await driveEdgeClaimedRun(c.runId, { ...c, claimTokenHash: c.tokenHash, defHash: "0".repeat(64) })).refused).toMatch(/snapshot/);
    expect((await driveEdgeClaimedRun(2_000_000_000, { ...c, claimTokenHash: c.tokenHash })).refused).toMatch(/ID mapping/);
    await sql`UPDATE users SET "isActive" = false WHERE id = ${u.owner}`;
    try {
      expect((await drive(c)).refused).toMatch(/owner/);
    } finally {
      await sql`UPDATE users SET "isActive" = true WHERE id = ${u.owner}`;
    }
    expect((await sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${c.runId}`)[0].n).toBe(0);
    expect(await runStatus(c.runId)).toBe("running");
    expect(h.motions + h.stops).toBe(0);
  });

  it("★ same gates as central: an un-approved gate pauses (no motion); after a central approval by ANOTHER person the next segment actuates", async () => {
    const c = await startAndClaim("gate", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), stop("s1")]);
    const seg1 = await drive(c);
    expect(seg1.status).toBe("awaiting_confirm");
    expect(h.motions).toBe(0);
    const c2 = await approveAndReclaim({ runId: c.runId, claimSeq: c.claimSeq, token: c.token }, "g0");
    const seg2 = await drive({ runId: c.runId, ...c2 });
    expect(seg2, JSON.stringify(await sql`SELECT "stepId", status, error FROM orchestration_run_steps WHERE "runId" = ${c.runId}`)).toMatchObject({ ok: true, status: "completed" });
    expect(h.motions).toBe(1);
    expect(h.stops).toBe(1);
    expect((await stepRow(c.runId, "m1")).status).toBe("completed");
  });

  it("★ central abort mid-run, learned through the RUN GUARD (no HTTP): the next non-STOP step is never sent, the STOP is SENT, the run stays aborted", async () => {
    const c = await startAndClaim("abortGuard", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "d1", type: "delay", ms: 1500 }, motion("m2"), stop("s1")]);
    await drive(c);
    const c2 = await approveAndReclaim({ runId: c.runId, claimSeq: c.claimSeq, token: c.token }, "g0");
    const walking = drive({ runId: c.runId, ...c2 });
    for (let i = 0; i < 100 && h.motions < 1; i++) await sleep(20);
    expect(h.motions).toBe(1); // m1 sent, now in the delay
    // central is ANOTHER process: its abort reaches this walker only as the row it writes (no in-memory flag, no HTTP here)
    await sql`UPDATE orchestration_runs SET status = 'aborted', "finishedAt" = ${new Date()}, error = 'Aborted by central' WHERE id = ${c.runId}`;
    const out = await walking;
    expect(out.status).toBe("aborted");
    for (let i = 0; i < 100 && h.stops < 1; i++) await sleep(20);
    expect(h.motions).toBe(1); // m2 NEVER sent
    expect(h.stops).toBeGreaterThanOrEqual(1); // s1 SENT by the edge's sweep
    expect((await stepRow(c.runId, "m2"))?.status).not.toBe("completed");
    expect(await runStatus(c.runId)).toBe("aborted"); // never resurrected
  });

  it("★ central abort learned from the SIGNAL during a wait: the walker wakes at once, no further non-STOP step, the STOP is sent", async () => {
    const c = await startAndClaim("abortSignal", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "d1", type: "delay", ms: 20_000 }, motion("m2"), stop("s1")]);
    await drive(c);
    const c2 = await approveAndReclaim({ runId: c.runId, claimSeq: c.claimSeq, token: c.token }, "g0");
    const t0 = Date.now();
    const walking = drive({ runId: c.runId, ...c2 });
    for (let i = 0; i < 100 && h.motions < 1; i++) await sleep(20);
    const { stopLiveRunForCentralAbort } = await import("../orchestration/foe/foeEngine");
    // central is ANOTHER process: its abort is the row it writes (its own in-memory flag never reaches this walker)
    await sql`UPDATE orchestration_runs SET status = 'aborted', "finishedAt" = now(), error = 'Aborted by central' WHERE id = ${c.runId}`;
    const applied = await stopLiveRunForCentralAbort(c.runId, { id: 0, role: "system", name: "edge: central abort" });
    expect(applied.live).toBe(true);
    expect((await walking).status).toBe("aborted");
    expect(Date.now() - t0).toBeLessThan(15_000); // the 20 s delay was cut short
    expect(h.motions).toBe(1);
    expect(h.stops).toBeGreaterThanOrEqual(1);
    expect(applied.abortStops?.sent ?? []).toContain("s1");
  });

  it("★ revoked node credential: the next NON-STOP step is refused (EDGE_GUARD(revoked)); a STOP never asks the guard and is sent", async () => {
    const c = await startAndClaim("revoked", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "d1", type: "delay", ms: 400 }, stop("s1"), motion("m2")]);
    await drive(c);
    const c2 = await approveAndReclaim({ runId: c.runId, claimSeq: c.claimSeq, token: c.token }, "g0");
    const walking = drive({ runId: c.runId, ...c2 });
    for (let i = 0; i < 100 && h.motions < 1; i++) await sleep(20);
    await sql`UPDATE edge_node_credentials SET status = 'revoked', "revokedAt" = now(), "revokeReason" = 'test' WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`;
    try {
      const out = await walking;
      expect(out.status).toBe("failed");
      expect(h.motions).toBe(1); // m2 refused
      expect(h.stops).toBe(1); // s1 (a STOP) went out although the credential is revoked
      expect((await stepRow(c.runId, "m2")).error).toMatch(/EDGE_GUARD\(revoked\)/);
    } finally {
      const { issueNodeCredential } = await import("./edgeNodeCredentials");
      token = (await issueNodeCredential({ nodeCode: `N-${DAU}`, actorUserId: u.admin, reason: "re-provision" })).token;
    }
  });

  it("★ L-7: aborted centrally while PAUSED after actuating (no walker left): the node re-sends the STOP central could not confirm; a run that is not aborted is never touched", async () => {
    const c = await startAndClaim("resend", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "g1", type: "hitl_gate", prompt: "more?" }, stop("s1")]);
    await drive(c);
    const c2 = await approveAndReclaim({ runId: c.runId, claimSeq: c.claimSeq, token: c.token }, "g0");
    expect((await drive({ runId: c.runId, ...c2 })).status).toBe("awaiting_confirm"); // m1 sent, paused at g1
    expect(h.motions).toBe(1);
    const { resendStopsOfAbortedRun } = await import("../orchestration/foe/foeEngine");
    // not aborted ⇒ nothing (never aborts a run itself) — paused, and even a run that FAILED a moment ago
    expect((await resendStopsOfAbortedRun(c.runId, { id: 0, role: "system", name: "edge" })).ok).toBe(false);
    expect(await runStatus(c.runId)).toBe("awaiting_confirm");
    await sql`UPDATE orchestration_runs SET status = 'failed', "finishedAt" = ${new Date()} WHERE id = ${c.runId}`;
    expect((await resendStopsOfAbortedRun(c.runId, { id: 0, role: "system", name: "edge" })).ok).toBe(false);
    await sleep(200);
    expect(h.stops).toBe(0);
    // central (another process) aborted it; its sweep could not reach the robot ⇒ a FAILED abort:s1 row
    await sql`UPDATE orchestration_runs SET status = 'aborted', "finishedAt" = ${new Date()}, error = 'Aborted by central' WHERE id = ${c.runId}`;
    await sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, error) VALUES (${c.runId}, 'abort:s1', 'command', 'failed', 0, 'robot not reachable from central')`;
    const pulled = await (await import("./edgeExecutionCentral")).pullForNode(await node());
    expect(pulled.data!.stopsUnconfirmed).toContain(c.runId);
    const r = await resendStopsOfAbortedRun(c.runId, { id: 0, role: "system", name: "edge" });
    expect(r.abortStops?.sent).toEqual(["s1"]);
    expect(h.stops).toBe(1);
    expect(h.motions).toBe(1);
    for (let i = 0; i < 100 && (await stepRow(c.runId, "abort:s1")).status !== "completed"; i++) await sleep(20); // the row write is not awaited by a STOP
    expect((await stepRow(c.runId, "abort:s1")).status).toBe("completed");
    expect(await runStatus(c.runId)).toBe("aborted");
    const again = await (await import("./edgeExecutionCentral")).pullForNode(await node());
    expect(again.data!.stopsUnconfirmed).not.toContain(c.runId); // confirmed: no longer listed
  });

  it("★ stale claim (re-claimed elsewhere): the walker lets go — no non-STOP step, NO run-level write", async () => {
    const c = await startAndClaim("stale", [{ id: "g0", type: "hitl_gate", prompt: "go?" }, motion("m1"), { id: "d1", type: "delay", ms: 400 }, motion("m2")]);
    await drive(c);
    const c2 = await approveAndReclaim({ runId: c.runId, claimSeq: c.claimSeq, token: c.token }, "g0");
    const walking = drive({ runId: c.runId, ...c2 });
    for (let i = 0; i < 100 && h.motions < 1; i++) await sleep(20);
    // another segment took the run (as a release + Continue + claim would): new seq + token
    await sql`UPDATE orchestration_run_edge_assignments SET "claimSeq" = "claimSeq" + 1, "claimTokenHash" = ${sha("ect_someone_else")}, "progressSeq" = 0 WHERE "runId" = ${c.runId}`;
    await sql`UPDATE orchestration_runs SET "currentStepId" = 'marker-of-the-new-owner' WHERE id = ${c.runId}`;
    const out = await walking;
    expect(out.status).toBe("held");
    expect(h.motions).toBe(1);
    const row = (await sql`SELECT status, "currentStepId" FROM orchestration_runs WHERE id = ${c.runId}`)[0];
    expect(row).toMatchObject({ status: "running", currentStepId: "marker-of-the-new-owner" }); // untouched by the old walker
  });
});
