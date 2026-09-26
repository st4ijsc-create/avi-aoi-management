import { io, Socket } from "socket.io-client";

let sharedSocket: Socket | null = null;
let refCount = 0;

export function getSharedSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io(window.location.origin, {
      path: "/api/socket.io",
      // doc 67 W6 (việc 1) — WEBSOCKET-FIRST: polling-first cost 4-6 HTTP
      // round-trips on EVERY page load before the upgrade handshake (over half
      // of the apiCount in the page captures). websocket-first connects in one
      // round-trip; socket.io still falls back to polling automatically when
      // the WS handshake fails (old proxies / corp firewalls that block
      // Upgrade: websocket).
      // ROLLBACK: if a kiosk environment sits behind a proxy that silently
      // drops WS (symptom: every page load waits out the WS connect timeout
      // before recovering on polling), restore the previous order:
      //   transports: ["polling", "websocket"]
      transports: ["websocket", "polling"],
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
