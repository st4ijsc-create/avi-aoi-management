/**
 * doc 81 Đợt 8 tasks O2 + O4 — the approval binding digest (Đợt 5 E3, Đợt 7 I2) includes the PROGRAM CHECKSUM of every
 * OT adapter a run's commands write through, when that adapter's controller supports it (programChecksum.ts).
 *
 * Device = the REAL simulation driver (StubDriver with a simulated program), returned by getActiveDriver for adapter 501.
 * Oracles: the driver's own simLoadProgram / simSetProgramReadFault (what a vendor tool / a broken link would do), the
 * dispatch mocks' call counts (was anything sent), and a spy counting checksum reads (did a STOP wait on one).
 *
 * Sequence (as in foeBindingDigest.dot5): [g1, g2, cmd] — OTHER approves g1 (the counting approval: digest + program checks
 * recorded), the world changes, OWNER approves g2 (never counts; it only lets the walk reach the command).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
// The live OT driver registry: adapter id → the in-process simulation driver of this test (no socket, no port).
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

import { orchestrationRunSteps, machines, deviceAdapters, deviceTags, robots } from "../../../../drizzle/schema";
import { deployWorkflow, startRun, resumeRun, getRun, FOE_GATE_REQUIRED } from "./foeEngine";
import { computeBindingDigest, foeApprovalDbRefusal } from "./foeGateApproval";
import { StubDriver } from "../../ot/drivers/stubDriver";
import type { WorkflowDefinition } from "./workflowModel";

type Row = Record<string, any>;
const OWNER = { id: 10, role: "engineer", name: "owner" };
const OTHER = { id: 12, role: "supervisor", name: "other" };
const T0 = new Date("2026-10-01T00:00:00Z");
const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"; // FIPS 180-2 B.1 — program "abc"

const rows = (t: string): Row[] => fake.store.get(t) ?? [];
const stepRow = (runId: number, stepId: string): Row | undefined => rows("orchestration_run_steps").find((s) => s.runId === runId && s.stepId === stepId);
const gateErr = (reason: string) => new RegExp(`^${FOE_GATE_REQUIRED}\\(${reason}\\): `);

let sim: StubDriver;
let reads = 0;

beforeEach(async () => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
    { id: 3, machineType: "AUTOMATION", capabilities: null, code: "M3", name: "Auto-3", operationStatus: "stopped", stationId: 1 },
  ]);
  fake.seed(deviceAdapters, [
    { id: 501, code: "SIM-PLC", name: "sim plc", machineId: 1, protocol: "stub", connectionOptions: { simProgram: "abc" }, isEnabled: true, updatedAt: T0 },
    { id: 701, code: "MB-PLC", name: "modbus plc", machineId: 3, protocol: "modbus", connectionOptions: {}, isEnabled: true, updatedAt: T0 },
  ]);
  fake.seed(deviceTags, [
    { id: 71, adapterId: 501, tagKey: "run", address: "40001", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
    { id: 72, adapterId: 701, tagKey: "run", address: "40001", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
  ]);
  fake.seed(robots, [{ id: 2, code: "R2", vendor: "sim", endpoint: "tcp://10.0.0.2:1", connectionOptions: { port: 1 }, isEnabled: true, status: "online", updatedAt: T0 }]);
  sim = new StubDriver();
  await sim.connect({ endpoint: "stub://o", options: { simProgram: "abc" } });
  reads = 0;
  const real = sim.readProgramChecksum.bind(sim);
  sim.readProgramChecksum = () => {
    reads++;
    return real();
  };
  live.drivers.clear();
  live.drivers.set(501, sim);
  // adapter 701 (modbus) is live too — it is never asked: unsupported is decided from its row.
  live.drivers.set(701, { isConnected: () => true, readProgramChecksum: () => { throw new Error("must not be called"); } });
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
const MB_W = { id: "mb", type: "command", machineId: 3, command: "start", args: { tagKey: "run", value: 1 } } as const;
const RB_M = { id: "m", type: "command", machineId: 2, command: "start", args: { robotId: 2 } } as const;

/** start → OTHER approves g1 → `change()` → OWNER approves g2. */
async function scenario(def: WorkflowDefinition, change: () => void | Promise<void>) {
  expect((await deployWorkflow(def, OWNER)).ok).toBe(true);
  const started = await startRun(def.ref, {}, OWNER);
  expect((await resumeRun(started.runId!, { approved: true }, OTHER)).status).toBe("awaiting_confirm");
  await change();
  const t0 = Date.now();
  const res = await resumeRun(started.runId!, { approved: true }, OWNER);
  return { runId: started.runId!, status: res.status, ms: Date.now() - t0 };
}
const pendingOf = (runId: number) => ({ userId: OTHER.id, previewJson: { __foeGateApproval: { runId } } });

