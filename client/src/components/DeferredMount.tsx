/**
 * doc64 S5-OPT-2 — mount phần con NẶNG sau khi trình duyệt đã có ÍT NHẤT một khe paint.
 *
 * Vấn đề đo được (POC ×4, LCP-element attribution): trang monolith render #1 cả cây nặng
 * (chart/list) + bão query re-render → main thread kín ~1,5→5s, browser không có khe paint,
 * LCP bị đẩy tới ~5s dù skeleton "đã render". Double-rAF ép nhường đúng 1 frame đã paint
 * rồi mới mount phần nặng (idle-callback với timeout trần — không chờ idle vô hạn).
 *
 * Trung thực dữ liệu: placeholder là skeleton — KHÔNG phải giá trị giả; phần nặng mount
 * ngay sau khe paint đầu (thường <1 frame + idle), không đổi nội dung/nguồn dữ liệu.
 */
import { useEffect, useState, type ReactNode } from "react";

export function DeferredMount({
  children,
  placeholder = null,
  timeoutMs = 500,
}: {
  children: ReactNode;
  placeholder?: ReactNode;
  /** Trần chờ idle (ms) — quá hạn thì mount luôn, tránh treo skeleton trên máy bận. */
  timeoutMs?: number;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    let timerId: number | undefined;
    const fire = () => {
      if (!cancelled) setReady(true);
    };
    // double-rAF: frame 1 commit + paint, frame 2 mới xếp lịch mount phần nặng.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        if (typeof window.requestIdleCallback === "function") {
          idleId = window.requestIdleCallback(fire, { timeout: timeoutMs });
        } else {
          timerId = window.setTimeout(fire, 80);
        }
      });
    });
    return () => {
      cancelled = true;
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [timeoutMs]);

  return <>{ready ? children : placeholder}</>;
}

export default DeferredMount;
