/**
 * ★★★ 2026-08-25 — LƯỚI cho **GỢI Ý TỆP** (@-mention autocomplete, `GoiYTep.tsx`).
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc: `vitest.config.ts` gom test client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt `.test.ts` là vitest lặng lẽ bỏ qua trong khi cổng vẫn
 *   khai XANH — lớp "glob rỗng" đã che ca đỏ nhiều lần ở dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HAI NỬA, HAI CÁCH ĐO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * §1 đo HÀM THUẦN `locTepTheoQuery` — thứ hạng là hành vi, hỏi thẳng bằng `toEqual`, không soi HTML.
 * §2 đo CÂY THẬT của `GoiYTep` (`renderToStaticMarkup`, khuôn `bangProblems.unit.test.ts`): hỏi
 * "cái gì RA HTML", không phải "mã có chuỗi ấy". Không cần mock `react-i18next` — component KHÔNG
 * dùng i18n (dropdown chỉ có đường dẫn, không câu chữ nào để dịch).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • bỏ ưu tiên basename-prefix (gộp mọi khớp về một hạng "chứa trong đường dẫn")
 *       ⇒ §1.2 ĐỎ — ca dàn ý CỐ Ý cho basename-prefix nằm trên đường DÀI hơn: chỉ CẤP BẬC đẩy nó
 *         lên, tiebreak độ-dài đẩy nó xuống. Mất cấp bậc ⇒ thứ tự lật.
 *   • bỏ điều kiện `i === chiSoChon` (mọi mục `aria-selected="true"`)
 *       ⇒ §2.3 ĐỎ — đếm được đúng MỘT "true" và đúng N−1 "false".
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const { GoiYTep, locTepTheoQuery, tachTen } = await import("./GoiYTep");
const NGUON = readFileSync(join(HERE, "GoiYTep.tsx"), "utf8").replace(/\r\n/g, "\n");

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§1 locTepTheoQuery — LỌC + XẾP HẠNG (nơi DUY NHẤT quyết định thứ hạng)", () => {
  it("★★★ 1.1 basename-prefix > basename-contains > path-contains (thứ tự KHÔNG theo đầu vào)", () => {
    // Đầu vào cố ý ĐẢO lộn để chứng minh là XẾP HẠNG quyết định, không phải thứ tự truyền vào.
    const ds = ["src/other/recalc.ts", "docs/calc-x/n.md", "src/Calculator.cs"];
    expect(locTepTheoQuery(ds, "calc")).toEqual([
      "src/Calculator.cs", //     hạng 0: basename "Calculator.cs" BẮT ĐẦU bằng "calc"
      "src/other/recalc.ts", //   hạng 1: basename "recalc.ts" CHỨA "calc"
      "docs/calc-x/n.md", //      hạng 2: chỉ THƯ MỤC chứa "calc" (basename "n.md" thì không)
    ]);
  });

  it("★★★ 1.2 ĐỘT BIẾN-CATCHER: basename-prefix trên đường DÀI vẫn thắng path-contains trên đường NGẮN", () => {
    // "a/b/c/d/e/Query.ts" (18) hạng 0 nhưng DÀI; "query/z.ts" (10) hạng 2 nhưng NGẮN.
    // Xếp hạng đúng ⇒ Query.ts trước. Nếu bỏ cấp bậc (chỉ substring đường dẫn, sắp theo độ dài)
    // ⇒ z.ts ngắn hơn nên nhảy lên trước ⇒ khẳng định dưới ĐỎ. Đây là ca khoá cho đột biến.
    const r = locTepTheoQuery(["query/z.ts", "a/b/c/d/e/Query.ts"], "query");
    expect(r[0]).toBe("a/b/c/d/e/Query.ts");
    expect(r[1]).toBe("query/z.ts");
  });

  it("★ 1.3 trong cùng hạng: đường NGẮN hơn lên trước (tiebreak độ dài)", () => {
    const r = locTepTheoQuery(["a/b/c/index.ts", "x/index.ts"], "index");
    expect(r).toEqual(["x/index.ts", "a/b/c/index.ts"]);
  });

  it("★ 1.4 KHÔNG phân biệt hoa/thường", () => {
    expect(locTepTheoQuery(["src/StringUtils.ts"], "STRINGUTILS")).toEqual(["src/StringUtils.ts"]);
    expect(locTepTheoQuery(["src/StringUtils.ts"], "stringutils")).toEqual(["src/StringUtils.ts"]);
    // khớp giữa tên, vẫn không phân biệt hoa
    expect(locTepTheoQuery(["src/StringUtils.ts"], "UTILS")).toEqual(["src/StringUtils.ts"]);
  });

  it("★ 1.5 query rỗng (hoặc chỉ khoảng trắng) ⇒ `tran` tệp ĐẦU, giữ nguyên thứ tự đầu vào", () => {
    const ds = ["a.ts", "b.ts", "c.ts", "d.ts"];
    expect(locTepTheoQuery(ds, "", 2)).toEqual(["a.ts", "b.ts"]);
    expect(locTepTheoQuery(ds, "   ", 2)).toEqual(["a.ts", "b.ts"]);
  });

  it("★ 1.6 trần `tran`: cắt đúng số kết quả (tuỳ chỉnh và mặc định = 8)", () => {
    const ds = Array.from({ length: 20 }, (_, i) => `d${i}/util.ts`); // tất cả basename-prefix "util"
    expect(locTepTheoQuery(ds, "util", 5)).toHaveLength(5);
    expect(locTepTheoQuery(ds, "util")).toHaveLength(8); // mặc định
    expect(locTepTheoQuery(ds, "", 3)).toHaveLength(3); // trần cũng áp cho query rỗng
  });

  it("★ 1.7 không khớp ở đâu ⇒ mảng rỗng (không phải trả cả danh sách)", () => {
    expect(locTepTheoQuery(["src/a.ts", "src/b.ts"], "zzzznope")).toEqual([]);
  });

  it("★ 1.8 `tachTen`: basename + thư-mục-kèm-`/`; tệp gốc ⇒ thư mục rỗng", () => {
    expect(tachTen("src/util/Beta.ts")).toEqual({ thuMuc: "src/util/", ten: "Beta.ts" });
    expect(tachTen("Gamma.ts")).toEqual({ thuMuc: "", ten: "Gamma.ts" });
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
type Props = Parameters<typeof GoiYTep>[0];
function ve(dsKhop: readonly string[], chiSoChon: number): string {
  return renderToStaticMarkup(createElement(GoiYTep, { dsKhop, chiSoChon, onChon: () => {} } as Props));
}
const DS = ["src/Alpha.ts", "src/util/Beta.ts", "Gamma.ts"];

describe("§2 GoiYTep — dropdown THUẦN HIỂN THỊ", () => {
  it("★★★ 2.1 dsKhop rỗng ⇒ null (KHÔNG render hộp rỗng)", () => {
    expect(ve([], 0)).toBe("");
  });

  it("★★★ 2.2 N mục ⇒ N `role=\"option\"` trong một `role=\"listbox\"`", () => {
    const html = ve(DS, 0);
    expect(html).toContain('role="listbox"');
    expect((html.match(/role="option"/g) ?? []).length).toBe(3);
    expect((html.match(/data-muc-goi-y/g) ?? []).length).toBe(3);
  });

  it("★★★ 2.3 chiSoChon=1 ⇒ ĐÚNG MỘT `aria-selected=\"true\"` (là mục 1), còn lại `\"false\"`", () => {
    const html = ve(DS, 1);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
    expect((html.match(/aria-selected="false"/g) ?? []).length).toBe(2);
    // …và mục được tô là mục index 1 (Beta.ts), không phải mục khác.
    const iSel = html.indexOf('aria-selected="true"');
    const doan = html.slice(iSel, html.indexOf("</div>", iSel));
    expect(doan).toContain("Beta.ts");
    // Mục đang chọn mang nền active.
    const the = html.slice(html.lastIndexOf("<", iSel), html.indexOf(">", iSel));
    expect(the).toContain("bg-muted");
  });

  it("★ 2.4 chiSoChon ngoài dải ⇒ KHÔNG mục nào được tô (mọi `aria-selected=\"false\"`)", () => {
    for (const cs of [-1, 3, 99]) {
      const html = ve(DS, cs);
      expect(html).not.toContain('aria-selected="true"');
      expect((html.match(/aria-selected="false"/g) ?? []).length).toBe(3);
    }
  });

  it("★ 2.5 mỗi mục: basename ĐẬM (font-medium) + đường-dẫn-thư-mục MỜ; tệp gốc KHÔNG có thư mục", () => {
    const html = ve(DS, 0);
    // basename mọi mục.
    expect((html.match(/data-ten/g) ?? []).length).toBe(3);
    for (const ten of ["Alpha.ts", "Beta.ts", "Gamma.ts"]) expect(html).toContain(ten);
    // span basename mang font-medium (đậm).
    const i = html.indexOf("data-ten");
    const the = html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
    expect(the).toContain("font-medium");
    // thư mục MỜ: chỉ 2 mục không-gốc có `data-thu-muc` (Gamma.ts ở gốc thì KHÔNG).
    expect((html.match(/data-thu-muc/g) ?? []).length).toBe(2);
    expect(html).toContain("src/util/");
    expect(html).toContain("text-muted-foreground");
  });

  it("★ 2.6 CENSUS: bấm mục nối đúng `onChon(duong)` (static markup không thấy handler nên quét mã)", () => {
    // renderToStaticMarkup KHÔNG render onMouseDown ⇒ đo dây nối qua mã nguồn. Cũng khẳng định
    // dùng onMouseDown (giữ focus ô nhập), không onClick.
    expect(NGUON).toContain("onChon(duong)");
    expect(NGUON).toContain("onMouseDown");
    expect(NGUON).toContain("e.preventDefault()");
  });
});
