/**
 * Đĩa edge treo (a2n) round C — the held cycle on real rows (real `_test` DB, every write inside a transaction that is ROLLED BACK; no explicit ids in WORM tables; no DELETE /
 * TRUNCATE; the app role only). What robotEdgeDiskStall.a2n.test runs over FakeDb, here with the SQL that FakeDb does not model and the real /authorize it cannot run:
 *   (1) held(journalFull) by a consume past its bound, m2 `failed`: the real complete takes it, the run's text warns; Continue queues it with no outcome-unknown step; a new claim;
 *       the real /authorize issues m2 again on that claim, one inbox row stays, the old claim is refused;
 *   (2) MIX: central's own Abort sweep on real rows sends s1 and never the compensation that went on its own; the run is held until then, aborted after;
 *   (3) MIX Continue instead of Abort: the resume state says doneFailed, nothing re-authorises s1's way past m2;
 *   (4) B5: the authorisation never superseded: Continue carries outcomeUnknown; the text says Abort.
 * The edge is not in this file: its half is the FakeDb suite. The body of a segment is written with the real recordEdgeStepRows, as the report route writes it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 90_000 });

const H = vi.hoisted(() => ({ tx: null as unknown }));

vi.mock("../../db/connection", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../db/connection")>();
  // getReadDb too: the node's factory scope resolves through it (reportAggregators), and a separate connection does not see this transaction's rows
  const trongTx = (async () => (H.tx ? H.tx : null)) as typeof real.getDb;
  return { ...real, getDb: trongTx, getReadDb: trongTx as unknown as typeof real.getReadDb, getJobsDb: trongTx as unknown as typeof real.getJobsDb, __realGetDb: real.getDb };
});

import * as conn from "../../db/connection";
import { orchestrationRuns, orchestrationWorkflows } from "../../../drizzle/schema";
import { abortRun, recordEdgeStepRows, resumeRun } from "../orchestration/foe/foeEngine";
import { RESUME_STATE_CTX_KEY } from "../orchestration/foe/foeRunStore";
import { computeBindingDetail, hashWorkflowDefinition } from "../orchestration/foe/foeGateApproval";
import { robotPayloadHash } from "../ot/otActionBinding";
import { KIT_ENV, nonce } from "./__edgeCentralKit.dot10";
import { authorizeForNode, edgeProgramPreFor } from "./edgeAuthorizeCentral";
import { claimForNodeV2, completeForNodeV2, docRunAbortCanGuiLaiStop } from "./edgeExecutionCentral";
import { runEdgeAssignments } from "./edgeExecutionSchema";
import { authenticateEdgeNodeToken, issueNodeCredential, type EdgeNodePrincipal } from "./edgeNodeCredentials";
import { EDGE_HOLD_CONSUME_OVERRUN, EDGE_HOLD_UNUSED_NOT_REPORTED } from "./edgeProgramReportRule";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const DAU = `A2NC-${Date.now()}`;
const ROLLBACK = Symbol("rollback");
const realGetDb = (conn as unknown as { __realGetDb: typeof conn.getDb }).__realGetDb;
type Tx = NonNullable<Awaited<ReturnType<typeof conn.getDb>>>;
const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
const HE_THONG = { id: 0, role: "system", name: "a2n" } as never;
const moiDuy = () => randomBytes(4).toString("hex");

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = await realGetDb();
  if (!db) throw new Error("no db");
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      try {
        await fn(tx as unknown as Tx);
      } finally {
        H.tx = null;
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

interface The {
  node: EdgeNodePrincipal;
  robotId: number;
  mRobot: number;
  nguoi: { owner: number; approver: number; admin: number };
}

/** a factory, a v2 node owning one robot, three users: the kit's rows, in this transaction */
async function dungThe(tx: Tx): Promise<The> {
  const t = `${DAU}-${moiDuy()}`;
  const one = async (q: ReturnType<typeof sql>) => Number(rowsOf(await tx.execute(q))[0]!.id);
  const nguoi = { owner: 0, approver: 0, admin: 0 };
  for (const k of Object.keys(nguoi) as Array<keyof typeof nguoi>) nguoi[k] = await one(sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${t}-${k}`}, ${`${t}-${k}`}, ${`a2n ${k}`}, 'admin', true) RETURNING id`);
  const factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${t}`}, 'a2n', true) RETURNING id`);
  const ws = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${factory}, ${`W-${t}`}, 'a2n ws') RETURNING id`);
  const line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ws}, ${`L-${t}`}, 'a2n line') RETURNING id`);
  const st = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`S-${t}`}, 'a2n st') RETURNING id`);
  const mRobot = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${st}, ${`MR-${t}`}, 'a2n robot cell', 'ROBOT', true) RETURNING id`);
  const nodeCode = `N-${t}`;
  const nodeId = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode", status) VALUES (${nodeCode}, 'a2n node', ${`F-${t}`}, 'online') RETURNING id`);
  await tx.execute(sql`UPDATE edge_nodes SET "protocolVersion" = 2 WHERE id = ${nodeId}`);
  const robotId = await one(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "edgeNodeId") VALUES (${`R-${t}`}, 'a2n robot', 'fanuc', 'tcp://127.0.0.1:9', true, ${line}, ${st}, ${nodeId}) RETURNING id`);
  const { token } = await issueNodeCredential({ nodeCode, actorUserId: nguoi.admin, reason: "a2n round C" });
  const node = await authenticateEdgeNodeToken(token);
  if (!node) throw new Error("the node's credential was not accepted");
  return { node, robotId, mRobot, nguoi };
}

const chay = (the: The, id: string, compensation?: unknown) => ({ id, type: "command", machineId: the.mRobot, command: "start", args: { robotId: the.robotId }, ...(compensation ? { compensation } : {}) });
const dung = (the: The, id: string) => ({ id, type: "command", machineId: the.mRobot, command: "abort", args: { robotId: the.robotId } });
const CONG = { id: "g0", type: "hitl_gate", prompt: "go?" };

/** a queued run of the node, its gate approved by someone else, claimed: the real claim */
async function moRun(tx: Tx, the: The, steps: unknown[]) {
  const ref = `${DAU}-${moiDuy()}`;
  const def = { ref, name: ref, steps: [CONG, ...steps] };
  const defHash = hashWorkflowDefinition(def as never);
  const [wf] = await tx.insert(orchestrationWorkflows).values({ ref, name: ref, definitionJson: def, status: "active", scopeKey: "global", version: 1 } as never).returning({ id: orchestrationWorkflows.id });
  const [run] = await tx.insert(orchestrationRuns).values({ workflowId: wf!.id, workflowRef: ref, status: "queued", paramsJson: {}, contextJson: {}, startedBy: the.nguoi.owner } as never).returning({ id: orchestrationRuns.id });
  const runId = run!.id;
  await tx.insert(runEdgeAssignments).values({ runId, edgeNodeId: the.node.nodeId, workflowId: wf!.id, workflowVersion: 1, defHash, assignedBy: the.nguoi.owner });
  const c = await claimForNodeV2(the.node, runId, { claimSeq: 0, defHash, programChecks: [] });
  expect(c.http, JSON.stringify(c)).toBe(200);
  const detail = await computeBindingDetail(tx as never, def as never, await edgeProgramPreFor(tx as never, the.node, [] as never));
  await tx.execute(sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson", "finishedAt") VALUES (${runId}, 'g0', 'hitl_gate', 'completed', 0, ${JSON.stringify({ approved: true, approvedBy: the.nguoi.approver, approvalSource: "server", defHash, bindingDigest: detail.digest })}::jsonb, now())`);
  return { runId, def, defHash, claimSeq: c.data!.claimSeq, claimToken: c.data!.claimToken };
}

