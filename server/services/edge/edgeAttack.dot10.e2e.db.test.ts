/**
 * doc 81 Đợt 10 task F1 (design §5b; rulings R-10-bi and the review findings each attack names) — the ATTACK suite, through the
 * REAL HTTP surface of the two-process set-up (__edgeE2eHarness.dot10.ts):
 *   • a HOSTILE NODE holding a VALID credential = node B (its credential issued by the CLI; no honest process runs for it): it
 *     calls central's node routes directly with crafted bodies — for its own runs / devices and for node A's;
 *   • a HOSTILE NETWORK between central and node A's REAL edge process (edgeGatewayMain, no DB): central's answers to the edge
 *     are rewritten / delayed / replayed (the harness's tamper hooks) — the edge must refuse locally.
 * Every attack must FAIL CLOSED; each case asserts the device counts (the simulators / the edge's counted SIM robot) and the
 * central rows. Attacks: A1 forged authorisation · A2 replay · A3 node B acting for node A · A4 rogue non-STOP result ·
 * A5 forged trusted event · A6 payload swap · A7 STOP never blocked — plus stale claim, a bad-signature STOP suppressing the
 * signed copy (R-10-ar S-1), an ack forged for another target (R-10-o), config rollback, cross-factory device, seq reuse with
 * different content (R-10-ag), unsigned non-STOP, and the seeded global safety-PLC row (B fix 2 G5 / R-10-aw, owner question).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.hoisted(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "f1-dot10-attack-session-secret-0123456789abcd";
});

import { randomBytes, sign as cryptoSign } from "node:crypto";
import { setupCentral, waitFor, sleep, noDbEvidence, type Central, type EdgeProc, type CentralTestHooks } from "./__edgeE2eHarness.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let c: Central;
let edge: EdgeProc;
let plcB = 0;
const TTL_MS = 3000;

const motions = (robotId: number) => (edge.counts()?.motions ?? []).filter((m) => m.robotId === robotId).length;
const stops = (robotId: number) => (edge.counts()?.stops ?? []).filter((m) => m.robotId === robotId).length;
const nonce = () => randomBytes(18).toString("base64url");
const one = (rows: Array<Record<string, unknown>>) => Number(rows[0]?.n ?? 0);

/** node B, compromised: a valid credential, crafted bodies */
const B = {
  epoch: "",
  seq: new Map<string, number>(),
  next(stream: string): number {
    const n = (B.seq.get(stream) ?? 0) + 1;
    B.seq.set(stream, n);
    return n;
  },
  post: (p: string, body: unknown) => c.post(p, body, c.tokens.B),
};
type Claim = { runId: number; claimSeq: number; claimToken: string; pkg: any };

async function claimAs(token: string, runId: number): Promise<Claim> {
  const pull = await c.post("/edge/node/pull", {}, token);
  const r = pull.json?.data?.runs?.find((x: { runId: number }) => x.runId === runId);
  if (!r) throw new Error(`run ${runId} not in the pull: ${JSON.stringify(pull.json).slice(0, 400)}`);
  const cl = await c.post(`/edge/node/runs/${runId}/claim`, { claimSeq: r.claimSeq, defHash: r.defHash, programChecks: [] }, token);
  if (cl.status !== 200) throw new Error(`claim ${runId}: ${cl.status} ${cl.text.slice(0, 400)}`);
  return { runId, claimSeq: cl.json.data.claimSeq, claimToken: cl.json.data.claimToken, pkg: cl.json.data.package };
}
/** a run of node B, walked by hand up to its gate, approved centrally (another person), claimed again — ready to authorize m1 */
async function readyRunB(tag: string, steps: unknown[]): Promise<Claim> {
  const runId = await c.startRun(tag, steps, "B");
  const c1 = await claimAs(c.tokens.B, runId);
  const done = await B.post(`/edge/node/runs/${runId}/complete`, { claimSeq: c1.claimSeq, claimToken: c1.claimToken, seq: 1, outcome: "paused", gateStepId: "g0", epoch: B.epoch, reportedThrough: 0 });
  if (done.status !== 200) throw new Error(`complete paused ${runId}: ${done.status} ${done.text.slice(0, 400)}`);
  await c.approveAtGate(runId, "g0", 15_000);
  return claimAs(c.tokens.B, runId);
}
async function robotHash(robotId: number, params: Record<string, unknown> = {}) {
  const { robotPayloadHash } = await import("../ot/otActionBinding");
  return robotPayloadHash({ robotId, jobType: "custom", params } as never);
}
async function authorizeB(cl: Claim, stepId: string, attempt: number, reqNonce = nonce(), over: Record<string, unknown> = {}) {
  const body = {
    claimSeq: cl.claimSeq,
    claimToken: cl.claimToken,
    stepId,
    attempt,
    idempotencyKey: `run${cl.runId}-${stepId}-a${attempt}`,
    reqNonce,
    command: { kind: "robot", robotId: c.ids.robotB, jobType: "custom", params: {} },
    payloadHash: await robotHash(c.ids.robotB),
    programChecks: [],
    ...over,
  };
  return { body, res: await B.post(`/edge/node/runs/${cl.runId}/authorize`, body) };
}
/** node B clears ITS OWN robot's lock (it is the lock authority — legitimate, so its runs can be authorised at all) */
async function clearRobotBLock() {
  const [row] = await c.sql`SELECT l.generation, r."ownerEpoch" FROM robot_motion_locks l JOIN robots r ON r.id = l."robotId" WHERE l."robotId" = ${c.ids.robotB}`;
  if (!row) return;
  const r = await B.post("/edge/node/locks/events", {
    epoch: B.epoch,
    stream: "events",
    records: [{ kind: "lock", seq: B.next("events"), robotId: c.ids.robotB, event: "cleared", generation: Number(row.generation), ownerEpoch: Number(row.ownerEpoch), reasonCode: "ownerChanged", since: Date.now(), clearedBy: "operator", requestId: null }],
  });
  expect(r.status, r.text).toBe(200);
  await waitFor("robot B's lock row gone", async () => one(await c.sql`SELECT count(*)::int AS n FROM robot_motion_locks WHERE "robotId" = ${c.ids.robotB}`) === 0, 10_000);
}
/** forge helpers: an attacker key; a payload altered under the original signature; the same payload signed by the attacker under the REAL kid */
async function forge() {
  const sg = await import("./edgeSigning");
  const attacker = sg.generateEdgeSigningKey().key;
  return {
    attacker,
    alter: (env: any, patch: Record<string, unknown>) => ({ ...env, payload: sg.edgeCanonicalJson({ ...JSON.parse(env.payload), ...patch }) }),
    resignUnderRealKid: (env: any) => {
      const typ = (Object.entries(sg.EDGE_TYP_NAME).find(([, v]) => v === env.typ) as [string, string])[0] as never;
      return { ...env, sig: cryptoSign(null, sg.edgeSigningInput(typ, env.kid, env.payload), attacker.privateKey).toString("base64url") };
    },
    signAsAttacker: (typ: "cmd" | "auth", payload: unknown) => sg.signEdgeObject(typ, payload, attacker),
  };
}
const answerOf = (path: RegExp) => [...c.front.captured].reverse().find((x) => path.test(x.path) && x.status === 200 && x.answer?.ok === true)?.answer?.data;

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

