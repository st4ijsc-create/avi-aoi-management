/**
 * LƯỚI diễn giải lỗi HTTP của kênh SSE. Bất biến: 401 và 403 KHÔNG PHẢI cùng một chuyện — gộp
 * chung thành "đăng nhập lại" tạo vòng lặp không lối ra cho tài khoản bị 403 vì
 * MUST_CHANGE_PASSWORD/ACCOUNT_DISABLED (đăng nhập lại xong, lượt kế lại 403 y hệt).
 */
import { describe, it, expect } from "vitest";
import { moTaLoiHttp, laLoi401, LoiHttp } from "./loiHttp";

describe("moTaLoiHttp", () => {
  it("★★★ 401 ⇒ mời đăng nhập lại", () => {
    expect(moTaLoiHttp(401, null)).toContain("đăng nhập lại");
  });

  it("★★★ 403 kèm code ⇒ KHÔNG mời đăng nhập lại, giữ nguyên câu + mã của máy chủ", () => {
    const s = moTaLoiHttp(403, {
      success: false,
      error: "Bạn phải đổi mật khẩu trước khi tiếp tục",
      code: "MUST_CHANGE_PASSWORD",
    });
    expect(s).not.toContain("đăng nhập lại");
    expect(s).toContain("Bạn phải đổi mật khẩu trước khi tiếp tục");
    expect(s).toContain("MUST_CHANGE_PASSWORD");
  });

  it("★★★ 500 kèm message ⇒ báo đúng mã + câu máy chủ, KHÔNG bịa cách khắc phục", () => {
    const s = moTaLoiHttp(500, { success: false, error: "Mất kết nối cơ sở dữ liệu" });
    expect(s).toContain("500");
    expect(s).toContain("Mất kết nối cơ sở dữ liệu");
    expect(s).not.toContain("đăng nhập lại");
  });

  it("★★ thân KHÔNG PHẢI JSON (đã phân giải thất bại ⇒ null) vẫn ra câu, KHÔNG NÉM", () => {
    expect(() => moTaLoiHttp(404, null)).not.toThrow();
    expect(moTaLoiHttp(404, null)).toBe("Máy chủ trả 404.");
  });
});

describe("laLoi401", () => {
  it("★★★ CHỈ 401 mới đúng — 403/500/lỗi thường không phải", () => {
    expect(laLoi401(new LoiHttp(401, "x"))).toBe(true);
    expect(laLoi401(new LoiHttp(403, "x"))).toBe(false);
    expect(laLoi401(new LoiHttp(500, "x"))).toBe(false);
    expect(laLoi401(new Error("x"))).toBe(false);
    expect(laLoi401(null)).toBe(false);
  });
});
