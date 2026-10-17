/**
 * ★★★ ĐỢT 4B — lưới markdown an toàn: HTML thô / script / onerror / javascript: KHÔNG BAO GIỜ thành thẻ hay thuộc
 * tính — chỉ thành CHỮ trong cây danh-sách-trắng; khối mã giữ nguyên văn (để Chép/Chèn/Áp dụng đúng byte).
 */
import { describe, it, expect } from "vitest";
import { phanTichMarkdown, khoiMa, hrefAnToan, type NutMd } from "./markdownAnToan";

const LOAI_HOP_LE = new Set(["p", "blockquote", "li", "strong", "em", "del", "h", "ul", "ol", "code", "codespan", "a", "text", "br", "hr", "table"]);

function moiNut(ds: NutMd[], ra: NutMd[] = []): NutMd[] {
  for (const n of ds) {
    ra.push(n);
    if ("con" in n) moiNut(n.con, ra);
    if (n.t === "table") {
      n.dau.forEach((o) => moiNut(o, ra));
      n.hang.forEach((h) => h.forEach((o) => moiNut(o, ra)));
    }
  }
  return ra;
}

describe("markdown an toàn", () => {
  it("★★★ <script>, <img onerror>, <b> ⇒ CHỈ là chữ; mọi nút thuộc danh sách trắng", () => {
    const cay = phanTichMarkdown('xin <img src=x onerror="alert(1)"> **đậm**\n\n<script>alert(1)</script>\n\n| a |\n|---|\n| <b>2</b> |\n');
    const ds = moiNut(cay);
    expect(ds.every((n) => LOAI_HOP_LE.has(n.t))).toBe(true);
    const chu = ds.filter((n): n is Extract<NutMd, { t: "text" }> => n.t === "text").map((n) => n.chu).join("|");
    expect(chu).toContain('<img src=x onerror="alert(1)">');
    expect(chu).toContain("<script>alert(1)</script>");
    expect(chu).toContain("<b>");
    expect(ds.some((n) => n.t === "strong")).toBe(true);
  });

  it("★★★ liên kết javascript:/data:/vscode: ⇒ không có nút `a`; http(s) giữ href", () => {
    const cay = phanTichMarkdown("[x](javascript:alert(1)) [y](data:text/html,hi) [z](command:workbench.action.x) [ok](https://vi.wikipedia.org)");
    const a = moiNut(cay).filter((n): n is Extract<NutMd, { t: "a" }> => n.t === "a");
    expect(a.map((n) => n.href)).toEqual(["https://vi.wikipedia.org"]);
    expect(hrefAnToan("JaVaScRiPt:alert(1)")).toBeNull();
    expect(hrefAnToan("https://a b")).toBeNull();
  });

  it("★★★ khối mã giữ NGUYÊN VĂN (kể cả < & >) + ngôn ngữ; khoiMa liệt kê theo thứ tự", () => {
    const cay = phanTichMarkdown("Trước\n\n```ts\nif (a < b && c > d) {}\n```\n\n```\nthứ hai\n```\n");
    expect(khoiMa(cay)).toEqual([
      { ngonNgu: "ts", ma: "if (a < b && c > d) {}" },
      { ngonNgu: "", ma: "thứ hai" },
    ]);
  });

  it("★★ danh sách, tiêu đề, codespan, trích dẫn, việc cần làm", () => {
    const cay = phanTichMarkdown("# Tiêu đề\n\n- một `x<y`\n- [x] xong\n\n1. a\n2. b\n\n> trích\n");
    const ds = moiNut(cay);
    expect(ds.find((n) => n.t === "h")).toMatchObject({ cap: 1 });
    expect(ds.find((n) => n.t === "codespan")).toEqual({ t: "codespan", chu: "x<y" });
    expect(ds.some((n) => n.t === "ol")).toBe(true);
    expect(ds.some((n) => n.t === "blockquote")).toBe(true);
    expect(ds.some((n) => n.t === "text" && n.chu === "☑ ")).toBe(true);
  });
});
