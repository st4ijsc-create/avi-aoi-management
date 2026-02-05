import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";

export interface InspectionAlert {
  type: "NG_ALERT" | "YIELD_WARNING" | "NEW_INSPECTION";
  machineId: number;
  machineName: string;
  machineCode: string;
  factoryName?: string;
  workshopName?: string;
  serialNumber?: string;
  result?: "OK" | "NG" | "NTF";
  yieldRate?: number;
  threshold?: number;
  timestamp: Date;
  message: string;
}

export interface DashboardUpdate {
  type: "STATS_UPDATE";
  machineId?: number;
  stats: {
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    yieldRate: number;
  };
  timestamp: Date;
}

interface UseSocketOptions {
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  onAlert?: (alert: InspectionAlert) => void;
  onDashboardUpdate?: (update: DashboardUpdate) => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [alerts, setAlerts] = useState<InspectionAlert[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const { factoryId, workshopId, machineId, onAlert, onDashboardUpdate } = options;

  // Store callbacks in refs to avoid effect re-runs
  const onAlertRef = useRef(onAlert);
  const onDashboardUpdateRef = useRef(onDashboardUpdate);
  
  useEffect(() => {
    onAlertRef.current = onAlert;
    onDashboardUpdateRef.current = onDashboardUpdate;
  }, [onAlert, onDashboardUpdate]);

  useEffect(() => {
    // Connect to Socket.io server
    const socket = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Socket.io] Connected to server");
      setIsConnected(true);

      // Subscribe to rooms
      socket.emit("subscribe", { factoryId, workshopId, machineId });
    });

    socket.on("disconnect", () => {
      console.log("[Socket.io] Disconnected from server");
      setIsConnected(false);
    });

    socket.on("inspection:alert", (alert: InspectionAlert) => {
      console.log("[Socket.io] Received alert:", alert);
      setAlerts((prev) => [alert, ...prev].slice(0, 50)); // Keep last 50 alerts
      onAlertRef.current?.(alert);
    });

    socket.on("dashboard:update", (update: DashboardUpdate) => {
      console.log("[Socket.io] Received dashboard update:", update);
      onDashboardUpdateRef.current?.(update);
    });

    return () => {
      socket.emit("unsubscribe", { factoryId, workshopId, machineId });
      socket.disconnect();
    };
  }, [factoryId, workshopId, machineId]);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  const dismissAlert = useCallback((index: number) => {
    setAlerts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    isConnected,
    alerts,
    clearAlerts,
    dismissAlert,
  };
}
