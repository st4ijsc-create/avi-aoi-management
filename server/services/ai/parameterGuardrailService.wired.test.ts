/**
 * doc 44 W5-A2 — wired tests: twin-first (G4.19, mock isTwinTrusted) + closed-loop
 * verify sweep (G4.20, Andon on degraded). DB + neighbours mocked; a per-query
 * result queue feeds the fake driver.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, any>;
let queue: Row[][] = [];

function readChain() {
  const chain: any = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => (queue.length ? queue.shift() : []),
    then: (onF: any, onR: any) => Promise.resolve(queue.length ? queue.shift() : []).then(onF, onR),
  };
  return chain;
}
const writeChain: any = {
  set: () => writeChain,
  values: () => writeChain,
  where: async () => ({ rowCount: 1 }),
  returning: async () => [{ id: 1 }],
  then: (onF: any) => onF({ rowCount: 1 }),
};
const fakeDb = {
  select: () => readChain(),
  update: () => writeChain,
  insert: () => writeChain,
  delete: async () => ({ rowCount: 1 }),
};

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  desc: () => ({}),
  isNotNull: () => ({}),
  lte: () => ({}),
  gte: () => ({}),
  sql: Object.assign(() => ({ as: () => ({}) }), { as: () => ({}) }),
}));
vi.mock("../../../drizzle/schema", () => {
  const c = () => ({});
  return {
    parameterGuardrails: { scope: c(), machineId: c(), machineType: c(), requiresTwinValidation: c(), id: c(), paramKey: c(), minValue: c(), maxValue: c(), maxStep: c(), unit: c() },
    parameterChangeLog: { id: c(), machineId: c(), paramKey: c(), oldValue: c(), newValue: c(), verifyStatus: c(), verifyAfter: c(), verifiedAt: c(), metricsBefore: c(), metricsAfter: c() },
    machines: { id: c(), stationId: c(), machineType: c() },
    stations: { id: c(), lineId: c() },
    measurementResults: { result: c(), inspectionId: c(), id: c() },
    productInspections: { id: c(), machineId: c(), inspectionTime: c() },
  };
});

const isTwinTrusted = vi.fn(async () => true);
vi.mock("../twin/twinFidelityService", () => ({ isTwinTrusted: (...a: unknown[]) => isTwinTrusted(...(a as [])) }));
const routeAlert = vi.fn(async () => ({}));
vi.mock("../aiSmartAlertRouter", () => ({ routeAlert: (...a: unknown[]) => routeAlert(...(a as [])) }));

import { evaluateTwinValidation, resolveGuardrail, sweepParamVerify, _resetParamVerifyForTests } from "./parameterGuardrailService";

beforeEach(() => {
  vi.clearAllMocks();
  queue = [];
  isTwinTrusted.mockResolvedValue(true);
  _resetParamVerifyForTests();
});
afterEach(() => {
  delete process.env.PARAM_VERIFY_ENABLED;
});

describe("resolveGuardrail — machine beats machine_type (G4.18 priority)", () => {
  it("machine-specific guardrail wins (no type fallback query)", async () => {
    queue = [[{ id: 1, scope: "machine", minValue: 1, maxValue: 2 }]];
    const g = await resolveGuardrail(5, "torque_nm");
    expect(g?.id).toBe(1);
  });
  it("falls back to machine_type default when no machine-specific row", async () => {
    // machine-specific=[], resolveMachineType=[{type}], machine_type guardrail=[row]
    queue = [[], [{ type: "AOI" }], [{ id: 2, scope: "machine_type", minValue: 1, maxValue: 3 }]];
    const g = await resolveGuardrail(5, "torque_nm");
    expect(g?.id).toBe(2);
  });
  it("neither → null", async () => {
    queue = [[], [{ type: "AOI" }], []];
    expect(await resolveGuardrail(5, "torque_nm")).toBeNull();
  });
});

describe("evaluateTwinValidation — twin-first (G4.19)", () => {
  it("guardrail requires twin + line trusted → passed", async () => {
    queue = [[{ id: 1 }], [{ lineId: 7 }]]; // requires-twin lookup, then line lookup
    isTwinTrusted.mockResolvedValue(true);
    expect(await evaluateTwinValidation(5)).toBe("passed");
    expect(isTwinTrusted).toHaveBeenCalledWith("line:7");
  });

  it("guardrail requires twin + line UNtrusted → untrusted", async () => {
    queue = [[{ id: 1 }], [{ lineId: 7 }]];
    isTwinTrusted.mockResolvedValue(false);
    expect(await evaluateTwinValidation(5)).toBe("untrusted");
  });

  it("guardrail requires twin + no line resolvable → skipped (honest)", async () => {
    queue = [[{ id: 1 }], []]; // requires-twin, but no line
    expect(await evaluateTwinValidation(5)).toBe("skipped");
    expect(isTwinTrusted).not.toHaveBeenCalled();
  });

  it("no guardrail requires twin → undefined (attach nothing)", async () => {
    queue = [[]]; // requires-twin lookup returns nothing
    expect(await evaluateTwinValidation(5)).toBeUndefined();
    expect(isTwinTrusted).not.toHaveBeenCalled();
  });

  it("null machineId → undefined", async () => {
    expect(await evaluateTwinValidation(null)).toBeUndefined();
  });
});

describe("sweepParamVerify — closed-loop verify (G4.20)", () => {
  it("degraded change → verdict persisted + ONE Andon warning kèm old_value", async () => {
    process.env.PARAM_VERIFY_ENABLED = "true";
    const pending = { id: 55, machineId: 5, paramKey: "torque_nm", oldValue: 1.7, newValue: 1.9, metricsBefore: { ngRatePct: 2, total: 100 } };
    // pending rows, then computeMachineMetrics AFTER snapshot (NG rose 2% → 20%).
    queue = [[pending], [{ total: 100, ng: 20 }]];
    const r = await sweepParamVerify();
    expect(r.degraded).toBe(1);
    expect(routeAlert).toHaveBeenCalledTimes(1);
    const alert = routeAlert.mock.calls[0][0] as any;
    expect(alert.type).toBe("PATTERN_ANOMALY");
    expect(alert.machineId).toBe(5);
    expect(alert.data.oldValue).toBe(1.7);
    expect(alert.data.changeLogId).toBe(55);
  });

  it("improved change → verdict persisted, NO Andon", async () => {
    process.env.PARAM_VERIFY_ENABLED = "true";
    const pending = { id: 56, machineId: 5, paramKey: "torque_nm", oldValue: 1.9, newValue: 1.7, metricsBefore: { ngRatePct: 10, total: 100 } };
    queue = [[pending], [{ total: 100, ng: 1 }]]; // NG fell 10% → 1%
    const r = await sweepParamVerify();
    expect(r.improved).toBe(1);
    expect(routeAlert).not.toHaveBeenCalled();
  });

  it("flag OFF → no-op (bit-compat)", async () => {
    queue = [[{ id: 1 }]];
    const r = await sweepParamVerify();
    expect(r).toEqual({ verified: 0, improved: 0, degraded: 0, neutral: 0 });
    expect(routeAlert).not.toHaveBeenCalled();
  });
});
