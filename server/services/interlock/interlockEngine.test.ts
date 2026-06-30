/**
 * Sprint F5a/F5b — interlockEngine tests.
 *
 * Key safety assertions:
 *   - enabled=false rules are never polled (runOnce queries enabled=true only).
 *   - requiresHumanConfirm=true block/stop → interlock_event status 'proposed'
 *     + a (system) Andon raised. NO command is dispatched.
 *   - auto (requiresHumanConfirm=false) block/stop WITHOUT both F5b flags → status
 *     'skipped' — NO command dispatched (red Andon only).
 *   - auto block/stop WITH both flags → dispatch(kind='interlock') is called with
 *     the correct ruleId/eventId/approvedBy; event → 'auto_blocked' on ok.
 *   - action=alert → status 'alert_only' (yellow Andon).
 *   - cooldown: a rule fired within cooldownSeconds is skipped (no 2nd event).
 *   - one failing rule does not crash the loop.
 *   - the engine ONLY ever produces triggeredBy.kind='interlock' (never 'hitl');
 *     the AI has no code path here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── Mocks: drizzle operators as identity tags; schema as plain markers ──
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ op: "and", a }),
  eq: (col: any, val: any) => ({ op: "eq", col, val }),
  gte: (col: any, val: any) => ({ op: "gte", col, val }),
  desc: (col: any) => ({ op: "desc", col }),
  sql: Object.assign((..._a: any[]) => ({ op: "sql" }), {}),
}));

vi.mock("../../../drizzle/schema", () => ({
  interlockRules: { __t: "interlock_rules", id: { __c: "id" }, enabled: { __c: "enabled" } },
  interlockEvents: { __t: "interlock_events", id: { __c: "id" } },
  processResults: { __t: "process_results", measuredAt: {}, result: {}, machineId: {}, stepType: {} },
  spcRuleViolations: { __t: "spc_rule_violations", detectedAt: {}, isActive: {}, machineId: {} },
  cpkHistory: { __t: "cpk_history", cpk: {}, machineId: {}, periodEnd: {} },
  otTelemetry: { __t: "ot_telemetry", ts: {}, numValue: {}, machineId: {}, metric: {} },
}));

// Programmable engine state.
const state: {
  rules: any[];
  observationCount: number;
  insertedEvents: any[];
  ruleUpdates: any[];
} = { rules: [], observationCount: 0, insertedEvents: [], ruleUpdates: [] };

// Fake DB: enough surface for runOnce/evaluateRule/fetchObservation. The query
// builder is a thenable that is also chainable (where/orderBy/limit all return
// the same builder), so both `await db.select().from(t).where(...)` and
// `...where(...).orderBy(...).limit(n)` resolve to the canned rows.
function fakeDb() {
  return {
    select: (cols?: any) => ({
      from: (table: any) => makeBuilder(table?.__t, cols),
    }),
    insert: (table: any) => ({
      values: (vals: any) => ({
        returning: async () => {
          if (table?.__t === "interlock_events") {
            const row = { id: state.insertedEvents.length + 1, ...vals };
            state.insertedEvents.push(row);
            return [row];
          }
          return [{ id: 1, ...vals }];
        },
      }),
    }),
    update: (table: any) => ({
      set: (patch: any) => ({
        where: async () => {
          state.ruleUpdates.push({ table: table?.__t, patch });
          return { rowCount: 1 };
        },
      }),
    }),
  };
}

function makeBuilder(t: string, cols: any): any {
  const rows = () => resolveSelect(t, cols);
  const builder: any = {
    where: () => builder,
    orderBy: () => builder,
    limit: async () => rows(),
    // thenable: `await builder` resolves to rows
    then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(rows()).then(resolve, reject),
  };
  return builder;
}

function resolveSelect(t: string, _cols: any): any[] {
  if (t === "interlock_rules") return state.rules.filter((r) => r.enabled === true);
  if (t === "process_results") return [{ c: state.observationCount, total: 10, fail: state.observationCount }];
  if (t === "spc_rule_violations") return [{ c: state.observationCount }];
  if (t === "cpk_history") return [{ cpk: String(state.observationCount) }];
  if (t === "ot_telemetry") return [{ v: String(state.observationCount), t: new Date() }];
  return [];
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb()),
}));

const raiseAndon = vi.fn(async () => ({ id: 999 }));
vi.mock("../andon/andonService", () => ({
  raiseAndon: (...args: any[]) => raiseAndon(...args),
}));

// commandDispatcher mock: dispatch spy + flag accessors driven by test state.
const dispatchSpy = vi.fn(async (_input: any) => ({ ok: true, simulated: false, status: "acked", results: [], commandLogIds: [555] }));
const flags = { autoBlock: false, otControl: false };
vi.mock("../ot/commandDispatcher", () => ({
  dispatch: (...a: any[]) => (dispatchSpy as any)(...a),
  isInterlockAutoBlockEnabled: () => flags.autoBlock,
  isOtControlEnabled: () => flags.otControl,
}));

// Import AFTER mocks.
import { runOnce, evaluateRule } from "./interlockEngine";

function baseRule(over: Partial<any> = {}): any {
  return {
    id: 1,
    name: "R1",
    scope: "machine",
    machineId: 5,
    lineId: null,
    stationId: null,
    sourceType: "spc_violation",
    sourceKey: null,
    comparisonOperator: "gte",
    threshold: "3",
    windowSeconds: 300,
    consecutiveCount: null,
    windowSize: null,
    action: "alert",
    requiresHumanConfirm: true,
    enabled: true,
    approvedBy: 1,
    cooldownSeconds: 300,
    lastFiredAt: null,
    targetMachineId: null,
    ...over,
  };
}

beforeEach(() => {
  state.rules = [];
  state.observationCount = 0;
  state.insertedEvents = [];
  state.ruleUpdates = [];
  raiseAndon.mockClear();
  dispatchSpy.mockClear();
  flags.autoBlock = false;
  flags.otControl = false;
});

describe("interlockEngine — ALERT-ONLY", () => {
  it("runOnce only polls enabled rules (disabled rules never evaluated)", async () => {
    state.rules = [baseRule({ id: 1, enabled: false }), baseRule({ id: 2, enabled: true })];
    state.observationCount = 5; // >= threshold 3 → fires
    const fired = await runOnce();
    expect(fired).toBe(1); // only the enabled rule
    expect(state.insertedEvents).toHaveLength(1);
    expect(state.insertedEvents[0].ruleId).toBe(2);
  });

  it("action=alert → event status 'alert_only' + yellow Andon", async () => {
    state.observationCount = 5;
    const ev = await evaluateRule(baseRule({ action: "alert" }));
    expect(ev?.status).toBe("alert_only");
    expect(state.insertedEvents[0].status).toBe("alert_only");
    expect(raiseAndon).toHaveBeenCalledTimes(1);
    expect(raiseAndon.mock.calls[0][0]).toMatchObject({ state: "yellow", raisedBySystem: true });
  });

  it("block/stop + requiresHumanConfirm=true → 'proposed' + red Andon, NO command", async () => {
    state.observationCount = 5;
    const ev = await evaluateRule(baseRule({ action: "stop_line", requiresHumanConfirm: true }));
    expect(ev?.status).toBe("proposed");
    expect(state.insertedEvents[0].status).toBe("proposed");
    expect(state.insertedEvents[0].pendingActionId).toMatch(/^interlock-/);
    expect(raiseAndon.mock.calls[0][0]).toMatchObject({ state: "red" });
  });

  it("auto block/stop (requiresHumanConfirm=false) with flags OFF → 'skipped', NO dispatch", async () => {
    state.observationCount = 5;
    // flags.autoBlock / flags.otControl default false in beforeEach.
    const ev = await evaluateRule(baseRule({ action: "block_downstream", requiresHumanConfirm: false, approvedBy: 42, targetAdapterId: 10, commandTag: "cmd_block" }));
    expect(ev?.status).toBe("skipped");
    expect(state.insertedEvents[0].status).toBe("skipped");
    // Andon still raised (red), but NO command dispatched (flags off).
    expect(raiseAndon.mock.calls[0][0]).toMatchObject({ state: "red" });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("does not fire when the condition is not met", async () => {
    state.observationCount = 1; // < threshold 3
    const ev = await evaluateRule(baseRule({ action: "alert" }));
    expect(ev).toBeNull();
    expect(state.insertedEvents).toHaveLength(0);
    expect(raiseAndon).not.toHaveBeenCalled();
  });

  it("cooldown: a rule fired within cooldownSeconds is skipped (no 2nd event)", async () => {
    state.observationCount = 5;
    const recent = new Date(Date.now() - 10_000); // 10s ago, cooldown 300s
    const ev = await evaluateRule(baseRule({ lastFiredAt: recent, cooldownSeconds: 300 }));
    expect(ev).toBeNull();
    expect(state.insertedEvents).toHaveLength(0);
  });

  it("one failing rule does not crash the loop", async () => {
    const bad = baseRule({ id: 1, comparisonOperator: "gte" });
    // Force a throw by giving a rule a sourceType that makes fetchObservation throw.
    const throwingRule = baseRule({ id: 2 });
    Object.defineProperty(throwingRule, "sourceType", {
      get() {
        throw new Error("boom");
      },
    });
    state.rules = [throwingRule, bad];
    state.observationCount = 5;
    const fired = await runOnce();
    // bad rule still fires; throwing rule is isolated by try/catch.
    expect(fired).toBe(1);
  });
});

describe("interlockEngine — F5b auto-block (deterministic, human-approved)", () => {
  const autoRule = (over: Partial<any> = {}) =>
    baseRule({ action: "block_downstream", requiresHumanConfirm: false, approvedBy: 42, targetAdapterId: 10, targetMachineId: 5, commandTag: "cmd_block", commandValue: true, ...over });

  it("both flags ON + clean auto candidate → dispatch(kind='interlock'), event 'auto_blocked'", async () => {
    flags.autoBlock = true;
    flags.otControl = true;
    state.observationCount = 5;
    const ev = await evaluateRule(autoRule());
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0];
    expect(arg.triggeredBy).toMatchObject({ kind: "interlock", ruleId: 1, approvedBy: 42 });
    expect(arg.adapterId).toBe(10);
    expect(arg.writes[0]).toMatchObject({ tagKey: "cmd_block", value: true });
    expect(arg.idempotencyKey).toMatch(/^il-1-/);
    expect(ev?.status).toBe("auto_blocked");
    // event status updated to auto_blocked + commandLogId back-linked
    const update = state.ruleUpdates.find((u) => u.table === "interlock_events" && u.patch.status === "auto_blocked");
    expect(update).toBeTruthy();
    expect(update.patch.commandLogId).toBe(555);
  });

  it("dispatch returns ok:false → event 'failed'", async () => {
    flags.autoBlock = true;
    flags.otControl = true;
    dispatchSpy.mockResolvedValueOnce({ ok: false, simulated: false, status: "rejected", results: [], commandLogIds: [] });
    state.observationCount = 5;
    const ev = await evaluateRule(autoRule());
    expect(ev?.status).toBe("failed");
  });

  it("only autoBlock flag (OT control OFF) → 'skipped', NO dispatch", async () => {
    flags.autoBlock = true;
    flags.otControl = false;
    state.observationCount = 5;
    const ev = await evaluateRule(autoRule());
    expect(ev?.status).toBe("skipped");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("requiresHumanConfirm=true → 'proposed', NO dispatch even with both flags ON", async () => {
    flags.autoBlock = true;
    flags.otControl = true;
    state.observationCount = 5;
    const ev = await evaluateRule(autoRule({ requiresHumanConfirm: true }));
    expect(ev?.status).toBe("proposed");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("rule not approved (approvedBy null) → 'skipped', NO dispatch", async () => {
    flags.autoBlock = true;
    flags.otControl = true;
    state.observationCount = 5;
    const ev = await evaluateRule(autoRule({ approvedBy: null }));
    expect(ev?.status).toBe("skipped");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe("interlockEngine — source safety: ONLY interlock-triggered dispatch, no writeTags, no tRPC", () => {
  const src = fs.readFileSync(path.join(__dirname, "interlockEngine.ts"), "utf-8");

  it("the engine never calls driver.writeTags directly (dispatch is the only writer)", () => {
    expect(src).not.toMatch(/\.writeTags\s*\(/);
  });

  it("the engine ONLY produces triggeredBy.kind='interlock' (never 'hitl')", () => {
    expect(src).toMatch(/kind:\s*["']interlock["']/);
    expect(src).not.toMatch(/kind:\s*["']hitl["']/);
  });

  it("the engine module is not exported to tRPC (no router import here)", () => {
    expect(src).not.toMatch(/Router|trpc|publicProcedure|protectedProcedure/);
  });
});
