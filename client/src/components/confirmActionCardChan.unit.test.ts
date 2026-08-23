/**
 * ★★★ 2026-08-23 · UX LÔ 1 (A1/A2/B3) — LƯỚI **CÂY THẬT** cho `ConfirmActionCard` với lệnh bị chặn.
 *
 * Cùng bài học với `theDuyetDiff.unit.test.ts`: một lưới quét văn bản mù với ĐƯỜNG THOÁT thật, nên
 * ở đây dựng cây bằng `renderToStaticMarkup` và hỏi những câu chỉ cây trả lời được:
 *   §1 (A2) lệnh bị chặn-chắc-chắn ⇒ nút xác nhận DISABLED + nhãn "Lệnh không hợp lệ — gõ lại";
 *   §2 (A2 chiều âm) cảnh báo THÔNG TIN thuần ⇒ nút xác nhận SỐNG, nhãn "Xác nhận" — khoá oan là lỗi mới;
 *   §3 (B3) bảng lệnh nằm trong `<details>` gấp được, đủ ruột, KHÔNG đổ ra danh sách cảnh báo;
 *   §4 (A1) `message` truyền vào THẮNG câu "Bạn không có quyền…" mặc định ở chân thẻ denied.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { danhDauDanhSachLenh, danhDauMaChan } from "@shared/aiCodingTuChoi";
import { ConfirmActionCard, type PendingAction } from "./ConfirmActionCard";

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VI = JSON.parse(readFileSync(join(CLIENT_SRC, "i18n", "locales", "vi.json"), "utf8"));

/** `t` giả TRA THẬT `vi.json` — gõ sai khoá ⇒ `‹THIẾU:…›` ⇒ ca ĐỎ (không phải lưới giả). */
function tThat(key: string, fallback: string): string {
  const v = key.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), VI);
  return typeof v === "string" ? v : `‹THIẾU:${key}›`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const CAU_CHAN = danhDauMaChan("CMD_METACHAR", 'Lệnh chứa ký tự KHÔNG nằm trong tập cho phép (ký tự "à").');
const BANG = danhDauDanhSachLenh(["• npm run check — kiểm kiểu", "• git status — trạng thái git"]);

function hanhDong(warnings: string[]): PendingAction {
  return {
    actionId: "a1",
    token: "a1",
    tool: "run_command",
    summary: "Chạy lệnh",
    preview: { entityType: "repo_command", entityName: "x", changes: [], warnings, humanSummary: 'Chạy lệnh "x"' },
    expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
  };
}

function ve(warnings: string[], over: Partial<Parameters<typeof ConfirmActionCard>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ConfirmActionCard, {
      action: hanhDong(warnings),
      state: "pending" as const,
      busy: false,
      onConfirm: () => {},
      onCancel: () => {},
      t: tThat,
      ...over,
    }),
  );
}

describe("§1 (A2) — lệnh bị chặn-chắc-chắn ⇒ nút xác nhận KHOÁ + nhãn 'gõ lại'", () => {
  it("★★★ có [CMD_METACHAR] ⇒ disabled + data-ma-chan + nhãn từ copilot.blockedRetype", () => {
    const html = ve([CAU_CHAN]);
    expect(html).toContain('data-ma-chan="CMD_METACHAR"');
    expect(html).toMatch(/data-ma-chan="CMD_METACHAR"[^>]*disabled|disabled[^>]*data-ma-chan="CMD_METACHAR"/);
    expect(html).toContain(esc(String(VI.copilot.blockedRetype)));
    // Câu THẬT của server vẫn ra HTML — người dùng đọc được vì sao bị chặn.
    expect(html).toContain(esc("ký tự KHÔNG nằm trong tập cho phép"));
    expect(html).not.toContain("‹THIẾU:");
  });
});

describe("§2 (A2, chiều ÂM) — cảnh báo THÔNG TIN thuần ⇒ nút SỐNG, nhãn 'Xác nhận'", () => {
  it("★★★ 4 cảnh báo thủ tục không dấu ⇒ KHÔNG disabled, KHÔNG nhãn 'gõ lại'", () => {
    const html = ve([
      "Thư mục chạy: D:\\x",
      "Hạn giờ 20000 ms — quá hạn thì CẢ CÂY tiến trình con bị giết.",
      "Biến môi trường ĐÃ LỌC.",
      "Đầu ra bị cắt ở 32768 byte.",
    ]);
    expect(html).not.toContain("data-ma-chan");
    expect(html).not.toContain(esc(String(VI.copilot.blockedRetype)));
    expect(html).toContain(esc(String(VI.copilot.confirm)));
  });
});

describe("§3 (B3) — bảng lệnh GẤP trong <details>, đủ ruột", () => {
  it("★★★ cảnh báo [DANH_SACH_LENH] ⇒ <details data-danh-sach-lenh> + đủ từng dòng + nhãn nút bung", () => {
    const html = ve([danhDauMaChan("CMD_NOT_ALLOWED", 'Lệnh "abc" KHÔNG nằm trong danh sách TRẮNG.'), BANG]);
    expect(html).toContain("data-danh-sach-lenh");
    expect(html).toContain("<details");
    expect(html).toContain(esc("• npm run check — kiểm kiểu"));
    expect(html).toContain(esc("• git status — trạng thái git"));
    expect(html).toContain(esc(String(VI.copilot.showAllCmds)));
    // Nhãn thô "[DANH_SACH_LENH]" KHÔNG được đổ nguyên văn vào danh sách cảnh báo thường.
    expect(html).not.toContain(esc("[DANH_SACH_LENH]"));
  });

  it("★ không có cảnh báo danh-sách ⇒ không render <details> rỗng", () => {
    expect(ve([CAU_CHAN])).not.toContain("data-danh-sach-lenh");
  });
});

describe("§4 (A1) — chân thẻ denied: `message` truyền vào THẮNG câu 'không có quyền' mặc định", () => {
  it("★★★ state=denied + message ⇒ hiện đúng câu server; KHÔNG hiện copilot.denied", () => {
    const cau = 'Lệnh chứa ký tự KHÔNG nằm trong tập cho phép (ký tự "à").';
    const html = ve([CAU_CHAN], { state: "denied" as const, message: cau });
    expect(html).toContain(esc(cau));
    expect(html).not.toContain(esc(String(VI.copilot.denied)));
  });

  it("★ state=denied KHÔNG message ⇒ vẫn còn đường lùi cũ (copilot.denied) — tương thích các trang khác", () => {
    const html = ve([], { state: "denied" as const });
    expect(html).toContain(esc(String(VI.copilot.denied)));
  });
});
