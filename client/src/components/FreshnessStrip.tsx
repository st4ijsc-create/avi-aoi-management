/**
 * FreshnessStrip — doc 63 (AUD-01 / G8 / FEA-F1) — the shell-level, socket-aware
 * "how fresh is what you're looking at" indicator.
 *
 * Unlike OfflineBanner (which reads navigator.onLine ONLY and therefore MISSES the
 * server-dead / socket-drop case where the LAN is still up), FreshnessStrip derives
 * its truth from the shared socket connection (useSocketConnected) PLUS the age of the
 * newest data for the current scope. It NEVER presents frozen data as live:
 *
 *   live    → socket connected AND newest data younger than staleAfterMs → QUIET / neutral
 *   stale   → socket connected BUT data older than staleAfterMs          → AMBER (abnormal)
 *   polling → socket down, surface still refetches on a timer            → AMBER
 *   offline → socket down, no polling fallback                           → muted / danger
 *
 * ISA-101: the normal (live) state is neutral/quiet; saturated colour is reserved for
 * the abnormal (stale/offline) states. The timestamp is ABSOLUTE ("as-of HH:MM:SS") so a
 * frozen value is obvious — an as-of that stops advancing is the honest staleness signal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Radio, RefreshCw, WifiOff, AlertTriangle } from "lucide-react";
import { useSocketConnected } from "./RealtimeBadge";
import { cn } from "@/lib/utils";

export type FreshnessState = "live" | "stale" | "polling" | "offline";

/** Pure state resolver — connection truth first, then data-age. */
export function computeFreshnessState(
  connected: boolean,
  updatedAt: number | null | undefined,
  staleAfterMs: number,
  pollingFallback: boolean,
): FreshnessState {
  if (!connected) return pollingFallback ? "polling" : "offline";
  if (updatedAt != null && Date.now() - updatedAt > staleAfterMs) return "stale";
  return "live";
}

/** Absolute "HH:MM:SS" stamp (local time) of the newest data, or null when unknown. */
function asOfStamp(updatedAt: number | null | undefined): string | null {
  if (updatedAt == null) return null;
  const d = new Date(updatedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function FreshnessStrip({
  updatedAt,
  connected,
  pollingFallback = true,
  staleAfterMs = 30_000,
  className,
}: {
  /** Newest data timestamp for the current scope (ms). Undefined → age unknown. */
  updatedAt?: number | null;
  /** Live socket state. If omitted, the strip subscribes to the shared socket itself. */
  connected?: boolean;
  /** Does the surface still refetch on a timer when the socket is down? */
  pollingFallback?: boolean;
  /** Data older than this (ms) is treated as stale even while connected. */
  staleAfterMs?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const selfConnected = useSocketConnected();
  const isConnected = connected ?? selfConnected;

  // Re-render every second so age-based staleness and the as-of stamp stay honest.
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const state = computeFreshnessState(isConnected, updatedAt, staleAfterMs, pollingFallback);
  const stamp = useMemo(() => asOfStamp(updatedAt), [updatedAt]);

  // ISA-101: live is neutral/quiet; stale/offline earn saturated/abnormal colour.
  const tone =
    state === "live"
      ? "border-border bg-muted/60 text-muted-foreground"
      : state === "stale"
        ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
        : state === "polling"
          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
          : "border-destructive/50 bg-destructive/10 text-destructive";

  const Icon =
    state === "live" ? Radio : state === "stale" ? AlertTriangle : state === "polling" ? RefreshCw : WifiOff;

  const label =
    state === "live"
      ? t("realtime.live", "Trực tiếp")
      : state === "stale"
        ? t("freshness.stale", "Dữ liệu cũ")
        : state === "polling"
          ? t("realtime.polling", "Định kỳ")
          : t("realtime.offline", "Mất kết nối");

  return (
    <span
      role="status"
      aria-live="polite"
      title={
        stamp
          ? t("freshness.asOf", { time: stamp, defaultValue: "Dữ liệu tính đến {{time}}" })
          : label
      }
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none",
        tone,
        className,
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", state === "live" && "animate-pulse")} aria-hidden="true" />
      <span className="truncate">{label}</span>
      {stamp && (
        <span className="font-mono tabular-nums opacity-80">
          {state === "live" ? `· ${stamp}` : `· ${t("freshness.asOfShort", { time: stamp, defaultValue: "tính đến {{time}}" })}`}
        </span>
      )}
    </span>
  );
}

export default FreshnessStrip;
