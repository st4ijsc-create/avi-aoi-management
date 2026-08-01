// Doc 09 / D6 (doc 25 T4) — useEngineeringStream
//
// Subscribes to the `engineering:{machineId}` Socket.IO room for high-rate symbol-watch
// samples (Online Monitor / watch table). The server producer (EngineeringStreamManager) is
// gated by DPC_STREAMING_ENABLED and its default source returns [] without a reachable device
// — so this hook is HONEST: it shows only samples the server actually emits, never fabricated.
//
// Read-only transport: joining the room never writes a device. When `enabled` is false or no
// machine is bound the hook stays idle (empty map).
import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";

export interface EngineeringSample {
  symbol: string;
  value: number | string | boolean | null;
  ts: number;
}

interface EngineeringSamplesEvent {
  machineId: number;
  samples: EngineeringSample[];
}

export function useEngineeringStream(machineId: number | null | undefined, enabled: boolean) {
  // Map tag → sample mới nhất (giữ giá trị gần nhất cho từng symbol).
  const [values, setValues] = useState<Map<string, EngineeringSample>>(new Map());
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled || machineId == null) {
      setConnected(false);
      return;
    }
    // Reset bảng giá trị khi đổi máy / bật lại watch.
    setValues(new Map());
    setLastUpdate(null);

    const socket = getSharedSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit("engineering:subscribe", { machineId });
    };
    const onDisconnect = () => setConnected(false);
    const onSamples = (event: EngineeringSamplesEvent) => {
      if (event?.machineId !== machineId || !Array.isArray(event.samples)) return;
      setValues((prev) => {
        const next = new Map(prev);
        for (const s of event.samples) next.set(s.symbol, s);
        return next;
      });
      setLastUpdate(Date.now());
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("engineering:samples", onSamples);
    if (socket.connected) onConnect();

    return () => {
      socket.emit("engineering:unsubscribe", { machineId });
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("engineering:samples", onSamples);
      releaseSharedSocket();
    };
  }, [enabled, machineId]);

  return { values, lastUpdate, connected };
}
