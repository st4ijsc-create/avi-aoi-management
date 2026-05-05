import { getDb } from "../db/connection";
import {
  productInspections,
  users,
  dailyStatistics,
  predictiveAlerts,
} from "../../drizzle/schema";
import { eq, and, gte, sql, inArray, lt } from "drizzle-orm";
import { sendAlertNotification } from "./notificationService";
import { sendAlertEmail } from "./emailService";

// ─── Types ───────────────────────────────────────────────────────────────────

type AlertType =
  | "DEFECT_SPIKE"
  | "YIELD_DROP"
  | "MACHINE_FAILURE"
  | "QUALITY_DEGRADATION"
  | "PATTERN_ANOMALY";

type EscalationLevel = "L1" | "L2" | "L3";

interface SmartAlertEvent {
  type: AlertType;
  machineId?: number;
  factoryId?: number;
  productModelId?: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  message: string;
  data: Record<string, unknown>;
}

interface RouteTarget {
  userId: number;
  username: string;
  role: string;
  email: string | null;
  reason: string;
}

interface RoutingResult {
  alertType: AlertType;
  targets: RouteTarget[];
  consolidated: boolean;
  consolidationGroup?: string;
  escalationLevel: EscalationLevel;
  suggestedAction?: string;
}

// ─── Cooldown & De-duplication ───────────────────────────────────────────────

const recentAlerts = new Map<string, { timestamp: number; count: number }>();
const CONSOLIDATION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const ESCALATION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Track pending alerts for auto-escalation
const pendingAlerts = new Map<
  number,
  { createdAt: number; escalationLevel: EscalationLevel; event: SmartAlertEvent }
>();

// ─── Main Routing Logic ──────────────────────────────────────────────────────

export async function routeAlert(event: SmartAlertEvent): Promise<RoutingResult> {
  const db = await getDb();
  if (!db) {
    return { alertType: event.type, targets: [], consolidated: false, escalationLevel: "L1" };
  }

  // Step 1: Check consolidation — same root cause?
  const consolidationKey = buildConsolidationKey(event);
  const existing = recentAlerts.get(consolidationKey);
  const now = Date.now();
  let consolidated = false;

  if (existing && now - existing.timestamp < CONSOLIDATION_WINDOW_MS) {
    existing.count += 1;
    consolidated = true;
    // Don't send duplicate alerts within window, just update count
    if (existing.count > 3) {
      return {
        alertType: event.type,
        targets: [],
        consolidated: true,
        consolidationGroup: consolidationKey,
        escalationLevel: "L1",
        suggestedAction: `${existing.count} similar alerts consolidated. Root cause investigation recommended.`,
      };
    }
  } else {
    recentAlerts.set(consolidationKey, { timestamp: now, count: 1 });
  }

  // Step 2: Determine targets based on alert type
  const targets = await determineTargets(db, event);

  // Step 3: Check patterns for recurring alerts
  const suggestedAction = await checkPatterns(db, event);

  // Step 3.5: AI reasoning enrichment (non-blocking)
  const aiReasoning = await enrichRoutingWithAI(event, targets, suggestedAction)
    .catch(() => null);

  // Step 4: Send notifications
  for (const target of targets) {
    await sendSmartNotification(target, event);
  }

  // Build AI analysis payload
  const aiAnalysisPayload: Record<string, unknown> = {
    factors: [],
    recommendations: suggestedAction ? [suggestedAction] : [],
    dataPoints: 0,
    modelUsed: "smart-alert-router",
  };

  if (aiReasoning) {
    aiAnalysisPayload.reasoning = aiReasoning.reasoning;
    aiAnalysisPayload.suggestedRootCause = aiReasoning.suggestedRootCause;
    aiAnalysisPayload.urgencyExplanation = aiReasoning.urgencyExplanation;
    aiAnalysisPayload.recommendations = [
      ...(suggestedAction ? [suggestedAction] : []),
      ...aiReasoning.recommendations,
    ];
    aiAnalysisPayload.modelUsed = "smart-alert-router+gguf";
  }

  // Step 5: Record in predictive_alerts table
  const [alertRecord] = await db
    .insert(predictiveAlerts)
    .values({
      alertType: event.type,
      severity: event.severity,
      title: `${event.type.replace(/_/g, " ")}: ${event.severity}`,
      description: event.message,
      machineId: event.machineId ?? null,
      factoryId: event.factoryId ?? null,
      productModelId: event.productModelId ?? null,
      currentValue: event.data.currentValue ? String(event.data.currentValue) : null,
      threshold: event.data.threshold ? String(event.data.threshold) : null,
      confidenceScore: event.data.confidence ? String(event.data.confidence) : null,
      aiAnalysis: aiAnalysisPayload,
      status: "ACTIVE",
      notificationSent: true,
      notificationSentAt: new Date(),
    })
    .returning({ id: predictiveAlerts.id });

  // Track for auto-escalation
  if (alertRecord) {
    pendingAlerts.set(alertRecord.id, {
      createdAt: now,
      escalationLevel: "L1",
      event,
    });
  }

  return {
    alertType: event.type,
    targets,
    consolidated,
    consolidationGroup: consolidated ? consolidationKey : undefined,
    escalationLevel: "L1",
    suggestedAction: aiReasoning?.reasoning || suggestedAction || undefined,
  };
}

