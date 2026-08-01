/**
 * W4-19 (audit doc 25) — UNDO/REDO history for the IR editor's Flow state.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một history stack thuần (past / present / future) + hook React mỏng bọc quanh nó.
 * Tách phần logic THUẦN (reducer) ra khỏi hook để test round-trip được mà không cần
 * render React. `useFlowHistory` chỉ giữ present làm nguồn sự thật cho editor; mọi
 * mutate đẩy một snapshot vào `past` và xoá `future` (nhánh redo cũ đã lỗi thời).
 *
 * KHÔNG đổi ngữ nghĩa Flow: history chỉ bọc state, không sờ vào nội dung IR.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useMemo, useState } from "react";

/** Ba ngăn của một history: quá khứ (undo), hiện tại, tương lai (redo). */
export type History<T> = { past: T[]; present: T; future: T[] };

/** Giới hạn chiều sâu undo (tránh phình bộ nhớ khi kéo-thả nhiều). */
export const HISTORY_LIMIT = 100;

/** Khởi tạo history rỗng với một present. */
export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Đẩy một present MỚI vào history: present cũ → past, xoá future. No-op nếu next
 * đồng nhất tham chiếu với present hiện tại (tránh entry rác). Cắt past theo limit.
 */
export function pushHistory<T>(h: History<T>, next: T, limit = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
  };
}

/** Lùi một bước (undo). No-op nếu không còn past. */
export function undoHistory<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future] };
}

/** Tiến một bước (redo). No-op nếu không còn future. */
export function redoHistory<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const next = h.future[0];
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
}

export function canUndoHistory<T>(h: History<T>): boolean {
  return h.past.length > 0;
}
export function canRedoHistory<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/** Giá trị hook trả về — API tương thích setState (nhận value HOẶC updater). */
export interface FlowHistory<T> {
  /** present — nguồn sự thật cho UI. */
  state: T;
  /** Ghi một present mới (đẩy vào history). Nhận value hoặc updater như setState. */
  set: (updater: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  /** Đặt lại baseline MỚI + xoá sạch history (dùng khi nạp/khởi tạo flow). */
  reset: (next: T) => void;
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * Hook bọc một state bằng history undo/redo. `set` chấp nhận cả value lẫn updater để
 * thay thế trực tiếp cho useState hiện có (mọi lời gọi setFlow((f) => …) giữ nguyên).
 */
export function useFlowHistory<T>(initial: T | (() => T)): FlowHistory<T> {
  const [hist, setHist] = useState<History<T>>(() =>
    initHistory(typeof initial === "function" ? (initial as () => T)() : initial),
  );

  const set = useCallback((updater: T | ((prev: T) => T)) => {
    setHist((h) => {
      const next = typeof updater === "function" ? (updater as (p: T) => T)(h.present) : updater;
      return pushHistory(h, next);
    });
  }, []);
  const undo = useCallback(() => setHist((h) => undoHistory(h)), []);
  const redo = useCallback(() => setHist((h) => redoHistory(h)), []);
  const reset = useCallback((next: T) => setHist(() => initHistory(next)), []);

  return useMemo(
    () => ({
      state: hist.present,
      set,
      undo,
      redo,
      reset,
      canUndo: hist.past.length > 0,
      canRedo: hist.future.length > 0,
    }),
    [hist, set, undo, redo, reset],
  );
}
