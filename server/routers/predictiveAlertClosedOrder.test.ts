/**
 * C3 — "cảnh báo vừa đóng" phải sắp theo LÚC ĐÓNG, không theo lúc tạo.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ SẮP SAI + CẮT = MẤT DÒNG, KHÔNG PHẢI "SẮP SAI MỘT CHÚT"
 * ══════════════════════════════════════════════════════════════════════════════════
 * `predictiveAlert.list` sắp rồi `.limit(50)`. Khi OpsConsole hỏi `status: "EXPIRED"`
 * (mục "cảnh báo vừa đóng"), sắp theo `createdAt` nghĩa là lấy 50 dòng TẠO gần nhất —
 * một cảnh báo sống 30 ngày và vừa bị sweeper đóng SÁNG NAY bị đẩy ra ngoài và
 * **không bao giờ xuất hiện** trong mục mang đúng tên "vừa đóng".
 *
 * Và cảnh báo sống lâu CHÍNH LÀ loại sweeper hay đóng nhất — nó đóng thứ đã THÔI tái
 * diễn. Lỗi ăn đúng vào nhóm mà mục ấy sinh ra để phục vụ.
 *
 * ── VÌ SAO CLIENT KHÔNG TỰ CỨU ĐƯỢC ──────────────────────────────────────────────
 * `OpsConsole.tsx` ĐÃ biết trục đúng: nó đọc `updatedAt` làm `closedAt` và có comment
 * giải thích hẳn hoi. Nhưng phép CẮT xảy ra ở máy chủ, trước khi dữ liệu rời đi. Sắp
 * đúng ở client chỉ sắp lại phần đã sống sót.
 * ⇒ Lớp lỗi đáng nhớ: **`ORDER BY` sai + `LIMIT` = mất dữ liệu**; hai thứ riêng lẻ đều
 *   trông vô hại. Cùng họ với W3 việc-6 đã ghi trong `OpsConsole.tsx` (lọc `onlyOpen`
 *   phải làm ở máy chủ TRƯỚC `limit`, không thì breach cũ biến mất).
 *
 * ── VÌ SAO KHÔNG DÙNG CSDL THẬT ─────────────────────────────────────────────────
 * Thứ cần khoá là **cột nào được đưa vào `ORDER BY`** — quan sát được trực tiếp bằng một
 * db giả ghi lại lời gọi, không cần dựng dữ liệu. Ít phụ thuộc hơn, và không dính nhiễu
 * CSDL dùng chung (đã hai lần làm ca xanh/đỏ đổi theo cách chạy).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const orderByCalls: unknown[] = [];
let limitCall: number | undefined;

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: (col: unknown) => {
            orderByCalls.push(col);
            return {
              limit: async (n: number) => {
                limitCall = n;
                return [];
              },
            };
          },
        }),
      }),
    }),
  }),
}));

/** Gọi thủ tục qua caller của router thật — không mô phỏng lại logic. */
async function goiList(input: Record<string, unknown> | undefined) {
  const { predictiveAlertRouter } = await import("./aiRouters");
  const caller = predictiveAlertRouter.createCaller({
    user: { id: 1, username: "t", role: "admin" },
  } as never);
  return caller.list(input as never);
}

/**
 * `orderBy` nhận kết quả của `desc(col)` — một SQL object, KHÔNG phải cột.
 * Tên cột nằm trong `queryChunks` (đọc thẳng hình dạng thật của drizzle, không đoán:
 * `desc(x)` → `{ queryChunks: [{value:[""]}, <cột>, {value:[" desc"]}] }`).
 * Lấy tên theo cách này để lưới nói về CỘT NÀO được sắp, không phụ thuộc identity object.
 */
function tenCot(c: unknown): string {
  const chunks = (c as { queryChunks?: unknown[] })?.queryChunks;
  if (Array.isArray(chunks)) {
    for (const ch of chunks) {
      const n = (ch as { name?: string })?.name;
      if (typeof n === "string") return n;
    }
  }
  return (c as { name?: string })?.name ?? String(c);
}

describe("C3 — trục sắp xếp phải khớp câu hỏi đang được hỏi", () => {
  beforeEach(() => {
    orderByCalls.length = 0;
    limitCall = undefined;
  });

  it("cầu chì: bắt được ĐÚNG một lời gọi orderBy + một limit", async () => {
    // Thiếu ca này, mọi khẳng định dưới đây có thể đang đọc một mảng rỗng.
    await goiList({ status: "ACTIVE" });
    expect(orderByCalls.length).toBe(1);
    expect(limitCall).toBe(50);
  });

  it("★★★ trạng thái ĐÃ ĐÓNG ⇒ sắp theo `updated_at` (lúc đóng)", async () => {
    for (const st of ["EXPIRED", "RESOLVED", "DISMISSED"]) {
      orderByCalls.length = 0;
      await goiList({ status: st });
      expect(tenCot(orderByCalls[0]), `status=${st}`).toContain("updated");
    }
  });

  it("★★★ trạng thái ĐANG MỞ ⇒ vẫn sắp theo `created_at` (cái gì mới xảy ra)", async () => {
    // Đối trọng: "sửa" bằng cách đổi hết sang `updatedAt` sẽ làm hỏng danh sách đang mở —
    // ở đó mọi lượt tái diễn đều chạm `updatedAt`, nên thứ tự sẽ nhảy loạn theo hoạt
    // động thay vì theo độ mới của cảnh báo.
    for (const st of ["ACTIVE", "ACKNOWLEDGED"]) {
      orderByCalls.length = 0;
      await goiList({ status: st });
      expect(tenCot(orderByCalls[0]), `status=${st}`).toContain("created");
    }
  });

  it("không lọc trạng thái ⇒ `created_at` (không đoán ý người gọi)", async () => {
    await goiList(undefined);
    expect(tenCot(orderByCalls[0])).toContain("created");
  });
});
