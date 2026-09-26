import * as React from "react";
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";

import { cn } from "@/lib/utils";

/**
 * ★★★ 2026-08-23 — HAI Ô MỞ, và vì sao chúng là ô MỞ chứ không phải hành vi mặc định.
 *
 * Nghiệm thu live (Playwright, `/ai-coding-workspace`, 1600×1000) đo được: khung hội thoại có
 * `clientWidth = 400` nhưng `scrollWidth = 736` — **336 px nội dung nằm ngoài vùng nhìn, và KHÔNG
 * có thanh cuộn ngang nào để tới đó**. Hậu quả tại đúng thẻ duyệt HITL: nút "Duyệt & ghi" hiện
 * **100%**, nút "Hủy" hiện **12,2%**, đồng hồ hết hạn hiện **0%**.
 *
 * ── VÌ SAO NỘI DUNG RỘNG RA ĐƯỢC ────────────────────────────────────────────────────────────
 * Radix dựng BÊN TRONG `Viewport` một `<div style="min-width:100%; display:table">`. `display:table`
 * là **shrink-to-fit**: nó co giãn theo `max-content` của con, nên **bất kỳ** khối con nào rộng hơn
 * khung (một dòng diff dài, một thẻ bố cục cứng) đều **kéo cả tấm bảng rộng ra**, và mọi `%`/`ml-auto`
 * bên trong khi ấy tính theo tấm bảng ĐÃ PHÌNH — không theo khung. Đó là cơ chế đẩy nút "Hủy" ra
 * ngoài: nó vẫn "rộng 100%", chỉ là 100% của một tấm bảng 736 px trong một khung 400 px.
 *
 * ── HAI Ô ───────────────────────────────────────────────────────────────────────────────────
 *   • `vuaKhung` — ép tấm bảng ấy về `display:block` ⇒ con **KHÔNG BAO GIỜ** kéo khung rộng ra;
 *     chúng phải tự xuống dòng, tự thu gọn, hoặc tự cuộn TRONG hộp của mình. Đây là ô cưỡng chế
 *     luật *"hàng nút không được tràn"* **theo cấu tạo**, không bằng lời dặn.
 *   • `ngang` — vẽ thanh cuộn ngang. Đây là **lưới an toàn cho nội dung THẬT SỰ rộng** (dòng diff
 *     dài), **KHÔNG** phải cách chữa hàng nút: một thẻ duyệt phải *cuộn ngang mới bấm được Hủy* vẫn
 *     là thẻ duyệt HỎNG — người ta không cuộn, họ bấm cái đang thấy.
 *
 * ⚠⚠ CẢ HAI MẶC ĐỊNH **TẮT**. Lý do là phạm vi nổ: `ScrollArea` dùng ở hàng trăm chỗ, và đổi
 *    `display:table → block` cho TẤT CẢ sẽ đổi cách gói chữ ở mọi bảng/danh sách đang dựa vào
 *    shrink-to-fit. Bật theo từng chỗ, đo từng chỗ. Bài học repo: một bản vá "cho sạch toàn hệ"
 *    là một bản vá không ai đo nổi.
 */
function ScrollArea({
  className,
  children,
  vuaKhung = false,
  ngang = false,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Ép nội dung VỪA bề ngang khung (xem khối ★★★ ở trên). */
  vuaKhung?: boolean;
  /** Vẽ thanh cuộn NGANG — chỉ là lưới an toàn cho nội dung thật sự rộng. */
  ngang?: boolean;
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        data-vua-khung={vuaKhung ? "1" : undefined}
        className={cn(
          "focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1",
          // `[&>div]` = ĐÚNG tấm bảng `display:table` Radix tự chèn. `!` vì Radix đặt nó bằng
          // style nội tuyến; không `!important` thì lớp này thua.
          vuaKhung && "[&>div]:!block [&>div]:!min-w-0 [&>div]:!w-full",
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      {ngang && <ScrollBar orientation="horizontal" />}
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors select-none",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
