/**
 * doc 40 W5 §11 — fleetRollout tests với deployBuild/rollback GIẢ (không DB, không HW).
 *
 * Bao phủ:
 *   • canary FAIL (verify mismatch → 'failed') → DỪNG, KHÔNG promote, rollback máy đã ghi.
 *   • canary ĐẠT → promote nốt phần còn lại.
 *   • rejected (build not ok) làm canary fail nhưng KHÔNG rollback (không ghi HW).
 *   • promoteOnVerified: 'deployed' (chưa verify) chặn promote.
 *   • simulated (cờ OFF) → canary đạt, promote bình thường.
 *   • pickLatestPerDevice: chọn hàng hiệu lực mới nhất mỗi máy (ma trận version).
 */
import { describe, it, expect, vi } from "vitest";
import {
  deployToFleet,
  canaryPasses,
  isForwardWrite,
  pickLatestPerDevice,
  type FleetRolloutInput,
  type FleetRolloutDeps,
  type DeploymentRow,
} from "./fleetRollout";
import type { DpcUser } from "./programmingService";

const USER: DpcUser = { id: 7, role: "engineer", name: "Eng" };

function baseInput(over: Partial<FleetRolloutInput> = {}): FleetRolloutInput {
  return {
    buildId: 100,
    deviceIds: [1, 2, 3, 4],
    stage: "staging",
    strategy: { canaryCount: 2, promoteOnVerified: false, autoRollbackOnMismatch: true },
    idempotencyKeyPrefix: "fleet-100",
    actionId: "act-fleet",
    ...over,
  };
}

/** Tạo một hàng deployment giả tối thiểu cho kết quả deploy. */
function depRow(id: number, deviceId: number, status: string, over: Partial<DeploymentRow> = {}): DeploymentRow {
  return {
    id,
    buildId: 100,
    projectId: 9,
    deviceId,
    stage: "staging",
    status,
    simulated: status === "simulated",
    signedOffBy: null,
    requestedBy: USER.id,
    idempotencyKey: `k-${id}`,
    rolledBackFromId: null,
    detailJson: null,
    error: status === "failed" ? "verify mismatch" : status === "rejected" ? "build not ok" : null,
    corporateCode: null,
    factoryId: null,
    createdAt: new Date(2026, 6, 10, 0, 0, id),
    ...over,
  } as DeploymentRow;
}

/**
 * deployFn giả: trả status theo map deviceId→status (mặc định 'deployed'). Ghi lại thứ tự
 * gọi để khẳng định TUẦN TỰ + DỪNG (không gọi các máy sau khi halt).
 */
function makeDeps(statusByDevice: Record<number, string>, calls: number[], rollbacks: number[] = []): FleetRolloutDeps {
  let nextId = 500;
  return {
    deployFn: vi.fn(async (req) => {
      const deviceId = req.deviceId!;
      calls.push(deviceId);
      const status = statusByDevice[deviceId] ?? "deployed";
      return depRow(nextId++, deviceId, status, { idempotencyKey: req.idempotencyKey });
    }),
    rollbackFn: vi.fn(async (deploymentId) => {
      rollbacks.push(deploymentId);
      return depRow(nextId++, 0, "simulated", { rolledBackFromId: deploymentId });
    }),
  };
}

describe("canaryPasses / isForwardWrite (pure)", () => {
  it("rejected & failed KHÔNG đạt; verified/simulated/deployed đạt (promoteOnVerified=false)", () => {
    expect(canaryPasses("rejected", false)).toBe(false);
    expect(canaryPasses("failed", false)).toBe(false);
    expect(canaryPasses("deployed", false)).toBe(true);
    expect(canaryPasses("verified", false)).toBe(true);
    expect(canaryPasses("simulated", false)).toBe(true);
  });
  it("promoteOnVerified=true: 'deployed' (chưa verify) KHÔNG đạt; 'verified' đạt", () => {
    expect(canaryPasses("deployed", true)).toBe(false);
    expect(canaryPasses("verified", true)).toBe(true);
    expect(canaryPasses("simulated", true)).toBe(true);
  });
  it("isForwardWrite: chỉ deployed/verified là ghi thật", () => {
    expect(isForwardWrite("deployed")).toBe(true);
    expect(isForwardWrite("verified")).toBe(true);
    expect(isForwardWrite("simulated")).toBe(false);
    expect(isForwardWrite("rejected")).toBe(false);
  });
});

