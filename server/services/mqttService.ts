/**
 * MQTT Service - Quản lý MQTT broker và giao tiếp với Android clients
 * 
 * Topic Structure:
 * - avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors - NG alerts
 * - avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/summary/daily - Daily summary
 * - avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/summary/weekly - Weekly summary
 * - avi/client/{clientId}/commands - Commands to specific client
 * - avi/system/broadcast - System-wide broadcasts
 */

import Aedes from 'aedes';
import { createServer } from 'aedes-server-factory';
import { readFileSync } from 'fs';
import { timingSafeEqual } from 'node:crypto';
import { initUnsPublisher, publishNormalized, publishAoiBridge, publishNdeathGraceful, shutdownUnsPublisher } from './unsPublisher';
import { mapAoiTopicToSparkplug } from './uns/aoiBridge';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq, and, sql, lt } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import mqtt, { MqttClient } from 'mqtt';

// Types
interface MqttClientInfo {
  clientId: string;
  deviceId: string;
  deviceName?: string;
  deviceModel?: string;
  osVersion?: string;
  appVersion?: string;
  stationId?: number;
}

/**
 * Enhanced NG Alert Payload with comprehensive error information
 * Following the new structure for MQTT messages
 */
interface NGAlertPayload {
  alertId: string;
  timestamp: string;
  station: {
    id: string;
    name: string;
    line: string;
    area: string;
  };
  product: {
    id: string;
    name: string;
    serialNumber: string;
    model?: string;
    customer?: string;
  };
  error: {
    code: string;
    type: string;
    description: string;
    imageUrl?: string;
  };
  severity: 'low' | 'medium' | 'high' | 'critical';
  machine: {
    id: number;
    name: string;
    code: string;
  };
  ngPoints: Array<{
    pointId: number;
    pointName: string;
    result: string;
    actualValue?: string;
    expectedValue?: string;
    imageUrl?: string;
    referenceImageUrl?: string;
    workstationId?: number;
    normalizedX?: number;
    normalizedY?: number;
    normalizedRadius?: number;
  }>;
  totalNG: number;
  imageUrl?: string;
  inspectionId: number;
  overallResult?: string;
}

interface SummaryPayload {
  type: 'DAILY_SUMMARY' | 'WEEKLY_SUMMARY';
  stationId: number;
  stationName: string;
  period: {
    start: string;
    end: string;
  };
  statistics: {
    totalInspections: number;
    totalNG: number;
    totalNTF: number;
    ngRate: number;
  };
  topNGPoints: Array<{
    pointId: number;
    pointName: string;
    ngCount: number;
    percentage: number;
  }>;
  timestamp: string;
}

/**
 * F3b — Bridge một message AOI (topic + payload thô) sang Sparkplug-B telemetry.
 *
 * Hàm THUẦN-WIRING (tách khỏi handler aedes để test trực tiếp). GIỮ NGUYÊN luồng cũ:
 * caller vẫn gọi publishNormalized riêng. Đây CHỈ thêm nhánh Sparkplug, default OFF.
 *
 * - Chỉ chạy khi UNS_SPARKPLUG_ENABLED==="true" && UNS_SPARKPLUG_AOI_BRIDGE==="true".
 * - JSON.parse an toàn (payload non-JSON → bỏ qua, KHÔNG sập).
 * - Read-direction: chỉ publish telemetry; KHÔNG xử lý/sinh lệnh điều khiển.
 * - Bọc try/catch — KHÔNG chặn luồng cũ, KHÔNG đổi topic gốc.
 */
export function handleAoiPublish(topic: string, payload: Buffer | string | unknown): void {
  if (
    process.env.UNS_SPARKPLUG_ENABLED !== 'true' ||
    process.env.UNS_SPARKPLUG_AOI_BRIDGE !== 'true'
  ) {
    return;
  }
  try {
    let parsedPayload: unknown;
    try {
      const raw = Buffer.isBuffer(payload)
        ? payload.toString()
        : typeof payload === 'string'
          ? payload
          : String(payload);
      parsedPayload = JSON.parse(raw);
    } catch {
      return; // payload non-JSON → không bridge (không sập).
    }
    const mapping = mapAoiTopicToSparkplug(topic, parsedPayload);
    if (!mapping) return;
    publishAoiBridge(mapping.deviceId, mapping.metricDefs, mapping.metrics);
  } catch (error) {
    console.error('[MQTT] AOI→Sparkplug bridge failed:', (error as Error)?.message || error);
  }
}

/**
 * F3b — Thân (đã tách) của handler aedes.on('publish') cho phần mirror/bridge UNS.
 *
 * GIỮ NGUYÊN HÀNH VI: gọi publishNormalized(topic, payload) VÔ ĐIỀU KIỆN (mirror JSON
 * cũ — backward-compat Android/AOI), RỒI gọi handleAoiPublish(topic, payload) (nhánh
 * Sparkplug, no-op khi cờ tắt). Tách ra hàm thuần để regression-guard test được rằng
 * publishNormalized không phụ thuộc cờ Sparkplug và luôn chạy trước nhánh bridge.
 */
export function processAedesPublish(topic: string, payload: Buffer | string | unknown): void {
  // G1 — Mirror message sang UNS broker (ISA-95/Sparkplug). No-op khi flag tắt.
  publishNormalized(topic, payload);

  // F3b — Bridge topic AOI cũ → Sparkplug-B telemetry. No-op khi cờ tắt; KHÔNG
  // đổi topic gốc, KHÔNG chặn luồng cũ (try/catch nội bộ).
  handleAoiPublish(topic, payload);

  // R0-1 (doc 16 §9 Khối 4) — Sensor ingest → machine_sensor_readings.
  // Topic: factory/{factoryId}/{machineCode}/sensor/{sensorType}. No-op khi cờ
  // PDM_SENSOR_INGEST_ENABLED tắt hoặc topic không khớp. Fire-and-forget: lỗi
  // nội bộ tự nuốt (handleSensorMessage không bao giờ throw), KHÔNG chặn broker.
  void import('./sensorIngestService')
    .then(({ handleSensorMessage }) => handleSensorMessage(topic, payload))
    .catch((err) => console.error('[MQTT] sensor ingest failed:', (err as Error)?.message || err));
}

/**
 * Doc 27 W2-C (R12) — per-device MQTT password verification, HASH AT REST.
 *
 * Verification order:
 *   1. `passwordHash` set → bcrypt.compare (the at-rest credential).
 *   2. else legacy plaintext `password` set → constant-time compare; on match
 *      return `upgradeHash` so the caller persists { passwordHash, password: null }
 *      — transparent upgrade-in-place on the device's next successful connect.
 *   3. neither set → not enforced ({ ok: true }); enabling MQTT_REQUIRE_PASSWORD
 *      never locks out devices that have no password configured (existing rule).
 *
 * NOTE: before migration 0178 the mqtt_clients table had NO password column at
 * all — the old `mqttClient.password` check could never enforce. 0178 adds both
 * columns; this function makes the feature real.
 */