function thanUyQuyen(the: The, r: { runId: number; claimSeq: number; claimToken: string }, stepId: string) {
  return {
    claimSeq: r.claimSeq,
    claimToken: r.claimToken,
    stepId,
    attempt: 1,
    idempotencyKey: `run${r.runId}-${stepId}-a1`,
    reqNonce: nonce(),
    command: { kind: "robot", robotId: the.robotId, jobType: "custom", params: {} },
    payloadHash: robotPayloadHash({ robotId: the.robotId, jobType: "custom", params: {} }),
    programChecks: [],
  };
}

const hang = (stepId: string, status: string, stepType = "command") => ({ stepId, stepType, status, attempt: 1, startedAt: null, finishedAt: null, error: null, result: undefined });
const ketHeld = (r: { claimSeq: number; claimToken: string }, heldReason: string, error: string) => ({ claimSeq: r.claimSeq, claimToken: r.claimToken, seq: 1, outcome: "held", heldReason, error, epoch: "e".repeat(32), reportedThrough: 0 });
const LOI_C = `EDGE_HELD(journalFull): ${EDGE_HOLD_CONSUME_OVERRUN}: a step's authorisation could not be recorded in time on the edge's disk (JOURNAL_CONSUME_FAILED); that step was not sent.`;

async function hangRun(tx: Tx, runId: number) {
  return rowsOf(await tx.execute(sql`SELECT status, error, "contextJson" FROM orchestration_runs WHERE id = ${runId}`))[0]!;
}

