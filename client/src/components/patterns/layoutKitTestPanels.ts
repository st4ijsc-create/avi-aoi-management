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
