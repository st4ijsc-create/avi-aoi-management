import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import * as db from "../db";
import { sdk } from "./sdk";
import { attachRedisAdapter } from "./socketRedisAdapter";

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
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/api/socket.io",
  });

  // Optional Redis adapter — unlocks horizontal scaling when REDIS_URL is set.
  // No-op (in-memory) when REDIS_URL is absent or the adapter package is missing.
  void attachRedisAdapter(io);

  // Handshake auth middleware — IEC 62443-2-1 CL2 realtime channel hardening.
  // Browser clients must present a valid session cookie; machine clients
  // (clientType === 'machine') bypass cookie check because they authenticate
  // per-event via apiKey (see machine:request_config / machine:sync_started).
  io.use(async (socket, next) => {
    try {
      const clientType = (socket.handshake.auth as any)?.clientType;
      if (clientType === "machine") {
        (socket.data as any).clientType = "machine";
        return next();
      }

      const cookieHeader = socket.handshake.headers.cookie ?? "";
      const reqLike = {
        headers: { cookie: cookieHeader, ...socket.handshake.headers },
        cookies: {},
      } as any;

      const user = await sdk.authenticateRequest(reqLike);
      if (!user) {
        return next(new Error("UNAUTHORIZED"));
      }
      (socket.data as any).user = user;
      (socket.data as any).clientType = "browser";
      return next();
    } catch (err) {
      console.error("[Socket.io] Handshake auth failed:", err);
      return next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket: Socket) => {
    const u = (socket.data as any)?.user;
    const ct = (socket.data as any)?.clientType ?? "unknown";
    console.log(`[Socket.io] Client connected: ${socket.id} type=${ct}${u ? ` user=${u.id}` : ""}`);

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
    socket.on("admin:approve_registration", async (data: { socketId: string; machineId: number; apiKey?: string }) => {
      const registration = pendingRegistrations.get(data.socketId);
      if (!registration) {
        socket.emit("admin:approve_error", { message: "Registration not found or expired" });
        return;
      }

      try {
        // Step 2: Get or generate API Key
        let apiKey = data.apiKey || "";
        const existingMachine = await db.getMachineById(data.machineId);
        if (!existingMachine) {
          socket.emit("admin:approve_error", { message: `Machine ID ${data.machineId} not found in database` });
          return;
        }

        // Generate new API Key if machine doesn't have one
        if (!apiKey || apiKey.trim() === "") {
          apiKey = existingMachine.apiKey || `mach_${nanoid(32)}`;
        }

        // Update machine in DB: set registrationStatus, serialNumber, firmwareVersion, apiKey
        await db.updateMachine(data.machineId, {
          registrationStatus: "approved",
          serialNumber: registration.machineInfo.serialNumber || existingMachine.serialNumber,
          firmwareVersion: registration.machineInfo.firmwareVersion || existingMachine.firmwareVersion,
          apiKey,
          lastSyncAt: new Date(),
        });

        registration.status = "approved";

        // Step 3: Fetch machine config to send along with approval
        const machineConfig: Record<string, any> = {
          machineId: data.machineId,
          machineCode: existingMachine.code,
          machineName: existingMachine.name,
          machineType: existingMachine.machineType,
          stationId: existingMachine.stationId,
        };

        // Try to get station/line info for config
        if (existingMachine.stationId) {
          try {
            const lineInfo = await db.getLineByStationId(existingMachine.stationId);
            if (lineInfo) {
              machineConfig.lineId = lineInfo.id;
              machineConfig.lineName = lineInfo.name;
            }
          } catch (err) {
            console.error("[Socket.io] Failed to get line info:", err);
          }
        }

        // Notify the machine with API Key + config
        io?.to(data.socketId).emit("machine:registration_approved", {
          machineId: data.machineId,
          apiKey,
          config: machineConfig,
          message: "Registration approved. You can now send inspection data.",
        });

        // Remove from pending
        pendingRegistrations.delete(data.socketId);

        // Log status change (use 'online' since machine is now approved and connecting)
        db.createMachineStatusLog({
          machineId: data.machineId,
          status: "online",
          ipAddress: registration.ipAddress,
        }).catch(err => console.error("[Socket.io] Failed to log approval status:", err));

        // Notify admin about successful approval (with generated apiKey for display)
        socket.emit("admin:approve_success", {
          machineId: data.machineId,
          machineCode: existingMachine.code,
          machineName: existingMachine.name,
          apiKey,
          registrationCode: registration.machineInfo.code,
        });

        console.log(`[Socket.io] Registration approved for ${registration.machineInfo.code} -> Machine ID ${data.machineId} (API Key: ${apiKey.substring(0, 10)}...)`);
      } catch (error: any) {
        console.error("[Socket.io] Error approving registration:", error);
        socket.emit("admin:approve_error", { message: `Failed to approve: ${error.message}` });
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

    // ============ STEP 4: Machine requests config after approval ============
    socket.on("machine:request_config", async (data: { machineId: number; apiKey: string }) => {
      try {
        // Verify machine and API Key
        const machine = await db.getMachineById(data.machineId);
        if (!machine || machine.apiKey !== data.apiKey) {
          socket.emit("machine:config_error", {
            message: "Invalid machine ID or API Key",
          });
          return;
        }

        // Build config object
        const config: Record<string, any> = {
          machineId: machine.id,
          machineCode: machine.code,
          machineName: machine.name,
          machineType: machine.machineType,
          stationId: machine.stationId,
          syncMode: machine.syncMode || "realtime",
          registrationStatus: machine.registrationStatus,
        };

        // Get station/line info
        if (machine.stationId) {
          try {
            const lineInfo = await db.getLineByStationId(machine.stationId);
            if (lineInfo) {
              config.lineId = lineInfo.id;
              config.lineName = lineInfo.name;
            }
          } catch (err) {
            console.error("[Socket.io] Failed to get line info for config:", err);
          }
        }

        // Send config to machine
        socket.emit("machine:config_update", {
          config,
          timestamp: new Date(),
          message: "Configuration loaded successfully.",
        });

        console.log(`[Socket.io] Config sent to machine ${data.machineId} (${machine.code})`);
      } catch (error: any) {
        console.error("[Socket.io] Error fetching machine config:", error);
        socket.emit("machine:config_error", {
          message: `Failed to load config: ${error.message}`,
        });
      }
    });

    // ============ STEP 5: Machine confirms sync started ============
    socket.on("machine:sync_started", async (data: { machineId: number; machineCode: string; apiKey: string }) => {
      try {
        // Verify machine
        const machine = await db.getMachineById(data.machineId);
        if (!machine || machine.apiKey !== data.apiKey) {
          socket.emit("machine:sync_error", { message: "Invalid machine ID or API Key" });
          return;
        }

        const ipAddress = socket.handshake.address;

        // Store in connected machines
        connectedMachines.set(data.machineId, {
          socketId: socket.id,
          ipAddress,
          lastHeartbeat: new Date(),
          machineCode: data.machineCode,
        });
        onlineMachineCodesMap.set(data.machineId, data.machineCode);

        // Join machine-specific room
        socket.join(`machine:${data.machineId}`);

        // Update lastSyncAt in DB
        await db.updateMachine(data.machineId, {
          lastSyncAt: new Date(),
          syncMode: "online",
        });

        // Log status
        db.createMachineStatusLog({
          machineId: data.machineId,
          status: "online",
          ipAddress,
        }).catch(err => console.error("[Socket.io] Failed to log sync status:", err));

        // Confirm to machine
        socket.emit("machine:sync_confirmed", {
          message: "Sync started successfully. You can now send inspection data.",
          timestamp: new Date(),
        });

        // Notify admin & global
        io?.to("admin").emit("machine:sync_status", {
          machineId: data.machineId,
          machineCode: data.machineCode,
          status: "syncing",
          ipAddress,
          timestamp: new Date(),
        });
        io?.emit("machine:status_change", { machineCode: data.machineCode, status: "syncing" });

        console.log(`[Socket.io] Machine ${data.machineId} (${data.machineCode}) started real-time sync`);
      } catch (error: any) {
        console.error("[Socket.io] Error starting sync:", error);
        socket.emit("machine:sync_error", { message: `Failed to start sync: ${error.message}` });
      }
    });
  });

  // Initialize notification service with Socket.io
  import('../services/notificationService').then(({ initNotificationService }) => {
    initNotificationService(io!);
  });
  
  console.log("[Socket.io] WebSocket server initialized");
  return io;
}

export function getIO(): Server | null {
  return io;
}

// Test manual connection to a machine via IP:Port
export async function testManualConnection(
  ipAddress: string,
  port: number,
  protocol: 'websocket' | 'tcp' | 'http',
  timeoutMs: number = 5000
): Promise<{ success: boolean; message: string; latencyMs?: number }> {
  const startTime = Date.now();
  
  try {
    if (protocol === 'http') {
      // Test HTTP connection
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        const response = await fetch(`http://${ipAddress}:${port}/health`, {
          method: 'GET',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        
        const latencyMs = Date.now() - startTime;
        if (response.ok) {
          return { success: true, message: 'Kết nối HTTP thành công', latencyMs };
        } else {
          return { success: false, message: `HTTP response: ${response.status} ${response.statusText}` };
        }
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          return { success: false, message: 'Kết nối HTTP timeout' };
        }
        throw fetchError;
      }
    } else if (protocol === 'tcp') {
      // Test TCP connection using net module
      const net = await import('net');
      
      return new Promise((resolve) => {
        const socket = new net.Socket();
        let resolved = false;
        
        socket.setTimeout(timeoutMs);
        
        socket.on('connect', () => {
          if (!resolved) {
            resolved = true;
            const latencyMs = Date.now() - startTime;
            socket.destroy();
            resolve({ success: true, message: 'Kết nối TCP thành công', latencyMs });
          }
        });
        
        socket.on('timeout', () => {
          if (!resolved) {
            resolved = true;
            socket.destroy();
            resolve({ success: false, message: 'Kết nối TCP timeout' });
          }
        });
        
        socket.on('error', (err: Error) => {
          if (!resolved) {
            resolved = true;
            socket.destroy();
            resolve({ success: false, message: `Lỗi TCP: ${err.message}` });
          }
        });
        
        socket.connect(port, ipAddress);
      });
    } else {
      // Test WebSocket connection
      const WebSocket = (await import('ws')).default;
      
      return new Promise((resolve) => {
        const wsUrl = `ws://${ipAddress}:${port}`;
        let resolved = false;
        
        const ws = new WebSocket(wsUrl, {
          handshakeTimeout: timeoutMs,
        });
        
        const timeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            ws.terminate();
            resolve({ success: false, message: 'Kết nối WebSocket timeout' });
          }
        }, timeoutMs);
        
        ws.on('open', () => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            const latencyMs = Date.now() - startTime;
            ws.close();
            resolve({ success: true, message: 'Kết nối WebSocket thành công', latencyMs });
          }
        });
        
        ws.on('error', (err: Error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            resolve({ success: false, message: `Lỗi WebSocket: ${err.message}` });
          }
        });
      });
    }
  } catch (error: any) {
    return { success: false, message: `Lỗi kết nối: ${error.message}` };
  }
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

