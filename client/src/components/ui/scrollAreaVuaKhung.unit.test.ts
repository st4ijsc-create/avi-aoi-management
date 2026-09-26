/**
 * ★★★ 2026-08-23 — LƯỚI CHO HAI Ô MỞ CỦA `ScrollArea`: `vuaKhung` và `ngang`.
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest client gom bằng `client/src/**\/*.unit.test.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG CANH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Radix chèn trong `Viewport` một `<div style="display:table">` — shrink-to-fit — nên bất kỳ khối
 * con nào rộng hơn khung đều KÉO CẢ TẤM BẢNG rộng ra. Đo được ở `/ai-coding-workspace` (1600×1000,
 * 2026-08-23): `clientWidth 400` · `scrollWidth 736`, và **không có thanh cuộn ngang nào** để tới
 * 336 px kia. Hậu quả ở đúng thẻ duyệt HITL: nút "Hủy" hiện **12,2%**, "Duyệt & ghi" hiện **100%**.
 *
 * `vuaKhung` ép tấm bảng ấy về `display:block`. Đó là chốt cưỡng chế MẠNH NHẤT của bản vá — nên nó
 * phải có lưới, và lưới phải hỏi CÂY ĐÃ RENDER chứ không hỏi mã nguồn.
 *
 * ⚠ Giới hạn thành thật của ô này: `renderToStaticMarkup` cho biết LỚP có được gắn không, KHÔNG
 *   cho biết trình duyệt tính ra `display: block` hay không (không có CSS engine ở đây). Phần ấy
 *   do nghiệm thu live trả lời — và nó đã trả lời: sau bản vá `scrollWidth === clientWidth` ở cả
 *   ba cỡ màn (440/440 · 920/920 · 756/756). Đừng để ô này trôi thành "đã canh hết rồi".
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, f?: string) => f ?? "", i18n: { language: "vi" } }),
}));

const { ScrollArea } = await import("./scroll-area");

function ve(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(ScrollArea as never, props, createElement("p", null, "nội dung")));
}

/** React SSR thoát `&`/`<`/`>`/`"` — lớp Tailwind `[&>div]:!block` ra HTML thành `[&amp;&gt;div]…`. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Bóc `class` của thẻ mang `data-slot="scroll-area-viewport"`. */
function classViewport(html: string): string {
  const i = html.indexOf('data-slot="scroll-area-viewport"');
  if (i < 0) return "";
  return /class="([^"]*)"/.exec(html.slice(html.lastIndexOf("<", i), html.indexOf(">", i)))?.[1] ?? "";
}

describe("§1 `vuaKhung` — ô mở, và nó THẬT SỰ đổi cây", () => {
  it("★ BẰNG CHỨNG cơ chế: Radix THẬT SỰ chèn một `<div style=\"min-width:100%;display:table\">`", () => {
    // Ô này KHÔNG kiểm bản vá — nó kiểm **tiền đề** của bản vá. Radix đổi cách dựng ở một bản nâng
    // cấp ⇒ `[&>div]` trỏ vào hư không và cả bản vá im lặng vô hiệu. Ô này bắt đúng ngày đó.
    expect(ve()).toContain("display:table");
  });

  it("BẬT ⇒ viewport mang lớp ép `display:block` cho tấm bảng ấy + cờ `data-vua-khung`", () => {
    const html = ve({ vuaKhung: true });
    expect(classViewport(html)).toContain(esc("[&>div]:!block"));
    expect(html).toContain('data-vua-khung="1"');
  });

  it("★ TẮT (mặc định) ⇒ KHÔNG có lớp ấy — phạm vi nổ bằng 0 cho mọi nơi dùng khác", () => {
    const html = ve();
    expect(classViewport(html)).not.toContain(esc("[&>div]:!block"));
    expect(html).not.toContain("data-vua-khung");
    // …nhưng vẫn là một ScrollArea bình thường, tức ô trên tắt vì ĐÚNG lý do.
    expect(html).toContain('data-slot="scroll-area-viewport"');
    expect(html).toContain("nội dung");
  });
});

describe("§2 `ngang` — LƯỚI AN TOÀN, không phải cách chữa hàng nút", () => {
  /**
   * ⚠ Vì sao ô này KHÔNG đọc HTML: Radix **không dựng thanh cuộn nào lúc SSR** (nó chỉ dựng sau khi
   * đo được trong trình duyệt) — đã kiểm: chuỗi HTML của `<ScrollArea ngang>` không có một
   * `data-slot="scroll-area-scrollbar"` nào. Một ô hỏi HTML sẽ ĐỎ mãi mãi vì lý do SAI.
   * Nên hỏi đúng thứ ta sở hữu: **cây phần tử `ScrollArea` TRẢ VỀ**. `ScrollArea` không dùng hook
   * nào nên gọi thẳng như một hàm thuần là hợp lệ.
   */
  function huongThanhCuon(props: Record<string, unknown>): string[] {
    const cay = (ScrollArea as unknown as (p: Record<string, unknown>) => any)({ ...props, children: null });
    const con = Array.isArray(cay.props.children) ? cay.props.children.flat(3) : [cay.props.children];
    return con
      .filter((c: any) => c && typeof c === "object" && typeof c.type === "function" && c.type.name === "ScrollBar")
      .map((c: any) => (c.props?.orientation as string) ?? "vertical");
  }

  it("mặc định TẮT: đúng MỘT thanh cuộn, phương DỌC", () => {
    expect(huongThanhCuon({})).toEqual(["vertical"]);
  });

  it("BẬT ⇒ có thêm một thanh cuộn phương NGANG", () => {
    expect(huongThanhCuon({ ngang: true })).toEqual(["vertical", "horizontal"]);
  });
});
