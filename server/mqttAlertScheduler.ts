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
  mqttClientProfiles,
  mqttAlertHistory,
  alertEscalationRules,
  users,
} from "../drizzle/schema";
import { eq, and, gte, lte, sql, isNull, desc, inArray } from "drizzle-orm";
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

// ============================================================
// Escalation sweep (doc 27 MB6 / migration 0186)
//
// Semantics:
//  - Rules live in alert_escalation_rules (severity/alertType filters, NULL = any).
//  - An OPEN alert is: mqtt_connection_alerts not acknowledged & not resolved,
//    or mqtt_alert_history not resolved (it has no ack concept).
//  - When an open alert is older than rule.escalateAfterMin, the sweep CLAIMS it
//    atomically (UPDATE ... SET escalatedAt WHERE escalatedAt IS NULL RETURNING id).
//    Only a successful claim triggers notifications → an alert escalates AT MOST
//    ONCE, ever, even across overlapping rules or concurrent sweeps (no re-storm).
//  - Notification fan-out (best effort, failures logged, never re-tried to avoid storm):
//      1. owner push (notifyOwner)
//      2. retained MQTT notice on avi/escalations/{source}/{id} for mobile clients
//      3. in-app notifications rows for rule.notifyUserIds ∪ users in rule.notifyRoles
//      4. FCM push when the alert is station-scoped (targetType='station') and
//         Firebase is configured — otherwise skipped honestly.
//  - rule.severity only applies to mqtt_connection_alerts (mqtt_alert_history has
//    no severity column); a severity-filtered rule therefore never matches history rows.
// ============================================================

export interface EscalationSweepDeps {
  now?: Date;
  /** Owner push override (tests). */
  notifyOwnerFn?: (n: { title: string; content: string }) => Promise<boolean>;
  /** MQTT publish override (tests). Default: publishLocalMqtt on the Aedes broker. */
  publishMqttFn?: (topic: string, payload: Record<string, any>, opts?: { retain?: boolean }) => Promise<boolean>;
  /** In-app notification insert override (tests). Default: db.createNotification. */
  createNotificationFn?: (data: {
    userId: number; type: "WARNING"; title: string; message: string;
    entityType: string; entityId: number; priority: "HIGH";
  }) => Promise<unknown>;
  /** FCM push override (tests). Default: fcmService.sendCustomPushNotification via station tokens. */
  sendFcmFn?: (stationId: number, title: string, body: string, data: Record<string, string>) => Promise<void>;
}

interface EscalationCandidate {
  source: "conn" | "mqtt";
  id: number;
  severity: string | null;
  title: string;
  message: string | null;
  triggeredAt: Date;
  targetStationId: number | null;
}

const ESCALATION_BATCH_LIMIT = 50; // bound per-sweep work

async function resolveEscalationTargets(db: Awaited<ReturnType<typeof requireDb>>, rule: { notifyRoles: string[]; notifyUserIds: number[] }): Promise<number[]> {
  const ids = new Set<number>((rule.notifyUserIds || []).filter((n) => Number.isInteger(n)));
  const roles = (rule.notifyRoles || []).filter((r) => typeof r === "string" && r.length > 0);
  if (roles.length > 0) {
    const roleUsers = await db.select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, roles as any), eq(users.isActive, true)));
    for (const u of roleUsers) ids.add(u.id);
  }
  return Array.from(ids);
}

async function defaultSendFcm(stationId: number, title: string, body: string, data: Record<string, string>): Promise<void> {
  const { isFCMConfigured, sendCustomPushNotification } = await import("./services/fcmService");
  if (!isFCMConfigured()) return; // honest skip — Firebase not wired
  const { getOfflineMqttClientsWithFcmToken } = await import("./db");
  const clients = await getOfflineMqttClientsWithFcmToken(stationId);
  const tokens = clients.map((c: any) => c.fcmToken).filter((t: any): t is string => !!t);
  if (tokens.length === 0) return;
  await sendCustomPushNotification(tokens, title, body, data);
}

