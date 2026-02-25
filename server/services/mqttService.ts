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
  }>;
  totalNG: number;
  imageUrl?: string;
  inspectionId: number;
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
let mqttWsServer: ReturnType<typeof createServer> | null = null;
let db: any = null;
let mqttHandlersInitialized = false;
let mqttPortConflictDetected = false;

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

  // If DB was initialized earlier (e.g. in tests), attach handlers now
  if (db && !mqttHandlersInitialized) {
    setupEventHandlers();
    mqttHandlersInitialized = true;
    console.log('[MQTT] Event handlers initialized');
  }

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
 * Publish NG alert to relevant clients with enhanced payload structure
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
  }>;
  // Main error image URL
  errorImageUrl?: string;
  // Severity level
  severity?: 'low' | 'medium' | 'high' | 'critical';
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

    const { factory, workshop, line } = station[0];
    const topic = `avi/factory/${factory.id}/workshop/${workshop.id}/station/${stationId}/errors`;

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
        id: `ST-${stationId}`,
        name: data.stationName || station[0].station.name,
        line: data.lineName || line.name,
        area: data.workshopName || workshop.name,
      },
      product: {
        id: data.productModelCode ? `PRD-${data.productModelCode}` : `PRD-${data.serialNumber}`,
        name: data.productModelName || 'Unknown Product',
        serialNumber: data.serialNumber,
        model: data.productModelCode,
        customer: data.customer,
      },
      error: {
        code: primaryNG?.pointCode ? `E-${primaryNG.pointCode}` : `E-NG-${data.inspectionId}`,
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
        pointId: m.pointId || i,
        pointName: m.pointCode,
        result: m.result,
        actualValue: m.value?.toString(),
        expectedValue: m.expectedValue?.toString(),
        imageUrl: m.imageUrl,
        referenceImageUrl: m.referenceImageUrl,
      })),
      totalNG: ngCount,
      imageUrl: mainImageUrl,
      inspectionId: data.inspectionId,
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
        const { sendBulletinPushNotification } = await import('./fcmService');
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

export { aedes, MQTT_ENABLED, EXTERNAL_MQTT_ENABLED };
