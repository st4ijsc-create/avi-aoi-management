/**
 * Doc 81 Đợt 2 Task 3 — hook dùng chung của các layout (WorkbenchShell, SplitListDetail, CockpitLayout).
 */
import { useEffect, useState, type RefObject } from "react";

/** Mốc chuyển layout cạnh-nhau ⇒ tab/stack (plan Global Constraint 10: dưới 1024 px). */
export const NARROW_BREAKPOINT_PX = 1024;

/** true khi khung nhìn hẹp hơn `breakpoint` px (mặc định 1024). Không có matchMedia ⇒ false. */
export function useNarrowViewport(breakpoint: number = NARROW_BREAKPOINT_PX): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false;
  const [narrow, setNarrow] = useState<boolean>(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const on = () => setNarrow(mql.matches);
    mql.addEventListener?.("change", on);
    on();
    return () => mql.removeEventListener?.("change", on);
  }, [query]);
  return narrow;
}

/** Kích thước px (rộng hoặc cao) của phần tử, theo ResizeObserver. 0 khi chưa đo được. */
export function useElementSize(ref: RefObject<HTMLElement | null>, axis: "width" | "height"): number {
  const [size, setSize] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize(Math.round(axis === "width" ? r.width : r.height));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, axis]);
  return size;
}

export interface PxRange {
  minPx: number;
  maxPx: number;
  defaultPx: number;
}

export interface PctRange {
  minSize: number;
  maxSize: number;
  defaultSize: number;
}

/**
 * Đổi ràng buộc px (vd explorer 240–300) sang % mà react-resizable-panels dùng, theo kích thước
 * nhóm panel. Chưa đo được (0 px, vd lúc mount đầu hay jsdom) ⇒ dùng `fallback` %.
 */
export function pxRangeToPct(range: PxRange, groupPx: number, fallback: PctRange): PctRange {
  if (!(groupPx > 0)) return fallback;
  const pct = (px: number) => Math.min(95, Math.max(1, (px / groupPx) * 100));
  const minSize = pct(range.minPx);
  const maxSize = Math.max(minSize, pct(range.maxPx));
  const defaultSize = Math.min(maxSize, Math.max(minSize, pct(range.defaultPx)));
  return { minSize, maxSize, defaultSize };
}

/** Khoá lưu kích thước panel THEO NGƯỜI DÙNG; không biết người dùng ⇒ không lưu (null). */
export function userLayoutKey(layoutId: string, userId: number | string | null | undefined, part: string): string | null {
  if (userId === null || userId === undefined || userId === "") return null;
  return `layoutKit:${layoutId}:u${userId}:${part}`;
}
