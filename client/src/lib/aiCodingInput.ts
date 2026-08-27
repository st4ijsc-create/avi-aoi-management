/**
 * ★★★ doc 81 · VIỆC 3 (1) — CHÍNH SÁCH Ô NHẬP CỦA `/ai-coding-workspace`, tách thành module LÁ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ô nhập trước lượt này là `<Input>` — một `<input>` THẬT — nên **không dán được stack trace nhiều
 * dòng**, đúng thứ kỹ sư dán vào một trợ lý lập trình nhiều hơn bất cứ thứ gì khác. Trình duyệt
 * biến mọi xuống dòng thành khoảng trắng và người dùng mất nguyên cấu trúc lỗi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO LÀ MỘT MODULE RIÊNG, KHÔNG PHẢI MỘT `onKeyDown` INLINE
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `phanQuyetPhimNhap` là **hàng rào duy nhất** giữ cho Shift+Enter xuống dòng thay vì gửi. Viết
 * inline trong JSX thì nó chỉ đo được bằng một lượt render CẢ trang (tRPC + auth + i18n + Shiki) —
 * trên thực tế là **không đo**, và một đột biến đổi `!e.shiftKey` thành `e.shiftKey` sẽ sống sót.
 * Ở đây nó thuần, không React, không nhập gì ⇒ đo thẳng bằng lưới đơn vị.
 */

export type PhanQuyetPhimNhap = "gui" | "xuong_dong" | "bo_qua";

/** Hình dạng tối thiểu của một sự kiện bàn phím — cố ý KHÔNG buộc vào `React.KeyboardEvent`. */
export interface PhimNhap {
  key: string;
  shiftKey: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  /**
   * ⚠ Bộ gõ tiếng Việt/Trung phát Enter để **CHỐT một từ đang gõ**. Gửi ở nhịp ấy là cắt câu người
   * dùng làm đôi. Đây không phải lo xa: giao diện này chạy ba locale, trong đó hai locale dùng bộ
   * gõ có trạng thái.
   */
  isComposing?: boolean;
}

