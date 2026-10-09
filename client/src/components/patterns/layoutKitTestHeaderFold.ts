/**
 * doc 81 Đợt 3b final wave (I1) — HẠ TẦNG TEST (không phải test): ép `PageHeaderCompact` vào trạng thái HẸP trong jsdom.
 *
 * Vì sao: jsdom không dựng layout (scrollWidth = clientWidth = 0) ⇒ header không bao giờ "tràn" và trang luôn ở mức 0.
 * Test trang cần kiểm cái gì CÒN HIỆN khi header gộp (chip/notice GHIM) thì ép header luôn tràn: `scrollWidth` của
 * `[data-layout-header]` lớn hơn `clientWidth` ⇒ `useHeaderFitLevel` leo tới mức gộp/xuống dòng (`HeaderChipFoldContext`
 * = true) — đúng nhánh trình duyệt đi ở 768–1024 px. Không đổi hành vi nào của trang hay component.
 *
 * Dùng: `const restore = forceNarrowHeader();` … `restore()` (afterEach/finally).
 */
export function forceNarrowHeader(): () => void {
  const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
  const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-layout-header") ? 10_000 : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute("data-layout-header") ? 100 : 0;
    },
  });
  return () => {
    if (sw) Object.defineProperty(HTMLElement.prototype, "scrollWidth", sw);
    else delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    if (cw) Object.defineProperty(HTMLElement.prototype, "clientWidth", cw);
    else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  };
}
