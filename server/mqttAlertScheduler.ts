/**
 * MQTT Alert Background Job Scheduler
 * Tự động kiểm tra connection status và tạo alerts khi vượt threshold
 */

import { getDb } from "./db";

// Helper to get db with null check
async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}
import { 
  mqttConnectionStatus, 
  mqttConnectionAlerts, 
  mqttAlertConfig,
  mqttReconnectLogs,
  mqttClientProfiles
} from "../drizzle/schema";
import { eq, and, gte, lte, sql, isNull, desc } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";

// Scheduler state
let schedulerInterval: NodeJS.Timeout | null = null;
let isSchedulerRunning = false;
let lastRunTime: Date | null = null;
let schedulerConfig = {
  enabled: false,
  intervalMinutes: 5, // Check every 5 minutes
  notifyOnCritical: true,
  notifyOnWarning: false,
};

// Rate limiting for notifications
const notificationCooldown = new Map<string, number>(); // key -> timestamp
const NOTIFICATION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between same alerts

/**
 * Get default alert configuration
 */
async function getDefaultAlertConfig() {
  const db = await requireDb();
  const config = await db.select().from(mqttAlertConfig).where(isNull(mqttAlertConfig.profileId)).limit(1);
  if (config.length > 0) {
    return config[0];
  }
  // Return default values if no config exists
  return {
    connectionLostThreshold: 5,
    reconnectFailedThreshold: 10,
    highReconnectRateThreshold: 20,
    longDisconnectionThreshold: 30,
    enableEmailNotification: false,
    enablePushNotification: true,
    isActive: true,
  };
}

/**
 * Check for connection lost alerts
 * Profiles that haven't been seen for longer than threshold
 */
async function checkConnectionLost(config: any) {
  const thresholdMinutes = config.connectionLostThreshold || 5;
  const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  const db = await requireDb();
  // Get all connection statuses that are not connected and last seen before threshold
  const lostConnections = await db.select({
    profileId: mqttConnectionStatus.profileId,
    assignmentId: mqttConnectionStatus.assignmentId,
    targetType: mqttConnectionStatus.targetType,
    targetId: mqttConnectionStatus.targetId,
    status: mqttConnectionStatus.status,
    lastHeartbeat: mqttConnectionStatus.lastHeartbeat,
    profileName: mqttClientProfiles.name,
  })
  .from(mqttConnectionStatus)
  .leftJoin(mqttClientProfiles, eq(mqttConnectionStatus.profileId, mqttClientProfiles.id))
  .where(
    and(
      sql`${mqttConnectionStatus.status} != 'connected'`,
      lte(mqttConnectionStatus.lastHeartbeat, thresholdTime)
    )
  );

  for (const conn of lostConnections) {
    const alertKey = `connection_lost_${conn.profileId}_${conn.assignmentId || 'global'}`;
    
    // Check if we already have an unresolved alert for this
    const existingAlert = await db.select().from(mqttConnectionAlerts)
      .where(
        and(
          eq(mqttConnectionAlerts.profileId, conn.profileId),
          eq(mqttConnectionAlerts.alertType, 'connection_lost'),
          eq(mqttConnectionAlerts.isResolved, false)
        )
      )
      .limit(1);

    if (existingAlert.length === 0) {
      // Create new alert
      const minutesOffline = Math.round((Date.now() - new Date(conn.lastHeartbeat!).getTime()) / 60000);
      
      await db.insert(mqttConnectionAlerts).values({
        profileId: conn.profileId,
        assignmentId: conn.assignmentId,
        targetType: conn.targetType as any,
        targetId: conn.targetId,
        alertType: 'connection_lost',
        severity: minutesOffline > thresholdMinutes * 2 ? 'critical' : 'warning',
        title: `Connection Lost: ${conn.profileName || `Profile #${conn.profileId}`}`,
        message: `MQTT connection has been lost for ${minutesOffline} minutes (threshold: ${thresholdMinutes} min)`,
        thresholdMinutes,
        createdAt: new Date(),
      });

      // Send notification if enabled
      if (config.enablePushNotification && schedulerConfig.notifyOnCritical) {
        await sendAlertNotification(alertKey, {
          title: `🔴 MQTT Connection Lost`,
          content: `Profile "${conn.profileName}" has been disconnected for ${minutesOffline} minutes.`,
        });
      }
    }
  }
}

/**
 * Check for high reconnect rate alerts
 * Profiles with too many reconnects in the last hour
 */
