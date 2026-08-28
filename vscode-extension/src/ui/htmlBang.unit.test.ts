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
});
