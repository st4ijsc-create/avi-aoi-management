/**
 * doc 81 Đợt 5 task E3 (item 25) — a gate approval is bound to the DEVICE CONFIGURATION its run's commands resolve to,
 * not only to the definition JSON (R-4-e). The binding digest (foeGateApproval.computeBindingDigest) is computed on the
 * server at approval, stored in the gate's resultJson, and recomputed by BOTH checks — the engine
 * (findSeparateGateApproval) and the dispatchers' DB layer (foeApprovalDbRefusal). Any change to the resolved adapter,
 * a tag the step writes, or the robot row ⇒ staleApproval. Runtime noise (robot status / updatedAt) is not configuration.
 * Residual (documented): a program stored inside a robot controller / PLC is invisible to the server.
 *
 * Sequence used: [g1, g2, cmd] — another user approves g1 (the counting approval, digest stored), the configuration is
 * changed, then the owner approves g2 (never counts; it only lets the walk reach the command).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { otDispatchMock, robotDispatchMock } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async (_cmd?: unknown) => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] })),
  robotDispatchMock: vi.fn(async (_job?: unknown) => ({ ok: true, status: "simulated" as const, jobId: 7 })),
}));
vi.mock("../../ot/commandDispatcher", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../ot/commandDispatcher")>();
  return { isStopCommandType: orig.isStopCommandType, dispatch: otDispatchMock };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
// E2 scope is measured in orchestrationScope.dot5.db.test.ts; here every principal is unrestricted.
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return { ...orig, resolveUserFoeScope: () => null };
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
import { deployWorkflow, startRun, resumeRun, FOE_GATE_REQUIRED } from "./foeEngine";
import { computeBindingDigest, foeApprovalDbRefusal } from "./foeGateApproval";
import type { WorkflowDefinition } from "./workflowModel";

type Row = Record<string, any>;
const OWNER = { id: 10, role: "engineer", name: "owner" };
const OTHER = { id: 12, role: "supervisor", name: "other" };
const T0 = new Date("2026-10-01T00:00:00Z");
const T1 = new Date("2026-10-02T00:00:00Z");

const rows = (t: string): Row[] => fake.store.get(t) ?? [];
const stepRow = (runId: number, stepId: string): Row | undefined => rows("orchestration_run_steps").find((s) => s.runId === runId && s.stepId === stepId);
const gateErr = (reason: string) => new RegExp(`^${FOE_GATE_REQUIRED}\\(${reason}\\): `);

beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [
    { id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 },
    { id: 2, machineType: "ROBOT", capabilities: null, code: "R1", name: "Robot-1", operationStatus: "stopped", stationId: 1 },
  ]);
  fake.seed(deviceAdapters, [
    { id: 501, machineId: 1, isEnabled: true, updatedAt: T0 },
    { id: 502, machineId: 1, isEnabled: false, updatedAt: T0 },
    { id: 601, machineId: 9, isEnabled: true, updatedAt: T0 }, // unrelated machine
  ]);
  fake.seed(deviceTags, [
    { id: 71, adapterId: 501, tagKey: "run", address: "40001", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
    { id: 72, adapterId: 502, tagKey: "run", address: "40009", dataType: "int16", scale: "1", offset: "0", updatedAt: T0, writable: true, isEnabled: true },
  ]);
  fake.seed(robots, [{ id: 2, code: "R2", vendor: "sim", endpoint: "tcp://10.0.0.2:1", connectionOptions: { port: 1 }, isEnabled: true, status: "online", updatedAt: T0 }]);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.SEC_PLATFORM;
});

const twoGates = (ref: string, cmd: WorkflowDefinition["steps"][number]): WorkflowDefinition => ({
  ref,
  name: ref,
  steps: [{ id: "g1", type: "hitl_gate", prompt: "1" }, { id: "g2", type: "hitl_gate", prompt: "2" }, cmd],
});
const OT_W = { id: "w", type: "command", machineId: 1, command: "start", args: { tagKey: "run", value: 1 } } as const;
const RB_M = { id: "m", type: "command", machineId: 2, command: "start", args: { robotId: 2 } } as const;

/** start → OTHER approves g1 → `change()` → OWNER approves g2. Returns the run id + final status. */
async function scenario(def: WorkflowDefinition, change: () => void) {
  expect((await deployWorkflow(def, OWNER)).ok).toBe(true);
  const started = await startRun(def.ref, {}, OWNER);
  expect((await resumeRun(started.runId!, { approved: true }, OTHER)).status).toBe("awaiting_confirm");
  change();
  const res = await resumeRun(started.runId!, { approved: true }, OWNER);
  return { runId: started.runId!, status: res.status };
}

