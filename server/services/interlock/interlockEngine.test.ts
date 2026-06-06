/**
 * Sprint F5a — interlockEngine tests (ALERT-ONLY; NO command path).
 *
 * Key safety assertions:
 *   - enabled=false rules are never polled (runOnce queries enabled=true only).
 *   - requiresHumanConfirm=true block/stop → interlock_event status 'proposed'
 *     + a (system) Andon raised. NO command is dispatched.
 *   - auto (requiresHumanConfirm=false) block/stop in F5a → status 'skipped'
 *     (auto-block deferred to F5b) — NO command dispatched.
 *   - action=alert → status 'alert_only' (yellow Andon).
 *   - cooldown: a rule fired within cooldownSeconds is skipped (no 2nd event).
 *   - one failing rule does not crash the loop.
 *   - the engine module does NOT reference a command dispatcher / writeTags.
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
  otTelemetry: { __t: "ot_telemetry", timestamp: {}, valueNumeric: {}, machineId: {}, tagKey: {} },
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

  it("auto block/stop (requiresHumanConfirm=false) in F5a → 'skipped' (deferred to F5b)", async () => {
    state.observationCount = 5;
    const ev = await evaluateRule(baseRule({ action: "block_downstream", requiresHumanConfirm: false }));
    expect(ev?.status).toBe("skipped");
    expect(state.insertedEvents[0].status).toBe("skipped");
    expect(state.insertedEvents[0].notes).toMatch(/deferred to F5b/i);
    // Andon still raised (red), but NO command dispatched (no dispatcher exists).
    expect(raiseAndon.mock.calls[0][0]).toMatchObject({ state: "red" });
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

describe("interlockEngine — source safety: no command path in the module", () => {
  it("the engine source never imports a dispatcher or calls writeTags", () => {
    const src = fs.readFileSync(path.join(__dirname, "interlockEngine.ts"), "utf-8");
    // No import/require of the command dispatcher MODULE (prose mentions in the
    // SAFETY comment are fine — we only forbid an actual module specifier).
    expect(src).not.toMatch(/from\s+["'][^"']*commandDispatcher["']/);
    expect(src).not.toMatch(/import\(["'][^"']*commandDispatcher["']\)/);
    expect(src).not.toMatch(/require\(["'][^"']*commandDispatcher["']\)/);
    // No invocation of driver.writeTags / .writeTags(...)
    expect(src).not.toMatch(/\.writeTags\s*\(/);
    // No dispatch( call into the OT command path.
    expect(src).not.toMatch(/\bdispatch\s*\(/);
  });
});
