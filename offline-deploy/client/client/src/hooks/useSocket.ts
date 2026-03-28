import { useEffect, useState, useCallback, useRef } from "react";
import { Socket } from "socket.io-client";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";

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
    const socket = getSharedSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setIsConnected(true);
      socket.emit("subscribe", { factoryId, workshopId, machineId });
    };

    const onDisconnect = () => {
      setIsConnected(false);
    };

    const onAlert = (alert: InspectionAlert) => {
      setAlerts((prev) => [alert, ...prev].slice(0, 50));
      onAlertRef.current?.(alert);
    };

    const onUpdate = (update: DashboardUpdate) => {
      onDashboardUpdateRef.current?.(update);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("inspection:alert", onAlert);
    socket.on("dashboard:update", onUpdate);

    // If already connected, subscribe immediately
    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.emit("unsubscribe", { factoryId, workshopId, machineId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("inspection:alert", onAlert);
      socket.off("dashboard:update", onUpdate);
      releaseSharedSocket();
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
