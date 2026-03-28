import { getDb } from "./connection";
import { eq, and, desc, gte, lte, sql, isNotNull } from "drizzle-orm";
import {
  mqttClients,
  type InsertMqttClient,
  mqttSubscriptions,
  type InsertMqttSubscription,
  mqttErrorSummary,
  type InsertMqttErrorSummary,
  mqttMessageLogs,
  type InsertMqttMessageLog,
  mqttAlertRules,
  type InsertMqttAlertRule,
  mqttAlertHistory,
  type InsertMqttAlertHistory,
} from "../../drizzle/schema";


// ============= MQTT Client Functions =============

export async function getMqttClients(filters?: {
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  connectionStatus?: 'ONLINE' | 'OFFLINE' | 'DISCONNECTED';
  stationId?: number;
  mappingType?: 'AUTO' | 'MANUAL';
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [eq(mqttClients.isActive, true)];
  
  if (filters?.approvalStatus) {
    conditions.push(eq(mqttClients.approvalStatus, filters.approvalStatus));
  }
  if (filters?.connectionStatus) {
    conditions.push(eq(mqttClients.connectionStatus, filters.connectionStatus));
  }
  if (filters?.stationId) {
    conditions.push(eq(mqttClients.stationId, filters.stationId));
  }
  if (filters?.mappingType) {
    conditions.push(eq(mqttClients.mappingType, filters.mappingType));
  }
  
  return db.select()
    .from(mqttClients)
    .where(and(...conditions))
    .orderBy(desc(mqttClients.createdAt));
}

export async function getMqttClientById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(mqttClients)
    .where(eq(mqttClients.id, id))
    .limit(1);
  
  return results[0] || null;
}

export async function getMqttClientByDeviceId(deviceId: string) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select()
    .from(mqttClients)
    .where(eq(mqttClients.deviceId, deviceId))
    .limit(1);
  
  return results[0] || null;
}

export async function approveMqttClient(
  id: number, 
  approvedBy: number, 
  stationId?: number,
  mappingType?: 'AUTO' | 'MANUAL'
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set({
      approvalStatus: 'APPROVED',
      approvedBy,
      approvedAt: new Date(),
      stationId: stationId || null,
      mappingType: mappingType || 'MANUAL',
    })
    .where(eq(mqttClients.id, id));
}

export async function rejectMqttClient(id: number, reason?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set({
      approvalStatus: 'REJECTED',
      rejectionReason: reason || null,
    })
    .where(eq(mqttClients.id, id));
}

