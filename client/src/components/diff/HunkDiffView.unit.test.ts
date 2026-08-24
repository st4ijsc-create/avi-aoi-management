/**
 * ★★★ 2026-08-24 — LƯỚI cho `HunkDiffView`: HỒI QUY hành vi mặc định · chế độ CHỈ-ĐỌC · XEM CẠNH NHAU.
 *
 * ⚠ Đuôi `.unit.test.ts` là **bắt buộc**: `vitest.config.ts` gom test client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt `.test.ts` thì vitest **lặng lẽ bỏ qua** trong khi cổng vẫn
 *   khai XANH — lớp "glob rỗng" đã che ca đỏ nhiều lần trong dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÂY THẬT (`renderToStaticMarkup`) CHỨ KHÔNG QUÉT VĂN BẢN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Câu hỏi ở đây là *"HTML thật có/không có cái nút ấy"*, không phải *"mã nguồn có chuỗi ấy"*. Một
 * lưới quét văn bản trả lời sai câu: chuỗi "Nhận khối" **vẫn nằm trong nguồn** ngay cả khi nó bị bọc
 * `{!readOnly && …}` — chỉ cây đã render mới nói được nó có RA HTML hay không. Đó chính là khác biệt
 * giữa "đo cái được vẽ" và "đo cái được viết" (bài học F1/F14/nhóm C của repo).
 *
 * §1 HỒI QUY — không truyền `readOnly` ⇒ nút "Nhận khối"/"Áp tất cả" CÒN NGUYÊN. Đây là chống hồi
 *    quy cho `TheDuyetDiff` (và `theDuyetDiff*.unit.test.ts`) vốn phụ thuộc hành vi mặc định ấy.
 * §2 CHỈ-ĐỌC — `readOnly` ẩn MỌI nhãn ghi (`accept`/`undo`/`applyAll`), NHƯNG diff vẫn render (một
 *    thẻ trống thì "không có nút ghi" là đúng một cách TẦM THƯỜNG — nên §2 khẳng định cả sự VẮNG của
 *    nút LẪN sự CÓ MẶT của nội dung diff). Đây cũng là ô bắt **đột biến bắt buộc** của brief: bỏ
 *    điều kiện `!readOnly` quanh nút "Nhận khối" ⇒ nhãn ấy rò vào HTML chỉ-đọc ⇒ ô này ĐỎ.
 * §3 XEM CẠNH NHAU — `kieuXem="canh_nhau"` ⇒ hai cột `grid-cols-2` + nhãn "Trước"/"Sau"; "gop"
 *    (mặc định) ⇒ KHÔNG có cả hai.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/**
 * `t` giả TRA THẬT `vi.json`. Một `t` trả về chính khoá sẽ làm mọi khẳng định xanh một cách tầm
 * thường (lưới giả); ở đây gõ sai khoá ⇒ ra `‹THIẾU:…›` ⇒ ô ĐỎ. Có nội suy `{{x}}` để nhãn ra HTML
 * là chuỗi thật ("1 khối") chứ không phải "{{n}} khối".
 */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

/** React SSR thoát `&`, `<`, `>`, `"` — mọi phép so chuỗi với HTML phải đi qua đây. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { HunkDiffView } = await import("./HunkDiffView");

/** Một khối duy nhất, có CẢ dòng xoá lẫn dòng thêm ⇒ chế độ cạnh-nhau có nội dung ở CẢ hai cột. */
const GOC = "alpha\nshared\n";
const SUA = "beta\nshared\n";

/** Chế độ TƯƠNG TÁC (mặc định): có `currentText`/`onApplyText` như `TheDuyetDiff`/`ProgrammingCopilotPanel`. */
function ve(over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(HunkDiffView as any, {
      base: GOC,
      suggested: SUA,
      currentText: GOC,
      onApplyText: () => {},
      ...over,
    }),
  );
}

/**
 * Chế độ CHỈ-ĐỌC, cố tình KHÔNG truyền `currentText`/`onApplyText` — đây vừa là chứng THỜI-GIAN-CHẠY
 * (render không nổ) vừa là chứng BIÊN-DỊCH (`npm run check` sẽ đỏ nếu hai prop ấy còn bắt buộc).
 */
