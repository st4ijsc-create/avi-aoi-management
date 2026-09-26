/**
 * ★★★ Pha 4 Task 5 (review) — **ĐƯỜNG THOÁT THỨ HAI CỦA `__authCtx`: AGENT TỰ TRỊ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI — "LƯỚI THEO FILE, KHÔNG THEO ĐƯỜNG THOÁT", LẦN THỨ MƯỜI MỘT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản vá C-1 (Task 4) cho danh tính phiên đi vào args của read tool — nhưng **chỉ ở MỘT đường
 * thoát**: `tryExecuteTool()`. Repo có **HAI** người gọi `Tool.handler` trong mã sản xuất, và người
 * thứ hai — `aiAgentOrchestrator` (Agent TỰ TRỊ) — gọi thẳng `tool.handler(step.args)`.
 *
 * ⚠⚠ **VÀ NÓ FAIL-OPEN, KHÔNG PHẢI FAIL-CLOSED.** Báo cáo Task 5 bản đầu ghi SAI CHIỀU
 * (*"vẫn PERMISSION_DENIED"*). Lý do bỏ sót: `argsWithAuthCtx` **không chỉ GÁN** danh tính — việc
 * đầu tiên nó làm là **XOÁ `__authCtx` do đầu vào bịa** (bản vá N-1/N-4). **Bỏ qua nó = bỏ luôn
 * bước XOÁ**, nên một `__authCtx` bịa đi thẳng vào `checkPermission`.
 *
 * CHUỖI KHAI THÁC (mỗi mắt xích là mã thật, không giả định):
 *   `aiAgentPlanner.buildPlannerPrompt()` ghép **NGUYÊN VĂN mục tiêu của người dùng** vào prompt
 *   → model sinh `steps[].args`
 *   → `aiAgentPlanner` gọi `tool.parameters.safeParse(rawArgs)`, và vì `__authCtx` là ô **ĐÃ KHAI**
 *     trong mọi schema read tool ⇒ `safeParse` **GIỮ NGUYÊN** nó
 *   → `aiAgentOrchestrator` gọi `tool.handler(step.args)` **không xoá**
 *   → `checkPermission(999, "admin", …)` → `accessControl.ts` `if (isAdmin && !scopedAdminEnabled())
 *     return true` — **KHÔNG ĐỌC DB** ⇒ **god-mode trên cả 29 read tool có RBAC**.
 *
 * ⚠⚠⚠ **VÌ SAO KHÔNG ĐƯỢC COI "planner đang trả plan rỗng" LÀ MỘT CỔNG.** Lượt nghiệm thu sống chạy
 * 3 lượt `startSession` và nhận `plan.steps = []` cả 3 — nhưng thứ chặn là **planner đang hỏng**,
 * không phải một phép kiểm nào. Đúng khuôn *"215/215 xanh suốt thời gian tool chết"*: planner được
 * sửa ngày nào thì lỗ mở ngày đó. ⇒ Ca ở đây **thay planner bằng một seam trả đúng hình dạng args
 * mà planner THẬT sinh ra**, tức mô phỏng **người sản xuất args KHÔNG TIN ĐƯỢC** — không phải mô
 * phỏng một lỗi.
 *
 * ⚠ Mọi mắt xích SAU planner là **HÀNG THẬT**: registry thật, `get_vram_state` thật,
 * `argsWithAuthCtx` thật. Chỉ `checkPermission` là seam — vì nó là **thứ đang được ĐO**
 * (đối số thật mà cổng RBAC nhận), không phải thứ được giả để né.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Cổng RBAC: seam để ĐỌC ĐỐI SỐ THẬT (không phải để né). ──
const checkPermissionMock = vi.fn();
vi.mock("../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

// ── Kho phiên giả (cùng khuôn `aiAgentOrchestrator.test.ts`) ──
type Row = Record<string, any>;
const store = new Map<string, Row>();

function makeFakeDb() {
  return {
    insert: (_t: unknown) => ({
      values: async (vals: Row) => {
        store.set(vals.id, { ...vals });
      },
    }),
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
        where: async (pred: (r: Row) => boolean) => {
          let count = 0;
          for (const r of store.values())
            if (pred(r)) {
              Object.assign(r, patch);
              count++;
            }
          return { rowCount: count };
        },
      }),
    }),
  };
}

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

vi.mock("../../drizzle/schema", () => ({
  aiAgentSessions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));

// ── HITL + realtime: không nằm trên đường đọc, giả để khỏi kéo DB thật. ──
vi.mock("./aiCopilotActions", () => ({
  proposeAction: vi.fn(),
  confirmAction: vi.fn(),
  cancelAction: vi.fn(async () => ({ ok: true, status: "cancelled" })),
}));
vi.mock("./aiAgentRealtime", () => ({ publishAiAgentEvent: vi.fn() }));

/**
 * ★ SEAM **NGƯỜI SẢN XUẤT ARGS** — đứng đúng chỗ `planGoal()` đứng, trả đúng hình dạng mà
 * `aiAgentPlanner.normalizeStep()` cho qua (`safeParse` GIỮ `__authCtx` vì nó là ô ĐÃ KHAI).
 * ⚠ KHÔNG giả `toolRegistry`, KHÔNG giả tool, KHÔNG giả `argsWithAuthCtx`.
 */
