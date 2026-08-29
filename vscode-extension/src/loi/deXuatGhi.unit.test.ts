/**
 * LƯỚI đọc đề xuất ghi từ khung SSE. Bất biến sống còn: payload LỒNG dưới `pendingAction`.
 * Đợt A đã dính BỐN lần lớp lỗi "client đọc sai thứ server gửi"; ca đầu tiên dưới đây dùng ĐÚNG
 * hình dạng đo được trên `aiLocalKnowledgeApi.ts:582-585`, không phải hình dạng tự bịa.
 */
import { describe, it, expect } from "vitest";
import { docDeXuatGhi } from "./deXuatGhi";

const KHUNG_THAT = {
  type: "pending_action",
  toolName: "apply_diff",
  pendingAction: {
    actionId: "act_1", token: "act_1", tool: "apply_diff",
    args: { path: "src/Calculator.cs", original: "cu\n", modified: "moi\n" },
    summary: "Sửa Calculator.cs", expiresAt: "2026-08-29T10:00:00.000Z",
    preview: { changes: [] },
  },
};

describe("docDeXuatGhi", () => {
  it("★★★ đọc ĐÚNG hình dạng LỒNG của máy chủ", () => {
    const d = docDeXuatGhi(KHUNG_THAT as never);
    expect(d).not.toBeNull();
    expect(d!.actionId).toBe("act_1");
    expect(d!.path).toBe("src/Calculator.cs");
    expect(d!.original).toBe("cu\n");
    expect(d!.modified).toBe("moi\n");
  });

  it("★★★ payload PHẲNG (hình dạng tự bịa) ⇒ null, KHÔNG đoán bừa", () => {
    expect(docDeXuatGhi({ type: "pending_action", actionId: "x", token: "y" } as never)).toBeNull();
  });

  it("★★★ tool KHÔNG phải apply_diff ⇒ null (Đợt B chỉ xử lý sửa tệp)", () => {
    const k = { ...KHUNG_THAT, pendingAction: { ...KHUNG_THAT.pendingAction, tool: "run_command" } };
    expect(docDeXuatGhi(k as never)).toBeNull();
  });

  it("★★ thiếu original/modified ⇒ null (không dựng diff từ dữ liệu khuyết)", () => {
    const k = { ...KHUNG_THAT, pendingAction: { ...KHUNG_THAT.pendingAction, args: { path: "a" } } };
    expect(docDeXuatGhi(k as never)).toBeNull();
  });

  it("★★ khung loại khác ⇒ null", () => {
    expect(docDeXuatGhi({ type: "token", token: "x" } as never)).toBeNull();
  });
});
