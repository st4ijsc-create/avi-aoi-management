/**
 * doc 81 Đợt 8 task P1 — `<WithFlyout>`: đưa API của `FlyoutHost` (`useFlyout()`) vào JSX mà trang dựng sẵn từ trên
 * (IDE/IR/POU dựng explorer / toolbar / header trong CÙNG hàm trang, nằm NGOÀI cây con của `<FlyoutHost>` lúc gọi hook).
 * Phần tử này được render BÊN TRONG host ⇒ `useFlyout()` hợp lệ; nút mở gọi `f.open(key, { id })` như mọi màn khác.
 */
import type { ReactNode } from "react";
import { useFlyout, type FlyoutApi } from "@/components/patterns/FlyoutHost";

export function WithFlyout({ children }: { children: (flyout: FlyoutApi) => ReactNode }) {
  const flyout = useFlyout();
  return <>{children(flyout)}</>;
}

export default WithFlyout;
