/**
 * ★★★ Pha 4 Task 4 (re-review, N-1) — **`__authCtx` ĐẾN TỪ ĐẦU VÀO KHÔNG BAO GIỜ LÀ DANH TÍNH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: MỘT LƯỚI ĐÃ XANH VÌ **LÝ DO SAI** (lần thứ MƯỜI HAI)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ca vòng trước — *"không `execCtx` ⇒ TỪ CHỐI"* — xanh **vì `args` RỖNG**, không phải vì có phòng
 * thủ nào. Nhánh `if (!execCtx) return args` **trả lại NGUYÊN VĂN** một `__authCtx` bịa, và người
 * review đo được `checkPermission([999, "superadmin", …])` với **tool CHẠY**.
 *
 * ⚠ ĐƯỜNG VÀO THẬT (không phải giả định): `classifyToolIntentLLM()` → `tool.parameters.safeParse()`.
 * `__authCtx` là ô **ĐÃ KHAI** trong schema nên `safeParse` **GIỮ NGUYÊN** nó ⇒ args do một model
 * sinh ra mang được `__authCtx`. File này thay bộ phân loại bằng một seam trả **đúng hình dạng đó**
 * — tức mô phỏng **người sản xuất args KHÔNG TIN ĐƯỢC**, không phải mô phỏng lỗi.
 *
 * ⚠⚠ MỌI CA Ở ĐÂY ĐI QUA `tryExecuteTool()` THẬT (đường Agent), và đọc **ĐỐI SỐ THẬT** mà
 * `checkPermission` nhận — không đọc mã, không đọc cờ.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const checkPermissionMock = vi.fn();
vi.mock("../../_core/accessControl", () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
}));

/**
 * Seam **NGƯỜI SẢN XUẤT ARGS**: đứng đúng chỗ `classifyToolIntent`/`classifyToolIntentLLM` đứng.
 * ⚠ KHÔNG giả `toolRegistry`, KHÔNG giả tool, KHÔNG giả `argsWithAuthCtx` — thứ đang được kiểm là
 * đường đi của `tryExecuteTool()`, nên mọi mắt xích sau bộ phân loại phải là hàng THẬT.
 */
const classifier = vi.hoisted(() => ({
  args: {} as Record<string, unknown>,
}));
vi.mock("./intentClassifier", async (importOriginal) => {
  const that = await importOriginal<typeof import("./intentClassifier")>();
  return {
    ...that,
    classifyToolIntent: () => ({ tool: "get_vram_state", args: classifier.args, reason: "TEST_SEAM" }),
    classifyToolIntentLLM: async () => ({ tool: "get_vram_state", args: classifier.args, reason: "TEST_SEAM_LLM" }),
  };
});

import "./vramTools";
import { tryExecuteTool } from "./index";
import * as broker from "./../vram/vramBroker";

/** Danh tính BỊA — thứ một model (hoặc một payload) có thể nhét vào args. */
const BIA = { userId: 999, role: "superadmin" };
/** Danh tính PHIÊN — thứ máy chủ tự đọc, nguồn DUY NHẤT hợp lệ. */
const PHIEN = { user: { id: 7, role: "admin", name: "Tester" }, lang: "vi" as const };

beforeEach(() => {
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  classifier.args = {};
  broker.__resetBrokerForTests();
});

