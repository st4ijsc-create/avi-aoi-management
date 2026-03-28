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
      reconnectionAttempts: 10,
    });
  }
  refCount++;
  return sharedSocket;
}

export function releaseSharedSocket(): void {
  refCount--;
  if (refCount <= 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    refCount = 0;
  }
}
