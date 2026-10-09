/**
 * doc 81 Đợt 3b Task 2 (b) — chủ dự án 2026-10-06: "sửa chip đầu trang 640–1023 px (gộp vào "+N", chip nghiêm trọng vẫn
 * ghim)". Header một hàng của `PageHeaderCompact` cắt tràn vùng chip (`overflow-hidden`). Đo trên trình duyệt (instance
 * _test, 2026-10-09, `.playwright-mcp/do-bo-cuc/dot3b-task2/chips-truoc.json`): ở 768 px VÀ 1024 px nhiều màn bị cắt chip;
 * 1366/1600 không màn nào.
 *
 * Cách sửa = THEO ĐO (không theo mốc cố định), ba mức, chỉ leo khi mức trước VẪN tràn:
 *   0 — như cũ (một hàng).
 *   1 — GỘP: ngữ cảnh này = true ⇒ dùng cơ chế "+N" SẴN CÓ: `StatusChipStrip` chỉ hiện chip GHIM (R-2-p; tông "+N" = tệ
 *       nhất của phần giấu — như cũ), `NoticeStack` chỉ hiện notice LỖI, phần còn lại vào "+N".
 *   2 — XUỐNG DÒNG (như dưới 640 px — Đợt 3 Task 0): khi phần KHÔNG gộp được (chip ghim, chip tự viết của trang, hành
 *       động) vẫn không vừa một hàng ⇒ header xuống dòng thay vì CẮT. Không gì bị cắt ở mức nào.
 * Ở 1366/1600 không tràn ⇒ mức 0 ⇒ hợp đồng một hàng ≤48 px và số đo của thiết bị đo không đổi. Ngoài header (vd top bar
 * shell — nơi chip/thanh giấy phép R-2-i sống) ngữ cảnh mặc định `false` ⇒ không đổi gì.
 */
import * as React from "react";

export const HeaderChipFoldContext = React.createContext<boolean>(false);

/** Dải chip đang nằm trong vùng chip của header đang ở mức GỘP (≥1) ⇒ gộp vào "+N". */
export function useHeaderChipFold(): boolean {
  return React.useContext(HeaderChipFoldContext);
}

export type HeaderFitLevel = 0 | 1 | 2;

/** Phần tử (hay một dải chip/notice bên trong) đang tràn ngang ⇒ có thứ bị cắt. */
export function headerOverflows(header: HTMLElement): boolean {
  const els: HTMLElement[] = [header];
  const chips = header.querySelector<HTMLElement>("[data-header-chips]");
  if (chips) els.push(chips, ...Array.from(chips.querySelectorAll<HTMLElement>("[data-status-chip-strip],[data-notice-stack]")));
  return els.some((el) => el.scrollWidth > el.clientWidth + 1);
}

/**
 * Mức vừa của header. Đo lại TỪ MỨC 0 khi bề rộng header đổi (ResizeObserver) hoặc khi trang dựng lại header với nội dung
 * mới (`deps` — tham chiếu prop đổi chỉ khi trang cha render lại, KHÔNG khi chính hook đổi mức ⇒ không vòng lặp). Mỗi bước
 * leo mức chạy trong layout effect ⇒ xong trước khi vẽ (không nháy).
 */
export function useHeaderFitLevel(ref: React.RefObject<HTMLElement | null>, deps: readonly unknown[]): HeaderFitLevel {
  const [level, setLevel] = React.useState<HeaderFitLevel>(0);
  const [width, setWidth] = React.useState(0);
  const sigRef = React.useRef<readonly unknown[] | null>(null);
  const measuring = React.useRef(true);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[entries.length - 1]?.contentRect.width ?? 0);
      setWidth((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  React.useLayoutEffect(() => {
    const sig = [...deps, width];
    const prev = sigRef.current;
    const changed = !prev || prev.length !== sig.length || sig.some((v, i) => !Object.is(v, prev[i]));
    sigRef.current = sig;
    if (changed) {
      measuring.current = true;
      if (level !== 0) {
        setLevel(0);
        return;
      }
    }
    if (!measuring.current) return;
    const el = ref.current;
    if (el && level < 2 && headerOverflows(el)) {
      setLevel((level + 1) as HeaderFitLevel);
      return;
    }
    measuring.current = false;
  });
  return level;
}
