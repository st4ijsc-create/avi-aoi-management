import { getDb } from "../db";
import { mqttAlertRules, mqttAlertHistory } from "../../drizzle/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { sendAlertEmail } from "./emailService";
import { publishToExternalMqtt } from "./mqttService";

interface AlertEvaluationResult {
  ruleId: number;
  ruleName: string;
  ruleType: string;
  triggered: boolean;
  currentValue: number;
  thresholdValue: number;
  message: string;
}

// Track last trigger time for cooldown
const lastTriggerTimes = new Map<number, number>();

export async function evaluateAllAlertRules(): Promise<AlertEvaluationResult[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Alert Evaluation] Database not available");
    return [];
  }

  const rules = await db
    .select()
    .from(mqttAlertRules)
    .where(eq(mqttAlertRules.isEnabled, true));

  const results: AlertEvaluationResult[] = [];

  for (const rule of rules) {
    try {
      const result = await evaluateRule(rule);
      results.push(result);

      if (result.triggered) {
        await handleTriggeredAlert(rule, result);
      }
    } catch (error) {
      console.error(`[Alert Evaluation] Error evaluating rule ${rule.id}:`, error);
    }
  }

  return results;
}

async function evaluateRule(rule: any): Promise<AlertEvaluationResult> {
  const { id, name, ruleType, thresholdValue, comparisonOperator, timeWindowMinutes } = rule;

  let currentValue = 0;
  let triggered = false;
  let message = "";

  switch (ruleType) {
    case "LATENCY_THRESHOLD":
      currentValue = await getAverageLatency(timeWindowMinutes);
      triggered = compareValues(currentValue, thresholdValue, comparisonOperator);
      message = `Độ trễ trung bình ${currentValue.toFixed(2)}ms ${getOperatorText(comparisonOperator)} ngưỡng ${thresholdValue}ms`;
      break;

    case "BROKER_DISCONNECT":
      currentValue = await getBrokerDisconnectDuration();
      triggered = compareValues(currentValue, thresholdValue, comparisonOperator);
      message = `External broker đã ngắt kết nối ${currentValue.toFixed(0)} phút`;
      break;

    case "MESSAGE_FAILURE_RATE":
      currentValue = await getMessageFailureRate(timeWindowMinutes);
      triggered = compareValues(currentValue, thresholdValue, comparisonOperator);
      message = `Tỷ lệ message thất bại ${currentValue.toFixed(2)}% ${getOperatorText(comparisonOperator)} ngưỡng ${thresholdValue}%`;
      break;

    case "THROUGHPUT_LOW":
      currentValue = await getThroughput(timeWindowMinutes);
      triggered = compareValues(currentValue, thresholdValue, comparisonOperator);
      message = `Throughput ${currentValue.toFixed(0)} msg/min ${getOperatorText(comparisonOperator)} ngưỡng ${thresholdValue} msg/min`;
      break;

    case "THROUGHPUT_HIGH":
      currentValue = await getThroughput(timeWindowMinutes);
      triggered = compareValues(currentValue, thresholdValue, comparisonOperator);
      message = `Throughput ${currentValue.toFixed(0)} msg/min ${getOperatorText(comparisonOperator)} ngưỡng ${thresholdValue} msg/min (có thể spam)`;
      break;

    case "CLIENT_OFFLINE":
      currentValue = await getClientOfflineDuration();
      triggered = compareValues(currentValue, thresholdValue, comparisonOperator);
      message = `Client offline ${currentValue.toFixed(0)} phút`;
      break;

    default:
      message = `Unknown rule type: ${ruleType}`;
  }

  return {
    ruleId: id,
    ruleName: name,
    ruleType,
    triggered,
    currentValue,
    thresholdValue: parseFloat(thresholdValue),
    message,
  };
}

