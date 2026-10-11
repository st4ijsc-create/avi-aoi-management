/**
 * doc 81 Đợt 9 task T fix 1 — ruling R-9-b: the approver's screen (getRun) may re-show a recent controller reading from a
 * DISPLAY-ONLY cache, labelled as such; every approval-recording, approval-consuming and dispatch check reads FRESH.
 * Same fixture as foeS7ProgramChecksum.dot9 (real S7Driver against the in-process S7comm simulator, 127.0.0.1 port 0).
 * Oracle: the simulator's count of accepted connections (one per controller read) and its program.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { otDispatchMock, robotDispatchMock, live } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async (_cmd?: unknown) => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] })),
  robotDispatchMock: vi.fn(async (_job?: unknown) => ({ ok: true, status: "simulated" as const, jobId: 7 })),
  live: { drivers: new Map<number, unknown>() },
}));
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, dispatch: otDispatchMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return { ...orig, resolveUserFoeScope: () => null };
});
vi.mock("../../ot/otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/otManager")>();
  return { ...orig, getActiveDriver: (id: number) => live.drivers.get(id) as ReturnType<typeof orig.getActiveDriver> };
});

const fake = new FakeDb();
vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const ne = (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] !== v;
  const inArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => vs.includes(row[col.name]);
  const notInArray = (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => !vs.includes(row[col.name]);
  const isNull = (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] == null;
  return { ...actual, eq: makeEq, and: makeAnd, ne, inArray, notInArray, isNull };
});
vi.mock("../../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { orchestrationRunSteps, machines, deviceAdapters, deviceTags } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, getRun, FOE_GATE_REQUIRED } from "./foeEngine";
import { foeApprovalDbRefusal } from "./foeGateApproval";
import { S7Driver } from "../../ot/drivers/s7Driver";
import { startS7commSim, type S7commSim, type SimBlock } from "../../ot/drivers/__s7commSim";
import type { WorkflowDefinition } from "./workflowModel";

type Row = Record<string, any>;
const OWNER = { id: 10, role: "engineer", name: "owner" };
const OTHER = { id: 12, role: "supervisor", name: "other" };
const T0 = new Date("2026-10-01T00:00:00Z");
const PROGRAM: SimBlock[] = [
  { type: "OB", number: 1, loadSize: 400, mc7Size: 250, checksum: 0xbeef },
  { type: "FC", number: 3, loadSize: 230, mc7Size: 150, checksum: 0x4000 },
  { type: "DB", number: 1, loadSize: 100, mc7Size: 36, checksum: 0xffff },
];

const rows = (t: string): Row[] => fake.store.get(t) ?? [];
const stepRow = (runId: number, stepId: string): Row | undefined => rows("orchestration_run_steps").find((s) => s.runId === runId && s.stepId === stepId);
const gateErr = (reason: string) => new RegExp(`^${FOE_GATE_REQUIRED}\\(${reason}\\): `);
const pendingOf = (runId: number) => ({ userId: OTHER.id, previewJson: { __foeGateApproval: { runId } } });

let sim: S7commSim;
let driver: S7Driver;

beforeAll(async () => {
  sim = await startS7commSim({ program: PROGRAM, rack: 0, slot: 1 });
});
afterAll(async () => {
  await sim.close();
});
// a fresh driver per test: no reading of an earlier test (single-flight / the approver-screen display cache) carries over
afterEach(async () => {
  await driver?.disconnect();
});

beforeEach(async () => {
  driver = new S7Driver();
  await driver.connect({ endpoint: `127.0.0.1:${sim.port}`, options: { rack: 0, slot: 1 }, timeoutMs: 2000 });
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [{ id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 }]);
  fake.seed(deviceAdapters, [
    { id: 601, code: "S7-PLC", name: "s7 plc", machineId: 1, protocol: "s7", connectionOptions: { rack: 0, slot: 1, programChecksum: "blockInfo" }, isEnabled: true, updatedAt: T0 },
  ]);
  fake.seed(deviceTags, [{ id: 81, adapterId: 601, tagKey: "run", address: "M0.0", dataType: "bool", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true }]);
  sim.setProgram(PROGRAM);
  sim.setFault(null);
  live.drivers.clear();
  live.drivers.set(601, driver);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

const twoGates = (ref: string, ...cmds: WorkflowDefinition["steps"]): WorkflowDefinition => ({
  ref,
  name: ref,
  steps: [{ id: "g1", type: "hitl_gate", prompt: "1" }, { id: "g2", type: "hitl_gate", prompt: "2" }, ...cmds],
});
const OT_W = { id: "w", type: "command", machineId: 1, command: "start", args: { tagKey: "run", value: 1 } } as const;
const OT_STOP = { id: "s", type: "command", machineId: 1, command: "stop", args: { tagKey: "run", value: 0 } } as const;

async function scenario(def: WorkflowDefinition, change: () => void | Promise<void>) {
  expect((await deployWorkflow(def, OWNER)).ok).toBe(true);
  const started = await startRun(def.ref, {}, OWNER);
  expect((await resumeRun(started.runId!, { approved: true }, OTHER)).status).toBe("awaiting_confirm");
  await change();
  const t0 = Date.now();
  const res = await resumeRun(started.runId!, { approved: true }, OWNER);
  return { runId: started.runId!, status: res.status, ms: Date.now() - t0 };
}

describe("T fix 1 / R-9-b — display-only cache on the approver's screen", () => {
  it("★ a second screen poll within the cache window shows the earlier reading, labelled — without reading the controller", async () => {
    const def = twoGates("dc-1", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("dc-1", {}, OWNER);
    const first = await getRun(started.runId!, { bindingDigest: true });
    expect(first!.programChecks![0]!.displayCache).toBeUndefined(); // a fresh reading
    const n = sim.stats().accepted;
    const second = await getRun(started.runId!, { bindingDigest: true });
    expect(sim.stats().accepted).toBe(n); // no controller read
    expect(second!.programChecks![0]).toMatchObject({ status: "verified", checksum: first!.programChecks![0]!.checksum, displayCache: { readAt: expect.any(String) } });
    expect(second!.bindingDigest).toBe(first!.bindingDigest);
  });

  it("★ the program changes while the screen shows a cached reading ⇒ approving reads FRESH ⇒ CONFLICT; the dispatcher check reads fresh ⇒ refused", async () => {
    const def = twoGates("dc-2", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("dc-2", {}, OWNER);
    await getRun(started.runId!, { bindingDigest: true });
    sim.patchBlock("FC", 3, { checksum: 0x4001 });
    const cached = await getRun(started.runId!, { bindingDigest: true }); // still the old reading (display only)
    expect(cached!.programChecks![0]!.displayCache).toBeDefined();
    const n = sim.stats().accepted;
    await expect(
      resumeRun(started.runId!, { approved: true, expectedDefHash: cached!.defHash!, expectedBindingDigest: cached!.bindingDigest! }, OTHER),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(sim.stats().accepted).toBeGreaterThan(n); // the approval read the controller
    expect(stepRow(started.runId!, "g1")?.status).not.toBe("completed");
    // an approval given now (fresh) records the fresh checksum; the dispatcher layer reads fresh too
    await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(stepRow(started.runId!, "g1")!.resultJson.programChecks[0].checksum).not.toBe(cached!.programChecks![0]!.checksum);
    const m = sim.stats().accepted;
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toBeNull();
    expect(sim.stats().accepted).toBe(m + 1);
    sim.setProgram(PROGRAM);
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toMatch(/staleApproval/);
  });

  it("★ the engine's non-STOP step never uses the display cache: a change after the screen's cached reading is caught (staleApproval)", async () => {
    const def = twoGates("dc-3", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("dc-3", {}, OWNER);
    await getRun(started.runId!, { bindingDigest: true });
    expect((await resumeRun(started.runId!, { approved: true }, OTHER)).status).toBe("awaiting_confirm");
    sim.patchBlock("DB", 1, { mc7Size: 37 });
    await getRun(started.runId!, { bindingDigest: true }); // the screen polls (may be cached)
    const res = await resumeRun(started.runId!, { approved: true }, OWNER);
    expect(res.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(started.runId!, "w")!.error)).toMatch(gateErr("staleApproval"));
  });
});
