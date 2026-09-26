/**
 * ★★★ 2026-08-23 · MỤC 0.3 — **CỬA SỔ ĐUA CỦA `confirmAction`: ĐỌC RỒI GHI, KHÔNG NGUYÊN TỬ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ, PHÁT BIỂU BẰNG THỜI GIAN THẬT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `confirmAction` (a) `SELECT` hàng, (b) kiểm trạng thái/TTL, (c) `checkPermission` — **có I/O** —
 * rồi (d) `UPDATE … SET status='confirmed' WHERE id=?` **không điều kiện**, rồi (e) `execute()`.
 * Hai lượt confirm cùng `actionId` gửi cùng lúc (bấm hai lần · tab thứ hai · client thử lại) đều
 * đọc thấy `proposed` ở (a), đều ghi nhãn ở (d), và **đều chạy `execute()`** ở (e).
 *
 * ⚠⚠ **LƯỚI NÀY PHẢI DỰNG ĐƯỢC CỬA SỔ ẤY, NẾU KHÔNG NÓ TỰ THOẢ.** Một CSDL giả đồng bộ sẽ khiến
 *   hai lượt chạy nối đuôi và ca test XANH **kể cả khi chưa vá** — đúng lớp lỗi *"phép đo mù đúng
 *   trục nó được dựng ra để đo"*. Nên `checkPermission` ở đây **nhường luồng** (một `await` thật),
 *   ép hai lượt xen kẽ đúng ở khoảng (a)→(d). §C chứng minh cửa sổ ấy là THẬT bằng cách gỡ điều
 *   kiện `status` khỏi phép giành và cho thấy `execute()` chạy **HAI** lần.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Row = Record<string, any>;
const store = new Map<string, Row>();

/** Bật/tắt điều kiện `status` trong `UPDATE` — dùng cho §C (đột biến sống trong chính lưới). */
const dieuKien = { batStatus: true };

function makeFakeDb() {
  return {
    insert: (_t: unknown) => ({
      values: async (vals: Row) => {
        store.set(vals.id, { ...vals });
      },
    }),
    /**
     * ⚠⚠ **TRẢ BẢN SAO, KHÔNG TRẢ THAM CHIẾU SỐNG** — và đây KHÔNG phải chuyện sạch sẽ, nó là điều
     *   kiện để lưới đo đúng thứ nó tưởng. Một CSDL thật trả về **ảnh chụp** của hàng tại lúc
     *   `SELECT`. Nếu fake trả thẳng đối tượng trong kho thì lượt A `Object.assign` vào nó sẽ **đổi
     *   luôn `row` của lượt B**, nên phép giành của B (`eq(status, row.status)`) tự khớp với trạng
     *   thái do A vừa ghi ⇒ B cũng thắng ⇒ lưới báo 2 lượt thực thi **vì cái fake sai**, không vì mã
     *   sản phẩm sai. (Đã đo: đúng hình dạng ấy trong bản đầu của lưới này.)
     */
    select: (_c?: unknown) => ({
      from: (_t: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of store.values()) if (pred(r)) return [{ ...r }];
            return [];
          },
        }),
      }),
    }),
    update: (_t: unknown) => ({
      set: (patch: Row) => ({
        where: (pred: (r: Row) => boolean) => {
          let daChay: Row[] | null = null;
          const run = (): Row[] => {
            if (daChay) return daChay;
            const trung: Row[] = [];
            for (const r of store.values()) {
              if (pred(r)) {
                Object.assign(r, patch);
                trung.push(r);
              }
            }
            daChay = trung;
            return trung;
          };
          return {
            then: (ok: (v: unknown) => unknown, ng?: (e: unknown) => unknown) =>
              Promise.resolve({ rowCount: run().length }).then(ok, ng),
            returning: async (_cols?: unknown) => run().map((r) => ({ id: r.id })),
          };
        },
      }),
    }),
  };
}