export function phanQuyetPhimNhap(e: PhimNhap): PhanQuyetPhimNhap {
  if (e.key !== "Enter") return "bo_qua";
  if (e.isComposing === true) return "bo_qua";
  // Shift/Alt + Enter ⇒ XUỐNG DÒNG. Shift là quy ước phổ thông; Alt nhận kèm vì vài trình soạn dùng nó
  // và đoán sai theo hướng "xuống dòng" là **vô hại**. Ctrl/Cmd + Enter ⇒ GỬI — quy ước "gửi cưỡng
  // bức" của hầu hết công cụ chat/PR (Slack, GitHub) và ở đây khớp luôn Enter=gửi; người quen tổ hợp
  // ấy từ nơi khác bấm được ngay (Đợt 3 UX phím tắt). ⚠ Đột biến đổi `altKey` → `ctrlKey` ở nhánh này
  // sẽ biến Ctrl+Enter thành xuống-dòng, mâu thuẫn phím tắt gửi — lưới §phím-tắt canh đúng chỗ.
  if (e.shiftKey || e.altKey === true) return "xuong_dong";
  return "gui";
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-25 · ĐỢT 3 UX — PHÍM TẮT TOÀN KHUNG (Ctrl+` · Ctrl/Cmd+P · Ctrl/Cmd+Enter · Esc).
// Tách THUẦN cùng lý do `phanQuyetPhimNhap`: nghe `keydown` cấp `document` mà viết inline thì chỉ đo
// được bằng một lượt render CẢ trang ⇒ trên thực tế không đo, một đột biến đổi phím sống sót. Ở đây
// thuần ⇒ lưới đơn vị đo thẳng "phím X + bối cảnh Y ⇒ hành động Z".
// ══════════════════════════════════════════════════════════════════════════════════════════════
export type PhimTatKhung = "terminal" | "mo_nhanh" | "tim_trong_tep" | "tim_repo" | "sua_chon" | "gui" | "dung_stream" | "bo_qua";

export interface PhimTat {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  /** Shift — PHÂN BIỆT Ctrl+F (tìm-trong-tệp) với Ctrl+Shift+F (tìm-toàn-repo), như VSCode. */
  shiftKey?: boolean;
  /** Con trỏ đang ở trong một ô nhập (input/textarea/select)? Quyết định `gui`/`dung_stream` KIÊNG nể. */
  trongONhap: boolean;
  /** Có một lượt stream đang chạy? (Esc chỉ cắt khi ĐANG chạy.) */
  dangStream: boolean;
}

/**
 * Quy ước:
 *  • Ctrl/Cmd + `  ⇒ bật/tắt Terminal — LUÔN (kể cả đang gõ; `` ` `` không phải phím soạn thảo hệ trọng).
 *  • Ctrl/Cmd + P  ⇒ mở-nhanh (nhảy tới ô lọc cây) — LUÔN, và CHẶN in-trình-duyệt (preventDefault ở trang).
 *  • Ctrl/Cmd + F  ⇒ tìm-trong-tệp (mở thanh tìm ở Trình xem) — LUÔN, CHẶN find-trình-duyệt; như Cursor/
 *    VSCode ghi đè Ctrl+F thành tìm-trong-editor. Trang chỉ hành động khi ĐANG xem một tệp.
 *  • Ctrl/Cmd + Shift + F ⇒ tìm-TOÀN-REPO (mở chế độ Tìm ở khung Cây) — như VSCode. Shift là thứ TÁCH nó
 *    khỏi Ctrl+F; thiếu Shift ⇒ tìm-trong-tệp.
 *  • Ctrl/Cmd + K ⇒ sửa-đoạn-chọn (Cmd+K kiểu Cursor) — mở ô-lệnh cho đoạn mã ĐANG BÔI ĐEN ở Trình xem.
 *    ⚠ CHỈ là phím-mở ô-lệnh: trang kiểm có bôi đen trong Trình xem không, rồi GỬI một câu hỏi có bối
 *    cảnh qua ĐÚNG đường `handleSend` → model → apply_diff → CỬA DUYỆT. KHÔNG mở đường ghi mới nào.
 *  • Ctrl/Cmd + Enter ⇒ GỬI — CHỈ khi con trỏ KHÔNG trong ô nhập: trong ô chat, chính `onKeyDown` của nó
 *    (qua `phanQuyetPhimNhap`) đã gửi rồi; để trang gửi lần nữa là gửi ĐÔI. Ngoài ô nhập thì đây là lối gửi.
 *  • Esc ⇒ dừng stream — CHỈ khi KHÔNG trong ô nhập (ô @-mention/lọc-cây tự lo Esc của chúng) VÀ đang stream.
 */
export function phanGiaiPhimTatKhung(e: PhimTat): PhimTatKhung {
  const mod = e.ctrlKey === true || e.metaKey === true;
  if (mod && e.key === "`") return "terminal";
  if (mod && (e.key === "p" || e.key === "P")) return "mo_nhanh";
  if (mod && (e.key === "f" || e.key === "F")) return e.shiftKey === true ? "tim_repo" : "tim_trong_tep";
  if (mod && (e.key === "k" || e.key === "K")) return "sua_chon";
  if (mod && e.key === "Enter" && !e.trongONhap) return "gui";
  if (e.key === "Escape" && !e.trongONhap && e.dangStream) return "dung_stream";
  return "bo_qua";
}

/** Trần chiều cao ô nhập (px) trước khi nó tự cuộn — ~7 dòng ở cỡ chữ 13px. */
export const TRAN_CAO_O_NHAP_PX = 150;

/**
 * Tự giãn chiều cao theo nội dung, có TRẦN. Thuần trên một phần tử DOM, không state.
 * `null` ⇒ no-op (ref chưa gắn).
 */
export function tuGianChieuCao(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, TRAN_CAO_O_NHAP_PX)}px`;
  el.style.overflowY = el.scrollHeight > TRAN_CAO_O_NHAP_PX ? "auto" : "hidden";
}
