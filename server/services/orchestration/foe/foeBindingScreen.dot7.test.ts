/**
 * doc 81 Đợt 7 task I2 — the APPROVER'S SCREEN is bound to the binding digest, like the definition hash (R-4-k):
 * getRun() returns `bindingDigest` (computeBindingDigest of the device configuration the run's commands resolve to, server
 * side); an approval of an open gate carries it back as `expectedBindingDigest`. The configuration changed since the screen
 * loaded (or the digest cannot be computed now, or a screen-bound approval omits it) ⇒ CONFLICT reason `bindingChanged`
 * ("configuration changed — reload") BEFORE any state change; the approval records exactly the digest that was checked.
 * Internal callers (no screen: QT pump, auto-resume) are unchanged; a 'held' (interrupted) continue has no gate to bind.
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
import { deployWorkflow, startRun, resumeRun, getRun } from "./foeEngine";
import { computeBindingDigest } from "./foeGateApproval";
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

const GATED = (ref: string): WorkflowDefinition => ({ ref, name: ref, steps: [{ id: "g1", type: "hitl_gate", prompt: "1" }, { id: "w", type: "command", machineId: 1, command: "start", args: { tagKey: "run", value: 1 } }] as never });
const conflictReason = (e: unknown) => (e as { cause?: { appParams?: { reason?: string } } })?.cause?.appParams?.reason;

async function pausedRun(ref: string) {
  expect((await deployWorkflow(GATED(ref), OWNER)).ok).toBe(true);
  const s = await startRun(ref, {}, OWNER);
  expect(s.status).toBe("awaiting_confirm");
  return s.runId!;
}

describe("doc 81 Đợt 7 I2 — the approver's screen is bound to the binding digest", () => {
  it("★ getRun returns the binding digest the server computes for the run's definition NOW", async () => {
    const runId = await pausedRun("view");
    const view = await getRun(runId);
    expect(view?.bindingDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(view?.bindingDigest).toBe(await computeBindingDigest(fake as never, GATED("view")));
  });

  it("★ match ⇒ approved; the gate records EXACTLY the digest the screen saw", async () => {
    const runId = await pausedRun("match");
    const view = (await getRun(runId))!;
    const r = await resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER);
    expect(r.status).toBe("completed");
    expect(stepRow(runId, "g1")!.resultJson).toMatchObject({ approved: true, approvedBy: OTHER.id, bindingDigest: view.bindingDigest });
    expect(otDispatchMock).toHaveBeenCalledTimes(1);
  });

  for (const [what, change] of [
    ["the written tag was re-mapped", () => (rows("device_tags").find((t) => t.id === 71)!.address = "40002")],
    ["the resolved adapter changed", () => (rows("device_adapters").find((a) => a.id === 501)!.updatedAt = T1)],
  ] as const) {
    it(`★ ${what} after the screen loaded ⇒ CONFLICT bindingChanged, NOTHING changes (run paused, gate open, no command)`, async () => {
      const runId = await pausedRun(`chg-${what.length}`);
      const view = (await getRun(runId))!;
      change();
      const err = await resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER).catch((e) => e);
      expect(err).toMatchObject({ code: "CONFLICT" });
      expect(conflictReason(err)).toBe("bindingChanged");
      expect(String((err as Error).message)).toMatch(/configuration.*changed.*reload/i);
      expect(rows("orchestration_runs").find((x) => x.id === runId)).toMatchObject({ status: "awaiting_confirm", currentStepId: "g1" });
      expect(stepRow(runId, "g1")!.status).toBe("awaiting_confirm");
      expect(otDispatchMock).not.toHaveBeenCalled();
      // reload ⇒ the new digest is accepted
      const fresh = (await getRun(runId))!;
      expect(fresh.bindingDigest).not.toBe(view.bindingDigest);
      const ok = await resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: fresh.defHash!, expectedBindingDigest: fresh.bindingDigest! }, OTHER);
      expect(ok.status).toBe("completed");
    });
  }

  it("★ a screen-bound approval (expectedDefHash) WITHOUT expectedBindingDigest ⇒ CONFLICT bindingChanged (fail-closed)", async () => {
    const runId = await pausedRun("nodigest");
    const view = (await getRun(runId))!;
    const err = await resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash! }, OTHER).catch((e) => e);
    expect(conflictReason(err)).toBe("bindingChanged");
    expect(stepRow(runId, "g1")!.status).toBe("awaiting_confirm");
  });

  it("★ the digest cannot be computed NOW (device tables unreadable) ⇒ CONFLICT bindingChanged, nothing changes", async () => {
    const runId = await pausedRun("undecided");
    const view = (await getRun(runId))!;
    const realSelect = fake.select.bind(fake);
    (fake as any).select = (p?: Record<string, any>) => {
      const b = realSelect(p);
      const from = b.from.bind(b);
      b.from = (t: any) => {
        if (t?.[Symbol.for("drizzle:Name")] === "device_tags") throw new Error("device_tags unreadable");
        return from(t);
      };
      return b;
    };
    try {
      const err = await resumeRun(runId, { approved: true, expectedStepId: "g1", expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER).catch((e) => e);
      expect(conflictReason(err)).toBe("bindingChanged");
    } finally {
      (fake as any).select = realSelect;
    }
    expect(stepRow(runId, "g1")!.status).toBe("awaiting_confirm");
    expect(otDispatchMock).not.toHaveBeenCalled();
  });

  it("★ fix 1 (M-3): CONTINUE of a 'held' (interrupted) run is bound server side too — config changed ⇒ bindingChanged, definition changed ⇒ definitionChanged; nothing changes", async () => {
    const runId = await pausedRun("held");
    Object.assign(rows("orchestration_runs").find((x) => x.id === runId)!, { status: "held", currentStepId: null, contextJson: { interrupted: true } });
    const view = (await getRun(runId))!;
    rows("device_tags").find((t) => t.id === 71)!.address = "40077";
    const e1 = await resumeRun(runId, { approved: true, expectedStepId: null, expectedDefHash: view.defHash!, expectedBindingDigest: view.bindingDigest! }, OTHER).catch((e) => e);
    expect(conflictReason(e1)).toBe("bindingChanged");
    const view2 = (await getRun(runId))!;
    const e2 = await resumeRun(runId, { approved: true, expectedStepId: null, expectedDefHash: "0".repeat(64), expectedBindingDigest: view2.bindingDigest! }, OTHER).catch((e) => e);
    expect(conflictReason(e2)).toBe("definitionChanged");
    expect(rows("orchestration_runs").find((x) => x.id === runId)!.status).toBe("held");
    expect(otDispatchMock).not.toHaveBeenCalled();
    const ok = await resumeRun(runId, { approved: true, expectedStepId: null, expectedDefHash: view2.defHash!, expectedBindingDigest: view2.bindingDigest! }, OTHER);
    expect(ok.status).not.toBe("held");
  });

  it("a REJECTION needs no digest (it never lets actuation proceed)", async () => {
    const runId = await pausedRun("rej");
    rows("device_tags").find((t) => t.id === 71)!.address = "40003";
    const r = await resumeRun(runId, { approved: false, expectedStepId: "g1" }, OTHER);
    expect(r.status).toBe("aborted");
  });

  it("internal callers (no screen) are unchanged: an approval without either hash still resumes", async () => {
    const runId = await pausedRun("internal");
    expect((await resumeRun(runId, { approved: true }, OTHER)).status).toBe("completed");
  });
});
