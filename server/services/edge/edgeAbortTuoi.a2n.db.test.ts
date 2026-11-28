/**
 * X-EDGE-ABORT-TUOI — central's `abortAgeMs` and its window on the REAL `_test` database: the age of the abort's ONE moment (a rejection's stamp first,
 * else finishedAt of an 'aborted' run), on central's clock, read through drizzle typed (finishedAt is `timestamp` WITHOUT time zone: written the way the
 * engine writes it — a JS Date through drizzle — so a reader that shifts the naive column by the session's zone shows here as an age hours off).
 * Covered, through the service functions the routes call (edgeNodeRoutes hands them `{ tuoiAbort }` from the x-edge-node-accepts header):
 *   • Q7 (b): a node that did not ask (no opts) gets the answer of today — no `abortAgeMs` key — in progress 200, progress claim_stale, authorize
 *     `stopped` and authorize claim_stale;
 *   • a node that asked gets the age: 16 min for an abort 16 min old; the rejection's stamp (20 min) wins over a later finishedAt (1 min);
 *     a moment in the future (a clock that went back) ⇒ null, never a negative number;
 *   • N1-a / N1-b: the pull's stopsUnconfirmed (CE:374) and its picture's abortedAt (sweepPayload) from the same moment.
 *
 * Mocks (HST 28/11, ghi chú 4 — the leak of 05:37: an ASYNC factory that was still pending while another module loaded handed that module the
 * ORIGINAL sender):
 *   • every vi.mock factory below is SYNCHRONOUS and never loads the original module (no original import anywhere in this file);
 *   • db/connection: getDb / getJobsDb / getReadDb ⇒ the case's transaction, outside it a trap that counts and returns null;
 *   • robot/criticalStopAlert, notificationService, ecosystem/ecosystemEvents: every SENDING export is a counter; any other export is absent (a read
 *     of it throws, loudly);
 *   • edgeCentralCommon is NOT mocked: its ONE module instance is loaded and `centralSigner` is replaced on it by vi.spyOn (a property of that
 *     instance — every importer reads it at call time), returning this file's own signer: an in-memory key made here (edgeSigning.
 *     generateEdgeSigningKey), its keyset envelope a real one signed with it (a null one made the config unbuildable ⇒ an edge_config_unbuildable
 *     alert: kiem-dinh 28/11, E). No key file, no keyring directory, nothing printed.
 * Second lock: every console line of the worker is recorded (and still printed); one line carrying "[StopAlert]" (the FIRST thing the original
 * raiseCriticalStopAlert does, before anything else) is red in every case and in the file's own hook. The database variable is taken once, here,
 * and EMPTIED for the worker before any module loads: the original db/connection, if anything ever reached it, constructs no client (it needs that
 * variable); this file's transactions go through its OWN client (one connection), closed at the end.
 * Every write is in the case's OWN transaction, ROLLED BACK; the handle of a finished case transaction refuses statements (TEST-DB-TAY-CAM-CU,
 * afterAll). No boot scan (RUN-SOT: no quetBoot), no device I/O, no URGENT, no DELETE / TRUNCATE. Rows, all rolled back (0 left):
 *   • every case: edge_nodes 1 (+ UPDATE of its protocolVersion), edge_node_credentials 1, orchestration_workflows 1 per run, orchestration_runs 1 per
 *     run (inserted 'queued', then UPDATEd to its status), orchestration_run_edge_assignments 1 per run (inserted unclaimed, then UPDATEd to claim 1
 *     by the node's credential; progress UPDATEs progressSeq / lastProgressAt); what the service functions themselves write in that transaction;
 *   • DB-TUOI-N1 also: factories 1, workshops 1, production_lines 1, stations 1, machines 1, robots 1 (+ its device_owner_changes row, by trigger),
 *     three runs, orchestration_run_steps 3.
 * The fixture follows the triggers of 0370 / 0378: an assignment is born on a QUEUED run, unclaimed; the claim is an UPDATE naming a credential of
 * that node.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as common from "./edgeCentralCommon";
import { gaiTayCam, tayCamCuaTep } from "../orchestration/foe/__foeGateRunFixture";

const H = vi.hoisted(() => {
  const h = {
    /** taken once, before any module of this file loads; the worker's own variable is emptied right after */
    dbUrl: process.env.DATABASE_URL ?? "",
    tx: null as unknown,
    bay: 0,
    signer: null as unknown,
    canhBao: [] as unknown[],
    thongBao: 0,
    suKien: 0,
    /** cumulative over the whole file, never reset: every call that reached a counter */
    tong: { canhBao: 0, thongBao: 0, suKien: 0 },
    /** every console line of the worker, in order */
    nhatKy: [] as string[],
  };
  vi.stubEnv("DATABASE_URL", "");
  for (const k of ["log", "info", "warn", "error", "debug"] as const) {
    const goc = console[k].bind(console);
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => {
      h.nhatKy.push(a.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(" "));
      goc(...a);
    });
  }
  return h;
});
vi.mock("../../db/connection", () => {
  const bay = async () => {
    if (H.tx) return H.tx;
    H.bay++; // outside the case's transaction: never a database
    return null;
  };
  return { getDb: bay, getJobsDb: bay, getReadDb: bay, getNotifyClient: () => null, openSessionClient: () => null, isEdgeProcessRole: () => false };
});
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: async (a: unknown) => {
    H.canhBao.push(a);
    H.tong.canhBao++;
  },
  __quenBoNhoKhuTrungChoTest: () => undefined,
}));
vi.mock("../notificationService", () => {
  const gui = async () => {
    H.thongBao++;
    H.tong.thongBao++;
  };
  return { sendNotification: gui, sendBroadcastNotification: gui, sendAlertNotification: gui, sendReportNotification: gui, sendSystemNotification: gui };
});
vi.mock("../ecosystem/ecosystemEvents", () => {
  const phat = () => {
    H.suKien++;
    H.tong.suKien++;
  };
  return { publishAnomalyDetected: phat, publishTaskEvent: phat, publishWorkOrderCreated: phat, publishProgramDeployed: phat, publishTwinDerived: phat };
});