describe.skipIf(!onTest)("a2n round C — the held cycle (real _test DB, ROLLBACK)", () => {
  const saved: Record<string, string | undefined> = {};
  let keyDir = "";

  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of [...Object.keys(KIT_ENV), "EDGE_SIGNING_KEY_FILE", "EDGE_SIGNING_KEY_DIR", "SECRET_ENCRYPTION_KEY"]) saved[k] = process.env[k];
    for (const [k, v] of Object.entries(KIT_ENV)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (!process.env.SECRET_ENCRYPTION_KEY && !process.env.JWT_SECRET) process.env.SECRET_ENCRYPTION_KEY = `a2n-${randomBytes(16).toString("hex")}`;
    const sg = await import("./edgeSigning");
    keyDir = mkdtempSync(path.join(os.tmpdir(), "edge-a2n-c-"));
    const { key, privateKeyPem } = sg.generateEdgeSigningKey();
    const keyFile = path.join(keyDir, `${key.kid}.pem`);
    writeFileSync(keyFile, privateKeyPem, { mode: 0o600 });
    const now = Date.now();
    writeFileSync(path.join(keyDir, sg.EDGE_KEYRING_FILE), JSON.stringify({ v: 1, version: 1, updatedAt: now, keys: [{ kid: key.kid, publicKeyPem: key.publicKeyPem, status: "active", notBefore: now - 60_000, retiredAt: null, root: true }] }), { mode: 0o600 });
    process.env.EDGE_SIGNING_KEY_FILE = keyFile;
    process.env.EDGE_SIGNING_KEY_DIR = keyDir;
    sg.__resetCentralEdgeSigningKeyForTests();
    (await import("./edgeCentralCommon")).__resetCentralSignerCacheForTests();
    (await import("./edgeConfigCentral")).__resetEdgeConfigCacheForTests();
    (await import("./edgeExecutionCentral")).__resetClaimRateForTests();
  }, 60_000);

  afterAll(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    (await import("./edgeSigning")).__resetCentralEdgeSigningKeyForTests();
    (await import("./edgeCentralCommon")).__resetCentralSignerCacheForTests();
    if (keyDir) rmSync(keyDir, { recursive: true, force: true });
  });

  it("★ (1) held by a consume past its bound: complete takes it with m2 failed, the text warns; Continue carries nothing unknown; a new claim; /authorize issues m2 on it", async () => {
    await trongGiaoDich(async (tx) => {
      const the = await dungThe(tx);
      const r = await moRun(tx, the, [chay(the, "m1"), chay(the, "m2"), dung(the, "s1")]);
      for (const id of ["m1", "m2"]) {
        const a = await authorizeForNode(the.node, r.runId, thanUyQuyen(the, r, id));
        expect(a.http, JSON.stringify(a)).toBe(200);
      }
      await recordEdgeStepRows(tx as never, r.runId, [hang("m1", "completed"), hang("m2", "failed")] as never);
      const ket = await completeForNodeV2(the.node, r.runId, ketHeld(r, "journalFull", LOI_C));
      expect(ket.http, JSON.stringify(ket)).toBe(200);
      const held = await hangRun(tx, r.runId);
      expect(held.status).toBe("held");
      expect(String(held.error)).toContain("A compensation may already have run.");
      expect(String(held.error)).toContain("Continue may end the run without sending it.");
      expect(String(held.error)).not.toContain("nothing further was sent");

      const tt = await resumeRun(r.runId, { approved: true } as never, HE_THONG);
      expect(tt, JSON.stringify(tt)).toMatchObject({ ok: true, status: "queued" });
      expect(((await hangRun(tx, r.runId)).contextJson as Record<string, unknown>)[RESUME_STATE_CTX_KEY]).toBeUndefined();

      const c2 = await claimForNodeV2(the.node, r.runId, { claimSeq: r.claimSeq, defHash: r.defHash, programChecks: [] });
      expect(c2.http, JSON.stringify(c2)).toBe(200);
      expect(c2.data!.claimSeq).toBeGreaterThan(r.claimSeq);
      const r2 = { runId: r.runId, claimSeq: c2.data!.claimSeq, claimToken: c2.data!.claimToken };
      expect((await authorizeForNode(the.node, r.runId, thanUyQuyen(the, r, "m2"))).code).toBe("claim_stale");
      const lai = await authorizeForNode(the.node, r.runId, thanUyQuyen(the, r2, "m2"));
      expect(lai.http, JSON.stringify(lai)).toBe(200);
      const uq = rowsOf(await tx.execute(sql`SELECT "claimSeq" FROM edge_step_authorizations WHERE "runId" = ${r.runId} AND "stepId" = 'm2' ORDER BY "claimSeq"`));
      expect(uq.map((u) => Number(u.claimSeq))).toEqual([r.claimSeq, r2.claimSeq]);
      const hop = rowsOf(await tx.execute(sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id = ${`foe-run${r.runId}-m2-a1`}`));
      expect(Number(hop[0]!.n)).toBe(1); // M-7: the row of the earlier claim was replaced
    });
  });

  it("★ (2) MIX, Abort: central's own sweep on real rows tries s1, never the compensation that went on its own; the run is aborted and listed for the node's re-send when it could not reach s1", async () => {
    await trongGiaoDich(async (tx) => {
      const the = await dungThe(tx);
      const r = await moRun(tx, the, [chay(the, "m1"), chay(the, "m2", dung(the, "c1")), dung(the, "s1")]);
      for (const id of ["m1", "m2"]) expect((await authorizeForNode(the.node, r.runId, thanUyQuyen(the, r, id))).http).toBe(200);
      await recordEdgeStepRows(tx as never, r.runId, [hang("m1", "completed"), hang("m2", "failed"), hang("c1", "compensated")] as never);
      expect((await completeForNodeV2(the.node, r.runId, ketHeld(r, "journalFull", LOI_C))).http).toBe(200);
      const a = (await abortRun(r.runId, HE_THONG, "a2n")) as unknown as { ok: boolean; abortStops?: { sent: string[]; failed: string[]; pending: string[] } };
      expect(a.ok, JSON.stringify(a)).toBe(true);
      expect((await hangRun(tx, r.runId)).status).toBe("aborted");
      // measured on real rows: central has no driver for the node's robot, so its own try fails and the node's re-send carries s1
      expect(a.abortStops).toMatchObject({ sent: [], failed: ["s1"], pending: [] });
      const ds = await docRunAbortCanGuiLaiStop(tx as never, the.node);
      expect(ds.hang.map((x) => x.a.runId)).toContain(r.runId);
    });
  });

  it("★ (3) MIX, Continue instead of Abort: the resume state says the step is done failed: the re-walk ends there, s1 is not reached", async () => {
    await trongGiaoDich(async (tx) => {
      const the = await dungThe(tx);
      const r = await moRun(tx, the, [chay(the, "m1"), chay(the, "m2", dung(the, "c1")), dung(the, "s1")]);
      for (const id of ["m1", "m2"]) expect((await authorizeForNode(the.node, r.runId, thanUyQuyen(the, r, id))).http).toBe(200);
      await recordEdgeStepRows(tx as never, r.runId, [hang("m1", "completed"), hang("m2", "failed"), hang("c1", "compensated")] as never);
      expect((await completeForNodeV2(the.node, r.runId, ketHeld(r, "journalFull", LOI_C))).http).toBe(200);
      expect(await resumeRun(r.runId, { approved: true } as never, HE_THONG)).toMatchObject({ ok: true, status: "queued" });
      const ctx = (await hangRun(tx, r.runId)).contextJson as Record<string, unknown>;
      expect(ctx[RESUME_STATE_CTX_KEY]).toMatchObject({ m2: { state: "doneFailed" } });
    });
  });

  it("★ (4) B5: the authorisation was never superseded: Continue carries outcomeUnknown, and the text said to use Abort", async () => {
    await trongGiaoDich(async (tx) => {
      const the = await dungThe(tx);
      const r = await moRun(tx, the, [chay(the, "m1"), dung(the, "s1")]);
      expect((await authorizeForNode(the.node, r.runId, thanUyQuyen(the, r, "m1"))).http).toBe(200);
      await recordEdgeStepRows(tx as never, r.runId, [hang("m1", "held")] as never);
      const loi = `EDGE_HELD(configStale): ${EDGE_HOLD_UNUSED_NOT_REPORTED}: command step "m1" was not sent — stale; its authorisation could NOT be reported unused (a Continue treats the step as possibly sent); the run is held.`;
      expect((await completeForNodeV2(the.node, r.runId, ketHeld(r, "configStale", loi))).http).toBe(200);
      const held = await hangRun(tx, r.runId);
      expect(String(held.error)).toContain("Use Abort to send them.");
      expect(String(held.error)).not.toContain("Continue to resume it");
      expect(await resumeRun(r.runId, { approved: true } as never, HE_THONG)).toMatchObject({ ok: true, status: "queued" });
      const ctx = (await hangRun(tx, r.runId)).contextJson as Record<string, unknown>;
      expect(ctx[RESUME_STATE_CTX_KEY]).toMatchObject({ m1: { state: "outcomeUnknown" } });
    });
  });
});
