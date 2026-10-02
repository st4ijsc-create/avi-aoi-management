/**
 * Doc 81 Đợt 2 Task 3 — <DetailSheet>: KHUNG chi tiết có tab (ECN: Tổng quan / Đối tượng / Duyệt /
 * Nhiệm vụ / Lịch sử; Recipes: Tham số / Phiên bản / Duyệt / Triển khai…).
 *
 * Là khung nội dung, không tự mở sheet: đặt trong một lớp `FlyoutHost` (flyout chi tiết) hoặc trong
 * panel chi tiết của `SplitListDetail`. Tab dựng trên `ui/tabs` (Radix — phím mũi tên chuyển tab).
 * `keepMounted` giữ instance của tab khi chuyển đi (Review Focus 3: tab có tiến trình đang sống —
 * worker, state-machine `phase`, stream — không được bị huỷ khi người dùng xem tab khác); tab ẩn
 * mang `hidden`.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface DetailSheetTab {
  value: string;
  label: React.ReactNode;
  content: React.ReactNode;
  /** Giữ mount khi tab không được chọn (tiến trình sống). */
  keepMounted?: boolean;
  disabled?: boolean;
}

export interface DetailSheetProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Badge trạng thái. */
  status?: React.ReactNode;
  /** Hành động của mục (nút). */
  actions?: React.ReactNode;
  tabs: readonly DetailSheetTab[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Cấp tiêu đề — "h3" khi khung nằm trong flyout đã có tiêu đề sheet. */
  headingAs?: "h2" | "h3";
  className?: string;
}

export function DetailSheet({
  title,
  subtitle,
  status,
  actions,
  tabs,
  value,
  defaultValue,
  onValueChange,
  headingAs = "h2",
  className,
}: DetailSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const [inner, setInner] = React.useState<string>(defaultValue ?? tabs[0]?.value ?? "");
  const active = value ?? inner;
  const Heading = headingAs;
  const change = (v: string) => {
    if (value === undefined) setInner(v);
    onValueChange?.(v);
  };
  return (
    <div data-detail-sheet="" className={cn("flex h-full min-h-0 flex-col gap-2", className)}>
      <div className="flex items-start gap-2 border-b pb-2">
        <div className="min-w-0 flex-1">
          <Heading className="truncate text-base font-semibold">{title}</Heading>
          {subtitle != null && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {status != null && <div className="shrink-0">{status}</div>}
        {actions != null && <div className="flex shrink-0 flex-wrap items-center gap-1">{actions}</div>}
      </div>
      <Tabs value={active} onValueChange={change} className="min-h-0 flex-1 gap-1">
        <TabsList aria-label={t("layoutKit.detail.tabs", "Detail sections")} className="h-9 w-full justify-start overflow-x-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} disabled={tab.disabled} className="min-h-8 flex-none text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            forceMount={tab.keepMounted ? true : undefined}
            hidden={tab.keepMounted ? active !== tab.value : undefined}
            className="min-h-0 overflow-auto"
          >
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default DetailSheet;