export async function updateMqttClientMapping(id: number, data: {
  stationId?: number | null;
  processId?: number | null;
  mappingType?: 'AUTO' | 'MANUAL';
  autoReconnect?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set(data)
    .where(eq(mqttClients.id, id));
}

export async function updateMqttClientSettings(id: number, data: {
  deviceName?: string;
  receiveNGAlerts?: boolean;
  receiveDailySummary?: boolean;
  receiveWeeklySummary?: boolean;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set(data)
    .where(eq(mqttClients.id, id));
}

export async function deleteMqttClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Soft delete
  await db.update(mqttClients)
    .set({ isActive: false })
    .where(eq(mqttClients.id, id));
}

export async function disconnectAndResetMqttClient(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(mqttClients)
    .set({
      stationId: null,
      processId: null,
      connectionStatus: 'DISCONNECTED',
      lastDisconnectedAt: new Date(),
    })
    .where(eq(mqttClients.id, id));
}

export async function getMqttErrorSummaries(filters?: {
  stationId?: number;
  summaryType?: 'DAILY' | 'WEEKLY';
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  
  if (filters?.stationId) {
    conditions.push(eq(mqttErrorSummary.stationId, filters.stationId));
  }
  if (filters?.summaryType) {
    conditions.push(eq(mqttErrorSummary.summaryType, filters.summaryType));
  }
  if (filters?.startDate) {
    conditions.push(gte(mqttErrorSummary.summaryDate, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(mqttErrorSummary.summaryDate, filters.endDate));
  }
  
  return db.select()
    .from(mqttErrorSummary)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(mqttErrorSummary.summaryDate))
    .limit(filters?.limit || 50);
}

export async function getMqttMessageLogs(filters?: {
  clientId?: number;
  stationId?: number;
  messageType?: 'NG_ALERT' | 'DAILY_SUMMARY' | 'WEEKLY_SUMMARY' | 'CUSTOM';
  limit?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [];
  
  if (filters?.clientId) {
    conditions.push(eq(mqttMessageLogs.targetClientId, filters.clientId));
  }
  if (filters?.stationId) {
    conditions.push(eq(mqttMessageLogs.stationId, filters.stationId));
  }
  if (filters?.messageType) {
    conditions.push(eq(mqttMessageLogs.messageType, filters.messageType));
  }
  
  return db.select()
    .from(mqttMessageLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(mqttMessageLogs.createdAt))
    .limit(filters?.limit || 100);
}


// ============ MQTT DASHBOARD STATISTICS ============

export async function getMqttDashboardStats() {
  const db = await getDb();
  if (!db) return null;
  
  // Get client counts by status (only active clients)
  const clients = await db.select().from(mqttClients).where(eq(mqttClients.isActive, true));
  
  const totalClients = clients.length;
  const onlineClients = clients.filter(c => c.connectionStatus === 'ONLINE').length;
  const offlineClients = clients.filter(c => c.connectionStatus === 'OFFLINE').length;
  const pendingApproval = clients.filter(c => c.approvalStatus === 'PENDING').length;
  const approvedClients = clients.filter(c => c.approvalStatus === 'APPROVED').length;
  
  // Get message stats for today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const messages = await db.select()
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, today));
  
  const totalMessages = messages.length;
  const deliveredMessages = messages.filter(m => m.deliveryStatus === 'DELIVERED').length;
  const failedMessages = messages.filter(m => m.deliveryStatus === 'FAILED').length;
  const pendingMessages = messages.filter(m => m.deliveryStatus === 'PENDING').length;
  
  // Get message breakdown by type
  const ngAlerts = messages.filter(m => m.messageType === 'NG_ALERT').length;
  const dailySummaries = messages.filter(m => m.messageType === 'DAILY_SUMMARY').length;
  const weeklySummaries = messages.filter(m => m.messageType === 'WEEKLY_SUMMARY').length;
  
  return {
    clients: {
      total: totalClients,
      online: onlineClients,
      offline: offlineClients,
      pendingApproval,
      approved: approvedClients,
    },
    messages: {
      total: totalMessages,
      delivered: deliveredMessages,
      failed: failedMessages,
      pending: pendingMessages,
      deliveryRate: totalMessages > 0 ? (deliveredMessages / totalMessages * 100).toFixed(1) : '0',
    },
    breakdown: {
      ngAlerts,
      dailySummaries,
      weeklySummaries,
    },
  };
}

export async function getMqttMessageTrend(days: number = 7) {
  const db = await getDb();
  if (!db) return [];
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  
  const messages = await db.select()
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, startDate))
    .orderBy(mqttMessageLogs.createdAt);
  
  // Group by date
  const trend: Record<string, { date: string; total: number; delivered: number; failed: number; ngAlerts: number }> = {};
  
  for (let i = 0; i <= days; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (days - i));
    const dateStr = date.toISOString().split('T')[0];
    trend[dateStr] = { date: dateStr, total: 0, delivered: 0, failed: 0, ngAlerts: 0 };
  }
  
  messages.forEach(m => {
    const dateStr = new Date(m.createdAt!).toISOString().split('T')[0];
    if (trend[dateStr]) {
      trend[dateStr].total++;
      if (m.deliveryStatus === 'DELIVERED') trend[dateStr].delivered++;
      if (m.deliveryStatus === 'FAILED') trend[dateStr].failed++;
      if (m.messageType === 'NG_ALERT') trend[dateStr].ngAlerts++;
    }
  });
  
  return Object.values(trend);
}

export async function getRecentMqttMessages(limit: number = 20) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select({
    id: mqttMessageLogs.id,
    messageType: mqttMessageLogs.messageType,
    topic: mqttMessageLogs.topic,
    deliveryStatus: mqttMessageLogs.deliveryStatus,
    deliveredAt: mqttMessageLogs.deliveredAt,
    createdAt: mqttMessageLogs.createdAt,
    stationId: mqttMessageLogs.stationId,
    inspectionId: mqttMessageLogs.inspectionId,
  })
    .from(mqttMessageLogs)
    .orderBy(desc(mqttMessageLogs.createdAt))
    .limit(limit);
}

export async function updateMqttClientFcmToken(clientId: number, fcmToken: string) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttClients)
    .set({ fcmToken, updatedAt: new Date() })
    .where(eq(mqttClients.id, clientId));
}

export async function getMqttClientsWithFcmToken() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttClients)
    .where(and(
      isNotNull(mqttClients.fcmToken),
      eq(mqttClients.approvalStatus, 'APPROVED'),
      eq(mqttClients.isActive, true)
    ));
}

