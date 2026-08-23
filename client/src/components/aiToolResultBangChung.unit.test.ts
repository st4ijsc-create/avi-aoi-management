/**
 * ★★★ 2026-08-23 · LÔ 3 — LƯỚI CHO **CHIP BẰNG CHỨNG "Byte thật từ đĩa"** trên `AIToolResultCard`.
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (glob vitest client).
 *
 * Chip phân ĐẲNG CẤP nguồn cho người xem lại: thẻ đọc tệp là byte TỪ ĐĨA, văn xuôi model là lời
 * MODEL — ca thật đã đo cho thấy hai thứ có thể mâu thuẫn trong MỘT câu trả lời. Lưới dựng CÂY
 * THẬT (`renderToStaticMarkup`) và canh cả hai chiều:
 *   • chiều DƯƠNG: hai hình dạng đọc-từ-đĩa thật đều nhận chip, mốc-nhận truyền từ trang hiện ra;
 *   • chiều ÂM: data thống kê / lượt từ chối (data rỗng) KHÔNG được nhận chip — một chip "byte
 *     thật từ đĩa" trên thẻ `today_stats` là một lời khai sai đúng lớp lô này sinh ra để chống.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/** `t` tra thật `vi.json` + nội suy `{{x}}` — sai khoá ⇒ `‹THIẾU:…›` ⇒ đỏ vì đúng lý do. */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

const { AIToolResultCard } = await import("./AIToolResultCard");

function ve(data: unknown, lucNhan?: string): string {
  return renderToStaticMarkup(
    createElement(AIToolResultCard as never, {
      toolResult: { type: "action_result", title: "Đọc tệp trong repo", data, textSummary: "tóm tắt" },
      ...(lucNhan ? { lucNhan } : {}),
    } as never),
  );
}

describe("chiều DƯƠNG — hai hình dạng đọc-từ-đĩa thật đều nhận chip", () => {
  it("★★★ bản đọc MỘT tệp có content ⇒ chip + đúng câu vi.json với mốc-nhận của trang", () => {
    const html = ve({ path: "src/Calculator.cs", bytes: 120, truncated: false, redacted: false, content: "x" }, "10:02:03");
    expect(html).toContain("data-chip-bang-chung");
    expect(html).toContain(tThat("repoWs.khoi.bangChung", { luc: "10:02:03" }));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("thẻ TỔNG `{files:[…]}` của đường sinh-mã ⇒ cũng là lượt đọc từ đĩa ⇒ chip", () => {
    const html = ve({ files: [{ path: "a.cs", bytes: 1 }, { path: "b.cs", bytes: 2, truncated: true }] }, "10:02:03");
    expect(html).toContain("data-chip-bang-chung");
  });

  it("vắng `lucNhan` ⇒ thẻ tự đóng dấu mốc-nhận lúc render đầu — chip vẫn có, không rơi `{{luc}}` thô", () => {
    const html = ve({ path: "a.cs", bytes: 1, truncated: false, content: "x" });
    expect(html).toContain("data-chip-bang-chung");
    expect(html).not.toContain("{{luc}}");
  });
});

describe("chiều ÂM — chip là lời khai, không phải trang trí", () => {
  it("★ data thống kê (không phải lượt đọc đĩa) ⇒ KHÔNG chip", () => {
    expect(ve({ date: "2026-08-23", total: 5, ok: 5, ng: 0, ntf: 0, ngRate: 0, byMachine: [] })).not.toContain(
      "data-chip-bang-chung",
    );
  });

  it("★ lượt TỪ CHỐI của hộp cát (data rỗng `path:null/content:null`) ⇒ KHÔNG chip", () => {
    expect(ve({ path: null, bytes: null, truncated: false, redacted: false, content: null })).not.toContain(
      "data-chip-bang-chung",
    );
    expect(ve(null)).not.toContain("data-chip-bang-chung");
  });

  it("`{files: []}` (không đọc gì) ⇒ KHÔNG chip", () => {
    expect(ve({ files: [] })).not.toContain("data-chip-bang-chung");
  });
});