const onTest = /_test\b/.test(H.dbUrl);
type Csdl = ReturnType<typeof drizzle>;
type Tx = Parameters<Parameters<Csdl["transaction"]>[0]>[0];
const ROLLBACK = Symbol("rollback");
const MIN = 60_000;
const DAU = `EATUOI-${Date.now()}`;
const STOP_ALERT = "[StopAlert]";
const dongStopAlert = () => H.nhatKy.filter((l) => l.includes(STOP_ALERT));
const khach: { c: ReturnType<typeof postgres> | null; db: Csdl | null } = { c: null, db: null };

async function trongGiaoDich(fn: (tx: Tx) => Promise<void>): Promise<void> {
  const db = khach.db;
  if (!db) throw new Error("no db");
  const moc: { h: ReturnType<typeof gaiTayCam> | null } = { h: null };
  try {
    await db.transaction(async (tx) => {
      H.tx = tx;
      moc.h = gaiTayCam(tx, "a2n.db");
      try {
        await fn(tx);
      } finally {
        H.tx = null;
        moc.h?.ketThuc();
      }
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  } finally {
    moc.h?.daRollback();
  }
}

type Nut = { credentialId: number; nodeId: number; nodeCode: string; factoryCode: string | null };
type RunMoi = { status: string; finishedAt: Date | null; contextJson?: Record<string, unknown> };
/** one node (protocol 2) with ONE active credential; the principal names that credential */
async function dungNut(tx: Tx, tag: string): Promise<Nut> {
  const { edgeNodes } = await import("../../../drizzle/schema");
  const { edgeNodeProtocol } = await import("./edgeControlSchema");
  const { edgeNodeCredentials } = await import("./edgeExecutionSchema");
  const { eq } = await import("drizzle-orm");
  const [n] = await tx.insert(edgeNodes).values({ code: `${DAU}-${tag}`, name: `${DAU}-${tag}`, factoryCode: null }).returning({ id: edgeNodes.id });
  await tx.update(edgeNodeProtocol).set({ protocolVersion: 2 }).where(eq(edgeNodeProtocol.id, n!.id)); // the v2 gate (v2Gate): this protocol
  // CHECKs of 0370: keyPrefix edn_ + 12 hex, secretHash 64 hex, status active with no revocation data
  const [c] = await tx
    .insert(edgeNodeCredentials)
    .values({ edgeNodeId: n!.id, keyPrefix: `edn_${randomBytes(6).toString("hex")}`, secretHash: randomBytes(32).toString("hex"), status: "active" })
    .returning({ id: edgeNodeCredentials.id });
  return { credentialId: c!.id, nodeId: n!.id, nodeCode: `${DAU}-${tag}`, factoryCode: null };
}
/**
 * a workflow + a run of that node with a live claim (claimSeq 1) by the node's credential, the way the triggers of 0370 let it be made:
 * the run is inserted 'queued'; the assignment is born on it unclaimed (claimSeq 0, no token, progressSeq 0); the claim is an UPDATE (claimSeq + 1,
 * a token, progressSeq 0, the claimant a credential of that node); then the run takes its status (and finishedAt)
 */
async function dungRun(tx: Tx, node: Nut, tag: string, run: RunMoi, steps: unknown[] = [{ id: "m1", type: "command", machineId: 1, command: "start", args: {} }]) {
  const { orchestrationRuns, orchestrationWorkflows } = await import("../../../drizzle/schema");
  const { runEdgeAssignments } = await import("./edgeExecutionSchema");
  const { hashEdgeSecret } = await import("./edgeNodeCredentials");
  const { hashWorkflowDefinition } = await import("../orchestration/foe/foeGateApproval");
  const { eq } = await import("drizzle-orm");
  const def = { ref: `${DAU}-${tag}`, name: `${DAU}-${tag}`, steps };
  const [w] = await tx.insert(orchestrationWorkflows).values({ ref: def.ref, name: def.name, definitionJson: def as never, status: "active", scopeKey: "global", version: 1 } as never).returning({ id: orchestrationWorkflows.id });
  const [r] = await tx
    .insert(orchestrationRuns)
    .values({ workflowId: w!.id, workflowRef: def.ref, status: "queued", paramsJson: {}, contextJson: run.contextJson ?? {} } as never)
    .returning({ id: orchestrationRuns.id });
  await tx.insert(runEdgeAssignments).values({ runId: r!.id, edgeNodeId: node.nodeId, workflowId: w!.id, workflowVersion: 1, defHash: hashWorkflowDefinition(def as never) });
  const claimToken = `ect_${randomBytes(32).toString("base64url").slice(0, 43)}`;
  await tx
    .update(runEdgeAssignments)
    .set({ claimSeq: 1, claimTokenHash: hashEdgeSecret(claimToken), claimedByCredentialId: node.credentialId, claimedAt: new Date(), progressSeq: 0 })
    .where(eq(runEdgeAssignments.runId, r!.id));
  await tx.update(orchestrationRuns).set({ status: run.status, finishedAt: run.finishedAt } as never).where(eq(orchestrationRuns.id, r!.id));
  return { runId: r!.id, claimToken };
}
async function dung(tx: Tx, tag: string, run: RunMoi) {
  const node = await dungNut(tx, tag);
  return { node, ...(await dungRun(tx, node, tag, run)) };
}
/** a robot cell of the node (for a STOP its pull can picture): factory → workshop → line → station → machine (ROBOT) → robot owned by the node */
async function dungRobot(tx: Tx, nodeId: number) {
  const { sql } = await import("drizzle-orm");
  const id = async (q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as unknown as Array<{ id: number | string }>)[0]!.id);
  const f = await id(sql`INSERT INTO factories (code, name, "isActive") VALUES (${`F-${DAU}`}, 'eatuoi', true) RETURNING id`);
  const ws = await id(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`W-${DAU}`}, 'eatuoi ws') RETURNING id`);
  const line = await id(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ws}, ${`L-${DAU}`}, 'eatuoi line') RETURNING id`);
  const st = await id(sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`S-${DAU}`}, 'eatuoi st') RETURNING id`);
  const m = await id(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${st}, ${`MR-${DAU}`}, 'eatuoi robot cell', 'ROBOT', true) RETURNING id`);
  const rb = await id(sql`INSERT INTO robots (code, name, vendor, endpoint, "isEnabled", "lineId", "stationId", "edgeNodeId") VALUES (${`RA-${DAU}`}, 'eatuoi robot', 'fanuc', 'tcp://127.0.0.1:9', true, ${line}, ${st}, ${nodeId}) RETURNING id`);
  return { machineId: m, robotId: rb };
}
const nonce = () => randomBytes(24).toString("base64url");
async function authBody(runId: number, claimToken: string) {
  const { robotPayloadHash } = await import("../ot/otActionBinding");
  return {
    claimSeq: 1,
    claimToken,
    stepId: "m1",
    attempt: 1,
    idempotencyKey: `run${runId}-m1-a1`,
    reqNonce: nonce(),
    command: { kind: "robot", robotId: 1, jobType: "custom", params: {} },
    payloadHash: robotPayloadHash({ robotId: 1, jobType: "custom", params: {} }),
    programChecks: [{ adapterId: 1, status: "verified", checksum: "sim:1:abc", readAt: Date.now() }],
  };
}
const SAI = `ect_${"Z".repeat(43)}`;
/** an age measured on the same clock a few ms later: within [expected, expected + 2 min] */
const trongKhoang = (v: unknown, ms: number) => typeof v === "number" && v >= ms && v <= ms + 2 * MIN;

