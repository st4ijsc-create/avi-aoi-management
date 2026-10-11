/**
 * doc 81 Đợt 7 task I3 — engine units (FakeDb; the real engine + the real stop classifier; the factory-scope JUDGE is driven
 * by the test: machine 1 / adapter 501 are in the caller's scope, everything else is out):
 *   • ref probing: a RESTRICTED deployer always creates under a server-made `<ref>~<8 hex>` (taken or free alike) and the
 *     definition is re-stamped; an unrestricted scope and the system loader keep plain refs; a visible workflow is updated
 *     in place; an UNDECIDED scope over the existing workflow ⇒ refused `scopeUnverified` (no silent second copy);
 *   • run visibility follows the executed VERSIONS: runVisibilityDefinitions (legacy ⇒ head; recorded ⇒ head or snapshot;
 *     a missing snapshot / workflow ⇒ null), and listVisibleRuns fills a page from growing reads.
 * The same rules on the real `_test` database: server/routers/orchestrationScope.dot5.db.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { judge, conn } = vi.hoisted(() => ({
  judge: { mode: "scoped" as "scoped" | "admin" },
  conn: { fp: new Map<number, string>() },
}));
vi.mock("../../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/otManager")>();
  return { ...orig, getActiveConnectionFingerprint: (adapterId: number) => conn.fp.get(adapterId) };
});
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return {
    isStopCommandType: orig.isStopCommandType,
    classifyOtStop: orig.classifyOtStop,
    runningConnectionMatchesAdapterRow: orig.runningConnectionMatchesAdapterRow,
    dispatch: vi.fn(async () => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] })),
  };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: vi.fn() }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return {
    ...orig,
    resolveUserFoeScope: (u: { id: number; role: string }) => ({ userId: u.id, userRole: u.role }),
    makeScopeJudge: async (scope: unknown) => {
      if (judge.mode === "admin" || scope === null) return { unrestricted: true, failed: false, outOf: async () => ({ machines: [], robots: [], adapters: [] }) };
      const pick = (m: Map<number, boolean>, o?: { nonStopOnly?: boolean }) => [...m.entries()].filter(([, ns]) => !o?.nonStopOnly || ns).map(([id]) => id);
      return {
        unrestricted: false,
        failed: false,
        outOf: async (t: { machines: Map<number, boolean>; robots: Map<number, boolean>; adapters: Map<number, boolean> }, o?: { nonStopOnly?: boolean }) => ({
          machines: pick(t.machines, o).filter((id) => id !== 1),
          robots: pick(t.robots, o),
          adapters: pick(t.adapters, o).filter((id) => id !== 501),
        }),
      };
    },
  };
});

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const ne = (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] !== v;
  const inArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => vs.includes(row[col.name]);
  const notInArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => !vs.includes(row[col.name]);
  const isNull = (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] == null;
  const desc = (col: { name: string }) => ({ name: col.name, dir: "desc" as const });
  return { ...actual, eq: makeEq, and: makeAnd, ne, inArray, notInArray, isNull, desc };
});
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationRunSteps, orchestrationWorkflows, machines, deviceAdapters, deviceTags } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, runVisibilityDefinitions, listVisibleRuns, refWithSuffix, runVisibleTo } from "./foeEngine";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";

type Row = Record<string, any>;
const ENG = { id: 10, role: "engineer", name: "eng" };
const ADMIN_SCOPE = { scope: null };
const LOADER = { id: 0, role: "system", name: "loader" };
const wfRows = (): Row[] => fake.store.get("orchestration_workflows") ?? [];
const def = (ref: string, steps: unknown[]) => ({ ref, name: ref, steps }) as never;
const A_START = { id: "a", type: "command", machineId: 1, command: "start" };
const B_START = { id: "b", type: "command", machineId: 2, command: "start" };
const B_PINNED_STOP = { id: "sb", type: "command", machineId: 2, command: "stop", args: { adapterId: 502, writes: [{ tagKey: "estop", value: true }] } };
const GATE = { id: "g", type: "hitl_gate", prompt: "p" };

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.setUnique(orchestrationWorkflows, [["ref"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "A", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "AUTOMATION", capabilities: null, code: "M2", name: "B", operationStatus: "stopped", stationId: 2 },
  ]);
  fake.seed(deviceAdapters, [
    { id: 501, machineId: 1, isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null },
    { id: 502, machineId: 2, isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null },
  ]);
  fake.seed(deviceTags, [{ id: 9001, adapterId: 502, tagKey: "estop", dataType: "bool", stopValue: true, writable: true, isEnabled: true }]);
  conn.fp = new Map([[502, adapterTargetFingerprint({ protocol: "modbus", endpoint: "tcp://127.0.0.1:1", machineId: 2, connectionOptions: null } as never)]]);
  judge.mode = "scoped";
  process.env.FOE_ENABLED = "true";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

describe("doc 81 Đợt 7 I3 — refs created by a restricted scope are server-made (no probing)", () => {
  it("★ pure: `<ref>~<8 hex>`, within 128 characters, fresh every time", () => {
    expect(refWithSuffix("line-a")).toMatch(/^line-a~[0-9a-f]{8}$/);
    expect(refWithSuffix("x".repeat(200)).length).toBe(128);
    expect(refWithSuffix("r")).not.toBe(refWithSuffix("r"));
  });

  it("★ a FREE ref and a ref TAKEN by an invisible workflow give the same answer; the taken one is untouched; the definition is re-stamped", async () => {
    expect((await deployWorkflow(def("taken", [B_START]), ENG, ADMIN_SCOPE)).ref).toBe("taken"); // B's, plain (unrestricted)
    const taken = await deployWorkflow(def("taken", [A_START]), ENG);
    const free = await deployWorkflow(def("free", [A_START]), ENG);
    const norm = (x: Row, base: string) => ({ ...x, workflowId: 0, ref: String(x.ref).replace(base, "R").replace(/~[0-9a-f]{8}$/, "~H") });
    expect(norm(taken as Row, "taken")).toEqual(norm(free as Row, "free"));
    expect(taken.ref).toMatch(/^taken~[0-9a-f]{8}$/);
    expect(wfRows().find((w) => w.ref === "taken")!.definitionJson.steps[0].machineId).toBe(2);
    expect(wfRows().find((w) => w.ref === taken.ref)!.definitionJson.ref).toBe(taken.ref);
    expect((fake.store.get("orchestration_workflow_versions") ?? []).find((v: Row) => v.workflowId === taken.workflowId)?.ref).toBe(taken.ref);
  });

  it("★ a visible workflow is updated IN PLACE under its ref (no copy); starting by the stored ref works", async () => {
    const first = await deployWorkflow(def("mine", [GATE, A_START]), ENG);
    const again = await deployWorkflow(def(first.ref!, [GATE, A_START, { id: "d", type: "delay", ms: 1 }]), ENG);
    expect(again).toMatchObject({ ok: true, ref: first.ref, workflowId: first.workflowId, version: (first.version ?? 1) + 1 });
    expect(wfRows()).toHaveLength(1);
    expect((await startRun(first.ref!, {}, ENG)).status).toBe("awaiting_confirm");
  });

  it("control: an unrestricted scope and the system loader keep PLAIN refs; the loader keeps the old refusal on an invisible ref", async () => {
    expect((await deployWorkflow(def("adm", [A_START]), ENG, ADMIN_SCOPE)).ref).toBe("adm");
    expect((await deployWorkflow(def("tpl", [GATE]), LOADER)).ref).toBe("tpl"); // target-free template
    expect((await deployWorkflow(def("bonly", [B_START]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    expect(await deployWorkflow(def("bonly", [GATE]), LOADER)).toMatchObject({ ok: false, reason: "refOutOfScope" });
  });

  it("★ CANNOT DECIDE — the scope over the existing workflow is undecided (its pinned STOP's adapter is down) ⇒ refused scopeUnverified, nothing written", async () => {
    expect((await deployWorkflow(def("undec", [A_START, B_PINNED_STOP]), ENG, ADMIN_SCOPE)).ok).toBe(true);
    conn.fp.delete(502); // the pinned STOP of B can no longer be verified
    const before = wfRows().length;
    expect(await deployWorkflow(def("undec", [A_START]), ENG)).toMatchObject({ ok: false, reason: "scopeUnverified" });
    expect(wfRows()).toHaveLength(before);
  });
});

describe("doc 81 Đợt 7 I3 — runVisibilityDefinitions / listVisibleRuns", () => {
  const seedWf = (id: number, version: number, steps: unknown[]) =>
    fake.store.set("orchestration_workflows", [...wfRows(), { id, ref: `w${id}`, name: `w${id}`, version, status: "active", definitionJson: { ref: `w${id}`, name: `w${id}`, steps } }]);
  const seedSnap = (workflowId: number, version: number, steps: unknown[]) =>
    fake.store.set("orchestration_workflow_versions", [...(fake.store.get("orchestration_workflow_versions") ?? []), { id: workflowId * 100 + version, workflowId, ref: `w${workflowId}`, version, name: "s", definitionJson: { ref: `w${workflowId}`, name: "s", steps } }]);

  it("★ legacy (no record) ⇒ the head; recorded ⇒ the head or the snapshot of each version; missing snapshot / workflow ⇒ null", async () => {
    seedWf(1, 2, [A_START]);
    seedSnap(1, 1, [B_START]);
    const defs = await runVisibilityDefinitions(fake as never, [
      { workflowId: 1, paramsJson: {} },
      { workflowId: 1, paramsJson: { __foeDefVersions: [1] } },
      { workflowId: 1, paramsJson: { __foeDefVersions: [1, 2] } },
      { workflowId: 1, paramsJson: { __foeDefVersions: [3] } },
      { workflowId: 9, paramsJson: { __foeDefVersions: [1] } },
      { workflowId: 1, paramsJson: { __foeDefVersions: ["1", -2] } }, // nothing valid ⇒ legacy (head)
    ]);
    const machinesOf = (ds: unknown) => (ds as Array<{ steps: Array<{ machineId: number }> }> | null)?.map((d) => d.steps[0].machineId) ?? null;
    expect(defs.map(machinesOf)).toEqual([[1], [2], [2, 1], null, null, [1]]);
  });

  it("★ a run is visible only when EVERY version it executed is (one out ⇒ hidden), whatever its head", async () => {
    seedWf(1, 2, [A_START]); // head v2: A
    seedSnap(1, 1, [B_START]); // v1: B
    const scope = { userId: 10, userRole: "engineer" } as never;
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [2] } }, scope)).toBe(true);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [1] } }, scope)).toBe(false);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [1, 2] } }, scope)).toBe(false);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: { __foeDefVersions: [2, 1] } }, scope)).toBe(false);
    expect(await runVisibleTo({ workflowId: 1, paramsJson: null }, scope)).toBe(true); // legacy ⇒ head (A)
  });

  it("★ listVisibleRuns fills a page of VISIBLE runs (newest first) from growing reads; unrestricted reads one page", async () => {
    seedWf(1, 1, [A_START]); // visible
    seedWf(2, 1, [B_START]); // not visible
    const runs: Row[] = [];
    for (let i = 1; i <= 300; i++) runs.push({ id: i, workflowId: i % 10 === 0 ? 1 : 2, status: "completed", paramsJson: { __foeDefVersions: [1] }, createdAt: new Date(1_700_000_000_000 + i * 1000) });
    fake.store.set("orchestration_runs", runs);
    const got = await listVisibleRuns({ limit: 5 }, { userId: 10, userRole: "engineer" } as never);
    expect(got.map((r) => r.id)).toEqual([300, 290, 280, 270, 260]);
    // sparse: only every 100th run is visible ⇒ the first read (50 rows) holds 1 ⇒ the reads grow until the page is full
    fake.store.set("orchestration_runs", runs.map((r) => ({ ...r, workflowId: r.id % 100 === 0 ? 1 : 2 })));
    expect((await listVisibleRuns({ limit: 3 }, { userId: 10, userRole: "engineer" } as never)).map((r) => r.id)).toEqual([300, 200, 100]);
    const one = await listVisibleRuns({ limit: 3, workflowId: 2 }, { userId: 10, userRole: "engineer" } as never);
    expect(one).toEqual([]);
    judge.mode = "admin";
    expect((await listVisibleRuns({ limit: 4 }, null)).map((r) => r.id)).toEqual([300, 299, 298, 297]);
  });
});
