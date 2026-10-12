/**
 * doc 81 Đợt 10 task B — POST /edge/node/runs/:runId/authorize on the REAL `_test` DB (migrations 0370–0375), through the
 * service function the route calls. The token is verified with the EDGE's verifier (edgeTrust.verifyEdgeAuthorization over a
 * trust store pinned from the keyring FILES) — an independent oracle for what central signs. Covered: the happy path (a signed,
 * single-use authorisation + one `ai_pending_actions` row bound to the payload + one `edge_step_authorizations` row), the
 * idempotent nonce, and EVERY refusal reason in the design's order: 404 (another node / missing — byte-identical),
 * claim_stale, stopped, run_not_active, definition / step / attempt / idempotency key, payload_mismatch (+ anomaly audit),
 * not_owned, stop_needs_no_authorization (robot abort, pinned OT stop — L-7), gate_required (no gate, owner's own approval,
 * stale program reading), device gates (motion lock of the owner change, central lock request, disabled robot, read-only tag,
 * disabled adapter), mode real / simulated, strict body, protocol v1.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { setupKit, kitSteps, nonce, type Kit } from "./__edgeCentralKit.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function svc() {
  return import("./edgeAuthorizeCentral");
}
/** claim a queued run of node A (v2), with A's readings */
async function claimA(runId: number, defHash: string) {
  const c = await import("./edgeExecutionCentral");
  const r = await c.claimForNodeV2(await k.principal("A"), runId, { claimSeq: 0, defHash, programChecks: k.readings([k.ids.adapterA]) });
  expect(r.http, JSON.stringify(r)).toBe(200);
  return r.data!;
}
async function prepared(tag: string, steps: unknown[], approveBy: number | null = k.u.approver) {
  const run = await k.newRun(tag, "A", steps);
  const cl = await claimA(run.runId, run.defHash);
  if (approveBy !== null) await k.approveGate(run.runId, run.def, approveBy, k.readings([k.ids.adapterA]));
  return { ...run, claimSeq: cl.claimSeq, claimToken: cl.claimToken };
}
async function otPayloadHashOf(adapterId: number, machineId: number, commandType: string, writes: Array<{ tagKey: string; value: unknown }>) {
  const { otPayloadHash } = await import("../ot/otActionBinding");
  return otPayloadHash({ tool: "foe.orchestration", adapterId, machineId, commandType, writes });
}
async function otBody(p: { runId: number; claimSeq: number; claimToken: string }, over: Record<string, unknown> = {}) {
  const writes = [{ tagKey: "speed_sp", value: 7 }];
  return {
    claimSeq: p.claimSeq,
    claimToken: p.claimToken,
    stepId: "o1",
    attempt: 1,
    idempotencyKey: `run${p.runId}-o1-a1`,
    reqNonce: nonce(),
    command: { kind: "ot", adapterId: k.ids.adapterA, machineId: k.ids.mOtA, commandType: "write_tag", writes },
    payloadHash: await otPayloadHashOf(k.ids.adapterA, k.ids.mOtA, "write_tag", writes),
    programChecks: k.readings([k.ids.adapterA]),
    ...over,
  };
}
async function robotBody(p: { runId: number; claimSeq: number; claimToken: string }, stepId = "m1", jobType = "custom") {
  const { robotPayloadHash } = await import("../ot/otActionBinding");
  return {
    claimSeq: p.claimSeq,
    claimToken: p.claimToken,
    stepId,
    attempt: 1,
    idempotencyKey: `run${p.runId}-${stepId}-a1`,
    reqNonce: nonce(),
    command: { kind: "robot", robotId: k.ids.robotA, jobType, params: {} },
    payloadHash: robotPayloadHash({ robotId: k.ids.robotA, jobType, params: {} }),
    programChecks: k.readings([k.ids.adapterA]),
  };
}
async function verifyAsEdge(env: unknown, ctx: Record<string, unknown>) {
  const { verifyEdgeAuthorization } = await import("./edgeTrust");
  const store = await k.store(k.ids.nodeA);
  const t0 = performance.now();
  return verifyEdgeAuthorization(store, env, {
    pendingNonceSentAt: () => t0, // contract delta R-10-f: the TTL starts at the nonce's FIRST send
    nowMonoMs: t0 + 1,
    maxTtlMs: 30_000,
    isJtiConsumed: () => false,
    ...ctx,
  } as never);
}
const count = async (q: Promise<Array<{ n: number }>>) => Number((await q)[0].n);

