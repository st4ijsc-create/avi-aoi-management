/**
 * doc 40 Wave 4d §13.3 — <StatChip> (content-first KPI chip).
 *
 * Thẻ KPI 1 dòng, cao ~32–40px: [dot màu semantic tùy chọn] · [icon] · label ·
 * số (tabular-nums) · [delta]. Thay cho lưới <MetricCard> cao ~110px ở các strip
 * KPI để trả lại không gian dọc cho nội dung chính (bảng / canvas).
 *
 * Dùng kèm <StatChipRow> để xếp ngang, cuộn ngang khi tràn (overflow-x). Toàn bộ
 * dùng semantic token (bg/border/text) → tự lật light/dark, KHÔNG hardcode hex.
 *
 * @example
 *   <StatChipRow>
 *     <StatChip label="Tổng thiết bị" value={128} />
 *     <StatChip label="Trực tuyến" value={120} tone="success" />
 *     <StatChip label="Ngoại tuyến" value={8} tone="error" delta="-2" deltaTone="success" />
 *   </StatChipRow>
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import type { Tone } from "./tokens";

/** Tone → soft-tint dot + value text (semantic tokens only). */
const TONE_DOT: Record<Tone, string> = {
  default: "bg-muted-foreground/50",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
  info: "bg-info",
  accent: "bg-primary",
};

const TONE_VALUE: Record<Tone, string> = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  info: "text-info",
  accent: "text-primary",
};

/** delta tone (mũi tên xu hướng) — độc lập với tone của giá trị. */
const DELTA_TONE: Record<Tone, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  info: "text-info",
  accent: "text-primary",
};

export interface StatChipProps {
  /** Nhãn ngắn (mô tả KPI). */
  label: React.ReactNode;
  /** Giá trị chính — luôn render tabular-nums nếu là số/chuỗi số. */
  value: React.ReactNode;
  /** Icon nhỏ tùy chọn (lucide ~14px). */
  icon?: React.ReactNode;
  /** Màu semantic cho chấm + giá trị. Mặc định 'default' (trung tính). */
  tone?: Tone;
  /** Hiện chấm màu ở đầu chip. Mặc định true khi tone ≠ default. */
  showDot?: boolean;
  /** Dòng delta phụ (vd "+3", "-2%"). */
  delta?: React.ReactNode;
  /** Màu riêng cho delta (mặc định theo tone giá trị). */
  deltaTone?: Tone;
  /** Click → điều hướng/lọc (biến chip thành nút). */
  onClick?: () => void;
  /** Chip đang được chọn (highlight viền primary) — dùng khi làm bộ lọc. */
  active?: boolean;
  title?: string;
  className?: string;
}

export function StatChip({
  label,
  value,
  icon,
  tone = "default",
  showDot,
  delta,
  deltaTone,
  onClick,
  active = false,
  title,
  className,
}: StatChipProps): React.JSX.Element {
  const dotVisible = showDot ?? tone !== "default";
  const inner = (
    <>
      {dotVisible && (
        <span
          aria-hidden="true"
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[tone])}
        />
      )}
      {icon != null && (
        <span aria-hidden="true" className="shrink-0 text-muted-foreground [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
        </span>
      )}
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", TONE_VALUE[tone])}>
        {value}
      </span>
      {delta != null && (
        <span
          className={cn(
            "shrink-0 text-[11px] font-medium tabular-nums",
            DELTA_TONE[deltaTone ?? tone],
          )}
        >
          {delta}
        </span>
      )}
    </>
  );

  const base = cn(
    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border bg-card px-2.5",
    "shadow-sm",
    active ? "border-primary ring-1 ring-primary/40" : "border-border",
    onClick && "cursor-pointer transition-colors hover:bg-accent/50",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-pressed={active} className={base}>
        {inner}
      </button>
    );
  }
  return (
    <div title={title} className={base}>
      {inner}
    </div>
  );
}

/**
 * <StatChipRow> — hàng ngang các StatChip, cuộn ngang khi tràn (không xuống dòng),
 * giữ chiều cao strip ~40px. Ẩn thanh cuộn thô, vẫn cuộn được bằng trackpad/kéo.
 */
export function StatChipRow({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center gap-2 overflow-x-auto pb-0.5",
        "[scrollbar-width:thin]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export default StatChip;