describe.skipIf(!onTest)("doc 81 Đợt 10 F1 — attack suite through the real HTTP surface (design §5b)", () => {
  beforeAll(async () => {
    c = await setupCentral("F1X", { env: { EDGE_AUTH_TTL_MS: String(TTL_MS) }, hooks });
    // node B's station is guarded by the same safety PLC (the hostile node gets FULL central gates on its own robot)
    plcB = Number(
      (await c.sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "statusMap", "stationId", "factoryId", enabled) VALUES (${`SPLCB-${c.DAU}`}, 'F1 safety PLC B', 'pilz', 'modbus', ${`tcp://127.0.0.1:${c.plc.port}`}, ${c.sql.json({ estop: { address: "coil:1" } })}, ${c.ids.stB}, ${c.ids.factoryB}, true) RETURNING id`)[0].id,
    );
    const { newEdgeEpoch } = await import("./edgeProtocol");
    B.epoch = newEdgeEpoch();
    edge = await c.spawnEdge("x1", { env: { EDGE_REQUEST_TIMEOUT_MS: "8000" } });
    await c.clearEdgeLock(c.ids.robotA, edge);
    await clearRobotBLock();
  }, 300_000);
  afterAll(async () => {
    if (plcB && c) await c.sql`DELETE FROM safety_plc_configs WHERE id = ${plcB}`.catch(() => undefined);
    await c?.teardown();
  }, 240_000);

  // ── hostile node (central-side) ──────────────────────────────────────────────────────────────────────────────────────

  it("★ A3 — node B acting for node A: run routes answer EXACTLY 'missing'; device routes write nothing; neither config carries the other's devices / secrets", async () => {
    const s = c.steps;
    const aRun = await c.startRun("a3", [s.gate(), s.move("m1")]); // node A's (its real edge claims it)
    await waitFor("A's run claimed by A's edge", async () => (await c.assignment(aRun)).claimSeq >= 1, 20_000);
    const MISSING = 2_000_000_000;
    const norm = (j: unknown, id: number) => JSON.stringify(j).split(String(id)).join("N");
    const claimRef = { claimSeq: 1, claimToken: `ect_${"x".repeat(43)}` };
    const bodies: Array<[string, unknown]> = [
      ["claim", { claimSeq: 1, defHash: "a".repeat(64), programChecks: [] }],
      ["authorize", { ...claimRef, stepId: "m1", attempt: 1, idempotencyKey: "k", reqNonce: nonce(), command: { kind: "robot", robotId: c.ids.robotA, jobType: "custom", params: {} }, payloadHash: await robotHash(c.ids.robotA), programChecks: [] }],
      ["report", { ...claimRef, epoch: B.epoch, stream: "run:RUN:1", records: [{ kind: "context", seq: 1, patch: { x: 1 } }] }],
      ["complete", { ...claimRef, seq: 1, outcome: "completed", epoch: B.epoch, reportedThrough: 0 }],
      ["progress", { ...claimRef, seq: 1 }],
      ["release", { ...claimRef, seq: 1, reason: "x" }],
      ["interrupted", { claimSeq: 1 }],
    ];
    for (const [route, body] of bodies) {
      const fix = (id: number) => JSON.parse(JSON.stringify(body).replace("run:RUN:1", `run:${id}:1`));
      const asB = await B.post(`/edge/node/runs/${aRun}/${route}`, fix(aRun));
      const missing = await B.post(`/edge/node/runs/${MISSING}/${route}`, fix(MISSING));
      expect(asB.status, `${route}: ${asB.text}`).toBe(404);
      expect(norm(asB.json, aRun), route).toBe(norm(missing.json, MISSING));
    }
    // device routes: telemetry / robot state / lock events for A's devices ⇒ nothing written
    const t = await B.post("/edge/node/telemetry", { samples: [{ adapterId: c.ids.adapterA, tagKey: "hostile_b", ts: Date.now(), value: 666 }] });
    expect(t.json?.data ?? t.json).toMatchObject({ accepted: 0 });
    const st = await B.post("/edge/node/robots/state", { epoch: B.epoch, stream: "robot_state", records: [{ seq: B.next("robot_state"), robotId: c.ids.robotA, ts: Date.now(), estop: true, mode: "HOSTILE-B" }] });
    expect(st.status, st.text).toBeLessThan(500);
    const [lockA] = await c.sql`SELECT generation, authority FROM robot_motion_locks WHERE "robotId" = ${c.ids.robotA}`;
    const ev = await B.post("/edge/node/locks/events", {
      epoch: B.epoch,
      stream: "events",
      records: [
        { kind: "lock", seq: B.next("events"), robotId: c.ids.robotA, event: "cleared", generation: 2_000_000_000, ownerEpoch: 1, reasonCode: "hostile", since: Date.now(), clearedBy: "operator", requestId: null },
        { kind: "lock", seq: B.next("events"), robotId: c.ids.robotA, event: "locked", generation: 2_000_000_000, ownerEpoch: 1, reasonCode: "hostile", since: Date.now(), clearedBy: null, requestId: null },
      ],
    });
    expect(ev.status, ev.text).toBe(200);
    expect(JSON.stringify(ev.json.data.outcomes)).toMatch(/lock_event_not_owned/);
    await sleep(500);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM ot_telemetry WHERE "deviceId" = ${c.codes.adapterA} AND metric = 'hostile_b'`)).toBe(0);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM robot_telemetry WHERE "robotId" = ${c.ids.robotA} AND mode = 'HOSTILE-B'`)).toBe(0);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM safety_events WHERE "robotId" = ${c.ids.robotA}`)).toBe(0);
    const [lockA2] = await c.sql`SELECT generation, authority FROM robot_motion_locks WHERE "robotId" = ${c.ids.robotA}`;
    expect(lockA2 ?? null).toEqual(lockA ?? null);
    // configs: B's holds none of A's devices / codes / secret; A's none of B's (string scan of the signed payload)
    const cfgB = (await B.post("/edge/node/config", {})).json.data.config.payload as string;
    const cfgA = (await c.post("/edge/node/config", {}, c.tokens.A)).json.data.config.payload as string;
    for (const needle of [c.codes.robotA, c.codes.adapterA, c.codes.nodeA, c.codes.factoryA, `A-PLC-SECRET-${c.DAU}`, c.codes.robotC]) expect(cfgB).not.toContain(needle);
    for (const needle of [c.codes.robotB, c.codes.adapterB, c.codes.nodeB, c.codes.factoryB, `B-PLC-SECRET-${c.DAU}`, `B-ROBOT-SECRET-${c.DAU}`, c.codes.robotC]) expect(cfgA).not.toContain(needle);
    expect(cfgA).toContain(`A-PLC-SECRET-${c.DAU}`); // D4: a node gets ITS OWN device secret, decrypted (instrument check)
    expect(cfgB).toContain(c.codes.robotB);
    await c.abort(aRun);
  }, 90_000);

  it("★ A2(f) + A6 — a replayed /authorize body (same nonce) gets the IDENTICAL token and no second action row; a new nonce ⇒ already_authorized; a swapped payload ⇒ payload_mismatch + anomaly audit", async () => {
    const s = c.steps;
    const cl = await readyRunB("a2f", [s.gate(), s.move("m1", c.ids.robotB), s.move("m2", c.ids.robotB)]);
    const n1 = nonce();
    const first = await authorizeB(cl, "m1", 1, n1);
    expect(first.res.status, first.res.text).toBe(200);
    const again = await B.post(`/edge/node/runs/${cl.runId}/authorize`, first.body); // the captured body, replayed byte-for-byte
    expect(again.status).toBe(200);
    expect(JSON.parse(again.json.data.authorization.payload).jti).toBe(JSON.parse(first.res.json.data.authorization.payload).jti);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id LIKE ${`foe-run${cl.runId}-m1%`}`)).toBe(1);
    const other = await authorizeB(cl, "m1", 1, nonce());
    expect(other.res.status).toBe(409);
    expect(other.res.json.error.code).toBe("already_authorized");
    // payload swap: the body names other params (and a matching hash of them) — central rebuilds from the definition
    const swapped = await authorizeB(cl, "m2", 1, nonce(), { command: { kind: "robot", robotId: c.ids.robotB, jobType: "custom", params: { speed: 999 } }, payloadHash: await robotHash(c.ids.robotB, { speed: 999 }) });
    expect(swapped.res.status, swapped.res.text).toBe(409);
    expect(swapped.res.json.error.code).toBe("payload_mismatch");
    // … or another node's robot under this run's step
    const foreign = await authorizeB(cl, "m2", 1, nonce(), { command: { kind: "robot", robotId: c.ids.robotA, jobType: "custom", params: {} }, payloadHash: await robotHash(c.ids.robotA) });
    expect(foreign.res.status).toBe(409);
    expect(foreign.res.json.error.code).toBe("payload_mismatch");
    expect(one(await c.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${cl.runId} AND "stepId" = 'm2'`)).toBe(0);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${cl.runId} AND details LIKE '%"anomaly":"payload_mismatch"%'`)).toBeGreaterThanOrEqual(2);
    await c.abort(cl.runId);
  }, 90_000);

  it("★ A2(e) + A4 — the same jti reported under a new seq ⇒ 409 replayed, ONE robot_jobs row; a non-STOP result with no jti ⇒ 409 unauthorised_actuation + audit", async () => {
    const s = c.steps;
    const cl = await readyRunB("a2e", [s.gate(), s.move("m1", c.ids.robotB), s.move("m2", c.ids.robotB)]);
    const a = await authorizeB(cl, "m1", 1);
    expect(a.res.status, a.res.text).toBe(200);
    const jti = JSON.parse(a.res.json.data.authorization.payload).jti as string;
    const stream = `run:${cl.runId}:${cl.claimSeq}`;
    const ledger = (seq: number, over: Record<string, unknown> = {}) => ({ kind: "ledger", seq, stepId: "m1", attempt: 1, idempotencyKey: `run${cl.runId}-m1-a1`, jti, stop: false, target: { robotId: c.ids.robotB, jobType: "custom" }, status: "done", result: {}, at: Date.now(), ...over });
    const report = (records: unknown[]) => B.post(`/edge/node/runs/${cl.runId}/report`, { claimSeq: cl.claimSeq, claimToken: cl.claimToken, epoch: B.epoch, stream, records });
    expect((await report([ledger(1)])).status).toBe(200);
    const replay = await report([ledger(2)]);
    expect(replay.status, replay.text).toBe(409);
    expect(replay.json.error.code).toBe("replayed");
    expect(one(await c.sql`SELECT count(*)::int AS n FROM robot_jobs WHERE "idempotencyKey" = ${`edge:${jti}`}`)).toBe(1);
    const rogue = await report([ledger(2, { stepId: "m2", idempotencyKey: `run${cl.runId}-m2-a1`, jti: null })]);
    expect(rogue.status, rogue.text).toBe(409);
    expect(rogue.json.error.code).toBe("unauthorised_actuation");
    expect(one(await c.sql`SELECT count(*)::int AS n FROM robot_jobs WHERE "actionId" LIKE ${`foe-run${cl.runId}-m2%`}`)).toBe(0);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${cl.runId}`)).toBeGreaterThanOrEqual(2);
    await c.abort(cl.runId);
  }, 90_000);

  it("★ R-10-ag — a seq reused with DIFFERENT content ⇒ 409 seq_conflict + anomaly; nothing applied (an identical re-send is a duplicate)", async () => {
    const s = c.steps;
    const cl = await readyRunB("seq", [s.gate(), s.move("m1", c.ids.robotB)]);
    const stream = `run:${cl.runId}:${cl.claimSeq}`;
    const rec = (status: string) => ({ kind: "step", seq: 1, stepId: "m1", stepType: "command", status, attempt: 0, startedAt: Date.now(), finishedAt: null, error: null, result: null, jti: null });
    const report = (r: unknown) => B.post(`/edge/node/runs/${cl.runId}/report`, { claimSeq: cl.claimSeq, claimToken: cl.claimToken, epoch: B.epoch, stream, records: [r] });
    const first = rec("running");
    expect((await report(first)).status).toBe(200);
    const dup = await report(first);
    expect(dup.status).toBe(200);
    expect(dup.json.data.duplicates).toBe(1);
    const conflict = await report({ ...rec("failed"), error: "rewritten history" });
    expect(conflict.status, conflict.text).toBe(409);
    expect(conflict.json.error.code).toBe("seq_conflict");
    expect((await c.stepRows(cl.runId)).find((r) => r.stepId === "m1")?.status).toBe("running");
    expect(one(await c.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND details::text LIKE '%seq_conflict%' AND details::text LIKE ${`%${c.ids.nodeB}%`}`)).toBeGreaterThanOrEqual(1);
    await c.abort(cl.runId);
  }, 90_000);

  it("★ stale claim — after a release + Continue + re-claim, the OLD claim's authorize / report / complete ⇒ 409 claim_stale; the run row untouched", async () => {
    const s = c.steps;
    const old = await readyRunB("stale", [s.gate(), s.move("m1", c.ids.robotB)]);
    const rel = await B.post(`/edge/node/runs/${old.runId}/release`, { claimSeq: old.claimSeq, claimToken: old.claimToken, seq: 1, reason: "F1 stale-claim attack" });
    expect(rel.status, rel.text).toBe(200);
    await c.continueHeld(old.runId, 15_000);
    const fresh = await claimAs(c.tokens.B, old.runId);
    expect(fresh.claimSeq).toBe(old.claimSeq + 1);
    const a = await authorizeB(old, "m1", 1);
    expect([a.res.status, a.res.json?.error?.code]).toEqual([409, "claim_stale"]);
    const r = await B.post(`/edge/node/runs/${old.runId}/report`, { claimSeq: old.claimSeq, claimToken: old.claimToken, epoch: B.epoch, stream: `run:${old.runId}:${old.claimSeq}`, records: [{ kind: "context", seq: 1, patch: { states: {} } }] });
    expect([r.status, r.json?.error?.code]).toEqual([409, "claim_stale"]);
    const before = await c.run(old.runId);
    const d = await B.post(`/edge/node/runs/${old.runId}/complete`, { claimSeq: old.claimSeq, claimToken: old.claimToken, seq: 2, outcome: "completed", epoch: B.epoch, reportedThrough: 0 });
    expect(d.status).toBe(409);
    expect(await c.run(old.runId)).toEqual(before);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${old.runId} AND "claimSeq" = ${old.claimSeq}`)).toBe(0);
    await c.abort(old.runId);
  }, 90_000);

  it("★ A5 — forged trust: a trust field ⇒ 400; an e-stop of an unapproved (node, robot) ⇒ a PLAIN safety event (no trust row); another node's robot ⇒ nothing", async () => {
    const send = (records: unknown[]) => B.post("/edge/node/robots/state", { epoch: B.epoch, stream: "robot_state", records });
    for (const forged of [{ trusted: true }, { origin: "edge_robot_telemetry" }, { safetyCritical: true }]) {
      const r = await send([{ seq: (B.seq.get("robot_state") ?? 0) + 1, robotId: c.ids.robotB, ts: Date.now(), estop: true, ...forged }]);
      expect(r.status, `${JSON.stringify(forged)}: ${r.text}`).toBe(400);
    }
    expect(one(await c.sql`SELECT count(*)::int AS n FROM safety_events WHERE "robotId" = ${c.ids.robotB}`)).toBe(0);
    const t0 = Date.now();
    expect((await send([{ seq: B.next("robot_state"), robotId: c.ids.robotB, ts: t0, estop: false, mode: "auto" }])).status).toBe(200);
    expect((await send([{ seq: B.next("robot_state"), robotId: c.ids.robotB, ts: t0 + 100, estop: true, mode: "auto" }])).status).toBe(200);
    const ev = await waitFor("the e-stop recorded centrally", async () => {
      const rows = await c.sql`SELECT id, "eventType", "robotId", "stationId", "lineId", "isNearMiss" FROM safety_events WHERE "robotId" = ${c.ids.robotB} ORDER BY id`;
      return rows.length > 0 ? rows : null;
    }, 10_000);
    expect(one(await c.sql`SELECT count(*)::int AS n FROM safety_event_trust WHERE "eventId" IN ${c.sql(ev.map((e) => Number(e.id)))}`)).toBe(0);
    const { consumeSafetyCriticalTrust } = await import("../orchestration/rulesEngine");
    expect(await consumeSafetyCriticalTrust(ev[0] as never)).toBe(false); // never safety-critical (no server-written trust)
    // another node's robot: nothing (A3 already showed robot A gets no rows from B)
    expect(one(await c.sql`SELECT count(*)::int AS n FROM safety_events WHERE "robotId" = ${c.ids.robotA}`)).toBe(0);
  }, 60_000);

  it("★ R-10-o — acks forged by node B: another target ⇒ refused (target_mismatch), another node's request ⇒ refused (other_node); both STOPs stay PENDING; A's real edge then executes and acks its own", async () => {
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const xB = await enqueueEdgeDeviceRequest({ kind: "stop", robotId: c.ids.robotB, reason: "F1 attack: B's own pending STOP", requestedBy: c.u.admin });
    c.front.blocked.add("A"); // A cannot pull for a moment: its STOP stays pending while B forges
    const s0 = stops(c.ids.robotA);
    let yA: { requestId: number };
    try {
      yA = await enqueueEdgeDeviceRequest({ kind: "stop", robotId: c.ids.robotA, reason: "F1 attack: A's pending STOP", requestedBy: c.u.admin });
      const [epB] = await c.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${c.ids.robotB}`;
      const [epA] = await c.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${c.ids.robotA}`;
      const ack = (requestId: number, target: { robotId: number }, ownerEpoch: number) => ({ kind: "command_ack", seq: B.next("events"), requestId, outcome: "done", generation: null, at: Date.now(), target, ownerEpoch });
      const r = await B.post("/edge/node/locks/events", { epoch: B.epoch, stream: "events", records: [ack(xB.requestId, { robotId: c.ids.robotA }, Number(epB.ownerEpoch)), ack(yA.requestId, { robotId: c.ids.robotA }, Number(epA.ownerEpoch))] });
      expect(r.status, r.text).toBe(200);
      expect(r.json.data.outcomes.map((o: { code: string }) => o.code)).toEqual(["command_ack_refused", "command_ack_refused"]);
      const reasons = await c.sql`SELECT "requestId", reason FROM edge_stop_ack_refusals WHERE "requestId" IN ${c.sql([xB.requestId, yA.requestId])} ORDER BY id`;
      expect(reasons.map((x) => [Number(x.requestId), x.reason])).toEqual([
        [xB.requestId, "target_mismatch"],
        [yA.requestId, "other_node"],
      ]);
      const pending = await c.sql`SELECT id, "ackedAt" FROM robot_motion_lock_requests WHERE id IN ${c.sql([xB.requestId, yA.requestId])}`;
      expect(pending.every((p) => p.ackedAt === null)).toBe(true);
      expect(stops(c.ids.robotA)).toBe(s0); // a forged ack never made anything move or stop
      // node B's OWN STOP, acked with the right target and epoch, is accepted (the owner may answer for its own device)
      const own = await B.post("/edge/node/locks/events", { epoch: B.epoch, stream: "events", records: [ack(xB.requestId, { robotId: c.ids.robotB }, Number(epB.ownerEpoch))] });
      expect(own.status, own.text).toBe(200);
      expect(own.json.data.outcomes ?? []).toEqual([]);
      expect((await c.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${xB.requestId}`)[0].outcome).toBe("done");
    } finally {
      c.front.blocked.delete("A");
    }
    await edge.waitCounts("A's edge executes its pending STOP", (k) => k.stops.filter((m) => m.robotId === c.ids.robotA).length > s0, 15_000);
    await waitFor("A's STOP acked done by A", async () => (await c.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${yA!.requestId}`)[0]?.outcome === "done", 15_000);
  }, 60_000);

  let xfactoryRun = 0;
  it("★ cross-factory — handing factory A's robot to node B is refused; a run for node B naming A's robot is never claimable by B (invisible: the same 404 as a missing run), nothing moves", async () => {
    const { changeDeviceOwner } = await import("../robot/deviceOwnershipService");
    const r = await changeDeviceOwner({ kind: "robot", deviceId: c.ids.robotA, toEdgeNodeId: c.ids.nodeB, actorUserId: c.u.admin, actorName: "F1 attack" });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toMatch(/factory/i);
    expect((await c.sql`SELECT "edgeNodeId" FROM robots WHERE id = ${c.ids.robotA}`)[0].edgeNodeId).toBe(c.ids.nodeA);
    // the start is NOT refused today (BUG F1-2 below) — but node B can never take it: not in its pull, claim ⇒ 404
    const m0 = motions(c.ids.robotA);
    xfactoryRun = await c.startRun("xfactory", [c.steps.gate(), c.steps.move("m1", c.ids.robotA)], "B");
    const pull = await B.post("/edge/node/pull", {});
    expect(pull.json.data.runs.map((x: { runId: number }) => x.runId)).not.toContain(xfactoryRun);
    const realHash = String((await c.assignment(xfactoryRun)).defHash);
    const cl = await B.post(`/edge/node/runs/${xfactoryRun}/claim`, { claimSeq: 0, defHash: realHash, programChecks: [] });
    const missing = await B.post(`/edge/node/runs/2000000000/claim`, { claimSeq: 0, defHash: realHash, programChecks: [] });
    expect(cl.status, cl.text).toBe(404);
    expect(cl.text.split(String(xfactoryRun)).join("N")).toBe(missing.text.split("2000000000").join("N"));
    await sleep(1_000);
    expect((await c.assignment(xfactoryRun)).claimSeq).toBe(0);
    expect(motions(c.ids.robotA)).toBe(m0);
  });
  // BUG F1-2 (found here, NOT fixed — routed): design §2.12 "an assignment must name only targets owned by the node — checked at
  // startEdgeAssignedRun and again at /authorize". startEdgeAssignedRun (orchestration/foe/foeEngine.ts:4183-4223) inserts the
  // run + assignment without that check, so a run for node B naming factory A's robot is CREATED ('queued') and only later held
  // as unclaimable (fail-closed: B never sees it, /authorize would refuse not_owned). it.fails asserts the designed refusal.
  it.fails("BUG F1-2 — startRun for a node refuses a definition whose targets that node does not own (design §2.12)", async () => {
    await expect(c.startRun("xfactory2", [c.steps.gate(), c.steps.move("m1", c.ids.robotA)], "B")).rejects.toThrow();
  });

  it("★ owner question (B fix 2 G5 / R-10-aw) — the seeded untargeted safety-PLC row ENABLED ⇒ every real-mode, preflight-on authorisation is refused (gate safety); disabled again ⇒ signed", async () => {
    expect(c.disabledGlobalPlc.length).toBeGreaterThan(0); // the seed exists in _test (SIM-SAFETY-PLC-1)
    const s = c.steps;
    const cl = await readyRunB("globalPlc", [s.gate(), s.move("m1", c.ids.robotB)]);
    await c.sql`UPDATE safety_plc_configs SET enabled = true WHERE id IN ${c.sql(c.disabledGlobalPlc)}`;
    try {
      const refused = await authorizeB(cl, "m1", 1);
      expect([refused.res.status, refused.res.json?.error?.code, refused.res.json?.error?.details?.gate]).toEqual([409, "device_refused", "safety"]);
    } finally {
      await c.sql`UPDATE safety_plc_configs SET enabled = false WHERE id IN ${c.sql(c.disabledGlobalPlc)}`;
    }
    const ok = await authorizeB(cl, "m1", 1);
    expect(ok.res.status, ok.res.text).toBe(200);
    await c.abort(cl.runId);
  }, 90_000);

  // ── hostile network (edge-side): central's answers to node A's REAL edge are rewritten ─────────────────────────────

  it("★ A1 + A2(a,d) + A3(verifier) + A6 — forged / altered / typ-confused / replayed / other-node / late authorisations are ALL refused by the edge (0 motions, anomaly audited); the genuine one then moves", async () => {
    const f = await forge();
    const s = c.steps;
    // material: a signed CONFIG (typ confusion), an earlier run's valid authorisation (replay), node B's authorisation
    const cfgEnv = answerOf(/^\/config$/)?.config;
    expect(cfgEnv?.typ).toBe("avi-edge-config+v1");
    const prev = await c.startRun("a1prev", [s.gate(), s.move("m1")]);
    await c.approveAtGate(prev);
    await waitFor("the earlier run completed", async () => (await c.run(prev)).status === "completed", 30_000);
    const prevAuth = answerOf(new RegExp(`^/runs/${prev}/authorize$`))?.authorization;
    expect(prevAuth?.typ).toBe("avi-edge-auth+v1");
    const bRun = await readyRunB("a1b", [s.gate(), s.move("m1", c.ids.robotB)]);
    const bAuth = (await authorizeB(bRun, "m1", 1)).res.json.data.authorization;
    const variants: Array<[string, (genuine: any) => Promise<any> | any]> = [
      ["attacker key under the real kid", (g) => f.resignUnderRealKid(g)],
      ["payloadHash altered, signature kept", (g) => f.alter(g, { payloadHash: `sha256:${"0".repeat(64)}` })],
      ["robotId altered, signature kept", (g) => f.alter(g, { target: { robotId: c.ids.robotB, jobType: "custom" } })],
      ["ttl widened, signature kept", (g) => f.alter(g, { ttlMs: 30_000 })],
      ["a signed CONFIG presented as an authorisation", () => cfgEnv],
      ["an earlier run's valid authorisation (replay)", () => prevAuth],
      ["node B's valid authorisation", () => bAuth],
      ["the genuine token, delivered after its TTL (measured from the request)", async (g) => (await sleep(TTL_MS + 600), g)],
    ];
    const id = await c.startRun("a1", [s.gate(), { ...s.move("m1"), maxAttempts: variants.length }]);
    const used: string[] = [];
    c.front.tamper.set(`^/runs/${id}/authorize$`, async (answer, req) => {
      const attempt = Number((req.body as { attempt: number }).attempt);
      const v = variants[attempt - 1];
      if (!v || answer?.ok !== true) return undefined; // the last attempt: untouched
      used.push(v[0]);
      return { ...answer, data: { ...answer.data, authorization: await v[1](answer.data.authorization) } };
    });
    const m0 = motions(c.ids.robotA);
    try {
      await c.approveAtGate(id);
      await waitFor(`run ${id} completed`, async () => ["completed", "failed", "held"].includes((await c.run(id)).status), 120_000);
    } finally {
      c.front.tamper.clear();
    }
    expect(used).toEqual(variants.map((v) => v[0]));
    expect((await c.run(id)).status).toBe("completed");
    expect(motions(c.ids.robotA) - m0).toBe(1); // ONLY the genuine attempt moved
    const auths = await c.sql`SELECT attempt, "resultReportedAt" IS NOT NULL AS reported FROM edge_step_authorizations WHERE "runId" = ${id} ORDER BY attempt`;
    expect(auths.map((a) => [a.attempt, a.reported])).toEqual(variants.map((_, i) => [i + 1, false]).concat([[variants.length + 1, true]]));
    const anomalies = await waitFor("the edge's refusals audited centrally", async () => {
      const rows = await c.sql`SELECT details FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityType" = 'orchestration_run' AND "entityId" = ${id} AND details LIKE '%"anomaly":"EDGE_AUTH_INVALID"%'`;
      return rows.length >= variants.length ? rows.map((r) => String((JSON.parse(String(r.details)) as { detail: string }).detail)) : null;
    }, 20_000);
    const reasons = anomalies.map((d) => d.replace(/^.*: /, "")).sort();
    expect(reasons).toEqual(expect.arrayContaining(["bad_signature", "wrong_typ", "expired"]));
    expect(reasons.some((r) => /mismatch|consumed|nonce/.test(r))).toBe(true);
    await c.abort(bRun.runId);
  }, 240_000);

  it("★ A1(d) — an authorisation with alg 'none' / an empty signature is a MALFORMED answer: the step is HELD, nothing is sent", async () => {
    const s = c.steps;
    for (const [tag, mutate] of [
      ["algNone", (e: any) => ({ ...e, alg: "none" })],
      ["emptySig", (e: any) => ({ ...e, sig: "" })],
    ] as const) {
      const id = await c.startRun(tag, [s.gate(), s.move("m1")]);
      c.front.tamper.set(`^/runs/${id}/authorize$`, (answer) => (answer?.ok === true ? { ...answer, data: { ...answer.data, authorization: mutate(answer.data.authorization) } } : undefined));
      const m0 = motions(c.ids.robotA);
      try {
        await c.approveAtGate(id);
        await waitFor(`run ${id} held`, async () => (await c.run(id)).status === "held" && (await c.assignment(id)).claimTokenHash === null, 60_000);
      } finally {
        c.front.tamper.clear();
      }
      expect(motions(c.ids.robotA)).toBe(m0);
      await c.abort(id);
    }
  }, 180_000);

  it("★ A7 + R-10-ar S-1 — a STOP with a forged signature (unknown key) is executed as EVIDENCE but never acked, and never suppresses the genuine signed copy, which re-executes and is acked", async () => {
    const f = await forge();
    c.front.blocked.add("A");
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    let req: { requestId: number };
    try {
      req = await enqueueEdgeDeviceRequest({ kind: "stop", robotId: c.ids.robotA, reason: "F1 attack: forged copy first", requestedBy: c.u.admin });
    } finally {
      c.front.blocked.delete("A");
    }
    let forged = 0;
    const swap = (answer: any) => {
      if (answer?.ok !== true || !Array.isArray(answer.data?.commands)) return undefined;
      const commands = answer.data.commands.map((e: any) => {
        const p = JSON.parse(e.payload);
        if (p.requestId !== req.requestId || forged >= 3) return e;
        forged++;
        return f.signAsAttacker("cmd", p); // same content, attacker's (unknown) key
      });
      return { ...answer, data: { ...answer.data, commands } };
    };
    const s0 = stops(c.ids.robotA);
    c.front.tamper.set("^/pull$", swap);
    c.front.tamper.set("^/runs/\\d+/progress$", swap);
    try {
      await edge.waitCounts("the forged copy executed (L-7: a STOP is sent whatever its signature)", (k) => k.stops.filter((m) => m.robotId === c.ids.robotA).length > s0, 10_000);
      await waitFor("3 forged copies delivered", () => forged >= 3, 10_000);
      expect((await c.sql`SELECT "ackedAt" FROM robot_motion_lock_requests WHERE id = ${req.requestId}`)[0].ackedAt).toBeNull(); // evidence only: never acked
    } finally {
      c.front.tamper.clear();
    }
    await waitFor("the genuine signed copy acked done", async () => (await c.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${req!.requestId}`)[0]?.outcome === "done", 15_000);
    expect(stops(c.ids.robotA) - s0).toBe(2); // evidence run + the genuine one (re-executed, then acked)
    expect(one(await c.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityType" = 'edge_node' AND "entityId" = ${c.ids.nodeA} AND "createdAt" > now() - interval '5 minutes'`)).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("★ unsigned non-STOP — a forged `clear` (attacker key) for the locked robot is refused: the robot stays locked; the operator's signed clear works", async () => {
    const f = await forge();
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    await enqueueEdgeDeviceRequest({ kind: "lock", robotId: c.ids.robotA, reason: "F1 attack: lock first", requestedBy: c.u.admin });
    const locked = await edge.waitCounts("robot A locked by the signed lock", (k) => {
      const r = k.robots.find((x) => x.id === c.ids.robotA);
      return r?.locked ? r : null;
    }, 15_000);
    const [ep] = await c.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${c.ids.robotA}`;
    let injected = 0;
    c.front.tamper.set("^/pull$", (answer: any) => {
      if (answer?.ok !== true) return undefined;
      injected++;
      const payload = { kind: "clear", requestId: 900_000 + injected, robotId: c.ids.robotA, expectedGeneration: locked.generation, clearedBy: c.u.admin, reason: "forged clear", nodeId: c.ids.nodeA, credentialId: c.credentialIds.A, ownerEpoch: Number(ep.ownerEpoch), issuedAt: Date.now() - 100, expiresAt: Date.now() + 60_000 };
      return { ...answer, data: { ...answer.data, commands: [...answer.data.commands, f.signAsAttacker("cmd", payload)] } };
    });
    try {
      await waitFor("forged clears delivered", () => injected >= 5, 10_000);
      await sleep(1_000);
      expect(edge.counts()!.robots.find((x) => x.id === c.ids.robotA)?.locked).toBe(true);
    } finally {
      c.front.tamper.clear();
    }
    await c.clearEdgeLock(c.ids.robotA, edge);
  }, 60_000);

  it("★ config rollback — an older, validly signed config replayed to the edge is refused: it keeps the newer one", async () => {
    const v1 = edge.counts()!.configVersion!;
    const oldAnswer = answerOf(/^\/config$/);
    expect(oldAnswer?.config).toBeTruthy();
    // central's config changes (a tag added to A's adapter) ⇒ the edge fetches and accepts v2
    await c.sql`INSERT INTO device_tags ("adapterId", "tagKey", address, "dataType", writable) VALUES (${c.ids.adapterA}, 'rollback_probe', 'holding:40020', 'int', false)`;
    const k2 = await edge.waitCounts("the newer config accepted", (k) => ((k.configVersion ?? 0) > v1 ? k : null), 20_000);
    // from now on the network answers every /config with the OLD signed snapshot; central changes again
    let replayed = 0;
    c.front.tamper.set("^/config$", (answer: any) => (answer?.ok === true && answer.data?.config ? (replayed++, { ...answer, data: { ...oldAnswer } }) : undefined));
    try {
      await c.sql`DELETE FROM device_tags WHERE "adapterId" = ${c.ids.adapterA} AND "tagKey" = 'rollback_probe'`;
      await waitFor("the old config replayed to the edge", () => replayed >= 2, 20_000);
      await sleep(1_000);
      expect(edge.counts()!.configVersion).toBe(k2.configVersion); // never rolled back
    } finally {
      c.front.tamper.clear();
    }
    await edge.waitCounts("the genuine newest config accepted once the network is honest", (k) => (k.configVersion ?? 0) > k2.configVersion!, 20_000);
  }, 90_000);

  let a7RunId = 0;
  it("★ A7 — central DOWN (hanging, longer than the TTL): the pinned OT STOP and the robot STOP of a walking run still go out; the next non-STOP step is never sent while it is down", async () => {
    const s = c.steps;
    const w0 = c.ot.writes.length;
    const m0 = motions(c.ids.robotA);
    const s0 = stops(c.ids.robotA);
    const id = await c.startRun("a7", [s.gate(), s.otWrite("o1", 11), s.delay("d1", 1200), s.otStop("p1"), s.stop("s1"), s.move("m2")]);
    await c.approveAtGate(id);
    await waitFor("o1 written", () => c.ot.writes.length > w0, 20_000);
    c.setMode("hang");
    const downAt = Date.now();
    let upAt = 0;
    try {
      await waitFor("the pinned OT STOP written while central is down", () => c.ot.writes.slice(w0).some((w) => w.kind === "coil" && w.addr === 0 && w.value === true && w.at > downAt), 10_000);
      await edge.waitCounts("the robot STOP sent while central is down", (k) => k.stops.filter((m) => m.robotId === c.ids.robotA && m.at > downAt).length > 0 && k.stops.filter((m) => m.robotId === c.ids.robotA).length > s0, 10_000);
      await sleep(4_500); // > TTL (3 s) after m2's /authorize went out, < the edge's 8 s request timeout
      expect(motions(c.ids.robotA)).toBe(m0); // m2: no authorisation can be obtained ⇒ nothing sent while central is down
    } finally {
      upAt = Date.now();
      c.setMode("up");
    }
    // m2's authorize was in flight (8 s edge timeout). The segment ends after reconnect; nothing was sent before central came back
    await waitFor("the segment ended after reconnect", async () => ["held", "completed", "failed"].includes((await c.run(id)).status) && (await c.assignment(id)).claimTokenHash === null, 30_000);
    const late = (edge.counts()?.motions ?? []).filter((m) => m.robotId === c.ids.robotA).slice(m0);
    expect(late.every((m) => m.at >= upAt)).toBe(true);
    a7RunId = id;
  }, 120_000);
  // BUG F1-3 (found here, NOT fixed — routed; design conflict to rule on): central hung for longer than the authorisation TTL
  // while m2's /authorize was in flight; at reconnect the client's same-nonce retry (edge/edgeCentralClient.ts:394) got a token
  // whose TTL — correctly measured from the FIRST send — had already lapsed, and the client returns that as verdict "refused"
  // (edgeCentralClient.ts:419-422, code auth_invalid / "expired"), so the walker FAILS the step and the RUN (with failure /
  // compensation semantics) instead of HOLDING it (D5: "the authorisation cannot be fetched ⇒ held, Continue later"). Fail-safe
  // (nothing sent), but an outage longer than the TTL now fails runs, and the step row says "central refused its authorisation".
  // it.fails asserts the D5 outcome (held, Continue possible).
  it.fails("BUG F1-3 — a non-STOP step whose authorisation lapsed while central was unreachable is HELD (D5), not failed", async () => {
    expect(a7RunId).toBeGreaterThan(0);
    expect((await c.run(a7RunId)).status).toBe("held");
  });

  it("★ A2(b,c) — a token captured before an edge RESTART is refused after it (journal intact: jti / nonce; journal WIPED: the nonce is not pending in the new process)", async () => {
    const s = c.steps;
    for (const wipe of [false, true]) {
      const capRun = await c.startRun(`cap${wipe ? "W" : "I"}`, [s.gate(), s.move("m1")]);
      await c.approveAtGate(capRun);
      await waitFor("the capture run completed", async () => (await c.run(capRun)).status === "completed", 30_000);
      const captured = answerOf(new RegExp(`^/runs/${capRun}/authorize$`))?.authorization;
      expect(captured?.typ).toBe("avi-edge-auth+v1");
      await edge.kill();
      const old = edge;
      edge = await c.spawnEdge(wipe ? "x3" : "x2", wipe ? { env: { EDGE_REQUEST_TIMEOUT_MS: "8000" } } : { journalDir: old.journalDir, env: { EDGE_REQUEST_TIMEOUT_MS: "8000" } });
      await c.clearEdgeLock(c.ids.robotA, edge);
      // the replay: the captured token (and a copy re-labelled to this attempt, signature kept) answers the new run's authorize
      const f = await forge();
      const id = await c.startRun(`replay${wipe ? "W" : "I"}`, [s.gate(), { ...s.move("m1"), maxAttempts: 1 }]);
      let n = 0;
      c.front.tamper.set(`^/runs/${id}/authorize$`, (answer: any, req) => {
        if (answer?.ok !== true) return undefined;
        n++;
        const b = req.body as { attempt: number; reqNonce: string };
        const env = n === 1 ? captured : f.alter(captured, { runId: id, attempt: b.attempt, reqNonce: b.reqNonce });
        return { ...answer, data: { ...answer.data, authorization: env } };
      });
      const m0 = motions(c.ids.robotA);
      try {
        await c.approveAtGate(id);
        await waitFor(`run ${id} ended`, async () => ["failed", "held"].includes((await c.run(id)).status) && (await c.assignment(id)).claimTokenHash === null, 60_000);
      } finally {
        c.front.tamper.clear();
      }
      expect(n).toBe(2);
      expect(motions(c.ids.robotA)).toBe(m0);
      if ((await c.run(id)).status !== "failed") await c.abort(id);
      const rep = old.counts()!;
      expect({ trap: rep.trap.count, pg: rep.pgConnects, ctor: rep.pgConstructed }).toEqual({ trap: 0, pg: 0, ctor: 0 });
    }
  }, 360_000);

  it("★ A7 — a FULL journal blocks new non-STOP work only: no run is claimed, but a robot STOP and a pinned OT STOP still go out", async () => {
    await edge.stop();
    edge = await c.spawnEdge("full", { env: { EDGE_JOURNAL_MAX_BYTES: "1", EDGE_REQUEST_TIMEOUT_MS: "8000" } });
    expect(edge.counts()!.journal?.full).toBe(true);
    const s = c.steps;
    const id = await c.startRun("full", [s.gate(), s.move("m1")]);
    await sleep(3_000); // ~15 pulls
    expect((await c.assignment(id)).claimSeq).toBe(0); // no NEW non-STOP work while the journal is full
    expect(motions(c.ids.robotA)).toBe(0);
    // STOPs: a console STOP of the robot, and a central STOP of the adapter (its PINNED stop tag, from the signed snapshot)
    const s0 = stops(c.ids.robotA);
    const w0 = c.ot.writes.length;
    const r = await c.trpc("robot.consoleStop", { robotId: c.ids.robotA, command: "stop" }, await c.engineerSession());
    expect(r.json?.result?.data?.json, JSON.stringify(r.json)).toMatchObject({ status: "queued_on_edge" });
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    await enqueueEdgeDeviceRequest({ kind: "stop", adapterId: c.ids.adapterA, reason: "F1 attack: adapter STOP with a full journal", requestedBy: c.u.admin });
    await edge.waitCounts("the robot STOP sent with a full journal", (k) => k.stops.filter((m) => m.robotId === c.ids.robotA).length > s0, 15_000);
    await waitFor("the pinned OT STOP written with a full journal", () => c.ot.writes.slice(w0).some((w) => w.kind === "coil" && w.addr === 0 && w.value === true), 15_000);
    expect(motions(c.ids.robotA)).toBe(0);
    await c.abort(id).catch(() => undefined);
  }, 240_000);

  it("★ the edge processes of this suite never touched the DB (0 trap hits, 0 PG connects, no postgres client)", async () => {
    const rep = await edge.stop();
    expect(noDbEvidence(rep)).toEqual({ trap: 0, pgConnects: 0, pgConstructed: 0, probe: "EDGE_DB_TRAP", removedFromEnv: ["DATABASE_URL"] });
    for (const e of c.edges) {
      const k = e.counts();
      if (k) expect({ name: e.name, trap: k.trap.count, pg: k.pgConnects, ctor: k.pgConstructed }).toEqual({ name: e.name, trap: 0, pg: 0, ctor: 0 });
    }
  }, 120_000);
});
