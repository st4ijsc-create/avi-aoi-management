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
import { drizzle } from 'drizzle-orm/mysql2';
import { eq, and, sql } from 'drizzle-orm';
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

interface NGAlertPayload {
  type: 'NG_ALERT';
  inspectionId: number;
  serialNumber: string;
  productName: string;
  machineName: string;
  stationName: string;
  timestamp: string;
  ngPoints: Array<{
    pointId: number;
    pointName: string;
    result: string;
    actualValue?: string;
    imageUrl?: string;
  }>;
  totalNG: number;
  imageUrl?: string;
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

// MQTT Broker instance (local)
let aedes: Aedes | null = null;
let mqttServer: ReturnType<typeof createServer> | null = null;
let db: any = null;

// External MQTT client (for cloud broker)
let externalMqttClient: MqttClient | null = null;

// Configuration
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883');
const MQTT_WS_PORT = parseInt(process.env.MQTT_WS_PORT || '8883');
const MQTT_ENABLED = process.env.MQTT_ENABLED === 'true';

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
  });
  
  // Create Aedes broker
  aedes = new Aedes();

  // Create TCP server
  mqttServer = createServer(aedes);
  mqttServer.listen(MQTT_PORT, () => {
    console.log(`[MQTT] Broker started on port ${MQTT_PORT}`);
  });

  // Setup event handlers
  setupEventHandlers();

  // Initialize external MQTT client if enabled
  initExternalMqttClient();
}

/**
 * Initialize external MQTT client for cloud broker
 */
function initExternalMqttClient() {
  if (!EXTERNAL_MQTT_ENABLED) {
    console.log('[MQTT External] External MQTT is disabled. Set EXTERNAL_MQTT_ENABLED=true to enable.');
    return;
  }

  const brokerUrl = `${EXTERNAL_MQTT_BROKER}:${EXTERNAL_MQTT_PORT}`;
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
  if (!aedes || !db) return;

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
        
        // Check if approved
        if (mqttClient.approvalStatus === 'REJECTED') {
          callback({ returnCode: 5 } as any, false);
          return;
        }

        // Update client info
        await db!.update(schema.mqttClients)
          .set({
            clientId: client.id,
            deviceName: deviceName || mqttClient.deviceName,
            deviceModel: deviceModel || mqttClient.deviceModel,
            connectionStatus: 'ONLINE',
            lastConnectedAt: new Date(),
            lastHeartbeat: new Date(),
          })
          .where(eq(schema.mqttClients.id, mqttClient.id));

        console.log(`[MQTT] Client reconnected: ${client.id} (${deviceId})`);
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
        });

        console.log(`[MQTT] New client registered (pending approval): ${client.id} (${deviceId})`);
        callback(null, true);
      }
    } catch (error) {
      console.error('[MQTT] Authentication error:', error);
      callback({ returnCode: 4 } as any, false);
    }
  };

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
    try {
      await db!.update(schema.mqttClients)
        .set({ lastHeartbeat: new Date() })
        .where(eq(schema.mqttClients.clientId, client.id));
    } catch (error) {
      console.error('[MQTT] Error updating heartbeat:', error);
    }
  });
}

/**
 * Publish NG alert to relevant clients
 */
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
  measurementResults: Array<{ pointCode: string; result: string; value?: string | number | null }>;
}): Promise<boolean> {
  const { stationId } = data;
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
    const topic = `avi/factory/${factory.id}/workshop/${workshop.id}/station/${stationId}/errors`;

    // Build payload
    const payload: NGAlertPayload = {
      type: 'NG_ALERT',
      inspectionId: data.inspectionId,
      serialNumber: data.serialNumber,
      productName: '',
      machineName: data.machineName,
      stationName: data.stationName || station[0].station.name,
      timestamp: data.timestamp.toISOString(),
      ngPoints: data.measurementResults.map((m, i) => ({
        pointId: i,
        pointName: m.pointCode,
        result: m.result,
        actualValue: m.value?.toString(),
      })),
      totalNG: data.measurementResults.length,
    };

    // Publish message
    const message = JSON.stringify(payload);
    aedes.publish({
      topic,
      payload: Buffer.from(message),
      qos: 1,
      retain: false,
      cmd: 'publish',
      dup: false,
    }, (error) => {
      if (error) {
        console.error('[MQTT] Publish error:', error);
      }
    });

    // Log message
    await db.insert(schema.mqttMessageLogs).values({
      messageType: 'NG_ALERT',
      topic,
      payload: payload as any,
      stationId,
      inspectionId: payload.inspectionId,
      deliveryStatus: 'DELIVERED',
      deliveredAt: new Date(),
    });

    console.log(`[MQTT] Published NG alert to ${topic}`);

    // Also publish to external MQTT broker if enabled
    if (externalMqttClient && externalMqttClient.connected) {
      const externalTopic = `${EXTERNAL_MQTT_TOPIC_PREFIX}/factory/${factory.id}/workshop/${workshop.id}/station/${stationId}/errors`;
      externalMqttClient.publish(externalTopic, message, { qos: 1 }, (error) => {
        if (error) {
          console.error('[MQTT External] Publish error:', error);
        } else {
          console.log(`[MQTT External] Published NG alert to ${externalTopic}`);
        }
      });
    }

    // Send FCM push notification to offline clients
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
    return true;
  } catch (error) {
    console.error('[MQTT] Error sending command:', error);
    return false;
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
  return new Promise((resolve) => {
    if (mqttServer) {
      mqttServer.close(() => {
        console.log('[MQTT] Server closed');
        if (aedes) {
          aedes.close(() => {
            console.log('[MQTT] Broker closed');
            resolve();
          });
        } else {
          resolve();
        }
      });
    } else {
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

export { aedes, MQTT_ENABLED, EXTERNAL_MQTT_ENABLED };