export async function getOfflineMqttClientsWithFcmToken(stationId?: number) {
  const db = await getDb();
  if (!db) return [];
  
  const conditions = [
    isNotNull(mqttClients.fcmToken),
    eq(mqttClients.approvalStatus, 'APPROVED'),
    eq(mqttClients.isActive, true),
    eq(mqttClients.connectionStatus, 'OFFLINE'),
    eq(mqttClients.receiveNGAlerts, true),
  ];
  
  if (stationId) {
    conditions.push(eq(mqttClients.stationId, stationId));
  }
  
  return db.select()
    .from(mqttClients)
    .where(and(...conditions));
}


// ============ MQTT REALTIME STATS FUNCTIONS ============

export async function getMqttMessageCountSince(since: Date) {
  const db = await getDb();
  if (!db) return { total: 0, delivered: 0, failed: 0, ngAlerts: 0 };
  
  const messages = await db.select({
    deliveryStatus: mqttMessageLogs.deliveryStatus,
    messageType: mqttMessageLogs.messageType,
  })
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, since));
  
  return {
    total: messages.length,
    delivered: messages.filter(m => m.deliveryStatus === 'DELIVERED').length,
    failed: messages.filter(m => m.deliveryStatus === 'FAILED').length,
    ngAlerts: messages.filter(m => m.messageType === 'NG_ALERT').length,
  };
}

export async function getMqttLatencyStats() {
  const db = await getDb();
  if (!db) return { avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  
  const messages = await db.select({
    createdAt: mqttMessageLogs.createdAt,
    deliveredAt: mqttMessageLogs.deliveredAt,
  })
    .from(mqttMessageLogs)
    .where(and(
      gte(mqttMessageLogs.createdAt, oneHourAgo),
      isNotNull(mqttMessageLogs.deliveredAt)
    ));
  
  if (messages.length === 0) {
    return { avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  }
  
  const latencies = messages
    .map(m => {
      if (!m.createdAt || !m.deliveredAt) return null;
      return new Date(m.deliveredAt).getTime() - new Date(m.createdAt).getTime();
    })
    .filter((l): l is number => l !== null && l >= 0);
  
  if (latencies.length === 0) {
    return { avgMs: 0, minMs: 0, maxMs: 0, p95Ms: 0 };
  }
  
  latencies.sort((a, b) => a - b);
  
  const avgMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const minMs = latencies[0];
  const maxMs = latencies[latencies.length - 1];
  const p95Index = Math.floor(latencies.length * 0.95);
  const p95Ms = latencies[p95Index] || maxMs;
  
  return { avgMs, minMs, maxMs, p95Ms };
}


export async function getMqttThroughputHistory(minutes: number = 60) {
  const db = await getDb();
  if (!db) return [];
  
  const since = new Date(Date.now() - minutes * 60 * 1000);
  
  const messages = await db.select({
    createdAt: mqttMessageLogs.createdAt,
    deliveryStatus: mqttMessageLogs.deliveryStatus,
    messageType: mqttMessageLogs.messageType,
  })
    .from(mqttMessageLogs)
    .where(gte(mqttMessageLogs.createdAt, since))
    .orderBy(mqttMessageLogs.createdAt);
  
  // Group by minute
  const minuteData: Record<string, { 
    time: string; 
    timestamp: number;
    count: number; 
    delivered: number; 
    failed: number;
    ngAlerts: number;
  }> = {};
  
  // Initialize all minutes in the range
  for (let i = 0; i < minutes; i++) {
    const date = new Date(Date.now() - (minutes - i - 1) * 60 * 1000);
    const minuteKey = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    minuteData[minuteKey] = { 
      time: minuteKey, 
      timestamp: date.getTime(),
      count: 0, 
      delivered: 0, 
      failed: 0,
      ngAlerts: 0,
    };
  }
  
  messages.forEach(m => {
    if (!m.createdAt) return;
    const date = new Date(m.createdAt);
    const minuteKey = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    
    if (minuteData[minuteKey]) {
      minuteData[minuteKey].count++;
      if (m.deliveryStatus === 'DELIVERED') minuteData[minuteKey].delivered++;
      if (m.deliveryStatus === 'FAILED') minuteData[minuteKey].failed++;
      if (m.messageType === 'NG_ALERT') minuteData[minuteKey].ngAlerts++;
    }
  });
  
  return Object.values(minuteData).sort((a, b) => a.timestamp - b.timestamp);
}


// ============ MQTT ALERT RULES FUNCTIONS ============

export async function getMqttAlertRules() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertRules)
    .orderBy(desc(mqttAlertRules.createdAt));
}

