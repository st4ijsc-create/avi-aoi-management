/**
 * doc 81 Đợt 9 task S3 — the EDGE walker of the central run: ID mapping, the same gates as central, a central abort reaching a
 * walking run, the signal during a wait, a revoked credential, the L-7 STOP re-send, a stale claim.
 *
 * ★ ADAPTED TO THE v2 FLOW 2026-10-13 (doc 81 Đợt 10 task F1, ruling R-10-bi). The Đợt 9 version drove
 *   foeEngine.driveEdgeClaimedRun (removed by Đợt 10 C) IN THIS PROCESS against the central DB, with a run guard reading the DB.
 *   v2 has no such walker: the edge walks a SIGNED run package (driveEdgeRunFromPackage) with no DB, every non-STOP step asks
 *   central's /authorize, and the device front ends exist only in an edge-role process. So each proof is restated for v2 and
 *   measured either in-process where no device is involved (the package / claim refusals) or through the two-process harness
 *   (__edgeE2eHarness.dot10: central here, edgeGatewayMain in a spawned no-DB process):
 *     1 ID mapping              — central refuses a wrong claim seq / a redeployed definition; an inactive owner is signed as
 *                                  `owner: null` and the walker refuses that package (v2: the check moved to the package); the walker
 *                                  refuses a package that is not for its claim or whose definition is not the signed hash; the
 *                                  edge's verifier refuses a package of another run / node — nothing walked, nothing written;
 *     2 same gates              — an un-approved gate pauses (no authorisation, no motion); /authorize before approval ⇒
 *                                  gate_required; after a central approval by ANOTHER person the next segment actuates;
 *     3 abort, no run guard     — v2 has no run guard: with every progress / pull answer of the run LOST (the network drops the
 *                                  abort flag), the walker still learns the abort from /authorize (409 stopped) — the next
 *                                  non-STOP step is never sent, the STOP is sent, the run stays aborted;
 *     4 the signal during a wait— a progress answer with abortRequested wakes the walker from a 20 s wait at once;
 *     5 L-7 re-send             — a run that is NOT aborted (paused / failed) is never touched; aborted while paused after
 *                                  actuating ⇒ the edge re-sends the STOP (its central confirmation: BUG F1-4, s4 suite);
 *     6 stale claim             — re-claimed elsewhere ⇒ /authorize answers claim_stale, the walker lets go: no non-STOP step,
 *                                  no run-level write;
 *     7 revoked credential      — v2 (D5): the next non-STOP step cannot be authorised (401) ⇒ never sent; a STOP never asks and
 *                                  is sent.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.hoisted(() => {
  if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "f1-dot9-s3-v2-session-secret-0123456789abcdef";
});

import { createHash, randomBytes } from "node:crypto";
import { setupCentral, waitFor, sleep, type Central, type EdgeProc, type CentralTestHooks } from "./__edgeE2eHarness.dot10";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let c: Central;
let edge: EdgeProc;

const motions = () => (edge.counts()?.motions ?? []).filter((m) => m.robotId === c.ids.robotA).length;
const stops = () => (edge.counts()?.stops ?? []).filter((m) => m.robotId === c.ids.robotA).length;
const n = async (q: Promise<Array<{ n: number }>>) => Number((await q)[0].n);

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

describe.skipIf(!onTest)("doc 81 Đợt 9 S3 (v2) — the edge walker of the central run (signed package, per-step authorize, no DB on the edge)", () => {
  beforeAll(async () => {
    c = await setupCentral("S3V2", { hooks });
    edge = await c.spawnEdge("s3");
    await c.clearEdgeLock(c.ids.robotA, edge);
  }, 300_000);
  afterAll(async () => {
    c?.front.tamper.clear();
    await c?.teardown();
  }, 240_000);

  it("★ ID mapping: a wrong claim seq / a redeploy ⇒ the claim is refused; an inactive owner ⇒ a package with no owner the walker refuses; a package not for the claim / not the signed definition / of another run ⇒ refused; nothing walked, nothing written", async () => {
    const s = c.steps;
    const tokenB = c.tokens.B; // node B has no honest process: this test drives its claims by hand
    const id = await c.startRun("idmap", [s.gate(), s.move("m1", c.ids.robotB)], "B");
    const pull = await c.post("/edge/node/pull", {}, tokenB);
    const p = pull.json.data.runs.find((r: { runId: number }) => r.runId === id);
    const claim = (body: Record<string, unknown>) => c.post(`/edge/node/runs/${id}/claim`, { claimSeq: p.claimSeq, defHash: p.defHash, programChecks: [], ...body }, tokenB);
    expect((await claim({ claimSeq: p.claimSeq + 1 })).status).toBe(409);
    expect((await claim({ defHash: "0".repeat(64) })).status).toBe(409);
    expect((await c.assignment(id)).claimSeq).toBe(0);
    // a REDEPLOY after the assignment: the pull marks it, the claim is refused (the snapshot is pinned)
    const wfRef = `${c.DAU}-idmap`;
    const [orig] = await c.sql`SELECT "definitionJson"::text AS d FROM orchestration_workflows WHERE ref = ${wfRef}`;
    await c.sql`UPDATE orchestration_workflows SET "definitionJson" = jsonb_set("definitionJson"::jsonb, '{name}', '"redeployed"')::json WHERE ref = ${wfRef}`;
    const pulled2 = (await c.post("/edge/node/pull", {}, tokenB)).json.data.runs.find((r: { runId: number }) => r.runId === id);
    expect(pulled2.refused).toBe("definitionChanged");
    expect((await claim({})).status).toBe(409);
    expect(await n(c.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${id}`)).toBe(0);
    await c.sql`UPDATE orchestration_workflows SET "definitionJson" = ${orig.d}::json WHERE ref = ${wfRef}`;
    // the claim that IS accepted: its signed package, verified by the EDGE's trust path (pin from the provisioning CLI)
    const ok = await claim({});
    expect(ok.status, ok.text).toBe(200);
    const env = ok.json.data.package;
    const { EdgeTrustStore } = await import("./edgeSigning");
    const { verifyEdgeRunPackage } = await import("./edgeTrust");
    const store = EdgeTrustStore.fromPinFile(c.pinFile, { nodeId: c.ids.nodeB });
    const v = verifyEdgeRunPackage(store, env, { credentialId: c.credentialIds.B, runId: id, claimSeq: ok.json.data.claimSeq });
    expect(v.ok).toBe(true);
    expect(verifyEdgeRunPackage(store, env, { credentialId: c.credentialIds.B, runId: id + 1, claimSeq: ok.json.data.claimSeq }).ok).toBe(false); // another run
    expect(verifyEdgeRunPackage(store, env, { credentialId: c.credentialIds.B, runId: id, claimSeq: ok.json.data.claimSeq + 1 }).ok).toBe(false); // another claim
    expect(verifyEdgeRunPackage(EdgeTrustStore.fromPinFile(c.pinFile, { nodeId: c.ids.nodeA }), env, { credentialId: c.credentialIds.A, runId: id, claimSeq: ok.json.data.claimSeq }).ok).toBe(false); // another node
    // the walker (driveEdgeRunFromPackage) on the verified package: a different claim / a definition that is not the signed hash
    const pkg = (v as { pkg: any }).pkg;
    const calls: string[] = [];
    const { createEdgeRunStore } = await import("./edgeRunStore");
    const io = {
      runId: id,
      claimSeq: pkg.claimSeq,
      claimToken: ok.json.data.claimToken,
      sink: { run: async () => (calls.push("record"), { seq: 1, durable: true }), event: async () => (calls.push("event"), { seq: 1, durable: true }) },
      authorize: { authorize: async () => (calls.push("authorize"), { ok: false as const, verdict: "unavailable" as const }) },
    };
    const { driveEdgeRunFromPackage } = await import("../orchestration/foe/foeEngine");
    expect((await driveEdgeRunFromPackage(pkg, { runId: id, claimSeq: pkg.claimSeq + 1 }, createEdgeRunStore(pkg, io as never))).refused).toMatch(/claim/);
    expect((await driveEdgeRunFromPackage({ ...pkg, definition: { ...pkg.definition, name: "tampered" } }, { runId: id, claimSeq: pkg.claimSeq }, createEdgeRunStore(pkg, io as never))).refused).toMatch(/snapshot/);
    expect(() => createEdgeRunStore(pkg, { ...io, runId: id + 1 } as never)).toThrow();
    expect(calls).toEqual([]); // nothing walked, nothing reported
    expect(await n(c.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${id}`)).toBe(0);
    await c.abort(id);
    // an INACTIVE owner: v2 signs the package with owner = null (central validates the owner) and the walker refuses it
    const id2 = await c.startRun("idmapOwner", [s.gate(), s.move("m1", c.ids.robotB)], "B");
    const p2 = (await c.post("/edge/node/pull", {}, tokenB)).json.data.runs.find((r: { runId: number }) => r.runId === id2);
    await c.sql`UPDATE users SET "isActive" = false WHERE id = ${c.u.owner}`;
    let cl2: any;
    try {
      cl2 = await c.post(`/edge/node/runs/${id2}/claim`, { claimSeq: p2.claimSeq, defHash: p2.defHash, programChecks: [] }, tokenB);
    } finally {
      await c.sql`UPDATE users SET "isActive" = true WHERE id = ${c.u.owner}`;
    }
    expect(cl2.status, cl2.text).toBe(200);
    const v2 = verifyEdgeRunPackage(store, cl2.json.data.package, { credentialId: c.credentialIds.B, runId: id2, claimSeq: cl2.json.data.claimSeq });
    const pkg2 = (v2 as { pkg: any }).pkg;
    expect(pkg2.owner).toBeNull();
    const io2 = { ...io, runId: id2, claimSeq: pkg2.claimSeq, claimToken: cl2.json.data.claimToken };
    expect((await driveEdgeRunFromPackage(pkg2, { runId: id2, claimSeq: pkg2.claimSeq }, createEdgeRunStore(pkg2, io2 as never))).refused).toMatch(/owner/);
    expect(calls).toEqual([]);
    expect(await n(c.sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${id2}`)).toBe(0);
    await c.abort(id2);
  }, 120_000);

  it("★ same gates as central: an un-approved gate pauses (no authorisation, no motion; /authorize ⇒ gate_required); after a central approval by ANOTHER person the next segment actuates", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("gate", [s.gate(), s.move("m1"), s.stop("s1")]);
    await waitFor("paused at the gate on the edge", async () => (await c.run(id)).status === "awaiting_confirm" && (await c.assignment(id)).claimTokenHash === null, 30_000);
    await sleep(500);
    expect(motions()).toBe(m0);
    expect(await n(c.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${id}`)).toBe(0);
    // a node asking for the motion BEFORE the approval (B on its own run): central refuses — the gate is central's
    const bRun = await c.startRun("gateB", [s.gate(), s.move("m1", c.ids.robotB)], "B");
    const pulled = (await c.post("/edge/node/pull", {}, c.tokens.B)).json.data.runs.find((r: { runId: number }) => r.runId === bRun);
    const cl = await c.post(`/edge/node/runs/${bRun}/claim`, { claimSeq: pulled.claimSeq, defHash: pulled.defHash, programChecks: [] }, c.tokens.B);
    const { robotPayloadHash } = await import("../ot/otActionBinding");
    const early = await c.post(
      `/edge/node/runs/${bRun}/authorize`,
      { claimSeq: cl.json.data.claimSeq, claimToken: cl.json.data.claimToken, stepId: "m1", attempt: 1, idempotencyKey: `run${bRun}-m1-a1`, reqNonce: randomBytes(18).toString("base64url"), command: { kind: "robot", robotId: c.ids.robotB, jobType: "custom", params: {} }, payloadHash: robotPayloadHash({ robotId: c.ids.robotB, jobType: "custom", params: {} } as never), programChecks: [] },
      c.tokens.B,
    );
    expect(early.status, early.text).toBe(409);
    expect(early.json.error.code).toBe("gate_required");
    await c.abort(bRun);
    // approved by another person (not the run owner) ⇒ the next segment actuates
    await c.approveAtGate(id);
    await waitFor("completed", async () => (await c.run(id)).status === "completed", 60_000);
    expect([motions() - m0, stops() - s0]).toEqual([1, 1]);
    const g0 = (await c.stepRows(id)).find((r) => r.stepId === "g0")!;
    expect(g0.resultJson.approvedBy).toBe(c.u.approver);
    expect(g0.resultJson.approvedBy).not.toBe(c.u.owner);
  }, 120_000);

  it("★ central abort mid-run with the abort flag LOST on every progress / pull answer: the walker learns it from /authorize (409 stopped) — the next non-STOP step is never sent, the STOP is sent, the run stays aborted", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("abortAuth", [s.gate(), s.move("m1"), s.delay("d1", 1500), s.move("m2"), s.stop("s1")]);
    let hidden = 0;
    const hide = (answer: any) => {
      if (answer?.ok !== true) return undefined;
      const d = answer.data;
      if (d.abortRequested === true) {
        hidden++;
        return { ...answer, data: { ...d, abortRequested: false, status: "running" } };
      }
      if (Array.isArray(d.claims) && d.claims.some((x: { runId: number; abortRequested: boolean }) => x.runId === id && x.abortRequested)) {
        hidden++;
        return { ...answer, data: { ...d, claims: d.claims.map((x: any) => (x.runId === id ? { ...x, abortRequested: false, status: "running" } : x)), stopsUnconfirmed: d.stopsUnconfirmed.filter((u: { runId: number }) => u.runId !== id) } };
      }
      return undefined;
    };
    c.front.tamper.set(`^/runs/${id}/progress$`, hide);
    c.front.tamper.set("^/pull$", hide);
    try {
      await c.approveAtGate(id);
      await edge.waitCounts("m1 sent", () => motions() === m0 + 1);
      await c.abort(id);
      await edge.waitCounts("the STOP sent by the edge's local sweep", () => stops() >= s0 + 1, 15_000);
      const authAnswers = c.front.captured.filter((x) => x.path === `/runs/${id}/authorize`).map((x) => [x.body.stepId, x.status, x.answer?.error?.code ?? "ok"]);
      expect(authAnswers).toEqual([
        ["m1", 200, "ok"],
        ["m2", 409, "stopped"],
      ]);
    } finally {
      c.front.tamper.clear();
    }
    expect(motions()).toBe(m0 + 1); // m2 NEVER sent
    expect((await c.run(id)).status).toBe("aborted");
    expect((await c.stepRows(id)).find((r) => r.stepId === "m2")?.status).not.toBe("completed");
  }, 120_000);

  it("★ central abort learned from the SIGNAL during a wait (progress abortRequested): the walker wakes at once, no further non-STOP step, the STOP is sent", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("abortSignal", [s.gate(), s.move("m1"), s.delay("d1", 20_000), s.move("m2"), s.stop("s1")]);
    await c.approveAtGate(id);
    await edge.waitCounts("m1 sent", () => motions() === m0 + 1);
    const t0 = Date.now();
    await c.abort(id);
    await edge.waitCounts("the STOP sent", () => stops() >= s0 + 1, 15_000);
    expect(Date.now() - t0).toBeLessThan(10_000); // the 20 s delay was cut short
    await waitFor("segment end reported", async () => (await c.assignment(id)).claimTokenHash === null, 15_000);
    expect(motions()).toBe(m0 + 1);
    expect((await c.run(id)).status).toBe("aborted");
  }, 120_000);

  it("★ L-7: a run that is NOT aborted (paused, or failed) is never touched; aborted while PAUSED after actuating ⇒ the edge re-sends the STOP central could not send", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("resend", [s.gate(), s.move("m1"), s.gate("g1"), s.stop("s1")]);
    await c.approveAtGate(id);
    await waitFor("m1 sent, paused at g1", async () => (await c.run(id)).status === "awaiting_confirm" && motions() === m0 + 1 && (await c.assignment(id)).claimTokenHash === null, 30_000);
    await sleep(1_500); // paused: no STOP re-sent, no sweep picture for it
    expect(stops()).toBe(s0);
    expect(c.front.captured.some((x) => x.path === "/pull" && x.answer?.data?.stopsUnconfirmed?.some((u: { runId: number }) => u.runId === id))).toBe(false);
    await c.sql`UPDATE orchestration_runs SET status = 'failed', "finishedAt" = now() WHERE id = ${id}`;
    await sleep(1_500); // failed (not aborted): still never touched
    expect(stops()).toBe(s0);
    await c.sql`UPDATE orchestration_runs SET status = 'awaiting_confirm', "finishedAt" = NULL WHERE id = ${id}`;
    await c.abort(id);
    await edge.waitCounts("the STOP re-sent by the edge", () => stops() >= s0 + 1, 20_000);
    expect(motions()).toBe(m0 + 1);
    expect((await c.run(id)).status).toBe("aborted");
  }, 120_000);

  it("★ stale claim (re-claimed elsewhere): /authorize answers claim_stale and the walker lets go — no non-STOP step, NO run-level write", async () => {
    const s = c.steps;
    const m0 = motions();
    const id = await c.startRun("stale", [s.gate(), s.move("m1"), s.delay("d1", 1500), s.move("m2")]);
    await c.approveAtGate(id);
    await edge.waitCounts("m1 sent", () => motions() === m0 + 1);
    // another segment took the run (as a release + Continue + claim would): new seq + token, and its marker on the run row
    await c.sql`UPDATE orchestration_run_edge_assignments SET "claimSeq" = "claimSeq" + 1, "claimTokenHash" = ${createHash("sha256").update("ect_someone_else").digest("hex")}, "progressSeq" = 0 WHERE "runId" = ${id}`;
    await c.sql`UPDATE orchestration_runs SET "currentStepId" = 'marker-of-the-new-owner' WHERE id = ${id}`;
    await waitFor("m2's authorize answered claim_stale (or the claim went stale on progress)", () => c.front.captured.some((x) => x.path.startsWith(`/runs/${id}/`) && x.answer?.error?.code === "claim_stale"), 15_000);
    await sleep(2_000);
    expect(motions()).toBe(m0 + 1);
    expect(await c.run(id)).toMatchObject({ status: "running", currentStepId: "marker-of-the-new-owner" }); // untouched by the old walker
    await c.abort(id);
  }, 120_000);

  it("★ revoked node credential: the next NON-STOP step cannot be authorised (never sent, D5); a STOP never asks and is sent", async () => {
    const s = c.steps;
    const m0 = motions();
    const s0 = stops();
    const id = await c.startRun("revoked", [s.gate(), s.move("m1"), s.delay("d1", 1500), s.stop("s1"), s.move("m2")]);
    await c.approveAtGate(id);
    await edge.waitCounts("m1 sent", () => motions() === m0 + 1);
    const err: string[] = [];
    const { runEdgeCredentialCli } = await import("../../../scripts/edge-node-credential");
    const code = await runEdgeCredentialCli(["revoke", "--node", c.codes.nodeA, "--actor", c.adminLogin.username, "--reason", "S3 v2: revoke mid-run"], {
      out: () => undefined,
      err: (l) => err.push(l),
      env: {},
      promptSecret: async (label) => (/password/i.test(label) ? c.adminLogin.password : null),
    });
    expect(code, err.join(" | ")).toBe(0);
    await edge.waitCounts("s1 (a STOP) sent although the credential is revoked", () => stops() >= s0 + 1, 15_000);
    await sleep(4_000);
    expect(motions()).toBe(m0 + 1); // m2 never sent
    expect((await c.sql`SELECT "stepId" FROM edge_step_authorizations WHERE "runId" = ${id} ORDER BY 1`).map((r) => r.stepId)).toEqual(["m1"]);
    expect(c.front.captured.filter((x) => x.path === `/runs/${id}/authorize` && x.status === 401).length).toBeGreaterThan(0);
  }, 120_000);
});
