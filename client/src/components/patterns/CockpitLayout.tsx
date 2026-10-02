/**
 * Doc 81 Đợt 2 Task 3 — <CockpitLayout>: mẫu P4 Cockpit (Hub, Fleet, Safety; FE2 §5 còn cho
 * EqStandards/EqIntegration): header 1 hàng (h1 + notice + dải chip KPI) · MỘT MAIN lớn · panel phụ.
 * Dựng trên `TabbedHub` (tab đồng bộ `?tab=`, giữ tham số khác) + `PageHeaderCompact` +
 * `StatusChipStrip`/`NoticeStack` do trang truyền vào.
 *
 * Dấu đo (thiết bị đo Task 1):
 * - Notice và chip KPI nằm trong `PageHeaderCompact` CÙNG HÀNG h1 ⇒ không có khối nào giữa h1 và
 *   MAIN (một dải chip riêng phía trên MAIN sẽ bị đếm là banner).
 * - MAIN (`data-layout-main`) = hàng tab + nội dung tab. Hàng tab (cộng `toolbarEnd`) là
 *   `data-layout-toolbar` DUY NHẤT trong MAIN; nội dung tab phải mở đầu bằng phần tử làm việc
 *   (bảng/canvas/EmptyState) — không chen thêm thanh lọc thứ hai (đặt nó vào `toolbarEnd`).
 * - Panel phụ là `<aside role="complementary">` ngoài MAIN; dưới 1024 px xếp xuống dưới MAIN.
 * - Tab `keepMounted` (TabbedHub) giữ instance khi ẩn — Review Focus 3 (Safety collaboration,
 *   Integration acquisition).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { TabbedHub, type TabbedHubTab } from "@/components/workspace/TabbedHub";
import { cn } from "@/lib/utils";
import { PageHeaderCompact } from "./PageHeaderCompact";
import { LAYOUT_MAIN, LAYOUT_TOOLBAR } from "./layoutMarkers";
import { useNarrowViewport } from "./layoutKitHooks";

export interface CockpitLayoutProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** Hành động bên phải header. */
  actions?: React.ReactNode;
  /** `<NoticeStack>` / `<WhenToUseHint>` / `<FeatureStatusNoticeChip>` — vào header. */
  notices?: React.ReactNode;
  /** `<StatusChipStrip>` — vào header (cùng hàng h1). */
  chips?: React.ReactNode;
  /** Tab (TabbedHub) — MAIN là hàng tab + nội dung tab. */
  tabs?: readonly TabbedHubTab[];
  basePath?: string;
  defaultTab?: string;
  /** Không có tab: nội dung MAIN. */
  main?: React.ReactNode;
  /** Không có tab: thanh công cụ ≤56 px trong MAIN. */
  toolbar?: React.ReactNode;
  /** Có tab: nội dung cùng hàng dải tab (bộ lọc/hành động). */
  toolbarEnd?: React.ReactNode;
  side?: React.ReactNode;
  sideLabel?: string;
  /** Bề rộng panel phụ (px), mặc định 340. */
  sideWidth?: number;
  /** Giá trị `data-layout-main`. */
  mainName?: string;
  className?: string;
}

export function CockpitLayout({
  title,
  icon,
  actions,
  notices,
  chips,
  tabs,
  basePath,
  defaultTab,
  main,
  toolbar,
  toolbarEnd,
  side,
  sideLabel,
  sideWidth = 340,
  mainName = "cockpit",
  className,
}: CockpitLayoutProps): React.JSX.Element {
  const { t } = useTranslation();
  const narrow = useNarrowViewport();
  const headerChips =
    notices != null || chips != null ? (
      <>
        {notices}
        {chips}
      </>
    ) : undefined;
  const mainProps = { [LAYOUT_MAIN]: mainName };
  const toolbarAttrs = { [LAYOUT_TOOLBAR]: "" } as Record<`data-${string}`, string>;

  return (
    <div data-cockpit="" className={cn("flex min-h-0 flex-col gap-2", className)}>
      <PageHeaderCompact title={title} icon={icon} chips={headerChips} actions={actions} />
      <div data-cockpit-body="" data-narrow={narrow ? "" : undefined} className={cn("flex min-h-0 flex-1 gap-3", narrow ? "flex-col" : "flex-row")}>
        <div {...mainProps} className="min-w-0 flex-1">
          {tabs && tabs.length > 0 ? (
            <TabbedHub
              tabs={tabs}
              basePath={basePath ?? (typeof window !== "undefined" ? window.location.pathname : "/")}
              defaultTab={defaultTab}
              className="flex min-h-0 flex-col gap-0"
              listRowAttrs={toolbarAttrs}
              listRowStyle={{ maxHeight: 56 }}
              listRowClassName="flex-nowrap overflow-hidden"
              listEnd={toolbarEnd}
              listClassName="flex h-9 min-h-9 flex-nowrap overflow-x-auto"
            />
          ) : (
            <>
              {toolbar != null && (
                <div {...toolbarAttrs} style={{ maxHeight: 56 }} className="flex min-w-0 items-center gap-2 overflow-hidden pb-2">
                  {toolbar}
                </div>
              )}
              {main}
            </>
          )}
        </div>
        {side != null && (
          <aside
            aria-label={sideLabel ?? t("layoutKit.cockpit.side", "Side panel")}
            style={narrow ? undefined : { width: sideWidth }}
            className={cn("min-h-0 shrink-0 overflow-auto rounded-md border bg-card p-3", narrow && "w-full")}
          >
            {side}
          </aside>
        )}
      </div>
    </div>
  );
}

export default CockpitLayout;