export async function verifyMqttDevicePassword(
  client: { password?: string | null; passwordHash?: string | null },
  supplied: string,
): Promise<{ ok: boolean; upgradeHash?: string }> {
  const bcrypt = (await import('bcryptjs')).default;
  if (client.passwordHash) {
    const ok = await bcrypt.compare(supplied, client.passwordHash).catch(() => false);
    return { ok };
  }
  if (client.password) {
    const a = Buffer.from(String(client.password), 'utf8');
    const b = Buffer.from(supplied, 'utf8');
    const match = a.length === b.length && timingSafeEqual(a, b);
    if (!match) return { ok: false };
    const upgradeHash = await bcrypt.hash(supplied, 10);
    return { ok: true, upgradeHash };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// Doc 27 W2-C (C5 — AOI bridge reliability): bounded in-memory RETRY BUFFER for
// inbound MQTT handlers that write the DB (DEVICE_INFO update, CONFIGURE_ACK
// log). Before this, a DB hiccup dropped the write with only a console.error.
// Inspection results do NOT flow inbound over MQTT (inbound = DEVICE_INFO +
// CONFIGURE_ACK only) — the heavy disk-WAL durability lives on the HTTP ingest
// path (services/inspection/inspectionStoreForward). This lighter buffer covers
// the low-stakes metadata writes: retries every 30s with attempt/age/size
// bounds, drops are counted + warned (never silent).
// ════════════════════════════════════════════════════════════════════════════
interface InboundDbRetryEntry {
  label: string;
  attempts: number;
  enqueuedAt: number;
  run: () => Promise<void>;
}

const inboundDbRetryQueue: InboundDbRetryEntry[] = [];
const INBOUND_RETRY_MAX_ENTRIES = 1000;
const INBOUND_RETRY_MAX_ATTEMPTS = 10;
const INBOUND_RETRY_MAX_AGE_MS = 60 * 60 * 1000; // 1h
const INBOUND_RETRY_FLUSH_MS = 30_000;
let inboundDbRetryTimer: NodeJS.Timeout | null = null;
let inboundDbRetryDropped = 0;

function queueInboundDbRetry(label: string, run: () => Promise<void>): void {
  inboundDbRetryQueue.push({ label, attempts: 0, enqueuedAt: Date.now(), run });
  while (inboundDbRetryQueue.length > INBOUND_RETRY_MAX_ENTRIES) {
    inboundDbRetryQueue.shift();
    inboundDbRetryDropped += 1;
  }
  if (inboundDbRetryDropped > 0 && inboundDbRetryQueue.length === INBOUND_RETRY_MAX_ENTRIES) {
    console.warn(`[MQTT] inbound DB-retry buffer full — dropped ${inboundDbRetryDropped} oldest write(s) so far`);
  }
  console.warn(`[MQTT] DB write failed for ${label} — queued for retry (queue=${inboundDbRetryQueue.length})`);
  if (!inboundDbRetryTimer) {
    inboundDbRetryTimer = setInterval(() => void flushInboundDbRetryQueue(), INBOUND_RETRY_FLUSH_MS);
    inboundDbRetryTimer.unref?.();
  }
}

async function flushInboundDbRetryQueue(): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < inboundDbRetryQueue.length; ) {
    const entry = inboundDbRetryQueue[i];
    if (now - entry.enqueuedAt > INBOUND_RETRY_MAX_AGE_MS || entry.attempts >= INBOUND_RETRY_MAX_ATTEMPTS) {
      inboundDbRetryQueue.splice(i, 1);
      inboundDbRetryDropped += 1;
      console.warn(`[MQTT] gave up retrying inbound DB write ${entry.label} (attempts=${entry.attempts})`);
      continue;
    }
    try {
      await entry.run();
      inboundDbRetryQueue.splice(i, 1);
      console.log(`[MQTT] retried inbound DB write ${entry.label} OK (queue=${inboundDbRetryQueue.length})`);
    } catch {
      entry.attempts += 1;
      i += 1; // still failing — leave queued, move on
    }
  }
  if (inboundDbRetryQueue.length === 0 && inboundDbRetryTimer) {
    clearInterval(inboundDbRetryTimer);
    inboundDbRetryTimer = null;
  }
}

/** Observability snapshot for the inbound retry buffer (health/status use). */
export function getInboundDbRetryStatus(): { queued: number; dropped: number } {
  return { queued: inboundDbRetryQueue.length, dropped: inboundDbRetryDropped };
}

/** Test helper — clears the inbound retry buffer + timer. */
export function _resetInboundDbRetry(): void {
  inboundDbRetryQueue.length = 0;
  inboundDbRetryDropped = 0;
  if (inboundDbRetryTimer) {
    clearInterval(inboundDbRetryTimer);
    inboundDbRetryTimer = null;
  }
}

/** Test helper — runs one retry flush pass immediately. */
export async function _flushInboundDbRetryOnce(): Promise<void> {
  await flushInboundDbRetryQueue();
}

// MQTT Broker instance (local)
let aedes: Aedes | null = null;
let mqttServer: ReturnType<typeof createServer> | null = null;
let mqttWsServer: ReturnType<typeof createServer> | null = null;
let mqttTlsServer: ReturnType<typeof createServer> | null = null;
let db: any = null;
let mqttHandlersInitialized = false;
let mqttPortConflictDetected = false;

// External MQTT client (for cloud broker)
let externalMqttClient: MqttClient | null = null;
let staleClientTimer: NodeJS.Timeout | null = null;

// Configuration
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883');
const MQTT_WS_PORT = parseInt(process.env.MQTT_WS_PORT || '8883');
const MQTT_ENABLED = process.env.MQTT_ENABLED === 'true';

// Phase 1 WS1.3 — Broker hardening (all opt-in, backward-compatible).
// TLS (MQTTS): additive listener on MQTT_TLS_PORT when MQTT_TLS_ENABLED=true and
// cert/key paths are provided; existing plaintext listeners are unchanged.
const MQTT_TLS_ENABLED = process.env.MQTT_TLS_ENABLED === 'true';
const MQTT_TLS_PORT = parseInt(process.env.MQTT_TLS_PORT || '8884');
const MQTT_TLS_CERT = process.env.MQTT_TLS_CERT || '';
const MQTT_TLS_KEY = process.env.MQTT_TLS_KEY || '';
// Per-device password enforcement: when true, a client whose DB record has a
// password set must present a matching MQTT password. Devices with no stored
// password keep working (so enabling this never locks out existing devices).
const MQTT_REQUIRE_PASSWORD = process.env.MQTT_REQUIRE_PASSWORD === 'true';

// External MQTT broker configuration (HiveMQ Public or custom)
const EXTERNAL_MQTT_ENABLED = process.env.EXTERNAL_MQTT_ENABLED === 'true';
const EXTERNAL_MQTT_BROKER = process.env.EXTERNAL_MQTT_BROKER || 'mqtt://broker.hivemq.com';
const EXTERNAL_MQTT_PORT = parseInt(process.env.EXTERNAL_MQTT_PORT || '1883');
const EXTERNAL_MQTT_USERNAME = process.env.EXTERNAL_MQTT_USERNAME || '';
const EXTERNAL_MQTT_PASSWORD = process.env.EXTERNAL_MQTT_PASSWORD || '';
const EXTERNAL_MQTT_TOPIC_PREFIX = process.env.EXTERNAL_MQTT_TOPIC_PREFIX || 'avi-aoi';
const EXTERNAL_MQTT_USE_TLS = process.env.EXTERNAL_MQTT_USE_TLS === 'true' || 
  EXTERNAL_MQTT_BROKER.startsWith('mqtts://') || 
  EXTERNAL_MQTT_BROKER.startsWith('wss://');

function disableLocalBrokerDueToPortConflict(label: string, port: number) {
  if (mqttPortConflictDetected) {
    return;
  }
  mqttPortConflictDetected = true;

  console.error(
    `[MQTT] ${label} port ${port} is already in use. ` +
      'The local MQTT broker will be disabled until the conflict is resolved.'
  );

  shutdownMqttBroker()
    .then(() => {
      console.warn(
        '[MQTT] Local MQTT broker disabled due to port conflict. ' +
          'Update MQTT_PORT/MQTT_WS_PORT or stop the conflicting service to re-enable it.'
      );
    })
    .catch((error) => {
      console.error('[MQTT] Failed to shutdown broker after port conflict:', error);
    });
}

function attachServerErrorHandler(
  server: ReturnType<typeof createServer>,
  label: string,
  port: number
) {
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error?.code === 'EADDRINUSE') {
      disableLocalBrokerDueToPortConflict(label, port);
    } else {
      console.error(`[MQTT] ${label} server error:`, error?.message || error);
      server.close();
    }
  });
}

/**
 * Initialize MQTT broker
 */