describe("deployToFleet — canary FAIL dừng + rollback", () => {
  it("canary verify mismatch ('failed') → DỪNG, không đẩy phần còn lại, rollback máy đã ghi", async () => {
    const calls: number[] = [];
    const rollbacks: number[] = [];
    // Máy 1 ghi thật ('deployed'), máy 2 verify mismatch ('failed').
    const deps = makeDeps({ 1: "deployed", 2: "failed" }, calls, rollbacks);

    const res = await deployToFleet(baseInput(), USER, deps);

    // Chỉ 2 canary được gọi — 2 máy còn lại KHÔNG (đã dừng).
    expect(calls).toEqual([1, 2]);
    expect(res.halted).toBe(true);
    expect(res.promoted).toBe(false);
    expect(res.results).toHaveLength(2);
    expect(res.haltReason).toMatch(/Canary KHÔNG đạt/);

    // Máy 1 (deployed, forward-write) được rollback; máy 2 (failed) không forward-write.
    const m1 = res.results.find((r) => r.deviceId === 1)!;
    expect(m1.rolledBack).toBe(true);
    expect(rollbacks).toEqual([m1.deploymentId]);
    const m2 = res.results.find((r) => r.deviceId === 2)!;
    expect(m2.status).toBe("failed");
    expect(m2.rolledBack).toBeUndefined();

    expect(res.summary.failed).toBe(1);
    expect(res.summary.rolledBack).toBe(1);
  });

  it("canary 'rejected' (build not ok) → DỪNG, KHÔNG rollback (không ghi HW)", async () => {
    const calls: number[] = [];
    const rollbacks: number[] = [];
    const deps = makeDeps({ 1: "rejected", 2: "deployed" }, calls, rollbacks);

    const res = await deployToFleet(baseInput({ strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: true } }), USER, deps);

    expect(calls).toEqual([1]); // 1 canary, rejected → dừng ngay
    expect(res.halted).toBe(true);
    expect(rollbacks).toEqual([]); // rejected không forward-write → không rollback
    expect(res.summary.rejected).toBe(1);
  });

  it("autoRollbackOnMismatch=false → dừng nhưng KHÔNG rollback dù có forward-write", async () => {
    const calls: number[] = [];
    const rollbacks: number[] = [];
    const deps = makeDeps({ 1: "deployed", 2: "failed" }, calls, rollbacks);

    const res = await deployToFleet(
      baseInput({ strategy: { canaryCount: 2, promoteOnVerified: false, autoRollbackOnMismatch: false } }),
      USER,
      deps,
    );
    expect(res.halted).toBe(true);
    expect(rollbacks).toEqual([]);
    expect(res.results.find((r) => r.deviceId === 1)!.rolledBack).toBeUndefined();
  });
});

