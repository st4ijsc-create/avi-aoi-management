/**
 * Doc 81 Đợt 3 Task 5 ([QĐ-3b]) — sở thích "Hiện Labs" của TỪNG người dùng: mục điều hướng `labs: true` (nhóm "Labs — thử
 * nghiệm" trong menu Kỹ thuật) ẩn mặc định; người dùng tự bật. Lưu cùng kho với các sở thích giao diện theo người dùng khác
 * (localStorage, khoá `userLayoutKey` — như kích thước/gập panel của WorkbenchShell), giá trị "1"/"0".
 *
 * - Chưa biết người dùng (đang tải) ⇒ ẩn, không đọc/ghi kho (không để lựa chọn của người này dính sang người khác).
 * - Đổi người dùng ⇒ đọc lại khoá của người mới. Tab khác đổi ⇒ đồng bộ (sự kiện `storage`).
 * - KHÔNG phải cổng: chỉ thanh bên/menu điện thoại/BottomNav dùng; ⌘K, RouteGuard và deep link không đọc nó.
 */
import { useCallback, useEffect, useState } from "react";
import { userLayoutKey } from "@/components/patterns/layoutKitHooks";

/** Khoá kho của sở thích Labs (null khi chưa biết người dùng). */
export function showLabsKey(userId: number | string | null | undefined): string | null {
  return userLayoutKey("nav-labs", userId, "show");
}

function readStored(key: string | null): boolean {
  if (!key) return false;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export interface UseShowLabsResult {
  showLabs: boolean;
  setShowLabs: (on: boolean) => void;
  toggleShowLabs: () => void;
}

export function useShowLabs(userId: number | string | null | undefined): UseShowLabsResult {
  const key = showLabsKey(userId);
  const [state, setState] = useState<{ key: string | null; on: boolean }>(() => ({ key, on: readStored(key) }));
  // Người dùng đổi (đăng nhập xong / đổi tài khoản) ⇒ giá trị của khoá mới, ngay trong lượt dựng này.
  const on = state.key === key ? state.on : readStored(key);
  useEffect(() => {
    if (state.key !== key) setState({ key, on: readStored(key) });
  }, [key, state.key]);

  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setState({ key, on: readStored(key) });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const setShowLabs = useCallback(
    (next: boolean) => {
      setState({ key, on: next });
      if (!key) return;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* kho không dùng được — chỉ nhớ trong phiên */
      }
    },
    [key],
  );
  const toggleShowLabs = useCallback(() => setShowLabs(!on), [on, setShowLabs]);
  return { showLabs: on, setShowLabs, toggleShowLabs };
}