describe("doc 81 Đợt 5 task E3 — gate approval bound to the device configuration (binding digest)", () => {
  it("★ the digest is stored at approval, computed by the SERVER (a caller-supplied value is ignored)", async () => {
    await deployWorkflow(twoGates("st", OT_W), OWNER);
    const started = await startRun("st", {}, OWNER);
    await resumeRun(started.runId!, { approved: true, bindingDigest: "f".repeat(64) } as never, OTHER);
    const g1 = stepRow(started.runId!, "g1")!.resultJson;
    expect(g1.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(g1.bindingDigest).toBe(await computeBindingDigest(fake as never, twoGates("st", OT_W)));
    expect(g1.bindingDigest).not.toBe("f".repeat(64));
  });

  it("control: nothing changed ⇒ the OT command is sent once", async () => {
    const r = await scenario(twoGates("c0", OT_W), () => undefined);
    expect(r.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  for (const [what, change] of [
    ["the resolved adapter row changed (updatedAt)", () => (rows("device_adapters").find((a) => a.id === 501)!.updatedAt = T1)],
    ["the written tag was re-mapped (address)", () => (rows("device_tags").find((t) => t.id === 71)!.address = "40002")],
    ["the written tag's scale changed", () => (rows("device_tags").find((t) => t.id === 71)!.scale = "10")],
    ["the written tag's dataType changed", () => (rows("device_tags").find((t) => t.id === 71)!.dataType = "float")],
    ["the written tag was deleted", () => fake.store.set("device_tags", rows("device_tags").filter((t) => t.id !== 71))],
    [
      "a different adapter now resolves (501 disabled, 502 enabled)",
      () => {
        rows("device_adapters").find((a) => a.id === 501)!.isEnabled = false;
        rows("device_adapters").find((a) => a.id === 502)!.isEnabled = true;
      },
    ],
  ] as const) {
    it(`★ OT: ${what} after the approval ⇒ NOT sent (staleApproval), no authorisation row`, async () => {
      const r = await scenario(twoGates(`ot-${what.length}`, OT_W), change);
      expect(r.status).toBe("failed");
      expect(otDispatchMock).not.toHaveBeenCalled();
      expect(rows("ai_pending_actions")).toHaveLength(0);
      expect(String(stepRow(r.runId, "w")!.error)).toMatch(gateErr("staleApproval"));
      expect(String(stepRow(r.runId, "w")!.error)).toContain("configuration");
    });
  }

  it("an UNRELATED adapter changed (not the one this run writes through) ⇒ still sent", async () => {
    const r = await scenario(twoGates("unrel", OT_W), () => (rows("device_adapters").find((a) => a.id === 601)!.updatedAt = T1));
    expect(r.status).toBe("completed");
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  for (const [what, change] of [
    ["connectionOptions changed", () => (rows("robots")[0].connectionOptions = { port: 2 })],
    ["vendor changed", () => (rows("robots")[0].vendor = "ur")],
    ["endpoint re-pointed", () => (rows("robots")[0].endpoint = "tcp://10.0.0.99:1")],
  ] as const) {
    it(`★ robot motion: ${what} after the approval ⇒ NOT sent (staleApproval)`, async () => {
      const r = await scenario(twoGates(`rb-${what.length}`, RB_M), change);
      expect(r.status).toBe("failed");
      expect(robotDispatchMock).not.toHaveBeenCalled();
      expect(String(stepRow(r.runId, "m")!.error)).toMatch(gateErr("staleApproval"));
    });
  }

  it("robot runtime noise (status / updatedAt bumped by a connection change) is NOT configuration ⇒ still sent", async () => {
    const r = await scenario(twoGates("rbnoise", RB_M), () => Object.assign(rows("robots")[0], { status: "offline", updatedAt: T1, lastSeenAt: T1 }));
    expect(r.status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("L-7: a robot abort after a robot configuration change still goes out (a STOP never needs the approval)", async () => {
    const r = await scenario(twoGates("rbab", { id: "ab", type: "command", machineId: 2, command: "abort", args: { robotId: 2 } }), () => (rows("robots")[0].connectionOptions = { port: 3 }));
    expect(r.status).toBe("completed");
    expect(robotDispatchMock).toHaveBeenCalledTimes(1);
  });

  it("★ dispatcher DB layer recomputes the digest: configuration changed since the approval ⇒ refused (staleApproval); unchanged ⇒ accepted", async () => {
    const def = twoGates("dbl", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("dbl", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER); // g1 approved by OTHER, digest stored
    const pending = { userId: OTHER.id, previewJson: { __foeGateApproval: { runId: started.runId } } };
    expect(await foeApprovalDbRefusal(fake as never, pending, OWNER.id)).toBeNull();
    rows("device_tags").find((t) => t.id === 71)!.address = "49999";
    expect(await foeApprovalDbRefusal(fake as never, pending, OWNER.id)).toMatch(/staleApproval/);
  });

  it("an approval recorded WITHOUT a digest (before E3) or a digest that cannot be computed never counts", async () => {
    const def = twoGates("nod", OT_W);
    await deployWorkflow(def, OWNER);
    const started = await startRun("nod", {}, OWNER);
    await resumeRun(started.runId!, { approved: true }, OTHER);
    const pending = { userId: OTHER.id, previewJson: { __foeGateApproval: { runId: started.runId } } };
    delete stepRow(started.runId!, "g1")!.resultJson.bindingDigest;
    expect(await foeApprovalDbRefusal(fake as never, pending, OWNER.id)).toMatch(/staleApproval/);
    expect(await computeBindingDigest({ select: () => { throw new Error("db down"); } }, def)).toBeNull();
  });
});
