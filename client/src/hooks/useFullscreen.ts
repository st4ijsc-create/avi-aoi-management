/**
 * doc 40 Wave 4d §13.3 — useFullscreen (fullscreen-in-app cho 1 element).
 *
 * Trả về { ref, isFullscreen, toggle, enter, exit }. Gắn `ref` vào phần tử muốn
 * phóng to (canvas 3D / bảng fleet). Dùng Fullscreen API thật khi khả dụng; nếu
 * trình duyệt chặn (iframe không allow, hoặc lỗi), tự fallback sang chế độ
 * "fixed overlay" phủ toàn viewport bằng class nội bộ — cả hai đều thoát bằng ESC.
 *
 * Không thêm dependency. Đồng bộ với sự kiện fullscreenchange của trình duyệt để
 * isFullscreen luôn khớp trạng thái thật (kể cả khi user bấm ESC của trình duyệt).
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface FullscreenApi {
  isFullscreen: boolean;
  /** Bật/tắt fullscreen cho element đang gắn ref. */
  toggle: () => void;
  enter: () => void;
  exit: () => void;
  /** Gắn vào phần tử cần phóng to. */
  ref: React.RefObject<HTMLDivElement | null>;
  /**
   * true khi đang dùng fallback overlay (Fullscreen API không khả dụng). Caller
   * nên áp class phủ-viewport cho element trong trường hợp này.
   */
  usingFallback: boolean;
}

/** Có Fullscreen API gốc không (một số iframe/permission chặn requestFullscreen). */
function nativeSupported(el: HTMLElement | null): boolean {
  if (!el) return false;
  return (
    typeof el.requestFullscreen === "function" &&
    typeof document !== "undefined" &&
    !!document.fullscreenEnabled
  );
}

export function useFullscreen(): FullscreenApi {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  // Đồng bộ với fullscreenchange gốc (bắt cả ESC của trình duyệt).
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement === ref.current;
      // Chỉ cập nhật khi đang ở chế độ gốc (fallback tự quản lý state).
      if (!usingFallback) setIsFullscreen(active);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [usingFallback]);

  // ESC thoát fallback overlay (chế độ gốc đã có ESC của trình duyệt).
  useEffect(() => {
    if (!usingFallback || !isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [usingFallback, isFullscreen]);

  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (nativeSupported(el)) {
      el.requestFullscreen().then(
        () => {
          setUsingFallback(false);
          setIsFullscreen(true);
        },
        () => {
          // requestFullscreen bị từ chối → fallback overlay.
          setUsingFallback(true);
          setIsFullscreen(true);
        },
      );
    } else {
      setUsingFallback(true);
      setIsFullscreen(true);
    }
  }, []);

  const exit = useCallback(() => {
    if (!usingFallback && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setIsFullscreen(false);
  }, [usingFallback]);

  const toggle = useCallback(() => {
    if (isFullscreen) exit();
    else enter();
  }, [isFullscreen, enter, exit]);

  return { ref, isFullscreen, toggle, enter, exit, usingFallback };
}

export default useFullscreen;
