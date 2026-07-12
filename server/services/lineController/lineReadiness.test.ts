/**
 * doc 44 W3-A2 / G3.1 — Line readiness checklist tests (spec LDS-L3 §6.2, v1).
 *
 * Từng check được cô lập bằng mock: máy online/presence, máy fault, feeder
 * run-gate (enforced/off/lỗi), safety read (OFF/UNKNOWN/BLOCKED/OK — UNKNOWN
 * KHÔNG chặn), recipe_set_ref (requireRecipe), và readiness cache TTL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  machines: [] as any[],
  presence: new Map<number, "online" | "offline">(),
  stateRow: null as any,
  feederEnforced: false,
  feederGate: { allowed: true, blocked: false, enforced: true, reason: null, machines: [] } as any,
  feederThrows: false,
  safetyEnabled: false,
  safetyConfigs: [] as any[],
  safetyStatus: {} as Record<string, boolean>,
  safetyReadThrows: false,
}));

vi.mock("./lineStateRepo", () => ({
  getLineMachines: vi.fn(async () => h.machines),
  getLatestPresence: vi.fn(async () => h.presence),
  getLineState: vi.fn(async () => h.stateRow),
}));

vi.mock("../feederVerifyService", () => ({
  isFeederVerifyEnforced: vi.fn(() => h.feederEnforced),
  assertLineSetupOkForRun: vi.fn(async () => {
    if (h.feederThrows) throw new Error("DB not available");
    return h.feederGate;
  }),
}));

vi.mock("../safety/plc/safetyPlcAdapter", () => ({
  safetyPlcAdapterEnabled: vi.fn(() => h.safetyEnabled),
  listPlcConfigs: vi.fn(async () => h.safetyConfigs),
  backendForConfig: vi.fn(() => ({
    read: async () => {
      if (h.safetyReadThrows) throw new Error("PLC unreachable");
      return h.safetyStatus;
    },
  })),
  statusToFindings: vi.fn((status: Record<string, boolean>) =>
    Object.entries(status)
      .filter(([, v]) => v === true)
      .map(([flag]) => ({ flag, eventType: "estop", note: "advisory" })),
  ),
}));

import {
  checkLineReadiness,
  getCachedReadiness,
  _resetReadinessCacheForTests,
} from "./lineReadiness";

function machine(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    code: `M-${id}`,
    name: `Machine ${id}`,
    machineType: "AOI",
    operationStatus: "running",
    lifecycleStatus: "active",
    lastHeartbeat: null,
    stationId: 1,
    stationCode: "ST-1",
    stationName: "Station 1",
    stationOrder: 1,
    ...over,
  };
}

function check(result: Awaited<ReturnType<typeof checkLineReadiness>>, name: string) {
  const c = result.checks.find((x) => x.name === name);
  expect(c, `check ${name} phải tồn tại`).toBeTruthy();
  return c!;
}

beforeEach(() => {
  h.machines = [machine(1), machine(2)];
  h.presence = new Map([
    [1, "online"],
    [2, "online"],
  ]);
  h.stateRow = null;
  h.feederEnforced = false;
  h.feederGate = { allowed: true, blocked: false, enforced: true, reason: null, machines: [] };
  h.feederThrows = false;
  h.safetyEnabled = false;
  h.safetyConfigs = [];
  h.safetyStatus = {};
  h.safetyReadThrows = false;
  _resetReadinessCacheForTests();
  vi.clearAllMocks();
});

afterEach(() => vi.unstubAllEnvs());

describe("checkLineReadiness — 5 check v1", () => {
  it("mọi điều kiện đạt → ready=true; feeder/safety/recipe skipped-honest khi không áp dụng", async () => {
    const r = await checkLineReadiness(7);
    expect(r.ready).toBe(true);
    expect(r.lineId).toBe(7);
    expect(check(r, "machines_online").passed).toBe(true);
    expect(check(r, "no_machine_faulted").passed).toBe(true);
    expect(check(r, "feeder_verify")).toMatchObject({ passed: true, skipped: true });
    expect(check(r, "safety_read")).toMatchObject({ passed: true, skipped: true });
    expect(check(r, "recipe_loaded")).toMatchObject({ passed: true, skipped: true });
    expect(r.checks).toHaveLength(5);
  });

  it("check 1 — máy offline (presence) → fail, nêu mã máy", async () => {
    h.presence.set(2, "offline");
    const r = await checkLineReadiness(7);
    expect(r.ready).toBe(false);
    const c = check(r, "machines_online");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("M-2");
  });

  it("check 1 — máy KHÔNG có presence log: fallback operationStatus (running=online, stopped=offline)", async () => {
    h.presence = new Map(); // chưa từng có status log
    let r = await checkLineReadiness(7);
    expect(check(r, "machines_online").passed).toBe(true); // cả 2 đang running

    h.machines = [machine(1), machine(2, { operationStatus: "stopped" })];
    r = await checkLineReadiness(7);
    expect(check(r, "machines_online").passed).toBe(false);
  });

  it("check 1 — tuyến không có máy → fail (không thể chạy tuyến rỗng)", async () => {
    h.machines = [];
    const r = await checkLineReadiness(7);
    expect(r.ready).toBe(false);
    expect(check(r, "machines_online").passed).toBe(false);
  });

  it("check 2 — máy operationStatus=error / lifecycleStatus=faulted → fail", async () => {
    h.machines = [machine(1), machine(2, { operationStatus: "error" })];
    let r = await checkLineReadiness(7);
    expect(check(r, "no_machine_faulted").passed).toBe(false);
    expect(check(r, "no_machine_faulted").detail).toContain("M-2");

    h.machines = [machine(1, { lifecycleStatus: "faulted" }), machine(2)];
    r = await checkLineReadiness(7);
    expect(check(r, "no_machine_faulted").passed).toBe(false);
  });

  it("check 3 — FEEDER_VERIFY_ENFORCED bật: gate allowed → pass; blocked → fail kèm reason", async () => {
    h.feederEnforced = true;
    let r = await checkLineReadiness(7);
    let c = check(r, "feeder_verify");
    expect(c.passed).toBe(true);
    expect(c.skipped).toBeUndefined();

    h.feederGate = { allowed: false, blocked: true, enforced: true, reason: "feeder setup not run-ready on machine id(s) 2", machines: [] };
    r = await checkLineReadiness(7);
    c = check(r, "feeder_verify");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("machine id(s) 2");
    expect(r.ready).toBe(false);
  });

  it("check 3 — enforced nhưng không kiểm được (throw) → FAIL (default-deny)", async () => {
    h.feederEnforced = true;
    h.feederThrows = true;
    const r = await checkLineReadiness(7);
    expect(check(r, "feeder_verify").passed).toBe(false);
  });

  it("check 4 — safety adapter bật + finding ACTIVE → fail BLOCKED", async () => {
    h.safetyEnabled = true;
    h.safetyConfigs = [{ code: "SPLC-1" }];
    h.safetyStatus = { estop: true };
    const r = await checkLineReadiness(7);
    const c = check(r, "safety_read");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("estop");
    expect(r.ready).toBe(false);
  });

  it("check 4 — safety bật + đọc sạch → pass THẬT (không skipped)", async () => {
    h.safetyEnabled = true;
    h.safetyConfigs = [{ code: "SPLC-1" }];
    h.safetyStatus = { estop: false };
    const r = await checkLineReadiness(7);
    const c = check(r, "safety_read");
    expect(c.passed).toBe(true);
    expect(c.skipped).toBeUndefined();
  });

  it("check 4 — UNKNOWN (không config / không đọc được) → SKIPPED + honest, KHÔNG chặn", async () => {
    h.safetyEnabled = true;
    h.safetyConfigs = []; // bật nhưng không có config
    let r = await checkLineReadiness(7);
    expect(check(r, "safety_read")).toMatchObject({ passed: true, skipped: true });

    h.safetyConfigs = [{ code: "SPLC-1" }];
    h.safetyReadThrows = true; // đọc lỗi toàn bộ → UNKNOWN
    r = await checkLineReadiness(7);
    expect(check(r, "safety_read")).toMatchObject({ passed: true, skipped: true });
    expect(r.ready).toBe(true); // UNKNOWN không chặn khi chưa có HW
  });

  it("check 5 — requireRecipe: thiếu recipe_set_ref → fail; có → pass", async () => {
    let r = await checkLineReadiness(7, { requireRecipe: true });
    expect(check(r, "recipe_loaded").passed).toBe(false);
    expect(r.ready).toBe(false);

    h.stateRow = { recipeSetRef: "MODEL-X@v3" };
    r = await checkLineReadiness(7, { requireRecipe: true });
    const c = check(r, "recipe_loaded");
    expect(c.passed).toBe(true);
    expect(c.detail).toContain("MODEL-X@v3");
  });
});

describe("readiness cache", () => {
  it("kết quả gần nhất được cache; reset → null", async () => {
    expect(getCachedReadiness(7)).toBeNull();
    const r = await checkLineReadiness(7);
    expect(getCachedReadiness(7)).toEqual(r);
    _resetReadinessCacheForTests();
    expect(getCachedReadiness(7)).toBeNull();
  });

  it("quá TTL (LINE_READINESS_CACHE_MS) → cache nguội trả null", async () => {
    vi.stubEnv("LINE_READINESS_CACHE_MS", "1");
    await checkLineReadiness(7);
    await new Promise((res) => setTimeout(res, 10));
    expect(getCachedReadiness(7)).toBeNull();
  });
});