function veChiDoc(over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(HunkDiffView as any, { base: GOC, suggested: SUA, readOnly: true, ...over }),
  );
}

const NHAN_KHOI = VI.diff.hunk.accept as string; // "Nhận khối"
const HOAN_TAC = VI.diff.hunk.undo as string; // "Hoàn tác"
const AP_TAT_CA = VI.diff.hunk.applyAll as string; // "Áp tất cả"
const TRUOC = VI.diff.hunk.before as string; // "Trước"
const SAU = VI.diff.hunk.after as string; // "Sau"
const MOT_KHOI = tThat("diff.hunk.count", { n: 1 }); // "1 khối"

describe("§1 HỒI QUY — mặc định (không readOnly) giữ nguyên đường tương tác", () => {
  it("★★★ render KHÔNG truyền `readOnly` ⇒ HTML còn nhãn 'Nhận khối' và 'Áp tất cả'", () => {
    const html = ve();
    expect(html).not.toContain("‹THIẾU:");
    expect(html).toContain(esc(NHAN_KHOI));
    expect(html).toContain(esc(AP_TAT_CA));
    // Có đúng một khối để ca hồi quy nói về đúng thứ nó tưởng.
    expect(html).toContain(esc(MOT_KHOI));
  });
});

describe("§2 CHỈ-ĐỌC — readOnly ẩn MỌI đường ghi, nhưng vẫn là một VIEW thật", () => {
  it("★★★ readOnly ⇒ HTML KHÔNG chứa 'Nhận khối' / 'Hoàn tác' / 'Áp tất cả'", () => {
    const html = veChiDoc();
    // Đối chứng CÓ-MẶT trước: thẻ đã render THẬT (không phải rỗng ⇒ vắng nút một cách tầm thường).
    expect(html).not.toContain("‹THIẾU:");
    expect(html).toContain(esc(MOT_KHOI));
    expect(html).toContain("alpha"); // dòng gốc
    expect(html).toContain("beta"); // dòng mới
    // …rồi mới đến sự VẮNG của mọi nhãn ghi.
    expect(html).not.toContain(esc(NHAN_KHOI));
    expect(html).not.toContain(esc(HOAN_TAC)); // che luôn "Hoàn tác hết" (revertAll) vì nó chứa "Hoàn tác"
    expect(html).not.toContain(esc(AP_TAT_CA));
  });

  it("★ chống tự thoả: cùng dữ liệu ở chế độ TƯƠNG TÁC thì 'Nhận khối' PHẢI có — ô §2 đỏ được", () => {
    // Nếu không có dòng này, một lỗi khiến readOnly render rỗng vẫn làm §2 xanh giả.
    expect(ve()).toContain(esc(NHAN_KHOI));
  });
});

describe("§3 XEM CẠNH NHAU — kieuXem đổi CÁCH VẼ, không đổi nút", () => {
  it("mặc định 'gop' ⇒ KHÔNG có cột (không `grid-cols-2`, không nhãn Trước/Sau)", () => {
    const html = ve();
    expect(html).not.toContain("grid-cols-2");
    expect(html).not.toContain(esc(TRUOC));
    expect(html).not.toContain(esc(SAU));
  });

  it("★★ 'canh_nhau' ⇒ hai cột `grid-cols-2` + nhãn 'Trước'/'Sau', và nội dung nằm đúng cột", () => {
    const html = ve({ kieuXem: "canh_nhau" });
    expect(html).toContain("grid-cols-2");
    expect(html).toContain(esc(TRUOC));
    expect(html).toContain(esc(SAU));
    // "Trước" đứng trước "Sau" trong thứ tự tài liệu (cột trái = removed, cột phải = added).
    expect(html.indexOf(esc(TRUOC))).toBeLessThan(html.indexOf(esc(SAU)));
  });

  it("★ cạnh-nhau cũng chạy ở chế độ CHỈ-ĐỌC (thẻ duyệt LÔ dùng đúng cặp này)", () => {
    const html = veChiDoc({ kieuXem: "canh_nhau" });
    expect(html).toContain("grid-cols-2");
    expect(html).toContain(esc(TRUOC));
    expect(html).not.toContain(esc(NHAN_KHOI)); // vẫn không có nút ghi
  });
});