export async function getMqttAlertRuleById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db.select()
    .from(mqttAlertRules)
    .where(eq(mqttAlertRules.id, id))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getEnabledMqttAlertRules() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertRules)
    .where(eq(mqttAlertRules.isEnabled, true));
}

export async function createMqttAlertRule(data: {
  name: string;
  description?: string;
  ruleType: 'LATENCY_THRESHOLD' | 'BROKER_DISCONNECT' | 'MESSAGE_FAILURE_RATE' | 'THROUGHPUT_LOW' | 'THROUGHPUT_HIGH' | 'CLIENT_OFFLINE';
  thresholdValue: string;
  thresholdUnit?: string;
  comparisonOperator?: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
  timeWindowMinutes?: number;
  notifyOwner?: boolean;
  notifyEmail?: boolean;
  notifyMqtt?: boolean;
  cooldownMinutes?: number;
  createdBy?: number;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(mqttAlertRules).values({
    name: data.name,
    description: data.description,
    ruleType: data.ruleType,
    thresholdValue: data.thresholdValue,
    thresholdUnit: data.thresholdUnit || 'ms',
    comparisonOperator: data.comparisonOperator || 'GT',
    timeWindowMinutes: data.timeWindowMinutes || 5,
    notifyOwner: data.notifyOwner ?? true,
    notifyEmail: data.notifyEmail ?? false,
    notifyMqtt: data.notifyMqtt ?? false,
    cooldownMinutes: data.cooldownMinutes || 15,
    createdBy: data.createdBy,
  }).returning({ id: mqttAlertRules.id });
  
  return { id: Number(result.id) };
}

export async function updateMqttAlertRule(id: number, data: Partial<{
  name: string;
  description: string;
  thresholdValue: string;
  thresholdUnit: string;
  comparisonOperator: 'GT' | 'GTE' | 'LT' | 'LTE' | 'EQ';
  timeWindowMinutes: number;
  notifyOwner: boolean;
  notifyEmail: boolean;
  notifyMqtt: boolean;
  cooldownMinutes: number;
  isEnabled: boolean;
}>) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttAlertRules)
    .set(data)
    .where(eq(mqttAlertRules.id, id));
}

export async function deleteMqttAlertRule(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.delete(mqttAlertRules)
    .where(eq(mqttAlertRules.id, id));
}

export async function updateMqttAlertRuleLastTriggered(id: number) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttAlertRules)
    .set({ lastTriggeredAt: new Date() })
    .where(eq(mqttAlertRules.id, id));
}

// ============ MQTT ALERT HISTORY FUNCTIONS ============

export async function getMqttAlertHistory(limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertHistory)
    .orderBy(desc(mqttAlertHistory.triggeredAt))
    .limit(limit);
}

export async function getUnresolvedMqttAlerts() {
  const db = await getDb();
  if (!db) return [];
  
  return db.select()
    .from(mqttAlertHistory)
    .where(eq(mqttAlertHistory.isResolved, false))
    .orderBy(desc(mqttAlertHistory.triggeredAt));
}

export async function createMqttAlertHistoryEntry(data: {
  ruleId: number;
  ruleName: string;
  ruleType: string;
  triggeredValue: string;
  thresholdValue: string;
  message: string;
  notificationSent?: boolean;
  notificationError?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  
  const [result] = await db.insert(mqttAlertHistory).values({
    ruleId: data.ruleId,
    ruleName: data.ruleName,
    ruleType: data.ruleType,
    triggeredValue: data.triggeredValue,
    thresholdValue: data.thresholdValue,
    message: data.message,
    notificationSent: data.notificationSent ?? false,
    notificationError: data.notificationError,
  }).returning({ id: mqttAlertHistory.id });
  
  return { id: Number(result.id) };
}

export async function resolveMqttAlert(id: number, userId: number, note?: string) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(mqttAlertHistory)
    .set({
      isResolved: true,
      resolvedAt: new Date(),
      resolvedBy: userId,
      resolutionNote: note,
    })
    .where(eq(mqttAlertHistory.id, id));
}


