import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";

let io: Server | null = null;

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

export function initializeSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
    path: "/api/socket.io",
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[Socket.io] Client connected: ${socket.id}`);

    // Join room for specific factory/workshop/machine updates
    socket.on("subscribe", (data: { factoryId?: number; workshopId?: number; machineId?: number }) => {
      if (data.factoryId) {
        socket.join(`factory:${data.factoryId}`);
        console.log(`[Socket.io] ${socket.id} joined factory:${data.factoryId}`);
      }
      if (data.workshopId) {
        socket.join(`workshop:${data.workshopId}`);
        console.log(`[Socket.io] ${socket.id} joined workshop:${data.workshopId}`);
      }
      if (data.machineId) {
        socket.join(`machine:${data.machineId}`);
        console.log(`[Socket.io] ${socket.id} joined machine:${data.machineId}`);
      }
      // Everyone joins the global room for all alerts
      socket.join("global");
    });

    socket.on("unsubscribe", (data: { factoryId?: number; workshopId?: number; machineId?: number }) => {
      if (data.factoryId) socket.leave(`factory:${data.factoryId}`);
      if (data.workshopId) socket.leave(`workshop:${data.workshopId}`);
      if (data.machineId) socket.leave(`machine:${data.machineId}`);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  console.log("[Socket.io] WebSocket server initialized");
  return io;
}

export function getIO(): Server | null {
  return io;
}

// Emit inspection alert to all connected clients
export function emitInspectionAlert(alert: InspectionAlert): void {
  if (!io) {
    console.warn("[Socket.io] Cannot emit alert: Socket.io not initialized");
    return;
  }

  // Emit to global room
  io.to("global").emit("inspection:alert", alert);

  // Also emit to specific machine room
  io.to(`machine:${alert.machineId}`).emit("inspection:alert", alert);

  console.log(`[Socket.io] Emitted ${alert.type} alert for machine ${alert.machineCode}`);
}

// Emit dashboard stats update
export function emitDashboardUpdate(update: DashboardUpdate): void {
  if (!io) {
    console.warn("[Socket.io] Cannot emit update: Socket.io not initialized");
    return;
  }

  io.to("global").emit("dashboard:update", update);

  if (update.machineId) {
    io.to(`machine:${update.machineId}`).emit("dashboard:update", update);
  }
}

// Emit yield rate warning when below threshold
export function emitYieldWarning(
  machineId: number,
  machineName: string,
  machineCode: string,
  currentYield: number,
  threshold: number = 90
): void {
  if (currentYield < threshold) {
    emitInspectionAlert({
      type: "YIELD_WARNING",
      machineId,
      machineName,
      machineCode,
      yieldRate: currentYield,
      threshold,
      timestamp: new Date(),
      message: `Cảnh báo: Yield Rate của máy ${machineName} (${machineCode}) đã giảm xuống ${currentYield.toFixed(2)}%, dưới ngưỡng ${threshold}%`,
    });
  }
}

// Emit NG alert when product fails inspection
export function emitNGAlert(
  machineId: number,
  machineName: string,
  machineCode: string,
  serialNumber: string,
  factoryName?: string,
  workshopName?: string
): void {
  emitInspectionAlert({
    type: "NG_ALERT",
    machineId,
    machineName,
    machineCode,
    serialNumber,
    result: "NG",
    factoryName,
    workshopName,
    timestamp: new Date(),
    message: `Sản phẩm NG: ${serialNumber} tại máy ${machineName} (${machineCode})`,
  });
}
