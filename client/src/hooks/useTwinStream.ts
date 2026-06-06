// Sprint G2.7 — useTwinStream
//
// Subscribes to the `twin:update` WebSocket event for live WIP/load snapshots.
// When the stream is unavailable (server flag TWIN_STREAM_ENABLED off, or no
// events arriving), it transparently falls back to polling the read-only
// digitalTwin.wipFlowState tRPC query — backward-compatible behavior.
import { useEffect, useRef, useState } from "react";
import { Socket } from "socket.io-client";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import { trpc } from "@/lib/trpc";

export interface TwinStationSnapshot {
  stationId: number;
  wipCount: number;
  loadPct?: number;
  color?: string;
  dominantState?: "starved" | "blocked" | "processing" | "idle";
}

interface TwinUpdateEvent {
  lineId?: number | null;
  layoutId?: number | null;
  stations: TwinStationSnapshot[];
  ts: number;
}

interface UseTwinStreamOptions {
  lineId?: number;
  layoutId?: number;
  /** Poll interval (ms) for the fallback query. Default 5000. */
  pollIntervalMs?: number;
  enabled?: boolean;
}

export function useTwinStream(options: UseTwinStreamOptions = {}) {
  const { lineId, layoutId, pollIntervalMs = 5000, enabled = true } = options;

  const [streamStations, setStreamStations] = useState<TwinStationSnapshot[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fallback poll — always mounted; only refetches when NOT streaming.
  const poll = trpc.digitalTwin.wipFlowState.useQuery(
    { lineId, layoutId },
    {
      enabled: enabled && !isStreaming,
      refetchInterval: enabled && !isStreaming ? pollIntervalMs : false,
    },
  );

  useEffect(() => {
    if (!enabled) return;
    const socket = getSharedSocket();
    socketRef.current = socket;

    const onConnect = () => {
      socket.emit("subscribe", lineId ? { lineId } : {});
    };

    const onTwinUpdate = (event: TwinUpdateEvent) => {
      // Filter to the line we care about when one is set (global emits have no lineId).
      if (lineId != null && event.lineId != null && event.lineId !== lineId) return;
      setStreamStations(event.stations ?? []);
      setIsStreaming(true);
      setLastUpdate(event.ts ?? Date.now());
    };

    socket.on("connect", onConnect);
    socket.on("twin:update", onTwinUpdate);
    if (socket.connected) onConnect();

    return () => {
      socket.emit("unsubscribe", lineId ? { lineId } : {});
      socket.off("connect", onConnect);
      socket.off("twin:update", onTwinUpdate);
      releaseSharedSocket();
    };
  }, [enabled, lineId]);

  // If no stream event has arrived, surface the polled snapshot.
  const pollStations: TwinStationSnapshot[] = (poll.data?.stations ?? []).map((s: any) => ({
    stationId: s.stationId,
    wipCount: s.wipCount,
  }));

  const stations = isStreaming ? streamStations : pollStations;

  return {
    stations,
    isStreaming,
    lastUpdate,
    poll, // expose for loading/error state if needed
  };
}
