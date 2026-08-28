/**
 * LƯỚI thoát HTML. Model sinh chữ tự do; nhét thẳng vào innerHTML là mở cửa cho mã chạy trong
 * webview. Đây là vị từ chặn.
 */
import { describe, it, expect } from "vitest";
import { thoatHtml } from "./thoatHtml";

describe("thoatHtml", () => {
  it("★★★ vô hiệu hoá thẻ script", () => {
    expect(thoatHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });
  it("★★★ thoát dấu nháy và &", () => {
    expect(thoatHtml(`a & "b" 'c'`)).toBe("a &amp; &quot;b&quot; &#39;c&#39;");
  });
  it("★★ chữ thường không đổi", () => {
    expect(thoatHtml("Xin chào")).toBe("Xin chào");
  });
});
