/**
 * LƯỚI khung HTML "Bộ nhớ dài hạn" (ĐỢT H / TASK H3 / B2) — cùng khuôn `htmlBang.unit.test.ts`:
 * CSP phải KHOÁ, script phải chạy bằng nonce, nội dung động phải THOÁT HTML.
 */
import { describe, it, expect } from "vitest";
import { dungHtmlBoNho } from "./htmlBoNho";
import type { MucBoNho } from "../loi/khoBoNho";

function muc(overrides: Partial<MucBoNho> = {}): MucBoNho {
  return { ma: "m1", noiDung: "Dự án dùng workspaceState.", thoiDiem: 1735689600000, nguon: "nguoi_dung_bao_nho", ...overrides };
}

describe("dungHtmlBoNho", () => {
  it("★★★ có CSP và script chạy bằng nonce", () => {
    const html = dungHtmlBoNho({ nonce: "NONCE123", ds: [] });
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-NONCE123");
    expect(html).toContain('<script nonce="NONCE123">');
  });

  it("★★★ KHÔNG mở script-src cho mọi nguồn, không unsafe-inline", () => {
    const html = dungHtmlBoNho({ nonce: "N", ds: [] });
    expect(html).not.toMatch(/script-src[^;]*\*/);
    expect(html).not.toContain("unsafe-inline");
  });

  it("★ danh sách RỖNG ⇒ thông báo rỗng, KHÔNG dựng <ul>", () => {
    const html = dungHtmlBoNho({ nonce: "N", ds: [] });
    expect(html).toContain('id="rong"');
    expect(html).not.toContain('id="danh-sach"');
  });

  it("★★★ NHÌN THẤY ĐƯỢC — mỗi mục hiện ĐẦY ĐỦ nội dung, nguồn, thời điểm", () => {
    const html = dungHtmlBoNho({
      nonce: "N",
      ds: [muc({ noiDung: "Luôn dùng vitest, không dùng jest.", nguon: "ai_de_xuat_duyet" })],
    });
    expect(html).toContain("Luôn dùng vitest, không dùng jest.");
    expect(html).toContain("AI đề xuất, đã duyệt");
  });

  it("★★ nguồn 'nguoi_dung_bao_nho' hiện nhãn KHÁC 'ai_de_xuat_duyet' — không lẫn lộn hai nguồn", () => {
    const html = dungHtmlBoNho({ nonce: "N", ds: [muc({ nguon: "nguoi_dung_bao_nho" })] });
    expect(html).toContain("Người dùng yêu cầu nhớ");
    expect(html).not.toContain("AI đề xuất, đã duyệt");
  });

  it("★★★ XOÁ TỪNG MỤC — mỗi mục có nút xoá mang ĐÚNG `ma` của nó", () => {
    const html = dungHtmlBoNho({ nonce: "N", ds: [muc({ ma: "ma-rieng-biet" })] });
    expect(html).toContain('class="nut-icon nut-xoa-muc" data-ma="ma-rieng-biet"');
    expect(html).toContain('loai: "xoa_muc"');
  });

  it("★★★ XOÁ TẤT CẢ — có nút, có bước xác nhận riêng, gửi đúng thông điệp", () => {
    const html = dungHtmlBoNho({ nonce: "N", ds: [muc()] });
    expect(html).toContain('id="nut-xoa-tat-ca"');
    expect(html).toContain('id="nut-xac-nhan-xoa-tat-ca"');
    expect(html).toContain('loai: "xoa_tat_ca"');
  });

  it("★ danh sách RỖNG ⇒ nút 'xoá tất cả' bị disabled (không có gì để xoá)", () => {
    const html = dungHtmlBoNho({ nonce: "N", ds: [] });
    expect(html).toMatch(/id="nut-xoa-tat-ca"[^>]*disabled/);
  });

  it("★★★ KHÔNG TIÊM HTML — nội dung mục nhớ chứa thẻ script/HTML phải bị THOÁT, không thực thi được", () => {
    const html = dungHtmlBoNho({
      nonce: "N",
      ds: [muc({ noiDung: "<script>alert(1)</script> và \"trích dẫn\" & dấu &" })],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("★ mã (ma) chứa ký tự đặc biệt cũng phải được THOÁT trong thuộc tính data-ma", () => {
    const html = dungHtmlBoNho({ nonce: "N", ds: [muc({ ma: '"><img src=x>' })] });
    expect(html).not.toContain('data-ma=""><img src=x>"');
    expect(html).toContain("&quot;&gt;&lt;img");
  });
});
