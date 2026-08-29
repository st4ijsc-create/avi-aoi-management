/**
 * LƯỚI khung HTML của webview: CSP phải KHOÁ, và script phải chạy bằng nonce. Một webview lỡ mở
 * `script-src *` là lỗ hổng im lặng — không ai thấy cho tới lúc bị lợi dụng.
 */
import { describe, it, expect } from "vitest";
import { dungHtmlBang } from "./htmlBang";

describe("dungHtmlBang", () => {
  const html = dungHtmlBang({ nonce: "NONCE123" });

  it("★★★ có CSP và script chạy bằng nonce", () => {
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("nonce-NONCE123");
    expect(html).toContain('<script nonce="NONCE123">');
  });

  it("★★★ KHÔNG mở script-src cho mọi nguồn", () => {
    expect(html).not.toMatch(/script-src[^;]*\*/);
    expect(html).not.toContain("unsafe-inline");
  });

  it("★★ có ô nhập, nút gửi và vùng hội thoại", () => {
    expect(html).toContain('id="o-nhap"');
    expect(html).toContain('id="nut-gui"');
    expect(html).toContain('id="hoi-thoai"');
  });

  it("★★★ có ô chọn dự án", () => {
    expect(html).toContain('id="o-du-an"');
  });

  it("★★★ I3: webview xử `hoan_tat` — thay chữ khi degraded, hiện cảnh báo cắt ngang/khung hỏng", () => {
    expect(html).toContain('m.loai === "hoan_tat"');
    expect(html).toContain("m.vanBanCuoi");
    expect(html).toContain("m.canhBao");
  });

  it("★★★ webview BÁO SẴN SÀNG sau khi đăng ký lắng nghe (chống đua mất danh sách dự án)", () => {
    // Nếu extension gửi danh sách TRƯỚC khi webview lắng nghe, danh sách rơi mất mà không có lỗi
    // nào — ô chọn trống một cách im lặng. Bắt tay bằng `san_sang` là thứ chặn đúng lớp lỗi đó.
    const viTriDangKy = html.indexOf('addEventListener("message"');
    const viTriBao = html.indexOf('loai: "san_sang"');
    expect(viTriDangKy).toBeGreaterThan(-1);
    expect(viTriBao).toBeGreaterThan(viTriDangKy); // báo SAU khi đã lắng nghe
  });

  it("★★★ thẻ duyệt tồn tại và MẶC ĐỊNH ẨN", () => {
    expect(html).toContain('id="the-duyet" hidden');
  });

  it("★★★ thẻ duyệt có nhãn nguồn, đường dẫn, tóm tắt, hạn duyệt và đủ ba nút", () => {
    expect(html).toContain('id="duyet-nguon"');
    expect(html).toContain('id="duyet-duong"');
    expect(html).toContain('id="duyet-tom-tat"');
    expect(html).toContain('id="duyet-han"');
    expect(html).toContain('id="nut-xem-diff"');
    expect(html).toContain('id="nut-duyet"');
    expect(html).toContain('id="nut-huy"');
  });

  it("★★★ nút duyệt nói rõ ghi Ở SERVER (không được mập mờ về nơi byte sẽ đổi)", () => {
    const m = html.match(/<button id="nut-duyet">([^<]*)<\/button>/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("SERVER");
  });

  it("★★ webview chuyển tiếp cú bấm ba nút thẻ duyệt cho extension, KHÔNG tự quyết", () => {
    expect(html).toContain('loai: "xem_diff"');
    expect(html).toContain('loai: "duyet"');
    expect(html).toContain('loai: "huy"');
  });

  it("★★ webview xử lý the_duyet (hiện thẻ) / an_the_duyet (ẩn thẻ) / thong_bao (báo kết quả)", () => {
    expect(html).toContain('m.loai === "the_duyet"');
    expect(html).toContain('m.loai === "an_the_duyet"');
    expect(html).toContain('m.loai === "thong_bao"');
  });
});
