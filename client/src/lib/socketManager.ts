import { io, Socket } from "socket.io-client";

let sharedSocket: Socket | null = null;
let refCount = 0;

export function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(window.location.origin, {
      path: "/api/socket.io",
      transports: ["polling", "websocket"],
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: Infinity,
    });
  }
  refCount++;
  return sharedSocket;
}

export function releaseSharedSocket(): void {
  refCount = Math.max(0, refCount - 1);
  // Keep socket alive — it will be cleaned up when the tab/window closes.
  // Disconnecting on refCount=0 causes reconnect loops during page navigation
  // because DashboardLayout (with NotificationCenter) unmounts and remounts.
}
