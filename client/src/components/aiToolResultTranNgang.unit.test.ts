/**
 * ★★★ 2026-08-23 — LƯỚI CHO "THẺ KẾT QUẢ TOOL TRÀN NGANG RỒI BỊ CẮT CỨNG".
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest client gom bằng `client/src/**\/*.unit.test.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI ĐANG CANH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `whitespace-pre-line` GIỮ xuống dòng nhưng **không cho ngắt trong một "từ" dài**. Ở đường mã
 * nguồn, `textSummary` chở **đường dẫn tệp** và **băm sha256** — chuỗi không có một dấu cách nào.
 * Nghiệm thu live 2026-08-23 đo được trong khung hội thoại rộng 400 px: `scrollWidth 588…754` ⇒
 * **mất 188…354 px**, cắt cứng, và **không thanh cuộn ngang nào** để tới.
 *
 * ⚠ Ô này hỏi CÂY ĐÃ RENDER (`renderToStaticMarkup`), không hỏi mã nguồn: `break-words` có mặt ở
 *   chỗ khác trong tệp (dòng 783 vốn đã có) nên một lưới quét văn bản sẽ XANH kể cả khi hai nhánh
 *   `textSummary` — đúng hai chỗ hỏng — không được vá. Đây chính là "xanh vì lý do sai".
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (_k: string, f?: string) => f ?? "", i18n: { language: "vi" } }),
}));

const { AIToolResultCard } = await import("./AIToolResultCard");

/** Chuỗi KHÔNG có dấu cách — đúng hình dạng đã làm khung phình: đường dẫn + băm. */
const CHUOI_DAI =
  "server/services/aiLocalTools/writeHandlers/applyDiff.ts@bc007c9fcb199291a1b2c3d4e5f60718293a4b5c6d7e8f90";

/** Bóc `class` của thẻ chứa `moc` trong HTML. */
function classChua(html: string, moc: string): string {
  const i = html.indexOf(moc);
  if (i < 0) return "";
  const dau = html.lastIndexOf("<", i);
  return /class="([^"]*)"/.exec(html.slice(dau, html.indexOf(">", dau)))?.[1] ?? "";
}

function ve(data: unknown): string {
  return renderToStaticMarkup(
    createElement(AIToolResultCard as never, {
      toolResult: { type: "read_file", title: "Đọc tệp", data, textSummary: CHUOI_DAI },
    }),
  );
}

describe("hai nhánh `textSummary` đều ngắt được từ dài", () => {
  it("nhánh KHÔNG có hàng (fallback thẳng textSummary) mang `break-words` + `min-w-0`", () => {
    // `data` không phải hình dạng "rows" ⇒ rơi vào nhánh render thẳng `textSummary`.
    const html = ve(null);
    expect(html).toContain(CHUOI_DAI);
    const cls = classChua(html, CHUOI_DAI);
    expect(cls, "nhánh textSummary thiếu break-words").toContain("break-words");
    expect(cls).toContain("min-w-0");
    expect(cls).toContain("whitespace-pre-line"); // vẫn GIỮ xuống dòng — không vá quá tay
  });

  /**
   * ★★★ PHÁT HIỆN 2026-08-23 — **ô này thay cho một ô TÔI VIẾT SAI**, và phải nói ra.
   *
   * Bản đầu của lưới này có một ca *"nhánh GenericRows với 0 hàng cũng mang `break-words`"* dựng
   * bằng `data = { rows: [] }`. Nó XANH. Nó xanh **vì lý do sai**: `extractGenericRows` trả `null`
   * khi `rows.length === 0` (dòng 224), nên `{ rows: [] }` **không hề** đi vào `GenericRowsBody` —
   * nó rơi đúng về nhánh `textSummary` mà ca TRƯỚC đã kiểm. Hai ca, một nhánh.
   * Đột biến M15 (gỡ `break-words` ở dòng 794) **SỐNG SÓT** và chính nó bày ra chuyện đó.
   *
   * ⇒ Sự thật: nhánh `rows.length === 0` bên trong `GenericRowsBody` là **mã CHẾT** từ điểm gọi duy
   *   nhất. `break-words` ở đó là phòng thủ, KHÔNG có đường sống nào chạy qua, và lưới **không được
   *   phép khai là đã canh**. Ô dưới đây khoá đúng tiền đề ấy: ngày ai đó nới `extractGenericRows`
   *   cho mảng rỗng, ô này ĐỎ và người sửa biết phải đi vá lưới.
   */
  it("★ `{ rows: [] }` KHÔNG vào GenericRowsBody — nhánh rows-rỗng ở đó là mã CHẾT", () => {
    const html = ve({ rows: [] });
    // Nếu nó VÀO GenericRowsBody thì hộp ngoài sẽ có `max-h-56 overflow-y-auto`.
    expect(html).not.toContain("max-h-56");
    expect(classChua(html, CHUOI_DAI)).toContain("whitespace-pre-line");
  });

  it("nhánh GenericRows CÓ hàng: ô giá trị ngắt được từ dài (`break-words` + `min-w-0`)", () => {
    const html = ve({ rows: [{ label: "tệp", value: CHUOI_DAI }] });
    expect(html).toContain("max-h-56"); // đã vào đúng GenericRowsBody
    const cls = classChua(html, CHUOI_DAI);
    expect(cls, "ô giá trị thiếu break-words").toContain("break-words");
    expect(cls).toContain("min-w-0");
  });

  it("★ CHỐNG TỰ THOẢ: chuỗi thử KHÔNG có dấu cách — tức `break-words` là thứ DUY NHẤT cứu nó", () => {
    expect(CHUOI_DAI).not.toMatch(/\s/);
    expect(CHUOI_DAI.length).toBeGreaterThan(60);
  });
});
