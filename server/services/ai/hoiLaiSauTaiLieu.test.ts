import { describe, it, expect } from "vitest";
import { NGUONG_TIN_CAY_DUNG_LLM, nhuongChoTaiLieu, phanHoiLaiSauTuChoi } from "./hoiLaiSauTaiLieu";

describe("hoiLaiSauTaiLieu — câu hỏi lại nhường tài liệu", () => {
  it("★ ngưỡng TRÙNG ngưỡng gọi LLM (0,30), không đặt số mới", () => {
    expect(NGUONG_TIN_CAY_DUNG_LLM).toBe(0.3);
    expect(nhuongChoTaiLieu(0.3)).toBe(true);
    expect(nhuongChoTaiLieu(0.964)).toBe(true);
    expect(nhuongChoTaiLieu(0.29)).toBe(false);
  });
  it("độ tin cậy rác ⇒ không nhường (giữ hỏi lại như cũ)", () => {
    for (const v of [undefined, null, NaN, "0.9"]) expect(nhuongChoTaiLieu(v)).toBe(false);
  });
  it("★★ model TỪ CHỐI ⇒ nối câu hỏi lại; trả lời thật ⇒ không nối", () => {
    const hoi = "Bạn muốn xem trạng thái **máy nào**…";
    expect(phanHoiLaiSauTuChoi("Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.", hoi)).toBe(`\n\n${hoi}`);
    expect(phanHoiLaiSauTuChoi("Camera hiệu chỉnh hàng tuần.", hoi)).toBe("");
  });
  it("không có câu hỏi lại, hoặc đã có sẵn trong câu trả lời ⇒ không nối", () => {
    expect(phanHoiLaiSauTuChoi("Tôi không có thông tin chính xác", null)).toBe("");
    expect(phanHoiLaiSauTuChoi("Tôi không có thông tin chính xác\n\nX", "X")).toBe("");
  });
});
