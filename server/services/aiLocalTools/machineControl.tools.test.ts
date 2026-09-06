/**
 * Sprint F4a — machine control write-tools through the HITL lifecycle.
 *
 * Asserts (reusing proposeAction/confirmAction):
 *   - preview does NOT call the dispatcher / writeTags (read-only)
 *   - missing permission → propose denied + audit, nothing stored
 *   - happy path: propose → confirm → execute → dispatch (simulated)
 *   - execute args come from the DB row (not the client)
 *   - RBAC #2 loss at confirm → denied, dispatch NOT called
 *   - execute passes the confirmed actionId to the dispatcher (defense-in-depth)
 *
 * ★★★ 2026-09-06 — L-7 ĐỔI HỢP ĐỒNG (aiControlGate.ts). Các ca dưới đây đã được
 *   cập nhật, KHÔNG phải để "cho test xanh lại", mà vì hành vi đúng đã đổi thật:
 *
 *   · `machine_start` / `machine_reset` (Mức 4 — TĂNG năng lượng) và
 *     `select_recipe` / `download_job` / `acknowledge_machine_alarm` (Mức 5)
 *     nay bị cổng AI CHẶN CỨNG ⇒ `dispatch` KHÔNG BAO GIỜ được gọi cho chúng.
 *     Ca "happy path → dispatch" cũ của `machine_start` giờ tự mâu thuẫn với
 *     hàng rào; nó được đổi thành ca ÂM TÍNH khẳng định đúng điều đó, và ca
 *     dương tính chuyển sang `machine_stop` (Mức 1 — GIẢM năng lượng).
 *   · Đường Mức 1/3 đòi cờ `AI_OT_CONTROL_ENABLED=true` + safety-PLC = "OK".
 *     `beforeEach` đặt cả hai; test nào muốn đo trạng thái khác thì tự ghi đè.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { boDemChungChoTest } from "../ot/aiControlGate";

type Row = Record<string, any>;
const store = new Map<string, Row>(); // ai_pending_actions
const adapters: Row[] = [{ id: 10, machineId: 5, code: "A10", isEnabled: true }];
const tags: Row[] = [
  { id: 100, adapterId: 10, tagKey: "cmd_start", address: "ns=1;s=Start", writable: true, isEnabled: true },
  { id: 101, adapterId: 10, tagKey: "speed", address: "ns=1;s=Speed", writable: true, isEnabled: true },
  { id: 102, adapterId: 10, tagKey: "recipe_select", address: "ns=1;s=Rcp", writable: true, isEnabled: true },
];

function makeFakeDb() {
  return {
    insert: () => ({ values: async (vals: Row) => { store.set(vals.id, { ...vals }); } }),
    select: () => ({
      from: (table: any) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async () => {
            const src = table?.__table === "device_adapters" ? adapters
              : table?.__table === "device_tags" ? tags
              : Array.from(store.values());
            for (const r of src) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (patch: Row) => ({
        // ★★★ 2026-08-23 — `where()` nay vừa AWAIT được vừa có `.returning()`: `confirmAction`
        // giành quyền bằng `UPDATE … WHERE status=<đã quan sát>` rồi ĐẾM hàng trả về. `run()` được
        // nhớ lại (memo) nên một lượt gọi không bao giờ áp `patch` hai lần.
        where: (pred: (r: Row) => boolean) => {
          let memo: Row[] | null = null;
          const run = (): Row[] => {
            if (memo) return memo;
            const hit: Row[] = [];
            for (const r of store.values()) if (pred(r)) { Object.assign(r, patch); hit.push(r); }
            memo = hit;
            return hit;
          };
          return {
            then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) =>
              Promise.resolve({ rowCount: run().length }).then(ok, ng),
            returning: async (_c?: unknown) => run().map((r) => ({ id: r.id })),
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
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

function schemaFactory() {
  return {
    aiPendingActions: { id: { __name: "id" }, status: { __name: "status" }, userId: { __name: "userId" }, expiresAt: { __name: "expiresAt" } },
    // tables touched by machineControl preview/execute
    deviceAdapters: { __table: "device_adapters", machineId: { __name: "machineId" }, id: { __name: "id" }, isEnabled: { __name: "isEnabled" } },
    deviceTags: { __table: "device_tags", adapterId: { __name: "adapterId" }, tagKey: { __name: "tagKey" }, writable: { __name: "writable" }, isEnabled: { __name: "isEnabled" } },
  };
}
vi.mock("../../../drizzle/schema", () => schemaFactory());
vi.mock("../../drizzle/schema", () => schemaFactory());

const checkPermission = vi.fn();
vi.mock("../../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));
vi.mock("../_core/accessControl", () => ({ checkPermission: (...a: unknown[]) => checkPermission(...a) }));

// machineRecipe — select_recipe reads active recipe.
const getActiveRecipe = vi.fn(async () => ({ id: 1, code: "R1", version: 2 }));
vi.mock("../../db/machineRecipe", () => ({ getActiveRecipe: (...a: unknown[]) => getActiveRecipe(...a) }));

// commandDispatcher — the ONLY device path; spied so we can assert preview never calls it.
const dispatchSpy = vi.fn(async () => ({ ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [1] }));
vi.mock("../ot/commandDispatcher", () => ({
  dispatch: (...a: unknown[]) => dispatchSpy(...a),
  isOtControlEnabled: () => false,
}));

// L-7 — cầu nối đọc safety-PLC của cổng AI. KHÔNG mock `aiControlGate` chính:
// cổng phải chạy THẬT ở đây, nếu không test này không đo hàng rào nào cả.
const safetyChoAi = vi.fn(async () => "OK" as const);
vi.mock("../ot/aiControlGate.safety", () => ({
  preflightSafetyChoAi: (...a: unknown[]) => safetyChoAi(...a),
}));

// audit — silence.
const logCrudOperation = vi.fn(async () => ({ id: 1 }));
const logUpdate = vi.fn(async () => {});
vi.mock("../auditTrailService", () => ({
  AUDIT_ACTIONS: { AI_ACTION_PROPOSED: "ai_action_proposed", AI_ACTION_CONFIRMED: "ai_action_confirmed", AI_ACTION_EXECUTED: "ai_action_executed", AI_ACTION_DENIED: "ai_action_denied", AI_ACTION_CANCELLED: "ai_action_cancelled" },
  ENTITY_TYPES: { AI_ACTION: "ai_action" },
  createAuditContext: () => ({ userId: 1, source: "web" }),
  logCrudOperation: (...a: unknown[]) => logCrudOperation(...a),
  logUpdate: (...a: unknown[]) => logUpdate(...a),
}));

import { getTool } from "./toolRegistry";
import "./writeHandlers";
import { proposeAction, confirmAction } from "../aiCopilotActions";

const ADMIN = { id: 1, role: "admin", name: "Admin" } as const;
const OPERATOR = { id: 2, role: "operator", name: "Op" } as const;
const ctx = (user: typeof ADMIN | typeof OPERATOR) => ({ user, lang: "vi" as const });

function tool(name: string) {
  const t = getTool(name);
  if (!t) throw new Error(`${name} not registered`);
  return t;
}

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  checkPermission.mockResolvedValue(true);
  getActiveRecipe.mockResolvedValue({ id: 1, code: "R1", version: 2 });
  // L-7: cổng AI mặc định TẮT. Bật cho các ca đo đường Mức 1/3 đi tới dispatcher.
  process.env.AI_OT_CONTROL_ENABLED = "true";
  // L-7: cổng AI fail-closed trên safety UNKNOWN. Adapter giả không có safety-PLC
  // ⇒ mặc định UNKNOWN ⇒ mọi lệnh bị chặn. Giả lập "OK" để đo ĐÚNG thứ ca này đo.
  safetyChoAi.mockResolvedValue("OK");
  // Trần tần suất là bộ đếm dùng-chung của tiến trình — dọn giữa các ca, nếu
  // không ca thứ 6 trở đi sẽ đỏ vì hết quota chứ không vì lỗi thật.
  boDemChungChoTest().xoaHet();
});

afterEach(() => {
  delete process.env.AI_OT_CONTROL_ENABLED;
});

describe("machine control — registration + permissions", () => {
  it("all 8 tools registered with correct kind + permission action", () => {
    const create = ["machine_start", "machine_stop", "machine_pause", "machine_reset", "select_recipe", "download_job"];
    const edit = ["set_machine_param", "acknowledge_machine_alarm"];
    for (const n of create) {
      const t = tool(n);
      expect(t.kind).toBe("write");
      expect(t.requiredPermission).toEqual({ module: "machine_control", action: "canCreate" });
    }
    for (const n of edit) {
      const t = tool(n);
      expect(t.requiredPermission).toEqual({ module: "machine_control", action: "canEdit" });
    }
  });
});

describe("machine_start — HITL flow", () => {
  it("preview does NOT call dispatch", async () => {
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(ADMIN));
    expect(p.ok).toBe(true);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("missing permission → denied + audit, nothing stored", async () => {
    checkPermission.mockResolvedValue(false);
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(OPERATOR));
    expect(p.ok).toBe(false);
    expect(p.denied).toBe(true);
    expect(store.size).toBe(0);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(logCrudOperation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "ai_action_denied" }));
  });

  it("★★★ L-7 ÂM TÍNH: machine_start ĐÃ CONFIRM vẫn KHÔNG tới dispatcher (Mức 4)", async () => {
    // Ca này TRƯỚC L-7 khẳng định điều NGƯỢC LẠI (dispatch được gọi 1 lần). Hàng
    // rào L-7 đổi hợp đồng: người xác nhận đúng quy trình vẫn không đủ để một
    // TÁC NHÂN AI khởi động máy — HITL chứng minh "có người bấm", không chứng
    // minh "không có tay người trong máy".
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(ADMIN));
    expect(dispatchSpy).not.toHaveBeenCalled();
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    // ★ Vòng đời HITL chạy hết và kết thúc ở `bi_tu_choi_ghi` — một giá trị enum
    //   ĐÃ CÓ SẴN (drizzle/0341) nghĩa là "lượt ghi bị TỪ CHỐI". Cổng L-7 rơi
    //   đúng vào ô đó mà không cần enum mới, và `/api/v1/advice?status=` lọc
    //   được ngay. KHÔNG phải "executed": lệnh này không hề được thực thi.
    expect(c.status).toBe("bi_tu_choi_ghi");
    expect(dispatchSpy).not.toHaveBeenCalled(); // ★ KHÔNG một byte nào tới thiết bị
  });

  it("★ L-7 ÂM TÍNH: machine_reset cũng bị chặn (Mức 4)", async () => {
    const p = await proposeAction(tool("machine_reset"), { machineId: 5 }, ctx(ADMIN));
    await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("happy path (Mức 1): machine_stop → confirm → execute → dispatch, actionId threaded", async () => {
    // Ca DƯƠNG TÍNH canh: nếu ca này đỏ thì các ca âm tính ở trên vô nghĩa (một
    // cổng chặn-tất cũng làm chúng xanh).
    const p = await proposeAction(tool("machine_stop"), { machineId: 5 }, ctx(ADMIN));
    expect(dispatchSpy).not.toHaveBeenCalled();
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.commandType).toBe("stop");
    // F5b: AI write-tools ALWAYS dispatch via the human-confirmed HITL path; they
    // NEVER produce triggeredBy.kind='interlock'.
    expect(arg.triggeredBy.kind).toBe("hitl");
    expect(arg.triggeredBy.confirmedBy).toBe(1);
    expect(arg.triggeredBy.requestedBy).toBe(1);
    expect(arg.triggeredBy.actionId).toBe(p.pendingAction!.actionId); // defense-in-depth id passed through
    expect(arg.writes).toEqual([{ tagKey: "cmd_stop", value: true }]);
  });

  it("★ L-7 ÂM TÍNH: cờ AI_OT_CONTROL_ENABLED vắng ⇒ cả Mức 1 cũng không tới dispatcher", async () => {
    delete process.env.AI_OT_CONTROL_ENABLED;
    const p = await proposeAction(tool("machine_stop"), { machineId: 5 }, ctx(ADMIN));
    await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("★ L-7 ÂM TÍNH: safety-PLC UNKNOWN ⇒ Mức 1 bị chặn (fail-closed cho AI)", async () => {
    safetyChoAi.mockResolvedValue("UNKNOWN" as never);
    const p = await proposeAction(tool("machine_stop"), { machineId: 5 }, ctx(ADMIN));
    await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("AI SAFETY: an AI write-tool dispatch is NEVER triggeredBy.kind='interlock'", async () => {
    const p = await proposeAction(tool("machine_stop"), { machineId: 5 }, ctx(ADMIN));
    await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.triggeredBy.kind).toBe("hitl");
    expect(arg.triggeredBy.kind).not.toBe("interlock");
  });

  it("RBAC #2 lost at confirm → denied, dispatch NOT called", async () => {
    const p = await proposeAction(tool("machine_start"), { machineId: 5 }, ctx(ADMIN));
    checkPermission.mockResolvedValue(false); // role downgraded between phases
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("denied");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

describe("execute uses DB-row args (not client)", () => {
  it("set_machine_param dispatch value comes from the stored row", async () => {
    const p = await proposeAction(tool("set_machine_param"), { machineId: 5, tagKey: "speed", value: 42 }, ctx(ADMIN));
    // Tamper the client-side copy AFTER propose — execute must use the DB row.
    const c = await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(c.status).toBe("executed");
    const arg = dispatchSpy.mock.calls[0][0] as any;
    expect(arg.commandType).toBe("set_param");
    expect(arg.writes).toEqual([{ tagKey: "speed", value: 42 }]);
  });
});

describe("select_recipe", () => {
  it("★ L-7 ÂM TÍNH: select_recipe là Mức 5 ⇒ KHÔNG tới dispatcher", async () => {
    // Nạp recipe = thay TOÀN BỘ tập tham số máy trong một lệnh, gồm cả tham số
    // an toàn nằm trong recipe. Không kiểm điểm được từng giá trị ⇒ Mức 5.
    const p = await proposeAction(tool("select_recipe"), { machineId: 5, recipeCode: "R1" }, ctx(ADMIN));
    expect(dispatchSpy).not.toHaveBeenCalled();
    await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("★ L-7 ÂM TÍNH: download_job + acknowledge_machine_alarm cũng Mức 5", async () => {
    for (const [name, args] of [
      ["download_job", { machineId: 5, jobId: "J1" }],
      ["acknowledge_machine_alarm", { machineId: 5 }],
    ] as const) {
      const p = await proposeAction(tool(name), args as never, ctx(ADMIN));
      await confirmAction(p.pendingAction!.actionId, p.pendingAction!.token, ADMIN, "vi");
    }
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});
