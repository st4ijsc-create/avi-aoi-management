/**
 * Doc 81 Đợt 2 Task 3 — <StatusChipStrip>: dải chip KPI 32 px thay lưới thẻ KPI 130–146 px.
 *
 * LUẬT TRUNG THỰC (Đợt 1: PendingReviewStrip HUB-01, FeatureStatusGate PLT-02): mỗi chip có
 * ĐÚNG MỘT trong bốn trạng thái và không bao giờ trộn:
 *   ok       — nguồn đọc được đủ  → in số
 *   loading  — chưa có câu trả lời → "Đang tải", KHÔNG in số (kể cả value=0 được truyền vào)
 *   error    — nguồn lỗi           → "Lỗi", KHÔNG in số 0
 *   degraded — đọc được một phần   → in số kèm "≥" và tooltip "có thể thiếu"
 * `state: "ok"` mà `value` null/undefined bị hạ xuống `error` — "không biết" không được trưng
 * ra như một con số. Mỗi chip mang NGUỒN của con số (`source`) trong title + aria-describedby.
 *
 * Dấu đo: mỗi chip mang `data-layout-kpi`, cao 32 px. Dải đặt NGOÀI MAIN (header/CockpitLayout).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tone } from "./tokens";
import { LAYOUT_KPI } from "./layoutMarkers";

export type ChipState = "ok" | "loading" | "error" | "degraded";

export interface StatusChipItem {
  id: string;
  label: React.ReactNode;
  value: number | string | null | undefined;
  state: ChipState;
  /** Nguồn của con số (vd "ecn.list (DB)", "Đăng ký — không phải kết nối sống"). Bắt buộc. */
  source: string;
  tone?: Tone;
  /** Chip bấm được (lọc/điều hướng). */
  onClick?: () => void;
  active?: boolean;
}

const TONE_VALUE: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  info: "text-info",
  accent: "text-primary",
};

/** Trạng thái hiển thị thật: ok mà không có giá trị ⇒ error. */
export function effectiveChipState(item: Pick<StatusChipItem, "state" | "value">): ChipState {
  if (item.state === "ok" && (item.value === null || item.value === undefined)) return "error";
  return item.state;
}

interface QueryLike<T> {
  data: T | undefined;
  isLoading?: boolean;
  isPending?: boolean;
  isError?: boolean;
}

/**
 * Suy trạng thái chip từ một query react-query. Lỗi thắng data cũ trong cache; data undefined
 * luôn là "loading" (không đoán "ok"); `isDegraded(data)` do trang chỉ ra (vd `d.degraded`).
 */
export function chipStateFromQuery<T>(q: QueryLike<T>, isDegraded?: (data: T) => boolean | undefined): ChipState {
  if (q.isError) return "error";
  if (q.data === undefined || q.isLoading) return "loading";
  if (isDegraded && isDegraded(q.data)) return "degraded";
  return "ok";
}

function StatusChip({ item }: { item: StatusChipItem }): React.JSX.Element {
  const { t } = useTranslation();
  const state = effectiveChipState(item);
  const descId = React.useId();
  const sourceText = t("layoutKit.chip.source", "Source: {{source}}", { source: item.source });
  const hint =
    state === "error"
      ? t("layoutKit.chip.errorHint", "The source could not be read — no number is shown.")
      : state === "degraded"
        ? t("layoutKit.chip.degradedHint", "The source is only partly readable — the number may be incomplete.")
        : null;
  const title = hint ? `${sourceText}\n${hint}` : sourceText;

  let valueNode: React.ReactNode;
  if (state === "loading") {
    valueNode = (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        {t("layoutKit.chip.loading", "Loading")}
      </span>
    );
  } else if (state === "error") {
    valueNode = (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
        {t("layoutKit.chip.error", "Error")}
      </span>
    );
  } else {
    valueNode = (
      <span className={cn("text-sm font-semibold tabular-nums", TONE_VALUE[item.tone ?? "default"])}>
        {state === "degraded" ? `≥${item.value}` : item.value}
      </span>
    );
  }

  const common = {
    [LAYOUT_KPI]: item.id,
    "data-chip-id": item.id,
    "data-state": state,
    "aria-busy": state === "loading" ? true : undefined,
    "aria-describedby": descId,
    title,
    style: { height: 32 },
    className: cn(
      "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-2.5",
      state === "error" && "border-destructive/40",
      state === "degraded" && "border-dashed border-warning/60",
      item.active ? "border-primary ring-1 ring-primary/40" : null,
      item.onClick && "cursor-pointer hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    ),
  } as const;

  const inner = (
    <>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</span>
      {valueNode}
      <span id={descId} className="sr-only">
        {title}
      </span>
    </>
  );

  if (item.onClick) {
    return (
      <button type="button" onClick={item.onClick} aria-pressed={item.active ?? false} {...common}>
        {inner}
      </button>
    );
  }
  return <div {...common}>{inner}</div>;
}

export interface StatusChipStripProps {
  items: readonly StatusChipItem[];
  /** Nhãn nhóm cho trình đọc màn hình; mặc định "Chỉ số". */
  ariaLabel?: string;
  className?: string;
}

export function StatusChipStrip({ items, ariaLabel, className }: StatusChipStripProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t("layoutKit.chip.stripLabel", "Indicators")}
      data-status-chip-strip=""
      className={cn("flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none]", className)}
    >
      {items.map((it) => (
        <StatusChip key={it.id} item={it} />
      ))}
    </div>
  );
}

export default StatusChipStrip;
