/**
 * doc 81 Đợt 9 task T2 — a Siemens S7 controller's PROGRAM is covered by the approval: change a block in the controller
 * ⇒ its program checksum changes ⇒ the approval goes stale (engine + the dispatchers' shared DB-layer check).
 *
 * Device = the REAL S7Driver (nodes7 session + the block-function checksum reader) connected to the in-process S7comm
 * simulator (drivers/__s7commSim.ts, 127.0.0.1 port 0, closed in afterAll). Never a real device or shared service.
 * Oracles: the simulator's own program (patchBlock = what a vendor tool downloading a modified block does), the dispatch
 * mocks' call counts, and the simulator's count of block-function requests (did a STOP step read a checksum — L-7).
 *
 * Sequence (as in foeProgramChecksum.dot8): [g1, g2, cmd] — OTHER approves g1 (the counting approval, digest + program
 * checks recorded), the world changes, OWNER approves g2 (never counts; it only lets the walk reach the command).
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

describe("T2 — S7 program checksum in the approval (simulated S7comm controller)", () => {
  it("★ the approver's screen lists the S7 adapter as verified with the S7 checksum and source 's7-blockinfo'; the approval records it", async () => {
    const def = twoGates("t2-rec", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("t2-rec", {}, OWNER);
    const view = await getRun(started.runId!, { bindingDigest: true });
    expect(view!.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(view!.programChecks).toEqual([
      { target: "adapter", id: 601, label: "S7-PLC", status: "verified", checksum: expect.stringMatching(/^s7:sha256:[0-9a-f]{64}$/), source: "s7-blockinfo" },
    ]);
    await resumeRun(started.runId!, { approved: true, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, OTHER);
    const g1 = stepRow(started.runId!, "g1")!.resultJson;
    expect(g1.bindingDigest).toBe(view!.bindingDigest);
    expect(g1.programChecks).toEqual([{ target: "adapter", id: 601, status: "verified", checksum: view!.programChecks![0]!.checksum }]);
  });

  it("control: no block changed ⇒ the OT command is sent once", async () => {
    const r = await scenario(twoGates("t2-c0", OT_W), () => undefined);
    expect(r.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ a block CHANGED in the controller after the approval ⇒ engine: NOT sent (staleApproval)", async () => {
    const r = await scenario(twoGates("t2-chg", OT_W), () => sim.patchBlock("FC", 3, { checksum: 0x4001 }));
    expect(r.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(String(stepRow(r.runId, "w")!.error)).toMatch(gateErr("staleApproval"));
  });

  it("★ dispatcher DB layer (used by both dispatchers): block changed ⇒ refused (staleApproval); restored ⇒ accepted again", async () => {
    const def = twoGates("t2-dbl", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("t2-dbl", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toBeNull();
    sim.patchBlock("DB", 1, { loadSize: 104 });
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toMatch(/staleApproval/);
    sim.setProgram(PROGRAM);
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toBeNull();
  });

  it("★ a block changed between loading the approver's screen and approving ⇒ CONFLICT (nothing recorded)", async () => {
    const def = twoGates("t2-race", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("t2-race", {}, OWNER);
    const view = await getRun(started.runId!, { bindingDigest: true });
    sim.patchBlock("OB", 1, { mc7Size: 251 });
    await expect(
      resumeRun(started.runId!, { approved: true, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, OTHER),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(stepRow(started.runId!, "g1")?.status).not.toBe("completed");
  });

  for (const [what, breakIt] of [
    ["the controller refuses block functions", () => sim.setFault("refuse")],
    ["the controller does not answer (hang)", () => sim.setFault("hang")],
  ] as const) {
    it(`★ FAIL CLOSED: ${what} after the approval ⇒ engine refuses (programUnreadable), dispatcher layer refuses — bounded`, async () => {
      const r = await scenario(twoGates(`t2-rf-${what.length}`, OT_W), breakIt);
      expect(r.status).toBe("failed");
      expect(otDispatchMock).not.toHaveBeenCalled();
      expect(String(stepRow(r.runId, "w")!.error)).toMatch(gateErr("programUnreadable"));
      expect(r.ms).toBeLessThan(5_000);
      const t0 = Date.now();
      expect(await foeApprovalDbRefusal(fake as never, pendingOf(r.runId), OWNER.id)).toMatch(/programUnreadable/);
      expect(Date.now() - t0).toBeLessThan(3_000);
    });
  }

  it("★ an unreadable S7 checksum while the approver's screen loads ⇒ no digest (cannot approve), shown 'unreadable' with source 's7'", async () => {
    const def = twoGates("t2-scr", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("t2-scr", {}, OWNER);
    sim.setFault("refuse");
    const view = await getRun(started.runId!, { bindingDigest: true });
    expect(view!.bindingDigest).toBeNull();
    expect(view!.programChecks).toEqual([expect.objectContaining({ target: "adapter", id: 601, status: "unreadable", reason: "error", source: "s7" })]);
  });

  it("★ L-7: an OT STOP step never reads the S7 checksum — controller hanging after the approval ⇒ STOP still sent, ZERO block requests during the step", async () => {
    const def = twoGates("t2-stp", OT_STOP);
    await deployWorkflow(def, OWNER);
    const started = await startRun("t2-stp", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    sim.setFault("hang");
    const before = sim.stats().blockRequests;
    const res = await resumeRun(started.runId!, { approved: true }, OWNER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    // exactly ONE block-function request during this resume: recording g2's approval starts a read (list blocks) that
    // hangs and is cancelled at its deadline — none for the STOP step itself.
    expect(sim.stats().blockRequests - before).toBe(1);
    const sent = otDispatchMock.mock.calls[0]![0] as { triggeredBy?: { confirmedBy?: number } };
    expect(sent.triggeredBy?.confirmedBy).toBe(OTHER.id);
  });
});
