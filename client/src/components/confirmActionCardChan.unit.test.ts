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
import {
  ConfirmActionCard,
  laKetCucThanhCong,
  trangThaiTheTuConfirm,
  type PendingAction,
} from "./ConfirmActionCard";

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

// ════════════════════════════════════════════════════════════════════════════════════════════════
describe("§5 (rà soát cuối Đợt B) — HAI trạng thái chung cục MỚI không được hiện thành SỰ IM LẶNG", () => {
  /**
   * ★★★ LỚP LỖI ĐANG CANH: `AIGuidedActionCards` ép `res.status as ActionState`, nên một giá trị
   * máy chủ nằm ngoài union cũ lọt vào và chân thẻ — vốn là bốn biểu thức `&&` cạnh nhau — vẽ ra
   * **RỖNG**. Một lượt TỪ CHỐI GHI hiện thành không có gì cả, và người dùng đọc sự im lặng đó
   * thành "chắc là xong". Lưới dựng CÂY THẬT nên nó đo cái được VẼ RA, không đo ý định.
   */
  it("★★★ state=bi_tu_choi_ghi ⇒ chân thẻ CÓ CHỮ, và nói đúng '0 byte'", () => {
    const html = ve([], { state: "bi_tu_choi_ghi" as const });
    expect(html).toContain(esc(String(VI.copilot.writeRejected)));
    expect(html).not.toContain("‹THIẾU:");
    // Không được mượn nhãn của trạng thái khác: đây KHÔNG phải "đã thực thi", cũng không phải RBAC.
    expect(html).not.toContain(esc(String(VI.copilot.executed)));
    expect(html).not.toContain(esc(String(VI.copilot.denied)));
  });

  it("★★★ state=ap_mot_phan ⇒ chân thẻ nói MỘT PHẦN và TUYỆT ĐỐI không nói '0 byte'", () => {
    const html = ve([], { state: "ap_mot_phan" as const });
    expect(html).toContain(esc(String(VI.copilot.writePartial)));
    // ⚠ Mệnh đề trung tâm của cả bản vá: một lô áp một phần ĐÃ ghi tệp 1..k−1. Nói "không byte nào
    //   vào đĩa" ở đây khiến người đọc tưởng an toàn để đề xuất lại CẢ LÔ trên một cây nửa vời.
    expect(html).not.toContain(esc(String(VI.copilot.writeRejected)));
    expect(html).not.toContain(esc(String(VI.copilot.executed)));
    expect(html).not.toContain("‹THIẾU:");
  });

  it("★★ `message` của máy chủ THẮNG câu mặc định ở cả hai trạng thái mới", () => {
    const cau = "Lô áp MỘT PHẦN — đã ghi src/a.ts, chưa ghi src/b.ts.";
    expect(ve([], { state: "ap_mot_phan" as const, message: cau })).toContain(esc(cau));
    expect(ve([], { state: "bi_tu_choi_ghi" as const, message: cau })).toContain(esc(cau));
  });

  it("★★ status KHÔNG dịch được (not_found/invalid) ⇒ hiện NGUYÊN VĂN message, KHÔNG im lặng", () => {
    // Trước đây nhánh này vẽ rỗng. Nói thứ mình biết vẫn hơn không nói gì.
    const cau = "Action không tồn tại.";
    const html = ve([], { state: undefined, message: cau });
    expect(html).toContain(esc(cau));
  });

  it("★★★ bản đồ status → ActionState: hai giá trị mới KHÔNG được rơi về 'pending'", () => {
    // Rơi về "pending" là lỗi KẸT: nút Xác nhận ở lại sống (`state !== "pending"`) và mỗi lượt bấm
    // lại chỉ chạm nhánh cache-return idempotent của máy chủ rồi lại "pending" — vĩnh viễn.
    expect(trangThaiTheTuConfirm("bi_tu_choi_ghi")).toBe("bi_tu_choi_ghi");
    expect(trangThaiTheTuConfirm("ap_mot_phan")).toBe("ap_mot_phan");
    expect(trangThaiTheTuConfirm("executed")).toBe("executed");
    // ...và không được đoán bừa cho những status KHÔNG phải kết cục của một lượt thực thi.
    expect(trangThaiTheTuConfirm("not_found")).toBeUndefined();
    expect(trangThaiTheTuConfirm(undefined)).toBeUndefined();
  });

  it("★★★ CHỈ 'executed' mới được báo THÀNH CÔNG (toast xanh)", () => {
    // `res.ok` KHÔNG phải "byte đã vào đĩa" — đây là vị từ mà ba bề mặt chat dùng thay cho `res.ok`.
    expect(laKetCucThanhCong("executed")).toBe(true);
    for (const s of ["bi_tu_choi_ghi", "ap_mot_phan", "denied", "expired", "cancelled", "pending"] as const) {
      expect(laKetCucThanhCong(s), `"${s}" KHÔNG phải một lượt ghi thành công`).toBe(false);
    }
    expect(laKetCucThanhCong(undefined)).toBe(false);
  });
});
