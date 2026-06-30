/**
 * RealtimeBadge — a small, HONEST indicator of how fresh the data on a surface is.
 *
 * Three truthful states, derived from the shared socket connection:
 *   - "live"     → socket connected AND we are subscribed to push events
 *   - "polling"  → socket NOT connected but the page still refetches on a timer
 *   - "offline"  → socket NOT connected and there is no polling fallback
 *
 * It NEVER claims "live" when the socket is down. Pass `mode` explicitly (the
 * owner of the page knows whether it polls as a fallback). Optionally pass
 * `lastEventAt` to surface "Xs ago" so staleness is visible even while connected.
 *
 * i18n: realtime.live / realtime.polling / realtime.offline / realtime.lastEvent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { getSharedSocket } from "@/lib/socketManager";
import { cn } from "@/lib/utils";
import { Radio, RefreshCw, WifiOff } from "lucide-react";

export type RealtimeMode = "live" | "polling" | "offline";

/**
 * Subscribe to the shared socket and report its live connection state.
 * Returns `true` when connected, `false` otherwise. Self-cleaning.
 */
export function useSocketConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const socket = getSharedSocket();
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);
  return connected;
}

export function RealtimeBadge({
  connected,
  pollingFallback = true,
  lastEventAt,
  className,
}: {
  /** Live socket connection state. If omitted, the badge subscribes itself. */
  connected?: boolean;
  /** Does the page still refetch on a timer when the socket is down? */
  pollingFallback?: boolean;
  /** Timestamp of the last push event received, to show "Xs ago". */
  lastEventAt?: Date | number | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const selfConnected = useSocketConnected();
  const isConnected = connected ?? selfConnected;

  const mode: RealtimeMode = isConnected ? "live" : pollingFallback ? "polling" : "offline";

  // Tick once a second so the "Xs ago" relative time stays fresh while mounted.
  const [, setTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!lastEventAt) return;
    tickRef.current = setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [lastEventAt]);

  const ago = useMemo(() => {
    if (!lastEventAt) return null;
    const ms = Date.now() - new Date(lastEventAt).getTime();
    if (ms < 0) return null;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h`;
  }, [lastEventAt]);

  const style =
    mode === "live"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      : mode === "polling"
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-muted bg-muted text-muted-foreground";

  const Icon = mode === "live" ? Radio : mode === "polling" ? RefreshCw : WifiOff;
  const label = t(`realtime.${mode}`);

  return (
    <span
      role="status"
      aria-live="polite"
      title={ago ? t("realtime.lastEvent", { ago }) : label}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none",
        style,
        className,
      )}
    >
      <Icon className={cn("size-3", mode === "live" && "animate-pulse")} />
      {label}
      {ago && mode === "live" && (
        <span className="font-mono tabular-nums opacity-70">· {ago}</span>
      )}
    </span>
  );
}

export default RealtimeBadge;