beforeAll(async () => {
  // in memory only: made at run time, never written, never printed; no default key, no environment variable, no scripts/ import
  const { generateEdgeSigningKey, edgePinnedKeyset, signEdgeObject } = await import("./edgeSigning");
  const { key } = generateEdgeSigningKey();
  const keyset = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: Date.now() - 60_000 }], Date.now(), 1).keyset;
  H.signer = { key, keyset, keysetEnvelope: signEdgeObject("keyset", keyset, key) };
  vi.spyOn(common, "centralSigner").mockImplementation(() => H.signer as ReturnType<typeof common.centralSigner>);
  // loaded up front, ONE AFTER THE OTHER (ghi chú 4): no load ever overlaps another
  await import("../robot/criticalStopAlert");
  await import("../notificationService");
  await import("../ecosystem/ecosystemEvents");
  await import("./edgeConfigCentral");
  await import("./edgeExecutionCentral");
  await import("./edgeAuthorizeCentral");
  if (onTest) {
    khach.c = postgres(H.dbUrl, { max: 1, idle_timeout: 20, connect_timeout: 30, connection: { statement_timeout: 30_000 } });
    khach.db = drizzle(khach.c);
  }
});
beforeEach(() => {
  H.bay = 0;
  H.canhBao.length = 0;
  H.thongBao = 0;
  H.suKien = 0;
});
/** the alert queue is fire-and-forget (void async): let it run to the end — event-loop turns, no real clock — then ask that NOTHING was sent */
async function khongGuiGi(ca: string): Promise<void> {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  expect([H.canhBao.length, H.thongBao, H.suKien, dongStopAlert()], `${ca}: alerts / notifications / events sent, original sender lines (must be none)`).toEqual([0, 0, 0, []]);
}