/**
 * ⚠ `eq` trên cột `status` tôn trọng công tắc `dieuKien.batStatus`: TẮT ⇒ mệnh đề luôn ĐÚNG, tức
 *   dựng lại **chính xác** bản `UPDATE` không điều kiện trước bản vá. Đây là cách §C chạy đột biến
 *   mà không phải sửa file sản phẩm.
 */
vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => {
    if (col.__name === "status" && !dieuKien.batStatus) return true;
    return r[col.__name] === val;
  },
  and: (...preds: Array<(r: Row) => boolean>) => (r: Row) => preds.every((p) => p(r)),
  gt: (col: any, val: any) => (r: Row) => r[col.__name] > val,
  lt: (col: any, val: any) => (r: Row) => r[col.__name] < val,
}));

vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => makeFakeDb()) }));

vi.mock("../../drizzle/schema", () => ({
  aiPendingActions: {
    id: { __name: "id" },
    status: { __name: "status" },
    userId: { __name: "userId" },
    expiresAt: { __name: "expiresAt" },
  },
}));

/**
 * ★★★ ĐIỂM NHƯỜNG LUỒNG — chính là khoảng (a)→(d) ngoài đời (`checkPermission` đọc CSDL/cache).
 * Không có `await` thật ở đây thì hai lượt `confirmAction` chạy nối đuôi và lưới mù.
 */
vi.mock("../_core/accessControl", () => ({
  checkPermission: async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    return true;
  },
}));

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
  logCrudOperation: vi.fn(async () => ({ id: 1 })),
  logUpdate: vi.fn(async () => {}),
}));

vi.mock("./aiAgentRealtime", () => ({ publishAiAgentEvent: vi.fn() }));

/** Số lần `execute()` của tool CHẠY THẬT — con số duy nhất mà cả mục này xoay quanh. */
const soLanChay = { n: 0 };

vi.mock("./aiLocalTools/toolRegistry", async (goc) => {
  const that = await goc<typeof import("./aiLocalTools/toolRegistry")>();
  return {
    ...that,
    getTool: () => ({
      name: "tool_thu",
      kind: "write" as const,
      requiredPermission: { module: "ai", action: "write" },
      execute: async () => {
        soLanChay.n += 1;
        await new Promise((r) => setTimeout(r, 0));
        return { type: "action_result", title: "xong", textSummary: "đã ghi" };
      },
    }),
    isWriteTool: () => true,
    assertExecutable: () => {},
  };
});

import { confirmAction } from "./aiCopilotActions";

const NGUOI = { id: 11, role: "admin", name: "T" };

function gieoHang(id: string, status = "proposed") {
  store.clear();
  store.set(id, {
    id,
    userId: NGUOI.id,
    tool: "tool_thu",
    status,
    argsJson: {},
    previewJson: null,
    requiredPermissionJson: { module: "ai", action: "write" },
    summary: "tóm tắt",
    expiresAt: new Date(Date.now() + 60_000),
    resultJson: null,
  });
}