describe.skipIf(!onTest)("doc 81 Đợt 10 B — /authorize (real _test DB, edge-side verifier as oracle)", () => {
  beforeAll(async () => {
    k = await setupKit("B10AUTH");
  }, 120_000);
  afterAll(async () => {
    await k?.teardown();
  }, 120_000);

  it("★ happy path (OT): a signed authorisation the EDGE verifier accepts; one executed ai_pending_actions row bound to the payload; one jti row; audited", async () => {
    const s = kitSteps(k);
    const p = await prepared("ok", [s.gate, s.otWrite]);
    const body = await otBody(p);
    const r = await (await svc()).authorizeForNode(await k.principal("A"), p.runId, body);
    expect(r.http, JSON.stringify(r)).toBe(200);
    const pA = await k.principal("A");
    const v = await verifyAsEdge(r.data!.authorization, { credentialId: pA.credentialId, runId: p.runId, claimSeq: p.claimSeq, stepId: "o1", attempt: 1, idempotencyKey: body.idempotencyKey, kind: "ot", payloadHash: body.payloadHash, reqNonce: body.reqNonce });
    expect(v.ok, JSON.stringify(v)).toBe(true);
    const claims = (v as { claims: Record<string, any> }).claims;
    expect(claims).toMatchObject({ nodeId: k.ids.nodeA, mode: "simulated", approval: { approvedBy: k.u.approver, gateStepId: "g0" }, target: { adapterId: k.ids.adapterA, writes: [{ tagKey: "speed_sp", address: "D100", dataType: "int" }] } });
    expect(r.data!.ttlMs).toBe(claims.ttlMs);
    const [pending] = await k.sql`SELECT status, "userId", "previewJson" FROM ai_pending_actions WHERE id = ${`foe-${body.idempotencyKey}`}`;
    expect(pending.status).toBe("executed");
    expect(pending.userId).toBe(k.u.approver);
    const preview = typeof pending.previewJson === "string" ? JSON.parse(pending.previewJson) : pending.previewJson;
    expect(preview.__otPayloadHash).toBe(body.payloadHash);
    expect(preview.__foeGateApproval).toMatchObject({ runId: p.runId, approvedBy: k.u.approver });
    const [row] = await k.sql`SELECT * FROM edge_step_authorizations WHERE "runId" = ${p.runId}`;
    expect(row).toMatchObject({ jti: claims.jti, edgeNodeId: k.ids.nodeA, claimSeq: p.claimSeq, stepId: "o1", attempt: 1, payloadHash: body.payloadHash, reqNonceHash: sha(body.reqNonce), kid: k.kid });
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_STEP_AUTHORIZED' AND "entityId" = ${p.runId}`)).toBe(1);
    // the claim's credential binding: a token verified under ANOTHER credential id fails on the edge
    const wrong = await verifyAsEdge(r.data!.authorization, { credentialId: pA.credentialId + 999, runId: p.runId, claimSeq: p.claimSeq, stepId: "o1", attempt: 1, idempotencyKey: body.idempotencyKey, kind: "ot", payloadHash: body.payloadHash, reqNonce: body.reqNonce });
    expect(wrong.ok).toBe(false);
  });

  it("★ idempotent nonce: the SAME nonce returns the IDENTICAL token (no second row); another nonce ⇒ 409 already_authorized", async () => {
    const s = kitSteps(k);
    const p = await prepared("idem", [s.gate, { ...s.otWrite, maxAttempts: 1 }]); // two attempts allowed (engine: maxAttempts + 1)
    const body = await otBody(p);
    const a = await (await svc()).authorizeForNode(await k.principal("A"), p.runId, body);
    const b = await (await svc()).authorizeForNode(await k.principal("A"), p.runId, body);
    expect(a.http).toBe(200);
    expect(b.http).toBe(200);
    expect(JSON.stringify(b.data)).toBe(JSON.stringify(a.data));
    expect(await count(k.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${p.runId}`)).toBe(1);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id = ${`foe-${body.idempotencyKey}`}`)).toBe(1);
    const c = await (await svc()).authorizeForNode(await k.principal("A"), p.runId, { ...body, reqNonce: nonce() });
    expect(c.code).toBe("already_authorized");
    expect(await count(k.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${p.runId}`)).toBe(1);
    // the next attempt is its own authorisation
    const d = await (await svc()).authorizeForNode(await k.principal("A"), p.runId, { ...body, reqNonce: nonce(), attempt: 2, idempotencyKey: `run${p.runId}-o1-a2` });
    expect(d.http, JSON.stringify(d)).toBe(200);
  });

  it("★ A3: node B on A's run, and a missing run, get the SAME 404 (byte-identical); nothing written", async () => {
    const s = kitSteps(k);
    const p = await prepared("scope", [s.gate, s.otWrite]);
    const body = await otBody(p);
    const other = await (await svc()).authorizeForNode(await k.principal("B"), p.runId, body);
    const missing = await (await svc()).authorizeForNode(await k.principal("B"), 2_000_000_000, body);
    expect(other.http).toBe(404);
    expect(JSON.stringify(other)).toBe(JSON.stringify(missing).replace("2000000000", String(p.runId)));
    expect(await count(k.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${p.runId}`)).toBe(0);
  });

  it("★ claim: wrong token / old claim ⇒ 409 claim_stale; central abort ⇒ 409 stopped; a held run ⇒ 409 run_not_active", async () => {
    const s = kitSteps(k);
    const p = await prepared("claim", [s.gate, s.otWrite]);
    const svcA = await svc();
    const wrongToken = await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p, { claimToken: `ect_${"A".repeat(43)}` }));
    expect(wrongToken).toMatchObject({ http: 409, code: "claim_stale", data: { abortRequested: false } });
    const futureClaim = await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p, { claimSeq: p.claimSeq + 1 }));
    expect(futureClaim.code).toBe("claim_stale");
    await k.sql`UPDATE orchestration_runs SET status = 'held' WHERE id = ${p.runId}`;
    expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p))).code).toBe("run_not_active");
    await k.sql`UPDATE orchestration_runs SET status = 'aborted' WHERE id = ${p.runId}`;
    expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p))).code).toBe("stopped");
    expect(await count(k.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${p.runId}`)).toBe(0);
  });

  it("★ definition / step: a redeploy ⇒ definition_changed; a gate step, an attempt beyond the ENGINE's budget (I-5: attempt 2 of a step without retries), a foreign idempotency key ⇒ step_invalid", async () => {
    const s = kitSteps(k);
    const p = await prepared("step", [s.gate, s.otWrite]);
    const svcA = await svc();
    expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p, { stepId: "g0", idempotencyKey: `run${p.runId}-g0-a1` }))).code).toBe("step_invalid");
    expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p, { attempt: 2, idempotencyKey: `run${p.runId}-o1-a2` }))).code).toBe("step_invalid");
    expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p, { idempotencyKey: `run${p.runId}-o1-a9` }))).code).toBe("step_invalid");
    await k.sql`UPDATE orchestration_workflows SET "definitionJson" = ${k.sql.json({ ...p.def, name: "redeployed" } as never)} WHERE id = ${p.workflowId}`;
    expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p))).code).toBe("definition_changed");
  });

  it("★ A6 payload swap: a hash that is not the definition's, or a body that is not the hash ⇒ 409 payload_mismatch + EDGE_ANOMALY; nothing authorised", async () => {
    const s = kitSteps(k);
    const p = await prepared("swap", [s.gate, s.otWrite]);
    const svcA = await svc();
    const evil = [{ tagKey: "speed_sp", value: 9999 }];
    const evilHash = await otPayloadHashOf(k.ids.adapterA, k.ids.mOtA, "write_tag", evil);
    const a = await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p, { command: { kind: "ot", adapterId: k.ids.adapterA, machineId: k.ids.mOtA, commandType: "write_tag", writes: evil }, payloadHash: evilHash }));
    expect(a.code).toBe("payload_mismatch");
    const good = await otBody(p);
    const b = await svcA.authorizeForNode(await k.principal("A"), p.runId, { ...good, command: { ...good.command, writes: evil } });
    expect(b.code).toBe("payload_mismatch");
    expect(await count(k.sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_ANOMALY' AND "entityId" = ${p.runId}`)).toBe(2);
    expect(await count(k.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${p.runId}`)).toBe(0);
  });

  it("★ L-7: a robot abort and a PINNED OT stop get 400 stop_needs_no_authorization; an UNPINNED stop-typed write is a write (authorised)", async () => {
    const s = kitSteps(k);
    const p = await prepared("stops", [s.gate, s.robotStop, s.otPinnedStop, s.otUnpinnedStop]);
    const svcA = await svc();
    const robot = await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p, "s1", "abort"));
    expect(robot).toMatchObject({ http: 400, code: "stop_needs_no_authorization" });
    const pinWrites = [{ tagKey: "stop_cmd", value: true }];
    const pinned = await svcA.authorizeForNode(
      await k.principal("A"),
      p.runId,
      await otBody(p, { stepId: "p1", idempotencyKey: `run${p.runId}-p1-a1`, command: { kind: "ot", adapterId: k.ids.adapterA, machineId: k.ids.mOtA, commandType: "stop", writes: pinWrites }, payloadHash: await otPayloadHashOf(k.ids.adapterA, k.ids.mOtA, "stop", pinWrites) }),
    );
    expect(pinned).toMatchObject({ http: 400, code: "stop_needs_no_authorization" });
    const unpinWrites = [{ tagKey: "speed_sp", value: 0 }];
    const unpinned = await svcA.authorizeForNode(
      await k.principal("A"),
      p.runId,
      await otBody(p, { stepId: "p2", idempotencyKey: `run${p.runId}-p2-a1`, command: { kind: "ot", adapterId: k.ids.adapterA, machineId: k.ids.mOtA, commandType: "stop", writes: unpinWrites }, payloadHash: await otPayloadHashOf(k.ids.adapterA, k.ids.mOtA, "stop", unpinWrites) }),
    );
    expect(unpinned.http, JSON.stringify(unpinned)).toBe(200);
  });

  it("★ gate: no gate ⇒ gate_required(noGate); approved by the run owner ⇒ approvedByOwner; a stale program reading ⇒ programUnreadable", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const none = await prepared("nogate", [s.gate, s.otWrite], null);
    expect(await svcA.authorizeForNode(await k.principal("A"), none.runId, await otBody(none))).toMatchObject({ code: "gate_required", data: { reason: "noGate" } });
    const own = await prepared("owngate", [s.gate, s.otWrite], k.u.owner);
    expect(await svcA.authorizeForNode(await k.principal("A"), own.runId, await otBody(own))).toMatchObject({ code: "gate_required", data: { reason: "approvedByOwner" } });
    const stale = await prepared("stale", [s.gate, s.otWrite]);
    const old = await svcA.authorizeForNode(await k.principal("A"), stale.runId, await otBody(stale, { programChecks: k.readings([k.ids.adapterA], Date.now() - 3_600_000) }));
    expect(old).toMatchObject({ code: "gate_required", data: { reason: "programUnreadable" } });
    // no reading at all — central never reads the controller itself (D7)
    const missing = await svcA.authorizeForNode(await k.principal("A"), stale.runId, await otBody(stale, { programChecks: [] }));
    expect(missing).toMatchObject({ code: "gate_required", data: { reason: "programUnreadable" } });
  });

  it("★ device gates: read-only tag, disabled adapter, disabled robot, the owner-change motion lock, a central lock request ⇒ device_refused {gate}", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("gates", [s.gate, s.otRo, s.otWrite, s.robotMove]);
    const roWrites = [{ tagKey: "ro_tag", value: 1 }];
    const ro = await svcA.authorizeForNode(
      await k.principal("A"),
      p.runId,
      await otBody(p, { stepId: "o2", idempotencyKey: `run${p.runId}-o2-a1`, command: { kind: "ot", adapterId: k.ids.adapterA, machineId: k.ids.mOtA, commandType: "write_tag", writes: roWrites }, payloadHash: await otPayloadHashOf(k.ids.adapterA, k.ids.mOtA, "write_tag", roWrites) }),
    );
    expect(ro).toMatchObject({ code: "device_refused", data: { gate: "tag_not_writable" } });
    await k.sql`UPDATE device_adapters SET "isEnabled" = false WHERE id = ${k.ids.adapterA}`;
    try {
      // the adapter's isEnabled is part of the binding digest the approver approved ⇒ the approval check (step 6) answers first
      expect(await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p))).toMatchObject({ code: "gate_required", data: { reason: "staleApproval" } });
    } finally {
      await k.sql`UPDATE device_adapters SET "isEnabled" = true WHERE id = ${k.ids.adapterA}`;
    }
    await k.sql`UPDATE robots SET "isEnabled" = false WHERE id = ${k.ids.robotA}`;
    try {
      expect(await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p))).toMatchObject({ code: "device_refused", data: { gate: "robot_disabled" } });
    } finally {
      await k.sql`UPDATE robots SET "isEnabled" = true WHERE id = ${k.ids.robotA}`;
    }
    // a central lock request for the robot (pending) ⇒ refused at once
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    const q = await enqueueEdgeDeviceRequest({ kind: "lock", robotId: k.ids.robotA, reason: "operator lock", requestedBy: k.u.admin });
    expect(await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p))).toMatchObject({ code: "device_refused", data: { gate: "lock_requested" } });
    // the node acknowledges it as refused ⇒ still refused (the operator wanted it locked, the node never confirmed)
    await k.sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now() WHERE id = ${q.requestId}`;
    await k.sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'refused' WHERE id = ${q.requestId}`;
    expect(await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p))).toMatchObject({ code: "device_refused", data: { gate: "lock_requested" } });
    // a done clear after it lifts the request gate
    const c = await enqueueEdgeDeviceRequest({ kind: "clear", robotId: k.ids.robotA, expectedGeneration: 1, reason: "operator clear", requestedBy: k.u.admin });
    await k.sql`UPDATE robot_motion_lock_requests SET "deliveredAt" = now() WHERE id = ${c.requestId}`;
    await k.sql`UPDATE robot_motion_lock_requests SET "ackedAt" = now(), outcome = 'done' WHERE id = ${c.requestId}`;
    const ok = await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p));
    expect(ok.http, JSON.stringify(ok)).toBe(200);
  });

  it("★ I-4 (R-10-am): a robot still owned by A but PLACED in another factory ⇒ not_owned (ownership never crosses the node's factory)", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("xfactory", [s.gate, s.robotMove]);
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const f2 = await one(k.sql`INSERT INTO factories (code, name, "isActive") VALUES (${`AF2-${k.DAU}`}, 'kit other', true) RETURNING id`);
    const w2 = await one(k.sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f2}, ${`AW2-${k.DAU}`}, 'kit ws2') RETURNING id`);
    const l2 = await one(k.sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w2}, ${`AL2-${k.DAU}`}, 'kit line2') RETURNING id`);
    const st2 = await one(k.sql`INSERT INTO stations ("lineId", code, name) VALUES (${l2}, ${`AS2-${k.DAU}`}, 'kit st2') RETURNING id`);
    const [was] = await k.sql`SELECT "stationId", "lineId" FROM robots WHERE id = ${k.ids.robotA}`;
    try {
      await k.sql`UPDATE robots SET "stationId" = ${st2}, "lineId" = ${l2} WHERE id = ${k.ids.robotA}`;
      const r = await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p));
      // the run's scope check (runVisibleTo, by the definition's devices) already hides the run ⇒ the same 404 as any
      // out-of-scope run; deviceInNodeFactory (not_owned) is the second, independent check behind it
      expect(r.code, JSON.stringify(r)).toBe("not_found");
      expect(Number((await k.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${p.runId}`)[0].n)).toBe(0);
    } finally {
      await k.sql`UPDATE robots SET "stationId" = ${was.stationId}, "lineId" = ${was.lineId} WHERE id = ${k.ids.robotA}`;
      await k.sql`DELETE FROM stations WHERE id = ${st2}`.catch(() => undefined);
      await k.sql`DELETE FROM production_lines WHERE id = ${l2}`.catch(() => undefined);
      await k.sql`DELETE FROM workshops WHERE id = ${w2}`.catch(() => undefined);
      await k.sql`DELETE FROM factories WHERE id = ${f2}`.catch(() => undefined);
    }
    // placed back in A's factory: authorised
    const back = await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p));
    expect(back.http, JSON.stringify(back)).toBe(200);
  });

  it("★ ownership: a target moved to another node ⇒ not_owned; moved back, the owner-change LOCK (any authority) ⇒ motion_locked", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("own", [s.gate, s.robotMove]);
    await k.sql`UPDATE robots SET "edgeNodeId" = ${k.ids.nodeB} WHERE id = ${k.ids.robotA}`;
    expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p))).code).toBe("not_owned");
    await k.sql`UPDATE robots SET "edgeNodeId" = ${k.ids.nodeA} WHERE id = ${k.ids.robotA}`;
    const locked = await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p));
    expect(locked).toMatchObject({ code: "device_refused", data: { gate: "motion_locked" } });
    // the node reports the confirmed STOP that clears it (guarded path) ⇒ motion may be authorised again
    const [l] = await k.sql`SELECT generation, "ownerEpoch" FROM robot_motion_locks WHERE "robotId" = ${k.ids.robotA}`;
    const { getDb } = await import("../../db/connection");
    const { clearEdgeMotionLock } = await import("./edgeControlSchema");
    expect(await clearEdgeMotionLock((await getDb()) as never, { robotId: k.ids.robotA, nodeId: k.ids.nodeA, ownerEpoch: Number(l.ownerEpoch), generation: Number(l.generation) })).toBe(1);
    const ok = await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p));
    expect(ok.http, JSON.stringify(ok)).toBe(200);
  });

  it("★ mode: central's ROBOT_CONTROL_ENABLED (commissioning not required) ⇒ mode real; off ⇒ simulated (the edge applies the stricter)", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("mode", [s.gate, { ...s.robotMove, maxAttempts: 2 }]);
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    try {
      // I-1 — central's own safety-PLC preflight: no real safety PLC configured ⇒ UNKNOWN ⇒ refused (as the robot dispatcher)
      const b3 = await robotBody(p);
      const refused = await svcA.authorizeForNode(await k.principal("A"), p.runId, { ...b3, attempt: 3, idempotencyKey: `run${p.runId}-m1-a3` });
      expect(refused).toMatchObject({ http: 409, code: "device_refused", data: { gate: "safety" } });
      process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED = "false"; // the documented off value — the other real gates still apply
      const real = await svcA.authorizeForNode(await k.principal("A"), p.runId, await robotBody(p));
      expect(real.http, JSON.stringify(real)).toBe(200);
      expect(JSON.parse(real.data!.authorization.payload)).toMatchObject({ mode: "real", kind: "robot", verdicts: { commissioned: true, interlock: "clear" } });
    } finally {
      delete process.env.ROBOT_CONTROL_ENABLED;
      delete process.env.ROBOT_COMMISSIONING_REQUIRED;
      delete process.env.ROBOT_SAFETY_PREFLIGHT_ENABLED;
    }
    const b = await robotBody(p);
    const sim = await svcA.authorizeForNode(await k.principal("A"), p.runId, { ...b, attempt: 2, idempotencyKey: `run${p.runId}-m1-a2` });
    expect(JSON.parse(sim.data!.authorization.payload).mode).toBe("simulated");
  });

  it("★ I-1 (OT): real mode — central's OT safety preflight with no real safety PLC reads UNKNOWN ⇒ device_refused {safety}; preflight off ⇒ real authorisation", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("otsafety", [s.gate, { ...s.otWrite, maxAttempts: 1 }]);
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.OT_COMMISSIONING_REQUIRED = "false";
    try {
      expect(await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p))).toMatchObject({ http: 409, code: "device_refused", data: { gate: "safety" } });
      process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
      const ok = await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p, { attempt: 2, idempotencyKey: `run${p.runId}-o1-a2` }));
      expect(ok.http, JSON.stringify(ok)).toBe(200);
      expect(JSON.parse(ok.data!.authorization.payload).mode).toBe("real");
    } finally {
      delete process.env.OT_CONTROL_ENABLED;
      delete process.env.OT_COMMISSIONING_REQUIRED;
      delete process.env.OT_SAFETY_PREFLIGHT_ENABLED;
    }
  });

  it("★ I-2: policies in EVERY mode (sim here) — the engine's foe.command.<cmd>, the robot dispatcher's robot.command.*, the OT dispatcher's ot.command.* each refuse (device_refused {policy})", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("policy", [s.gate, { ...s.robotMove, maxAttempts: 5 }, { ...s.otWrite, maxAttempts: 5 }]);
    process.env.SEC_PLATFORM = "true";
    try {
      let n = 0;
      for (const [deny, kind] of [["foe.command.*", "robot"], ["robot.command.*", "robot"], ["foe.command.*", "ot"], ["ot.command.*", "ot"]] as const) {
        n++;
        process.env.POLICY_DEFAULT_DENY_ACTIONS = deny;
        const body = kind === "robot" ? await robotBody(p) : await otBody(p);
        const step = kind === "robot" ? "m1" : "o1";
        const r = await svcA.authorizeForNode(await k.principal("A"), p.runId, { ...body, attempt: n, idempotencyKey: `run${p.runId}-${step}-a${n}` });
        expect(r, `${deny} ${kind}`).toMatchObject({ http: 409, code: "device_refused", data: { gate: "policy" } });
      }
      // control: with the deny group off the same sim attempt is authorised
      delete process.env.POLICY_DEFAULT_DENY_ACTIONS;
      const ok = await svcA.authorizeForNode(await k.principal("A"), p.runId, { ...(await robotBody(p)), attempt: 5, idempotencyKey: `run${p.runId}-m1-a5` });
      expect(ok.http, JSON.stringify(ok)).toBe(200);
    } finally {
      delete process.env.SEC_PLATFORM;
      delete process.env.POLICY_DEFAULT_DENY_ACTIONS;
    }
  });

  it("★ M-9: a console STOP of the ADAPTER not acknowledged done refuses an OT write (lock_requested); M-7: a re-claim replaces the attempt's inbox row", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("adapterstop", [s.gate, s.otWrite]);
    const first = await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p));
    expect(first.http, JSON.stringify(first)).toBe(200);
    // M-7 — release, Continue, re-claim: the same attempt under the new claim replaces the inbox row
    const c = await import("./edgeExecutionCentral");
    expect((await c.releaseForNodeV2(await k.principal("A"), p.runId, { claimSeq: p.claimSeq, claimToken: p.claimToken, seq: 1, reason: "test" })).http).toBe(200);
    await k.sql`UPDATE orchestration_runs SET status = 'queued' WHERE id = ${p.runId}`;
    const re = await c.claimForNodeV2(await k.principal("A"), p.runId, { claimSeq: p.claimSeq, defHash: p.defHash, programChecks: k.readings([k.ids.adapterA]) });
    expect(re.http, JSON.stringify(re)).toBe(200);
    const p2 = { ...p, claimSeq: re.data!.claimSeq, claimToken: re.data!.claimToken };
    const again = await svcA.authorizeForNode(await k.principal("A"), p.runId, await otBody(p2));
    expect(again.http, JSON.stringify(again)).toBe(200);
    const rows = await k.sql`SELECT "previewJson" FROM ai_pending_actions WHERE id = ${`foe-run${p.runId}-o1-a1`}`;
    expect(rows.length).toBe(1);
    const pv = typeof rows[0].previewJson === "string" ? JSON.parse(rows[0].previewJson) : rows[0].previewJson;
    expect(pv.__edge.claimSeq).toBe(p2.claimSeq);
    // M-9
    const { enqueueEdgeDeviceRequest } = await import("./edgeNodeCommands");
    await enqueueEdgeDeviceRequest({ kind: "stop", adapterId: k.ids.adapterA, reason: "console STOP", requestedBy: k.u.admin });
    const p3 = await prepared("adapterstop2", [s.gate, s.otWrite]);
    expect(await svcA.authorizeForNode(await k.principal("A"), p3.runId, await otBody(p3))).toMatchObject({ code: "device_refused", data: { gate: "lock_requested" } });
  });

  it("★ strict body (a trust / identity key ⇒ 400) and protocol v1 node ⇒ 409 protocol_version", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("strict", [s.gate, s.otWrite]);
    for (const extra of [{ trusted: true }, { nodeId: k.ids.nodeB }, { credentialId: 1 }]) {
      expect((await svcA.authorizeForNode(await k.principal("A"), p.runId, { ...(await otBody(p)), ...extra })).http).toBe(400);
    }
    expect((await svcA.authorizeForNode(await k.principal("V1"), p.runId, await otBody(p))).code).toBe("protocol_version");
  });

  // LAST in the file: it rotates node A's credential
  it("★ M-1: a replay (same nonce) is re-signed only for the SAME credential — after a credential rotation it is already_authorized", async () => {
    const s = kitSteps(k);
    const svcA = await svc();
    const p = await prepared("m1cred", [s.gate, s.robotMove]); // (adapter A has the M-9 STOP outstanding)
    const body = await robotBody(p);
    const first = await svcA.authorizeForNode(await k.principal("A"), p.runId, body);
    expect(first.http, JSON.stringify(first)).toBe(200);
    const pOld = await k.principal("A");
    const { rotateNodeCredential } = await import("./edgeNodeCredentials");
    const rot = await rotateNodeCredential({ nodeCode: `NA-${k.DAU}`, actorUserId: k.u.admin, reason: "test rotation M-1" });
    (k.tokens as { A: string }).A = rot.token;
    const pNew = await k.principal("A");
    expect(pNew.credentialId).not.toBe(pOld.credentialId);
    const replay = await svcA.authorizeForNode(pNew, p.runId, body);
    expect(replay.code).toBe("already_authorized");
  });
});