describe.skipIf(!onTest)("X-EDGE-ABORT-TUOI — central's abortAgeMs on the real _test DB (rolled back)", () => {
  it("★ DB-TUOI-STALE — a stale claim of an 'aborted' run 16 min old (progress): asked ⇒ { abortRequested: true, abortAgeMs ≈ 16 min }; not asked ⇒ exactly { abortRequested: true } (Q7 b)", async () => {
    await trongGiaoDich(async (tx) => {
      const x = await dung(tx, "stale", { status: "aborted", finishedAt: new Date(Date.now() - 16 * MIN) });
      const { progressForNodeV2 } = await import("./edgeExecutionCentral");
      const pMoi = (await progressForNodeV2(x.node, x.runId, { claimSeq: 1, claimToken: SAI, seq: 1, status: "running" } as never, { tuoiAbort: true } as never)) as Record<string, any>;
      const pCu = (await progressForNodeV2(x.node, x.runId, { claimSeq: 1, claimToken: SAI, seq: 1, status: "running" } as never)) as Record<string, any>;
      expect([pMoi.code, pMoi.data?.abortRequested, trongKhoang(pMoi.data?.abortAgeMs, 16 * MIN)], "DB-TUOI-STALE: progress asked").toEqual(["claim_stale", true, true]);
      expect([pCu.code, pCu.data], "DB-TUOI-STALE: progress not asked").toEqual(["claim_stale", { abortRequested: true }]);
    });
    expect(H.bay, "DB-TUOI-STALE: getDb outside the transaction").toBe(0);
    await khongGuiGi("DB-TUOI-STALE");
  });

  it("★ DB-TUOI-PROGRESS — progress 200 of that run with its own claim: asked ⇒ abortAgeMs ≈ 16 min; not asked ⇒ no abortAgeMs key", async () => {
    await trongGiaoDich(async (tx) => {
      const x = await dung(tx, "prog", { status: "aborted", finishedAt: new Date(Date.now() - 16 * MIN) });
      const { progressForNodeV2 } = await import("./edgeExecutionCentral");
      const moi = (await progressForNodeV2(x.node, x.runId, { claimSeq: 1, claimToken: x.claimToken, seq: 1, status: "running" } as never, { tuoiAbort: true } as never)) as Record<string, any>;
      const cu = (await progressForNodeV2(x.node, x.runId, { claimSeq: 1, claimToken: x.claimToken, seq: 2, status: "running" } as never)) as Record<string, any>;
      expect([moi.http, moi.data?.abortRequested, trongKhoang(moi.data?.abortAgeMs, 16 * MIN)], `DB-TUOI-PROGRESS: asked ${JSON.stringify(moi).slice(0, 300)}`).toEqual([200, true, true]);
      expect([cu.http, cu.data?.abortRequested, "abortAgeMs" in (cu.data ?? {})], "DB-TUOI-PROGRESS: not asked").toEqual([200, true, false]);
    });
    expect(H.bay, "DB-TUOI-PROGRESS: getDb outside the transaction").toBe(0);
    await khongGuiGi("DB-TUOI-PROGRESS");
  });

  it("★ DB-TUOI-TUCHOI — a rejection's stamp 20 min old wins over a finishedAt 1 min old (the later write of the hook): abortAgeMs ≈ 20 min", async () => {
    await trongGiaoDich(async (tx) => {
      const x = await dung(tx, "tuchoi", { status: "aborted", finishedAt: new Date(Date.now() - MIN), contextJson: { foeRejectClaim: "rc_eatuoi", foeRejectClaimAt: Date.now() - 20 * MIN } });
      const { progressForNodeV2 } = await import("./edgeExecutionCentral");
      const p = (await progressForNodeV2(x.node, x.runId, { claimSeq: 1, claimToken: x.claimToken, seq: 1, status: "running" } as never, { tuoiAbort: true } as never)) as Record<string, any>;
      expect([p.http, trongKhoang(p.data?.abortAgeMs, 20 * MIN)], `DB-TUOI-TUCHOI: ${p.data?.abortAgeMs}`).toEqual([200, true]);
    });
    expect(H.bay, "DB-TUOI-TUCHOI: getDb outside the transaction").toBe(0);
    await khongGuiGi("DB-TUOI-TUCHOI");
  });

  it("★ DB-TUOI-AM — finishedAt 5 min in the future (a clock that went back): abortAgeMs null, never negative", async () => {
    await trongGiaoDich(async (tx) => {
      const x = await dung(tx, "am", { status: "aborted", finishedAt: new Date(Date.now() + 5 * MIN) });
      const { progressForNodeV2 } = await import("./edgeExecutionCentral");
      const p = (await progressForNodeV2(x.node, x.runId, { claimSeq: 1, claimToken: x.claimToken, seq: 1, status: "running" } as never, { tuoiAbort: true } as never)) as Record<string, any>;
      expect([p.http, p.data?.abortRequested, p.data?.abortAgeMs], "DB-TUOI-AM").toEqual([200, true, null]);
    });
    expect(H.bay, "DB-TUOI-AM: getDb outside the transaction").toBe(0);
    await khongGuiGi("DB-TUOI-AM");
  });

  it("★ DB-TUOI-AUTH — authorize of an abort 16 min old: asked ⇒ stopped + abortAgeMs ≈ 16 min, a stale claim ⇒ { abortRequested: true, abortAgeMs ≈ 16 min }; not asked ⇒ today's answers", async () => {
    await trongGiaoDich(async (tx) => {
      const x = await dungAuth(tx); // a node IN a factory, the step's machine in it (ghi chú 7: authorize reads the scope first)
      const { authorizeForNode } = await import("./edgeAuthorizeCentral");
      const auth = authorizeForNode as unknown as (...a: unknown[]) => Promise<Record<string, any>>;
      const hoi = { tuoiAbort: true };
      const moi = await auth(x.node, x.runId, await authBody(x.runId, x.claimToken), hoi);
      const cu = await auth(x.node, x.runId, await authBody(x.runId, x.claimToken));
      const sMoi = await auth(x.node, x.runId, await authBody(x.runId, SAI), hoi);
      const sCu = await auth(x.node, x.runId, await authBody(x.runId, SAI));
      expect([moi.http, moi.code, trongKhoang(moi.data?.abortAgeMs, 16 * MIN)], `DB-TUOI-AUTH: asked ${JSON.stringify(moi).slice(0, 300)}`).toEqual([409, "stopped", true]);
      expect([cu.http, cu.code, cu.data], "DB-TUOI-AUTH: not asked (Q7 b)").toEqual([409, "stopped", undefined]);
      expect([sMoi.code, sMoi.data?.abortRequested, trongKhoang(sMoi.data?.abortAgeMs, 16 * MIN)], "DB-TUOI-AUTH: stale, asked").toEqual(["claim_stale", true, true]);
      expect([sCu.code, sCu.data], "DB-TUOI-AUTH: stale, not asked").toEqual(["claim_stale", { abortRequested: true }]);
    });
    expect(H.bay, "DB-TUOI-AUTH: getDb outside the transaction").toBe(0);
    await khongGuiGi("DB-TUOI-AUTH");
  });

  it("★ DB-TUOI-N1 — N1-a / N1-b: a rejection stamped 20 min ago, its finishedAt 1 min ago ⇒ NOT in stopsUnconfirmed; stamped 10 min ago ⇒ listed, the picture's abortedAt = the stamp; no stamp (finishedAt 1 min) ⇒ listed as today", async () => {
    await trongGiaoDich(async (tx) => {
      const node = await dungNut(tx, "n1");
      const rb = await dungRobot(tx, node.nodeId);
      const buoc = [{ id: "g0", type: "hitl_gate", prompt: "go?" }, { id: "s1", type: "command", machineId: rb.machineId, command: "abort", args: { robotId: rb.robotId } }];
      const { sql } = await import("drizzle-orm");
      const motPhut = new Date(Date.now() - MIN);
      const dau20 = Date.now() - 20 * MIN;
      const dau10 = Date.now() - 10 * MIN;
      const lam = async (tag: string, ctx: Record<string, unknown>) => {
        const r = await dungRun(tx, node, tag, { status: "aborted", finishedAt: motPhut, contextJson: ctx }, buoc);
        await tx.execute(sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson") VALUES (${r.runId}, 'abort:s1', 'command', 'failed', 0, ${JSON.stringify({ stepId: "s1" })}::jsonb)`);
        return r.runId;
      };
      const cu = await lam("n1-cu", { foeRejectClaim: "rc_n1", foeRejectClaimAt: dau20 });
      const moi = await lam("n1-moi", { foeRejectClaim: "rc_n1", foeRejectClaimAt: dau10 });
      const thuong = await lam("n1-thuong", {});
      const { pullForNodeV2 } = await import("./edgeExecutionCentral");
      const r = await pullForNodeV2(node, {});
      expect(r.http, `DB-TUOI-N1: ${JSON.stringify(r).slice(0, 400)}`).toBe(200);
      expect([(r.data!.configVersion ?? 0) > 0, r.data!.runStateUnavailable], "DB-TUOI-N1: the config built, no run section left out").toEqual([true, undefined]);
      const ds = r.data!.stopsUnconfirmed;
      const id = ds.map((x) => x.runId);
      expect([id.includes(cu), id.includes(moi), id.includes(thuong)], "DB-TUOI-N1: listed (20 min stamp, 10 min stamp, no stamp)").toEqual([false, true, true]);
      const anh = JSON.parse(String(ds.find((x) => x.runId === moi)!.picture.payload)) as { abortedAt?: number };
      expect(anh.abortedAt, "DB-TUOI-N1 (N1-b): the picture's abortedAt is the stamp, not the later finishedAt").toBe(dau10);
      const anhThuong = JSON.parse(String(ds.find((x) => x.runId === thuong)!.picture.payload)) as { abortedAt?: number };
      expect(anhThuong.abortedAt, "DB-TUOI-N1: no stamp ⇒ finishedAt, as today").toBe(motPhut.getTime());
    });
    expect(H.bay, "DB-TUOI-N1: getDb outside the transaction").toBe(0);
    await khongGuiGi("DB-TUOI-N1");
  });
});

describe("X-EDGE-ABORT-TUOI — census of this file (HST 28/11, bản 3, ghi chú 4)", () => {
  it("★ DB-TUOI-DOI-CHUNG — positive control on the product's REAL road (HST 28/11, ghi chú 4 item 7): raiseEdgeConfigAlert (recipients []) runs its own queue — its log line — and its own import of robot/criticalStopAlert reaches the COUNTER once; nothing reaches notificationService or ecosystemEvents (on this road only the original raiseCriticalStopAlert would call them); no original sender line", async () => {
    const truoc = H.nhatKy.length;
    const { raiseEdgeConfigAlert } = await import("./edgeConfigCentral");
    const dedupKey = `eatuoi-doi-chung:${DAU}`;
    expect(raiseEdgeConfigAlert({ kind: "edge_config_unbuildable", dedupKey, title: "t", message: "m", nodeId: 1 }, async () => []), "DB-TUOI-DOI-CHUNG: started").toBe(true);
    for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
    const a = (H.canhBao[0] ?? {}) as Record<string, unknown>;
    expect([H.canhBao.length, H.thongBao, H.suKien], "DB-TUOI-DOI-CHUNG: counted (alert, notification, event)").toEqual([1, 0, 0]);
    expect([a.kind, a.dedupKey, a.recipients, a.entityType, a.entityId], "DB-TUOI-DOI-CHUNG: the alert the queue raised").toEqual(["edge_config_unbuildable", dedupKey, [], "edge_node", 1]);
    const moi = H.nhatKy.slice(truoc);
    expect([moi.some((l) => l.includes("[EdgeConfig] edge_config_unbuildable: no active admin / supervisor")), dongStopAlert()], "DB-TUOI-DOI-CHUNG: the queue's own line; original sender lines").toEqual([true, []]);
  });

  it("★ DB-TUOI-KY — the signer every importer reads is this file's: centralSigner of the ONE edgeCentralCommon instance is the spy, returning the in-memory signer", () => {
    expect([vi.isMockFunction(common.centralSigner), common.centralSigner() === H.signer, H.signer !== null], "DB-TUOI-KY").toEqual([true, true, true]);
  });

  it("★ DB-TUOI-KY-DUONG — the spy acts on a PRODUCT road (HST 28/11, ghi chú 5): authorizeForNode (another module) calls it once per request; with the signer it goes on to the DB (the getDb trap counts 1 ⇒ edge_unavailable), with the spy answering null ONCE it stops before the DB (the trap stays at 1 ⇒ edge_unavailable)", async () => {
    const spy = vi.mocked(common.centralSigner);
    const { authorizeForNode } = await import("./edgeAuthorizeCentral");
    const auth = authorizeForNode as unknown as (...a: unknown[]) => Promise<Record<string, any>>;
    const nut = { credentialId: 1, nodeId: 1, nodeCode: `${DAU}-ky`, factoryCode: null };
    const n0 = spy.mock.calls.length;
    const coKy = await auth(nut, 1, await authBody(1, SAI));
    const n1 = spy.mock.calls.length;
    const bay1 = H.bay;
    spy.mockReturnValueOnce(null);
    const khongKy = await auth(nut, 1, await authBody(1, SAI));
    const n2 = spy.mock.calls.length;
    expect([n1 - n0, bay1, coKy.code, n2 - n1, H.bay, khongKy.code], "DB-TUOI-KY-DUONG: (calls, trap, answer) with the signer, then with null").toEqual([1, 1, "edge_unavailable", 1, 1, "edge_unavailable"]);
  });

  it("★ DB-TUOI-CENSUS — the three senders and db/connection are vi.mock'ed by SYNCHRONOUS factories; no original import; edgeCentralCommon not mocked; loads one after the other; no key text; no signing variable (EDGE_SIG…) read; no import of the signing-key script", () => {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    // built, so that these lines themselves do not name what they look for
    const viMock = ["vi", "mock("].join(".");
    for (const m of ["../../db/connection", "../robot/criticalStopAlert", "../notificationService", "../ecosystem/ecosystemEvents"]) expect(src.includes(`${viMock}"${m}", () =>`), `DB-TUOI-CENSUS: vi.mock ${m}, synchronous`).toBe(true);
    expect(src.split(viMock).length - 1, "DB-TUOI-CENSUS: vi.mock calls").toBe(4);
    expect(new RegExp(`${["vi", "mock"].join("\\.")}\\([^,]+,\\s*async`).test(src), "DB-TUOI-CENSUS: no async factory").toBe(false);
    expect(src.includes(["import", "Original"].join("")), "DB-TUOI-CENSUS: no original import").toBe(false);
    expect(src.includes(["import", "Actual"].join("")), "DB-TUOI-CENSUS: no actual import").toBe(false);
    expect(src.includes(`${viMock}"./edge${"CentralCommon"}"`), "DB-TUOI-CENSUS: edgeCentralCommon not mocked").toBe(false);
    expect(src.includes(["Promise", "all("].join(".")), "DB-TUOI-CENSUS: no loads side by side").toBe(false);
    const ten = ["EDGE", "SIGNING"].join("_");
    expect(src.includes(ten), "DB-TUOI-CENSUS: no signing variable (EDGE_SIG…)").toBe(false);
    expect(src.includes(["-----", "BEGIN"].join("")), "DB-TUOI-CENSUS: no key text").toBe(false);
    expect(src.includes(["edge", "signing", "key"].join("-")), "DB-TUOI-CENSUS: no signing-key script").toBe(false);
    expect([...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]), "DB-TUOI-CENSUS: the only variable read").toEqual(["DATABASE_URL"]);
  });
});