export function initMqttBroker() {
  if (!MQTT_ENABLED) {
    console.log('[MQTT] MQTT is disabled. Set MQTT_ENABLED=true to enable.');
    return;
  }

  // Get db instance
  import('../db').then(async module => {
    db = await module.getDb();

    // Initialize MQTT event handlers once both broker and DB are ready
    if (aedes && !mqttHandlersInitialized) {
      setupEventHandlers();
      mqttHandlersInitialized = true;
      console.log('[MQTT] Event handlers initialized (DB ready)');
    }
  });
  
  // Create Aedes broker
  aedes = new Aedes();

  // Create TCP server (MQTT over TCP) listening on 0.0.0.0:MQTT_PORT
  mqttServer = createServer(aedes);
  attachServerErrorHandler(mqttServer, 'TCP broker', MQTT_PORT);
  mqttServer.listen(MQTT_PORT, '0.0.0.0', () => {
    console.log(`[MQTT] TCP broker started on 0.0.0.0:${MQTT_PORT}`);
  });

  // Create WebSocket server (MQTT over WebSocket) on 0.0.0.0:MQTT_WS_PORT
  // This allows web clients to connect via ws://host:MQTT_WS_PORT
  mqttWsServer = createServer(aedes, { ws: true });
  attachServerErrorHandler(mqttWsServer, 'WebSocket broker', MQTT_WS_PORT);
  mqttWsServer.listen(MQTT_WS_PORT, '0.0.0.0', () => {
    console.log(`[MQTT] WebSocket broker started on 0.0.0.0:${MQTT_WS_PORT}`);
  });

  // Phase 1 WS1.3 — Optional MQTTS (TLS) listener. Additive: existing plaintext
  // listeners are untouched. Requires MQTT_TLS_CERT + MQTT_TLS_KEY (PEM files).
  if (MQTT_TLS_ENABLED) {
    if (!MQTT_TLS_CERT || !MQTT_TLS_KEY) {
      console.error('[MQTT] MQTT_TLS_ENABLED but MQTT_TLS_CERT/MQTT_TLS_KEY not set — skipping TLS listener.');
    } else {
      try {
        const tlsOpts = { key: readFileSync(MQTT_TLS_KEY), cert: readFileSync(MQTT_TLS_CERT) };
        mqttTlsServer = createServer(aedes, { tls: tlsOpts });
        attachServerErrorHandler(mqttTlsServer, 'TLS broker', MQTT_TLS_PORT);
        mqttTlsServer.listen(MQTT_TLS_PORT, '0.0.0.0', () => {
          console.log(`[MQTT] TLS (MQTTS) broker started on 0.0.0.0:${MQTT_TLS_PORT}`);
        });
      } catch (err) {
        console.error('[MQTT] Failed to start TLS listener:', (err as Error)?.message ?? err);
      }
    }
  }

  // If DB was initialized earlier (e.g. in tests), attach handlers now
  if (db && !mqttHandlersInitialized) {
    setupEventHandlers();
    mqttHandlersInitialized = true;
    console.log('[MQTT] Event handlers initialized');
  }

  // Initialize external MQTT client if enabled
  initExternalMqttClient();

  // G1 — Initialize UNS publisher (normalize -> EMQX). No-op when UNS_BRIDGE_ENABLED=false.
  initUnsPublisher();

  // Start stale client detection
  startStaleClientChecker();
}

/**
 * Initialize external MQTT client for cloud broker
 */