async function checkHighReconnectRate(config: any) {
  const threshold = config.highReconnectRateThreshold || 20;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const db = await requireDb();
  // Count reconnects per profile in the last hour
  const reconnectCounts = await db.select({
    profileId: mqttReconnectLogs.profileId,
    count: sql<number>`COUNT(*)`.as('count'),
  })
  .from(mqttReconnectLogs)
  .where(gte(mqttReconnectLogs.timestamp, oneHourAgo))
  .groupBy(mqttReconnectLogs.profileId)
  .having(sql`COUNT(*) >= ${threshold}`);

  for (const item of reconnectCounts) {
    const alertKey = `high_reconnect_rate_${item.profileId}`;
    
    // Check if we already have an unresolved alert for this
    const existingAlert = await db.select().from(mqttConnectionAlerts)
      .where(
        and(
          eq(mqttConnectionAlerts.profileId, item.profileId),
          eq(mqttConnectionAlerts.alertType, 'high_reconnect_rate'),
          eq(mqttConnectionAlerts.isResolved, false)
        )
      )
      .limit(1);

    if (existingAlert.length === 0) {
      // Get profile name
      const profile = await db.select().from(mqttClientProfiles).where(eq(mqttClientProfiles.id, item.profileId)).limit(1);
      const profileName = profile[0]?.name || `Profile #${item.profileId}`;

      await db.insert(mqttConnectionAlerts).values({
        profileId: item.profileId,
        alertType: 'high_reconnect_rate',
        severity: item.count > threshold * 2 ? 'critical' : 'warning',
        title: `High Reconnect Rate: ${profileName}`,
        message: `${item.count} reconnect attempts in the last hour (threshold: ${threshold})`,
        thresholdMinutes: 60,
        createdAt: new Date(),
      });

      // Send notification
      if (config.enablePushNotification) {
        await sendAlertNotification(alertKey, {
          title: `⚠️ High Reconnect Rate`,
          content: `Profile "${profileName}" has ${item.count} reconnect attempts in the last hour.`,
        });
      }
    }
  }
}

/**
 * Check for reconnect failures
 * Profiles with too many failed reconnects
 */
async function checkReconnectFailures(config: any) {
  const threshold = config.reconnectFailedThreshold || 10;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const db = await requireDb();
  // Count failed reconnects per profile in the last hour
  const failureCounts = await db.select({
    profileId: mqttReconnectLogs.profileId,
    count: sql<number>`COUNT(*)`.as('count'),
  })
  .from(mqttReconnectLogs)
  .where(
    and(
      gte(mqttReconnectLogs.timestamp, oneHourAgo),
      eq(mqttReconnectLogs.eventType, 'failure')
    )
  )
  .groupBy(mqttReconnectLogs.profileId)
  .having(sql`COUNT(*) >= ${threshold}`);

  for (const item of failureCounts) {
    const alertKey = `reconnect_failed_${item.profileId}`;
    
    // Check if we already have an unresolved alert for this
    const existingAlert = await db.select().from(mqttConnectionAlerts)
      .where(
        and(
          eq(mqttConnectionAlerts.profileId, item.profileId),
          eq(mqttConnectionAlerts.alertType, 'reconnect_failed'),
          eq(mqttConnectionAlerts.isResolved, false)
        )
      )
      .limit(1);

    if (existingAlert.length === 0) {
      // Get profile name
      const profile = await db.select().from(mqttClientProfiles).where(eq(mqttClientProfiles.id, item.profileId)).limit(1);
      const profileName = profile[0]?.name || `Profile #${item.profileId}`;

      await db.insert(mqttConnectionAlerts).values({
        profileId: item.profileId,
        alertType: 'reconnect_failed',
        severity: 'critical',
        title: `Reconnect Failures: ${profileName}`,
        message: `${item.count} failed reconnect attempts in the last hour (threshold: ${threshold})`,
        thresholdMinutes: 60,
        createdAt: new Date(),
      });

      // Send notification
      if (config.enablePushNotification) {
        await sendAlertNotification(alertKey, {
          title: `🔴 Reconnect Failures`,
          content: `Profile "${profileName}" has ${item.count} failed reconnect attempts.`,
        });
      }
    }
  }
}

/**
 * Check for long disconnection alerts
 * Profiles that have been offline for too long
 */
async function checkLongDisconnection(config: any) {
  const thresholdMinutes = config.longDisconnectionThreshold || 30;
  const thresholdTime = new Date(Date.now() - thresholdMinutes * 60 * 1000);

  const db = await requireDb();
  // Get all connection statuses that are disconnected for too long
  const longDisconnections = await db.select({
    profileId: mqttConnectionStatus.profileId,
    assignmentId: mqttConnectionStatus.assignmentId,
    targetType: mqttConnectionStatus.targetType,
    targetId: mqttConnectionStatus.targetId,
    lastHeartbeat: mqttConnectionStatus.lastHeartbeat,
    profileName: mqttClientProfiles.name,
  })
  .from(mqttConnectionStatus)
  .leftJoin(mqttClientProfiles, eq(mqttConnectionStatus.profileId, mqttClientProfiles.id))
  .where(
    and(
      eq(mqttConnectionStatus.status, 'disconnected'),
      lte(mqttConnectionStatus.lastHeartbeat, thresholdTime)
    )
  );

  for (const conn of longDisconnections) {
    const alertKey = `long_disconnection_${conn.profileId}_${conn.assignmentId || 'global'}`;
    
    // Check if we already have an unresolved alert for this
    const existingAlert = await db.select().from(mqttConnectionAlerts)
      .where(
        and(
          eq(mqttConnectionAlerts.profileId, conn.profileId),
          eq(mqttConnectionAlerts.alertType, 'long_disconnection'),
          eq(mqttConnectionAlerts.isResolved, false)
        )
      )
      .limit(1);

    if (existingAlert.length === 0) {
      const minutesOffline = Math.round((Date.now() - new Date(conn.lastHeartbeat!).getTime()) / 60000);
      
      await db.insert(mqttConnectionAlerts).values({
        profileId: conn.profileId,
        assignmentId: conn.assignmentId,
        targetType: conn.targetType as any,
        targetId: conn.targetId,
        alertType: 'long_disconnection',
        severity: 'critical',
        title: `Long Disconnection: ${conn.profileName || `Profile #${conn.profileId}`}`,
        message: `MQTT connection has been offline for ${minutesOffline} minutes (threshold: ${thresholdMinutes} min)`,
        thresholdMinutes,
        createdAt: new Date(),
      });

      // Send notification
      if (config.enablePushNotification) {
        await sendAlertNotification(alertKey, {
          title: `🔴 Long Disconnection`,
          content: `Profile "${conn.profileName}" has been offline for ${minutesOffline} minutes.`,
        });
      }
    }
  }
}

