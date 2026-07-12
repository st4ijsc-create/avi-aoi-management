import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import { nanoid } from "nanoid";
import * as db from "../db";
import { sdk } from "./sdk";
import { attachRedisAdapter } from "./socketRedisAdapter";
import { eventBus, EventTypes, type DomainEvent } from "./eventBus";
import { toEcosystemEvent, isAlertKind, type EcosystemEvent } from "../services/ecosystem/ecosystemEvents";

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
    socket.on("subscribe", (data: { factoryId?: number; workshopId?: number; machineId?: number; lineId?: number }) => {
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
      // F5a — Andon/interlock events are emitted per production line.
      if (data.lineId) {
        socket.join(`line:${data.lineId}`);
        console.log(`[Socket.io] ${socket.id} joined line:${data.lineId}`);
      }
      // T1-c — Digital Twin live stream room (per factory). A 3D twin viewer joins
      // `twin:{factoryId}` to receive throttled device state/position deltas.
      if ((data as any).twinFactoryId) {
        socket.join(`twin:${(data as any).twinFactoryId}`);
        console.log(`[Socket.io] ${socket.id} joined twin:${(data as any).twinFactoryId}`);
      }
      // X1-c (doc 16 §5) — Device live stream room (per device). A device-monitor
      // viewer joins `device:{deviceId}` to receive TIERED-sampled UDM state/position
      // deltas (deviceStream gateway, gated by FIELD_V2_ENABLED). Producer-gated; no
      // gate here. `deviceStreamId` is the logical key ("robot:1"/"machine:7").
      if ((data as any).deviceStreamId) {
        socket.join(`device:${(data as any).deviceStreamId}`);
        console.log(`[Socket.io] ${socket.id} joined device:${(data as any).deviceStreamId}`);
      }
      // U3-live (doc 21 §6 / G-5) — Robot live-telemetry room (per robot). The Robot
      // Cockpit joins `robot:{robotId}` to receive compact live UDM deltas emitted by
      // robotIngest on every polled snapshot (previously robot pages were poll/static).
      if ((data as any).robotId) {
        socket.join(`robot:${(data as any).robotId}`);
        console.log(`[Socket.io] ${socket.id} joined robot:${(data as any).robotId}`);
      }
      // U5-live (doc 21 §6 / G-7) — Federation SITE room. The Command Center /
      // Federation tree joins `site:{siteCode}` (a specific site) and/or `sites:global`
      // (all sites) to receive `site:update` when the aggregator refreshes a site's
      // roll-up — so the site level is live, not just 30s-polled. Producer-gated by the
      // aggregator flag; no gate here (a room join is harmless).
      if ((data as any).siteCode) {
        socket.join(`site:${(data as any).siteCode}`);
        console.log(`[Socket.io] ${socket.id} joined site:${(data as any).siteCode}`);
      }
      if ((data as any).sitesGlobal) {
        socket.join("sites:global");
        console.log(`[Socket.io] ${socket.id} joined sites:global`);
      }
      // MON-F6 (doc 40) — OPT-IN telemetry firehose room. `telemetry:sample` is a
      // high-rate stream; it used to fan out to `global` (which EVERY client joins),
      // so a 100+ machine fleet flooded every browser. Now only clients that
      // explicitly opt in — the admin telemetry monitor — join `telemetry:all`.
      // Per-machine subscribers still receive just their machine's subset via
      // `machine:{id}` (unchanged).
      if ((data as any).telemetryAll) {
        socket.join("telemetry:all");
        console.log(`[Socket.io] ${socket.id} joined telemetry:all`);
      }
      // Everyone joins the global room for all alerts
      socket.join("global");
    });

    socket.on("unsubscribe", (data: { factoryId?: number; workshopId?: number; machineId?: number; lineId?: number }) => {
      if (data.factoryId) socket.leave(`factory:${data.factoryId}`);
      if (data.workshopId) socket.leave(`workshop:${data.workshopId}`);
      if (data.machineId) socket.leave(`machine:${data.machineId}`);
      if (data.lineId) socket.leave(`line:${data.lineId}`);
      if ((data as any).twinFactoryId) socket.leave(`twin:${(data as any).twinFactoryId}`);
      if ((data as any).deviceStreamId) socket.leave(`device:${(data as any).deviceStreamId}`);
      // U3-live — leave the per-robot live-telemetry room.
      if ((data as any).robotId) socket.leave(`robot:${(data as any).robotId}`);
      // U5-live — leave the federation site room(s).
      if ((data as any).siteCode) socket.leave(`site:${(data as any).siteCode}`);
      if ((data as any).sitesGlobal) socket.leave("sites:global");
      // MON-F6 — leave the opt-in telemetry firehose room.
      if ((data as any).telemetryAll) socket.leave("telemetry:all");
    });

    // Doc 09 / D6 — Engineering Online-Monitor room. A workspace client joins
    // `engineering:{machineId}` to receive high-rate symbol-watch samples (separate from
    // the DB-persisted telemetry stream). Gated by DPC_STREAMING_ENABLED on the producer.
    socket.on("engineering:subscribe", (data: { machineId: number }) => {
      if (data?.machineId) socket.join(`engineering:${data.machineId}`);
    });
    socket.on("engineering:unsubscribe", (data: { machineId: number }) => {
      if (data?.machineId) socket.leave(`engineering:${data.machineId}`);
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
  
  // G2.7 — start the WIP twin broadcaster (no-op unless TWIN_STREAM_ENABLED=true).
  startTwinBroadcaster();

  // P2 follow-up — start the realtime OEE broadcaster (single oeeService source).
  startOeeBroadcaster();

  console.log("[Socket.io] WebSocket server initialized");
  return io;
}

export function getIO(): Server | null {
  return io;
}

// ============ U1-c — UNIFIED NORMALIZED EVENT/ALERT STREAM (client) ============
//
// ONE re-broadcast: subscribe to the server eventBus, normalize each domain event
// into the compact `EcosystemEvent` envelope, and emit it to the client on a single
// `ecosystem:event` channel (plus a filtered `alerts:stream` for alert-class events).
// This is ADDITIVE — the existing per-event socket emits (inspection:alert,
// andon:event, …) are untouched; this is a NEW stream the Command Center (U2) +
// cockpits (U3) + the global NotificationCenter consume.
//
// RBAC / tenant isolation: routed to `global` PLUS the scoped rooms the client
// already joins (factory:/line:/machine:) — so a client only receives events for
// scopes it subscribed to. Cross-tenant leakage is bounded by the same room model
// the legacy emits use. (Redis cross-instance fan-out is still U6.)
let ecosystemBridgeInstalled = false;
let ecosystemBridgeUnsub: (() => void) | null = null;

/** Which bus event types feed the unified client stream (legacy + new U1 events). */
const UNIFIED_STREAM_TYPES: string[] = [
  EventTypes.INSPECTION_ALERT,
  EventTypes.NG_ALERT,
  EventTypes.YIELD_WARNING,
  EventTypes.SPC_VIOLATION,
  EventTypes.ANDON,
  EventTypes.SAFETY_EVENT,
  "quality_gate.breach",
  "alert.escalation",
  "maintenance.alert",
  "downtime.start",
  "downtime.end",
  "oee.update",
  // new U1 domain events
  "task.assigned",
  "task.completed",
  "task.failed",
  "workorder.created",
  "anomaly.detected",
  "program.deployed",
  "twin.derived",
];

function broadcastEcosystemEvent(evt: EcosystemEvent): void {
  if (!io) return;
  // Global room — every subscribed client (the NotificationCenter joins global).
  io.to("global").emit("ecosystem:event", evt);
  if (isAlertKind(evt.kind)) io.to("global").emit("alerts:stream", evt);

  // Scoped fan-out — mirror to the specific rooms the client may have joined so a
  // machine/line/factory dashboard receives its own slice without the global noise.
  const rooms: string[] = [];
  if (evt.scope.factoryId != null) rooms.push(`factory:${evt.scope.factoryId}`);
  if (evt.scope.lineId != null) rooms.push(`line:${evt.scope.lineId}`);
  if (evt.scope.machineId != null) rooms.push(`machine:${evt.scope.machineId}`);
  for (const room of rooms) {
    io.to(room).emit("ecosystem:event", evt);
    if (isAlertKind(evt.kind)) io.to(room).emit("alerts:stream", evt);
  }
}

/**
 * Install the eventBus→socket re-broadcast. Idempotent + safe at startup. No-op emit
 * when io is not initialized (the handler still runs but broadcastEcosystemEvent
 * guards on io). Subscribes per-type (not the wildcard) so bus-internal events like
 * `orchestration.triggered` / `ai.insight` never reach the client.
 */
export function installEcosystemSocketBridge(): void {
  if (ecosystemBridgeInstalled) return;
  ecosystemBridgeInstalled = true;
  const unsubs: Array<() => void> = [];
  const handle = (e: DomainEvent) => {
    try {
      const evt = toEcosystemEvent(e);
      if (evt) broadcastEcosystemEvent(evt);
    } catch (err) {
      console.error("[U1] ecosystem socket re-broadcast failed:", (err as Error)?.message ?? err);
    }
  };
  for (const t of UNIFIED_STREAM_TYPES) unsubs.push(eventBus.subscribe(t, handle));
  ecosystemBridgeUnsub = () => { while (unsubs.length) unsubs.pop()!(); };
  console.log(`[U1] ecosystem socket bridge installed (${UNIFIED_STREAM_TYPES.length} event types → ecosystem:event / alerts:stream)`);
}

/** Tear down the re-broadcast (tests / shutdown). */
export function uninstallEcosystemSocketBridge(): void {
  if (ecosystemBridgeUnsub) ecosystemBridgeUnsub();
  ecosystemBridgeUnsub = null;
  ecosystemBridgeInstalled = false;
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
  // Orchestration backbone (Phase 2): publish to the internal event bus
  // regardless of socket state, so server-side consumers always see it.
  eventBus.publish(EventTypes.INSPECTION_ALERT, alert, "socket");
  if (alert.type === "NG_ALERT") eventBus.publish(EventTypes.NG_ALERT, alert, "socket");
  if (alert.type === "YIELD_WARNING") eventBus.publish(EventTypes.YIELD_WARNING, alert, "socket");

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

/**
 * Doc 09 / D6 — emit a batch of engineering symbol-watch samples to the
 * `engineering:{machineId}` room (Online Monitor / scope). High-rate + EPHEMERAL:
 * NOT persisted to TimescaleDB (that path stays the 5s telemetry ingest). Producer is
 * gated by DPC_STREAMING_ENABLED; this is a thin transport with no gate of its own.
 */
export function emitEngineeringSamples(
  machineId: number,
  samples: Array<{ symbol: string; value: number | string | boolean | null; ts: number }>,
): void {
  if (!io) return; // no socket server (e.g. tests / headless) → silently no-op
  io.to(`engineering:${machineId}`).emit("engineering:samples", { machineId, samples });
}

// ============ P2 — UNIFIED TELEMETRY BUS CHANNEL ============

/**
 * One canonical telemetry sample as broadcast on the unified bus channel. This is
 * the wire shape clients receive on `telemetry:sample`; it mirrors a row of the
 * canonical ot_telemetry table (event time `ts` as ISO string for JSON transport).
 */
export interface TelemetryBroadcastSample {
  machineId: number | null;
  deviceId: string | null;
  protocol: string;
  metric: string;
  numValue: number | null;
  textValue: string | null;
  boolValue: boolean | null;
  unit: string | null;
  quality: string;
  ts: string; // ISO
}

/**
 * P2 — broadcast a batch of canonical telemetry samples on the ONE unified bus
 * channel. SIGNAL ONLY (never writes to a device or DB; the bus already persisted).
 * No-op when io is not initialized (tests / headless). MON-F6 (doc 40): the whole
 * batch goes to the OPT-IN `telemetry:all` room (admin telemetry monitor) — NOT the
 * everyone-joins `global` room — and each sample is additionally fanned out to its
 * per-machine room so a client subscribed to `machine:{id}` receives only that
 * machine's samples. This stops the firehose from flooding every connected client.
 */
export function emitTelemetrySamples(samples: TelemetryBroadcastSample[]): void {
  if (!io || samples.length === 0) return;
  // R-2a (doc 38 P1-I) — optional emit coalescing for the `telemetry:sample` firehose.
  // TELEMETRY_EMIT_COALESCE_MS > 0 buffers samples and emits ONE merged frame per
  // window (bounded by TELEMETRY_EMIT_MAX_BATCH, default 1000). Default 0 = emit
  // immediately (unchanged behaviour). Order is preserved (FIFO).
  const ms = telemetryEmitCoalesceMs();
  if (ms <= 0) {
    doEmitTelemetrySamples(samples);
    return;
  }
  for (const s of samples) telemetryEmitBuffer.push(s);
  const max = telemetryEmitMaxBatch();
  if (telemetryEmitBuffer.length >= max) {
    flushTelemetryEmit();
    return;
  }
  if (!telemetryEmitTimer) {
    const t = setTimeout(flushTelemetryEmit, ms);
    if (typeof (t as { unref?: () => void }).unref === "function") (t as { unref: () => void }).unref();
    telemetryEmitTimer = t;
  }
}

function telemetryEmitCoalesceMs(): number {
  const n = parseInt(String(process.env.TELEMETRY_EMIT_COALESCE_MS ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function telemetryEmitMaxBatch(): number {
  const n = parseInt(String(process.env.TELEMETRY_EMIT_MAX_BATCH ?? ""), 10);
  return Number.isFinite(n) && n >= 1 ? n : 1000;
}

let telemetryEmitBuffer: TelemetryBroadcastSample[] = [];
let telemetryEmitTimer: ReturnType<typeof setTimeout> | null = null;

/** Flush the coalesced telemetry emit buffer as ONE merged frame. Never throws. */
function flushTelemetryEmit(): void {
  if (telemetryEmitTimer) {
    clearTimeout(telemetryEmitTimer);
    telemetryEmitTimer = null;
  }
  if (telemetryEmitBuffer.length === 0) return;
  const batch = telemetryEmitBuffer;
  telemetryEmitBuffer = [];
  try {
    doEmitTelemetrySamples(batch);
  } catch (e) {
    console.error("[Socket.io] telemetry emit flush failed:", (e as any)?.message ?? e);
  }
}

/** The actual room fan-out (immediate). Shared by the direct + coalesced paths. */
function doEmitTelemetrySamples(samples: TelemetryBroadcastSample[]): void {
  if (!io || samples.length === 0) return;
  // MON-F6 (doc 40): full batch → opt-in `telemetry:all`, not the `global` firehose.
  io.to("telemetry:all").emit("telemetry:sample", { samples });
  // Per-machine fan-out: group by machineId so each machine room gets its subset.
  const byMachine = new Map<number, TelemetryBroadcastSample[]>();
  for (const s of samples) {
    if (s.machineId == null) continue;
    const arr = byMachine.get(s.machineId);
    if (arr) arr.push(s);
    else byMachine.set(s.machineId, [s]);
  }
  for (const [machineId, arr] of byMachine) {
    io.to(`machine:${machineId}`).emit("telemetry:sample", { samples: arr });
  }
}

// ============ P2 follow-up — REALTIME OEE BROADCAST ============

let oeeBroadcastTimer: ReturnType<typeof setInterval> | null = null;

/**
 * P2 follow-up — periodically broadcast canonical live OEE (the single oeeService
 * source of truth) to the `global` room on `oee:update`. Restores realtime OEE
 * after the legacy in-memory path was retired. Guarded: disable with
 * OEE_BROADCAST_ENABLED=false; interval via OEE_BROADCAST_INTERVAL_SEC (default 60s,
 * min 15s). Computes live on read, honest (omits machines without data). Fail-safe:
 * errors are swallowed so the timer never dies. Dynamic import avoids an import cycle.
 */
export function startOeeBroadcaster(): void {
  if (oeeBroadcastTimer) return; // guard double-start
  if (process.env.OEE_BROADCAST_ENABLED === "false") return;
  const intervalSec = Math.max(15, Number(process.env.OEE_BROADCAST_INTERVAL_SEC) || 60);
  const tick = async () => {
    try {
      if (!io) return;
      const { getAllMachinesOEELive } = await import("../services/oeeService");
      const metrics = await getAllMachinesOEELive();
      if (metrics.length === 0) return;
      io.to("global").emit("oee:update", { metrics, at: new Date().toISOString() });
    } catch (e) {
      console.error("[Socket.io] OEE broadcast failed:", (e as any)?.message ?? e);
    }
  };
  oeeBroadcastTimer = setInterval(() => { void tick(); }, intervalSec * 1000);
  setTimeout(() => { void tick(); }, 5000); // first push shortly after boot
  console.log(`[Socket.io] OEE broadcaster started (every ${intervalSec}s)`);
}

export function stopOeeBroadcaster(): void {
  if (oeeBroadcastTimer) { clearInterval(oeeBroadcastTimer); oeeBroadcastTimer = null; }
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
  eventBus.publish(EventTypes.SPC_VIOLATION, alert, "socket");
  if (!io) return;
  io.to("global").emit("spc:violation", alert);
  if (alert.machineId) {
    io.to(`machine:${alert.machineId}`).emit("spc:violation", alert);
  }
  console.log(`[SPC] ${alert.severity.toUpperCase()} violation: ${alert.ruleName} (${alert.metric})`);
}

// ─── Sprint F5a — Andon realtime event (ALERT-ONLY; NOT a control command) ───
export interface AndonRealtimeEvent {
  id: number;
  state: "green" | "yellow" | "red" | "call";
  reason: string;
  status: "raised" | "acknowledged" | "resolved";
  title: string;
  message?: string | null;
  lineId?: number | null;
  stationId?: number | null;
  machineId?: number | null;
  raisedBySystem: boolean;
  sourceInterlockEventId?: number | null;
  raisedAt: Date | string;
  /** Lifecycle phase that produced this emit (raise/acknowledge/resolve/escalate). */
  event?: "raised" | "acknowledged" | "resolved" | "escalated";
}

/**
 * Broadcast an Andon event to the global room + the relevant line/machine rooms.
 * This is a SIGNAL only — it never writes to any machine. Mirrors
 * emitSpcViolationAlert (no-op when io is not initialized).
 */
export function emitAndonEvent(event: AndonRealtimeEvent): void {
  eventBus.publish(EventTypes.ANDON, event, "socket");
  if (!io) return;
  io.to("global").emit("andon:event", event);
  if (event.lineId) io.to(`line:${event.lineId}`).emit("andon:event", event);
  if (event.machineId) io.to(`machine:${event.machineId}`).emit("andon:event", event);
  console.log(`[Andon] ${event.state.toUpperCase()} (${event.reason}) #${event.id} — ${event.event ?? "raised"}`);
}

// ─── S1 (doc 16 Khối 3) — Safety event realtime broadcast (ADVISORY) ─────────
//
// ⚠ ADVISORY ONLY. This broadcasts a safety_events record (e-stop/intrusion/
// near-miss/…) the software OBSERVED — it is NOT a safety-rated signal and the
// software performs NO safety-rated stop. A real hardware-rated stop is deferred
// to S2. This emit never writes to any device.
export interface SafetyRealtimeEvent {
  id: number;
  eventType: string;
  robotId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  detectedBy?: string | null;
  outcome: string;
  isNearMiss: boolean;
  createdAt: Date | string;
}

export function emitSafetyEvent(event: SafetyRealtimeEvent): void {
  eventBus.publish(EventTypes.SAFETY_EVENT, event, "socket");
  if (!io) return;
  io.to("global").emit("safety:event", event);
  if (event.lineId) io.to(`line:${event.lineId}`).emit("safety:event", event);
  console.log(`[Safety] ADVISORY ${event.eventType} #${event.id} (detectedBy ${event.detectedBy ?? "?"}, outcome ${event.outcome})`);
}

// ============ G2.7 — DIGITAL TWIN STREAM (signal-only, gated) ============

/**
 * Per-station snapshot pushed to twin viewers. Color/loadPct/dominantState are
 * computed server-side (single source: digitalTwinService) — the FE renders them
 * verbatim. No machine-write, no DB-write happens on this path.
 */
export interface TwinStationSnapshot {
  stationId: number;
  wipCount: number;
  loadPct?: number;
  color?: string;
  dominantState?: "starved" | "blocked" | "processing" | "idle";
}

export interface TwinUpdateEvent {
  lineId?: number | null;
  layoutId?: number | null;
  stations: TwinStationSnapshot[];
  ts: number;
}

function twinStreamEnabled(): boolean {
  return process.env.TWIN_STREAM_ENABLED === "true";
}

/**
 * Broadcast a digital-twin WIP/load snapshot. SIGNAL ONLY — never writes to any
 * machine or DB. Gated: no-op when io is not initialized OR the feature flag is
 * off (default), so the FE falls back to polling (backward-compatible).
 */
export function emitTwinUpdate(event: TwinUpdateEvent): void {
  if (!io || !twinStreamEnabled()) return;   // gate: off → no emit, FE polls
  io.to("global").emit("twin:update", event);
  if (event.lineId) io.to(`line:${event.lineId}`).emit("twin:update", event);
}

// Read-only broadcaster: periodically reads WIP-by-station (SELECT only) and
// emits a twin:update. Separated from any write-path. Gated by the same flag.
let twinBroadcaster: ReturnType<typeof setInterval> | null = null;

export function startTwinBroadcaster(intervalMs = 2000): void {
  if (twinBroadcaster || !io || !twinStreamEnabled()) return;
  twinBroadcaster = setInterval(() => {
    if (!io || !twinStreamEnabled()) return;
    // Lazy import keeps socket.ts free of DB-layer import cycles.
    import("../db/twin")
      .then(({ getWipByStation }) => getWipByStation())
      .then((rows) => {
        if (!rows.length) return;
        emitTwinUpdate({
          stations: rows.map((r) => ({ stationId: r.currentStationId, wipCount: r.count })),
          ts: Date.now(),
        });
      })
      .catch((err) => console.error("[Twin] broadcaster read failed:", err));
  }, Math.max(500, intervalMs));
  if (typeof (twinBroadcaster as any)?.unref === "function") (twinBroadcaster as any).unref();
  console.log("[Twin] WIP broadcaster started (read-only, gated)");
}

export function stopTwinBroadcaster(): void {
  if (twinBroadcaster) {
    clearInterval(twinBroadcaster);
    twinBroadcaster = null;
    console.log("[Twin] WIP broadcaster stopped");
  }
}

// ============ T1-c — DIGITAL TWIN LIVE DEVICE STREAM (signal-only, gated) ======

/**
 * A coalesced per-device delta pushed to twin viewers (room `twin:{factoryId}`).
 * Carries only what MOVED — position and/or state — so the FE can translate the
 * model without a full scene-graph refetch. SIGNAL ONLY: never writes a device/DB.
 *
 * doc 24 Wave-1 T1 — OPTIONAL articulation payload (additive, backward-compatible):
 *   • joints  — the robot's joint-angle vector (radians for revolute, mm for
 *               prismatic), indexed over the model's non-fixed joints. When present
 *               the FE poses an ARTICULATED link chain via client-side FK instead of
 *               sliding a block. Absent → the FE renders exactly as before.
 *   • modelId — which kinematic model the joints index into (e.g. "sample-arm-6dof").
 *               Lets the FE pick the matching FK chain without guessing.
 * A device with no joints simply omits both fields (the wire shape is unchanged for
 * every existing producer/consumer).
 */
export interface TwinDeviceDelta {
  equipmentId: string; // "machine:<id>" | "robot:<id>" | "device:<deviceId>"
  position?: { x: number; y: number; z?: number };
  state?: string;
  metric?: string;
  joints?: number[];
  modelId?: string;
  ts: number;
}

/**
 * Push a batch of device deltas to the per-factory twin room. No-op when io is not
 * initialized (tests / headless). The PRODUCER (twinStream gateway) is gated by
 * TWIN_LIVE_ENABLED; this is a thin transport with no gate of its own (so when the
 * gateway is off, it is simply never called → FE keeps polling, backward-compatible).
 */
export function emitTwinDeviceDeltas(factoryId: number, deltas: TwinDeviceDelta[]): void {
  if (!io || deltas.length === 0) return;
  io.to(`twin:${factoryId}`).emit("twin:device", { factoryId, deltas, ts: Date.now() });
}

// ============ X1-c — DEVICE LIVE STREAM (UDM, tiered sampling, gated) ==========

/**
 * A coalesced per-device UDM delta pushed to the per-device room `device:{deviceId}`.
 * Carries only the metrics that changed since the last flush for this device (each
 * metric coalesced to its latest value, at a rate bounded by its tier). SIGNAL ONLY:
 * never writes a device or DB (the unified bus already persisted the sample).
 */
export interface DeviceStreamDelta {
  deviceId: string; // logical key "robot:<id>" | "machine:<id>" | "device:<externalId>"
  metrics: Record<string, number | string | boolean | null>;
  ts: number;
}

/**
 * Push a batch of device UDM deltas to their per-device rooms. No-op when io is not
 * initialized (tests / headless). The PRODUCER (deviceStream gateway) is gated by
 * FIELD_V2_ENABLED; this is a thin transport with no gate of its own — so when the
 * gateway is off it is simply never called (FE keeps its 5s poll, backward-compatible).
 */
export function emitDeviceDeltas(deltas: DeviceStreamDelta[]): void {
  if (!io || deltas.length === 0) return;
  for (const d of deltas) {
    io.to(`device:${d.deviceId}`).emit("device:state", d);
  }
}

// ============ U3-live — ROBOT LIVE TELEMETRY (doc 21 §6 / G-5) =================

/**
 * A compact live snapshot of a robot's UDM, pushed to the per-robot room
 * `robot:{robotId}` on every polled ingest. Carries only the small, UI-relevant
 * fields the Robot Cockpit renders live (mode/busy/estop/speed/pose/joints/battery/
 * safetyZone/firmware/heartbeat) — NOT the full DB row. SIGNAL ONLY: robotIngest has
 * already persisted the robot_telemetry row; this is a thin transport with NO gate of
 * its own (safe to emit — telemetry is not a control path). When io is not initialized
 * (tests / headless) it is a no-op, so the FE simply keeps its existing poll.
 */
export interface RobotTelemetryLive {
  robotId: number;
  robotCode?: string;
  mode?: string | null;
  busy?: boolean | null;
  estop?: boolean | null;
  speedPct?: number | null;
  pose?: Record<string, unknown> | null;
  jointStates?: Array<Record<string, unknown>> | null;
  batteryPct?: number | null;
  safetyZoneId?: number | null;
  firmwareVersion?: string | null;
  error?: string | null;
  status?: string | null;
  ts: number;
}

/**
 * Push one robot's live UDM snapshot to its per-robot room. No-op when io is not
 * initialized. Additive + error-isolated at the call site (robotIngest wraps it in a
 * try/catch so a socket failure can never break the ingest/persist path).
 */
export function emitRobotTelemetry(evt: RobotTelemetryLive): void {
  if (!io) return;
  io.to(`robot:${evt.robotId}`).emit("robot:telemetry", evt);
}

// ============ U5-live — FEDERATION SITE ROLL-UP LIVE (doc 21 §6 / G-7) =========

/**
 * A compact live projection of a site's refreshed roll-up, pushed to the per-site
 * room `site:{siteCode}` + `sites:global` on each aggregator cycle that lands new
 * data for the site. Carries only the small, UI-relevant fields the Federation tree
 * / Command Center site level renders live (freshness + headline KPIs + alert
 * counts) — NOT the full roll-up rows (those stay behind the federationRouter reads).
 * SIGNAL ONLY: the aggregator has already persisted the roll-up; this is a thin
 * transport with NO gate of its own (the PRODUCER — the aggregator — is gated by
 * FEDERATION_AGGREGATOR_ENABLED, so when off it is simply never called and the FE
 * keeps its 30s poll, backward-compatible). No-op when io is not initialized.
 */
export interface SiteUpdateEvent {
  siteCode: string;
  siteId: number;
  status: string; // active | error | ...
  freshness?: "ok" | "stale" | "down";
  asOf?: string | null; // ISO
  fetchedAt?: string | null; // ISO
  kpi?: {
    yieldRate?: number | null;
    ngRate?: number | null;
    throughput?: number | null;
    oee?: number | null;
  } | null;
  alerts?: { open: number; critical: number } | null;
  ts: number;
}

export function emitSiteUpdate(evt: SiteUpdateEvent): void {
  if (!io) return;
  io.to(`site:${evt.siteCode}`).emit("site:update", evt);
  io.to("sites:global").emit("site:update", evt);
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
  // U1 — also publish on the bus so the unified stream (alerts:stream) + subscribers
  // see escalations (previously emit-only / a dead end per the audit).
  eventBus.publish("alert.escalation", event, "socket");
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

  // If machine code is known, emit to the machine-specific room. U1-d BUGFIX: rooms
  // are keyed by NUMERIC machineId (see subscribe: `machine:${machineId}`), NOT the
  // machineCode — the previous `machine:${machineCode}` targeted a room no client
  // ever joins. Resolve the id from the online-machines map and emit to the id room.
  if (event.machineCode) {
    let machineId: number | undefined;
    for (const [id, code] of onlineMachineCodesMap) {
      if (code === event.machineCode) { machineId = id; break; }
    }
    if (machineId != null) io.to(`machine:${machineId}`).emit("mqtt:message", event);
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

// Hương-P0: downtime giờ đọc/ghi thẳng vào bảng downtime_events (Drizzle) để bền
// vững qua restart và không lệch với dữ liệu thật. Bỏ mảng in-memory trước đây
// (activeDowntimes/downtimeHistory) vì mất khi restart và dễ lệch với DB.

// Ánh xạ một row downtime_events (id số, reportedBy là user id) sang shape
// DowntimeEvent mà UI/API đang dùng (id chuỗi, reportedBy chuỗi).
function rowToDowntimeEvent(row: {
  id: number;
  machineId: number;
  machineCode: string;
  category: DowntimeEvent['category'];
  reason: string | null;
  startTime: Date | string;
  endTime: Date | string | null;
  duration: number | null;
  resolution: string | null;
  reportedBy: number | null;
}): DowntimeEvent {
  return {
    id: String(row.id),
    machineId: row.machineId,
    machineCode: row.machineCode,
    startTime: new Date(row.startTime),
    endTime: row.endTime ? new Date(row.endTime) : undefined,
    duration: row.duration ?? undefined,
    category: row.category,
    reason: row.reason ?? undefined,
    notes: row.resolution ?? undefined,
    reportedBy: row.reportedBy != null ? String(row.reportedBy) : undefined,
  };
}

// Start downtime tracking — ném lỗi nếu ghi DB thất bại (không nuốt để UI biết thật).
export async function startDowntime(
  machineId: number,
  machineCode: string,
  category: DowntimeEvent['category'],
  reason?: string,
  _reportedBy?: string
): Promise<DowntimeEvent> {
  const { getDb } = await import('../db');
  const dbConnection = await getDb();
  if (!dbConnection) throw new Error('[Downtime] Database not available');
  const { downtimeEvents } = await import('../../drizzle/schema');

  const [row] = await dbConnection
    .insert(downtimeEvents)
    .values({
      machineId,
      machineCode,
      category,
      reason: reason || 'No reason provided',
      startTime: new Date(),
      detectionMethod: 'MANUAL',
    })
    .returning();

  const event = rowToDowntimeEvent(row as any);

  // U1 — publish on the bus so downtime feeds the unified stream.
  eventBus.publish("downtime.start", event, "socket");
  // Emit downtime start event
  if (io) {
    io.to("global").emit("downtime:start", event);
    io.to(`machine:${machineId}`).emit("downtime:start", event);
  }

  return event;
}

// End downtime tracking — đóng sự kiện downtime đang mở mới nhất của máy trong DB.
export async function endDowntime(machineId: number, notes?: string): Promise<DowntimeEvent | null> {
  const { getDb } = await import('../db');
  const dbConnection = await getDb();
  if (!dbConnection) throw new Error('[Downtime] Database not available');
  const { downtimeEvents } = await import('../../drizzle/schema');
  const { and, eq, isNull, desc } = await import('drizzle-orm');

  // Tìm sự kiện downtime đang mở (endTime IS NULL) mới nhất của máy.
  const [open] = await dbConnection
    .select()
    .from(downtimeEvents)
    .where(and(eq(downtimeEvents.machineId, machineId), isNull(downtimeEvents.endTime)))
    .orderBy(desc(downtimeEvents.startTime))
    .limit(1);
  if (!open) return null;

  const endTime = new Date();
  const duration = Math.round((endTime.getTime() - new Date(open.startTime).getTime()) / 60000);

  const [updated] = await dbConnection
    .update(downtimeEvents)
    .set({
      endTime,
      duration,
      resolution: notes ?? open.resolution ?? null,
      updatedAt: new Date(),
    })
    .where(eq(downtimeEvents.id, open.id))
    .returning();

  const event = rowToDowntimeEvent(updated as any);

  // U1 — publish on the bus so downtime feeds the unified stream.
  eventBus.publish("downtime.end", event, "socket");
  // Emit downtime end event
  if (io) {
    io.to("global").emit("downtime:end", event);
    io.to(`machine:${machineId}`).emit("downtime:end", event);
  }

  return event;
}

// Get active downtime for a machine — đọc từ DB (sự kiện đang mở mới nhất).
export async function getActiveDowntime(machineId: number): Promise<DowntimeEvent | undefined> {
  const { getDb } = await import('../db');
  const dbConnection = await getDb();
  if (!dbConnection) return undefined;
  const { downtimeEvents } = await import('../../drizzle/schema');
  const { and, eq, isNull, desc } = await import('drizzle-orm');

  const [open] = await dbConnection
    .select()
    .from(downtimeEvents)
    .where(and(eq(downtimeEvents.machineId, machineId), isNull(downtimeEvents.endTime)))
    .orderBy(desc(downtimeEvents.startTime))
    .limit(1);
  return open ? rowToDowntimeEvent(open as any) : undefined;
}

// Get downtime history — đọc từ DB, lọc theo machineId/category/khoảng thời gian.
export async function getDowntimeHistory(options?: {
  machineId?: number;
  category?: DowntimeEvent['category'];
  startDate?: Date;
  endDate?: Date;
}): Promise<DowntimeEvent[]> {
  const { getDb } = await import('../db');
  const dbConnection = await getDb();
  if (!dbConnection) return [];
  const { downtimeEvents } = await import('../../drizzle/schema');
  const { and, eq, gte, lte, desc } = await import('drizzle-orm');

  const conds = [];
  if (options?.machineId) conds.push(eq(downtimeEvents.machineId, options.machineId));
  if (options?.category) conds.push(eq(downtimeEvents.category, options.category));
  if (options?.startDate) conds.push(gte(downtimeEvents.startTime, options.startDate));
  if (options?.endDate) conds.push(lte(downtimeEvents.startTime, options.endDate));

  const rows = await dbConnection
    .select()
    .from(downtimeEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(downtimeEvents.startTime))
    .limit(1000);

  return rows.map((r) => rowToDowntimeEvent(r as any));
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
    
    // U1 — publish on the bus so the maintenance alert reaches the unified stream.
    eventBus.publish("maintenance.alert", alert, "socket");
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