function initExternalMqttClient() {
  if (!EXTERNAL_MQTT_ENABLED) {
    console.log('[MQTT External] External MQTT is disabled. Set EXTERNAL_MQTT_ENABLED=true to enable.');
    return;
  }

  // Build broker URL robustly: allow EXTERNAL_MQTT_BROKER to include or omit port
  let brokerUrl = EXTERNAL_MQTT_BROKER;
  try {
    const url = new URL(EXTERNAL_MQTT_BROKER);
    if (!url.port) {
      url.port = EXTERNAL_MQTT_PORT.toString();
    }
    brokerUrl = url.toString();
  } catch {
    // Fallback for non-standard URLs: append port if not already present
    if (!EXTERNAL_MQTT_BROKER.match(/:\d+$/)) {
      brokerUrl = `${EXTERNAL_MQTT_BROKER}:${EXTERNAL_MQTT_PORT}`;
    }
  }
  console.log(`[MQTT External] Connecting to ${brokerUrl}...`);

  const options: mqtt.IClientOptions = {
    clientId: `avi-aoi-server-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
  };

  if (EXTERNAL_MQTT_USERNAME) {
    options.username = EXTERNAL_MQTT_USERNAME;
    options.password = EXTERNAL_MQTT_PASSWORD;
  }

  externalMqttClient = mqtt.connect(brokerUrl, options);

  externalMqttClient.on('connect', () => {
    console.log(`[MQTT External] Connected to ${brokerUrl}`);
  });

  externalMqttClient.on('error', (error) => {
    console.error('[MQTT External] Connection error:', error.message);
  });

  externalMqttClient.on('close', () => {
    console.log('[MQTT External] Connection closed');
  });

  externalMqttClient.on('reconnect', () => {
    console.log('[MQTT External] Reconnecting...');
  });
}

/**
 * Setup MQTT event handlers
 */
function setupEventHandlers() {
  if (!aedes || !db) {
    console.warn('[MQTT] Cannot setup event handlers yet (broker or DB not ready)');
    return;
  }

  // Client authentication
  aedes.authenticate = async (client, username, password, callback) => {
    try {
      // Extract device info from username (format: deviceId:deviceName:deviceModel)
      const [deviceId, deviceName, deviceModel] = (username?.toString() || '').split(':');
      
      if (!deviceId) {
        callback({ returnCode: 4 } as any, false);
        return;
      }

      // Check if client exists in database
      const existingClient = await db!.select()
        .from(schema.mqttClients)
        .where(eq(schema.mqttClients.deviceId, deviceId))
        .limit(1);

      if (existingClient.length > 0) {
        const mqttClient = existingClient[0];

        // Phase 1 WS1.3 + doc 27 W2-C (R12) — per-device password enforcement
        // (opt-in), HASH AT REST. Only enforced when this device has a
        // credential configured, so enabling the flag never locks out existing
        // password-less devices. Legacy plaintext values are transparently
        // upgraded to a bcrypt hash on the first successful connect.
        if (MQTT_REQUIRE_PASSWORD && (mqttClient.passwordHash || mqttClient.password)) {
          const supplied = password?.toString() ?? '';
          const verdict = await verifyMqttDevicePassword(mqttClient, supplied);
          if (!verdict.ok) {
            console.warn(`[MQTT] Auth rejected (bad password) for device ${deviceId}`);
            callback({ returnCode: 4 } as any, false);
            return;
          }
          if (verdict.upgradeHash) {
            try {
              await db!.update(schema.mqttClients)
                .set({ passwordHash: verdict.upgradeHash, password: null })
                .where(eq(schema.mqttClients.id, mqttClient.id));
              console.log(`[MQTT] Upgraded device ${deviceId} password to hash-at-rest`);
            } catch (upErr) {
              // Non-fatal: plaintext stays until the next successful connect retries.
              console.warn(`[MQTT] Password hash upgrade failed for ${deviceId}:`, (upErr as Error)?.message || upErr);
            }
          }
        }

        // Check if approved
        if (mqttClient.approvalStatus === 'REJECTED' && mqttClient.isActive) {
          callback({ returnCode: 5 } as any, false);
          return;
        }

        // Re-activate soft-deleted client as PENDING so it reappears in the UI
        const reactivateFields: Record<string, any> = {
          clientId: client.id,
          deviceName: deviceName || mqttClient.deviceName,
          deviceModel: deviceModel || mqttClient.deviceModel,
          connectionStatus: 'ONLINE',
          lastConnectedAt: new Date(),
          lastHeartbeat: new Date(),
        };
        if (!mqttClient.isActive) {
          reactivateFields.isActive = true;
          reactivateFields.approvalStatus = 'PENDING';
        }

        // Update client info
        await db!.update(schema.mqttClients)
          .set(reactivateFields)
          .where(eq(schema.mqttClients.id, mqttClient.id));

        console.log(`[MQTT] Client reconnected${!mqttClient.isActive ? ' (re-activated)' : ''}: ${client.id} (${deviceId})`);
        callback(null, true);
      } else {
        // New client - create pending registration
        await db!.insert(schema.mqttClients).values({
          clientId: client.id,
          deviceId,
          deviceName: deviceName || `Device-${deviceId.substring(0, 8)}`,
          deviceModel: deviceModel || 'Unknown',
          approvalStatus: 'PENDING',
          mappingType: 'AUTO',
          connectionStatus: 'ONLINE',
          lastConnectedAt: new Date(),
          lastHeartbeat: new Date(),
          isActive: true,
        });

        console.log(`[MQTT] New client registered (pending approval): ${client.id} (${deviceId})`);
        callback(null, true);
      }
    } catch (error) {
      console.error('[MQTT] Authentication error:', error);
      callback({ returnCode: 4 } as any, false);
    }
  };

  // R-2a (doc 38 P1-I) — coalesce the per-keepalive heartbeat write. A client PING
  // fires every keepalive interval and each historically did one UPDATE of
  // mqttClients.lastHeartbeat. When MQTT_HEARTBEAT_THROTTLE_MS > 0 (default 0 = OFF,
  // i.e. the prior write-every-ping behaviour) we skip the write if the last one for
  // this client was within the window — collapsing a ping storm to at most one write
  // per window while keeping heartbeat resolution bounded by the configured value.
  const lastHeartbeatWriteAt = new Map<string, number>();
  const heartbeatThrottleMs = (): number => {
    const n = parseInt(String(process.env.MQTT_HEARTBEAT_THROTTLE_MS ?? ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // Client-level errors (e.g., protocol violations, write failures)
  aedes.on('clientError', (client, error) => {
    console.error(`[MQTT] Client error for ${client.id}:`, error.message);
  });

  // Connection-level errors (before client is fully established)
  aedes.on('connectionError', (client, error) => {
    console.error(`[MQTT] Connection error for ${client.id}:`, error.message);
  });

  // Client connected
  aedes.on('client', async (client) => {
    console.log(`[MQTT] Client connected: ${client.id}`);
    
    try {
      await db!.update(schema.mqttClients)
        .set({
          connectionStatus: 'ONLINE',
          lastConnectedAt: new Date(),
          lastHeartbeat: new Date(),
        })
        .where(eq(schema.mqttClients.clientId, client.id));
    } catch (error) {
      console.error('[MQTT] Error updating client status:', error);
    }
  });

  // Client disconnected
  aedes.on('clientDisconnect', async (client) => {
    console.log(`[MQTT] Client disconnected: ${client.id}`);
    lastHeartbeatWriteAt.delete(client.id); // R-2a — release throttle bookkeeping

    try {
      await db!.update(schema.mqttClients)
        .set({
          connectionStatus: 'DISCONNECTED',
          lastDisconnectedAt: new Date(),
        })
        .where(eq(schema.mqttClients.clientId, client.id));
    } catch (error) {
      console.error('[MQTT] Error updating client status:', error);
    }
  });

  // Client subscribed
  aedes.on('subscribe', async (subscriptions, client) => {
    console.log(`[MQTT] Client ${client.id} subscribed to:`, subscriptions.map(s => s.topic));
    
    try {
      // Get client from database
      const mqttClient = await db!.select()
        .from(schema.mqttClients)
        .where(eq(schema.mqttClients.clientId, client.id))
        .limit(1);

      if (mqttClient.length > 0) {
        // Save subscriptions
        for (const sub of subscriptions) {
          await db!.insert(schema.mqttSubscriptions).values({
            clientId: mqttClient[0].id,
            topic: sub.topic,
            qos: sub.qos,
          }).onConflictDoUpdate({
            target: [schema.mqttSubscriptions.clientId, schema.mqttSubscriptions.topic],
            set: { isActive: true },
          });
        }
      }
    } catch (error) {
      console.error('[MQTT] Error saving subscriptions:', error);
    }
  });

  // Heartbeat/ping handler
  aedes.on('ping', async (packet, client) => {
    // R-2a — throttle/coalesce the heartbeat write (no-op window when flag is 0).
    const throttle = heartbeatThrottleMs();
    if (throttle > 0 && client) {
      const now = Date.now();
      const last = lastHeartbeatWriteAt.get(client.id) ?? 0;
      if (now - last < throttle) return; // within window → coalesce (skip write)
      lastHeartbeatWriteAt.set(client.id, now);
    }
    try {
      await db!.update(schema.mqttClients)
        .set({ lastHeartbeat: new Date() })
        .where(eq(schema.mqttClients.clientId, client.id));
    } catch (error) {
      console.error('[MQTT] Error updating heartbeat:', error);
    }
  });

  // Handle published messages from clients (DEVICE_INFO, ACK, etc.)
  aedes.on('publish', async (packet, client) => {
    // Ignore system messages (starting with $) and messages without a client
    if (!client || packet.topic.startsWith('$')) return;

    // G1/F3b — Mirror UNS (publishNormalized, vô điều kiện) RỒI bridge AOI→Sparkplug
    // (handleAoiPublish, no-op khi cờ tắt). Tách thành processAedesPublish để test.
    processAedesPublish(packet.topic, packet.payload);

    try {
      // Handle DEVICE_INFO messages: avi/client/{deviceId}/info
      const deviceInfoMatch = packet.topic.match(/^avi\/client\/([^/]+)\/info$/);
      if (deviceInfoMatch) {
        const payload = JSON.parse(packet.payload.toString());
        if (payload.type === 'DEVICE_INFO') {
          const deviceId = deviceInfoMatch[1];
          const updateData: Record<string, any> = {
            updatedAt: new Date(),
          };
          if (payload.brand) updateData.brand = payload.brand;
          if (payload.manufacturer) updateData.manufacturer = payload.manufacturer;
          if (payload.osVersion) updateData.osVersion = payload.osVersion;
          if (payload.appVersion) updateData.appVersion = payload.appVersion;
          if (payload.screenResolution) updateData.screenResolution = payload.screenResolution;
          if (payload.networkType) updateData.networkType = payload.networkType;

          // Prefer app-reported IP (real WiFi IP from device) over TCP connection IP
          if (payload.ipAddress && payload.ipAddress !== 'Unknown') {
            updateData.ipAddress = payload.ipAddress;
          } else {
            // Fallback to TCP connection source (may be NAT/adb reverse address)
            const remoteAddress = (client.conn as any)?.remoteAddress;
            if (remoteAddress) {
              updateData.ipAddress = remoteAddress.replace(/^::ffff:/, '');
            }
          }

          // Update device name from app (real device name instead of hardcoded)
          if (payload.deviceName && payload.deviceName !== 'FactoryAlertApp') {
            updateData.deviceName = payload.deviceName;
          }

          // C5: a DB hiccup must not silently drop the write — queue for retry.
          const writeDeviceInfo = async () => {
            await db!.update(schema.mqttClients)
              .set(updateData)
              .where(eq(schema.mqttClients.deviceId, deviceId));
          };
          try {
            await writeDeviceInfo();
            console.log(`[MQTT] Updated device info for ${deviceId}:`, Object.keys(updateData).join(', '));
          } catch {
            queueInboundDbRetry(`device-info:${deviceId}`, writeDeviceInfo);
          }
        }
        return;
      }

      // Handle CONFIGURE_ACK messages: avi/client/{deviceId}/ack
      const ackMatch = packet.topic.match(/^avi\/client\/([^/]+)\/ack$/);
      if (ackMatch) {
        const payload = JSON.parse(packet.payload.toString());
        if (payload.type === 'CONFIGURE_ACK') {
          console.log(`[MQTT] Configure ACK from ${ackMatch[1]}: command=${payload.commandId} status=${payload.status}`);
          const ackTopic = packet.topic;
          const ackDeviceId = ackMatch[1];
          // C5: a DB hiccup must not silently drop the ACK log — queue for retry.
          const writeAckLog = async () => {
            // Look up client for targetClientId
            const ackClient = await db!.select({ id: schema.mqttClients.id, stationId: schema.mqttClients.stationId })
              .from(schema.mqttClients)
              .where(eq(schema.mqttClients.deviceId, ackDeviceId))
              .limit(1);
            // Log the ACK
            await db!.insert(schema.mqttMessageLogs).values({
              messageType: 'COMMAND',
              topic: ackTopic,
              payload: payload,
              targetClientId: ackClient[0]?.id ?? null,
              stationId: ackClient[0]?.stationId ?? null,
              deliveryStatus: payload.status === 'applied' ? 'DELIVERED' : 'FAILED',
              deliveredAt: new Date(),
              errorMessage: payload.error || null,
            });
          };
          try {
            await writeAckLog();
          } catch {
            queueInboundDbRetry(`configure-ack:${ackDeviceId}`, writeAckLog);
          }
        }
        return;
      }
    } catch (error) {
      console.error('[MQTT] Error handling published message:', error);
    }
  });
}

/**
 * Send a CONFIGURE command to a specific device via MQTT
 */
export async function sendConfigureCommand(deviceId: string, command: {
  stationId?: number;
  processId?: number;
  topics?: string[];
  settings?: Record<string, any>;
}): Promise<{ success: boolean; commandId: string }> {
  if (!aedes || !db) {
    throw new Error('MQTT broker not initialized');
  }

  const commandId = `cfg-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const topic = `avi/client/${deviceId}/configure`;
  const payload = {
    type: 'CONFIGURE',
    commandId,
    ...command,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const packet = {
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 1 as const,
      retain: false,
    };

    aedes!.publish(packet as any, (err) => {
      if (err) {
        console.error(`[MQTT] Error sending configure to ${deviceId}:`, err);
        reject(err);
        return;
      }

      console.log(`[MQTT] Sent CONFIGURE to ${deviceId}: ${commandId}`);

      // Look up client for targetClientId
      db!.select({ id: schema.mqttClients.id, stationId: schema.mqttClients.stationId })
        .from(schema.mqttClients)
        .where(eq(schema.mqttClients.deviceId, deviceId))
        .limit(1)
        .then((clients: any) => {
          return db!.insert(schema.mqttMessageLogs).values({
            messageType: 'COMMAND',
            topic,
            payload,
            targetClientId: clients[0]?.id ?? null,
            stationId: clients[0]?.stationId ?? null,
            deliveryStatus: 'SENT',
          });
        })
        .catch((logErr: any) => console.error('[MQTT] Error logging command:', logErr));

      resolve({ success: true, commandId });
    });
  });
}

