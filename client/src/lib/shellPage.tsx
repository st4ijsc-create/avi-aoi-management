/**
 * Doc 81 Đợt 2 Task 2 — hợp đồng giữa SHELL (`DashboardLayout`) và TRANG.
 *
 * 1. **Một chỗ đệm.** `<main id="main-content">` của shell là chỗ đệm DUY NHẤT. `PageContainer` đọc
 *    `useInShellMain()` và bỏ padding riêng khi nằm trong `<main>` của shell (trước đây main 24 px +
 *    PageContainer 24 px = đệm kép 48 px trước tiêu đề).
 * 2. **Biến thể trang.**
 *    · `"workbench"` — màn soạn thảo (IDE, IR, POU, Orchestration canvas): rail trái mặc định THU GỌN
 *      (người dùng mở rộng được; lựa chọn nhớ theo người dùng — `sidebarPref.ts`). Padding giữ nguyên.
 *    · `"full-bleed"` — workbench đã chuyển sang `WorkbenchShell`/`EngineeringShell` (Task 11/13/14):
 *      như `"workbench"` và `<main>` bỏ hẳn padding.
 *    Trang rời đi ⇒ shell tự về `default`.
 *
 * Ngoài shell (test, storybook, trang tự dựng) context là `null` ⇒ hook là no-op, PageContainer giữ
 * padding cũ.
 */
import { createContext, useContext, useLayoutEffect } from "react";

export type ShellPageVariant = "default" | "workbench" | "full-bleed";

export interface ShellPageContextValue {
  /** Trang đang render bên trong `<main>` của shell. */
  inShellMain: true;
  /** Trang khai biến thể; trả hàm huỷ (về default). */
  registerVariant: (variant: ShellPageVariant) => () => void;
}

export const ShellPageContext = createContext<ShellPageContextValue | null>(null);

/** True khi đang ở trong `<main>` của shell — PageContainer dùng để bỏ đệm kép. */
export function useInShellMain(): boolean {
  return useContext(ShellPageContext) != null;
}

/**
 * Trang khai biến thể bố cục của mình. Gọi MỘT lần ở gốc trang. `useLayoutEffect` để shell đổi
 * padding/rail trước khi trình duyệt vẽ (không chớp rail mở rộng ở màn workbench).
 */
export function useShellPageVariant(variant: ShellPageVariant): void {
  const ctx = useContext(ShellPageContext);
  useLayoutEffect(() => {
    if (!ctx || variant === "default") return;
    return ctx.registerVariant(variant);
  }, [ctx, variant]);
}
