/**
 * doc 81 Đợt 7 final wave F8 (final review #8) — a restart onto this code BEFORE migration 0367 is applied.
 * The FakeDb models the real failure: any select of orchestration_workflows that names "scopeKey" (a full-row select names
 * every column) rejects with 42703 while the column is "missing"; explicit column lists without it still work.
 *   • the boot hook logs ONE FATAL line naming the fix; the state is cached and re-checked (applying 0367 lifts it);
 *   • workflow management answers a clear "migration missing" (assertFoeSchemaReady), never the database text;
 *   • ★ L-7 — the STOPPING paths still work: an abort and a gate rejection of a stored (paused) run still SEND its STOP
 *     steps (the stored definition loads through explicit columns), for an unrestricted AND a restricted aborter; getRun
 *     still answers; the router does not gate status / listRuns / runListMeta / getRun / abortRun / a rejection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FakeDb, makeEq, makeAnd, resetSeq } from "../../../routers/__otFakeDb";

const { otDispatchMock, robotDispatchMock, conn, scopeCtl } = vi.hoisted(() => ({
  otDispatchMock: vi.fn(async (_input?: unknown) => ({ ok: true, simulated: true, status: "simulated" as const, results: [], commandLogIds: [1] })),
  robotDispatchMock: vi.fn(async (_job?: unknown) => ({ ok: true, status: "simulated" as const, jobId: 7 })),
  conn: { fp: new Map<number, string>() },
  /** restricted: the aborter's scope is RESTRICTED (a judge that decides every target in scope) instead of unrestricted. */
  scopeCtl: { restricted: false },
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
    dispatch: otDispatchMock,
  };
});
vi.mock("../../robot/robotCommandDispatcher", () => ({ dispatchRobotJob: robotDispatchMock }));
vi.mock("../../auditTrailService", () => ({ createAuditContext: (x: unknown) => x, logCrudOperation: vi.fn(async () => ({ id: 1 })) }));
vi.mock("./foeScope", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./foeScope")>();
  return {
    ...orig,
    resolveUserFoeScope: () => (scopeCtl.restricted ? { userId: 12, userRole: "supervisor" } : null),
    makeScopeJudge: async (scope: unknown) => {
      if (!scopeCtl.restricted || scope === null) return orig.makeScopeJudge(null);
      return { unrestricted: false, failed: false, outOf: async () => ({ machines: [], robots: [], adapters: [] }) };
    },
  };
});

const fake = new FakeDb();
/** migration 0367 NOT applied: a select of orchestration_workflows naming "scopeKey" rejects with 42703. */
const schema = { missing: false, broken: false };
{
  const rejecting = (): any => {
    const err = schema.broken ? new Error("connection reset") : Object.assign(new Error('column "scopeKey" does not exist'), { code: "42703" });
    const h: any = new Proxy({}, { get: (_t, k) => (k === "then" ? (_res: unknown, rej: (e: unknown) => unknown) => Promise.reject(err).catch(rej) : () => h) });
    return h;
  };
  const realSelect = fake.select.bind(fake);
  (fake as any).select = (proj?: Record<string, any>) => {
    const b = realSelect(proj);
    const from = b.from.bind(b);
    b.from = (t: any) => {
      const namesScopeKey = proj === undefined || Object.prototype.hasOwnProperty.call(proj, "scopeKey");
      if ((schema.missing || schema.broken) && t?.[Symbol.for("drizzle:Name")] === "orchestration_workflows" && namesScopeKey) return rejecting();
      return from(t);
    };
    return b;
  };
}
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
import {
  deployWorkflow,
  startRun,
  resumeRun,
  abortRun,
  getRun,
  checkFoeSchema,
  foeSchemaMissing,
  assertFoeSchemaReady,
  rehydrateInterruptedRuns,
  _resetFoeSchemaState,
  FOE_SCHEMA_RECHECK_MS,
} from "./foeEngine";
import { adapterTargetFingerprint } from "../../ot/adapterTarget";
import type { WorkflowDefinition } from "./workflowModel";

