/**
 * doc 81 Đợt 1B Task 5 fix round 4 (ruling R13) — `robot.clearMotionLock` + trạng thái khoá trong `robot.list`.
 *
 * Sau một lần rớt kết nối / kết cục chuyển động không rõ, driver KHOÁ CHUYỂN ĐỘNG. Khoá chỉ gỡ khi (a) một
 * STOP được driver xác nhận, hoặc (b) người vận hành có quyền gỡ qua mutation này: sàn vai actuation
 * (admin/supervisor/engineer) + machine_control/canEdit, ghi audit (createAuditLog) TRƯỚC khi gỡ (không
 * ghi được ⇒ không gỡ), trả trạng thái mới. Driver/robotManager được giả; không mở socket nào.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

const audit = vi.hoisted(() => ({ calls: [] as any[], fail: false }));
vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  phaiDoiMatKhau: vi.fn(async () => false),
  createAuditLog: vi.fn(async (data: any) => {
    if (audit.fail) throw new Error("audit insert failed (simulated)");
    audit.calls.push(data);
    return { id: 1 };
  }),
}));

const dbState = vi.hoisted(() => ({ robots: [] as any[] }));
vi.mock("../db/connection", async () => {
  const schema = await import("../../drizzle/schema");
  const q = (t: unknown) => {
    const rows = t === schema.robots ? dbState.robots : [];
    const chain: any = {
      where: () => chain,
      limit: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
      then: (res: any, rej: any) => Promise.resolve(rows).then(res, rej),
    };
    return chain;
  };
  return { getDb: async () => ({ select: () => ({ from: q }) }) };
});

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

vi.mock("../services/robot/robotCommandDispatcher", () => ({
  dispatchRobotJob: vi.fn(async () => ({ ok: true, status: "simulated", jobId: 1 })),
  robotInterlockTarget: (robotId: number) => ({ adapterId: -1, machineId: robotId, tagKeys: [] }),
}));

// Driver giả có khoá chuyển động; robot 5 đang active, robot 6 active nhưng driver không có khoá.
const rt = vi.hoisted(() => ({
  lock: { locked: true, reasonCode: "line_connection_closed", since: "2026-09-27T00:00:00.000Z", generation: 1 } as Record<string, unknown>,
  /** fix round 5: the fake driver throws a conflict when asked (simulates a link loss between the router's pre-check and the clear). */
  conflictOnClear: false,
  clearCalls: [] as any[],
  connected: true,
}));
vi.mock("../services/robot/robotManager", () => ({
  getActiveRobot: (id: number) => {
    if (id === 5) {
      return {
        id: 5,
        code: "R5",
        vendor: "mitsubishi",
        driver: {
          vendor: "mitsubishi",
          isConnected: () => rt.connected,
          getMotionLock: () => ({ ...rt.lock }),
          clearMotionLock: (input: { reason: string; userId: number; expectedGeneration: number }) => {
            rt.clearCalls.push(input);
            if (rt.conflictOnClear || input.expectedGeneration !== rt.lock.generation) {
              throw new MotionLockConflictError({ ...rt.lock, generation: 2 } as any);
            }
            rt.lock = { locked: false, clearedBy: "operator", clearedByUserId: input.userId, clearReason: input.reason, generation: rt.lock.generation };
            return { ...rt.lock };
          },
        },
      };
    }
    if (id === 6) {
      return { id: 6, code: "R6", vendor: "techman", driver: { vendor: "techman", isConnected: () => true } };
    }
    return undefined;
  },
}));

import { robotRouter } from "./robotRouter";
import { MotionLockConflictError } from "../services/robot/robotDriver";

const engineer = robotRouter.createCaller({
  user: { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true },
} as any);

beforeEach(() => {
  audit.calls.length = 0;
  audit.fail = false;
  rt.lock = { locked: true, reasonCode: "line_connection_closed", since: "2026-09-27T00:00:00.000Z", generation: 1 };
  rt.conflictOnClear = false;
  rt.clearCalls.length = 0;
  rt.connected = true;
  dbState.robots = [{ id: 5, vendor: "mitsubishi", code: "R5" }, { id: 9, vendor: "sim", code: "R9" }];
});

