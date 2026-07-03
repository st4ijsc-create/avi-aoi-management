/**
 * Doc 25 T1 — interlockGate (cổng interlock ĐỒNG BỘ, fail-closed) unit tests.
 *
 * Chứng minh:
 *   - rule enabled+approved+action-chặn nhắm đúng target VÀ điều kiện ĐANG vi phạm
 *     → blocked=true.
 *   - điều kiện KHÔNG vi phạm → blocked=false (cho qua).
 *   - rule chưa duyệt (approvedBy null) / chưa enabled / sai action / sai target →
 *     KHÔNG chặn.
 *   - evaluator ném lỗi (fetchObservation throw) → fail-closed (blocked=true,
 *     failClosed=true).
 *   - không có DB → fail-closed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Drizzle operators as identity markers (đủ cho gate + fetchObservation).
vi.mock("drizzle-orm", () => ({
  and: (...a: any[]) => ({ op: "and", a }),
  eq: (col: any, val: any) => ({ op: "eq", col, val }),
  gte: (col: any, val: any) => ({ op: "gte", col, val }),
  desc: (col: any) => ({ op: "desc", col }),
  sql: Object.assign((..._a: any[]) => ({ op: "sql" }), {}),
}));

vi.mock("../../../drizzle/schema", () => ({
  interlockRules: { __t: "interlock_rules", id: {}, enabled: { __c: "enabled" } },
  processResults: { __t: "process_results", measuredAt: {}, result: {}, machineId: {}, stepType: {} },
  spcRuleViolations: { __t: "spc_rule_violations", detectedAt: {}, isActive: {}, machineId: {} },
  cpkHistory: { __t: "cpk_history", cpk: {}, machineId: {}, periodEnd: {} },
  otTelemetry: { __t: "ot_telemetry", ts: {}, numValue: {}, machineId: {}, metric: {} },
}));

// Trạng thái lập trình được cho fake DB.
const state: { rules: any[]; observationCount: number; dbNull: boolean } = {
  rules: [],
  observationCount: 0,
  dbNull: false,
};

function makeBuilder(t: string): any {
  const rows = () => resolveSelect(t);
  const builder: any = {
    where: () => builder,
    orderBy: () => builder,
    limit: async () => rows(),
    then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(rows()).then(resolve, reject),
  };
  return builder;
}

function resolveSelect(t: string): any[] {
  if (t === "interlock_rules") return state.rules.filter((r) => r.enabled === true);
  if (t === "process_results") return [{ c: state.observationCount, total: 10, fail: state.observationCount }];
  if (t === "spc_rule_violations") return [{ c: state.observationCount }];
  if (t === "cpk_history") return [{ cpk: String(state.observationCount) }];
  if (t === "ot_telemetry") return [{ v: String(state.observationCount), t: new Date() }];
  return [];
}

function fakeDb() {
  return {
    select: (_cols?: any) => ({ from: (table: any) => makeBuilder(table?.__t) }),
  };
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => (state.dbNull ? null : fakeDb())),
}));

import { evaluateInterlockGate } from "./interlockGate";

// Rule chặn hợp lệ: enabled, approved, block_downstream, nhắm adapter 10 / máy 5,
// nguồn spc_violation ngưỡng >=3 (observationCount điều khiển vi phạm).
function blockRule(over: Partial<any> = {}): any {
  return {
    id: 1,
    name: "R1",
    enabled: true,
    approvedBy: 42,
    action: "block_downstream",
    targetAdapterId: 10,
    targetMachineId: 5,
    commandTag: "cmd_block",
    sourceType: "spc_violation",
    comparisonOperator: "gte",
    threshold: "3",
    windowSeconds: 300,
    machineId: 5,
    consecutiveCount: null,
    ...over,
  };
}

const params = { adapterId: 10, machineId: 5, tagKeys: ["cmd_start"] };

beforeEach(() => {
  state.rules = [];
  state.observationCount = 0;
  state.dbNull = false;
});

describe("evaluateInterlockGate — chặn khi rule vi phạm", () => {
  it("rule hợp lệ + điều kiện vi phạm → blocked, có violation", async () => {
    state.rules = [blockRule()];
    state.observationCount = 5; // >= 3 → vi phạm
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.failClosed).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ ruleId: 1, action: "block_downstream" });
  });

  it("khớp target theo targetMachineId (khác adapter) vẫn chặn", async () => {
    state.rules = [blockRule({ targetAdapterId: 999, targetMachineId: 5 })];
    state.observationCount = 5;
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
  });
});

describe("evaluateInterlockGate — cho qua", () => {
  it("điều kiện KHÔNG vi phạm → not blocked", async () => {
    state.rules = [blockRule()];
    state.observationCount = 1; // < 3
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(false);
    expect(r.violations).toHaveLength(0);
  });

  it("rule chưa duyệt (approvedBy null) → bỏ qua, not blocked", async () => {
    state.rules = [blockRule({ approvedBy: null })];
    state.observationCount = 5;
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(false);
  });

  it("rule action=alert (không chặn) → bỏ qua", async () => {
    state.rules = [blockRule({ action: "alert" })];
    state.observationCount = 5;
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(false);
  });

  it("rule nhắm target khác (adapter/máy/tag đều không khớp) → bỏ qua", async () => {
    state.rules = [blockRule({ targetAdapterId: 99, targetMachineId: 88, commandTag: "other" })];
    state.observationCount = 5;
    const r = await evaluateInterlockGate({ adapterId: 10, machineId: 5, tagKeys: ["cmd_start"] });
    expect(r.blocked).toBe(false);
  });

  it("rule enabled=false không được truy vấn → not blocked", async () => {
    state.rules = [blockRule({ enabled: false })];
    state.observationCount = 5;
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(false);
  });
});

describe("evaluateInterlockGate — fail-closed", () => {
  it("fetchObservation ném lỗi → fail-closed (blocked + failClosed)", async () => {
    // sourceType getter ném để buộc evaluateRuleCondition throw.
    const throwing = blockRule();
    Object.defineProperty(throwing, "sourceType", {
      get() {
        throw new Error("boom");
      },
    });
    state.rules = [throwing];
    state.observationCount = 5;
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.failClosed).toBe(true);
  });

  it("không có DB → fail-closed", async () => {
    state.dbNull = true;
    const r = await evaluateInterlockGate(params);
    expect(r.blocked).toBe(true);
    expect(r.failClosed).toBe(true);
  });
});
