/**
 * doc 81 Đợt 1B Task 4 — `robot.actuate` KHÔNG còn nhận `params.script` tuỳ ý cho Techman (BE2 T1-G).
 *
 * Trước đây `params` của actuate được trải thẳng vào job, và TechmanDriver chuyển nguyên văn
 * `params.script` xuống Listen Node ⇒ một operator có quyền actuate gửi được BẤT KỲ TM script nào.
 * Nay: robot vendor `techman` + có khoá `script` ⇒ chỉ nhận đúng các lệnh trong
 * `TECHMAN_SCRIPT_ALLOWLIST`; ngoài danh sách ⇒ FORBIDDEN và dispatcher KHÔNG được gọi.
 * Đường hợp lệ (không có script / script trong danh sách) vẫn đi tới dispatcher.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  phaiDoiMatKhau: vi.fn(async () => false),
  createAuditLog: vi.fn(async () => undefined),
}));

const dbState = vi.hoisted(() => ({ robots: [] as any[], unavailable: false, selects: 0 }));
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
  return {
    getDb: async () => {
      if (dbState.unavailable) return null;
      return {
        select: () => {
          dbState.selects++;
          return { from: q };
        },
      };
    },
  };
});

vi.mock("../_core/accessControl", () => ({
  requirePermission: () => async ({ ctx, next }: any) => next({ ctx }),
}));

const dispatch = vi.hoisted(() => ({ calls: [] as any[] }));
vi.mock("../services/robot/robotCommandDispatcher", () => ({
  dispatchRobotJob: vi.fn(async (input: any) => {
    dispatch.calls.push(input);
    return { ok: true, status: "simulated", jobId: 1 };
  }),
}));

import { robotRouter } from "./robotRouter";

const caller = robotRouter.createCaller({
  user: { id: 7, role: "engineer", name: "Eng", twoFactorEnabled: true },
} as any);

beforeEach(() => {
  dispatch.calls.length = 0;
  dbState.robots = [{ id: 5, vendor: "techman" }];
  dbState.unavailable = false;
  dbState.selects = 0;
});

async function expectForbidden(p: Promise<unknown>): Promise<TRPCError> {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe("FORBIDDEN");
  return err as TRPCError;
}

describe("robot.actuate — danh sách trắng script Techman (doc 81 Đợt 1B Task 4)", () => {
  it("Techman + script ngoài danh sách ⇒ FORBIDDEN, dispatcher KHÔNG được gọi", async () => {
    for (const script of ['ChangeBase("RobotBase")', 'PTP("JPP",0,0,90,0,0,0,100,0,0,false)', "ScriptExit()\r\nFoo()", 42]) {
      const err = await expectForbidden(
        caller.actuate({ robotId: 5, command: "start", params: { script } }),
      );
      expect(err.message).toMatch(/allowlist|danh sách trắng/i);
    }
    expect(dispatch.calls).toEqual([]);
  });

  it("Techman + script TRONG danh sách ⇒ đi tới dispatcher nguyên vẹn", async () => {
    const r = await caller.actuate({ robotId: 5, command: "start", params: { script: "ScriptExit()" } });
    expect(r.status).toBe("simulated");
    expect(dispatch.calls).toHaveLength(1);
    expect(dispatch.calls[0].job).toEqual({
      jobType: "custom",
      params: { command: "start", script: "ScriptExit()" },
    });
  });

  it("Techman KHÔNG có script ⇒ không tra CSDL, đi tới dispatcher như cũ", async () => {
    await caller.actuate({ robotId: 5, command: "home" });
    expect(dispatch.calls).toHaveLength(1);
    expect(dbState.selects).toBe(0);
  });

  it("có script mà không xác định được vendor (CSDL vắng) ⇒ từ chối, không gọi dispatcher (fail-closed)", async () => {
    dbState.unavailable = true;
    await expect(caller.actuate({ robotId: 5, command: "start", params: { script: "ScriptExit()" } })).rejects.toBeInstanceOf(
      TRPCError,
    );
    expect(dispatch.calls).toEqual([]);
  });

  it("có script mà robot không tồn tại ⇒ NOT_FOUND, không gọi dispatcher", async () => {
    dbState.robots = [];
    await expect(
      caller.actuate({ robotId: 999, command: "start", params: { script: "ScriptExit()" } }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(dispatch.calls).toEqual([]);
  });
});
