import { useEffect, useRef, useState, useCallback } from "react";
import { Socket } from "socket.io-client";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import type { EcosystemEvent } from "@/hooks/useEcosystemEvents";

interface UseAutoRefreshOptions {
  /** Refresh interval in seconds. 0 = disabled */
  intervalSeconds: number;
  /** Callback to execute on each refresh */
  onRefresh: () => void;
  /** Whether to start immediately */
  enabled?: boolean;
}

/**
 * Hook for auto-refreshing dashboard data at a configurable interval.
 * Returns controls to start/stop/change interval.
 */
export function useAutoRefresh({ intervalSeconds, onRefresh, enabled = true }: UseAutoRefreshOptions) {
  const [isActive, setIsActive] = useState(enabled);
  const [currentInterval, setCurrentInterval] = useState(intervalSeconds);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [countdown, setCountdown] = useState(intervalSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doRefresh = useCallback(() => {
    onRefresh();
    setLastRefresh(new Date());
    setCountdown(currentInterval);
  }, [onRefresh, currentInterval]);

  useEffect(() => {
    if (!isActive || currentInterval <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
      return;
    }

    timerRef.current = setInterval(doRefresh, currentInterval * 1000);
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isActive, currentInterval, doRefresh]);

  return {
    isActive,
    start: () => setIsActive(true),
    stop: () => setIsActive(false),
    toggle: () => setIsActive((prev) => !prev),
    setInterval: (seconds: number) => {
      setCurrentInterval(seconds);
      setCountdown(seconds);
    },
    currentInterval,
    lastRefresh,
    countdown,
    refreshNow: doRefresh,
  };
}

interface UseRealtimeAlertsOptions {
  /** Callback when urgent alert is received */
  onUrgentAlert?: (alert: UrgentAlert) => void;
  /** Callback when dashboard update is pushed */
  onDashboardUpdate?: (data: any) => void;
  /** Callback when yield warning is pushed */
  onYieldWarning?: (data: any) => void;
  /** Callback when NG alert is received */
  onNGAlert?: (data: any) => void;
  /** Whether to connect */
  enabled?: boolean;
}

export interface UrgentAlert {
  type: "inspection" | "yield" | "ng" | "quality_gate" | "machine_status";
  severity: "warning" | "critical";
  title: string;
  message: string;
  data: any;
  timestamp: Date;
}

/**
 * Hook for real-time WebSocket alerts.
 *
 * U1-d FIX: this previously opened a SECOND socket and listened for `yield:warning`
 * / `ng:alert` / `qualityGate:triggered` — event names the server NEVER emits (dead
 * hook). It now reuses the SHARED socket (socketManager) and consumes the unified
 * U1 `alerts:stream` (every alert class, normalized), plus the still-live
 * `inspection:alert` + `dashboard:update` channels. No duplicate connection.
 */
export function useRealtimeAlerts({
  onUrgentAlert,
  onDashboardUpdate,
  onYieldWarning,
  onNGAlert,
  enabled = true,
}: UseRealtimeAlertsOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [alerts, setAlerts] = useState<UrgentAlert[]>([]);
  const socketRef = useRef<Socket | null>(null);

  // Keep latest callbacks in refs so the socket effect doesn't re-subscribe on each render.
  const cbRef = useRef({ onUrgentAlert, onDashboardUpdate, onYieldWarning, onNGAlert });
  useEffect(() => {
    cbRef.current = { onUrgentAlert, onDashboardUpdate, onYieldWarning, onNGAlert };
  }, [onUrgentAlert, onDashboardUpdate, onYieldWarning, onNGAlert]);

  useEffect(() => {
    if (!enabled) return;

    const socket = getSharedSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      socket.emit("subscribe", {}); // join the global room (source of the unified stream)
    };
    const onDisconnect = () => setIsConnected(false);

    // Legacy inspection alert (still emitted per-inspection) → map to inspection.
    const onInspection = (data: any) => {
      const alert: UrgentAlert = {
        type: "inspection",
        severity: data.severity || "warning",
        title: data.title || data.message || "Cảnh báo kiểm tra",
        message: data.message || JSON.stringify(data),
        data,
        timestamp: new Date(),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
      cbRef.current.onUrgentAlert?.(alert);
    };

    const onDashUpdate = (data: any) => cbRef.current.onDashboardUpdate?.(data);

    // U1 unified alert stream — one channel, every alert class (normalized envelope).
    const onAlertsStream = (evt: EcosystemEvent) => {
      const severity: UrgentAlert["severity"] =
        evt.severity === "critical" || evt.severity === "high" ? "critical" : "warning";
      const type: UrgentAlert["type"] =
        evt.kind === "ng" ? "ng"
        : evt.kind === "yield" ? "yield"
        : evt.kind === "quality_gate" ? "quality_gate"
        : "inspection";
      const alert: UrgentAlert = {
        type,
        severity,
        title: evt.title,
        message: evt.title,
        data: evt,
        timestamp: new Date(evt.ts),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
      cbRef.current.onUrgentAlert?.(alert);
      if (evt.kind === "yield") cbRef.current.onYieldWarning?.(evt.detail ?? evt);
      if (evt.kind === "ng") cbRef.current.onNGAlert?.(evt.detail ?? evt);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("inspection:alert", onInspection);
    socket.on("dashboard:update", onDashUpdate);
    socket.on("alerts:stream", onAlertsStream);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("inspection:alert", onInspection);
      socket.off("dashboard:update", onDashUpdate);
      socket.off("alerts:stream", onAlertsStream);
      releaseSharedSocket();
    };
  }, [enabled]);

  return {
    isConnected,
    alerts,
    clearAlerts: () => setAlerts([]),
    dismissAlert: (index: number) => setAlerts((prev) => prev.filter((_, i) => i !== index)),
  };
}