describe("deployToFleet — canary ĐẠT promote", () => {
  it("tất cả canary 'deployed' → promote nốt các máy còn lại (tuần tự đúng thứ tự)", async () => {
    const calls: number[] = [];
    const deps = makeDeps({}, calls); // mặc định 'deployed' cho mọi máy

    const res = await deployToFleet(baseInput(), USER, deps);

    expect(calls).toEqual([1, 2, 3, 4]); // 2 canary rồi promote 2 máy
    expect(res.halted).toBe(false);
    expect(res.promoted).toBe(true);
    expect(res.results).toHaveLength(4);
    expect(res.results.filter((r) => r.phase === "canary")).toHaveLength(2);
    expect(res.results.filter((r) => r.phase === "promote")).toHaveLength(2);
    expect(res.summary.deployed).toBe(4);
  });

  it("promoteOnVerified=true + canary 'deployed' (chưa verify) → CHẶN promote", async () => {
    const calls: number[] = [];
    const deps = makeDeps({}, calls);
    const res = await deployToFleet(
      baseInput({ strategy: { canaryCount: 2, promoteOnVerified: true, autoRollbackOnMismatch: false } }),
      USER,
      deps,
    );
    expect(res.halted).toBe(true);
    expect(res.promoted).toBe(false);
    expect(calls).toEqual([1, 2]); // không promote
  });

  it("promoteOnVerified=true + canary 'verified' → promote", async () => {
    const calls: number[] = [];
    const deps = makeDeps({ 1: "verified", 2: "verified", 3: "verified", 4: "verified" }, calls);
    const res = await deployToFleet(
      baseInput({ strategy: { canaryCount: 2, promoteOnVerified: true, autoRollbackOnMismatch: false } }),
      USER,
      deps,
    );
    expect(res.halted).toBe(false);
    expect(res.promoted).toBe(true);
    expect(calls).toEqual([1, 2, 3, 4]);
    expect(res.summary.verified).toBe(4);
  });

  it("cờ deploy OFF → mọi máy 'simulated' → canary đạt, promote bình thường", async () => {
    const calls: number[] = [];
    const deps = makeDeps({ 1: "simulated", 2: "simulated", 3: "simulated", 4: "simulated" }, calls);
    const res = await deployToFleet(baseInput(), USER, deps);
    expect(res.halted).toBe(false);
    expect(res.summary.simulated).toBe(4);
  });

  it("canaryCount kẹp về số máy; deviceIds rỗng → không gọi deploy", async () => {
    const calls: number[] = [];
    const deps = makeDeps({}, calls);
    const res = await deployToFleet(baseInput({ deviceIds: [], strategy: { canaryCount: 5, promoteOnVerified: false, autoRollbackOnMismatch: false } }), USER, deps);
    expect(calls).toEqual([]);
    expect(res.results).toHaveLength(0);
    expect(res.summary.total).toBe(0);
  });

  it("deployFn ném lỗi → máy đó ghi 'failed' honest, không vỡ rollout", async () => {
    const calls: number[] = [];
    const deps: FleetRolloutDeps = {
      deployFn: vi.fn(async (req) => {
        calls.push(req.deviceId!);
        throw new Error("boom");
      }),
    };
    const res = await deployToFleet(baseInput({ deviceIds: [1], strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: true } }), USER, deps);
    expect(res.halted).toBe(true);
    expect(res.results[0].status).toBe("failed");
    expect(res.results[0].error).toMatch(/boom/);
  });
});

describe("pickLatestPerDevice — ma trận máy × version (pure)", () => {
  it("chọn hàng hiệu lực MỚI NHẤT mỗi máy, bỏ rejected/failed/rolled_back và deviceId null", () => {
    const rows: DeploymentRow[] = [
      depRow(1, 10, "deployed"),
      depRow(2, 10, "verified"), // mới hơn → thắng cho máy 10
      depRow(3, 11, "failed"), // bỏ
      depRow(4, 11, "deployed"), // hàng hiệu lực mới nhất máy 11 (id 4 > các hàng hiệu lực khác)
      depRow(5, 11, "rejected"), // bỏ (dù id lớn nhất)
      depRow(6, 12, "rolled_back"), // bỏ
      depRow(7, null as unknown as number, "deployed"), // deviceId null → bỏ
      depRow(8, 13, "simulated"),
    ];
    const map = pickLatestPerDevice(rows);
    expect(map.get(10)!.id).toBe(2);
    expect(map.get(11)!.id).toBe(4);
    expect(map.has(12)).toBe(false);
    expect(map.get(13)!.id).toBe(8);
    expect(map.size).toBe(3);
  });
});
