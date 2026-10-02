/**
 * Doc 81 Đợt 2 Task 3 (fix round 1, review I3) — giữ NGUYÊN instance nội dung khi layout đổi cây.
 *
 * Bệnh: WorkbenchShell/SplitListDetail dựng một cây cho màn rộng (panel cạnh nhau) và một cây khác
 * cho màn hẹp (tab/stack). Qua lại mốc 1024 px ⇒ React gỡ cây này, dựng cây kia ⇒ mọi nội dung
 * (editor, Copilot đang stream, worker…) bị unmount rồi mount lại — vi phạm Review Focus 3.
 *
 * Cách chữa: mỗi slot được render MỘT lần, ở vị trí cố định trong cây React, bằng `createPortal`
 * vào một phần tử DOM tách rời ỔN ĐỊNH (`useSlotHost`). Hai layout chỉ render `<SlotOutlet>` —
 * một phần tử nhận (appendChild) node host đó trong layout effect. Đổi layout chỉ DỜI node DOM;
 * instance React của nội dung không bao giờ di chuyển nên không remount.
 *
 * Host dùng `display: contents` nên con của nó là con trực tiếp (theo bố cục) của outlet — markup
 * hiệu dụng giống như khi nội dung nằm thẳng trong outlet (flex/overflow của outlet vẫn áp).
 * Đặt các portal SAU cây layout trong cùng fragment: layout effect của outlet (gắn host) chạy trước
 * layout effect của nội dung, nên nội dung đo được kích thước ngay lần mount đầu.
 */
import * as React from "react";
import { createPortal } from "react-dom";

/** Một phần tử DOM tách rời, sống suốt đời component. */
export function useSlotHost(name: string): HTMLDivElement {
  const [el] = React.useState(() => {
    const d = document.createElement("div");
    d.setAttribute("data-slot-host", name);
    d.style.display = "contents";
    return d;
  });
  return el;
}

type OutletTag = "div" | "aside" | "section" | "nav";

export type SlotOutletProps = {
  host: HTMLDivElement;
  as?: OutletTag;
} & Omit<React.HTMLAttributes<HTMLElement>, "children"> &
  Record<`data-${string}`, string | undefined>;

/** Phần tử layout nhận node host của một slot. */
export function SlotOutlet({ host, as = "div", ...rest }: SlotOutletProps): React.JSX.Element {
  const ref = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    const outlet = ref.current;
    if (!outlet) return;
    outlet.appendChild(host);
    return () => {
      if (host.parentNode === outlet) outlet.removeChild(host);
    };
  }, [host]);
  return React.createElement(as, { ...rest, ref });
}

/** Portal ổn định của một slot (null khi không có nội dung). */
export function slotPortal(node: React.ReactNode, host: HTMLDivElement, key: string): React.ReactPortal | null {
  if (node === null || node === undefined || node === false) return null;
  return createPortal(node, host, key);
}
