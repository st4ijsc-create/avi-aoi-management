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
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { Heading } from "./Heading";
import { LAYOUT_HEADER } from "./layoutMarkers";

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
  return (
    <header
      {...{ [LAYOUT_HEADER]: "" }}
      style={{ minHeight: 40, maxHeight: 48 }}
      className={cn("flex flex-nowrap items-center gap-2 overflow-hidden", className)}
    >
      {icon != null && (
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      )}
      <Heading level={3} as="h1" className="min-w-0 shrink truncate">
        {title}
      </Heading>
      {chips != null && (
        <div data-header-chips="" className="flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-hidden">
          {chips}
        </div>
      )}
      {chips == null && <div className="flex-1" aria-hidden="true" />}
      {actions != null && (
        <div data-header-actions="" className="flex shrink-0 flex-nowrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

export default PageHeaderCompact;