// Runs LAST (afterAll hooks run as a stack): closes this file's own client, gives the worker its variable back. Never throws.
afterAll(async () => {
  try {
    await khach.c?.end({ timeout: 5 });
  } catch {
    // the client is gone with the worker anyway
  }
  vi.unstubAllEnvs();
});

// HST 28/11 G, ghi chú 4 — over the WHOLE file (never reset, a late call included, after a last flush) the counters were reached only by the
// positive control (one alert, nothing else), and no line of an original sender was printed. Its OWN hook: a red here never hides TAY-CAM below.
afterAll(async () => {
  for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
  expect([H.tong.canhBao, H.tong.thongBao, H.tong.suKien, dongStopAlert()], "DB-TUOI senders over the whole file (only the positive control's)").toEqual([1, 0, 0, []]);
});

// TEST-DB-TAY-CAM-CU — no statement went through the handle of a FINISHED case transaction (its own hook).
afterAll(() => {
  if (!onTest) return;
  const t = tayCamCuaTep("a2n.db");
  expect(t.giaoDich, "TAY-CAM-CU (a2n.db): trongGiaoDich armed no guard").toBeGreaterThan(0);
  expect(t.lenhMuon, "TAY-CAM-CU (a2n.db): statements on the handle of a finished case transaction (refused)").toEqual([]);
});

