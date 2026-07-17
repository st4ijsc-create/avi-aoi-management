import { getDb } from "../db";
import { mqttAlertRules, mqttAlertHistory } from "../../drizzle/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { sendAlertEmail } from "./emailService";
import {
  publishToExternalMqtt,
  getBrokerConnectionState,
  getClientPresenceState,
  computeBrokerDisconnectMinutes,
  computeClientOfflineMinutes,
} from "./mqttService";
import { redisService } from "./redisService";

interface AlertEvaluationResult {
  ruleId: number;
  ruleName: string;
  ruleType: string;
  triggered: boolean;
  currentValue: number;
  thresholdValue: number;
  message: string;
}

// Track last trigger time for cooldown.
// doc 54 P2.3 — this in-memory Map is now only the SINGLE-NODE FALLBACK. When Redis is
// configured, the authoritative cooldown/dedup lives in Redis (atomic SET NX) so the cooldown
// holds ACROSS instances and a triggered alert fires exactly ONCE per cluster per window.
const lastTriggerTimes = new Map<number, number>();

/**
 * doc 54 P2.3 — PURE cooldown decision (Redis-result + local memory → verdict). Extracted so
 * the Redis-vs-memory fallback is unit-testable without any I/O.
 *
 * `redisClaim`: true = this instance atomically claimed the slot (proceed); false = Redis
 * reports the key already held → in cooldown (another instance / a prior tick fired); null =
 * Redis unavailable/errored → fall back to the local memory window below.
 *
 * Returns `proceed` (fire?) and `nextMemoryTs` (the timestamp to write into the fallback Map,
 * kept warm even on the Redis path so a later Redis outage degrades cleanly).
 */
export function decideCooldown(input: {
  redisClaim: boolean | null;
  lastMemoryTs: number | undefined;
  cooldownMs: number;
  now: number;
}): { proceed: boolean; nextMemoryTs?: number } {
  const { redisClaim, lastMemoryTs, cooldownMs, now } = input;
  // cooldown ≤ 0 → no window: fire every time (preserves legacy single-node behaviour).
  if (!(cooldownMs > 0)) return { proceed: true, nextMemoryTs: now };
  if (redisClaim === true) return { proceed: true, nextMemoryTs: now };
  if (redisClaim === false) return { proceed: false };
  // redisClaim === null → Redis absent/errored → local memory window (single-node).
  if (lastMemoryTs !== undefined && now - lastMemoryTs < cooldownMs) return { proceed: false };
  return { proceed: true, nextMemoryTs: now };
}

/**
 * doc 54 P2.3 — claim the trigger slot for a rule. Best-effort Redis atomic claim first (cluster
 * dedup), falling back to the local Map. Returns true if this instance should FIRE the alert.
 */
async function claimTriggerSlot(ruleId: number, cooldownMinutes: number, now: number): Promise<boolean> {
  const cooldownMs = cooldownMinutes * 60 * 1000;
  let redisClaim: boolean | null = null;
  if (cooldownMinutes > 0) {
    try {
      // Key auto-expires after the cooldown window, so the claim IS the cooldown.
      redisClaim = await redisService.acquireCooldown(`alert:cooldown:${ruleId}`, cooldownMinutes * 60);
    } catch {
      redisClaim = null; // any surprise → memory fallback (never break evaluation)
    }
  }
  const decision = decideCooldown({
    redisClaim,
    lastMemoryTs: lastTriggerTimes.get(ruleId),
    cooldownMs,
    now,
  });
  if (decision.nextMemoryTs !== undefined) lastTriggerTimes.set(ruleId, decision.nextMemoryTs);
  return decision.proceed;
}

/**
 * doc 54 P2.3 — WAR-ROOM realtime push. Broadcast a just-triggered alert onto the socket layer
 * so every connected client (incl. the /war-room view) sees it LIVE. Rides the EXISTING unified
 * alert stream via emitAlertEscalation → `alerts:stream` / `alert:escalation`, which the
 * socketRedisAdapter fans out across instances. Best-effort + dynamic import: when the socket
 * server is not initialized (worker/headless/tests) or emit fails, the FE simply keeps its poll
 * — this never throws into the evaluation loop. (The bus event `alert.escalation` is consumed
 * ONLY by the socket re-broadcast normalizer — no DB/escalation side effects.)
 */
async function broadcastAlertToWarRoom(rule: any, result: AlertEvaluationResult): Promise<void> {
  try {
    const socket = await import("../_core/socket");
    if (typeof socket.emitAlertEscalation !== "function") return;
    const severity =
      result.ruleType === "BROKER_DISCONNECT" ||
      result.ruleType === "CLIENT_OFFLINE" ||
      result.ruleType === "MESSAGE_FAILURE_RATE"
        ? "critical"
        : "high";
    socket.emitAlertEscalation({
      alertId: rule.id,
      alertTitle: `MQTT: ${rule.name}`,
      fromLevel: 0,
      toLevel: 1,
      severity,
      reason: result.message,
      escalatedAt: new Date(),
    });
  } catch {
    // best-effort — socket absent / not initialized → FE keeps polling.
  }
}

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

  // Save to history — but only after we hold the DB + the cluster cooldown slot.
  const db = await getDb();
  if (!db) return;

  // doc 54 P2.3 — cluster-wide cooldown/dedup. When Redis is available the claim is ATOMIC
  // (SET NX) so exactly one instance across the cluster proceeds per cooldown window; otherwise
  // it falls back to the in-memory Map (single-node). Claim BEFORE the side effects (history +
  // notifications) so N instances can't all write the same alert.
  const now = Date.now();
  const proceed = await claimTriggerSlot(id, cooldownMinutes, now);
  if (!proceed) {
    console.log(`[Alert Evaluation] Rule ${name} in cooldown, skipping notification`);
    return;
  }

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

  // doc 54 P2.3 — push to the war-room / all connected clients (best-effort, fanned out across
  // instances by the socket Redis adapter). Fire-and-forget: never blocks notifications.
  void broadcastAlertToWarRoom(rule, result);

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
  // doc 54 P2.3 — REAL minutes the external broker has been down, sourced from the
  // connection-state markers tracked in mqttService (connect/close/offline/error events).
  return computeBrokerDisconnectMinutes(getBrokerConnectionState(), Date.now());
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
  // doc 54 P2.3 — REAL minutes with no local device online, from the aedes presence markers
  // (last connect/ping/publish) tracked in mqttService.
  return computeClientOfflineMinutes(getClientPresenceState(), Date.now());
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
