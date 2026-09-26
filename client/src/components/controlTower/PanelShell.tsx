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
import { ArrowUpRight, Lock, CheckCircle2 } from "lucide-react";
import { SectionCard } from "@/components/patterns";
import { ConnectionChip } from "@/components/patterns/ConnectionChip";
import { AsyncBoundary, type AsyncSkeletonPreset } from "@/components/AsyncBoundary";
import { PollFreshness } from "@/components/PollFreshness";
import { cn } from "@/lib/utils";

/* W7 GĐ2 (doc 67): pct/num/int/relTimeShort local → lib/format (fmtPct/fmtNum/
 * fmtInt/relTimeShort) và Tone/oeeTone/TONE_TEXT local → isaStateBadges
 * (SemanticTone/oeeTone/TONE_TEXT_CLASS). panels.tsx nay import thẳng từ nguồn
 * shared — PanelShell chỉ còn shell + isAuthzError + LivePill. */

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

/**
 * Small LIVE / POLLING pill reused across the tower.
 * W7 GĐ2: ngữ nghĩa riêng (API `live: boolean`, nhãn + tooltip i18n controlTower.*
 * đã chuẩn W2) GIỮ NGUYÊN — chỉ phần thân render đổi sang ConnectionChip shared
 * (state live|polling, size sm — cùng cỡ chữ/padding với pill cũ; icon Wifi cũ
 * thay bằng chấm trạng thái chuẩn của chip).
 */
export function LivePill({ live }: { live: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <span
      title={
        live
          ? t("controlTower.liveHint", "Live via socket — poll fallback active")
          : t("controlTower.pollHint", "Socket offline — polling for fresh data")
      }
    >
      <ConnectionChip
        state={live ? "live" : "polling"}
        label={live ? t("controlTower.live", "LIVE") : t("controlTower.polling", "POLLING")}
        size="sm"
      />
    </span>
  );
}

/**
 * doc 68 §3.2 (việc 4) — pill "Cập nhật Ns trước" chỉ hiện khi STALE (amber),
 * ẩn khi dữ liệu còn tươi (ISA-101: chrome im lặng, chỉ nói khi bất thường). Tự
 * tick 5s để phát hiện chuyển-sang-stale mà không phải chờ panel re-render.
 */
function StaleOnlyFreshness({
  updatedAt,
  staleAfterMs,
}: {
  updatedAt: number;
  staleAfterMs: number;
}): React.JSX.Element | null {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 5_000);
    return () => clearInterval(id);
  }, []);
  if (Date.now() - updatedAt <= staleAfterMs) return null;
  return <PollFreshness updatedAt={updatedAt} staleAfterMs={staleAfterMs} />;
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
  /**
   * doc 68 §3.2 (việc 2): empty là TIN TỐT ("tất cả ổn") — hiện 1 DÒNG gọn với
   * CheckCircle2 xanh thay vì khối py-8 cao. Mặc định false → 1 dòng trung tính.
   */
  emptyAllClear?: boolean;
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
  emptyAllClear = false,
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
            <StaleOnlyFreshness
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
            // doc 68 §3.2 (việc 2): co lại 1 dòng (py-1.5) thay vì khối py-8 cao.
            emptyAllClear ? (
              <div className="flex items-center gap-2 py-1.5 text-sm text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                <span>{emptyText ?? t("controlTower.allClear", "Không có gì bất thường — ổn định.")}</span>
              </div>
            ) : (
              <div className="py-1.5 text-sm text-muted-foreground">
                {emptyText ?? t("controlTower.noData", "No data yet.")}
              </div>
            )
          }
        >
          {children}
        </AsyncBoundary>
      )}
    </SectionCard>
  );
}

export default PanelShell;