/**
 * Auto-resolve alerts when connection is restored
 */
async function autoResolveAlerts() {
  const db = await requireDb();
  // Get all connected statuses
  const connectedStatuses = await db.select({
    profileId: mqttConnectionStatus.profileId,
  })
  .from(mqttConnectionStatus)
  .where(eq(mqttConnectionStatus.status, 'connected'));

  const connectedProfileIds = connectedStatuses.map((s: { profileId: number }) => s.profileId);

  if (connectedProfileIds.length > 0) {
    // Resolve connection_lost and long_disconnection alerts for connected profiles
    await db.update(mqttConnectionAlerts)
      .set({
        isResolved: true,
        resolvedAt: new Date(),
      })
      .where(
        and(
          sql`${mqttConnectionAlerts.profileId} IN (${sql.join(connectedProfileIds.map((id: number) => sql`${id}`), sql`, `)})`,
          sql`${mqttConnectionAlerts.alertType} IN ('connection_lost', 'long_disconnection')`,
          eq(mqttConnectionAlerts.isResolved, false)
        )
      );
  }
}

/**
 * Send notification with rate limiting
 */
async function sendAlertNotification(alertKey: string, notification: { title: string; content: string }) {
  const now = Date.now();
  const lastSent = notificationCooldown.get(alertKey);
  
  if (lastSent && now - lastSent < NOTIFICATION_COOLDOWN_MS) {
    console.log(`[AlertScheduler] Notification for ${alertKey} skipped (cooldown)`);
    return;
  }

  try {
    const success = await notifyOwner(notification);
    if (success) {
      notificationCooldown.set(alertKey, now);
      console.log(`[AlertScheduler] Notification sent: ${notification.title}`);
    }
  } catch (error) {
    console.error(`[AlertScheduler] Failed to send notification:`, error);
  }
}

/**
 * Run all alert checks
 */
async function runAlertChecks() {
  console.log(`[AlertScheduler] Running alert checks at ${new Date().toISOString()}`);
  lastRunTime = new Date();

  try {
    const config = await getDefaultAlertConfig();
    
    if (!config.isActive) {
      console.log(`[AlertScheduler] Alert config is disabled, skipping checks`);
      return;
    }

    await checkConnectionLost(config);
    await checkHighReconnectRate(config);
    await checkReconnectFailures(config);
    await checkLongDisconnection(config);
    await autoResolveAlerts();

    console.log(`[AlertScheduler] Alert checks completed`);
  } catch (error) {
    console.error(`[AlertScheduler] Error running alert checks:`, error);
  }
}

/**
 * Start the scheduler
 */
export function startAlertScheduler(intervalMinutes: number = 5) {
  if (isSchedulerRunning) {
    console.log(`[AlertScheduler] Scheduler is already running`);
    return;
  }

  schedulerConfig.enabled = true;
  schedulerConfig.intervalMinutes = intervalMinutes;
  isSchedulerRunning = true;

  // Run immediately
  runAlertChecks();

  // Then run at interval
  schedulerInterval = setInterval(runAlertChecks, intervalMinutes * 60 * 1000);
  
  console.log(`[AlertScheduler] Started with interval ${intervalMinutes} minutes`);
}

/**
 * Stop the scheduler
 */
export function stopAlertScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  isSchedulerRunning = false;
  schedulerConfig.enabled = false;
  console.log(`[AlertScheduler] Stopped`);
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    isRunning: isSchedulerRunning,
    config: schedulerConfig,
    lastRunTime,
    notificationCooldownCount: notificationCooldown.size,
  };
}

/**
 * Update scheduler config
 */
export function updateSchedulerConfig(config: Partial<typeof schedulerConfig>) {
  Object.assign(schedulerConfig, config);
  
  // Restart if interval changed and scheduler is running
  if (config.intervalMinutes && isSchedulerRunning) {
    stopAlertScheduler();
    startAlertScheduler(config.intervalMinutes);
  }
}

/**
 * Manually trigger alert checks
 */
export async function triggerAlertChecks() {
  await runAlertChecks();
  return { success: true, lastRunTime };
}
