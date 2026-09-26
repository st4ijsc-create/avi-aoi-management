/**
 * doc 67 W7 GĐ1 — gom sự kiện socket dồn dập thành MỘT lần invalidate/refetch.
 *
 * Hai biến thể, chọn theo ngữ nghĩa:
 *   • useDebouncedInvalidate — DEBOUNCE (trailing): mỗi lần gọi RESET lại đồng hồ;
 *     fn chỉ chạy sau khi im lặng đủ `ms`. Hợp khi muốn chờ "cơn bão" sự kiện
 *     lắng hẳn rồi mới refetch một thể (bão dài → fn có thể bị hoãn lâu).
 *   • useThrottledInvalidate — THROTTLE (ngữ nghĩa AndonBoard.scheduleRefetch):
 *     đang có timer chạy thì RETURN SỚM (bỏ qua), không reset — fn chạy đúng
 *     `ms` sau lần gọi ĐẦU của mỗi đợt → đảm bảo tối đa 1 lần / `ms`, độ trễ
 *     có cận trên kể cả khi sự kiện tới liên tục. Hợp cho bảng live (Andon…).
 *
 * Cả hai: giữ `fn` mới nhất qua ref (không cần useCallback ở caller), trả về
 * hàm `schedule` có identity ỔN ĐỊNH, tự clearTimeout khi unmount.
 */
import { useCallback, useEffect, useRef } from "react";

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Debounce (trailing). Trả về `schedule()` — gọi bao nhiêu lần cũng được; `fn`
 * chỉ chạy 1 lần sau khi ngừng gọi đủ `ms`.
 *
 * @param fn thao tác cần gom (vd `() => utils.dashboard.getAndonBoard.invalidate()`)
 * @param ms cửa sổ im lặng, mặc định 1500ms
 */
export function useDebouncedInvalidate(fn: () => void, ms = 1500): () => void {
  const fnRef = useLatest(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current); // reset đồng hồ
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fnRef.current();
    }, ms);
  }, [ms, fnRef]);
}

/**
 * Throttle (trailing, ngữ nghĩa AndonBoard): timer đang chạy → return sớm;
 * `fn` chạy đúng `ms` sau lần gọi đầu của mỗi đợt (tối đa 1 lần / `ms`).
 *
 * @param fn thao tác cần giới hạn tần suất
 * @param ms khoảng tối thiểu giữa 2 lần chạy, mặc định 1500ms
 */
export function useThrottledInvalidate(fn: () => void, ms = 1500): () => void {
  const fnRef = useLatest(fn);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(() => {
    if (timerRef.current) return; // đang chờ → bỏ qua (KHÔNG reset)
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      fnRef.current();
    }, ms);
  }, [ms, fnRef]);
}