beforeEach(() => {
  soLanChay.n = 0;
  dieuKien.batStatus = true;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§A — HAI lượt confirm ĐỒNG THỜI ⇒ `execute()` chạy ĐÚNG MỘT lần", () => {
  it("★★★ hai `confirmAction` song song trên cùng actionId: 1 lần thực thi, không 2", async () => {
    gieoHang("act-1");
    const [a, b] = await Promise.all([
      confirmAction("act-1", "act-1", NGUOI, "vi"),
      confirmAction("act-1", "act-1", NGUOI, "vi"),
    ]);
    expect(soLanChay.n, "lượt ghi chạy hai lần ⇒ cửa sổ đua vẫn mở").toBe(1);
    // Đúng MỘT lượt được coi là thực thi thành công; lượt kia phải nói thật là nó không giành được.
    const soOk = [a, b].filter((r) => r.ok).length;
    expect(soOk).toBeGreaterThanOrEqual(1);
    expect(store.get("act-1")!.status).toBe("executed");
  });

  it("★★★ lượt THUA nói ra sự thật, KHÔNG giả vờ mình vừa ghi", async () => {
    gieoHang("act-2");
    const kq = await Promise.all([
      confirmAction("act-2", "act-2", NGUOI, "vi"),
      confirmAction("act-2", "act-2", NGUOI, "vi"),
    ]);
    // Lượt thua HOẶC là nhánh idempotent (`ok:true` + kết quả ĐÃ LƯU), HOẶC là lời từ chối tường
    // minh. Điều KHÔNG được phép là: `ok:true` kèm một `result` do CHÍNH nó vừa sinh ra.
    expect(soLanChay.n).toBe(1);
    const thongDiep = kq.map((r) => r.message ?? "").join(" | ");
    expect(thongDiep).toMatch(/Đã thực thi|đang xử lý/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§B — ĐƯỜNG THƯỜNG không đổi một byte", () => {
  it("★★★ MỘT lượt confirm bình thường vẫn chạy `execute()` và về `executed`", async () => {
    gieoHang("act-3");
    const r = await confirmAction("act-3", "act-3", NGUOI, "vi");
    expect(r.ok).toBe(true);
    expect(r.status).toBe("executed");
    expect(soLanChay.n).toBe(1);
  });

  it("★★★ confirm LẠI một action ĐÃ thực thi ⇒ nhánh idempotent, KHÔNG chạy lại", async () => {
    gieoHang("act-4");
    await confirmAction("act-4", "act-4", NGUOI, "vi");
    const lai = await confirmAction("act-4", "act-4", NGUOI, "vi");
    expect(soLanChay.n).toBe(1);
    expect(lai.ok).toBe(true);
    expect(lai.status).toBe("executed");
  });

  /**
   * ★★★ **ĐƯỜNG THỬ LẠI CỦA HỢP ĐỒNG KHUYẾN NGHỊ VẪN SỐNG.** `enforceAdviceContract` cố ý để hàng ở
   * `confirmed` khi từ chối TẠM THỜI (POLICY_DENIED/TWIN_UNTRUSTED) để người dùng thử lại cùng
   * action. Nếu phép giành ghim cứng `status='proposed'` thì đường ấy **chết** — nên điều kiện phải
   * là *trạng thái ĐÃ QUAN SÁT ĐƯỢC ở lượt đọc*, không phải một hằng.
   */
  it("★★★ hàng đang ở `confirmed` (đường thử lại) vẫn confirm được", async () => {
    gieoHang("act-5", "confirmed");
    const r = await confirmAction("act-5", "act-5", NGUOI, "vi");
    expect(r.ok, "ghim cứng 'proposed' sẽ giết đường thử lại của hợp đồng khuyến nghị").toBe(true);
    expect(soLanChay.n).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("§C — CHỐNG TỰ THOẢ: cửa sổ đua là THẬT (đột biến chạy trong chính lưới)", () => {
  /**
   * Gỡ điều kiện `status` khỏi `UPDATE` ⇒ dựng lại **đúng** mã trước bản vá. Nếu ca này KHÔNG cho ra
   * 2 lượt thực thi thì §A đang xanh vì một lý do khác (hai lượt chạy nối đuôi), và cả mục này vô giá trị.
   */
  it("★★★ BỎ điều kiện `status` ⇒ `execute()` chạy HAI lần (lỗi cũ tái hiện được)", async () => {
    dieuKien.batStatus = false;
    gieoHang("act-6");
    await Promise.all([
      confirmAction("act-6", "act-6", NGUOI, "vi"),
      confirmAction("act-6", "act-6", NGUOI, "vi"),
    ]);
    expect(soLanChay.n, "không tái hiện được lỗi cũ ⇒ §A đang tự thoả, không phải đang đo").toBe(2);
  });
});
