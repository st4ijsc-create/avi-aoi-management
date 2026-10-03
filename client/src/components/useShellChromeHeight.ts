/**
 * doc 81 Đợt 2 final wave (R-2-z4 / M-5) — chiều cao chrome THẬT phía trên `<main>` của shell.
 *
 * Trước: 16 chỗ trong module viết `h-[calc(100dvh-Nrem)]` với N giả định top bar 56 px. Khi thanh license
 * nghiêm trọng (R-2-i, 32 px) hiện, mọi trang cao dư 32 px ⇒ thanh trạng thái rơi khỏi màn và trang cuộn.
 *
 * Nay shell đo các hàng chrome là CON TRỰC TIẾP của cột nội dung — top bar `header[data-app-chrome="header"]`
 * và mọi hàng khai `data-shell-chrome-row` (thanh license nghiêm trọng, hàng breadcrumb điện thoại) — rồi đặt
 * `--shell-chrome-h` (px) trên cột đó. Trang dùng `calc(100dvh - var(--shell-chrome-h,3.5rem) - <phần riêng của trang>)`.
 * Không có vòng phản hồi: các hàng chrome không phụ thuộc chiều cao trang. Kiosk ẩn top bar ⇒ 0 px ⇒ trang lấp đầy.
 */
import { useLayoutEffect, type DependencyList, type RefObject } from "react";

export const SHELL_CHROME_VAR = "--shell-chrome-h";
const ROW_SEL = 'header[data-app-chrome="header"], [data-shell-chrome-row]';

export function useShellChromeHeight(rootRef: RefObject<HTMLElement | null>, deps: DependencyList): void {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const rows = () => Array.from(root.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches(ROW_SEL));
    const apply = () => {
      const h = rows().reduce((sum, el) => sum + el.offsetHeight, 0);
      root.style.setProperty(SHELL_CHROME_VAR, `${h}px`);
    };
    apply();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    const observeRows = () => { if (!ro) return; ro.disconnect(); for (const el of rows()) ro.observe(el); };
    observeRows();
    // hàng chrome xuất hiện/biến mất (thanh license, breadcrumb điện thoại) ⇒ đo lại ngay, không chờ deps.
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => { observeRows(); apply(); });
    mo?.observe(root, { childList: true });
    return () => { ro?.disconnect(); mo?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
