/**
 * Doc 81 Đợt 2 Task 3 — HẠ TẦNG TEST (không phải test): nạp bản BROWSER thật của
 * react-resizable-panels cho test DOM.
 *
 * Vì sao: vitest giải gói theo điều kiện "node" ⇒ nhận bản `edge-light`, nơi
 * `useIsomorphicLayoutEffect` là hàm rỗng — separator không có aria-valuenow, phím mũi tên không
 * làm gì, autoSaveId không lưu. Test "kéo bằng bàn phím" trên bản đó sẽ đo một thư viện KHÔNG
 * giống trình duyệt. Ở đây trỏ thẳng vào `dist/react-resizable-panels.browser.js` (cùng mã trình
 * duyệt nạp qua Vite) — không mock hành vi nào của thư viện.
 *
 * Dùng: `vi.mock("react-resizable-panels", async () => (await import("…/layoutKitTestPanels")).browserPanels());`
 */
export function browserPanels(): Promise<unknown> {
  // @ts-ignore — tệp .js trong dist không có .d.ts riêng; kiểu công khai vẫn lấy từ gói gốc.
  return import("../../../../node_modules/react-resizable-panels/dist/react-resizable-panels.browser.js");
}

/**
 * Doc 81 Đợt 2 Task 5 (fix round 1, review M7) — HẠ TẦNG TEST: lề "hit area" của separator trong jsdom.
 *
 * Vì sao: jsdom trả mọi `getBoundingClientRect()` = 0×0 tại (0,0) và userEvent bấm tại (0,0). Bộ nghe
 * `pointerdown` TOÀN CỤC của react-resizable-panels (bản browser) coi MỌI cú bấm là "trúng vùng kéo" của
 * separator (lề hit-area quanh hình chữ nhật 0×0) và gọi `preventDefault` ⇒ không có mousedown ⇒ focus
 * không chuyển, tab Radix không đổi, ô nhập không nhận chữ. Trên trình duyệt thật separator nằm ở toạ độ
 * thật nên không có chuyện này. Shim đặt RIÊNG phần tử separator (`[data-panel-resize-handle-id]`) ra xa
 * điểm bấm; mọi phần tử khác giữ nguyên hành vi jsdom. Không đổi hành vi nào của trang hay thư viện.
 *
 * Dùng trong `beforeAll` của test trang nào render WorkbenchShell/SplitListDetail kèm userEvent. Trả hàm gỡ.
 */
export function installResizeHandleHitAreaShim(): () => void {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.hasAttribute("data-panel-resize-handle-id")) return DOMRect.fromRect({ x: -10_000, y: -10_000, width: 4, height: 4 });
    return original.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}
