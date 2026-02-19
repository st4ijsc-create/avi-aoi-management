import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

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
  /** Socket.io path (defaults to /api/socket.io) */
  socketPath?: string;
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
 * Hook for real-time WebSocket alerts (Socket.io).
 * Connects to the server and listens for push events.
 */
export function useRealtimeAlerts({
  socketPath = "/api/socket.io",
  onUrgentAlert,
  onDashboardUpdate,
  onYieldWarning,
  onNGAlert,
  enabled = true,
}: UseRealtimeAlertsOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [alerts, setAlerts] = useState<UrgentAlert[]>([]);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const socket = io({
      path: socketPath,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setIsConnected(true);
      // Subscribe to dashboard room
      socket.emit("subscribe:dashboard");
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    // Listen for inspection alerts (urgent)
    socket.on("inspection:alert", (data) => {
      const alert: UrgentAlert = {
        type: "inspection",
        severity: data.severity || "warning",
        title: data.title || "Cảnh báo kiểm tra",
        message: data.message || JSON.stringify(data),
        data,
        timestamp: new Date(),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
      onUrgentAlert?.(alert);
    });

    // Listen for dashboard updates
    socket.on("dashboard:update", (data) => {
      onDashboardUpdate?.(data);
    });

    // Listen for yield warnings
    socket.on("yield:warning", (data) => {
      const alert: UrgentAlert = {
        type: "yield",
        severity: "warning",
        title: "Cảnh báo Yield thấp",
        message: `Yield: ${data.yieldRate?.toFixed(1)}% - ${data.machineName || ""}`,
        data,
        timestamp: new Date(),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
      onYieldWarning?.(data);
      onUrgentAlert?.(alert);
    });

    // Listen for NG alerts  
    socket.on("ng:alert", (data) => {
      const alert: UrgentAlert = {
        type: "ng",
        severity: "critical",
        title: "Cảnh báo NG",
        message: `NG count: ${data.ngCount} - ${data.machineName || ""}`,
        data,
        timestamp: new Date(),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
      onNGAlert?.(data);
      onUrgentAlert?.(alert);
    });

    // Listen for quality gate events
    socket.on("qualityGate:triggered", (data) => {
      const alert: UrgentAlert = {
        type: "quality_gate",
        severity: data.action === "stop" ? "critical" : "warning",
        title: "Quality Gate triggered",
        message: data.message || `${data.gateType} ${data.comparison} ${data.threshold}`,
        data,
        timestamp: new Date(),
      };
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
      onUrgentAlert?.(alert);
    });

    return () => {
      socket.disconnect();
    };
  }, [enabled, socketPath]);

  return {
    isConnected,
    alerts,
    clearAlerts: () => setAlerts([]),
    dismissAlert: (index: number) => setAlerts((prev) => prev.filter((_, i) => i !== index)),
  };
}