describe("robot.clearMotionLock (doc 81 Đợt 1B Task 5 fix round 4, R13)", () => {
  it("đang khoá ⇒ ghi audit (action robot.clearMotionLock, entity robot 5, lý do + trạng thái trước) RỒI gỡ; trả trạng thái mới + changed", async () => {
    const r = await engineer.clearMotionLock({ robotId: 5, reason: "Checked on site, work area clear", expectedGeneration: 1 });
    expect(r).toMatchObject({ robotId: 5, changed: true, connected: true, motionLock: { locked: false, clearedBy: "operator", clearedByUserId: 7 } });
    expect(rt.clearCalls).toEqual([{ reason: "Checked on site, work area clear", userId: 7, expectedGeneration: 1 }]);
    expect(audit.calls).toHaveLength(1);
    expect(audit.calls[0]).toMatchObject({
      userId: 7,
      action: "robot.clearMotionLock",
      entityType: "robot",
      entityId: 5,
      details: { reason: "Checked on site, work area clear", before: { locked: true, reasonCode: "line_connection_closed" } },
    });
  });

  it("ghi audit THẤT BẠI ⇒ mutation lỗi và khoá KHÔNG được gỡ (fail-closed)", async () => {
    audit.fail = true;
    await expect(engineer.clearMotionLock({ robotId: 5, reason: "Checked on site" , expectedGeneration: 1 })).rejects.toBeInstanceOf(Error);
    expect(rt.clearCalls).toEqual([]);
    expect(rt.lock.locked).toBe(true);
  });

  it("không khoá ⇒ changed:false, không ghi audit, không gọi driver", async () => {
    rt.lock = { locked: false };
    const r = await engineer.clearMotionLock({ robotId: 5, reason: "Checked on site" , expectedGeneration: 1 });
    expect(r).toMatchObject({ robotId: 5, changed: false, motionLock: { locked: false } });
    expect(audit.calls).toEqual([]);
    expect(rt.clearCalls).toEqual([]);
  });

  it("robot không active (chưa được robotManager nạp) ⇒ PRECONDITION_FAILED OPERATION_FAILED/robotNotActive, không audit", async () => {
    const err = await engineer.clearMotionLock({ robotId: 404, reason: "Checked on site" , expectedGeneration: 1 }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(((err as TRPCError).cause as any)?.appCode).toBe("OPERATION_FAILED");
    expect(((err as TRPCError).cause as any)?.appParams).toMatchObject({ operation: "clearRobotMotionLock", reason: "robotNotActive" });
    expect(audit.calls).toEqual([]);
  });

  it("driver không có khoá chuyển động (vd Techman) ⇒ PRECONDITION_FAILED OPERATION_FAILED/motionLockUnsupported", async () => {
    const err = await engineer.clearMotionLock({ robotId: 6, reason: "Checked on site" , expectedGeneration: 1 }).then(
      () => null,
      (e) => e,
    );
    expect((err as TRPCError).code).toBe("PRECONDITION_FAILED");
    expect(((err as TRPCError).cause as any)?.appParams).toMatchObject({ operation: "clearRobotMotionLock", reason: "motionLockUnsupported" });
  });

  it("lý do quá ngắn ⇒ BAD_REQUEST, không gọi driver", async () => {
    await expect(engineer.clearMotionLock({ robotId: 5, reason: "ok" , expectedGeneration: 1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rt.clearCalls).toEqual([]);
  });

  it("vai operator (ngoài sàn actuation) ⇒ FORBIDDEN, không gọi driver, không audit", async () => {
    const operator = robotRouter.createCaller({ user: { id: 8, role: "operator", name: "Op", twoFactorEnabled: true } } as any);
    await expect(operator.clearMotionLock({ robotId: 5, reason: "Checked on site" , expectedGeneration: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(rt.clearCalls).toEqual([]);
    expect(audit.calls).toEqual([]);
  });
});

describe("robot.clearMotionLock — so-sánh-rồi-gỡ (fix round 5, item 2)", () => {
  it("generation người vận hành thấy đã cũ (mất kết nối mới trong lúc mở hộp thoại) ⇒ CONFLICT motionLockChanged TRƯỚC audit, không gọi driver", async () => {
    rt.lock = { locked: true, reasonCode: "line_connection_closed", since: "2026-09-27T00:00:10.000Z", generation: 2 };
    const err = await engineer.clearMotionLock({ robotId: 5, reason: "Checked on site", expectedGeneration: 1 }).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("CONFLICT");
    expect(((err as TRPCError).cause as any)?.appParams).toMatchObject({ operation: "clearRobotMotionLock", reason: "motionLockChanged" });
    expect((err as TRPCError).message).toMatch(/generation 2/);
    expect(audit.calls).toEqual([]);
    expect(rt.clearCalls).toEqual([]);
    expect(rt.lock.locked).toBe(true);
  });

  it("khoá đổi GIỮA audit và gỡ (driver báo xung đột) ⇒ CONFLICT, khoá giữ, thêm một dòng audit 'failure'", async () => {
    rt.conflictOnClear = true;
    const err = await engineer.clearMotionLock({ robotId: 5, reason: "Checked on site", expectedGeneration: 1 }).then(
      () => null,
      (e) => e,
    );
    expect((err as TRPCError).code).toBe("CONFLICT");
    expect(rt.clearCalls).toHaveLength(1);
    expect(rt.lock.locked).toBe(true);
    expect(audit.calls).toHaveLength(2);
    expect(audit.calls[1]).toMatchObject({ action: "robot.clearMotionLock", status: "failure" });
  });

  it("thiếu expectedGeneration ⇒ BAD_REQUEST (UI phải gửi đúng thứ nó đã hiển thị)", async () => {
    await expect((engineer as any).clearMotionLock({ robotId: 5, reason: "Checked on site" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rt.clearCalls).toEqual([]);
  });
});

describe("robot.list / robot.get — trạng thái sống (live) mang khoá chuyển động cho UI", () => {
  it("robot active ⇒ live {active, connected, motionLock}; robot không active ⇒ live.active=false, motionLock null", async () => {
    rt.connected = false;
    const rows = await engineer.list();
    const r5 = rows.find((r: any) => r.id === 5) as any;
    const r9 = rows.find((r: any) => r.id === 9) as any;
    expect(r5.live).toMatchObject({ active: true, connected: false, motionLock: { locked: true, reasonCode: "line_connection_closed" } });
    expect(r9.live).toEqual({ active: false, connected: false, motionLock: null });
    const one = (await engineer.get({ id: 5 })) as any;
    expect(one.live).toMatchObject({ active: true, motionLock: { locked: true } });
  });
});