// ─── Target Determination ────────────────────────────────────────────────────

async function determineTargets(db: any, event: SmartAlertEvent): Promise<RouteTarget[]> {
  const targets: RouteTarget[] = [];

  switch (event.type) {
    case "DEFECT_SPIKE": {
      // Route to machine operator + supervisor
      const operators = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.role, ["operator" as const, "supervisor" as const]));

      for (const u of operators) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: u.role === "operator"
            ? `Operator — defect spike on machine #${event.machineId ?? "all"}`
            : `Supervisor oversight — defect spike on machine #${event.machineId ?? "all"}`,
        });
      }
      break;
    }

    case "YIELD_DROP": {
      // Route to quality inspectors
      const qualityEngineers = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(eq(users.role, "quality_inspector"));

      for (const u of qualityEngineers) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: `Quality inspector — yield drop${event.factoryId ? ` at factory #${event.factoryId}` : ""}`,
        });
      }
      break;
    }

    case "MACHINE_FAILURE": {
      // Route to maintenance team
      const maintenanceTeam = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(eq(users.role, "maintenance"));

      for (const u of maintenanceTeam) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: `Maintenance technician — machine failure prediction${event.machineId ? ` for machine #${event.machineId}` : ""}`,
        });
      }
      break;
    }

    case "QUALITY_DEGRADATION":
    case "PATTERN_ANOMALY":
    default: {
      // Route to admins and supervisors
      const admins = await db
        .select({
          userId: users.id,
          username: users.username,
          role: users.role,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.role, ["admin" as const, "supervisor" as const]));

      for (const u of admins) {
        targets.push({
          userId: u.userId,
          username: u.username,
          role: u.role,
          email: u.email,
          reason: `${u.role === "admin" ? "Admin" : "Supervisor"} — ${event.type.replace(/_/g, " ").toLowerCase()} alert`,
        });
      }
      break;
    }
  }

  return targets;
}

// ─── Escalation Engine ───────────────────────────────────────────────────────

export async function processAutoEscalation(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const now = Date.now();
  let escalatedCount = 0;

  for (const [alertId, pending] of pendingAlerts.entries()) {
    if (now - pending.createdAt < ESCALATION_TIMEOUT_MS) {
      continue;
    }

    // Check if already acknowledged
    const [record] = await db
      .select({ acknowledgedAt: predictiveAlerts.acknowledgedAt })
      .from(predictiveAlerts)
      .where(eq(predictiveAlerts.id, alertId))
      .limit(1);

    if (record?.acknowledgedAt) {
      pendingAlerts.delete(alertId);
      continue;
    }

    // Escalate
    const nextLevel = getNextEscalationLevel(pending.escalationLevel);
    if (!nextLevel) {
      pendingAlerts.delete(alertId);
      continue;
    }

    const escalationTargets = await getEscalationTargets(db, nextLevel);
    for (const target of escalationTargets) {
      await sendSmartNotification(target, pending.event, true);
    }

    // Update status to ACKNOWLEDGED to mark escalation happened
    await db
      .update(predictiveAlerts)
      .set({ updatedAt: new Date() })
      .where(eq(predictiveAlerts.id, alertId));

    pending.escalationLevel = nextLevel;
    pending.createdAt = now; // Reset timer for next escalation
    escalatedCount++;
  }

  return escalatedCount;
}