describe("★★★ N-1 — `__authCtx` BỊA trong args KHÔNG BAO GIỜ trở thành danh tính", () => {
  it("★★★ KHÔNG có `execCtx` + args mang `__authCtx` BỊA ⇒ tool TỪ CHỐI, và `checkPermission` KHÔNG ĐƯỢC GỌI", async () => {
    /**
     * ⚠⚠ ĐÂY LÀ CA MÀ BẢN TRƯỚC KHÔNG CÓ. Ca cũ truyền `args = {}` nên nó xanh dù nhánh
     * `if (!execCtx) return args` **trả lại nguyên văn** mọi thứ. Nay args mang danh tính bịa.
     */
    classifier.args = { __authCtx: BIA };

    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, undefined);

    expect(r.result, "tool vẫn phải chạy tới nơi, không nuốt lỗi").not.toBeNull();
    expect(r.result!.note, "không danh tính phiên ⇒ TỪ CHỐI").toBe("PERMISSION_DENIED");
    expect((r.result!.data as { state: unknown }).state).toBeNull();
    // Bằng chứng MẠNH nhất: cổng RBAC **không hề được hỏi** bằng danh tính bịa.
    expect(checkPermissionMock, "một lượt gọi với [999,'superadmin'] là LEO THANG QUYỀN").not.toHaveBeenCalled();
  });

  it("★★★ CÓ `execCtx` + args mang `__authCtx` BỊA ⇒ `checkPermission` nhận danh tính PHIÊN, không phải bịa", async () => {
    classifier.args = { __authCtx: BIA };

    await tryExecuteTool("còn bao nhiêu vram", undefined, PHIEN);

    const goi = checkPermissionMock.mock.calls.at(-1)!;
    expect(goi[0], "userId phải của PHIÊN").toBe(7);
    expect(goi[1], "role phải của PHIÊN").toBe("admin");
    expect(checkPermissionMock.mock.calls.some((c) => c[0] === 999 || c[1] === "superadmin")).toBe(false);
  });

  it("★★ args bịa KHÔNG rò xuống handler: tool chạy được ⇒ trạng thái THẬT (không phải TỪ CHỐI vì args bẩn)", async () => {
    classifier.args = { __authCtx: BIA };
    const r = await tryExecuteTool("còn bao nhiêu vram", undefined, PHIEN);
    expect(r.result!.note).not.toBe("PERMISSION_DENIED");
    expect((r.result!.data as { state: unknown }).state).not.toBeNull();
  });

  it("★ đường LLM fallback (bộ phân loại heuristic bỏ cuộc) cũng đi qua cùng phép làm sạch", async () => {
    /**
     * `classifyToolIntentLLM` là **người sản xuất args không tin được** trong mã thật. Ca này ép
     * đúng nhánh đó (heuristic trả `tool: null`), rồi khẳng định cùng bất biến.
     */
    classifier.args = { __authCtx: BIA };
    const mod = await import("./intentClassifier");
    const spy = vi.spyOn(mod, "classifyToolIntent").mockReturnValue({
      tool: null,
      args: {},
      reason: "TEST_NO_HEURISTIC",
    } as never);
    try {
      await tryExecuteTool("câu hỏi mơ hồ", undefined, PHIEN);
      const goi = checkPermissionMock.mock.calls.at(-1)!;
      expect(goi[0]).toBe(7);
      expect(goi[1]).toBe("admin");
    } finally {
      spy.mockRestore();
    }
  });

  it("★ tool KHÔNG khai `__authCtx` trong schema: args vẫn bị làm sạch, và không bị nhét khoá lạ", async () => {
    /**
     * `get_today_stats` (họ `handlers.ts`) không khai `__authCtx`. Bất biến: `__authCtx` bịa **biến
     * mất**, và ta **không** nhét vào một khoá mà schema `.strict()` của nó không có.
     */
    classifier.args = { __authCtx: BIA };
    const { getTool } = await import("./toolRegistry");
    const t = getTool("get_today_stats");
    if (!t) return; // tool không có ở bản dựng này ⇒ bất biến không áp dụng
    const nhan: unknown[] = [];
    const goc = t.handler!;
    t.handler = async (p: unknown) => {
      nhan.push(p);
      return { type: "today_stats", title: "x", data: {}, textSummary: "x" } as never;
    };
    try {
      const mod = await import("./intentClassifier");
      const spy = vi.spyOn(mod, "classifyToolIntent").mockReturnValue({
        tool: "get_today_stats",
        args: classifier.args,
        reason: "TEST_SEAM",
      } as never);
      await tryExecuteTool("hôm nay thế nào", undefined, PHIEN);
      spy.mockRestore();
      expect(nhan.length).toBe(1);
      expect(Object.hasOwn(nhan[0] as object, "__authCtx"), "không khai ⇒ KHÔNG được nhét vào").toBe(false);
    } finally {
      t.handler = goc;
    }
  });
});
