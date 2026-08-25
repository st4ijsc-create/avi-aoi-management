/**
 * ★★★ 2026-08-25 — LƯỚI RENDER + LOGIC cho **TRÌNH XEM MÃ** (`TrinhXemMa`).
 *
 * ⚠ Đuôi `.unit.test.ts` là BẮT BUỘC: `vitest.config.ts` gom test client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi cổng
 *   khai XANH — lớp "glob rỗng" đã che ca đỏ nhiều lần ở repo này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO **MOCK** `streamdown` — và ranh giới của lưới này
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `Streamdown` tô cú pháp bằng Shiki BẤT ĐỒNG BỘ trong `useEffect` (và `fetch` ngôn ngữ từ CDN cho
 * ngôn ngữ ngoài bộ gói). `renderToStaticMarkup` KHÔNG chạy effect ⇒ Streamdown thật chỉ ra mã trơn
 * lúc SSR — test nội bộ Shiki ở đây là test một thứ không xảy ra. Nên ta MOCK `streamdown` thành
 * `<pre data-streamdown>{children}</pre>`: `children` chính là chuỗi fenced ```<lang>…``` mà component
 * dựng, nên lưới đo được ĐÚNG phần LOGIC của component (suy lang · gutter số dòng · tô-sáng đúng dòng
 * · lớp cuộn-ngang · chuẩn hoá CRLF/BOM) mà không phụ thuộc runtime Shiki/mạng.
 *
 * Component KHÔNG dùng `react-i18next` (không có chữ dịch — chỉ số dòng + mã), nên KHÔNG mock nó.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// MOCK Streamdown: phơi `children` (chuỗi fenced) ra HTML tĩnh để lưới soi được lang + nội dung.
vi.mock("streamdown", () => ({
  Streamdown: ({ children }: { children?: ReactNode }) =>
    createElement("pre", { "data-streamdown": "mock" }, children),
}));

const { TrinhXemMa, suyNgonNgu, chuanHoaNoiDung, tachDong, soBacktickRao } = await import(
  "./TrinhXemMa"
);

type Props = Parameters<typeof TrinhXemMa>[0];
function ve(over: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(TrinhXemMa, {
      noiDung: "using System;\nclass A { }\n",
      duongDan: "src/A.cs",
      dongMucTieu: null,
      ...over,
    } as Props),
  );
}

/** Bóc `class` của phần tử MANG một thuộc tính mốc (cùng kỹ thuật `classHangNut` của theDuyetDiff). */
function classCuaMoc(html: string, moc: string): string {
  const i = html.indexOf(moc);
  if (i < 0) return "";
  const the = html.slice(html.lastIndexOf("<", i), html.indexOf(">", i));
  return /class="([^"]*)"/.exec(the)?.[1] ?? "";
}

/** Đếm số lần một mẫu xuất hiện trong HTML. */
function dem(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}

describe("§1 SUY NGÔN NGỮ theo đuôi tệp (`suyNgonNgu`) — thuần, toBe", () => {
  it("bảng chính khớp brief", () => {
    expect(suyNgonNgu("a.cs")).toBe("csharp");
    expect(suyNgonNgu("a.ts")).toBe("typescript");
    expect(suyNgonNgu("a.tsx")).toBe("typescript"); // brief chốt tsx→typescript
    expect(suyNgonNgu("a.json")).toBe("json");
    expect(suyNgonNgu("a.xaml")).toBe("xml");
    expect(suyNgonNgu("a.xml")).toBe("xml");
    expect(suyNgonNgu("a.py")).toBe("python");
    expect(suyNgonNgu("a.md")).toBe("markdown");
  });

  it("đuôi lạ / không đuôi ⇒ `text`; hoa-thường không phân biệt; lấy đuôi CUỐI", () => {
    expect(suyNgonNgu("a.qwerty")).toBe("text");
    expect(suyNgonNgu("Makefile")).toBe("text");
    expect(suyNgonNgu("")).toBe("text");
    expect(suyNgonNgu("SRC/FOO.CS")).toBe("csharp"); // .CS hoa
    expect(suyNgonNgu("a.min.js")).toBe("javascript"); // đuôi cuối
    expect(suyNgonNgu("proj/App.csproj")).toBe("xml");
  });
});

