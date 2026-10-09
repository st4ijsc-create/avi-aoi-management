/**
 * Doc 81 Đợt 2 Task 3 — <PageHeaderCompact>: header trang MỘT hàng, cao 40–48 px.
 *
 *   [icon] H1 · [chips: NoticeStack / StatusChipStrip / chip trạng thái] ········ [actions]
 *
 * - KHÔNG có breadcrumb: breadcrumb duy nhất nằm ở top bar của shell (Task 2). Component này cố
 *   ý không nhận prop `breadcrumbs`.
 * - KHÔNG có dòng mô tả: câu mô tả/khi nào dùng chuyển vào `WhenToUseHint` trong slot `chips`.
 * - Chip và hành động nằm CÙNG hàng với h1, nên thiết bị đo (Task 1) không đếm chúng là banner
 *   dưới h1. Vùng chip cắt tràn (`overflow-hidden`) thay vì xuống dòng — header không bao giờ
 *   cao quá 48 px. Mang `data-layout-header` để thiết bị đo cấm đặt nó trong MAIN.
 * - doc 81 Đợt 3 Task 0 (D2/D3, browser check 2026-10-05): DƯỚI `sm` (640 px — điện thoại) một hàng không chứa nổi
 *   hành động: ở 375/414 px "Lưu phiên bản mới" (Recipes), "Làm mới"/chọn dự án (IDE) nằm quá mép phải và bị cắt, không
 *   với tới. Dưới 640 px header XUỐNG DÒNG (bỏ trần 48 px): chip và hành động mỗi thứ một hàng riêng, tự xuống dòng.
 *   Từ 640 px trở lên hợp đồng một hàng ≤ 48 px giữ nguyên (thiết bị đo chấm ở 1366/1600).
 * - doc 81 Đợt 3b Task 2 (b): header ĐO chính nó (headerChipFold.ts). Tràn ⇒ mức 1: vùng chip mở `HeaderChipFoldContext`
 *   ⇒ StatusChipStrip / NoticeStack bên trong gộp chip KHÔNG ghim / notice KHÔNG lỗi vào "+N" (cơ chế sẵn có). Vẫn tràn
 *   (chip ghim, chip tự viết, hành động) ⇒ mức 2: xuống dòng như dưới 640 px thay vì cắt. Không tràn (1366/1600) ⇒ như cũ.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Heading } from "./Heading";
import { LAYOUT_HEADER } from "./layoutMarkers";
import { HeaderChipFoldContext, contentSignature, useHeaderFitLevel } from "./headerChipFold";

export interface PageHeaderCompactProps {
  title: React.ReactNode;
  /** Icon lucide nhỏ (trang trí, aria-hidden). */
  icon?: React.ReactNode;
  /** Chip 1 dòng: NoticeStack, StatusChipStrip, badge trạng thái… */
  chips?: React.ReactNode;
  /** Hành động bên phải (nút, chọn máy…). */
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeaderCompact({ title, icon, chips, actions, className }: PageHeaderCompactProps): React.JSX.Element {
  const headerRef = React.useRef<HTMLElement>(null);
  // Fix round 1 (R-3b-b): đo lại theo CHỮ KÝ nội dung (dữ liệu), không theo danh tính JSX mới mỗi lượt dựng.
  const level = useHeaderFitLevel(headerRef, contentSignature([title, icon, chips, actions]));
  const fold = level >= 1;
  const wrap = level === 2;
  return (
    <header
      ref={headerRef}
      {...{ [LAYOUT_HEADER]: "" }}
      data-header-fit={level > 0 ? (wrap ? "wrap" : "fold") : undefined}
      style={wrap ? { minHeight: 40 } : { minHeight: 40, maxHeight: 48 }}
      className={cn(
        "flex flex-nowrap items-center gap-2 overflow-hidden max-sm:h-auto max-sm:max-h-none! max-sm:flex-wrap max-sm:gap-y-1 max-sm:py-1",
        className,
        // sau `className` của trang (IDE/IR/POU truyền `h-12 py-0`) ⇒ mức 2 thật sự cao theo nội dung, không cắt dọc.
        wrap && "h-auto flex-wrap gap-y-1 py-1",
      )}
    >
      {icon != null && (
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      )}
      {/* Fix round 1 (R-3b-b): mức GỘP ⇒ chip đã gọn tối đa (ghim/lỗi + "+N") được ưu tiên chỗ hơn h1 — h1 cắt chữ (…) nhưng
          giữ tối thiểu 4rem; không đủ nữa thì mức 2 xuống dòng. */}
      <Heading level={3} as="h1" className={cn("min-w-0 shrink truncate", level === 1 && "min-w-16")}>
        {title}
      </Heading>
      {chips != null && (
        <div
          data-header-chips=""
          data-chips-folded={fold ? "" : undefined}
          className={cn(
            "flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden max-sm:basis-full max-sm:flex-wrap",
            // chip xuống hàng RIÊNG phía dưới (order-last); h1 + hành động giữ hàng đầu.
            level === 1 && "shrink-0 basis-auto",
            wrap && "order-last basis-full flex-wrap gap-y-1",
          )}
        >
          <HeaderChipFoldContext.Provider value={fold}>{chips}</HeaderChipFoldContext.Provider>
        </div>
      )}
      {chips == null && <div className="flex-1" aria-hidden="true" />}
      {actions != null && (
        <div data-header-actions="" className={cn("flex shrink-0 flex-nowrap items-center gap-2 max-sm:basis-full max-sm:flex-wrap", wrap && "ml-auto min-w-0 shrink flex-wrap justify-end gap-y-1")}>
          {actions}
        </div>
      )}
    </header>
  );
}

export default PageHeaderCompact;
