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
  // Shift/Ctrl/Cmd/Alt + Enter ⇒ XUỐNG DÒNG. Shift là quy ước phổ thông; ba phím còn lại được nhận
  // vì người dùng quen từ công cụ khác, và đoán sai theo hướng "xuống dòng" là **vô hại** (gửi nhầm
  // một câu chưa viết xong thì không).
  if (e.shiftKey || e.ctrlKey === true || e.metaKey === true || e.altKey === true) return "xuong_dong";
  return "gui";
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
