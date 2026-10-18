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
  it("★★ hợp lệ (origin RIÊNG khác site) ⇒ BẬT, host mặc định 0.0.0.0; origin công khai chỉ nhận origin http(s) sạch", () => {
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "http://10.0.0.9:5099" }, 3000)).toMatchObject({
      bat: true, cong: 5099, host: "0.0.0.0", originCongKhai: "http://10.0.0.9:5099",
    });
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "javascript:alert(1)" }, 3000)).toMatchObject({ bat: false, originCongKhai: null, lyDoTat: "ORIGIN_KHONG_HOP_LE" });
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "http://a:b@x:1/" }, 3000)).toMatchObject({ bat: false, originCongKhai: null, lyDoTat: "ORIGIN_KHONG_HOP_LE" });
  });
});

describe("§1b — ★★★ vá cookie-tossing: origin xem trước PHẢI khác SITE với ứng dụng (fail-closed)", () => {
  it("★★★ có cổng nhưng VẮNG AI_PREVIEW_PUBLIC_ORIGIN ⇒ TẮT (THIEU_ORIGIN_RIENG) — không còn suy từ host của yêu cầu", () => {
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099" }, 3000)).toMatchObject({ bat: false, lyDoTat: "THIEU_ORIGIN_RIENG" });
  });
  it("★★★ origin công khai thuộc nhóm loopback 'tên' (cùng site với ứng dụng trên máy chủ) ⇒ TẮT (ORIGIN_CUNG_SITE)", () => {
    for (const o of ["http://localhost:5099", "http://127.0.0.1:5099", "http://[::1]:5099", "http://x.localhost:5099"]) {
      expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: o }, 3000), o).toMatchObject({ bat: false, lyDoTat: "ORIGIN_CUNG_SITE" });
    }
  });
  it("★★ cùng site với một origin tin cậy của ứng dụng (ALLOWED_ORIGINS) ⇒ TẮT", () => {
    const env = { AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "http://preview.factory.vn:5099", ALLOWED_ORIGINS: "https://mes.factory.vn" };
    expect(docCauHinhXemTruoc(env, 3000)).toMatchObject({ bat: false, lyDoTat: "ORIGIN_CUNG_SITE" });
  });
  it("★★ máy dev: http://127.0.0.2:<cổng> ⇒ BẬT (khác site với 127.0.0.1/localhost)", () => {
    expect(docCauHinhXemTruoc({ AI_PREVIEW_PROXY_PORT: "5099", AI_PREVIEW_PUBLIC_ORIGIN: "http://127.0.0.2:5099" }, 3000)).toMatchObject({ bat: true, lyDoTat: null });
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
