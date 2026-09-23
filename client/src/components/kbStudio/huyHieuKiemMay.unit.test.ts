/**
 * R4 — huy hiệu kiểm máy sau nạp. Cây thật qua `renderToStaticMarkup`, `t` tra THẬT `vi.json`.
 * ĐỘT BIẾN PHẢI BẮT: `null` (chưa kiểm) hiện như "ổn" · cảnh báo đỏ tô màu vàng · tooltip mất số trang.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VI = JSON.parse(readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "i18n", "locales", "vi.json"), "utf8"));
function tThat(key: string, a?: unknown): string {
  const v = key.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), VI);
  const cau = typeof v === "string" ? v : `‹THIẾU:${key}›`;
  const opts = (typeof a === "object" && a !== null ? a : undefined) as Record<string, unknown> | undefined;
  return opts ? cau.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in opts ? String(opts[k]) : m)) : cau;
}
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: tThat, i18n: { language: "vi" } }) }));

const { HuyHieuKiemMay, tomTatNap } = await import("./HuyHieuKiemMay");
const ve = (kq: unknown) => renderToStaticMarkup(createElement(HuyHieuKiemMay, { kq: kq as never }));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("HuyHieuKiemMay — ba trạng thái KHÔNG gộp", () => {
  it("null ⇒ '—' (chưa kiểm), KHÔNG phải 'ổn'", () => {
    const h = ve(null);
    expect(h).toContain('data-kiem-may="chua"');
    expect(h).not.toContain("status-ok");
  });

  it("canhBao rỗng ⇒ 'ổn'", () => {
    const h = ve({ soTrang: 3, soKyTu: 9000, soDoan: 6, kyTuMoiTrang: 3000, ocrSoTrang: null, canhBao: [] });
    expect(h).toContain('data-kiem-may="on"');
    expect(h).toContain("ổn");
  });

  it("PDF quét ảnh ⇒ huy hiệu ĐỎ + tooltip mang số trang và ký tự/trang thật; không khoá thiếu", () => {
    const h = ve({ soTrang: 5, soKyTu: 30, soDoan: 1, kyTuMoiTrang: 6, ocrSoTrang: null, canhBao: [{ ma: "pdf-quet-khong-ocr", muc: "do" }] });
    expect(h).not.toContain("‹THIẾU:");
    expect(h).toMatch(/class="[^"]*status-ng[^"]*"[^>]*data-kiem-may="pdf-quet-khong-ocr"/);
    expect(h).toContain(esc("Tệp 5 trang chỉ có ~6 ký tự/trang"));
  });

  it("quét ảnh + ocrLyDo ⇒ tooltip nói ĐÚNG khoá cần sửa (PDFTOPPM_BIN)", () => {
    const h = ve({ soTrang: 1, soKyTu: 0, soDoan: 0, kyTuMoiTrang: 0, ocrSoTrang: null, ocrLyDo: "thieu-pdftoppm", canhBao: [{ ma: "pdf-quet-khong-ocr", muc: "do" }] });
    expect(h).toContain("PDFTOPPM_BIN");
    expect(h).not.toContain("‹THIẾU:");
  });

  it("OCR ⇒ VÀNG; tomTatNap ghép số trang · ký tự/trang · đoạn", () => {
    const kq = { soTrang: 2, soKyTu: 4000, soDoan: 3, kyTuMoiTrang: 2000, ocrSoTrang: 2, canhBao: [{ ma: "ocr", muc: "vang" }] };
    expect(ve(kq)).toMatch(/status-ntf[^"]*"[^>]*data-kiem-may="ocr"/);
    expect(tomTatNap(kq as never, tThat)).toMatch(/^2 trang · .+ ký tự\/trang · 3 đoạn$/);
    expect(tomTatNap(null, tThat)).toBe("");
  });
});
