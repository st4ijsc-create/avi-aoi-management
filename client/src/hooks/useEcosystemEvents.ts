import { useEffect, useRef, useState, useCallback } from "react";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";

/**
 * U1-c — the client-side mirror of the server `EcosystemEvent` envelope. Every
 * alert/event class the server knows is normalized to this ONE shape and pushed on
 * `ecosystem:event` (all classes) / `alerts:stream` (alert classes only).
 */
export type EcosystemSeverity = "info" | "low" | "medium" | "high" | "critical";
export type EcosystemKind =
  | "inspection" | "andon" | "safety" | "spc" | "quality_gate" | "escalation"
  | "maintenance" | "downtime" | "oee" | "task" | "workorder" | "anomaly"
  | "program" | "twin" | "ng" | "yield" | "event";

export interface EcosystemScope {
  siteCode?: string | null;
  factoryId?: number | null;
  machineId?: number | null;
  robotId?: number | null;
  lineId?: number | null;
}

export interface EcosystemEvent {
  id: string;
  ts: number;
  kind: EcosystemKind;
  severity: EcosystemSeverity;
  source: string;
  scope: EcosystemScope;
  title: string;
  detail?: Record<string, unknown>;
}

interface UseEcosystemEventsOptions {
  /** Join these scoped rooms so scoped events (not just global) arrive. */
  factoryId?: number;
  workshopId?: number;
  machineId?: number;
  lineId?: number;
  /** When true, only subscribe to the filtered `alerts:stream` (alert-class events). */
  alertsOnly?: boolean;
  /** Fired for every event (after being added to the buffer). */
  onEvent?: (evt: EcosystemEvent) => void;
  /** Ring-buffer size (default 100). */
  bufferSize?: number;
  enabled?: boolean;
}

/**
 * Subscribe to the unified U1 event stream over the SHARED socket. Backward-compatible
 * with the existing per-event socket usage — this is an ADDITIVE consumer that gives
 * the whole app one place to read ALL alert classes (not just inspection:alert).
 */
export function useEcosystemEvents(options: UseEcosystemEventsOptions = {}) {
  const { factoryId, workshopId, machineId, lineId, alertsOnly = false, onEvent, bufferSize = 100, enabled = true } = options;
  const [events, setEvents] = useState<EcosystemEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSharedSocket();
    const channel = alertsOnly ? "alerts:stream" : "ecosystem:event";

    const onConnect = () => {
      setIsConnected(true);
      socket.emit("subscribe", { factoryId, workshopId, machineId, lineId });
    };
    const onDisconnect = () => setIsConnected(false);
    const onEvt = (evt: EcosystemEvent) => {
      setEvents((prev) => [evt, ...prev].slice(0, bufferSize));
      onEventRef.current?.(evt);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(channel, onEvt);
    if (socket.connected) onConnect();

    return () => {
      socket.emit("unsubscribe", { factoryId, workshopId, machineId, lineId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(channel, onEvt);
      releaseSharedSocket();
    };
  }, [enabled, alertsOnly, factoryId, workshopId, machineId, lineId, bufferSize]);

  const clear = useCallback(() => setEvents([]), []);
  const dismiss = useCallback((index: number) => setEvents((prev) => prev.filter((_, i) => i !== index)), []);

  return { events, isConnected, clear, dismiss };
}