const OWNER = { id: 10, role: "engineer", name: "owner" };
const SUP = { id: 12, role: "supervisor", name: "sup" };
type Row = Record<string, any>;
const GATE = { id: "gate0", type: "hitl_gate", prompt: "approve" } as const;
const GATE1 = { id: "gate1", type: "hitl_gate", prompt: "second gate" } as const;
const START = { id: "start", type: "command", machineId: 1, command: "start", args: { adapterId: 501, writes: [{ tagKey: "run", value: true }] } } as const;
/** a PINNED stop: writes exactly adapter 501's stop pin (estop = true) */
const OT_STOP = { id: "stop", type: "command", machineId: 1, command: "stop", args: { adapterId: 501, writes: [{ tagKey: "estop", value: true }] } } as const;
const otCommands = () => otDispatchMock.mock.calls.map((c) => (c[0] as { commandType: string }).commandType);

/** A run that ACTUATED (START sent after gate0 approved by SUP) and is now paused at gate1 — no live driver. */
async function pausedAfterMotion(ref: string): Promise<number> {
  const r = await deployWorkflow({ ref, name: ref, steps: [GATE, START, GATE1, OT_STOP] } as unknown as WorkflowDefinition, OWNER);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const s = await startRun(ref, {}, OWNER);
  const v = (await getRun(s.runId!, { bindingDigest: true }))!;
  const a = await resumeRun(s.runId!, { approved: true, expectedDefHash: v.defHash!, expectedBindingDigest: v.bindingDigest!, expectedStepId: "gate0" }, SUP);
  expect(a.status).toBe("awaiting_confirm");
  expect(otCommands()).toEqual(["start"]);
  return s.runId!;
}