function getNextEscalationLevel(current: EscalationLevel): EscalationLevel | null {
  switch (current) {
    case "L1": return "L2";
    case "L2": return "L3";
    case "L3": return null;
  }
}

async function getEscalationTargets(db: any, level: EscalationLevel): Promise<RouteTarget[]> {
  const roleFilter = level === "L2"
    ? ["supervisor" as const]
    : ["admin" as const];

  const escalationUsers = await db
    .select({
      userId: users.id,
      username: users.username,
      role: users.role,
      email: users.email,
    })
    .from(users)
    .where(inArray(users.role, roleFilter));

  return escalationUsers.map((u: any) => ({
    userId: u.userId,
    username: u.username,
    role: u.role,
    email: u.email,
    reason: `Auto-escalation (${level}) — alert unacknowledged >30 minutes`,
  }));
}

// ─── Pattern Recognition ─────────────────────────────────────────────────────

async function checkPatterns(
  db: any,
  event: SmartAlertEvent
): Promise<string | null> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT 
      EXTRACT(DOW FROM ${predictiveAlerts.createdAt}) as day_of_week,
      EXTRACT(HOUR FROM ${predictiveAlerts.createdAt}) as hour_of_day,
      COUNT(*) as occurrences
    FROM ${predictiveAlerts}
    WHERE ${predictiveAlerts.alertType} = ${event.type}
      AND ${predictiveAlerts.createdAt} >= ${thirtyDaysAgo}
      ${event.machineId ? sql`AND ${predictiveAlerts.machineId} = ${event.machineId}` : sql``}
    GROUP BY day_of_week, hour_of_day
    HAVING COUNT(*) >= 4
    ORDER BY occurrences DESC
    LIMIT 3
  `) as any;

  const rows = result.rows ?? [];
  if (rows.length === 0) return null;

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const top = rows[0];
  const dayIdx = Number(top.day_of_week);
  const hour = Number(top.hour_of_day);
  const count = Number(top.occurrences);

  return `Recurring pattern detected: This alert occurs frequently on ${dayNames[dayIdx]}s around ${hour}:00 (${count} times in 30 days). Consider investigating a permanent fix.`;
}

// ─── Acknowledge Alert ───────────────────────────────────────────────────────

export async function acknowledgeAlert(
  alertId: number,
  userId: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(predictiveAlerts)
    .set({
      acknowledgedAt: new Date(),
      acknowledgedBy: userId,
      status: "ACKNOWLEDGED",
    })
    .where(eq(predictiveAlerts.id, alertId));

  pendingAlerts.delete(alertId);
  return true;
}

// ─── AI Reasoning Layer ──────────────────────────────────────────────────────

interface AiRoutingReasoning {
  reasoning: string;
  suggestedRootCause: string;
  urgencyExplanation: string;
  recommendations: string[];
}

/**
 * Non-blocking GGUF reasoning for smart alert routing.
 * Provides context-aware explanation of severity, root cause hypothesis,
 * and actionable recommendations.
 */
async function enrichRoutingWithAI(
  event: SmartAlertEvent,
  targets: RouteTarget[],
  patternSuggestion: string | null
): Promise<AiRoutingReasoning | null> {
  try {
    const { generateText } = await import("./aiGgufEngine");

    const prompt = `Manufacturing alert routing analysis:
