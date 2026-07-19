/**
 * Control Tower — <PanelShell> + shared panel helpers (doc 46 FE-W3.1).
 *
 * Every Control Tower panel is a compact live card that:
 *   • renders a titled <SectionCard> with an "Open full view →" cross-link to the
 *     specialised page (WarRoom, AlarmKPI, CommandCenter, …) for depth;
 *   • shows an HONEST loading / empty / error state (never a fabricated number);
 *   • degrades GRACEFULLY when the underlying query is UNAUTHORIZED for the
 *     current role — it hides the deep-link and shows a muted "not available for
 *     your role" note instead of a red error takeover.
 *
 * Pure presentation + a thin wrapper over <AsyncBoundary>; panels own their data.
 */
import * as React from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Lock, Wifi, WifiOff } from "lucide-react";
import { SectionCard } from "@/components/patterns";
import { AsyncBoundary, type AsyncSkeletonPreset } from "@/components/AsyncBoundary";
import { PollFreshness } from "@/components/PollFreshness";
import { cn } from "@/lib/utils";

// ── Formatting helpers (honest "—" for null/undefined) ───────────────────────
export function pct(v: number | null | undefined, digits = 1): string {
  return v == null || Number.isNaN(v) ? "—" : `${v.toFixed(digits)}%`;
}
export function num(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "—" : v.toLocaleString();
}
export function int(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "—" : Math.round(v).toLocaleString();
}

export type Tone = "default" | "success" | "warning" | "error" | "info" | "accent";

/** OEE threshold → semantic tone (≥80 good · ≥60 warn · <60 poor · null neutral). */
export function oeeTone(v: number | null | undefined): Tone {
  if (v == null || Number.isNaN(v)) return "default";
  if (v >= 80) return "success";
  if (v >= 60) return "warning";
  return "error";
}

export const TONE_TEXT: Record<Tone, string> = {
  default: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
  info: "text-info",
  accent: "text-primary",
};

/** Compact relative time ("5s", "3m", "2h", "4d") from a timestamp (ms) / ISO. */
export function relTimeShort(input: number | string | Date | null | undefined, now = Date.now()): string {
  if (input == null) return "—";
  const ts = input instanceof Date ? input.getTime() : typeof input === "string" ? Date.parse(input) : input;
  if (Number.isNaN(ts)) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Is this tRPC error an authorization failure (role can't call the procedure)?
 * We degrade such panels quietly rather than showing a scary red error.
 */
export function isAuthzError(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as { data?: { code?: string }; shape?: { data?: { code?: string } }; message?: unknown };
  const code = anyErr?.data?.code ?? anyErr?.shape?.data?.code;
  if (code === "UNAUTHORIZED" || code === "FORBIDDEN") return true;
  const msg = anyErr?.message;
  return typeof msg === "string" && /unauthorized|forbidden|not authorized|permission|access denied/i.test(msg);
}

/** Small LIVE / POLLING pill reused across the tower. */
export function LivePill({ live }: { live: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return live ? (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success"
      title={t("controlTower.liveHint", "Live via socket — poll fallback active")}
    >
      <Wifi className="h-3 w-3" aria-hidden="true" />
      {t("controlTower.live", "LIVE")}
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning"
      title={t("controlTower.pollHint", "Socket offline — polling for fresh data")}
    >
      <WifiOff className="h-3 w-3" aria-hidden="true" />
      {t("controlTower.polling", "POLLING")}
    </span>
  );
}

export interface PanelShellProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Deep-link to the specialised full view (wouter route). */
  linkHref: string;
  /** Override the "Open full view" label. */
  linkLabel?: string;
  /** Extra header action (e.g. a LivePill) rendered before the link. */
  headerExtra?: React.ReactNode;

  /**
   * W2 (AUD-01): react-query `dataUpdatedAt` của query chính nuôi panel — khi có,
   * header hiện pill tuổi dữ liệu (PollFreshness, tự tick 1s trong component con,
   * KHÔNG re-render panel). Số cũ không bao giờ hiển thị như mới nữa.
   */
  dataUpdatedAt?: number;
  /**
   * Chu kỳ poll (ms) của panel — ngưỡng stale = 2× giá trị này (ISA-101: chỉ tô
   * amber khi dữ liệu quá 2 chu kỳ poll, tức poll fallback cũng đã fail).
   */
  pollIntervalMs?: number;

  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;

  /** Skeleton preset while loading (default "list"). */
  preset?: AsyncSkeletonPreset;
  /** Text shown when there is genuinely no data. */
  emptyText?: string;
  errorTitle?: string;

  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PanelShell({
  icon,
  title,
  description,
  linkHref,
  linkLabel,
  headerExtra,
  dataUpdatedAt,
  pollIntervalMs,
  isLoading,
  isError = false,
  error,
  isEmpty = false,
  onRetry,
  preset = "list",
  emptyText,
  errorTitle,
  children,
  className,
  contentClassName,
}: PanelShellProps): React.JSX.Element {
  const { t } = useTranslation();
  const authz = isError && isAuthzError(error);

  // W4 (doc 67): vùng chạm ≥40px (min-h-10 + padding) nhưng GIỮ cỡ chữ text-xs;
  // margin âm bù lại padding để header panel không phình cao hơn trước.
  const deepLink = (
    <Link
      href={linkHref}
      className="-my-2 -mr-2 inline-flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-2 text-xs font-medium text-primary transition-colors hover:bg-accent/50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {linkLabel ?? t("controlTower.openFull", "Open full view")}
      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
    </Link>
  );

  return (
    <SectionCard
      className={cn("flex flex-col", className)}
      icon={icon}
      title={title}
      description={description}
      action={
        <div className="flex items-center gap-2">
          {/* W2 (AUD-01): tuổi dữ liệu per-panel — PollFreshness tự tick trong chính nó,
              amber chỉ khi quá 2× chu kỳ poll (poll fallback cũng đã fail). dataUpdatedAt=0
              nghĩa là chưa fetch thành công lần nào → chưa có gì để khai tuổi. */}
          {dataUpdatedAt != null && dataUpdatedAt > 0 && (
            <PollFreshness
              updatedAt={dataUpdatedAt}
              staleAfterMs={(pollIntervalMs ?? 60_000) * 2}
            />
          )}
          {headerExtra}
          {/* When the role can't access the data, the deep-link is misleading — hide it. */}
          {!authz && deepLink}
        </div>
      }
      contentClassName={cn("pt-0", contentClassName)}
    >
      {authz ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t("controlTower.noAccess", "Not available for your role.")}
        </div>
      ) : (
        <AsyncBoundary
          isLoading={isLoading}
          isError={isError}
          error={error}
          isEmpty={isEmpty}
          onRetry={onRetry}
          preset={preset}
          errorTitle={errorTitle ?? t("controlTower.loadError", "Couldn't load this panel")}
          retryLabel={t("controlTower.retry", "Retry")}
          emptyState={
            <div className="py-8 text-center text-sm text-muted-foreground">
              {emptyText ?? t("controlTower.noData", "No data yet.")}
            </div>
          }
        >
          {children}
        </AsyncBoundary>
      )}
    </SectionCard>
  );
}

export default PanelShell;