async function handleTriggeredAlert(rule: any, result: AlertEvaluationResult) {
  // doc 54 P2.1 — the `notifyOwner` rule BOOLEAN shadowed the imported notifyOwner()
  // FUNCTION → `await notifyOwner({...})` below threw "not a function" every time and was
  // swallowed by the catch, so owner notifications NEVER sent. Rename the flag.
  const { id, name, cooldownMinutes, notifyOwner: notifyOwnerEnabled, notifyEmail, notifyMqtt } = rule;

  // Check cooldown
  const lastTrigger = lastTriggerTimes.get(id);
  const now = Date.now();
  if (lastTrigger && now - lastTrigger < cooldownMinutes * 60 * 1000) {
    console.log(`[Alert Evaluation] Rule ${name} in cooldown, skipping notification`);
    return;
  }

  // Save to history
  const db = await getDb();
  if (!db) return;

  await db.insert(mqttAlertHistory).values({
    ruleId: id,
    ruleName: name,
    ruleType: result.ruleType,
    triggeredValue: result.currentValue.toString(),
    thresholdValue: result.thresholdValue.toString(),
    message: result.message,
    isResolved: false,
    triggeredAt: new Date(),
  });

  // Update last trigger time
  lastTriggerTimes.set(id, now);

  // Send notifications
  if (notifyOwnerEnabled) {
    try {
      await notifyOwner({
        title: `🚨 MQTT Alert: ${name}`,
        content: result.message,
      });
    } catch (error) {
      console.error(`[Alert Evaluation] Failed to notify owner:`, error);
    }
  }

  if (notifyEmail) {
    try {
      await sendAlertEmail({
        ruleName: name,
        ruleType: result.ruleType,
        message: result.message,
        currentValue: result.currentValue,
        thresholdValue: result.thresholdValue,
      });
    } catch (error) {
      console.error(`[Alert Evaluation] Failed to send email:`, error);
    }
  }

  if (notifyMqtt) {
    try {
      await publishToExternalMqtt("alerts", JSON.stringify({
        ruleName: name,
        ruleType: result.ruleType,
        message: result.message,
        currentValue: result.currentValue,
        thresholdValue: result.thresholdValue,
        triggeredAt: new Date().toISOString(),
      }));
    } catch (error) {
      console.error(`[Alert Evaluation] Failed to publish to MQTT:`, error);
    }
  }
}

function compareValues(current: number, threshold: number, operator: string): boolean {
  switch (operator) {
    case "GT":
      return current > threshold;
    case "GTE":
      return current >= threshold;
    case "LT":
      return current < threshold;
    case "LTE":
      return current <= threshold;
    case "EQ":
      return current === threshold;
    default:
      return false;
  }
}

function getOperatorText(operator: string): string {
  switch (operator) {
    case "GT":
      return ">";
    case "GTE":
      return ">=";
    case "LT":
      return "<";
    case "LTE":
      return "<=";
    case "EQ":
      return "=";
    default:
      return operator;
  }
}

// Helper functions to get metrics
async function getAverageLatency(minutes: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const since = new Date(Date.now() - minutes * 60 * 1000);
  const sinceStr = since.toISOString();
  
  const result = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM ("deliveredAt" - "createdAt")) * 1000.0) as avg_latency
    FROM mqtt_message_logs
    WHERE "createdAt" >= ${sinceStr}
      AND "deliveredAt" IS NOT NULL
      AND "deliveryStatus" = 'DELIVERED'
  `);

  const rows = (result as unknown as { rows: any[] }).rows || [];
  return rows[0]?.avg_latency || 0;
}

async function getBrokerDisconnectDuration(): Promise<number> {
  // This would need to track external broker connection state
  // For now, return 0 (connected)
  // TODO: Implement proper tracking in mqttService
  return 0;
}

async function getMessageFailureRate(minutes: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const since = new Date(Date.now() - minutes * 60 * 1000);
  const sinceStr = since.toISOString();
  
  const result = await db.execute(sql`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN "deliveryStatus" = 'FAILED' THEN 1 ELSE 0 END) as failed
    FROM mqtt_message_logs
    WHERE "createdAt" >= ${sinceStr}
  `);

  const rows = (result as unknown as { rows: any[] }).rows || [];
  const total = parseInt(rows[0]?.total || "0");
  const failed = parseInt(rows[0]?.failed || "0");
  
  return total > 0 ? (failed / total) * 100 : 0;
}

async function getThroughput(minutes: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const since = new Date(Date.now() - minutes * 60 * 1000);
  const sinceStr = since.toISOString();
  
  const result = await db.execute(sql`
    SELECT COUNT(*) as count
    FROM mqtt_message_logs
    WHERE "createdAt" >= ${sinceStr}
  `);

  const rows = (result as unknown as { rows: any[] }).rows || [];
  const count = parseInt(rows[0]?.count || "0");
  
  return count / minutes; // messages per minute
}

async function getClientOfflineDuration(): Promise<number> {
  // This would need to track client last seen time
  // For now, return 0 (online)
  // TODO: Implement proper tracking in mqttService
  return 0;
}

// Start background job
let evaluationInterval: NodeJS.Timeout | null = null;

export function startAlertEvaluationJob(intervalMinutes: number = 1) {
  if (evaluationInterval) {
    console.log("[Alert Evaluation] Job already running");
    return;
  }

  console.log(`[Alert Evaluation] Starting job (interval: ${intervalMinutes} minute(s))`);
  
  // Run immediately on start
  evaluateAllAlertRules().catch(error => {
    console.error("[Alert Evaluation] Initial evaluation failed:", error);
  });

  // Then run on interval
  evaluationInterval = setInterval(() => {
    evaluateAllAlertRules().catch(error => {
      console.error("[Alert Evaluation] Evaluation failed:", error);
    });
  }, intervalMinutes * 60 * 1000);
}

export function stopAlertEvaluationJob() {
  if (evaluationInterval) {
    clearInterval(evaluationInterval);
    evaluationInterval = null;
    console.log("[Alert Evaluation] Job stopped");
  }
}