// WS-2 — Notify a machine that a new model package is available (signal only).
// The binary is pulled over the apiKey-verified HTTP proxy, never via Socket.io.
export function emitMachineModelAvailable(payload: {
  machineId?: number | null;
  deviceId: string;
  deploymentId: number;
  packageVersion?: string | null;
  packageHash?: string | null;
}): void {
  if (!io) {
    console.warn("[Socket.io] Cannot emit model_available: Socket.io not initialized");
    return;
  }
  const event = { ...payload, timestamp: new Date() };
  io.to("global").emit("machine:model_available", event);
  if (payload.machineId) {
    io.to(`machine:${payload.machineId}`).emit("machine:model_available", event);
  }
  console.log(`[Socket.io] Emitted machine:model_available for deployment ${payload.deploymentId} (device ${payload.deviceId})`);
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


// ============ MQTT REALTIME EVENTS ============

export interface MqttMessageEvent {
  topic: string;
  payload: any;
  timestamp: Date;
  machineCode?: string;
}

// Store recent MQTT messages for replay (last 1000 messages)
const mqttMessageHistory: MqttMessageEvent[] = [];
const MAX_MESSAGE_HISTORY = 1000;

// Emit SPC rule violation alert
export interface SpcViolationAlert {
  ruleId: string;
  ruleName: string;
  severity: "critical" | "warning" | "info";
  metric: string;
  machineId?: number;
  machineCode?: string;
  pointIndices: number[];
  violationCount: number;
  detectedAt: Date;
  message: string;
}

export function emitSpcViolationAlert(alert: SpcViolationAlert): void {
  if (!io) return;
  io.to("global").emit("spc:violation", alert);
  if (alert.machineId) {
    io.to(`machine:${alert.machineId}`).emit("spc:violation", alert);
  }
  console.log(`[SPC] ${alert.severity.toUpperCase()} violation: ${alert.ruleName} (${alert.metric})`);
}

// Emit alert escalation event
export interface AlertEscalationEvent {
  alertId: number;
  alertTitle: string;
  fromLevel: number;
  toLevel: number;
  severity: string;
  reason: string;
  machineId?: number;
  escalatedAt: Date;
}

export function emitAlertEscalation(event: AlertEscalationEvent): void {
  if (!io) return;
  io.to("global").emit("alert:escalation", event);
  if (event.machineId) {
    io.to(`machine:${event.machineId}`).emit("alert:escalation", event);
  }
  console.log(`[Escalation] Alert ${event.alertId} → L${event.toLevel} (${event.severity}): ${event.reason}`);
}

// Emit MQTT message to connected clients
export function emitMqttMessage(event: MqttMessageEvent): void {
  if (!io) return;
  
  // Store in history for replay
  mqttMessageHistory.push(event);
  if (mqttMessageHistory.length > MAX_MESSAGE_HISTORY) {
    mqttMessageHistory.shift();
  }
  
  // Emit to global room
  io.to("global").emit("mqtt:message", event);
  
  // If machine code is known, emit to machine-specific room
  if (event.machineCode) {
    io.to(`machine:${event.machineCode}`).emit("mqtt:message", event);
  }
}

// Get MQTT message history for replay
export function getMqttMessageHistory(options?: {
  topic?: string;
  machineCode?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}): MqttMessageEvent[] {
  let filtered = [...mqttMessageHistory];
  
  if (options?.topic) {
    filtered = filtered.filter(m => m.topic.includes(options.topic!));
  }
  if (options?.machineCode) {
    filtered = filtered.filter(m => m.machineCode === options.machineCode);
  }
  if (options?.startTime) {
    filtered = filtered.filter(m => m.timestamp >= options.startTime!);
  }
  if (options?.endTime) {
    filtered = filtered.filter(m => m.timestamp <= options.endTime!);
  }
  
  const limit = options?.limit || 100;
  return filtered.slice(-limit);
}

// ============ MACHINE AUTO-DISCOVERY ============

export interface DiscoveredMachine {
  machineCode: string;
  topic: string;
  firstSeen: Date;
  lastSeen: Date;
  messageCount: number;
  samplePayload?: any;
}

const discoveredMachines: Map<string, DiscoveredMachine> = new Map();

// Parse machine code from MQTT topic
export function parseMachineFromTopic(topic: string): string | null {
  // Common patterns: avi/machine/{code}/data, aoi/{code}/inspection, {code}/status
  const patterns = [
    /^avi\/machine\/([^\/]+)/i,
    /^aoi\/([^\/]+)/i,
    /^machine\/([^\/]+)/i,
    /^([A-Z]{2,4}\d{3,})/i, // e.g., AVI001, AOI123
  ];
  
  for (const pattern of patterns) {
    const match = topic.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Auto-discover machine from MQTT message
export function autoDiscoverMachine(topic: string, payload: any): DiscoveredMachine | null {
  const machineCode = parseMachineFromTopic(topic);
  if (!machineCode) return null;
  
  const existing = discoveredMachines.get(machineCode);
  if (existing) {
    existing.lastSeen = new Date();
    existing.messageCount++;
    discoveredMachines.set(machineCode, existing);
    return existing;
  }
  
  const discovered: DiscoveredMachine = {
    machineCode,
    topic,
    firstSeen: new Date(),
    lastSeen: new Date(),
    messageCount: 1,
    samplePayload: payload,
  };
  discoveredMachines.set(machineCode, discovered);
  
  // Notify admin about new discovered machine
  if (io) {
    io.to("admin").emit("machine:discovered", discovered);
  }
  
  return discovered;
}

// Get all discovered machines
export function getDiscoveredMachines(): DiscoveredMachine[] {
  return Array.from(discoveredMachines.values());
}

// ============ OEE CALCULATION ============

export interface OEEMetrics {
  machineId: number;
  machineCode: string;
  timestamp: Date;
  availability: number; // (Run Time / Planned Production Time) * 100
  performance: number;  // (Ideal Cycle Time × Total Count / Run Time) * 100
  quality: number;      // (Good Count / Total Count) * 100
  oee: number;          // (Availability × Performance × Quality) / 10000
  details: {
    plannedTime: number;     // minutes
    runTime: number;         // minutes
    downtime: number;        // minutes
    idealCycleTime: number;  // seconds per unit
    totalCount: number;
    goodCount: number;
    rejectCount: number;
  };
}

// Store OEE data per machine
const machineOEEData: Map<number, OEEMetrics> = new Map();

// Calculate OEE for a machine
export function calculateOEE(
  machineId: number,
  machineCode: string,
  data: {
    plannedTime: number;     // minutes
    runTime: number;         // minutes
    idealCycleTime: number;  // seconds per unit
    totalCount: number;
    goodCount: number;
  }
): OEEMetrics {
  const { plannedTime, runTime, idealCycleTime, totalCount, goodCount } = data;
  
  // Availability = Run Time / Planned Production Time
  const availability = plannedTime > 0 ? (runTime / plannedTime) * 100 : 0;
  
  // Performance = (Ideal Cycle Time × Total Count) / Run Time
  const runTimeSeconds = runTime * 60;
  const performance = runTimeSeconds > 0 
    ? ((idealCycleTime * totalCount) / runTimeSeconds) * 100 
    : 0;
  
  // Quality = Good Count / Total Count
  const quality = totalCount > 0 ? (goodCount / totalCount) * 100 : 0;
  
  // OEE = Availability × Performance × Quality
  const oee = (availability * performance * quality) / 10000;
  
  const metrics: OEEMetrics = {
    machineId,
    machineCode,
    timestamp: new Date(),
    availability: Math.min(100, Math.max(0, availability)),
    performance: Math.min(100, Math.max(0, performance)),
    quality: Math.min(100, Math.max(0, quality)),
    oee: Math.min(100, Math.max(0, oee)),
    details: {
      plannedTime,
      runTime,
      downtime: plannedTime - runTime,
      idealCycleTime,
      totalCount,
      goodCount,
      rejectCount: totalCount - goodCount,
    },
  };
  
  machineOEEData.set(machineId, metrics);
  
  // Save to database
  (async () => {
    try {
      const { getDb } = await import('../db');
      const dbConnection = await getDb();
      if (!dbConnection) {
        console.warn('[OEE] Database not available, skipping save');
        return;
      }
      const { sql } = await import('drizzle-orm');
      await dbConnection.execute(sql`
        INSERT INTO oee_metrics 
         (machineId, machineCode, timestamp, periodType, availability, performance, quality, oee,
          plannedTime, runTime, idealCycleTime, totalCount, goodCount, rejectCount, calculatedBy)
         VALUES (
          ${machineId},
          ${machineCode},
          ${metrics.timestamp},
          'HOUR',
          ${Math.round(availability * 100)},
          ${Math.round(performance * 100)},
          ${Math.round(quality * 100)},
          ${Math.round(oee * 100)},
          ${plannedTime},
          ${runTime},
          ${idealCycleTime},
          ${totalCount},
          ${goodCount},
          ${totalCount - goodCount},
          'AUTO'
         )
      `);
    } catch (error) {
      console.error('[OEE] Failed to save to database:', error);
    }
  })();
  
  // Emit OEE update to clients
  if (io) {
    io.to("global").emit("oee:update", metrics);
    io.to(`machine:${machineId}`).emit("oee:update", metrics);
  }
  
  return metrics;
}

// Get OEE for a machine
export function getMachineOEE(machineId: number): OEEMetrics | undefined {
  return machineOEEData.get(machineId);
}

// Get all machines OEE
export function getAllMachinesOEE(): OEEMetrics[] {
  return Array.from(machineOEEData.values());
}

// ============ DOWNTIME TRACKING ============

export interface DowntimeEvent {
  id: string;
  machineId: number;
  machineCode: string;
  startTime: Date;
  endTime?: Date;
  duration?: number; // minutes
  category: 'planned' | 'unplanned' | 'breakdown' | 'changeover' | 'maintenance' | 'other';
  reason?: string;
  notes?: string;
  reportedBy?: string;
}

const activeDowntimes: Map<number, DowntimeEvent> = new Map();
const downtimeHistory: DowntimeEvent[] = [];

// Start downtime tracking
export function startDowntime(
  machineId: number,
  machineCode: string,
  category: DowntimeEvent['category'],
  reason?: string,
  reportedBy?: string
): DowntimeEvent {
  const event: DowntimeEvent = {
    id: `DT-${Date.now()}-${machineId}`,
    machineId,
    machineCode,
    startTime: new Date(),
    category,
    reason,
    reportedBy,
  };
  
  activeDowntimes.set(machineId, event);
  
  // Save to database
  (async () => {
    try {
      const { getDb } = await import('../db');
      const dbConnection = await getDb();
      if (!dbConnection) return;
      const { sql } = await import('drizzle-orm');
      await dbConnection.execute(sql`
        INSERT INTO downtime_events 
         (machineId, machineCode, category, reason, startTime, detectionMethod)
         VALUES (
          ${machineId},
          ${machineCode},
          ${category},
          ${reason || 'No reason provided'},
          ${event.startTime},
          'MANUAL'
         )
      `);
    } catch (error) {
      console.error('[Downtime] Failed to save start event:', error);
    }
  })();
  
  // Emit downtime start event
  if (io) {
    io.to("global").emit("downtime:start", event);
    io.to(`machine:${machineId}`).emit("downtime:start", event);
  }
  
  return event;
}

// End downtime tracking
export function endDowntime(machineId: number, notes?: string): DowntimeEvent | null {
  const event = activeDowntimes.get(machineId);
  if (!event) return null;
  
  event.endTime = new Date();
  event.duration = Math.round((event.endTime.getTime() - event.startTime.getTime()) / 60000);
  event.notes = notes;
  
  activeDowntimes.delete(machineId);
  downtimeHistory.push(event);
  
  // Keep only last 1000 events
  if (downtimeHistory.length > 1000) {
    downtimeHistory.shift();
  }
  
  // Update database
  (async () => {
    try {
      const { getDb } = await import('../db');
      const dbConnection = await getDb();
      if (!dbConnection) return;
      const { sql } = await import('drizzle-orm');
      await dbConnection.execute(sql`
        UPDATE downtime_events 
        SET endTime = ${event.endTime},
            duration = ${event.duration}
        WHERE machineId = ${machineId}
          AND endTime IS NULL
        ORDER BY startTime DESC
        LIMIT 1
      `);
    } catch (error) {
      console.error('[Downtime] Failed to update end event:', error);
    }
  })();
  
  // Emit downtime end event
  if (io) {
    io.to("global").emit("downtime:end", event);
    io.to(`machine:${machineId}`).emit("downtime:end", event);
  }
  
  return event;
}

// Get active downtime for a machine
export function getActiveDowntime(machineId: number): DowntimeEvent | undefined {
  return activeDowntimes.get(machineId);
}

// Get downtime history
export function getDowntimeHistory(options?: {
  machineId?: number;
  category?: DowntimeEvent['category'];
  startDate?: Date;
  endDate?: Date;
}): DowntimeEvent[] {
  let filtered = [...downtimeHistory];
  
  if (options?.machineId) {
    filtered = filtered.filter(d => d.machineId === options.machineId);
  }
  if (options?.category) {
    filtered = filtered.filter(d => d.category === options.category);
  }
  if (options?.startDate) {
    filtered = filtered.filter(d => d.startTime >= options.startDate!);
  }
  if (options?.endDate) {
    filtered = filtered.filter(d => d.startTime <= options.endDate!);
  }
  
  return filtered;
}

// ============ PREDICTIVE MAINTENANCE ============

export interface MaintenanceAlert {
  machineId: number;
  machineCode: string;
  alertType: 'warning' | 'critical';
  metric: string;
  currentValue: number;
  threshold: number;
  prediction: string;
  suggestedAction: string;
  timestamp: Date;
}

// Machine health scores
const machineHealthScores: Map<number, {
  score: number;
  factors: { name: string; score: number; weight: number }[];
  lastUpdated: Date;
}> = new Map();

// Calculate machine health score
export function calculateMachineHealth(
  machineId: number,
  machineCode: string,
  metrics: {
    oee?: number;
    uptime?: number;        // percentage
    errorRate?: number;     // errors per hour
    cycleTimeVariance?: number; // percentage deviation from ideal
    downtimeFrequency?: number; // events per day
  }
): number {
  const factors: { name: string; score: number; weight: number }[] = [];
  
  // OEE factor (weight: 30%)
  if (metrics.oee !== undefined) {
    factors.push({ name: 'OEE', score: metrics.oee, weight: 0.3 });
  }
  
  // Uptime factor (weight: 25%)
  if (metrics.uptime !== undefined) {
    factors.push({ name: 'Uptime', score: metrics.uptime, weight: 0.25 });
  }
  
  // Error rate factor (weight: 20%) - lower is better
  if (metrics.errorRate !== undefined) {
    const errorScore = Math.max(0, 100 - metrics.errorRate * 10);
    factors.push({ name: 'Error Rate', score: errorScore, weight: 0.2 });
  }
  
  // Cycle time variance factor (weight: 15%) - lower is better
  if (metrics.cycleTimeVariance !== undefined) {
    const varianceScore = Math.max(0, 100 - metrics.cycleTimeVariance);
    factors.push({ name: 'Cycle Time Stability', score: varianceScore, weight: 0.15 });
  }
  
  // Downtime frequency factor (weight: 10%) - lower is better
  if (metrics.downtimeFrequency !== undefined) {
    const downtimeScore = Math.max(0, 100 - metrics.downtimeFrequency * 20);
    factors.push({ name: 'Downtime Frequency', score: downtimeScore, weight: 0.1 });
  }
  
  // Calculate weighted average
  const totalWeight = factors.reduce((sum, f) => sum + f.weight, 0);
  const weightedSum = factors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const healthScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  
  machineHealthScores.set(machineId, {
    score: healthScore,
    factors,
    lastUpdated: new Date(),
  });
  
  // Generate alerts if health is low
  if (healthScore < 50) {
    const alert: MaintenanceAlert = {
      machineId,
      machineCode,
      alertType: healthScore < 30 ? 'critical' : 'warning',
      metric: 'Health Score',
      currentValue: healthScore,
      threshold: 50,
      prediction: healthScore < 30 
        ? 'Máy có nguy cơ hỏng hóc cao trong 24-48 giờ tới'
        : 'Hiệu suất máy đang giảm, cần kiểm tra trong tuần này',
      suggestedAction: healthScore < 30
        ? 'Lên lịch bảo trì khẩn cấp ngay lập tức'
        : 'Kiểm tra và bảo dưỡng định kỳ',
      timestamp: new Date(),
    };
    
    if (io) {
      io.to("global").emit("maintenance:alert", alert);
      io.to(`machine:${machineId}`).emit("maintenance:alert", alert);
    }
  }
  
  return healthScore;
}

// Get machine health score
export function getMachineHealthScore(machineId: number) {
  return machineHealthScores.get(machineId);
}

// ============ MACHINE BENCHMARKING ============

export interface MachineBenchmark {
  machineId: number;
  machineCode: string;
  lineId?: number;
  metrics: {
    avgOEE: number;
    avgYield: number;
    avgCycleTime: number;
    totalOutput: number;
    totalDowntime: number;
    errorCount: number;
  };
  rank: number;
  percentile: number;
  period: { start: Date; end: Date };
}

// Calculate benchmarks for machines in a line
export function calculateLineBenchmarks(
  machines: Array<{
    machineId: number;
    machineCode: string;
    lineId: number;
    oee: number;
    yield: number;
    cycleTime: number;
    output: number;
    downtime: number;
    errors: number;
  }>,
  period: { start: Date; end: Date }
): MachineBenchmark[] {
  // Sort by OEE for ranking
  const sorted = [...machines].sort((a, b) => b.oee - a.oee);
  
  return sorted.map((m, index) => ({
    machineId: m.machineId,
    machineCode: m.machineCode,
    lineId: m.lineId,
    metrics: {
      avgOEE: m.oee,
      avgYield: m.yield,
      avgCycleTime: m.cycleTime,
      totalOutput: m.output,
      totalDowntime: m.downtime,
      errorCount: m.errors,
    },
    rank: index + 1,
    percentile: ((sorted.length - index) / sorted.length) * 100,
    period,
  }));
}