/**
 * DB-TUOI-AUTH only (ghi chú 7). authorizeForNode reads the run's scope BEFORE the claim (edgeAuthorizeCentral.ts:532), and a node without a
 * factory sees no run (nodeScopeOf, edgeExecutionCentral.ts:137-140: an empty scope ⇒ no factory ⇒ every non-STOP target out). So this case's node
 * sits IN a factory of its own and the command step's machine is a machine of that factory: factory → workshop → line → station → machine. The node
 * is made like dungNut (protocol 2, one active credential) with that factoryCode. dungNut is unchanged: the nine other cases keep their fixture.
 * Placed at the end of the file so that no line above it moves.
 */
async function dungNutCoNhaMay(tx: Tx, tag: string): Promise<{ node: Nut; machineId: number }> {
  const { sql, eq } = await import("drizzle-orm");
  const { edgeNodes } = await import("../../../drizzle/schema");
  const { edgeNodeProtocol } = await import("./edgeControlSchema");
  const { edgeNodeCredentials } = await import("./edgeExecutionSchema");
  const id = async (q: ReturnType<typeof sql>) => Number(((await tx.execute(q)) as unknown as Array<{ id: number | string }>)[0]!.id);
  const ma = `FA-${DAU}-${tag}`;
  const f = await id(sql`INSERT INTO factories (code, name, "isActive") VALUES (${ma}, 'eatuoi auth', true) RETURNING id`);
  const ws = await id(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f}, ${`WA-${DAU}`}, 'eatuoi auth ws') RETURNING id`);
  const line = await id(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ws}, ${`LA-${DAU}`}, 'eatuoi auth line') RETURNING id`);
  const st = await id(sql`INSERT INTO stations ("lineId", code, name) VALUES (${line}, ${`SA-${DAU}`}, 'eatuoi auth st') RETURNING id`);
  const m = await id(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${st}, ${`MA-${DAU}`}, 'eatuoi auth machine', 'AOI', true) RETURNING id`);
  const [n] = await tx.insert(edgeNodes).values({ code: `${DAU}-${tag}`, name: `${DAU}-${tag}`, factoryCode: ma }).returning({ id: edgeNodes.id });
  await tx.update(edgeNodeProtocol).set({ protocolVersion: 2 }).where(eq(edgeNodeProtocol.id, n!.id));
  const [c] = await tx
    .insert(edgeNodeCredentials)
    .values({ edgeNodeId: n!.id, keyPrefix: `edn_${randomBytes(6).toString("hex")}`, secretHash: randomBytes(32).toString("hex"), status: "active" })
    .returning({ id: edgeNodeCredentials.id });
  return { node: { credentialId: c!.id, nodeId: n!.id, nodeCode: `${DAU}-${tag}`, factoryCode: ma }, machineId: m };
}
/** DB-TUOI-AUTH: that node + an 'aborted' run 16 min old whose command step drives that machine (claim 1, through dungRun as every case) */
async function dungAuth(tx: Tx) {
  const o = await dungNutCoNhaMay(tx, "auth");
  const run = await dungRun(tx, o.node, "auth", { status: "aborted", finishedAt: new Date(Date.now() - 16 * MIN) }, [{ id: "m1", type: "command", machineId: o.machineId, command: "start", args: {} }]);
  // the fixture's own check, on the SAME function authorizeForNode asks first (edgeAuthorizeCentral.ts:532 ⇒ edgeCentralCommon.runInNodeScope):
  // red HERE (not at the case's line 301) ⇔ the run is not in its node's scope — a fixture (or a reached original module) fault, not the product's
  const { eq } = await import("drizzle-orm");
  const { orchestrationRuns } = await import("../../../drizzle/schema");
  const [r] = await tx.select({ workflowId: orchestrationRuns.workflowId, paramsJson: orchestrationRuns.paramsJson }).from(orchestrationRuns).where(eq(orchestrationRuns.id, run.runId));
  expect(await common.runInNodeScope(r!, o.node), "DB-TUOI-AUTH fixture: the run is in its node's scope").toBe(true);
  return { node: o.node, ...run };
}
