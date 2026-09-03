/**
 * ★★★ ĐỢT F / TASK 4 / B1 — lưới cho phép so sánh THUẦN quyết định thanh bên phụ có hỗ trợ hay
 * không. Ngưỡng 1.106 mirror ĐÚNG logic runtime của Claude Code (xem docblock `thanhBenPhu.ts`,
 * bằng chứng ĐO ĐƯỢC bằng grep trên `extension.js` đã build của nó) — không phải số bịa.
 */
import { describe, it, expect } from "vitest";
import { hoTroThanhBenPhu, KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU } from "./thanhBenPhu";

describe("hoTroThanhBenPhu — ngưỡng ĐO ĐƯỢC từ Claude Code (major>1 || major===1 && minor>=106)", () => {
  it("★★★ VSCode 1.135.0 (phiên bản THẬT đang cài trên máy đo B1) ⇒ hỗ trợ", () => {
    expect(hoTroThanhBenPhu("1.135.0")).toBe(true);
  });

  it("★★★ đúng biên dưới 1.106.0 ⇒ hỗ trợ", () => {
    expect(hoTroThanhBenPhu("1.106.0")).toBe(true);
  });

  it("★★★ NHÁNH KIA — ngay dưới biên 1.105.9 ⇒ KHÔNG hỗ trợ (lùi về activitybar)", () => {
    expect(hoTroThanhBenPhu("1.105.9")).toBe(false);
  });

  it("★ major lớn hơn 1 ⇒ hỗ trợ bất kể minor", () => {
    expect(hoTroThanhBenPhu("2.0.0")).toBe(true);
  });

  it("★ engines.vscode Claude Code khai (^1.94.0) — DƯỚI ngưỡng thật ⇒ KHÔNG hỗ trợ", () => {
    // ★★★ Đây là bằng chứng B1: engines.vscode CHỈ là trần tối thiểu để ACTIVATE được, không phải
    // ngưỡng bật secondarySidebar — 1.94.0 hoạt động được với extension nhưng chưa qua ngưỡng 1.106.
    expect(hoTroThanhBenPhu("1.94.0")).toBe(false);
  });

  it("★ chuỗi phiên bản dị dạng (không parse được) ⇒ rơi về AN TOÀN (KHÔNG hỗ trợ), không ném lỗi", () => {
    expect(() => hoTroThanhBenPhu("khong-phai-so")).not.toThrow();
    expect(hoTroThanhBenPhu("khong-phai-so")).toBe(false);
    expect(hoTroThanhBenPhu("")).toBe(false);
  });
});

describe("KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU — hằng chuỗi context key", () => {
  it("★★ không rỗng, có tiền tố aviAiLocal (đúng khuôn mọi context key/lệnh khác của extension)", () => {
    expect(KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU.length).toBeGreaterThan(0);
    expect(KHOA_NGU_CANH_KHONG_HO_TRO_THANH_BEN_PHU.startsWith("aviAiLocal")).toBe(true);
  });
});
