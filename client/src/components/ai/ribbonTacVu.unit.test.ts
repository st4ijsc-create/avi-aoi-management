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
 *   • bỏ điều kiện `soVanDe>0` (badge '0' rò ra)                  ⇒ §5 ĐỎ (ca 0 khẳng định VẮNG `bg-amber-100`)
 *   • đổi badge về `amber-500`+trắng (trượt AA) / `leading-3.5`   ⇒ §5 ĐỎ (khẳng định cặp AA + `leading-none`)
 *   • bỏ `overflow-x-auto` / đổi sang `flex-wrap` ở container     ⇒ §6 ĐỎ (nút tràn bị cắt / dải bị đội cao)
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
      duoiChat: "dong",
      onToggleTerminal: () => {},
      onToggleProblems: () => {},
      soVanDe: 0,
      onPhienMoi: () => {},
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

describe("§5 NHÓM CỬA SỔ DƯỚI + PHIÊN — Terminal/Vấn đề/Phiên mới LUÔN có; badge + active theo state", () => {
  it("★★★ ba nút luôn ra HTML (không phụ thuộc quyền/stream/khung), nhãn tra được vi.json", () => {
    for (const html of [ve(), ve({ dangStream: true }), ve({ coTheChayKiemChung: false }), ve({ hep: true })]) {
      expect(html).toContain("data-nut-terminal");
      expect(html).toContain("data-nut-problems");
      expect(html).toContain("data-nut-phien-moi");
    }
    const html = ve();
    expect(html).toContain(esc(VI.repoWs.ribbon.terminal));
    expect(html).toContain(esc(VI.repoWs.ribbon.problems));
    expect(html).toContain(esc(VI.repoWs.ribbon.newSession));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★★★ badge Vấn đề CHỈ khi soVanDe>0 (đột biến: bỏ điều kiện ⇒ badge '0' rò ra ⇒ ĐỎ)", () => {
    // `bg-amber-100` là DẤU HIỆN của badge — cặp màu này chỉ dùng ở đây trong ribbon.
    expect(ve({ soVanDe: 0 })).not.toContain("bg-amber-100");
    const html = ve({ soVanDe: 7 });
    expect(html).toContain("bg-amber-100");
    expect(html).toContain(">7<");
  });

  it("★★★ badge dùng cặp màu AA (nhất quán tab 'Vấn đề' ở đáy), KHÔNG còn amber-500+trắng trượt AA", () => {
    const html = ve({ soVanDe: 7 });
    // Cùng cặp với tab đáy (AICodingWorkspace ~L1800): nền amber-100 + chữ amber-700 (+ biến thể dark).
    expect(html).toContain("bg-amber-100");
    expect(html).toContain("text-amber-700");
    expect(html).toContain("dark:bg-amber-950/40");
    expect(html).toContain("dark:text-amber-300");
    // Regression: cặp cũ (nền amber-500 + chữ trắng ≈ 1.8:1) đã BỎ.
    expect(html).not.toContain("bg-amber-500");
    // `leading-3.5` KHÔNG hợp lệ (Tailwind không có nấc ấy) ⇒ phải đã đổi sang `leading-none`.
    expect(html).not.toContain("leading-3.5");
    expect(html).toContain("leading-none");
  });

  it("★★★ nút tô nền BẬT theo `duoiChat` (đột biến: hằng 'dong' ⇒ không nút nào active)", () => {
    expect(ve({ duoiChat: "terminal" })).toContain("bg-primary/10");
    expect(ve({ duoiChat: "problems" })).toContain("bg-primary/10");
    expect(ve({ duoiChat: "dong", soVanDe: 0 })).not.toContain("bg-primary/10");
  });
});

describe("§6 RIBBON TRÀN — hàng nút CUỘN NGANG khi chật (không cắt cụt, không đội cao dải)", () => {
  it("★★★ container mang `overflow-x-auto` + `flex-nowrap`, KHÔNG `flex-wrap` (đột biến bỏ ⇒ ĐỎ)", () => {
    // Lớp nằm trên chính div gốc `data-ribbon-tac-vu`, độc lập mọi props — kể cả khi hiện HẾT nút.
    for (const html of [ve(), ve({ hep: true, dangStream: true, coTheChayKiemChung: true, soVanDe: 3 })]) {
      expect(html).toContain("overflow-x-auto"); // cuộn ngang thay vì cắt cụt/đẩy nút ra ngoài
      expect(html).toContain("flex-nowrap"); // giữ đúng MỘT hàng
    }
    // KHÔNG dùng `flex-wrap`: xuống dòng sẽ đội chiều cao dải công cụ cố định ⇒ vỡ layout khung.
    // (`flex-wrap` KHÔNG phải chuỗi con của `flex-nowrap`, nên phép này không tự thoả.)
    expect(ve()).not.toContain("flex-wrap");
  });
});