let err: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fake.store.clear();
  resetSeq();
  fake.setUnique(orchestrationRunSteps, [["runId", "stepId"]]);
  fake.seed(machines, [{ id: 1, machineType: "AUTOMATION", capabilities: null, code: "M1", name: "Auto-1", operationStatus: "stopped", stationId: 1 }]);
  fake.seed(deviceAdapters, [{ id: 501, machineId: 1, isEnabled: true, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", connectionOptions: null }]);
  fake.seed(deviceTags, [{ id: 9001, adapterId: 501, tagKey: "estop", dataType: "bool", stopValue: true, writable: true, isEnabled: true }]);
  fake.seed(robots, []);
  conn.fp = new Map([[501, adapterTargetFingerprint({ protocol: "modbus", endpoint: "tcp://127.0.0.1:1", machineId: 1, connectionOptions: null } as never)]]);
  otDispatchMock.mockClear();
  robotDispatchMock.mockClear();
  schema.missing = false;
  schema.broken = false;
  scopeCtl.restricted = false;
  _resetFoeSchemaState();
  process.env.FOE_ENABLED = "true";
  process.env.OT_CONTROL_ENABLED = "";
  delete process.env.FOE_SIM_GATE_REQUIRED;
  delete process.env.FOE_DURABLE;
  err = vi.spyOn(console, "error").mockImplementation(() => undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  err.mockRestore();
  log.mockRestore();
  warn.mockRestore();
  vi.restoreAllMocks();
});

const fatalLines = () => err.mock.calls.map((c) => String(c[0])).filter((l) => /FATAL/.test(l));

describe("final wave F8 — boot check of migration 0367", () => {
  it("★ missing ⇒ the boot hook logs ONE FATAL line naming the fix; workflow management refuses clearly; applied later ⇒ lifted after the re-check (no restart)", async () => {
    schema.missing = true;
    await rehydrateInterruptedRuns();
    expect(fatalLines()).toHaveLength(1);
    expect(fatalLines()[0]).toMatch(/migration 0367 is NOT applied/);
    expect(fatalLines()[0]).toMatch(/apply-migration-0367\.mjs/);
    expect(await foeSchemaMissing()).toBe(true);
    const e = await assertFoeSchemaReady().catch((x) => x);
    expect(e).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(String(e.message)).toMatch(/migration 0367 is not applied/);
    expect(String(e.message)).not.toMatch(/scopeKey|42703|does not exist/); // never the database text
    expect(fatalLines()).toHaveLength(1); // cached: no log storm per call
    // the administrator applies 0367: lifted once the re-check interval has passed
    schema.missing = false;
    expect(await foeSchemaMissing()).toBe(true); // still cached
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + FOE_SCHEMA_RECHECK_MS + 1);
    expect(await foeSchemaMissing()).toBe(false);
    await expect(assertFoeSchemaReady()).resolves.toBeUndefined();
    expect(log.mock.calls.map((c) => String(c[0])).some((l) => /0367 is now applied/.test(l))).toBe(true);
  });

  it("present ⇒ 'ok', no FATAL, nothing refused; a transient error never flips a known state", async () => {
    expect(await checkFoeSchema({ boot: true })).toBe("ok");
    expect(fatalLines()).toHaveLength(0);
    await expect(assertFoeSchemaReady()).resolves.toBeUndefined();
    schema.broken = true; // e.g. a dropped connection: not a decision about the schema
    expect(await checkFoeSchema()).toBe("ok");
    await expect(assertFoeSchemaReady()).resolves.toBeUndefined();
    // from a cold start the same error is "unknown" ⇒ never blocks (the calls fail on their own)
    _resetFoeSchemaState();
    expect(await checkFoeSchema()).toBe("unknown");
    expect(await foeSchemaMissing()).toBe(false);
  });
});

describe("★ L-7 — with 0367 missing, an abort / rejection of a stored run still SENDS its STOP steps", () => {
  for (const restricted of [false, true]) {
    it(`abort by ${restricted ? "a RESTRICTED (in-scope)" : "an unrestricted"} user ⇒ the pinned STOP is sent, the run ends 'aborted'`, async () => {
      const runId = await pausedAfterMotion(`ab-${restricted}`);
      schema.missing = true;
      scopeCtl.restricted = restricted;
      const ab = await abortRun(runId, SUP, "halt");
      expect(ab).toMatchObject({ ok: true, status: "aborted" });
      expect(otCommands()).toEqual(["start", "stop"]);
      expect(ab.abortStops?.sent).toEqual(["stop"]);
    });
  }

  it("a gate REJECTION ⇒ the pinned STOP is sent", async () => {
    const runId = await pausedAfterMotion("rej");
    schema.missing = true;
    const r = await resumeRun(runId, { approved: false, note: "no", expectedStepId: "gate1" }, SUP);
    expect(r.status).toBe("aborted");
    expect(otCommands()).toEqual(["start", "stop"]);
  });

  it("getRun still answers (the run screen from which an operator aborts)", async () => {
    const runId = await pausedAfterMotion("view");
    schema.missing = true;
    const v = await getRun(runId);
    expect(v?.run.id).toBe(runId);
    expect(v?.defHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("final wave F8 — the router gates workflow MANAGEMENT only, never a stopping path (source measurement)", () => {
  const SRC = readFileSync(resolve(__dirname, "../../../routers/orchestrationRouter.ts"), "utf8");
  const head = (proc: string) => {
    const i = SRC.indexOf(`\n  ${proc}: `);
    expect(i, proc).toBeGreaterThan(0);
    // the builder chain of the procedure: up to its first .input( / .query( / .mutation(
    const ends = [".input(", ".query(", ".mutation("].map((k) => SRC.indexOf(k, i)).filter((x) => x > i);
    return SRC.slice(i, Math.min(...ends));
  };
  it("★ guarded: list / get / deploy / versions / rollback / start / simulate / delete / duplicate", () => {
    for (const p of ["listWorkflows", "getWorkflow", "deployWorkflow", "listVersions", "getVersion", "rollbackWorkflow", "startRun", "simulate", "deleteWorkflow", "duplicateWorkflow"]) {
      expect(head(p), p).toContain(".use(foeSchemaGuard)");
    }
  });
  it("★ NOT guarded: status, listRuns, runListMeta, getRun, abortRun, resumeRun (an approval is checked inside, a rejection never)", () => {
    for (const p of ["status", "listRuns", "runListMeta", "getRun", "abortRun", "resumeRun"]) {
      expect(head(p), p).not.toContain("foeSchemaGuard");
    }
    const i = SRC.indexOf("\n  resumeRun: ");
    const body = SRC.slice(i, SRC.indexOf("\n  }),", i));
    expect(body).toContain("if (input.approved) await assertFoeSchemaReady();");
  });
});