const planner = vi.hoisted(() => ({ steps: [] as any[] }));
vi.mock("./aiAgentPlanner", () => ({
  planGoal: async () => ({ plan: { steps: planner.steps }, available: true }),
  replanFromObservations: async () => ({ changed: false, steps: [], available: true }),
  AGENT_MAX_STEPS: 6,
  AGENT_MAX_REPLANS: 2,
}));

// Đăng ký tool THẬT (`get_vram_state`) vào registry THẬT.
import "./aiLocalTools/vramTools";
import { startSession, approvePlan } from "./aiAgentOrchestrator";
import * as broker from "./vram/vramBroker";

/** Danh tính BỊA — thứ một model (hoặc một mục tiêu người dùng viết khéo) nhét được vào `args`. */
const BIA = { userId: 999, role: "admin" };
/** Danh tính PHIÊN — máy chủ tự đọc; `supervisor` nằm trong `AGENTIC_ROLES` và **KHÔNG** phải admin. */
const PHIEN = { id: 7, role: "supervisor", name: "Chị Hương" } as const;

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(false);
  planner.steps = [];
  process.env.AI_AGENTIC_ENABLED = "1";
  broker.__resetBrokerForTests();
});

/** Chạy TRỌN đường tự trị: tạo phiên → duyệt kế hoạch → `advance()` chạy bước `read`. */
async function chayKeHoach(args: Record<string, unknown>) {
  planner.steps = [{ kind: "read", tool: "get_vram_state", args, rationale: "r" }];
  const s = await startSession("mục tiêu bất kỳ", { user: PHIEN as never, lang: "vi" });
  expect(s.ok, "phiên phải tạo được — nếu không, ca này không đo được gì").toBe(true);
  return approvePlan((s as { sessionId: string }).sessionId, { user: PHIEN as never });
}

