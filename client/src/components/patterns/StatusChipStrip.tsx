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
 *
 * Fix round 1: header 1 dòng cắt phần tràn — một chip LỖI không được là thứ bị cắt. Quá
 * `maxVisible` (mặc định 5) chip ⇒ chọn hiện theo ưu tiên error > degraded > loading > ok (giữ thứ
 * tự gốc khi hiển thị), phần còn lại vào chip "+N" mở popover (lỗi đứng đầu). "+N" mang
 * `data-state="error"` khi trong phần giấu vẫn còn chip lỗi.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  /**
   * Ruling R-2-p (Đợt 2 Task 8 fix round 1) — chip GHIM không bao giờ vào "+N" (vd số sự kiện an toàn chưa
   * kiểm định trên Safety). Mọi chip ghim luôn hiện, kể cả khi vượt `maxVisible`; chỗ còn lại mới chia theo ưu tiên.
   */
  pinned?: boolean;
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
      // Đợt 2 Task 7: `relative` giữ mô tả sr-only (absolute) TRONG chip — chip bị header/dải cắt không làm trang rộng ra.
      "relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-2.5",
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
  /** Số chip hiện thẳng; phần dư vào "+N" (lỗi luôn được ưu tiên hiện). Mặc định 5. */
  maxVisible?: number;
  className?: string;
}

const STATE_PRIORITY: Record<ChipState, number> = { error: 0, degraded: 1, loading: 2, ok: 3 };

/**
 * Chia chip thành phần hiện (thứ tự gốc) và phần giấu (lỗi đầu). Chip GHIM luôn hiện (R-2-p); chỗ còn lại
 * (`maxVisible` − số chip ghim) chia cho chip không ghim theo ưu tiên error > degraded > loading > ok.
 */
export function splitChipsForOverflow(items: readonly StatusChipItem[], maxVisible: number): { visible: StatusChipItem[]; hidden: StatusChipItem[] } {
  if (items.length <= maxVisible) return { visible: [...items], hidden: [] };
  const pinnedIdx = items.map((it, i) => (it.pinned ? i : -1)).filter((i) => i >= 0);
  const ranked = items
    .map((it, i) => ({ it, i, p: STATE_PRIORITY[effectiveChipState(it)] }))
    .filter((x) => !x.it.pinned)
    .sort((a, b) => a.p - b.p || a.i - b.i);
  const free = Math.max(0, maxVisible - pinnedIdx.length);
  const keep = new Set([...pinnedIdx, ...ranked.slice(0, free).map((x) => x.i)]);
  const visible = items.filter((_, i) => keep.has(i));
  const hidden = ranked.filter((x) => !keep.has(x.i)).map((x) => x.it);
  return { visible, hidden };
}

/** Trạng thái hiển thị của chip "+N" (R-2-p): TỆ NHẤT trong các chip bị giấu, tính cả TÔNG của chip (vd số chưa
 *  kiểm định tô cảnh báo). error > warning (degraded hoặc tông cảnh báo) > loading > ok. */
export type OverflowState = "error" | "warning" | "loading" | "ok";
export function overflowState(hidden: readonly StatusChipItem[]): OverflowState {
  let worst: OverflowState = "ok";
  const rank: Record<OverflowState, number> = { error: 0, warning: 1, loading: 2, ok: 3 };
  for (const it of hidden) {
    const st = effectiveChipState(it);
    const s: OverflowState =
      st === "error" || it.tone === "error" ? "error" : st === "degraded" || it.tone === "warning" ? "warning" : st === "loading" ? "loading" : "ok";
    if (rank[s] < rank[worst]) worst = s;
  }
  return worst;
}

const OVERFLOW_CLASS: Record<OverflowState, string> = {
  error: "border-destructive/50 text-destructive",
  warning: "border-warning/60 bg-warning/10 text-warning",
  loading: "text-muted-foreground",
  ok: "text-muted-foreground",
};

export function StatusChipStrip({ items, ariaLabel, maxVisible = 5, className }: StatusChipStripProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (items.length === 0) return null;
  const { visible, hidden } = splitChipsForOverflow(items, maxVisible);
  const hiddenState = overflowState(hidden);
  return (
    <div
      role="group"
      aria-label={ariaLabel ?? t("layoutKit.chip.stripLabel", "Indicators")}
      data-status-chip-strip=""
      className={cn("flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none]", className)}
    >
      {visible.map((it) => (
        <StatusChip key={it.id} item={it} />
      ))}
      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-chip-more={hidden.length}
              data-state={hiddenState}
              aria-label={t("layoutKit.chip.moreLabel", "Show {{count}} more indicators", { count: hidden.length })}
              style={{ height: 32 }}
              className={cn(
                "inline-flex shrink-0 items-center rounded-md border bg-card px-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                OVERFLOW_CLASS[hiddenState],
              )}
            >
              {t("layoutKit.notice.more", "+{{count}}", { count: hidden.length })}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="flex w-auto max-w-[28rem] flex-wrap gap-1.5 p-2">
            {hidden.map((it) => (
              <StatusChip key={it.id} item={it} />
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export default StatusChipStrip;