describe("§2 CHUẨN HOÁ nội dung — số dòng KHÔNG lệch (`chuanHoaNoiDung`/`tachDong`)", () => {
  it("★★★ CRLF đếm ĐÚNG như LF — KHÔNG nhân đôi", () => {
    // Ba dòng dù ngăn bằng \r\n hay \n — luôn 3 dòng, không phải 6.
    expect(tachDong("a\r\nb\r\nc")).toEqual(["a", "b", "c"]);
    expect(tachDong("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(chuanHoaNoiDung("a\r\nb")).not.toContain("\r"); // \r đã biến mất khỏi bản hiển thị
  });

  it("bỏ BOM đầu tệp mà KHÔNG ăn ký tự thật; CR lẻ (Mac cũ) cũng thành ngắt dòng", () => {
    // BOM (U+FEFF) ở đầu: không thành dòng, không dính vào ký tự 'a' liền sau.
    expect(tachDong(String.fromCharCode(0xfeff) + "a\nb")).toEqual(["a", "b"]);
    expect(tachDong("a\rb")).toEqual(["a", "b"]);
  });

  it("bỏ ĐÚNG MỘT newline cuối (không đẻ dòng trống ảo), nhưng GIỮ dòng trống thật ở giữa/cuối", () => {
    expect(tachDong("a\nb\n")).toEqual(["a", "b"]); // newline kết thúc dòng 2 ⇒ 2 dòng
    expect(tachDong("a\nb\n\n")).toEqual(["a", "b", ""]); // dòng trống thật thứ 3 được giữ
  });
});

describe("§3 GUTTER — N dòng ⇒ N số THẬT (đo được), CRLF không nhân đôi", () => {
  it("N dòng ⇒ đúng N ô `data-so-dong`", () => {
    const noiDung = Array.from({ length: 7 }, (_, i) => `dong ${i + 1}`).join("\n");
    const html = ve({ noiDung, duongDan: "a.txt", dongMucTieu: null });
    expect(dem(html, /data-so-dong=/g)).toBe(7);
    // số dòng là chữ THẬT trong HTML (khác số CSS ::before của Streamdown) — dò dòng 1 và dòng 7.
    expect(html).toContain(">1</div>");
    expect(html).toContain(">7</div>");
  });

  it("★ nội dung CRLF ⇒ gutter đếm đúng, KHÔNG nhân đôi", () => {
    const html = ve({ noiDung: "a\r\nb\r\nc", duongDan: "a.txt" });
    expect(dem(html, /data-so-dong=/g)).toBe(3);
  });

  it("gutter là cột KHÔNG chọn được + KHÔNG cuộn ngang cùng mã (ẩn với screen-reader)", () => {
    const cls = classCuaMoc(ve(), "data-gutter");
    expect(cls).toContain("select-none");
    expect(cls).not.toContain("overflow-x-auto"); // gutter đứng yên; chỉ [data-ma] cuộn ngang
    expect(ve()).toContain('aria-hidden="true"');
  });
});

describe("§4 TÔ CÚ PHÁP qua Streamdown (đường sanctioned) — lang suy từ ĐUÔI", () => {
  it('`duongDan="…​.cs"` ⇒ khối fenced mở bằng ```csharp', () => {
    const html = ve({ duongDan: "src/StringUtils.cs" });
    expect(html).toContain('data-streamdown="mock"'); // đã đi qua Streamdown, không phải <pre> trơn
    expect(html).toMatch(/`{3,}csharp\n/); // fence (≥3 backtick) + lang
  });

  it("đuôi lạ ⇒ fence mở bằng `text`; nội dung KHÔNG mang \\r (đã chuẩn hoá)", () => {
    const html = ve({ noiDung: "x\r\ny", duongDan: "a.qwerty" });
    expect(html).toMatch(/`{3,}text\n/);
    expect(html).not.toContain("\r");
  });

  it("★ nội dung chứa ``` ⇒ hàng rào DÀI HƠN để không đóng fence sớm (soBacktickRao)", () => {
    expect(soBacktickRao("không có backtick")).toBe(3);
    expect(soBacktickRao("dòng có ``` ba backtick")).toBe(4);
    expect(soBacktickRao("k ```` bốn")).toBe(5);
    const html = ve({ noiDung: "md:\n```js\nx\n```\n", duongDan: "readme.md" });
    expect(html).toMatch(/`{4,}markdown\n/); // fence phải ≥4 vì nội dung có ```
  });
});

describe("§5 TÔ SÁNG `dongMucTieu` — đúng MỘT dòng, và chống tự thoả", () => {
  it("★★★ (đột biến: bỏ `=== dongMucTieu`) dongMucTieu=5 ⇒ ĐÚNG MỘT ô mang `data-dong-sang`", () => {
    const noiDung = Array.from({ length: 8 }, (_, i) => `d${i + 1}`).join("\n");
    const html = ve({ noiDung, duongDan: "a.txt", dongMucTieu: 5 });
    // Bỏ điều kiện `n === dongMucTieu` ⇒ mọi dòng sáng ⇒ số này thành 8 ⇒ ca ĐỎ.
    expect(dem(html, /data-dong-sang="true"/g)).toBe(1);
    // và ô sáng ấy có LỚP tô nền (không chỉ thuộc tính trơ).
    expect(classCuaMoc(html, 'data-dong-sang="true"')).toContain("bg-amber-100");
  });

  it("★ ca ÂM chống tự thoả (đứng cạnh ca dương trên): dongMucTieu=null ⇒ 0 ô sáng", () => {
    const noiDung = Array.from({ length: 8 }, (_, i) => `d${i + 1}`).join("\n");
    const html = ve({ noiDung, duongDan: "a.txt", dongMucTieu: null });
    expect(dem(html, /data-dong-sang="true"/g)).toBe(0);
  });

  it("dongMucTieu ngoài khoảng (99) ⇒ 0 ô sáng (không nổ, không dựng dòng ảo)", () => {
    const html = ve({ noiDung: "a\nb\nc", duongDan: "a.txt", dongMucTieu: 99 });
    expect(dem(html, /data-dong-sang="true"/g)).toBe(0);
    expect(dem(html, /data-so-dong=/g)).toBe(3);
  });
});

describe("§6 CUỘN NGANG (bỏ wrap) — luật là LỚP, không phải lời dặn", () => {
  it("vùng mã `[data-ma]` mang `overflow-x-auto`, và KHÔNG có `whitespace-pre-wrap` ở đâu cả", () => {
    const html = ve();
    expect(classCuaMoc(html, "data-ma")).toContain("overflow-x-auto");
    // `whitespace-pre-wrap` chính là hành vi CŨ (gấp dòng) mà màn này tồn tại để bỏ.
    expect(html).not.toContain("whitespace-pre-wrap");
  });

  it("khối CSS ghi-đè có ship (TẮT số dòng CSS + phẳng card Streamdown)", () => {
    const html = ve();
    expect(html).toContain("code-block-body"); // selector nhắm nội bộ Streamdown
    expect(html).toContain("content:none"); // tắt số dòng ::before có sẵn
  });
});
