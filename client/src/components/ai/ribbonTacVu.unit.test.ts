/**
 * ★★★ 2026-08-24 — LƯỚI CHO **RIBBON TÁC VỤ** (một hàng nút icon gom tác vụ thường dùng).
 *
 * ⚠ Đuôi `.unit.test.ts` bắt buộc (vitest gom `client/src/**\/*.unit.test.ts`; đặt `.test.ts` là
 *   vitest lặng lẽ bỏ qua trong khi cổng vẫn khai xanh — lớp "glob rỗng" cũ).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO RENDER CÂY THẬT — cùng khuôn `boChonPhien.unit.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `renderToStaticMarkup` dựng cây thật để lưới hỏi được "cái gì RA HTML", không phải "mã có chuỗi
 * ấy không". Ribbon là THUẦN HIỂN THỊ (0 mutation, 0 tRPC) nên nó SSR trọn vẹn — không có cánh cửa
 * Portal nào bịt mắt lưới, khác popover của bộ chọn phiên.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC (mỗi điều kiện hiện là một mũi khâu):
 *   • bỏ điều kiện `coTheChayKiemChung` (hiện nút vô điều kiện)  ⇒ §3 ĐỎ (ca false khẳng định VẮNG)
 *   • bỏ điều kiện `dangStream` cho nút Dừng                      ⇒ §2 ĐỎ (ca false khẳng định VẮNG)
 *   • bỏ điều kiện `hep` cho hai nút nhảy khung                   ⇒ §1 ĐỎ (ca false khẳng định VẮNG)
 *   • gắn nhầm khoá i18n (title/aria-label)                       ⇒ §4 ĐỎ (`tThat` trả `‹THIẾU:…›`)
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/**
 * `t` giả TRA THẬT `vi.json` (khuôn `boChonPhien.unit.test.ts`): gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ đỏ.
 * Một `t` trả về chính khoá sẽ làm mọi khẳng định nhãn dưới đây xanh một cách tầm thường.
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

/** React SSR thoát `&<>"` — mọi phép so chuỗi với HTML phải đi qua đây. */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const { RibbonTacVu } = await import("./RibbonTacVu");

type RibbonProps = Parameters<typeof RibbonTacVu>[0];
/** Mặc định: quyền chạy có, không stream, màn RỘNG (không nhảy khung) — mỗi ca chỉ lật MỘT trục. */
function ve(over: Partial<RibbonProps> = {}): string {
  return renderToStaticMarkup(
    createElement(RibbonTacVu, {
      hep: false,
      dangStream: false,
      coTheChayKiemChung: true,
      onLamMoiCay: () => {},
      onChayKiemChung: () => {},
      onDung: () => {},
      onNhayTep: () => {},
      onNhayChat: () => {},
      ...over,
    } as RibbonProps),
  );
}

describe("§0 NÚT LÀM MỚI CÂY — luôn có, kèm nhãn truy cập", () => {
  it("★★★ `data-nut-lam-moi-cay` ra HTML dù stream/quyền/khung thế nào", () => {
    for (const html of [
      ve(),
      ve({ dangStream: true }),
      ve({ coTheChayKiemChung: false }),
      ve({ hep: true }),
    ]) {
      expect(html).toContain("data-nut-lam-moi-cay");
    }
    // Nhãn (title + aria-label) lấy đúng từ vi.json — không rơi về `‹THIẾU:›`.
    const html = ve();
    expect(html).toContain(esc(VI.repoWs.ribbon.refreshTree));
    expect(html).not.toContain("‹THIẾU:");
  });
});

describe("§1 NHẢY KHUNG — chỉ hiện ở màn HẸP (`hep`)", () => {
  it("★★★ `hep=false` ⇒ KHÔNG có nút Tệp lẫn nút Hội thoại", () => {
    const html = ve({ hep: false });
    expect(html).not.toContain("data-nut-nhay-tep");
    expect(html).not.toContain("data-nut-nhay-chat");
  });

  it("★★★ `hep=true` ⇒ có CẢ HAI nút, kèm nhãn từ vi.json", () => {
    const html = ve({ hep: true });
    expect(html).toContain("data-nut-nhay-tep");
    expect(html).toContain("data-nut-nhay-chat");
    expect(html).toContain(esc(VI.repoWs.ribbon.jumpFiles));
    expect(html).toContain(esc(VI.repoWs.ribbon.jumpChat));
    expect(html).not.toContain("‹THIẾU:");
  });
});

describe("§2 NÚT DỪNG — chỉ hiện khi đang stream (`dangStream`)", () => {
  it("★★★ `dangStream=false` ⇒ KHÔNG có nút Dừng", () => {
    expect(ve({ dangStream: false })).not.toContain("data-nut-dung");
  });

  it("★★★ `dangStream=true` ⇒ có nút Dừng, kèm nhãn từ vi.json", () => {
    const html = ve({ dangStream: true });
    expect(html).toContain("data-nut-dung");
    expect(html).toContain(esc(VI.repoWs.ribbon.stop));
    expect(html).not.toContain("‹THIẾU:");
  });
});

describe("§3 NÚT CHẠY KIỂM CHỨNG — ẨN khi thiếu quyền/không có lệnh gợi ý (`coTheChayKiemChung`)", () => {
  // ⚠⚠ ĐỘT BIẾN BẮT BUỘC (brief): xoá điều kiện `coTheChayKiemChung` để hiện nút vô điều kiện ⇒
  //    ca dưới đây ĐỎ. Đây là chốt "ẩn nút KHÔNG nới quyền" — một nút chạy lệnh hiện ra cho tài
  //    khoản không có quyền là một lời mời gọi thẳng server (dù server vẫn chặn, UI vẫn nói dối).
  it("★★★ `coTheChayKiemChung=false` ⇒ KHÔNG có nút Chạy kiểm chứng", () => {
    expect(ve({ coTheChayKiemChung: false })).not.toContain("data-nut-chay-kiem-chung");
  });

  it("★★★ `coTheChayKiemChung=true` ⇒ có nút, kèm nhãn từ vi.json", () => {
    const html = ve({ coTheChayKiemChung: true });
    expect(html).toContain("data-nut-chay-kiem-chung");
    expect(html).toContain(esc(VI.repoWs.ribbon.runVerify));
    expect(html).not.toContain("‹THIẾU:");
  });
});

describe("§4 KHÔNG MỘT NHÃN NÀO RƠI VỀ `‹THIẾU:›` — kể cả khi hiện HẾT nút", () => {
  it("★ render đủ năm nút (hep + stream + có quyền) ⇒ năm khoá i18n đều tra được", () => {
    const html = ve({ hep: true, dangStream: true, coTheChayKiemChung: true });
    for (const nhan of [
      VI.repoWs.ribbon.refreshTree,
      VI.repoWs.ribbon.runVerify,
      VI.repoWs.ribbon.stop,
      VI.repoWs.ribbon.jumpFiles,
      VI.repoWs.ribbon.jumpChat,
    ]) {
      expect(html).toContain(esc(nhan));
    }
    expect(html).not.toContain("‹THIẾU:");
    // Năm nút = năm `data-nut-*` phân biệt.
    for (const d of [
      "data-nut-lam-moi-cay",
      "data-nut-chay-kiem-chung",
      "data-nut-dung",
      "data-nut-nhay-tep",
      "data-nut-nhay-chat",
    ]) {
      expect(html).toContain(d);
    }
  });
});