- Alert Type: ${event.type}
- Severity: ${event.severity}
- Message: ${event.message}
- Data: ${JSON.stringify(event.data)}
- Routed to: ${targets.map(t => `${t.role} (${t.reason})`).join("; ") || "No targets"}
- Historical pattern: ${patternSuggestion || "No recurring pattern detected"}

Analyze this alert and respond in JSON format:
{
  "reasoning": "Why this severity level is appropriate and who should handle it",
  "suggestedRootCause": "Most likely root cause based on alert type and data",
  "urgencyExplanation": "How urgent this is and what happens if not addressed",
  "recommendations": ["Immediate action 1", "Follow-up action 2"]
}`;

    const result = await generateText({
      systemPrompt:
        "You are an expert alert routing system in a manufacturing factory with AOI inspection. " +
        "Analyze alerts and provide concise, actionable reasoning for routing decisions. Be specific to manufacturing context.",
      prompt,
      maxTokens: 256,
      temperature: 0.3,
      jsonMode: true,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      reasoning: parsed.reasoning || "",
      suggestedRootCause: parsed.suggestedRootCause || "",
      urgencyExplanation: parsed.urgencyExplanation || "",
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 5) : [],
    };
  } catch (err) {
    console.log("[SmartAlert] AI reasoning skipped:", (err as Error).message);
    return null;
  }
}

// ─── Defect Spike Detection ──────────────────────────────────────────────────

export async function detectDefectSpike(
  machineId: number,
  windowMinutes: number = 30,
  spikeThreshold: number = 2.0 // 2x above average = spike
): Promise<SmartAlertEvent | null> {
  const db = await getDb();
  if (!db) return null;

  const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
  const baselineStart = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Recent NG count in window
  const [recent] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(productInspections)
    .where(
      and(
        eq(productInspections.machineId, machineId),
        eq(productInspections.overallResult, "NG"),
        gte(productInspections.createdAt, windowStart)
      )
    );

  // 24h baseline average per same window length
  const [baseline] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(productInspections)
    .where(
      and(
        eq(productInspections.machineId, machineId),
        eq(productInspections.overallResult, "NG"),
        gte(productInspections.createdAt, baselineStart)
      )
    );

  const recentCount = Number(recent?.count ?? 0);
  const baselineCount = Number(baseline?.count ?? 0);
  const baselinePerWindow = baselineCount / (24 * 60 / windowMinutes);

  if (baselinePerWindow > 0 && recentCount >= baselinePerWindow * spikeThreshold) {
    return {
      type: "DEFECT_SPIKE",
      machineId,
      severity: recentCount >= baselinePerWindow * 3 ? "CRITICAL" : "HIGH",
      message: `Defect spike on machine #${machineId}: ${recentCount} NG in last ${windowMinutes}min (baseline ~${baselinePerWindow.toFixed(1)}/window)`,
      data: { recentCount, baselinePerWindow, spikeRatio: recentCount / baselinePerWindow },
    };
  }

  return null;
}

// ─── Yield Drop Detection ────────────────────────────────────────────────────

export async function detectYieldDrop(
  factoryId: number,
  dropThresholdPercent: number = 5.0
): Promise<SmartAlertEvent | null> {
  const db = await getDb();
  if (!db) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  // Today's yield from dailyStatistics
  const [todayStats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)`,
      ok: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)`,
    })
    .from(dailyStatistics)
    .where(
      and(
        eq(dailyStatistics.factoryId, factoryId),
        gte(dailyStatistics.date, today)
      )
    );

  // Yesterday's yield
  const [yesterdayStats] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)`,
      ok: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)`,
    })
    .from(dailyStatistics)
    .where(
      and(
        eq(dailyStatistics.factoryId, factoryId),
        gte(dailyStatistics.date, yesterday),
        lt(dailyStatistics.date, today)
      )
    );

  const todayTotal = Number(todayStats?.total ?? 0);
  const todayOk = Number(todayStats?.ok ?? 0);
  const yesterdayTotal = Number(yesterdayStats?.total ?? 0);
  const yesterdayOk = Number(yesterdayStats?.ok ?? 0);

  if (todayTotal < 10 || yesterdayTotal < 10) return null; // Not enough data

  const todayYield = (todayOk / todayTotal) * 100;
  const yesterdayYield = (yesterdayOk / yesterdayTotal) * 100;
  const drop = yesterdayYield - todayYield;

  if (drop >= dropThresholdPercent) {
    return {
      type: "YIELD_DROP",
      factoryId,
      severity: drop >= 10 ? "CRITICAL" : drop >= 7 ? "HIGH" : "MEDIUM",
      message: `Yield dropped ${drop.toFixed(1)}% at factory #${factoryId}: ${todayYield.toFixed(1)}% today vs ${yesterdayYield.toFixed(1)}% yesterday`,
      data: { todayYield, yesterdayYield, drop, todayTotal, yesterdayTotal },
    };
  }

  return null;
}

