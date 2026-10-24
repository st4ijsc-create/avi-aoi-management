/**
 * SCADA R1a Task 10 (K11 + một phần K5) — lõi `confirmAction`:
 *   (1) hàng `hmi.*` ⇒ TỪ CHỐI CỨNG trước mọi CAS (not_found, trạng thái không đổi, không UPDATE nào); `getAction` cũng không trả.
 *   (2) tool GHI OT (có `otWriteBinding`) ⇒ mức = max(phanLoaiMuc(tool, tag), mức kênh) ⇒ sàn vai + `kiemXacThucTheoMuc`
 *       TRƯỚC CAS. Không dựng được đích ⇒ mức 5 (fail-closed). Từ chối ⇒ hàng giữ `proposed` (thử lại được trong TTL).
 *   (3) tool KHÔNG ghi OT ⇒ hành vi cũ, từng chữ (hồi quy).
 * CSDL giả trong bộ nhớ (cùng khuôn `aiCopilotActions.test.ts`); mức kênh (`mucKenhChoAi`) tiêm qua mock — đường DB thật của nó có
 * lưới riêng ở `server/routers/aiCopilotRouter.confirm.r1a.db.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const store = new Map<string, Row>();
const H = vi.hoisted(() => ({ soUpdate: 0, mucKenh: 3 as number, mucKenhCalls: [] as Array<[number, readonly string[]]> }));

function makeFakeDb() {
  return {
    insert: (_t: unknown) => ({ values: async (v: Row) => void store.set(v.id, { ...v }) }),
    select: (_c?: unknown) => ({
      from: (_t: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of store.values()) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    update: (_t: unknown) => ({
      set: (patch: Row) => ({
        where: (pred: (r: Row) => boolean) => {
          H.soUpdate += 1;
          let daChay: Row[] | null = null;
          const run = (): Row[] => {
            if (daChay) return daChay;
            const trung: Row[] = [];
            for (const r of store.values()) if (pred(r)) (Object.assign(r, patch), trung.push(r));
            daChay = trung;
            return trung;
          };
          return {
            then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) => Promise.resolve({ rowCount: run().length }).then(ok, ng),
            returning: async () => run().map((r) => ({ id: r.id })),
          };
        },
      }),
    }),
  };
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...p: Array<(r: Row) => boolean>) => (r: Row) => p.every((f) => f(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));
vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: { id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, expiresAt: { __name: "expiresAt" } },
}));
const checkPermission = vi.fn(async () => true);
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...(a as [])) }));
vi.mock("./aiAgentRealtime", () => ({ publishAiAgentEvent: vi.fn() }));
const logCrudOperation = vi.fn(async (..._a: unknown[]) => ({ id: 1 }));
vi.mock("./auditTrailService", () => ({
  AUDIT_ACTIONS: {
    AI_ACTION_PROPOSED: "ai_action_proposed",
    AI_ACTION_CONFIRMED: "ai_action_confirmed",
    AI_ACTION_EXECUTED: "ai_action_executed",
    AI_ACTION_DENIED: "ai_action_denied",
    AI_ACTION_CANCELLED: "ai_action_cancelled",
  },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: vi.fn(async () => {}),
}));
// Mức kênh tiêm được: cổng đọc DB thật nằm ở lưới DB.
vi.mock("./ot/aiControlGate.safety", () => ({
  preflightSafetyChoAi: vi.fn(async () => "UNKNOWN"),
  mucKenhChoAi: vi.fn(async (adapterId: number, tagKeys: readonly string[]) => {
    H.mucKenhCalls.push([adapterId, tagKeys]);
    return H.mucKenh;
  }),
}));

import { getTool, registerTool, type Tool } from "./aiLocalTools/toolRegistry";
import { confirmAction, getAction, proposeAction } from "./aiCopilotActions";

// ── tool giả: "set_machine_param" (mức 3 trong bảng tra) có otWriteBinding; một tool không ghi OT ──
const execOt = vi.fn(async () => ({ type: "action_result", title: "ot", data: { ok: true }, textSummary: "ot" }));
const execThuong = vi.fn(async () => ({ type: "action_result", title: "thuong", data: { ok: true }, textSummary: "thuong" }));
let binding: () => Promise<unknown> = async () => ({ adapterId: 41, machineId: 9, commandType: "set_param", writes: [{ tagKey: "sp1", value: 1 }] });

const toolOt = {
  name: "set_machine_param",
  description: "r1a10 giả",
  parameters: {} as never,
  triggers: [],
  kind: "write",
  requiredPermission: { module: "machine_control", action: "canEdit" },
  summarize: () => "đặt tham số (giả)",
  preview: async () => ({ entityType: "machine", entityId: 9, changes: [], warnings: [], humanSummary: "giả" }),
  otWriteBinding: async () => binding(),
  execute: execOt,
} as unknown as Tool<any, any>;
const toolThuong = {
  ...toolOt,
  name: "r1a10_khong_ot",
  requiredPermission: { module: "settings", action: "canEdit" },
  otWriteBinding: undefined,
  execute: execThuong,
} as unknown as Tool<any, any>;
registerTool(toolOt);
registerTool(toolThuong);

const U = {
  viewer: { id: 11, role: "viewer", name: "V" },
  operator: { id: 12, role: "operator", name: "O" },
  engineer: { id: 13, role: "engineer", name: "E" },
} as const;

async function deXuat(tool: Tool<any, any>, user: { id: number; role: string; name: string }) {
  const r = await proposeAction(tool, { machineId: 9, tagKey: "sp1", value: 1 }, { user, lang: "vi" });
  expect(r.ok).toBe(true);
  return r.pendingAction!.actionId;
}

beforeEach(() => {
  store.clear();
  H.soUpdate = 0;
  H.mucKenh = 3;
  H.mucKenhCalls = [];
  execOt.mockClear();
  execThuong.mockClear();
  checkPermission.mockClear();
  logCrudOperation.mockClear();
  binding = async () => ({ adapterId: 41, machineId: 9, commandType: "set_param", writes: [{ tagKey: "sp1", value: 1 }] });
});

describe("(1) hàng hmi.* — từ chối cứng ở lõi AI", () => {
  function chenHmi(id: string, userId: number, status = "proposed") {
    store.set(id, {
      id,
      tool: "hmi.write_tag",
      argsJson: { adapterId: 41, tagKey: "sp1", value: 1 },
      userId,
      status,
      expiresAt: new Date(Date.now() + 60_000),
      summary: "hmi",
    });
  }

  it("hmi.write_tag KHÔNG có trong sổ tool AI", () => {
    expect(getTool("hmi.write_tag")).toBeUndefined();
  });

  it("confirmAction ⇒ not_found, trạng thái không đổi, KHÔNG một câu UPDATE nào (trước mọi CAS), không execute", async () => {
    for (const st of ["proposed", "confirmed"]) {
      const id = crypto.randomUUID();
      chenHmi(id, U.engineer.id, st);
      H.soUpdate = 0;
      const kq = await confirmAction(id, id, U.engineer, "vi", undefined, {}, undefined, undefined, { totpCode: "123456" });
      expect(kq).toMatchObject({ ok: false, status: "not_found" });
      expect(store.get(id)!.status).toBe(st);
      expect(H.soUpdate, "không UPDATE").toBe(0);
    }
    expect(execOt).not.toHaveBeenCalled();
    expect(H.mucKenhCalls).toHaveLength(0);
  });

  it("getAction: hàng hmi.* của CHÍNH chủ ⇒ null; hàng AI của chủ vẫn trả", async () => {
    const id = crypto.randomUUID();
    chenHmi(id, U.engineer.id);
    expect(await getAction(id, U.engineer)).toBeNull();
    const ai = await deXuat(toolThuong, U.engineer);
    expect((await getAction(ai, U.engineer))?.id).toBe(ai);
  });
});

describe("(2) tool ghi OT — sàn vai + xác thực theo mức = max(tool, kênh), TRƯỚC CAS", () => {
  it("viewer xác nhận tool máy mức 3 (kênh 3) ⇒ ROLE_FLOOR, hàng giữ proposed, không UPDATE, không execute, không RBAC#2", async () => {
    const id = await deXuat(toolOt, U.viewer);
    H.soUpdate = 0;
    const kq = await confirmAction(id, id, U.viewer, "vi");
    expect(kq).toMatchObject({ ok: false, status: "denied", reason: "ROLE_FLOOR", level: 3 });
    expect(store.get(id)!.status).toBe("proposed");
    expect(H.soUpdate).toBe(0);
    expect(execOt).not.toHaveBeenCalled();
    expect(checkPermission).toHaveBeenCalledTimes(1); // chỉ RBAC#1 lúc propose
    expect(H.mucKenhCalls).toEqual([[41, ["sp1"]]]);
    expect(logCrudOperation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "ai_action_denied", details: expect.objectContaining({ metadata: expect.objectContaining({ denyReason: "ROLE_FLOOR" }) }) }),
    );
  });

  it("operator, mức 3 ⇒ qua (không cần 2FA) ⇒ executed", async () => {
    const id = await deXuat(toolOt, U.operator);
    const kq = await confirmAction(id, id, U.operator, "vi");
    expect(kq).toMatchObject({ ok: true, status: "executed" });
    expect(execOt).toHaveBeenCalledTimes(1);
  });

  it("kênh mức 4 nâng tool mức 3: operator ⇒ ROLE_FLOOR level 4; engineer chưa 2FA ⇒ TOTP_CHUA_DANG_KY; engineer có 2FA không mã ⇒ TOTP_CAN; mã sai dạng ⇒ TOTP_SAI", async () => {
    H.mucKenh = 4;
    const a = await deXuat(toolOt, U.operator);
    expect(await confirmAction(a, a, U.operator, "vi")).toMatchObject({ ok: false, reason: "ROLE_FLOOR", level: 4 });
    const b = await deXuat(toolOt, U.engineer);
    expect(await confirmAction(b, b, U.engineer, "vi")).toMatchObject({ ok: false, reason: "TOTP_CHUA_DANG_KY", level: 4 });
    expect(await confirmAction(b, b, U.engineer, "vi", undefined, {}, undefined, undefined, { twoFactorEnabled: true })).toMatchObject({
      ok: false,
      reason: "TOTP_CAN",
      level: 4,
    });
    expect(
      await confirmAction(b, b, U.engineer, "vi", undefined, {}, undefined, undefined, { twoFactorEnabled: true, totpCode: "12ab56" }),
    ).toMatchObject({ ok: false, reason: "TOTP_SAI", level: 4 });
    expect(store.get(a)!.status).toBe("proposed");
    expect(store.get(b)!.status).toBe("proposed");
    expect(execOt).not.toHaveBeenCalled();
  });

  it("tag an toàn trong đích (phanLoaiMuc ⇒ 5) dù kênh 1 ⇒ level 5", async () => {
    H.mucKenh = 1;
    binding = async () => ({ adapterId: 41, machineId: 9, commandType: "set_param", writes: [{ tagKey: "safety_door_bypass", value: 1 }] });
    const id = await deXuat(toolOt, U.operator);
    expect(await confirmAction(id, id, U.operator, "vi")).toMatchObject({ ok: false, reason: "ROLE_FLOOR", level: 5 });
  });

  it("không dựng được đích (binding ném / null / writes rỗng) ⇒ mức 5 (fail-closed), không đọc kênh", async () => {
    for (const b of [
      async () => {
        throw new Error("adapter mất");
      },
      async () => null,
      async () => ({ adapterId: 41, machineId: 9, commandType: "set_param", writes: [] }),
    ]) {
      const id = await deXuat(toolOt, U.operator);
      binding = b;
      H.mucKenhCalls = [];
      expect(await confirmAction(id, id, U.operator, "vi")).toMatchObject({ ok: false, reason: "ROLE_FLOOR", level: 5 });
      expect(H.mucKenhCalls).toHaveLength(0);
      expect(store.get(id)!.status).toBe("proposed");
      binding = async () => ({ adapterId: 41, machineId: 9, commandType: "set_param", writes: [{ tagKey: "sp1", value: 1 }] });
    }
    expect(execOt).not.toHaveBeenCalled();
  });
});

describe("(3) HỒI QUY — tool không ghi OT: hành vi giữ nguyên", () => {
  it("viewer xác nhận tool không ghi OT ⇒ executed như cũ; không đọc mức kênh; khoá kết quả không có `level`", async () => {
    const id = await deXuat(toolThuong, U.viewer);
    const kq = await confirmAction(id, id, U.viewer, "vi");
    expect(Object.keys(kq).sort()).toEqual(["message", "ok", "result", "status"]);
    expect(kq).toMatchObject({ ok: true, status: "executed" });
    expect(execThuong).toHaveBeenCalledTimes(1);
    expect(H.mucKenhCalls).toHaveLength(0);
    expect(checkPermission).toHaveBeenCalledTimes(2); // RBAC#1 + RBAC#2, như cũ
  });

  it("tool không ghi OT bỏ qua totpCode (không đòi, không tiêu)", async () => {
    const id = await deXuat(toolThuong, U.operator);
    const kq = await confirmAction(id, id, U.operator, "vi", undefined, {}, undefined, undefined, { totpCode: "000000" });
    expect(kq).toMatchObject({ ok: true, status: "executed" });
  });
});