/**
 * Send a SOFTWARE_UPDATE command to a specific device via MQTT
 * Separate from CONFIGURE — dedicated message type for update operations
 */
export async function sendSoftwareUpdateCommand(deviceId: string, command: 'CHECK_UPDATE' | 'FORCE_UPDATE', data?: Record<string, any>): Promise<{ success: boolean; commandId: string }> {
  if (!aedes || !db) {
    throw new Error('MQTT broker not initialized');
  }

  const commandId = `upd-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const topic = `avi/client/${deviceId}/configure`;
  const payload = {
    type: 'SOFTWARE_UPDATE',
    commandId,
    command,
    ...(data || {}),
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const packet = {
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 1 as const,
      retain: false,
    };

    aedes!.publish(packet as any, (err) => {
      if (err) {
        console.error(`[MQTT] Error sending SOFTWARE_UPDATE to ${deviceId}:`, err);
        reject(err);
        return;
      }

      console.log(`[MQTT] Sent SOFTWARE_UPDATE (${command}) to ${deviceId}: ${commandId}`);

      // Look up client for targetClientId
      db!.select({ id: schema.mqttClients.id, stationId: schema.mqttClients.stationId })
        .from(schema.mqttClients)
        .where(eq(schema.mqttClients.deviceId, deviceId))
        .limit(1)
        .then((clients: any) => {
          return db!.insert(schema.mqttMessageLogs).values({
            messageType: 'COMMAND',
            topic,
            payload,
            targetClientId: clients[0]?.id ?? null,
            stationId: clients[0]?.stationId ?? null,
            deliveryStatus: 'SENT',
          });
        })
        .catch((logErr: any) => console.error('[MQTT] Error logging command:', logErr));

      resolve({ success: true, commandId });
    });
  });
}

/**
 * Publish a FACTORY_ALERT_UPDATE broadcast to all FactoryAlertSystem devices
 * Topic: avi/factory-alert/update
 */
export async function publishFactoryAlertUpdate(versionInfo: Record<string, any>): Promise<{ success: boolean }> {
  if (!aedes) {
    throw new Error('MQTT broker not initialized');
  }

  const topic = 'avi/factory-alert/update';
  const payload = {
    type: 'FACTORY_ALERT_UPDATE',
    ...versionInfo,
    timestamp: new Date().toISOString(),
  };

  return new Promise((resolve, reject) => {
    const packet = {
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: 1 as const,
      retain: false,
    };

    aedes!.publish(packet as any, (err) => {
      if (err) {
        console.error(`[MQTT] Error publishing factory alert update:`, err);
        reject(err);
        return;
      }

      console.log(`[MQTT] Published FACTORY_ALERT_UPDATE to ${topic}`);

      if (db) {
        db.insert(schema.mqttMessageLogs).values({
          messageType: 'COMMAND',
          topic,
          payload,
          deliveryStatus: 'SENT',
        }).catch((logErr: any) => console.error('[MQTT] Error logging update broadcast:', logErr));
      }

      resolve({ success: true });
    });
  });
}

/**
 * Generic publish on the LOCAL Aedes broker (the broker FactoryAlertSystem devices
 * connect to). Used by the escalation sweep (doc 27 MB6) to push ALERT_ESCALATION
 * notices to mobile clients. Returns false (never throws) when the broker is down
 * so schedulers can degrade gracefully.
 */
export async function publishLocalMqtt(
  topic: string,
  payload: Record<string, any>,
  options?: { retain?: boolean; qos?: 0 | 1 | 2 },
): Promise<boolean> {
  if (!aedes) {
    console.warn('[MQTT] publishLocalMqtt skipped — broker not initialized');
    return false;
  }
  return new Promise((resolve) => {
    const packet = {
      topic,
      payload: Buffer.from(JSON.stringify(payload)),
      qos: (options?.qos ?? 1) as 0 | 1 | 2,
      retain: options?.retain ?? false,
    };
    aedes!.publish(packet as any, (err) => {
      if (err) {
        console.error(`[MQTT] publishLocalMqtt error on ${topic}:`, err);
        resolve(false);
        return;
      }
      resolve(true);
    });
  });
}

export async function publishNGAlert(data: {
  machineId: number;
  machineName: string;
  machineCode: string;
  serialNumber: string;
  stationId: number;
  factoryName?: string;
  workshopName?: string;
  lineName?: string;
  stationName?: string;
  inspectionId: number;
  timestamp: Date;
  // Enhanced product info
  productModelId?: number;
  productModelName?: string;
  productModelCode?: string;
  customer?: string;
  // Enhanced measurement results with image URLs
  measurementResults: Array<{ 
    pointId?: number;
    pointCode: string; 
    result: string; 
    value?: string | number | null;
    expectedValue?: string | number | null;
    imageUrl?: string;
    referenceImageUrl?: string;
    workstationId?: number;
    normalizedX?: number;
    normalizedY?: number;
    normalizedRadius?: number;
  }>;
  // Main error image URL
  errorImageUrl?: string;
  // Overall inspection result
  overallResult?: string;
  // Severity level
  severity?: 'low' | 'medium' | 'high' | 'critical';
}): Promise<boolean> {
  const { stationId } = data;
  if (!aedes || !db) {
    console.log('[MQTT] Broker not initialized');
    return false;
  }

  try {
    // Check per-station NG alert settings
    const alertSettings = await db.select()
      .from(schema.mqttNgAlertSettings)
      .where(eq(schema.mqttNgAlertSettings.stationId, stationId))
      .limit(1);

    const ngAlertConfig = alertSettings.length > 0 ? alertSettings[0] : null;

    // Determine if FCM and cooldown update should fire (respects enabled + cooldown)
    // MQTT messages are ALWAYS published for every NG to ensure real-time delivery
    let shouldSendFcmAlert = true;
    if (ngAlertConfig && !ngAlertConfig.enabled) {
      console.log(`[MQTT] NG alert config disabled for station ${stationId}, FCM skipped but MQTT will still publish`);
      shouldSendFcmAlert = false;
    }

    // Cooldown only affects FCM push notifications, not MQTT publishing
    if (shouldSendFcmAlert && ngAlertConfig && ngAlertConfig.cooldownSeconds > 0 && ngAlertConfig.lastTriggeredAt) {
      const elapsed = (Date.now() - ngAlertConfig.lastTriggeredAt.getTime()) / 1000;
      if (elapsed < ngAlertConfig.cooldownSeconds) {
        console.log(`[MQTT] FCM cooldown for station ${stationId}: ${Math.ceil(ngAlertConfig.cooldownSeconds - elapsed)}s remaining, MQTT will still publish`);
        shouldSendFcmAlert = false;
      }
    }

    // Get station info to build topic
    const station = await db.select({
      station: schema.stations,
      line: schema.productionLines,
      workshop: schema.workshops,
      factory: schema.factories,
    })
    .from(schema.stations)
    .innerJoin(schema.productionLines, eq(schema.stations.lineId, schema.productionLines.id))
    .innerJoin(schema.workshops, eq(schema.productionLines.workshopId, schema.workshops.id))
    .innerJoin(schema.factories, eq(schema.workshops.factoryId, schema.factories.id))
    .where(eq(schema.stations.id, stationId))
    .limit(1);

    if (station.length === 0) {
      console.log('[MQTT] Station not found:', stationId);
      return false;
    }

    const { factory, workshop, line } = station[0];
    
    // Build topic from config pattern or use default
    const topicPattern = ngAlertConfig?.topicPattern || 'avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors';
    const topic = topicPattern
      .replace('{factoryId}', String(factory.id))
      .replace('{workshopId}', String(workshop.id))
      .replace('{stationId}', String(stationId));

    // Generate unique alert ID
    const alertId = `ALT-${new Date().getFullYear()}-${String(data.inspectionId).padStart(6, '0')}`;
    
    // Determine severity based on NG count
    const ngCount = data.measurementResults.filter(m => m.result === 'NG').length;
    const severity = data.severity || (ngCount >= 5 ? 'critical' : ngCount >= 3 ? 'high' : ngCount >= 2 ? 'medium' : 'low');
    
    // Get first NG point with image for main error image
    const firstNGWithImage = data.measurementResults.find(m => m.result === 'NG' && m.imageUrl);
    const mainImageUrl = data.errorImageUrl || firstNGWithImage?.imageUrl;
    
    // Build primary error description
    const primaryNG = data.measurementResults.find(m => m.result === 'NG');
    const errorDescription = primaryNG 
      ? `${primaryNG.pointCode} - Result: ${primaryNG.result}${primaryNG.value ? `, Value: ${primaryNG.value}` : ''}${primaryNG.expectedValue ? `, Expected: ${primaryNG.expectedValue}` : ''}`
      : `${ngCount} NG point(s) detected`;

    // Build enhanced payload following new structure
    const payload: NGAlertPayload = {
      alertId,
      timestamp: data.timestamp.toISOString(),
      station: {
        id: String(stationId),
        name: data.stationName || station[0].station.name,
        line: data.lineName || line.name,
        area: data.workshopName || workshop.name,
      },
      product: {
        id: data.productModelCode || data.serialNumber,
        name: data.productModelName || 'Unknown Product',
        serialNumber: data.serialNumber,
        model: data.productModelCode,
        customer: data.customer,
      },
      error: {
        code: primaryNG?.pointCode || `NG-${data.inspectionId}`,
        type: 'Inspection Error',
        description: errorDescription,
        imageUrl: mainImageUrl,
      },
      severity,
      machine: {
        id: data.machineId,
        name: data.machineName,
        code: data.machineCode,
      },
      ngPoints: data.measurementResults.filter(m => m.result === 'NG').map((m, i) => ({
        pointId: m.pointId ?? i,
        pointName: m.pointCode,
        result: m.result,
        actualValue: m.value?.toString(),
        expectedValue: m.expectedValue?.toString(),
        imageUrl: (ngAlertConfig?.includePointImages !== false) ? m.imageUrl : undefined,
        referenceImageUrl: (ngAlertConfig?.includeReferenceImages !== false) ? m.referenceImageUrl : undefined,
        workstationId: m.workstationId,
        normalizedX: m.normalizedX,
        normalizedY: m.normalizedY,
        normalizedRadius: m.normalizedRadius,
      })),
      totalNG: ngCount,
      imageUrl: (ngAlertConfig?.includeImages !== false) ? mainImageUrl : undefined,
      inspectionId: data.inspectionId,
      ...(ngAlertConfig?.includeOverallResult !== false && data.overallResult ? { overallResult: data.overallResult } : {}),
    };

    // Strip error imageUrl if includeImages is disabled
    if (ngAlertConfig?.includeImages === false) {
      payload.error.imageUrl = undefined;
    }

    // ALWAYS publish to local MQTT broker for real-time error delivery
    // retain: true ensures reconnected clients receive the last NG alert
    // (prevents message loss during brief reconnect windows)
    {
      const message = JSON.stringify(payload);
      const retainFlag = ngAlertConfig?.retain ?? true;
      aedes.publish({
        topic,
        payload: Buffer.from(message),
        qos: (ngAlertConfig?.qos ?? 1) as 0 | 1 | 2,
        retain: retainFlag,
        cmd: 'publish',
        dup: false,
      }, (error) => {
        if (error) {
          console.error('[MQTT] Publish error:', error);
        }
      });
      console.log(`[MQTT] Published NG alert to ${topic} (retain=${retainFlag})`);
    }

    // Log message
    const message = JSON.stringify(payload);
    await db.insert(schema.mqttMessageLogs).values({
      messageType: 'NG_ALERT',
      topic,
      payload: payload as any,
      stationId,
      inspectionId: payload.inspectionId,
      deliveryStatus: 'DELIVERED',
      deliveredAt: new Date(),
    });

    // ALWAYS publish to external MQTT broker for real-time error delivery
    if (externalMqttClient && externalMqttClient.connected) {
      const externalTopicPattern = ngAlertConfig?.externalTopicPattern || `${EXTERNAL_MQTT_TOPIC_PREFIX}/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors`;
      const externalTopic = externalTopicPattern
        .replace('{factoryId}', String(factory.id))
        .replace('{workshopId}', String(workshop.id))
        .replace('{stationId}', String(stationId));
      externalMqttClient.publish(externalTopic, message, { qos: (ngAlertConfig?.qos ?? 1) as 0 | 1 | 2 }, (error) => {
        if (error) {
          console.error('[MQTT External] Publish error:', error);
        } else {
          console.log(`[MQTT External] Published NG alert to ${externalTopic}`);
        }
      });
    }

    // Send FCM push notification only if enabled + not in cooldown
    const shouldSendFcm = shouldSendFcmAlert && (ngAlertConfig ? ngAlertConfig.sendFcm : true);
    if (shouldSendFcm) {
      try {
        const { sendNGAlertPushNotification } = await import('./fcmService');
        const fcmResult = await sendNGAlertPushNotification({
          stationId,
          stationName: data.stationName || station[0].station.name,
          machineId: data.machineId,
          machineName: data.machineName,
          productCode: data.serialNumber,
          ngCount: data.measurementResults.filter(r => r.result === 'NG').length,
          measurementResults: data.measurementResults.map(m => ({
            pointName: m.pointCode,
            result: m.result,
            measuredValue: typeof m.value === 'number' ? m.value : undefined,
          })),
          inspectionId: data.inspectionId,
        });
        console.log(`[FCM] Push notification sent: ${fcmResult.sent} success, ${fcmResult.failed} failed`);
      } catch (fcmError) {
        console.error('[FCM] Error sending push notification:', fcmError);
      }
    }

    // Update lastTriggeredAt only when FCM was eligible (for cooldown tracking)
    if (ngAlertConfig && shouldSendFcmAlert) {
      await db.update(schema.mqttNgAlertSettings)
        .set({ lastTriggeredAt: new Date() })
        .where(eq(schema.mqttNgAlertSettings.stationId, stationId));
    }

    return true;
  } catch (error) {
    console.error('[MQTT] Error publishing NG alert:', error);
    return false;
  }
}

/**
 * Publish summary to relevant clients
 */
export async function publishSummary(
  stationId: number,
  summaryType: 'DAILY' | 'WEEKLY',
  payload: SummaryPayload
): Promise<boolean> {
  if (!aedes || !db) {
    console.log('[MQTT] Broker not initialized');
    return false;
  }

  try {
    // Get station info to build topic
    const station = await db.select({
      station: schema.stations,
      line: schema.productionLines,
      workshop: schema.workshops,
      factory: schema.factories,
    })
    .from(schema.stations)
    .innerJoin(schema.productionLines, eq(schema.stations.lineId, schema.productionLines.id))
    .innerJoin(schema.workshops, eq(schema.productionLines.workshopId, schema.workshops.id))
    .innerJoin(schema.factories, eq(schema.workshops.factoryId, schema.factories.id))
    .where(eq(schema.stations.id, stationId))
    .limit(1);

    if (station.length === 0) {
      console.log('[MQTT] Station not found:', stationId);
      return false;
    }

    const { factory, workshop } = station[0];
    const summaryPath = summaryType === 'DAILY' ? 'daily' : 'weekly';
    const topic = `avi/factory/${factory.id}/workshop/${workshop.id}/station/${stationId}/summary/${summaryPath}`;

    // Publish message
    const message = JSON.stringify(payload);
    aedes.publish({
      topic,
      payload: Buffer.from(message),
      qos: 1,
      retain: true, // Retain summary messages
      cmd: 'publish',
      dup: false,
    }, (error) => {
      if (error) {
        console.error('[MQTT] Publish error:', error);
      }
    });

    // Log message
    await db.insert(schema.mqttMessageLogs).values({
      messageType: summaryType === 'DAILY' ? 'DAILY_SUMMARY' : 'WEEKLY_SUMMARY',
      topic,
      payload: payload as any,
      stationId,
      deliveryStatus: 'DELIVERED',
      deliveredAt: new Date(),
    });

    console.log(`[MQTT] Published ${summaryType} summary to ${topic}`);

    // Also publish to external MQTT broker if enabled
    if (externalMqttClient && externalMqttClient.connected) {
      const externalTopic = `${EXTERNAL_MQTT_TOPIC_PREFIX}/factory/${factory.id}/workshop/${workshop.id}/station/${stationId}/summary/${summaryPath}`;
      externalMqttClient.publish(externalTopic, message, { qos: 1, retain: true }, (error) => {
        if (error) {
          console.error('[MQTT External] Publish error:', error);
        } else {
          console.log(`[MQTT External] Published ${summaryType} summary to ${externalTopic}`);
        }
      });
    }

    // Send FCM push notification to offline clients
    try {
      const { sendSummaryPushNotification } = await import('./fcmService');
      const fcmResult = await sendSummaryPushNotification({
        type: summaryType,
        stationId,
        stationName: station[0].station.name,
        totalInspections: payload.statistics.totalInspections,
        totalNG: payload.statistics.totalNG,
        ngRate: payload.statistics.ngRate,
        topNGPoints: payload.topNGPoints?.map(p => ({
          pointName: p.pointName,
          count: p.ngCount,
        })) || [],
      });
      console.log(`[FCM] Summary push notification sent: ${fcmResult.sent} success, ${fcmResult.failed} failed`);
    } catch (fcmError) {
      console.error('[FCM] Error sending summary push notification:', fcmError);
    }

    return true;
  } catch (error) {
    console.error('[MQTT] Error publishing summary:', error);
    return false;
  }
}

/**
 * Publish periodic bulletin for a station
 * Topic: avi/factory/{fId}/workshop/{wId}/station/{sId}/bulletin/periodic
 */
export async function publishBulletin(
  stationId: number,
  payload: any,
  options: { sendToExternal?: boolean; sendFcm?: boolean } = {}
): Promise<boolean> {
  if (!aedes || !db) {
    console.log('[MQTT] Broker not initialized');
    return false;
  }

  try {
    // Get station info to build topic
    const station = await db.select({
      station: schema.stations,
      line: schema.productionLines,
      workshop: schema.workshops,
      factory: schema.factories,
    })
    .from(schema.stations)
    .innerJoin(schema.productionLines, eq(schema.stations.lineId, schema.productionLines.id))
    .innerJoin(schema.workshops, eq(schema.productionLines.workshopId, schema.workshops.id))
    .innerJoin(schema.factories, eq(schema.workshops.factoryId, schema.factories.id))
    .where(eq(schema.stations.id, stationId))
    .limit(1);

    if (station.length === 0) {
      console.log('[MQTT] Station not found:', stationId);
      return false;
    }

    const { factory, workshop } = station[0];
    const topic = `avi/factory/${factory.id}/workshop/${workshop.id}/station/${stationId}/bulletin/periodic`;

    // Publish message
    const message = JSON.stringify(payload);
    aedes.publish({
      topic,
      payload: Buffer.from(message),
      qos: 1,
      retain: true, // Retain bulletin messages so new subscribers get latest
      cmd: 'publish',
      dup: false,
    }, (error) => {
      if (error) {
        console.error('[MQTT] Bulletin publish error:', error);
      }
    });

    // Log message
    await db.insert(schema.mqttMessageLogs).values({
      messageType: 'CUSTOM', // Use CUSTOM until enum is updated
      topic,
      payload: payload as any,
      stationId,
      deliveryStatus: 'DELIVERED',
      deliveredAt: new Date(),
    });

    console.log(`[MQTT] Published periodic bulletin to ${topic}`);

    // Also publish to external MQTT broker if enabled
    if (options.sendToExternal && externalMqttClient && externalMqttClient.connected) {
      const externalTopic = `${EXTERNAL_MQTT_TOPIC_PREFIX}/factory/${factory.id}/workshop/${workshop.id}/station/${stationId}/bulletin/periodic`;
      externalMqttClient.publish(externalTopic, message, { qos: 1, retain: true }, (error) => {
        if (error) {
          console.error('[MQTT External] Bulletin publish error:', error);
        } else {
          console.log(`[MQTT External] Published periodic bulletin to ${externalTopic}`);
        }
      });
    }

    // Send FCM push notification to subscribed clients
    if (options.sendFcm) {
      try {
        const { sendBulletinPushNotification } = await import('./fcmService') as any;
        if (typeof sendBulletinPushNotification === 'function') {
          const stats = payload.statistics || {};
          const fcmResult = await sendBulletinPushNotification({
            stationId,
            stationName: payload.stationName || station[0].station.name,
            totalCount: stats.totalCount || 0,
            okCount: stats.okCount || 0,
            ngCount: stats.ngCount || 0,
            ntfCount: stats.ntfCount || 0,
            yieldRate: stats.yieldRate || 0,
            failPointsCount: (payload.failPoints || []).length,
            period: payload.period,
          });
          console.log(`[FCM] Bulletin push notification sent: ${fcmResult.sent} success, ${fcmResult.failed} failed`);
        }
      } catch (fcmError) {
        // FCM is optional - don't fail bulletin if FCM fails
        console.log('[FCM] Bulletin push notification skipped (function not available)');
      }
    }

    return true;
  } catch (error) {
    console.error('[MQTT] Error publishing bulletin:', error);
    return false;
  }
}

/**
 * Send command to specific client
 */
export async function sendClientCommand(
  clientId: number,
  command: string,
  data: any
): Promise<boolean> {
  if (!aedes || !db) {
    console.log('[MQTT] Broker not initialized');
    return false;
  }

  try {
    const client = await db.select()
      .from(schema.mqttClients)
      .where(eq(schema.mqttClients.id, clientId))
      .limit(1);

    if (client.length === 0) {
      console.log('[MQTT] Client not found:', clientId);
      return false;
    }

    const topic = `avi/client/${client[0].clientId}/commands`;
    const payload = JSON.stringify({ command, data, timestamp: new Date().toISOString() });

    aedes.publish({
      topic,
      payload: Buffer.from(payload),
      qos: 2, // Exactly once for commands
      retain: false,
      cmd: 'publish',
      dup: false,
    }, (error) => {
      if (error) {
        console.error('[MQTT] Command publish error:', error);
      }
    });

    console.log(`[MQTT] Sent command to client ${client[0].clientId}: ${command}`);

    // Log message for client history & health dashboard
    try {
      await db.insert(schema.mqttMessageLogs).values({
        messageType: 'CUSTOM',
        topic,
        payload: { command, data },
        targetClientId: client[0].id,
        stationId: client[0].stationId ?? null,
        deliveryStatus: 'DELIVERED',
        deliveredAt: new Date(),
      });
    } catch (logError) {
      console.error('[MQTT] Error logging client command:', logError);
    }

    console.log(`[MQTT] Sent command to client ${client[0].clientId}: ${command}`);
    return true;
  } catch (error) {
    console.error('[MQTT] Error sending command:', error);
    return false;
  }
}

/**
 * Periodically detect and mark stale MQTT clients.
 * Clients with connectionStatus='ONLINE' whose lastHeartbeat is older than
 * STALE_THRESHOLD_MS are marked as 'DISCONNECTED' (silent disconnect on bad WiFi).
 */
const STALE_CHECK_INTERVAL_MS = 3 * 60 * 1000; // Check every 3 minutes
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes without heartbeat = stale

function startStaleClientChecker() {
  if (staleClientTimer) return; // Already running

  staleClientTimer = setInterval(async () => {
    if (!db) return;

    try {
      const threshold = new Date(Date.now() - STALE_THRESHOLD_MS);
      const result = await db.update(schema.mqttClients)
        .set({
          connectionStatus: 'DISCONNECTED',
          lastDisconnectedAt: new Date(),
        })
        .where(
          and(
            eq(schema.mqttClients.connectionStatus, 'ONLINE'),
            lt(schema.mqttClients.lastHeartbeat, threshold)
          )
        );

      // Log only when stale clients are found
      const affected = (result as any)?.[0]?.affectedRows ?? (result as any)?.rowCount ?? 0;
      if (affected > 0) {
        console.log(`[MQTT] Stale client check: marked ${affected} client(s) as DISCONNECTED`);
      }
    } catch (error) {
      console.error('[MQTT] Error in stale client check:', error);
    }
  }, STALE_CHECK_INTERVAL_MS);

  console.log('[MQTT] Stale client checker started (interval: 3min, threshold: 5min)');
}

function stopStaleClientChecker() {
  if (staleClientTimer) {
    clearInterval(staleClientTimer);
    staleClientTimer = null;
    console.log('[MQTT] Stale client checker stopped');
  }
}

/**
 * Get connected clients count
 */
export function getConnectedClientsCount(): number {
  if (!aedes) return 0;
  return aedes.connectedClients;
}

/**
 * Check if MQTT is enabled and running
 */
export function isMqttRunning(): boolean {
  return MQTT_ENABLED && aedes !== null;
}

/**
 * Shutdown MQTT broker
 */
export function shutdownMqttBroker(): Promise<void> {
  stopStaleClientChecker();
  // F3b — graceful NDEATH (+DDEATH cho device đã birthed) TRƯỚC khi đóng publisher.
  // Best-effort, timeout ngắn nội bộ, không throw. No-op khi Sparkplug tắt/chưa connect.
  // (NBIRTH-on-connect đã do F3a tự phát.) Fire-and-forget rồi đóng publisher ngay sau.
  void Promise.resolve(publishNdeathGraceful())
    .catch(() => {})
    // G1 — close UNS publisher connection (no-op if not initialized)
    .finally(() => { void shutdownUnsPublisher(); });
  return new Promise((resolve) => {
    // Phase 1 WS1.3 — close optional TLS listener if running.
    if (mqttTlsServer) {
      mqttTlsServer.close(() => console.log('[MQTT] TLS server closed'));
      mqttTlsServer = null;
    }
    if (mqttServer) {
      mqttServer.close(() => {
        console.log('[MQTT] Server closed');

        // Also close WebSocket server if running
        if (mqttWsServer) {
          mqttWsServer.close(() => {
            console.log('[MQTT] WebSocket server closed');
          });
          mqttWsServer = null;
        }

        if (aedes) {
          aedes.close(() => {
            console.log('[MQTT] Broker closed');
            aedes = null;
            mqttServer = null;
            mqttHandlersInitialized = false;
            resolve();
          });
        } else {
          mqttServer = null;
          mqttHandlersInitialized = false;
          resolve();
        }
      });
    } else {
      if (mqttWsServer) {
        mqttWsServer.close(() => {
          console.log('[MQTT] WebSocket server closed');
        });
        mqttWsServer = null;
      }
      aedes = null;
      mqttHandlersInitialized = false;
      resolve();
    }
  });
}

/**
 * Check if external MQTT is connected
 */
export function isExternalMqttConnected(): boolean {
  return EXTERNAL_MQTT_ENABLED && externalMqttClient !== null && externalMqttClient.connected;
}

/**
 * Publish message to external MQTT broker
 */
export function publishToExternalMqtt(topic: string, payload: string): boolean {
  if (!EXTERNAL_MQTT_ENABLED || !externalMqttClient || !externalMqttClient.connected) {
    console.log('[MQTT External] Cannot publish - not connected');
    return false;
  }
  
  externalMqttClient.publish(topic, payload, { qos: 1 }, (error) => {
    if (error) {
      console.error('[MQTT External] Publish error:', error);
    } else {
      console.log(`[MQTT External] Published to ${topic}`);
    }
  });
  
  return true;
}

/**
 * Get external MQTT broker info
 */
export function getExternalMqttInfo(): {
  enabled: boolean;
  broker: string;
  port: number;
  connected: boolean;
  topicPrefix: string;
  useTLS: boolean;
  hasCredentials: boolean;
} {
  return {
    enabled: EXTERNAL_MQTT_ENABLED,
    broker: EXTERNAL_MQTT_BROKER,
    port: EXTERNAL_MQTT_PORT,
    connected: isExternalMqttConnected(),
    topicPrefix: EXTERNAL_MQTT_TOPIC_PREFIX,
    useTLS: EXTERNAL_MQTT_USE_TLS,
    hasCredentials: !!EXTERNAL_MQTT_USERNAME,
  };
}

/**
 * Publish points config changed notification via local MQTT
 */
export function publishPointsConfigChanged(productModelCode: string, version: number, machineCode?: string): void {
  if (!MQTT_ENABLED || !aedes) return;

  const topic = `avi/points-config-changed/${productModelCode}`;
  const payload = JSON.stringify({
    type: 'POINTS_CONFIG_CHANGED',
    productModelCode,
    pointsConfigVersion: version,
    machineCode: machineCode ?? null,
    timestamp: new Date().toISOString(),
  });

  aedes.publish({
    topic,
    payload: Buffer.from(payload),
    qos: 1 as 0 | 1 | 2,
    retain: true,
    cmd: 'publish',
    dup: false,
  }, (error) => {
    if (error) {
      console.error('[MQTT] Points config publish error:', error);
    }
  });
  console.log(`[MQTT] Published points config changed to ${topic} (v${version})`);

  // Also publish to external broker
  publishToExternalMqtt(topic, payload);
}

/**
 * WS-2 — Publish a model-update *notify* signal to an edge device (best-effort).
 *
 * IMPORTANT: this is ONLY a small notification (deploymentId + version + hash).
 * The model binary is NEVER sent over MQTT (Aedes buffers payloads in RAM and
 * has no resume). The device pulls the package over the apiKey-verified HTTP
 * proxy. Topic: avi/edge/{deviceId}/model-update (retained so a device that
 * reconnects still sees the latest available deployment).
 */
export function publishModelUpdate(
  deviceId: string,
  deploymentId: number,
  version: string | null | undefined,
  hash: string | null | undefined,
): void {
  if (!MQTT_ENABLED || !aedes) return;

  const topic = `avi/edge/${deviceId}/model-update`;
  const payload = JSON.stringify({
    type: 'MODEL_UPDATE_AVAILABLE',
    deviceId,
    deploymentId,
    packageVersion: version ?? null,
    packageHash: hash ?? null,
    timestamp: new Date().toISOString(),
  });

  aedes.publish({
    topic,
    payload: Buffer.from(payload),
    qos: 1 as 0 | 1 | 2,
    retain: true,
    cmd: 'publish',
    dup: false,
  }, (error) => {
    if (error) {
      console.error('[MQTT] Model update publish error:', error);
    }
  });
  console.log(`[MQTT] Published model update to ${topic} (deployment ${deploymentId}, v${version ?? '?'})`);

  // Also mirror to external broker (best-effort).
  publishToExternalMqtt(topic, payload);
}

export { aedes, MQTT_ENABLED, EXTERNAL_MQTT_ENABLED };
