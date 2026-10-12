/**
 * doc 81 Đợt 10 task B — the journal replay on the REAL `_test` DB: POST runs/:id/report, POST locks/events, POST
 * runs/:id/complete (v2). Covered: the cursor (applied / duplicate / gap / new epoch only from seq 1, audited), central the
 * only writer of rows (a gate row from the edge is never written; results are stamped approvalSource "edge"), a non-STOP
 * result without a jti ⇒ 409 unauthorised_actuation + anomaly audit (A4), ONE ledger row per jti (A2e), a STOP ledger needs no
 * jti, stale-claim evidence recorded without touching the run row, segment end (paused ⇒ awaiting_confirm + gate row;
 * completed refused while a step is not done; gap when reports are missing), lock events only through the guarded functions
 * and only for owned robots (A3), command acks.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupKit, kitSteps, nonce, type Kit } from "./__edgeCentralKit.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
const count = async (q: Promise<Array<{ n: number }>>) => Number((await q)[0].n);
const epoch = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

async function claimed(tag: string, steps: unknown[], approve = true) {
  const run = await k.newRun(tag, "A", steps);
  const c = await import("./edgeExecutionCentral");
  const r = await c.claimForNodeV2(await k.principal("A"), run.runId, { claimSeq: 0, defHash: run.defHash, programChecks: k.readings([k.ids.adapterA]) });
  expect(r.http, JSON.stringify(r)).toBe(200);
  if (approve) await k.approveGate(run.runId, run.def, k.u.approver, k.readings([k.ids.adapterA]));
  return { ...run, claimSeq: r.data!.claimSeq, claimToken: r.data!.claimToken, stream: `run:${run.runId}:${r.data!.claimSeq}`, epoch: epoch() };
}
async function report(p: { runId: number; claimSeq: number; claimToken: string; stream: string; epoch: string }, records: unknown[], who: "A" | "B" = "A") {
  const { reportForNode } = await import("./edgeReportsCentral");
  return reportForNode(await k.principal(who), p.runId, { claimSeq: p.claimSeq, claimToken: p.claimToken, epoch: p.epoch, stream: p.stream, records });
}
const stepRec = (seq: number, stepId: string, over: Record<string, unknown> = {}) => ({
  kind: "step",
  seq,
  stepId,
  stepType: "command",
  status: "running",
  attempt: 0,
  startedAt: Date.now(),
  finishedAt: null,
  error: null,
  result: null,
  jti: null,
  ...over,
});
async function authorizeO1(p: { runId: number; claimSeq: number; claimToken: string }) {
  const { otPayloadHash } = await import("../ot/otActionBinding");
  const writes = [{ tagKey: "speed_sp", value: 7 }];
  const { authorizeForNode } = await import("./edgeAuthorizeCentral");
  const r = await authorizeForNode(await k.principal("A"), p.runId, {
    claimSeq: p.claimSeq,
    claimToken: p.claimToken,
    stepId: "o1",
    attempt: 1,
    idempotencyKey: `run${p.runId}-o1-a1`,
    reqNonce: nonce(),
    command: { kind: "ot", adapterId: k.ids.adapterA, machineId: k.ids.mOtA, commandType: "write_tag", writes },
    payloadHash: otPayloadHash({ tool: "foe.orchestration", adapterId: k.ids.adapterA, machineId: k.ids.mOtA, commandType: "write_tag", writes }),
    programChecks: k.readings([k.ids.adapterA]),
  });
  expect(r.http, JSON.stringify(r)).toBe(200);
  return JSON.parse(r.data!.authorization.payload).jti as string;
}

describe.skipIf(!onTest)("doc 81 Đợt 10 B — reports / events / complete (real _test DB)", () => {
  beforeAll(async () => {
    k = await setupKit("B10REP");
  }, 120_000);
  afterAll(async () => {
    await k?.teardown();
  }, 120_000);

  it("★ cursor: seq 1..3 applied; a replay counts duplicates; a gap ⇒ 409 {expectedSeq}; a new epoch only from seq 1 (and audited)", async () => {
    const s = kitSteps(k);
    const p = await claimed("cursor", [s.gate, { id: "w1", type: "delay", ms: 1 }, s.otWrite]);
    const recs = [stepRec(1, "w1", { stepType: "delay" }), stepRec(2, "w1", { stepType: "delay", status: "completed", finishedAt: Date.now() }), { kind: "context", seq: 3, patch: { telemetry: { note: "x" }, foeRejectClaim: "forged", edgeUnreachable: true } }];
    expect(await report(p, recs)).toMatchObject({ http: 200, data: { ackedSeq: 3, applied: 3, duplicates: 0 } });
    expect(await report(p, recs)).toMatchObject({ http: 200, data: { ackedSeq: 3, applied: 0, duplicates: 3 } });
    expect(await report(p, [stepRec(5, "w1", { stepType: "delay" })])).toMatchObject({ http: 409, code: "gap", data: { expectedSeq: 4 } });
    const [row] = await k.sql`SELECT status FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'w1'`;
    expect(row.status).toBe("completed");
    const [run] = await k.sql`SELECT "contextJson" FROM orchestration_runs WHERE id = ${p.runId}`;
    const ctx = typeof run.contextJson === "string" ? JSON.parse(run.contextJson) : run.contextJson;
    expect(ctx.telemetry).toEqual({ note: "x" });
    expect(ctx).not.toHaveProperty("foeRejectClaim"); // server-only keys are never taken from an edge
    expect(ctx).not.toHaveProperty("edgeUnreachable");
    const e2 = { ...p, epoch: epoch() };
    expect(await report(e2, [stepRec(2, "w1", { stepType: "delay" })])).toMatchObject({ http: 409, code: "epoch_rejected" });
    expect((await report(e2, [stepRec(1, "w1", { stepType: "delay" })])).http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_JOURNAL_EPOCH' AND "entityId" = ${k.ids.nodeA}`)).toBeGreaterThanOrEqual(1);
    // a 'running' report never regresses the completed row (the engine's guard)
    const [after] = await k.sql`SELECT status FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'w1'`;
    expect(after.status).toBe("completed");
  });

  it("★ A4: a non-STOP command result without a jti ⇒ 409 unauthorised_actuation + EDGE_ANOMALY, nothing applied; with its jti ⇒ recorded as the edge's", async () => {
    const s = kitSteps(k);
    const p = await claimed("jti", [s.gate, s.otWrite, { ...s.otWrite, id: "o3" }]);
    const rogue = await report(p, [stepRec(1, "o1", { result: { routedTo: "ot-dispatcher", status: "acked", accepted: true } })]);
    expect(rogue).toMatchObject({ http: 409, code: "unauthorised_actuation" });
    expect(await count(k.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'o1'`)).toBe(0);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${p.runId}`)).toBe(1);
    // a completed command step without a jti is refused too (it claims the command happened)
    expect((await report(p, [stepRec(1, "o1", { status: "completed" })])).code).toBe("unauthorised_actuation");
    const jti = await authorizeO1(p);
    // a jti issued for ANOTHER step, or quoted under another claim, does not cover it
    expect((await report(p, [stepRec(1, "o3", { result: { routedTo: "ot-dispatcher", status: "simulated", accepted: true }, jti })])).code).toBe("unauthorised_actuation");
    expect((await report(p, [stepRec(1, "o1", { attempt: 2, result: { routedTo: "ot-dispatcher", status: "simulated", accepted: true }, jti })])).code).toBe("unauthorised_actuation");
    const ok = await report(p, [stepRec(1, "o1", { result: { routedTo: "ot-dispatcher", status: "simulated", accepted: true }, jti })]);
    expect(ok.http, JSON.stringify(ok)).toBe(200);
    const [row] = await k.sql`SELECT "resultJson" FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'o1'`;
    const res = typeof row.resultJson === "string" ? JSON.parse(row.resultJson) : row.resultJson;
    expect(res).toMatchObject({ approvalSource: "edge", edge: { nodeId: k.ids.nodeA, jti } });
  });

  it("★ central is the ONLY writer of gate rows: an edge 'completed + approvedBy' gate row is never written (no forged approval)", async () => {
    const s = kitSteps(k);
    const p = await claimed("forge", [s.gate, s.otWrite], false);
    const r = await report(p, [stepRec(1, "g0", { stepType: "hitl_gate", status: "completed", result: { approved: true, approvedBy: k.u.approver, approvalSource: "server" } })]);
    expect(r.http).toBe(200); // acknowledged (the stream moves on) …
    expect(await count(k.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'g0'`)).toBe(0); // … never written
    expect((await report(p, [stepRec(2, "abort:o1")])).http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'abort:o1'`)).toBe(0);
  });

  it("★ A2e ledger: ONE robot_jobs / command_log row per jti — the same jti under a new seq ⇒ 409 replayed; a STOP needs no jti (source edge)", async () => {
    const s = kitSteps(k);
    const p = await claimed("ledger", [s.gate, s.otWrite, s.robotStop]);
    const jti = await authorizeO1(p);
    const led = (seq: number, over: Record<string, unknown> = {}) => ({
      kind: "ledger",
      seq,
      stepId: "o1",
      attempt: 1,
      idempotencyKey: `run${p.runId}-o1-a1`,
      jti,
      stop: false,
      target: { adapterId: k.ids.adapterA, commandType: "write_tag" },
      status: "simulated",
      result: { writes: [{ tagKey: "speed_sp", value: 7 }] },
      at: Date.now(),
      ...over,
    });
    expect((await report(p, [led(1)])).http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM command_log WHERE "idempotencyKey" = ${`edge:${jti}`}`)).toBe(1);
    expect((await report(p, [led(2)])).code).toBe("replayed");
    expect(await count(k.sql`SELECT count(*)::int AS n FROM command_log WHERE "adapterId" = ${k.ids.adapterA} AND "idempotencyKey" LIKE 'edge:%'`)).toBe(1);
    const [auth] = await k.sql`SELECT "resultStatus" FROM edge_step_authorizations WHERE jti = ${jti}`;
    expect(auth.resultStatus).toBe("simulated");
    // a ledger without jti for a non-STOP ⇒ unauthorised
    expect((await report(p, [led(2, { jti: null })])).code).toBe("unauthorised_actuation");
    // a STOP (robot abort) ledger needs no jti
    const ep = Number((await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`)[0].ownerEpoch);
    const stop = await report(p, [{ kind: "ledger", seq: 2, stepId: "s1", attempt: 1, idempotencyKey: `run${p.runId}-s1-a1`, jti: null, stop: true, target: { robotId: k.ids.robotA, jobType: "abort" }, ownerEpoch: ep, status: "done", result: null, at: Date.now() }]);
    expect(stop.http, JSON.stringify(stop)).toBe(200);
    const [job] = await k.sql`SELECT "jobType", status, result FROM robot_jobs WHERE "robotId" = ${k.ids.robotA} AND "idempotencyKey" LIKE ${`edge-stop:${k.ids.nodeA}:%`}`;
    expect(job).toMatchObject({ jobType: "abort", status: "done" });
    // abort_stop ⇒ the abort:<id> row central keeps
    expect((await report(p, [{ kind: "abort_stop", seq: 3, stepId: "s1", status: "completed", result: { routedTo: "robot" }, at: Date.now() }])).http).toBe(200);
    const [ab] = await k.sql`SELECT status, "resultJson" FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'abort:s1'`;
    expect(ab.status).toBe("completed");
  });

  it("★ ledger scope: A's ledger for B's robot ⇒ anomaly, nothing written; a STOP ledger off a verified STOP step / on another target / at a stale epoch ⇒ anomaly, nothing written", async () => {
    const s = kitSteps(k);
    const p = await claimed("ledgerscope", [s.gate, s.robotStop, s.robotMove, s.otPinnedStop], true);
    const epA = Number((await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotA}`)[0].ownerEpoch);
    const epB = Number((await k.sql`SELECT "ownerEpoch" FROM robots WHERE id = ${k.ids.robotB}`)[0].ownerEpoch);
    const stopLed = (seq: number, stepId: string, robotId: number, ownerEpoch: number | undefined) => ({
      kind: "ledger",
      seq,
      stepId,
      attempt: 1,
      idempotencyKey: `run${p.runId}-${stepId}-a1`,
      jti: null,
      stop: true,
      target: { robotId, jobType: "abort" },
      ...(ownerEpoch === undefined ? {} : { ownerEpoch }),
      status: "done",
      result: null,
      at: Date.now(),
    });
    const jobs = async (robotId: number) => Number((await k.sql`SELECT count(*)::int AS n FROM robot_jobs WHERE "robotId" = ${robotId} AND "idempotencyKey" LIKE 'edge-stop:%'`)[0].n);
    const beforeA = await jobs(k.ids.robotA);
    const beforeB = await jobs(k.ids.robotB);
    const recs = [
      stopLed(1, "s1", k.ids.robotB, epB), // B's robot (A does not own it)
      stopLed(2, "m1", k.ids.robotA, epA), // a MOTION step claimed as a STOP
      stopLed(3, "p1", k.ids.robotA, epA), // a verified STOP step whose target is adapter A, not robot A
      stopLed(4, "s1", k.ids.robotA, epA + 5), // stale owner epoch
      stopLed(5, "s1", k.ids.robotA, undefined), // no owner epoch
    ];
    expect((await report(p, recs)).http).toBe(200);
    expect(await jobs(k.ids.robotB)).toBe(beforeB);
    expect(await jobs(k.ids.robotA)).toBe(beforeA);
    const anomalies = await k.sql`SELECT details FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${p.runId}`;
    const text = anomalies.map((a) => String(a.details)).join(" ");
    expect(text).toContain("ledger_not_owned");
    expect((text.match(/stop_ledger_refused/g) ?? []).length).toBe(4);
    // the right one is written
    expect((await report(p, [stopLed(6, "s1", k.ids.robotA, epA)])).http).toBe(200);
    expect(await jobs(k.ids.robotA)).toBe(beforeA + 1);
  });

  it("★ R-10-n context allow-list: a protected key (foeRejectClaim / edgeHeld / interrupted / approvedBy) is never written and is audited; branch / dispatched / telemetry are", async () => {
    const s = kitSteps(k);
    const p = await claimed("ctxallow", [s.gate, { id: "w1", type: "delay", ms: 1 }]);
    const patch = { "branch:b1": "then", foeDispatchedSteps: ["w1"], foeCompensationHeld: { stepId: "w1" }, telemetry: { x: 1 }, foeRejectClaim: "forged", edgeHeld: "x", interrupted: false, approvedBy: 1, foeOutcomeUnknown: ["w1"] };
    expect((await report(p, [{ kind: "context", seq: 1, patch }])).http).toBe(200);
    const [run] = await k.sql`SELECT "contextJson" FROM orchestration_runs WHERE id = ${p.runId}`;
    const ctx = typeof run.contextJson === "string" ? JSON.parse(run.contextJson) : run.contextJson;
    expect(ctx).toMatchObject({ "branch:b1": "then", foeDispatchedSteps: ["w1"], foeCompensationHeld: { stepId: "w1" }, telemetry: { x: 1 } });
    for (const key of ["foeRejectClaim", "edgeHeld", "interrupted", "approvedBy", "foeOutcomeUnknown"]) expect(ctx).not.toHaveProperty(key);
    const [a] = await k.sql`SELECT details FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${p.runId} AND details LIKE '%context_key_refused%'`;
    expect(String(a.details)).toContain("foeRejectClaim");
  });

  it("★ R-10-z: an actuation evidence event is AUDITED for an owned device (never run state); for a device the node does not own ⇒ anomaly only", async () => {
    const { eventsForNode } = await import("./edgeReportsCentral");
    const ev = epoch();
    const fakeRun = 1_900_000_000 + Math.floor(Math.random() * 100_000_000); // a run id no row has (evidence of a lost claim)
    const act = (seq: number, target: Record<string, unknown>) => ({ kind: "actuation", seq, runId: fakeRun, claimSeq: 3, stepId: "m1", attempt: 1, jti: null, stop: false, target, outcome: "done", at: Date.now() });
    expect((await eventsForNode(await k.principal("A"), { epoch: ev, stream: "events", records: [act(1, { robotId: k.ids.robotA, jobType: "custom" }), act(2, { robotId: k.ids.robotB, jobType: "custom" })] })).http).toBe(200);
    // M-5 — a run that is not this node's is audited against the NODE (the run id kept in the details)
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ACTUATION_WITHOUT_CLAIM' AND "entityType" = 'edge_node' AND "entityId" = ${k.ids.nodeA} AND details LIKE ${`%${fakeRun}%`}`)).toBe(1);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${k.ids.nodeA} AND details LIKE ${`%actuation_not_owned%${fakeRun}%`}`)).toBe(1);
  });

  it("★ M-4 stale claim: a report of an EARLIER (released) claim ⇒ 409 claim_stale, NOTHING written; B's reports on A's run ⇒ 404; a claim that never existed ⇒ claim_stale", async () => {
    const s = kitSteps(k);
    const p = await claimed("stale", [s.gate, { id: "w1", type: "delay", ms: 1 }]);
    const c = await import("./edgeExecutionCentral");
    expect((await c.releaseForNodeV2(await k.principal("A"), p.runId, { claimSeq: p.claimSeq, claimToken: p.claimToken, seq: 1, reason: "test" })).http).toBe(200);
    // the token was cleared by the release: even the same claimSeq has no proof of claim any more
    expect((await report(p, [stepRec(1, "w1", { stepType: "delay", status: "completed" })])).code).toBe("claim_stale");
    await k.sql`UPDATE orchestration_runs SET status = 'queued' WHERE id = ${p.runId}`;
    const re = await c.claimForNodeV2(await k.principal("A"), p.runId, { claimSeq: p.claimSeq, defHash: p.defHash, programChecks: [] });
    expect(re.http, JSON.stringify(re)).toBe(200);
    const r = await report(p, [stepRec(1, "w1", { stepType: "delay", status: "completed" }), { kind: "context", seq: 2, patch: { telemetry: { stale: true } } }]);
    expect(r).toMatchObject({ http: 409, code: "claim_stale" });
    expect(await count(k.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'w1'`)).toBe(0);
    expect((await report(p, [stepRec(4, "w1")], "B")).http).toBe(404);
    expect((await report({ ...p, claimSeq: 9, stream: `run:${p.runId}:9` }, [stepRec(1, "w1")])).code).toBe("claim_stale");
  });

  it("★ R-10-ag: a seq re-sent with the SAME content is a duplicate; with DIFFERENT content ⇒ 409 seq_conflict + anomaly with both hashes, nothing written", async () => {
    const s = kitSteps(k);
    const p = await claimed("seqhash", [s.gate, { id: "w1", type: "delay", ms: 1 }, { id: "w2", type: "delay", ms: 1 }]);
    const r1 = stepRec(1, "w1", { stepType: "delay", status: "completed", startedAt: 1_000, finishedAt: 2_000 });
    expect((await report(p, [r1])).http).toBe(200);
    expect(await report(p, [r1])).toMatchObject({ http: 200, data: { duplicates: 1, applied: 0 } });
    const forged = { ...r1, stepId: "w2", status: "failed", error: "x" };
    const c = await report(p, [forged, stepRec(2, "w2", { stepType: "delay", status: "completed" })]);
    expect(c).toMatchObject({ http: 409, code: "seq_conflict", data: { seq: 1 } });
    expect(await count(k.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'w2'`)).toBe(0);
    const [a] = await k.sql`SELECT details FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${k.ids.nodeA} AND details LIKE '%seq_conflict%' ORDER BY id DESC LIMIT 1`;
    expect(String(a.details)).toMatch(/storedHash.*receivedHash/);
  });

  it("★ R-10-as: no fallback encoding — a record with NO canonical form (prototype key / too deep) is REFUSED: not applied, no hash stored, an anomaly outcome; the cursor moves on", async () => {
    const { applyStream, edgeRecordHash } = await import("./edgeReportsCentral");
    const { centralDb } = await import("./edgeCentralCommon");
    let deep: unknown = 1;
    for (let i = 0; i < 80; i++) deep = { x: deep };
    const proto = JSON.parse('{"seq":2,"__proto__":{"a":1}}') as { seq: number };
    expect(edgeRecordHash({ seq: 1, deep })).toBeNull();
    expect(edgeRecordHash(proto)).toBeNull();
    expect(edgeRecordHash({ b: 1, a: 2 })).toBe(edgeRecordHash({ a: 2, b: 1 })); // key order never changes the hash
    const ep = Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
    const applied: number[] = [];
    const recs = [{ seq: 1, deep }, proto, { seq: 3, ok: true }] as Array<{ seq: number }>;
    const r = await applyStream(await centralDb(), await k.principal("A"), "events", ep, recs, async (_tx, rec) => {
      applied.push(rec.seq);
    });
    expect(r, JSON.stringify(r)).toMatchObject({
      http: 200,
      data: { ackedSeq: 3, applied: 1, outcomes: [{ seq: 1, outcome: "anomaly", code: "record_unencodable" }, { seq: 2, outcome: "anomaly", code: "record_unencodable" }] },
    });
    expect(applied).toEqual([3]);
    const stored = await k.sql`SELECT seq FROM edge_node_report_records WHERE "edgeNodeId" = ${k.ids.nodeA} AND stream = 'events' AND epoch = ${ep} ORDER BY seq`;
    expect(stored.map((x) => Number(x.seq))).toEqual([3]);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${k.ids.nodeA} AND details LIKE '%record_unencodable%' AND details LIKE ${`%${ep}%`}`)).toBe(2);
  });

  it("★ M-5: refusal / anomaly / actuation events naming ANOTHER node's run are audited against the reporting node, never that run", async () => {
    const { eventsForNode } = await import("./edgeReportsCentral");
    const s = kitSteps(k);
    const runB = await k.newRun("m5B", "B", [s.gate, s.otWriteB]);
    const before = await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'orchestration_run' AND "entityId" = ${runB.runId}`);
    const r = await eventsForNode(await k.principal("A"), {
      epoch: epoch(),
      stream: "events",
      records: [
        { kind: "refusal", seq: 1, runId: runB.runId, stepId: "b1", reason: "local_gate", at: Date.now() },
        { kind: "anomaly", seq: 2, code: "X", runId: runB.runId, detail: null, at: Date.now() },
      ],
    });
    expect(r.http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE "entityType" = 'orchestration_run' AND "entityId" = ${runB.runId}`)).toBe(before);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_LOCAL_REFUSAL' AND "entityType" = 'edge_node' AND "entityId" = ${k.ids.nodeA} AND details LIKE ${`%${runB.runId}%`}`)).toBe(1);
  });

  it("★ complete: reports missing ⇒ 409 gap; `completed` while a step is not done ⇒ 409 not_finished (nothing changes); `paused` ⇒ awaiting_confirm + gate row", async () => {
    const s = kitSteps(k);
    const p = await claimed("complete", [{ id: "w1", type: "delay", ms: 1 }, { id: "g1", type: "hitl_gate", prompt: "ok?" }], false);
    const c = await import("./edgeExecutionCentral");
    const base = { claimSeq: p.claimSeq, claimToken: p.claimToken, epoch: p.epoch };
    expect(await c.completeForNodeV2(await k.principal("A"), p.runId, { ...base, seq: 1, outcome: "completed", reportedThrough: 2 })).toMatchObject({ code: "gap", data: { expectedSeq: 1 } });
    expect((await report(p, [stepRec(1, "w1", { stepType: "delay", status: "completed" }), stepRec(2, "g1", { stepType: "hitl_gate", status: "awaiting_confirm" })])).http).toBe(200);
    expect(await c.completeForNodeV2(await k.principal("A"), p.runId, { ...base, seq: 1, outcome: "completed", reportedThrough: 2 })).toMatchObject({ code: "not_finished" });
    expect((await k.sql`SELECT status FROM orchestration_runs WHERE id = ${p.runId}`)[0].status).toBe("running");
    const done = await c.completeForNodeV2(await k.principal("A"), p.runId, { ...base, seq: 2, outcome: "paused", gateStepId: "g1", reportedThrough: 2 });
    expect(done, JSON.stringify(done)).toMatchObject({ http: 200, data: { status: "awaiting_confirm" } });
    const [run] = await k.sql`SELECT status, "currentStepId" FROM orchestration_runs WHERE id = ${p.runId}`;
    expect(run).toMatchObject({ status: "awaiting_confirm", currentStepId: "g1" });
    expect((await k.sql`SELECT status FROM orchestration_run_steps WHERE "runId" = ${p.runId} AND "stepId" = 'g1'`)[0].status).toBe("awaiting_confirm");
    // the claim token is cleared: a second complete is stale
    expect((await c.completeForNodeV2(await k.principal("A"), p.runId, { ...base, seq: 3, outcome: "failed", reportedThrough: 2 })).code).toBe("claim_stale");
    void s;
  });

  it("★ events: lock / clear only through the guarded functions for an OWNED robot at its epoch; B's lock event for A's robot changes nothing; acks", async () => {
    const { eventsForNode } = await import("./edgeReportsCentral");
    const [r] = await k.sql`SELECT "ownerEpoch", "motionLockGenerationFloor" FROM robots WHERE id = ${k.ids.robotA}`;
    const ep = Number(r.ownerEpoch);
    const gen = Number(r.motionLockGenerationFloor) + 5;
    const evA = epoch();
    const lock = (seq: number, event: "locked" | "cleared", g = gen, ownerEpoch = ep) => ({ kind: "lock", seq, robotId: k.ids.robotA, event, generation: g, ownerEpoch, reasonCode: "outcomeUnknown", since: Date.now(), clearedBy: event === "cleared" ? "stop" : null, requestId: null });
    expect((await eventsForNode(await k.principal("A"), { epoch: evA, stream: "events", records: [lock(1, "locked")] })).http).toBe(200);
    const [row] = await k.sql`SELECT authority, generation FROM robot_motion_locks WHERE "robotId" = ${k.ids.robotA}`;
    expect(row).toMatchObject({ authority: `edge:${k.ids.nodeA}`, generation: gen });
    // B reports a clear of A's robot: nothing changes (anomaly), the stream still moves on
    expect((await eventsForNode(await k.principal("B"), { epoch: epoch(), stream: "events", records: [{ ...lock(1, "cleared"), generation: 2_000_000 }] })).http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM robot_motion_locks WHERE "robotId" = ${k.ids.robotA}`)).toBe(1);
    // refused by central's OWN ownership check (not only by the DB function behind it)
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${k.ids.nodeB} AND details LIKE '%lock_event_not_owned%'`)).toBe(1);
    // a stale epoch clear matches nothing
    expect((await eventsForNode(await k.principal("A"), { epoch: evA, stream: "events", records: [lock(2, "cleared", gen, ep + 7)] })).http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM robot_motion_locks WHERE "robotId" = ${k.ids.robotA}`)).toBe(1);
    // the right clear
    expect((await eventsForNode(await k.principal("A"), { epoch: evA, stream: "events", records: [lock(3, "cleared")] })).http).toBe(200);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM robot_motion_locks WHERE "robotId" = ${k.ids.robotA}`)).toBe(0);
    // command ack: only for ITS request, once
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const q = await enqueueEdgeDeviceRequest({ kind: "stop", robotId: k.ids.robotA, reason: "console STOP", requestedBy: k.u.admin });
    await k.sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now() WHERE id = ${q.requestId}`;
    const ack = (seq: number) => ({ kind: "command_ack", seq, requestId: q.requestId, outcome: "done", generation: null, at: Date.now(), target: { robotId: k.ids.robotA }, ownerEpoch: ep });
    expect((await eventsForNode(await k.principal("B"), { epoch: epoch(), stream: "events", records: [ack(1)] })).http).toBe(200); // R-10-o / I-6: refused ack = anomaly outcome, the request stays pending
    expect((await k.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${q.requestId}`)[0].outcome).toBeNull();
    expect((await eventsForNode(await k.principal("A"), { epoch: evA, stream: "events", records: [ack(4)] })).http).toBe(200);
    expect((await k.sql`SELECT outcome FROM robot_motion_lock_requests WHERE id = ${q.requestId}`)[0].outcome).toBe("done");
    // strict: a trust / identity key in a record ⇒ 400
    expect((await eventsForNode(await k.principal("A"), { epoch: evA, stream: "events", records: [{ ...lock(5, "locked"), authority: "central" }] })).http).toBe(400);
  });
});
