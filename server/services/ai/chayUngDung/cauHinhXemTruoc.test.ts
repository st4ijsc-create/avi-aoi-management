/**
 * ★★★ Đợt 3c — CẤU HÌNH proxy xem trước + CORS không phản chiếu origin xem trước.
 *   • Vắng AI_PREVIEW_PROXY_PORT ⇒ TẮT (listener mạng mới không bật ngầm).
 *   • Cổng proxy trùng cổng ứng dụng / rơi vào dải ứng dụng ⇒ TẮT có mã (không bao giờ cùng origin với ứng dụng).
 *   • `laOriginXemTruoc` nhận ra origin proxy (theo cổng, hoặc AI_PREVIEW_PUBLIC_ORIGIN) — CORS của :3000 dùng nó.
 */
import { describe, it, expect } from "vitest";
import { docCauHinhXemTruoc, laOriginXemTruoc } from "./index";

describe("§1 — docCauHinhXemTruoc", () => {
  it("★★★ vắng cổng ⇒ TẮT (CHUA_CAU_HINH)", () => {
    expect(docCauHinhXemTruoc({}, 3000)).toMatchObject({ bat: false, lyDoTat: "CHUA_CAU_HINH" });
  });
  it("★★★ trùng cổng ứng dụng ⇒ TẮT — preview KHÔNG BAO GIỜ cùng origin với ứng dụng", () => {
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "3000" }, 3000)).toMatchObject({ bat: false, lyDoTat: "TRUNG_CONG_UNG_DUNG" });
  });
  it("★★ rơi vào dải ứng dụng ⇒ TẮT; cổng méo ⇒ TẮT", () => {
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5150" }, 3000)).toMatchObject({ bat: false, lyDoTat: "TRUNG_DAI_XEM_TRUOC" });
    for (const v of ["80", "abc", "70000"]) expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: v }, 3000).lyDoTat, v).toBe("CONG_KHONG_HOP_LE");
  });
  it("★★ hợp lệ ⇒ BẬT, host mặc định 0.0.0.0; origin công khai chỉ nhận origin http(s) sạch", () => {
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099" }, 3000)).toMatchObject({ bat: true, cong: 5099, host: "0.0.0.0", originCongKhai: null });
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "http://10.0.0.9:5099" }, 3000).originCongKhai).toBe("http://10.0.0.9:5099");
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "javascript:alert(1)" }, 3000).originCongKhai).toBeNull();
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "http://a:b@x:1/" }, 3000).originCongKhai).toBeNull();
  });
});

describe("§2 — laOriginXemTruoc (CORS ứng dụng KHÔNG phản chiếu)", () => {
  const env = { AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "http://10.0.0.9:5099" };
  it("★★★ origin trỏ cổng proxy (localhost hay host LAN) ⇒ true", () => {
    expect(laOriginXemTruoc("http://localhost:5099", env)).toBe(true);
    expect(laOriginXemTruoc("http://may-chu.local:5099", env)).toBe(true);
    expect(laOriginXemTruoc("http://10.0.0.9:5099", env)).toBe(true);
  });
  it("★★ CHỐNG VÁ QUÁ TAY — origin ứng dụng / vite dev ⇒ false; proxy chưa cấu hình ⇒ false", () => {
    expect(laOriginXemTruoc("http://localhost:3000", env)).toBe(false);
    expect(laOriginXemTruoc("http://localhost:5173", env)).toBe(false);
    expect(laOriginXemTruoc(undefined, env)).toBe(false);
    expect(laOriginXemTruoc("http://localhost:5099", {})).toBe(false);
  });
});