describe("O2 — the binding digest includes the controller program checksum (sim driver)", () => {
  it("★ the approval records the program checks (verified + checksum) and the digest depends on the program", async () => {
    const def = twoGates("rec", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("rec", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    const g1 = stepRow(started.runId!, "g1")!.resultJson;
    expect(g1.programChecks).toEqual([{ target: "adapter", id: 501, status: "verified", checksum: `sha256:${SHA256_ABC}` }]);
    const before = await computeBindingDigest(fake as never, def);
    expect(g1.bindingDigest).toBe(before);
    sim.simLoadProgram("abd");
    const after = await computeBindingDigest(fake as never, def);
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
  });

  it("control: program unchanged ⇒ the OT command is sent once", async () => {
    const r = await scenario(twoGates("c0", OT_W), () => undefined);
    expect(r.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ O4: the controller program is CHANGED after the approval ⇒ engine: NOT sent (staleApproval), no authorisation row", async () => {
    const r = await scenario(twoGates("chg", OT_W), () => sim.simLoadProgram("abc // edited on the controller"));
    expect(r.status).toBe("failed");
    expect(otDispatchMock).not.toHaveBeenCalled();
    expect(rows("ai_pending_actions")).toHaveLength(0);
    expect(String(stepRow(r.runId, "w")!.error)).toMatch(gateErr("staleApproval"));
    expect(String(stepRow(r.runId, "w")!.error)).toMatch(/program/i);
  });

  it("★ O4: dispatcher DB layer (both dispatchers): program changed since the approval ⇒ refused (staleApproval); unchanged ⇒ accepted", async () => {
    const def = twoGates("dbl", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("dbl", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toBeNull();
    sim.simLoadProgram("other program");
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toMatch(/staleApproval/);
    sim.simLoadProgram("abc"); // the approved program again ⇒ the approval covers it again
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toBeNull();
  });

  it("★ the robot dispatcher's DB layer checks the PLC program of the same run too (one digest per run)", async () => {
    const def = twoGates("rbdbl", OT_W, RB_M);
    await deployWorkflow(def, OWNER);
    const started = await startRun("rbdbl", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    // pending = the robot step's action (same run pointer) — the dispatcher re-derives everything from the run.
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toBeNull();
    sim.simLoadProgram("x");
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toMatch(/staleApproval/);
  });

  for (const [what, breakIt] of [
    ["the read fails (error)", () => sim.simSetProgramReadFault("error")],
    ["the controller does not answer (hang)", () => sim.simSetProgramReadFault("hang")],
    ["the adapter is disconnected", () => live.drivers.delete(501)],
  ] as const) {
    it(`★ O4 FAIL CLOSED: ${what} after the approval ⇒ engine refuses (programUnreadable), dispatcher layer refuses — bounded`, async () => {
      const r = await scenario(twoGates(`rf-${what.length}`, OT_W), breakIt);
      expect(r.status).toBe("failed");
      expect(otDispatchMock).not.toHaveBeenCalled();
      expect(String(stepRow(r.runId, "w")!.error)).toMatch(gateErr("programUnreadable"));
      expect(r.ms).toBeLessThan(5_000); // g2 recording read + the step's read, each ≤ 1000 ms
      const t0 = Date.now();
      expect(await foeApprovalDbRefusal(fake as never, pendingOf(r.runId), OWNER.id)).toMatch(/programUnreadable/);
      expect(Date.now() - t0).toBeLessThan(3_000);
    });
  }

  it("★ O4: a read failure on a supported adapter while the approver's screen loads ⇒ no digest (cannot approve) + the adapter shown unreadable; approve ⇒ CONFLICT bindingChanged", async () => {
    const def = twoGates("scr", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("scr", {}, OWNER);
    sim.simSetProgramReadFault("error");
    const view = await getRun(started.runId!, { bindingDigest: true });
    expect(view!.bindingDigest).toBeNull();
    expect(view!.programChecks).toEqual([expect.objectContaining({ target: "adapter", id: 501, status: "unreadable", reason: "error" })]);
    await expect(
      resumeRun(started.runId!, { approved: true, expectedDefHash: view!.defHash!, expectedBindingDigest: "0".repeat(64) }, OTHER),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(stepRow(started.runId!, "g1")?.status).not.toBe("completed");
    // an internal approval (no screen) is recorded with a null digest ⇒ it never counts
    await resumeRun(started.runId!, { approved: true }, OTHER);
    expect(stepRow(started.runId!, "g1")!.resultJson.bindingDigest).toBeNull();
    sim.simSetProgramReadFault(null);
    expect(await foeApprovalDbRefusal(fake as never, pendingOf(started.runId!), OWNER.id)).toMatch(/staleApproval/);
  });

  it("★ O3 data: the approver's screen gets one entry per adapter / robot: verified (checksum) · unsupported — and the screen-bound approval works", async () => {
    const def = twoGates("lst", OT_W, MB_W, RB_M);
    await deployWorkflow(def, OWNER);
    const started = await startRun("lst", {}, OWNER);
    const view = await getRun(started.runId!, { bindingDigest: true });
    expect(view!.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(view!.programChecks).toEqual([
      { target: "adapter", id: 501, label: "SIM-PLC", status: "verified", checksum: `sha256:${SHA256_ABC}`, source: "sim" },
      { target: "adapter", id: 701, label: "MB-PLC", status: "unsupported", source: "modbus" },
      { target: "robot", id: 2, label: "R2", status: "unsupported", source: "robot" },
    ]);
    await resumeRun(started.runId!, { approved: true, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, OTHER);
    expect(stepRow(started.runId!, "g1")!.resultJson.bindingDigest).toBe(view!.bindingDigest);
    expect(stepRow(started.runId!, "g1")!.resultJson.programChecks).toEqual([
      { target: "adapter", id: 501, status: "verified", checksum: `sha256:${SHA256_ABC}` },
      { target: "adapter", id: 701, status: "unsupported" },
      { target: "robot", id: 2, status: "unsupported" },
    ]);
  });

  it("★ a program change between screen load and approval ⇒ CONFLICT bindingChanged (nothing recorded)", async () => {
    const def = twoGates("race", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("race", {}, OWNER);
    const view = await getRun(started.runId!, { bindingDigest: true });
    sim.simLoadProgram("changed");
    await expect(
      resumeRun(started.runId!, { approved: true, expectedDefHash: view!.defHash!, expectedBindingDigest: view!.bindingDigest! }, OTHER),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(stepRow(started.runId!, "g1")?.status).not.toBe("completed");
  });

  it("★ O4: an UNSUPPORTED adapter (modbus) ⇒ recorded 'unsupported', never read, and the command is allowed (sent)", async () => {
    const r = await scenario(twoGates("mb", MB_W), () => undefined);
    expect(r.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    expect(stepRow(r.runId, "g1")!.resultJson.programChecks).toEqual([{ target: "adapter", id: 701, status: "unsupported" }]);
  });

  it("an unsupported adapter's digest is unchanged by O2 (approvals given before O2 on such adapters still count)", async () => {
    // Pinned value: computed at HEAD before O2 for exactly this definition + rows (configuration only).
    const def = twoGates("pin", MB_W);
    const d = await computeBindingDigest(fake as never, def);
    const sim2 = await computeBindingDigest(fake as never, def); // deterministic
    expect(d).toBe(sim2);
    expect(d).toBe(PRE_O2_MB_DIGEST);
  });

  it("★ L-7: an OT STOP step never waits on a checksum read — controller hanging after the approval ⇒ STOP still sent, by the approver's row, with ZERO reads during the step", async () => {
    const def = twoGates("stp", OT_STOP);
    await deployWorkflow(def, OWNER);
    const started = await startRun("stp", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    sim.simSetProgramReadFault("hang");
    const before = reads;
    const res = await resumeRun(started.runId!, { approved: true }, OWNER);
    expect(res.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
    // exactly ONE read during this resume: recording g2's approval — none for the STOP step itself.
    expect(reads - before).toBe(1);
    const sent = otDispatchMock.mock.calls[0]![0] as { triggeredBy?: { confirmedBy?: number } };
    expect(sent.triggeredBy?.confirmedBy).toBe(OTHER.id); // the counting approval was still found (from the recorded checks)
  });

  it("L-7: an OT STOP after the program CHANGED is still sent by the engine (it never refuses a STOP; an UNPINNED stop is re-checked by the OT dispatcher)", async () => {
    const r = await scenario(twoGates("stpchg", OT_STOP), () => sim.simLoadProgram("changed"));
    expect(r.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });
});

// The digest of twoGates("pin", MB_W) over the rows above, computed by computeBindingDigest at HEAD 0a3c76dcc (before O2).
const PRE_O2_MB_DIGEST = "2f38afe86d7ef92ed3df9ea9bbe53124dfa4867b0c2c3afdb7b527b753c39668";