// ─── Get Routing Stats ───────────────────────────────────────────────────────

export async function getAlertRoutingStats(days: number = 7) {
  const db = await getDb();
  if (!db) {
    return { totalAlerts: 0, byType: [], avgAckTimeMinutes: 0, pendingCount: 0 };
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byType = await db
    .select({
      alertType: predictiveAlerts.alertType,
      count: sql<number>`COUNT(*)`,
    })
    .from(predictiveAlerts)
    .where(gte(predictiveAlerts.createdAt, since))
    .groupBy(predictiveAlerts.alertType);

  const [ackTime] = await db
    .select({
      avgMinutes: sql<number>`AVG(EXTRACT(EPOCH FROM (${predictiveAlerts.acknowledgedAt} - ${predictiveAlerts.createdAt})) / 60)`,
    })
    .from(predictiveAlerts)
    .where(
      and(
        gte(predictiveAlerts.createdAt, since),
        sql`${predictiveAlerts.acknowledgedAt} IS NOT NULL`
      )
    );

  const [total] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(predictiveAlerts)
    .where(gte(predictiveAlerts.createdAt, since));

  return {
    totalAlerts: Number(total?.count ?? 0),
    byType: byType.map((r: any) => ({ type: r.alertType, count: Number(r.count) })),
    avgAckTimeMinutes: Number(ackTime?.avgMinutes ?? 0),
    pendingCount: pendingAlerts.size,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildConsolidationKey(event: SmartAlertEvent): string {
  return `${event.type}:${event.machineId ?? "all"}:${event.factoryId ?? "all"}`;
}

async function sendSmartNotification(
  target: RouteTarget,
  event: SmartAlertEvent,
  isEscalation: boolean = false
) {
  const prefix = isEscalation ? "[ESCALATED] " : "";
  const title = `${prefix}${event.severity} Alert: ${event.type.replace(/_/g, " ")}`;

  try {
    await sendAlertNotification(target.userId, {
      title,
      message: `${event.message}\nRouted to you because: ${target.reason}`,
      priority: event.severity === "CRITICAL" ? "URGENT" : event.severity === "HIGH" ? "HIGH" : "NORMAL",
    });
  } catch (error) {
    console.error(`[Smart Alert] Failed to notify user ${target.username}:`, error);
  }

  if (target.email && (event.severity === "HIGH" || event.severity === "CRITICAL")) {
    try {
      await sendAlertEmail({
        ruleName: event.type,
        ruleType: event.type,
        message: `${prefix}${event.message}\nRouted because: ${target.reason}`,
        currentValue: 0,
        thresholdValue: 0,
      });
    } catch (error) {
      console.error(`[Smart Alert] Failed to email ${target.email}:`, error);
    }
  }
}

// ─── Cleanup stale entries ───────────────────────────────────────────────────

export function cleanupStaleAlerts(): void {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [key, entry] of recentAlerts.entries()) {
    if (now - entry.timestamp > maxAge) {
      recentAlerts.delete(key);
    }
  }

  for (const [alertId, pending] of pendingAlerts.entries()) {
    if (now - pending.createdAt > maxAge) {
      pendingAlerts.delete(alertId);
    }
  }
}
