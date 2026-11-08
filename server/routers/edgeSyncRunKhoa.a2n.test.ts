/**
 * A2(n) T7c (plan point 3 row 16) — the TWO doors of an edge result sync reach a latched run only through edgeCoordinator.syncRunResult, and both write nothing:
 *   • tRPC edgeRuntime.syncRunResult (a session with machine_control);
 *   • REST POST /api/v1/edge/sync (an API key with the edge:sync scope).
 * T7c-b (i) — the answer to a latched run is the stale one, abortRequested (an edge walker of it stops); the code EDGE_SYNC_RUN_LATCHED is in the log.
 * T7c-b (ii) — the one door of assignRun (tRPC edgeRuntime.assignRun) refuses a latched run with EDGE_ASSIGN_RUN_LATCHED: edgeNodeId unchanged.
 * Nothing is written: the step rows, the run context (the latch, DA_BAO), the status stay byte for byte. In-memory DB (FakeDb), no real DB.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "./__otFakeDb";
import { edgeNodes, orchestrationRuns, orchestrationRunSteps } from "../../drizzle/schema";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return { ...actual, eq: makeEq, and: makeAnd, desc: makeDesc };
});
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => fake) }));
// the api_keys table of the REST auth: none (only the master key resolves)
vi.mock("../db", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));
vi.mock("./index", () => ({ appRouter: { createCaller: () => ({}) } }));
vi.mock("../_core/context", () => ({ createContext: vi.fn(async () => ({})) }));
vi.mock("../_core/accessControl", () => ({ requirePermission: () => async ({ ctx, next }: any) => next({ ctx }) }));
// the scope check of both doors is not what is measured here: the run is visible to the caller
vi.mock("../services/orchestration/foe/foeEngine", async (orig) => ({ ...(await orig<Record<string, unknown>>()), runIdVisibleTo: vi.fn(async () => true) }));

import { edgeRuntimeRouter } from "./edgeRuntimeRouter";
import { createV1Router } from "../api/v1/router";
import { KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_DA_BAO_CTX_KEY, loiGiuChuaRa } from "../services/orchestration/foe/foeKetCucKhongRo";

const caller = edgeRuntimeRouter.createCaller({ user: { id: 1, role: "admin", name: "Admin" } } as any);
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/v1", createV1Router());
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, "127.0.0.1", () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const CHOT = { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN", at: "2026-11-08T00:00:00.000Z" };
const DA_BAO = { stepId: "x", at: "2026-11-08T00:00:01.000Z" };
const PAYLOAD = {
  edgeNodeCode: "edge-x",
  runId: 41,
  status: "completed",
  currentStepId: "end",
  contextJson: { k: 1 },
  steps: [
    { stepId: "st", stepType: "command", status: "completed", attempt: 2 },
    { stepId: "s9", stepType: "command", status: "completed", attempt: 1 },
  ],
};
const anh = () => JSON.stringify({ run: fake.store.get("orchestration_runs"), steps: fake.store.get("orchestration_run_steps") });

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fake.store.clear();
  resetSeq();
  process.env.EDGE_RUNTIME_ENABLED = "true";
  fake.seed(orchestrationRuns, [
    { id: 41, workflowId: 10, workflowRef: "wf-1", status: "held", paramsJson: {}, edgeNodeId: null, startedBy: 5, contextJson: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: CHOT, [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: DA_BAO } },
  ]);
  fake.seed(orchestrationRunSteps, [
    { id: 7, runId: 41, stepId: "st", stepType: "command", status: "failed", attempt: 1, resultJson: null, error: loiGiuChuaRa("st", { nguon: "tuChoi", ma: "CHUA_GHIM_STOP" }) },
  ]);
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  warn?.mockRestore();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("A2(n) T7c — both doors of an edge result sync: a latched run is never written; T7c-b: the answer stops its walker, assignRun refuses it", () => {
  const LOG_KHOA = (c: unknown[]) => /^\[EdgeCoordinator\] EDGE_SYNC_RUN_LATCHED: sync of run 41 /.test(String(c[0])) && /\(chot\)/.test(String(c[0]));
  it("★ T7C-CUA-TRPC edgeRuntime.syncRunResult on a latched held run: nothing written (the rows, the latch, 'held' stay), the stale answer abortRequested, the code in the log", async () => {
    const truoc = anh();
    const res = await caller.syncRunResult(PAYLOAD);
    expect(res).toEqual({ ok: true, enabled: true, data: { runId: 41, stepsApplied: 0, abortRequested: true, stale: true } });
    expect(anh()).toBe(truoc);
    expect(warn.mock.calls.some(LOG_KHOA)).toBe(true);
  });

  it("★ T7C-CUA-REST POST /api/v1/edge/sync (edge:sync) on the same run: nothing written, a 202 whose data is the stale answer abortRequested, the code in the log", async () => {
    const truoc = anh();
    const r = await fetch(`${base}/api/v1/edge/sync`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer MASTER" }, body: JSON.stringify(PAYLOAD) });
    const body = (await r.json()) as { ok: boolean; data?: Record<string, unknown> };
    expect(r.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ runId: 41, stepsApplied: 0, abortRequested: true, stale: true });
    expect(anh()).toBe(truoc);
    expect(warn.mock.calls.some(LOG_KHOA)).toBe(true);
  });

  it("★ T7CB-ASSIGN-CUA-TRPC edgeRuntime.assignRun of the same latched run to a known node: refused with the code, edgeNodeId unchanged, nothing written", async () => {
    fake.seed(edgeNodes, [{ id: 3, code: "edge-x", name: "edge-x", status: "online" }]);
    const truoc = anh();
    const res = await caller.assignRun({ runId: 41, edgeNodeId: 3 });
    expect(res).toMatchObject({ ok: false, enabled: true });
    expect(res.message).toMatch(/^EDGE_ASSIGN_RUN_LATCHED: run 41 /);
    expect(fake.store.get("orchestration_runs")![0]!.edgeNodeId).toBeNull();
    expect(anh()).toBe(truoc);
    expect(warn.mock.calls.some((c) => /^\[EdgeCoordinator\] EDGE_ASSIGN_RUN_LATCHED: run 41 /.test(String(c[0])) && /\(chot\)/.test(String(c[0])))).toBe(true);
  });

  it("control: edgeRuntime.assignRun of the run NOT latched to the same node: assigned as before", async () => {
    fake.seed(edgeNodes, [{ id: 3, code: "edge-x", name: "edge-x", status: "online" }]);
    fake.seed(orchestrationRuns, [{ id: 41, workflowId: 10, workflowRef: "wf-1", status: "queued", paramsJson: {}, edgeNodeId: null, startedBy: 5, contextJson: {} }]);
    fake.seed(orchestrationRunSteps, []);
    const res = await caller.assignRun({ runId: 41, edgeNodeId: 3 });
    expect(res).toEqual({ ok: true, enabled: true, data: { runId: 41, edgeNodeId: 3 } });
    expect(fake.store.get("orchestration_runs")![0]!.edgeNodeId).toBe(3);
  });

  it("control: the same doors, the run NOT latched: written as before (tRPC ok, REST 202)", async () => {
    fake.seed(orchestrationRuns, [{ id: 41, workflowId: 10, workflowRef: "wf-1", status: "running", paramsJson: {}, edgeNodeId: null, startedBy: 5, contextJson: {} }]);
    fake.seed(orchestrationRunSteps, []);
    const res = await caller.syncRunResult(PAYLOAD);
    expect(res).toMatchObject({ ok: true, data: { runId: 41, stepsApplied: 2, abortRequested: false } });
    expect(fake.store.get("orchestration_runs")![0]!.status).toBe("completed");
    fake.seed(orchestrationRuns, [{ id: 41, workflowId: 10, workflowRef: "wf-1", status: "running", paramsJson: {}, edgeNodeId: null, startedBy: 5, contextJson: {} }]);
    const r = await fetch(`${base}/api/v1/edge/sync`, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer MASTER" }, body: JSON.stringify(PAYLOAD) });
    expect(r.status).toBe(202);
    expect(fake.store.get("orchestration_runs")![0]!.status).toBe("completed");
  });
});