describe("★★★ Agent TỰ TRỊ — `__authCtx` BỊA trong `step.args` KHÔNG BAO GIỜ trở thành danh tính", () => {
  it("★★★ `step.args` mang `__authCtx` BỊA (role admin) ⇒ cổng RBAC TUYỆT ĐỐI không nhận [999,'admin']", async () => {
    /**
     * ⚠⚠ ĐÂY LÀ CA CHỦ. Trước bản vá, `checkPermission` nhận `(999, "admin", …)` và
     * `accessControl.ts` `return true` **không đọc DB** ⇒ leo thang quyền im lặng.
     */
    await chayKeHoach({ __authCtx: BIA });

    expect(
      checkPermissionMock.mock.calls.some((c) => c[0] === 999 || c[1] === "admin"),
      "một lượt gọi mang [999,'admin'] là LEO THANG QUYỀN qua đường Agent tự trị",
    ).toBe(false);
  });

  it("★★★ cổng RBAC nhận ĐÚNG danh tính PHIÊN (7, 'supervisor') — không phải ô bịa", async () => {
    await chayKeHoach({ __authCtx: BIA });

    expect(checkPermissionMock, "bước read phải THẬT SỰ chạy tới cổng, không nuốt lỗi").toHaveBeenCalled();
    const goi = checkPermissionMock.mock.calls.at(-1)!;
    expect(goi[0], "userId phải của PHIÊN").toBe(7);
    expect(goi[1], "role phải của PHIÊN").toBe("supervisor");
  });

  it("★★★ HẬU QUẢ ĐỌC ĐƯỢC: ô bịa KHÔNG mua được một byte nào — dù cổng RBAC nói CÓ với nó", async () => {
    /**
     * ⚠⚠ Ca này **PHÂN BIỆT ĐƯỢC**, và đó là toàn bộ giá trị của nó: cổng trả `true` **CHỈ** cho
     * danh tính BỊA và `false` cho danh tính PHIÊN — tức mô phỏng **đúng** `accessControl.ts:135-137`
     * (`if (isAdmin && !scopedAdminEnabled()) return true`, **không đọc DB**). Một `mockResolvedValue(false)`
     * phẳng sẽ xanh **vì lý do sai** (chặn mọi thứ cũng xanh); ca này chỉ xanh khi ô bịa **thật sự
     * bị XOÁ** trước cổng.
     */
    checkPermissionMock.mockImplementation(async (userId: number, role: string) =>
      userId === BIA.userId && role === BIA.role,
    );

    const r = await chayKeHoach({ __authCtx: BIA });

    const payload = (r as { step?: { payload?: { note?: string; data?: { state?: unknown } } } }).step?.payload;
    expect(payload?.note).toBe("PERMISSION_DENIED");
    expect(payload?.data?.state, "TỪ CHỐI phải kèm 0 byte dữ liệu").toBeNull();
  });

  it("★★ chiều NGƯỢC — phiên CÓ quyền thật ⇒ bước read chạy và trả trạng thái THẬT", async () => {
    /**
     * ⚠ Không có ca này thì ca trên "xanh vì LÝ DO SAI": một bản vá chặn cứng mọi lượt cũng làm
     * `PERMISSION_DENIED` xuất hiện. Ca này chứng minh đường vẫn thông khi danh tính hợp lệ.
     */
    checkPermissionMock.mockResolvedValue(true);

    const r = await chayKeHoach({ __authCtx: BIA });

    const payload = (r as { step?: { payload?: { note?: string; data?: { state?: unknown } } } }).step?.payload;
    expect(payload?.note).not.toBe("PERMISSION_DENIED");
    expect(payload?.data?.state, "phiên hợp lệ phải đọc được trạng thái thật").not.toBeNull();
  });

  it("★★ `step.args` KHÔNG mang `__authCtx` (đường bình thường) ⇒ vẫn phải gán danh tính PHIÊN", async () => {
    /**
     * ⚠ Nếu bản vá chỉ **XOÁ** mà quên **GÁN**, ca chủ vẫn xanh còn tool thì chết hẳn trên đường tự
     * trị — đúng lớp lỗi "đồng hồ không kim ở tầng khác" mà C-1 vừa gỡ. Ca này neo nửa còn lại.
     */
    checkPermissionMock.mockResolvedValue(true);

    await chayKeHoach({});

    expect(checkPermissionMock).toHaveBeenCalled();
    const goi = checkPermissionMock.mock.calls.at(-1)!;
    expect(goi[0]).toBe(7);
    expect(goi[1]).toBe("supervisor");
    expect(goi[2], "module phải là cái tool khai").toBe("machine_control");
  });
});
