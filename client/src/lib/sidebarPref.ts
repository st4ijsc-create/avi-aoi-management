/**
 * Doc 81 Đợt 2 Task 2 — lựa chọn mở/thu gọn rail trái.
 *
 *  · Màn thường: khoá cũ `sidebar_open` (mặc định mở) — giữ nguyên hành vi trước đây.
 *  · Màn workbench (trang khai `useShellPageVariant("full-bleed")`): mặc định THU GỌN để nhường bề rộng
 *    cho editor/canvas; người dùng mở rộng được và lựa chọn nhớ THEO NGƯỜI DÙNG ở khoá riêng
 *    `sidebar_open:workbench:u<id>` (không ghi đè lựa chọn ở màn thường). Chưa đăng nhập ⇒ không lưu.
 */
const DEFAULT_KEY = "sidebar_open";

export function workbenchSidebarKey(userId: number | string | null | undefined): string | null {
  return userId == null ? null : `sidebar_open:workbench:u${userId}`;
}

export function readSidebarOpen(opts: { workbench: boolean; userId: number | string | null | undefined }): boolean {
  try {
    if (opts.workbench) {
      const key = workbenchSidebarKey(opts.userId);
      return key != null && localStorage.getItem(key) === "true";
    }
    return localStorage.getItem(DEFAULT_KEY) !== "false";
  } catch {
    return !opts.workbench;
  }
}

export function writeSidebarOpen(open: boolean, opts: { workbench: boolean; userId: number | string | null | undefined }): void {
  try {
    const key = opts.workbench ? workbenchSidebarKey(opts.userId) : DEFAULT_KEY;
    if (key) localStorage.setItem(key, String(open));
  } catch {
    /* storage unavailable */
  }
}
