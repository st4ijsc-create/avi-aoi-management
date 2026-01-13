import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import * as db from "../db";

let io: Server | null = null;

// Store pending machine registrations
interface PendingMachineRegistration {
  socketId: string;
  ipAddress: string;
  machineInfo: {
    code: string;
    name: string;
    type: "AVI" | "AOI";
    serialNumber?: string;
    manufacturer?: string;
    model?: string;
    firmwareVersion?: string;
  };
  timestamp: Date;
  status: "pending" | "approved" | "rejected";
}

const pendingRegistrations: Map<string, PendingMachineRegistration> = new Map();
const connectedMachines: Map<number, { socketId: string; ipAddress: string; lastHeartbeat: Date; machineCode: string }> = new Map();
// Map machineId -> machineCode for quick lookup
const onlineMachineCodesMap: Map<number, string> = new Map();

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
      
      // Remove from connected machines if it was a machine
      const machineEntries = Array.from(connectedMachines.entries());
      for (const [machineId, info] of machineEntries) {
        if (info.socketId === socket.id) {
          const machineCode = info.machineCode;
          connectedMachines.delete(machineId);
          onlineMachineCodesMap.delete(machineId);
          console.log(`[Socket.io] Machine ${machineId} (${machineCode}) disconnected`);
          
          // Log status change to database
          db.createMachineStatusLog({
            machineId,
            status: 'offline',
            ipAddress: info.ipAddress,
          }).catch(err => console.error('[Socket.io] Failed to log machine offline status:', err));
          
          // Notify admin dashboard
          io?.to("admin").emit("machine:disconnected", { machineId, machineCode, timestamp: new Date() });
          // Broadcast status change to all clients
          io?.emit("machine:status_change", { machineCode, status: "offline" });
          break;
        }
      }
      
      // Remove pending registration if exists
      pendingRegistrations.delete(socket.id);
    });

    // ============ MACHINE MAPPING EVENTS ============
    
    // Machine requests registration
    socket.on("machine:register", async (data: {
      code: string;
      name: string;
      type: "AVI" | "AOI";
      serialNumber?: string;
      manufacturer?: string;
      model?: string;
      firmwareVersion?: string;
    }) => {
      const ipAddress = socket.handshake.address;
      console.log(`[Socket.io] Machine registration request from ${ipAddress}: ${data.code}`);
      
      // Store pending registration
      const registration: PendingMachineRegistration = {
        socketId: socket.id,
        ipAddress,
        machineInfo: data,
        timestamp: new Date(),
        status: "pending",
      };
      pendingRegistrations.set(socket.id, registration);
      
      // Notify admin dashboard about new registration request
      io?.to("admin").emit("machine:registration_request", {
        requestSocketId: socket.id,
        ...registration,
      });
      
      // Acknowledge receipt to machine
      socket.emit("machine:register_ack", {
        status: "pending",
        message: "Registration request received. Waiting for admin approval.",
      });
    });

    // Machine sends heartbeat
    socket.on("machine:heartbeat", (data: { machineId: number; status: string; metrics?: any }) => {
      const machineInfo = connectedMachines.get(data.machineId);
      if (machineInfo && machineInfo.socketId === socket.id) {
        machineInfo.lastHeartbeat = new Date();
        connectedMachines.set(data.machineId, machineInfo);
        
        // Broadcast machine status update
        io?.to("global").emit("machine:status_update", {
          machineId: data.machineId,
          status: data.status,
          metrics: data.metrics,
          lastHeartbeat: machineInfo.lastHeartbeat,
        });
      }
    });

    // Machine confirms mapping
    socket.on("machine:confirm_mapping", (data: { machineId: number; machineCode: string; apiKey: string }) => {
      const ipAddress = socket.handshake.address;
      connectedMachines.set(data.machineId, {
        socketId: socket.id,
        ipAddress,
        lastHeartbeat: new Date(),
        machineCode: data.machineCode,
      });
      onlineMachineCodesMap.set(data.machineId, data.machineCode);
      
      socket.join(`machine:${data.machineId}`);
      console.log(`[Socket.io] Machine ${data.machineId} (${data.machineCode}) mapped successfully from ${ipAddress}`);
      
      // Log status change to database
      db.createMachineStatusLog({
        machineId: data.machineId,
        status: 'online',
        ipAddress,
      }).catch(err => console.error('[Socket.io] Failed to log machine online status:', err));
      
      // Notify admin dashboard
      io?.to("admin").emit("machine:connected", {
        machineId: data.machineId,
        machineCode: data.machineCode,
        ipAddress,
        timestamp: new Date(),
      });
      
      // Broadcast status change to all clients
      io?.emit("machine:status_change", { machineCode: data.machineCode, status: "online" });
    });

    // Admin joins admin room for machine management
    socket.on("admin:join", () => {
      socket.join("admin");
      console.log(`[Socket.io] Admin ${socket.id} joined admin room`);
      
      // Send current pending registrations
      const pending = Array.from(pendingRegistrations.entries()).map(([id, reg]) => ({
        requestSocketId: id,
        ipAddress: reg.ipAddress,
        machineInfo: reg.machineInfo,
        timestamp: reg.timestamp,
        status: reg.status,
      }));
      socket.emit("admin:pending_registrations", pending);
      
      // Send connected machines status
      const connected = Array.from(connectedMachines.entries()).map(([machineId, info]) => ({
        machineId,
        ...info,
      }));
      socket.emit("admin:connected_machines", connected);
    });

    // Dashboard requests online machines list
    socket.on("admin:get_online_machines", () => {
      // Get machine codes from connectedMachines
      const onlineMachineCodes = Array.from(onlineMachineCodesMap.values());
      socket.emit("machine:online_list", { machines: onlineMachineCodes });
      console.log(`[Socket.io] Sent online machines list to ${socket.id}: ${onlineMachineCodes.length} machines`);
    });

    // Admin approves registration
    socket.on("admin:approve_registration", (data: { socketId: string; machineId: number; apiKey: string }) => {
      const registration = pendingRegistrations.get(data.socketId);
      if (registration) {
        registration.status = "approved";
        
        // Notify the machine
        io?.to(data.socketId).emit("machine:registration_approved", {
          machineId: data.machineId,
          apiKey: data.apiKey,
          message: "Registration approved. You can now send inspection data.",
        });
        
        // Remove from pending
        pendingRegistrations.delete(data.socketId);
        
        console.log(`[Socket.io] Registration approved for ${registration.machineInfo.code} -> Machine ID ${data.machineId}`);
      }
    });

    // Admin rejects registration
    socket.on("admin:reject_registration", (data: { socketId: string; reason: string }) => {
      const registration = pendingRegistrations.get(data.socketId);
      if (registration) {
        registration.status = "rejected";
        
        // Notify the machine
        io?.to(data.socketId).emit("machine:registration_rejected", {
          reason: data.reason,
          message: "Registration rejected by admin.",
        });
        
        // Remove from pending
        pendingRegistrations.delete(data.socketId);
        
        console.log(`[Socket.io] Registration rejected for ${registration.machineInfo.code}: ${data.reason}`);
      }
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