// ============ MQTT CLIENT CREATE ============
export async function createMqttClient(data: {
  deviceId: string;
  deviceName: string;
  deviceType?: string;
  stationId?: number;
  processId?: number;
  mappingType?: 'AUTO' | 'MANUAL';
  receiveNGAlerts?: boolean;
  receiveDailySummary?: boolean;
  receiveWeeklySummary?: boolean;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedBy?: number;
  approvedAt?: Date;
  connectionStatus?: 'ONLINE' | 'OFFLINE' | 'DISCONNECTED';
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Generate a unique clientId from deviceId
  const clientId = `client_${data.deviceId}_${Date.now()}`;
  
  const [result] = await db.insert(mqttClients).values({
    clientId,
    deviceId: data.deviceId,
    deviceName: data.deviceName,
    stationId: data.stationId || null,
    processId: data.processId || null,
    mappingType: data.mappingType || 'MANUAL',
    receiveNGAlerts: data.receiveNGAlerts ?? true,
    receiveDailySummary: data.receiveDailySummary ?? true,
    receiveWeeklySummary: data.receiveWeeklySummary ?? true,
    approvalStatus: data.approvalStatus || 'PENDING',
    approvedBy: data.approvedBy || null,
    approvedAt: data.approvedAt || null,
    connectionStatus: data.connectionStatus || 'OFFLINE',
    isActive: data.isActive ?? true,
  }).returning({ id: mqttClients.id });
  
  return { id: Number(result.id) };
}

// ============ MQTT CLIENT CONNECTION HISTORY ============
export async function getMqttClientConnectionHistory(clientId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  // Get from mqtt_message_logs where targetClientId matches
  const results = await db.select({
    id: mqttMessageLogs.id,
    messageType: mqttMessageLogs.messageType,
    status: mqttMessageLogs.deliveryStatus,
    createdAt: mqttMessageLogs.createdAt,
    payload: mqttMessageLogs.payload,
  })
    .from(mqttMessageLogs)
    .where(eq(mqttMessageLogs.targetClientId, clientId))
    .orderBy(desc(mqttMessageLogs.createdAt))
    .limit(limit);
  
  return results;
}

// ============ MQTT CLIENT HEALTH ============
export async function getMqttClientHealth(clientId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const client = await getMqttClientById(clientId);
  if (!client) return null;
  
  // Get message stats for last 24 hours
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const messageStats = await db.select({
    total: sql<number>`COUNT(*)`,
    delivered: sql<number>`SUM(CASE WHEN ${mqttMessageLogs.deliveryStatus} = 'DELIVERED' THEN 1 ELSE 0 END)`,
    failed: sql<number>`SUM(CASE WHEN ${mqttMessageLogs.deliveryStatus} = 'FAILED' THEN 1 ELSE 0 END)`,
    pending: sql<number>`SUM(CASE WHEN ${mqttMessageLogs.deliveryStatus} = 'PENDING' THEN 1 ELSE 0 END)`,
  })
    .from(mqttMessageLogs)
    .where(and(
      eq(mqttMessageLogs.targetClientId, clientId),
      gte(mqttMessageLogs.createdAt, oneDayAgo)
    ));
  
  const stats = messageStats[0] || { total: 0, delivered: 0, failed: 0, pending: 0 };
  
  // Calculate uptime (simplified - based on last heartbeat)
  const lastSeenMs = client.lastHeartbeat ? new Date(client.lastHeartbeat).getTime() : 0;
  const uptimeMs = client.connectionStatus === 'ONLINE' ? Date.now() - lastSeenMs : 0;
  
  return {
    clientId,
    deviceName: client.deviceName,
    connectionStatus: client.connectionStatus,
    lastSeen: client.lastHeartbeat,
    uptimeMs,
    messageStats: {
      total: Number(stats.total),
      delivered: Number(stats.delivered),
      failed: Number(stats.failed),
      pending: Number(stats.pending),
      successRate: Number(stats.total) > 0 
        ? Math.round((Number(stats.delivered) / Number(stats.total)) * 100) 
        : 100,
    },
    healthScore: calculateClientHealthScore(client, stats),
  };
}

function calculateClientHealthScore(client: any, stats: any): number {
  let score = 100;
  
  // Connection status
  if (client.connectionStatus === 'OFFLINE') score -= 30;
  if (client.connectionStatus === 'DISCONNECTED') score -= 50;
  
  // Message success rate
  const successRate = Number(stats.total) > 0 
    ? Number(stats.delivered) / Number(stats.total) 
    : 1;
  score -= (1 - successRate) * 40;
  
  // Last seen (if offline for too long)
  if (client.lastHeartbeat) {
    const hoursSinceLastSeen = (Date.now() - new Date(client.lastHeartbeat).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastSeen > 24) score -= 20;
    else if (hoursSinceLastSeen > 1) score -= 10;
  }
  
  return Math.max(0, Math.round(score));
}

export async function getAllMqttClientsHealth() {
  const db = await getDb();
  if (!db) return [];
  
  const clients = await getMqttClients();
  const healthData = await Promise.all(
    clients.map(client => getMqttClientHealth(client.id))
  );
  
  return healthData.filter(h => h !== null);
}
