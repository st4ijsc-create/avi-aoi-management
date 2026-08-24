/**
 * ★★★ 2026-08-24 — LƯỚI CHO PANEL **PROBLEMS** (`BangProblems.tsx`).
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc: `vitest.config.ts` gom test client bằng
 *   `client/src/**\/*.unit.test.ts`. Đặt `.test.ts` là vitest lặng lẽ bỏ qua trong khi cổng vẫn
 *   khai XANH — lớp "glob rỗng" đã che ca đỏ nhiều lần ở dự án này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO RENDER CÂY THẬT — và HAI HÌNH DẠNG MỤC phải khác nhau ở HTML, không chỉ ở mã
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cùng khuôn `boChonPhien.unit.test.ts`: `renderToStaticMarkup` dựng cây thật để hỏi "cái gì RA
 * HTML", không phải "mã có chuỗi ấy không". `t` giả TRA THẬT `vi.json` ⇒ gõ sai khoá ⇒ `‹THIẾU:…›`
 * ⇒ đỏ. Static markup KHÔNG chạy `onClick`, nên "nút được nối" đo qua sự CÓ MẶT của `<button
 * data-loi-nut>` + nhãn truy cập (aria-label) đúng — mục `tep:null` thì KHÔNG có nút nào.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • bỏ điều kiện `dong !== null` trong `nhanNhayTep` (luôn nhãn "tại dòng") ⇒ §3 ĐỎ: mục
 *     `dong:null` khẳng định nhãn KHÔNG chứa "dòng" (cả ở HTML lẫn ở hàm thuần).
 *   • biến mục `tep:null` thành nút bấm-được ⇒ §4 ĐỎ (không được có `<button`/`data-loi-nut`).
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DiaDiemLoi } from "@shared/aiCodingLoiViTri";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/** `t` giả tra thật `vi.json` (khuôn `boChonPhien.unit.test.ts`): sai khoá ⇒ `‹THIẾU:…›` ⇒ đỏ. */
function tThat(key: string, a?: unknown, b?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : typeof a === "string" ? a : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : b) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: tThat, i18n: { language: "vi", changeLanguage: () => {} } }),
}));

/** React SSR thoát `&<>"` — mọi phép so chuỗi với HTML phải đi qua đây. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { BangProblems, nhanNhayTep } = await import("./BangProblems");

type Props = Parameters<typeof BangProblems>[0];
function ve(diaDiem: readonly DiaDiemLoi[], tepDangChon: string | null = null): string {
  return renderToStaticMarkup(
    createElement(BangProblems, { diaDiem, tepDangChon, onMoTep: () => {} } as Props),
  );
}

const TSC: DiaDiemLoi = { tep: "server/x.ts", dong: 12, cot: 7, thongDiep: "error TS2353: object literal" };
const FAIL: DiaDiemLoi = { tep: "scripts/b.test.ts", dong: null, cot: null, thongDiep: "FAIL scripts/b.test.ts > suite" };
const ABS: DiaDiemLoi = { tep: null, dong: null, cot: null, thongDiep: "at x (D:\\proj\\x.test.js:10:9)" };

describe("§1 ĐẦU MỤC — tiêu đề + số đếm", () => {
  it("★★★ tiêu đề từ vi.json và số đếm `.count` với n = số mục", () => {
    const html = ve([TSC, FAIL]);
    expect(html).toContain(esc(VI.repoWs.problems.title));
    expect(html).toContain("data-so-dem");
    expect(html).toContain("2 vấn đề");
    expect(html).not.toContain("‹THIẾU:");
  });
});

describe("§2 MỤC CÓ TỆP + DÒNG — nút bấm được, nhãn 'tại dòng'", () => {
  it("★★★ {tep,dong} ⇒ <button data-loi-nut>, aria-label chứa 'tại dòng', vị trí `tep:dong`", () => {
    const html = ve([TSC]);
    expect(html).toContain("<button");
    expect(html).toContain("data-loi-nut");
    expect(html).toContain(esc(nhanNhayTep("server/x.ts", 12, tThat))); // "Mở server/x.ts tại dòng 12"
    expect(html).toContain("tại dòng");
    expect(html).toContain(esc("server/x.ts:12"));
  });
});

describe("§3 MỤC CHỈ CÓ TỆP (dòng=null) — nút bấm được, nhãn KHÔNG nhắc dòng", () => {
  it("★★★ {tep,dong:null} ⇒ nút, nhãn 'Mở {tep}' và KHÔNG chứa 'dòng' (ĐỘT BIẾN ⇒ ĐỎ)", () => {
    const html = ve([FAIL]);
    expect(html).toContain("data-loi-nut");
    expect(html).toContain(esc("Mở scripts/b.test.ts"));
    // ĐỘT BIẾN: bỏ `dong !== null` trong nhanNhayTep ⇒ nhãn thành "…tại dòng null" ⇒ dòng dưới ĐỎ.
    expect(html).not.toContain("dòng");
  });

  it("★ hàm thuần `nhanNhayTep`: có dòng ⇒ 'tại dòng' · không dòng ⇒ CHỈ 'Mở {tep}'", () => {
    expect(nhanNhayTep("server/x.ts", 12, tThat)).toBe("Mở server/x.ts tại dòng 12");
    expect(nhanNhayTep("scripts/b.test.ts", null, tThat)).toBe("Mở scripts/b.test.ts");
    expect(nhanNhayTep("scripts/b.test.ts", null, tThat)).not.toContain("dòng");
  });
});

describe("§4 MỤC KHÔNG TỆP (đường tuyệt đối) — KHÔNG bấm được", () => {
  it("★★★ {tep:null} ⇒ KHÔNG <button>/data-loi-nut/role=button; có câu `.unresolvedLocation` + thongDiep", () => {
    const html = ve([ABS]);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("data-loi-nut");
    expect(html).not.toContain('role="button"');
    expect(html).toContain("data-loi-tin");
    expect(html).toContain(esc(VI.repoWs.problems.unresolvedLocation));
    expect(html).toContain(esc(ABS.thongDiep));
  });
});

describe("§5 TÔ NỔI mục đang mở (tepDangChon khớp) — và CHỈ nó", () => {
  it("★ đúng MỘT mục khớp mang `aria-current=\"true\"`", () => {
    const other: DiaDiemLoi = { tep: "server/y.ts", dong: 3, cot: 1, thongDiep: "error TS1005: ;" };
    const html = ve([TSC, other], "server/y.ts");
    expect((html.match(/aria-current="true"/g) ?? []).length).toBe(1);
  });

  it("★ không chọn gì ⇒ không mục nào tự nhận đang mở", () => {
    expect(ve([TSC], null)).not.toContain('aria-current="true"');
  });
});

describe("§6 RỖNG ⇒ câu `.empty`", () => {
  it("★★★ diaDiem=[] ⇒ `.empty`, không nút nào, số đếm 0", () => {
    const html = ve([]);
    expect(html).toContain(esc(VI.repoWs.problems.empty));
    expect(html).not.toContain("data-loi-nut");
    expect(html).toContain("0 vấn đề");
  });
});
