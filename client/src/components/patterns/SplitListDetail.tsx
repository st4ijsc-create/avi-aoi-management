/**
 * Doc 81 Đợt 2 Task 3 — <SplitListDetail>: mẫu P3 Danh sách–Chi tiết (ECN, Recipes, Interlock,
 * Standards, Integration). Lớp mỏng trên `WorkspaceShell` (react-resizable-panels): danh sách
 * 35–40 % bên trái, chi tiết bên phải; tạo/sửa/duyệt đi qua `FlyoutHost`.
 *
 * Dấu đo:
 * - `mainRegion` chọn vùng MAIN theo doc 81 §1.2: "list" (mặc định — ECN, Interlock), "detail"
 *   (Recipes: MAIN = chi tiết recipe), "both".
 * - `listToolbar` (tìm kiếm/FilterBar) nằm TRONG vùng danh sách, là `data-layout-toolbar` cao
 *   ≤56 px đứng trước bảng — không đặt bộ lọc thành một dải riêng giữa h1 và MAIN (bị đếm banner).
 * - Khi `mainRegion` gồm "detail", phần đầu chi tiết cũng phải theo luật toolbar (một hàng ≤56 px)
 *   trước phần tử làm việc.
 *
 * Kéo bằng bàn phím (separator có nhãn), bề rộng nhớ THEO NGƯỜI DÙNG. Dưới 1024 px: STACK — chưa
 * chọn ⇒ danh sách; đã chọn ⇒ chi tiết + nút "Quay lại danh sách" (`onBack`); vùng đang hiện là MAIN.
 * Qua lại mốc 1024 px KHÔNG remount danh sách/chi tiết: mỗi slot render một lần qua portal (`slotPortal.tsx`).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { cn } from "@/lib/utils";
import { LAYOUT_MAIN, LAYOUT_TOOLBAR } from "./layoutMarkers";
import { useNarrowViewport, userLayoutKey } from "./layoutKitHooks";
import { SlotOutlet, slotPortal, useSlotHost } from "./slotPortal";

export interface SplitListDetailProps {
  layoutId: string;
  userId: number | string | null | undefined;
  list: React.ReactNode;
  detail: React.ReactNode;
  /** Đang chọn một mục (quyết định hiện chi tiết hay emptyDetail; ở màn hẹp quyết định vùng hiện). */
  hasSelection: boolean;
  /** Màn hẹp: quay lại danh sách (thường là bỏ chọn). */
  onBack?: () => void;
  /** Hiện khi chưa chọn (màn rộng). */
  emptyDetail?: React.ReactNode;
  listToolbar?: React.ReactNode;
  listLabel?: string;
  detailLabel?: string;
  mainRegion?: "list" | "detail" | "both";
  /** % bề rộng danh sách (mặc định 38, tối thiểu 25, tối đa 60). */
  listDefaultPct?: number;
  listMinPct?: number;
  listMaxPct?: number;
  heightClass?: string;
  className?: string;
}

export function SplitListDetail({
  layoutId,
  userId,
  list,
  detail,
  hasSelection,
  onBack,
  emptyDetail,
  listToolbar,
  listLabel,
  detailLabel,
  mainRegion = "list",
  listDefaultPct = 38,
  listMinPct = 25,
  listMaxPct = 60,
  heightClass = "h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_5.5rem)]",
  className,
}: SplitListDetailProps): React.JSX.Element {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();
  const lLabel = listLabel ?? t("layoutKit.split.list", "List");
  const dLabel = detailLabel ?? t("layoutKit.split.detail", "Details");
  const mark = (on: boolean, name: string) => (on ? { [LAYOUT_MAIN]: name } : {});
  // Host DOM ổn định cho từng slot — qua lại 1024 px không remount (slotPortal.tsx, review I3).
  const hToolbar = useSlotHost("listToolbar");
  const hList = useSlotHost("list");
  const hDetail = useSlotHost("detail");
  const portals = (
    <>
      {slotPortal(listToolbar, hToolbar, "slot-toolbar")}
      {slotPortal(list, hList, "slot-list")}
      {slotPortal(hasSelection ? detail : emptyDetail, hDetail, "slot-detail")}
    </>
  );

  const listSection = (isMain: boolean) => (
    <section aria-label={lLabel} {...mark(isMain, `${layoutId}-list`)} className="flex h-full min-h-0 flex-col">
      {listToolbar != null && (
        <SlotOutlet host={hToolbar} {...{ [LAYOUT_TOOLBAR]: "" }} style={{ maxHeight: 56 }} className="flex shrink-0 items-center gap-2 overflow-hidden p-2" />
      )}
      <SlotOutlet host={hList} className="block min-h-0 flex-1 overflow-auto" />
    </section>
  );
  const detailSection = (isMain: boolean, withBack: boolean) => (
    <section aria-label={dLabel} {...mark(isMain, `${layoutId}-detail`)} className="flex h-full min-h-0 flex-col">
      {withBack && onBack && (
        <div className="shrink-0 pb-1">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            {t("layoutKit.split.back", "Back to the list")}
          </Button>
        </div>
      )}
      <SlotOutlet host={hDetail} className="block min-h-0 flex-1" />
    </section>
  );

  if (narrow) {
    return (
      <>
        <div key="narrow" data-split-list-detail="" data-narrow="" className={cn("flex min-h-0 flex-col", className)}>
          {hasSelection ? detailSection(true, true) : listSection(true)}
        </div>
        {portals}
      </>
    );
  }

  return (
    <>
      <WorkspaceShell
        key="wide"
        className={className}
        heightClass={heightClass}
        railDefaultSize={listDefaultPct}
        railMinSize={listMinPct}
        railMaxSize={listMaxPct}
        autoSaveId={userLayoutKey(layoutId, userId, "split")}
        handleLabel={t("layoutKit.split.resize", "Resize the list")}
        rail={listSection(mainRegion !== "detail")}
        main={detailSection(mainRegion !== "list", false)}
      />
      {portals}
    </>
  );
}

export default SplitListDetail;
