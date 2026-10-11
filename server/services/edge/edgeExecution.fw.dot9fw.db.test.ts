/**
 * doc 81 Đợt 9 final wave — central side of F2 and F4 on the REAL `_test` DB (mig 0370), central functions called with the
 * node's own principal:
 *   F2 (final review I2) — a pull never reads the device configuration (no binding digest per queued run per pull: with an S7
 *      opt-in adapter that was a full block-info read every 5 s, forever); the digest is read ONCE, fresh, at the claim. A run
 *      no node claims within EDGE_UNCLAIMED_HOLD_MS goes to 'held' — "edge unreachable", visible — so it leaves the pull (no
 *      infinite polling); both from the node's own pull and from the central scheduler sweep (a node that never pulls).
 *      Continue re-queues it with a fresh window. A claimed run is never held by it.
 *   F4 (final review M1) — the approval / Continue of a node run is ONE transaction: there is never a committed 'running'
 *      without a claim (the old three writes could leave one behind a crash). Measured with a row lock that stalls the gate
 *      write mid-decision while another connection watches the run row.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

const h = vi.hoisted(() => ({ digestReads: 0 }));
vi.mock("../orchestration/foe/foeGateApproval", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../orchestration/foe/foeGateApproval")>();
  return {
    ...orig,
    computeBindingDigest: async (...a: Parameters<typeof orig.computeBindingDigest>) => {
      h.digestReads++; // each call = a device-configuration read (an S7 block-info read per supported controller)
      return orig.computeBindingDigest(...a);
    },
  };
});

const DB_URL = process.env.DATABASE_URL;
const DAU = `FW2-${Date.now()}`;
const ENV: Record<string, string | undefined> = { EDGE_RUNTIME_ENABLED: "true", FOE_ENABLED: "true", FOE_SIM_GATE_REQUIRED: "false", EDGE_UNCLAIMED_HOLD_MS: "5000" };
const saved: Record<string, string | undefined> = {};
const ids: Record<string, number> = {};
const u = { owner: 0, approver: 0 };
const wfIds: number[] = [];
let sql: ReturnType<typeof postgres>;
let token = "";
let token2 = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function principal(t = token) {
  const { authenticateEdgeNodeToken } = await import("./edgeNodeCredentials");
  const p = await authenticateEdgeNodeToken(t);
  if (!p) throw new Error("node credential not accepted");
  return p;
}
async function run(id: number) {
  return (await sql`SELECT status, error, "contextJson", "currentStepId" FROM orchestration_runs WHERE id = ${id}`)[0];
}
async function startFor(tag: string, nodeId = ids.node, steps?: unknown[]) {
  const ref = `${DAU}-${tag}`;
  const def = { ref, name: ref, steps: steps ?? [{ id: "w1", type: "wait_state", machineId: ids.m, targetStates: ["IDLE"], timeoutMs: 1 }] };
  const [wf] = await sql`INSERT INTO orchestration_workflows (ref, name, "definitionJson", status, "scopeKey") VALUES (${ref}, ${ref}, ${sql.json(def as never)}, 'active', 'global') RETURNING id`;
  wfIds.push(Number(wf.id));
  const { startRun } = await import("../orchestration/foe/foeEngine");
  const r = await startRun(ref, {}, { id: u.owner, role: "admin", name: "owner" }, { edgeNodeId: nodeId });
  expect(r).toMatchObject({ ok: true, status: "queued" });
  return { runId: r.runId!, def };
}
async function edgeDigest(def: unknown) {
  const { computeBindingDigest } = await import("../orchestration/foe/foeGateApproval");
  const { getDb } = await import("../../db/connection");
  return computeBindingDigest((await getDb())!, def as never);
}

describe.skipIf(!DB_URL)("Đợt 9 final wave F2 / F4 — central (real _test DB)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/); // never the dev DB
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    sql = postgres(DB_URL!, { max: 3, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    u.owner = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-o`}, ${`${DAU}-o`}, 'fw owner', 'admin', true) RETURNING id`);
    u.approver = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-a`}, ${`${DAU}-a`}, 'fw approver', 'admin', true) RETURNING id`);
    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}`}, 'fw', true) RETURNING id`);
    ids.ws = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${`W-${DAU}`}, 'fw ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.ws}, ${`L-${DAU}`}, 'fw line') RETURNING id`);
    ids.st = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${`S-${DAU}`}, 'fw st') RETURNING id`);
    ids.m = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${ids.st}, ${`M-${DAU}`}, 'fw m', 'AOI', true) RETURNING id`);
    ids.node = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`N-${DAU}`}, 'fw node', ${`F-${DAU}`}, 'online') RETURNING id`);
    ids.node2 = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${`N2-${DAU}`}, 'fw silent node', ${`F-${DAU}`}, 'offline') RETURNING id`);
    const { issueNodeCredential } = await import("./edgeNodeCredentials");
    token = (await issueNodeCredential({ nodeCode: `N-${DAU}`, actorUserId: u.owner, reason: "fw provision" })).token;
    token2 = (await issueNodeCredential({ nodeCode: `N2-${DAU}`, actorUserId: u.owner, reason: "fw provision 2" })).token;
  }, 90_000);

  afterAll(async () => {
    for (const w of wfIds) {
      for (const r of await sql`SELECT id FROM orchestration_runs WHERE "workflowId" = ${w}`) {
        await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${r.id}`;
        await sql`DELETE FROM orchestration_runs WHERE id = ${r.id}`;
      }
      await sql`DELETE FROM orchestration_workflows WHERE id = ${w}`;
    }
    for (const n of [ids.node, ids.node2].filter(Boolean)) await sql`DELETE FROM edge_nodes WHERE id = ${n}`;
    if (ids.m) await sql`DELETE FROM machines WHERE id = ${ids.m}`;
    if (ids.st) await sql`DELETE FROM stations WHERE id = ${ids.st}`;
    if (ids.line) await sql`DELETE FROM production_lines WHERE id = ${ids.line}`;
    if (ids.ws) await sql`DELETE FROM workshops WHERE id = ${ids.ws}`;
    if (ids.factory) await sql`DELETE FROM factories WHERE id = ${ids.factory}`;
    await sql`DELETE FROM users WHERE id IN ${sql([u.owner, u.approver].filter(Boolean))}`.catch(() => undefined); // audit rows may reference (WORM)
    await sql.end();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }, 90_000);

  it("★ F2: pulls never read the device configuration; the claim reads it ONCE, fresh, and refuses a digest that differs", async () => {
    const c = await import("./edgeExecutionCentral");
    const { runId, def } = await startFor("pullNoRead");
    const n = await principal();
    const mine = await edgeDigest(def);
    h.digestReads = 0;
    for (let i = 0; i < 5; i++) {
      const p = await c.pullForNode(n);
      const r = p.data!.runs.find((x) => x.runId === runId)!;
      expect(r.definition).toEqual(def);
      expect(r).not.toHaveProperty("bindingDigest");
    }
    expect(h.digestReads).toBe(0);
    const p = (await c.pullForNode(n)).data!.runs.find((x) => x.runId === runId)!;
    expect((await c.claimForNode(n, runId, { claimSeq: p.claimSeq, defHash: p.defHash, bindingDigest: "f".repeat(64) })).code).toBe("binding_changed");
    expect(h.digestReads).toBe(1);
    const ok = await c.claimForNode(n, runId, { claimSeq: p.claimSeq, defHash: p.defHash, bindingDigest: mine });
    expect(ok.http).toBe(200);
    expect(h.digestReads).toBe(2);
  });

  it("★ F2: a run left unclaimed beyond the bound goes to 'held' — edge unreachable, visible — and leaves the pull; a claimed one never does", async () => {
    const c = await import("./edgeExecutionCentral");
    const n = await principal();
    const stuck = await startFor("stuck");
    const taken = await startFor("taken");
    const p = (await c.pullForNode(n)).data!.runs.find((x) => x.runId === taken.runId)!;
    expect((await c.claimForNode(n, taken.runId, { claimSeq: p.claimSeq, defHash: p.defHash, bindingDigest: await edgeDigest(taken.def) })).http).toBe(200);
    // within the bound: still queued and pulled
    expect((await c.pullForNode(n)).data!.runs.map((x) => x.runId)).toContain(stuck.runId);
    expect((await run(stuck.runId)).status).toBe("queued");
    await sleep(5_600); // > EDGE_UNCLAIMED_HOLD_MS (5 s, the floor)
    const after = await c.pullForNode(n);
    expect(after.data!.runs.map((x) => x.runId)).not.toContain(stuck.runId);
    const row = await run(stuck.runId);
    expect(row.status).toBe("held");
    expect(row.error).toMatch(new RegExp(`Edge node N-${DAU} did not claim run ${stuck.runId} within`));
    expect(row.contextJson).toMatchObject({ edgeUnreachable: true, edgeUnreachableNode: `N-${DAU}`, interrupted: true, interruptedFrom: "queued" });
    expect((await run(taken.runId)).status).toBe("running"); // claimed: never held by the bound
    const audit = await sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'EDGE_RUN_UNCLAIMED_HELD' AND "entityId" = ${stuck.runId}`;
    expect(audit[0].n).toBe(1);

    // Continue (a person): back to 'queued' with a FRESH window — pulled again, not held again at once
    const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
    const view = await getRun(stuck.runId, { bindingDigest: true });
    const res = await resumeRun(stuck.runId, { approved: true, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, { id: u.approver, role: "admin", name: "approver" });
    expect(res).toMatchObject({ ok: true, status: "queued" });
    expect((await c.pullForNode(n)).data!.runs.map((x) => x.runId)).toContain(stuck.runId);
  }, 30_000);

  it("★ F2: a node that never pulls (down) — the central sweep holds its runs too", async () => {
    const c = await import("./edgeExecutionCentral");
    const silent = await startFor("silent", ids.node2);
    expect(await c.holdUnclaimedEdgeRuns(ids.node2)).toEqual([]);
    await sleep(5_600);
    const held = await c.holdUnclaimedEdgeRuns(); // the scheduler's call (every node)
    expect(held).toContain(silent.runId);
    expect((await run(silent.runId)).status).toBe("held");
    expect((await c.pullForNode(await principal(token2))).data!.runs.map((x) => x.runId)).not.toContain(silent.runId);
  }, 30_000);

  it("★ F4: approving a node run never leaves a committed 'running' without a claim — claim + gate row + hand-back are ONE transaction", async () => {
    const c = await import("./edgeExecutionCentral");
    const n = await principal();
    const steps = [{ id: "g1", type: "hitl_gate", prompt: "ok?" }, { id: "w1", type: "wait_state", machineId: ids.m, targetStates: ["IDLE"], timeoutMs: 1 }];
    const { runId, def } = await startFor("atomic", ids.node, steps);
    const p = (await c.pullForNode(n)).data!.runs.find((x) => x.runId === runId)!;
    const cl = await c.claimForNode(n, runId, { claimSeq: p.claimSeq, defHash: p.defHash, bindingDigest: await edgeDigest(def) });
    expect(cl.http).toBe(200);
    // the node's engine paused it at the gate (its own writes) and reported the segment end
    await sql`UPDATE orchestration_runs SET status = 'awaiting_confirm', "currentStepId" = 'g1' WHERE id = ${runId}`;
    await sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt) VALUES (${runId}, 'g1', 'hitl_gate', 'running', 0)`;
    expect((await c.completeForNode(n, runId, { claimSeq: cl.data!.claimSeq, claimToken: cl.data!.claimToken, seq: 1, status: "awaiting_confirm" })).http).toBe(200);
    const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
    const view = await getRun(runId, { bindingDigest: true });

    // stall the gate-row write: another session holds that row's lock until we let go
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const locker = sql.begin(async (tx) => {
      await tx`SELECT 1 FROM orchestration_run_steps WHERE "runId" = ${runId} AND "stepId" = 'g1' FOR UPDATE`;
      locked();
      await released;
    });
    await isLocked;
    const decision = resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, { id: u.approver, role: "admin", name: "approver" });
    const seen = new Set<string>();
    const until = Date.now() + 1500;
    while (Date.now() < until) {
      seen.add(String((await run(runId)).status));
      await sleep(50);
    }
    release();
    await locker;
    const res = await decision;
    expect([...seen]).toEqual(["awaiting_confirm"]); // never a committed 'running' (the old first write) while the decision was in flight
    expect(res).toMatchObject({ ok: true, status: "queued", edgeNodeId: ids.node });
    expect(await run(runId)).toMatchObject({ status: "queued", currentStepId: null });
    const gate = (await sql`SELECT status, "resultJson" FROM orchestration_run_steps WHERE "runId" = ${runId} AND "stepId" = 'g1'`)[0];
    expect(gate.status).toBe("completed");
    expect(gate.resultJson).toMatchObject({ approved: true, approvedBy: u.approver, approvalSource: "server", defHash: view!.defHash, bindingDigest: view!.bindingDigest });
    expect(Array.isArray(gate.resultJson.programChecks)).toBe(true);
    // the node claims the next segment
    const p2 = (await c.pullForNode(n)).data!.runs.find((x) => x.runId === runId)!;
    expect(p2.claimSeq).toBe(1);
  }, 30_000);

  it("★ F4: a decision whose gate write fails rolls back WHOLE — the run is not left 'running' unclaimed (the catch marks it failed, visibly)", async () => {
    const c = await import("./edgeExecutionCentral");
    const n = await principal();
    const steps = [{ id: "g1", type: "hitl_gate", prompt: "ok?" }, { id: "w1", type: "wait_state", machineId: ids.m, targetStates: ["IDLE"], timeoutMs: 1 }];
    const { runId, def } = await startFor("rollback", ids.node, steps);
    const p = (await c.pullForNode(n)).data!.runs.find((x) => x.runId === runId)!;
    const cl = await c.claimForNode(n, runId, { claimSeq: p.claimSeq, defHash: p.defHash, bindingDigest: await edgeDigest(def) });
    await sql`UPDATE orchestration_runs SET status = 'awaiting_confirm', "currentStepId" = 'g1' WHERE id = ${runId}`;
    expect((await c.completeForNode(n, runId, { claimSeq: cl.data!.claimSeq, claimToken: cl.data!.claimToken, seq: 1, status: "awaiting_confirm" })).http).toBe(200);
    const { getRun, resumeRun } = await import("../orchestration/foe/foeEngine");
    const view = await getRun(runId, { bindingDigest: true });
    // a NUL in the note cannot be stored in jsonb ⇒ the gate-row insert fails inside the transaction
    const res = await resumeRun(runId, { approved: true, note: "bad\u0000note", expectedStepId: "g1", expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, { id: u.approver, role: "admin", name: "approver" });
    expect(res.ok).toBe(false);
    const row = await run(runId);
    expect(row.status).not.toBe("running");
    expect(row.status).not.toBe("queued"); // the hand-back rolled back with the gate row
    expect((await sql`SELECT count(*)::int AS n FROM orchestration_run_steps WHERE "runId" = ${runId} AND "stepId" = 'g1' AND status = 'completed'`)[0].n).toBe(0);
  }, 30_000);
});