export async function sweepEscalations(deps: EscalationSweepDeps = {}): Promise<{ escalated: number }> {
  const db = await requireDb();
  const now = deps.now ?? new Date();

  const rules = await db.select().from(alertEscalationRules).where(eq(alertEscalationRules.enabled, true));
  if (rules.length === 0) return { escalated: 0 };

  const notify = deps.notifyOwnerFn ?? notifyOwner;
  const publishMqtt = deps.publishMqttFn ?? (async (topic: string, payload: Record<string, any>, opts?: { retain?: boolean }) => {
    const { publishLocalMqtt } = await import("./services/mqttService");
    return publishLocalMqtt(topic, payload, { retain: opts?.retain ?? true, qos: 1 });
  });
  const createNotificationFn = deps.createNotificationFn ?? (async (data) => {
    const { createNotification } = await import("./db");
    return createNotification(data as any);
  });
  const sendFcm = deps.sendFcmFn ?? defaultSendFcm;

  let escalated = 0;

  for (const rule of rules) {
    const cutoff = new Date(now.getTime() - (rule.escalateAfterMin || 15) * 60 * 1000);
    const candidates: EscalationCandidate[] = [];

    // 1. mqtt_connection_alerts — open = not acked AND not resolved
    const connConditions = [
      eq(mqttConnectionAlerts.isAcknowledged, false),
      eq(mqttConnectionAlerts.isResolved, false),
      isNull(mqttConnectionAlerts.escalatedAt),
      lte(mqttConnectionAlerts.triggeredAt, cutoff),
    ];
    if (rule.severity) connConditions.push(eq(mqttConnectionAlerts.severity, rule.severity as any));
    if (rule.alertType) connConditions.push(eq(mqttConnectionAlerts.alertType, rule.alertType as any));

    const connRows = await db.select({
      id: mqttConnectionAlerts.id,
      severity: mqttConnectionAlerts.severity,
      title: mqttConnectionAlerts.title,
      message: mqttConnectionAlerts.message,
      triggeredAt: mqttConnectionAlerts.triggeredAt,
      targetType: mqttConnectionAlerts.targetType,
      targetId: mqttConnectionAlerts.targetId,
    }).from(mqttConnectionAlerts).where(and(...connConditions)).limit(ESCALATION_BATCH_LIMIT);

    for (const r of connRows) {
      candidates.push({
        source: "conn",
        id: r.id,
        severity: r.severity,
        title: r.title,
        message: r.message,
        triggeredAt: r.triggeredAt,
        targetStationId: r.targetType === "station" ? r.targetId : null,
      });
    }

    // 2. mqtt_alert_history — open = not resolved. No severity column: severity-filtered
    //    rules honestly never match this source.
    if (!rule.severity) {
      const histConditions = [
        eq(mqttAlertHistory.isResolved, false),
        isNull(mqttAlertHistory.escalatedAt),
        lte(mqttAlertHistory.triggeredAt, cutoff),
      ];
      if (rule.alertType) histConditions.push(eq(mqttAlertHistory.ruleType, rule.alertType));

      const histRows = await db.select({
        id: mqttAlertHistory.id,
        ruleName: mqttAlertHistory.ruleName,
        message: mqttAlertHistory.message,
        triggeredAt: mqttAlertHistory.triggeredAt,
      }).from(mqttAlertHistory).where(and(...histConditions)).limit(ESCALATION_BATCH_LIMIT);

      for (const r of histRows) {
        candidates.push({
          source: "mqtt",
          id: r.id,
          severity: null,
          title: r.ruleName,
          message: r.message,
          triggeredAt: r.triggeredAt,
          targetStationId: null,
        });
      }
    }

    if (candidates.length === 0) continue;

    const targetUserIds = await resolveEscalationTargets(db, {
      notifyRoles: (rule.notifyRoles as string[]) || [],
      notifyUserIds: (rule.notifyUserIds as number[]) || [],
    });

    for (const cand of candidates) {
      // Atomic once-only claim — the WHERE escalatedAt IS NULL guard is the no-re-storm guarantee.
      const claimed = cand.source === "conn"
        ? await db.update(mqttConnectionAlerts)
            .set({ escalatedAt: now, updatedAt: now })
            .where(and(eq(mqttConnectionAlerts.id, cand.id), isNull(mqttConnectionAlerts.escalatedAt)))
            .returning({ id: mqttConnectionAlerts.id })
        : await db.update(mqttAlertHistory)
            .set({ escalatedAt: now })
            .where(and(eq(mqttAlertHistory.id, cand.id), isNull(mqttAlertHistory.escalatedAt)))
            .returning({ id: mqttAlertHistory.id });

      if (claimed.length === 0) continue; // another sweep/rule already escalated it

      escalated++;
      const ageMin = Math.round((now.getTime() - new Date(cand.triggeredAt).getTime()) / 60000);
      const alertRef = `${cand.source}-${cand.id}`;
      const title = `⏫ Escalated: ${cand.title}`;
      const content = `Alert ${alertRef} unhandled for ${ageMin} min (rule "${rule.name}", threshold ${rule.escalateAfterMin} min).${cand.message ? ` ${cand.message}` : ""}`;

      // 1. Owner push — best effort, never blocks the claim
      try {
        await notify({ title, content: content.substring(0, 1000) });
      } catch (err) {
        console.error(`[AlertScheduler] Escalation notifyOwner failed for ${alertRef}:`, err);
      }

      // 2. Retained MQTT notice for FactoryAlertSystem mobile clients
      try {
        await publishMqtt(`avi/escalations/${cand.source}/${cand.id}`, {
          type: "ALERT_ESCALATION",
          alertId: alertRef,
          source: cand.source,
          severity: cand.severity || "critical",
          title: cand.title,
          message: cand.message || "",
          ruleId: rule.id,
          ruleName: rule.name,
          escalateAfterMin: rule.escalateAfterMin,
          triggeredAt: cand.triggeredAt.toISOString(),
          escalatedAt: now.toISOString(),
        }, { retain: true });
      } catch (err) {
        console.error(`[AlertScheduler] Escalation MQTT publish failed for ${alertRef}:`, err);
      }

      // 3. In-app notifications for escalation targets
      for (const userId of targetUserIds) {
        try {
          await createNotificationFn({
            userId,
            type: "WARNING",
            title,
            message: content.substring(0, 1000),
            entityType: cand.source === "conn" ? "mqtt_connection_alert" : "mqtt_alert",
            entityId: cand.id,
            priority: "HIGH",
          });
        } catch (err) {
          console.error(`[AlertScheduler] Escalation in-app notification failed (user ${userId}, ${alertRef}):`, err);
        }
      }

      // 4. FCM push — only when the alert is station-scoped and FCM is configured
      if (cand.targetStationId != null) {
        try {
          await sendFcm(cand.targetStationId, title, content.substring(0, 500), {
            type: "ALERT_ESCALATION",
            alertId: alertRef,
            escalatedAt: now.toISOString(),
          });
        } catch (err) {
          console.error(`[AlertScheduler] Escalation FCM push failed for ${alertRef}:`, err);
        }
      }
    }
  }

  if (escalated > 0) {
    console.log(`[AlertScheduler] Escalation sweep: ${escalated} alert(s) escalated`);
  }
  return { escalated };
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

    // Escalation sweep (doc 27 MB6) — escalates each open alert at most once
    try {
      await sweepEscalations();
    } catch (escalationError) {
      console.error(`[AlertScheduler] Escalation sweep failed:`, escalationError);
    }

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
