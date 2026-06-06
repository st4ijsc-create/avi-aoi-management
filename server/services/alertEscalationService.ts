import { sql, and, eq, lt, isNull, or } from "drizzle-orm";
import { getDb } from "../db";
import { predictiveAlerts, alertEscalations } from "../../drizzle/schema";
import { emitAlertEscalation } from "../_core/socket";

// Minutes before escalation per severity and level
const ESCALATION_MINUTES: Record<string, number[]> = {
  LOW:      [120, 360, 720], // L0→L1 at 2h, L1→L2 at 6h, L2→L3 at 12h
  MEDIUM:   [30,  90,  240], // L0→L1 at 30m, L1→L2 at 90m, L2→L3 at 4h
  HIGH:     [15,  30,   60], // L0→L1 at 15m, L1→L2 at 30m, L2→L3 at 1h
  CRITICAL: [ 5,  10,   20], // L0→L1 at 5m,  L1→L2 at 10m, L2→L3 at 20m
};

const ESCALATION_REASONS = [
  "No acknowledgement within SLA window — escalated to supervisor",
  "Still unacknowledged — escalated to manager",
  "Critical alert unresolved — escalated to executive",
];

let _timer: ReturnType<typeof setInterval> | null = null;

export async function runEscalationCycle(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  // Fetch all ACTIVE unacknowledged alerts with escalationLevel < 3
  const alerts = await db.select().from(predictiveAlerts)
    .where(
      and(
        eq(predictiveAlerts.status, "ACTIVE"),
        isNull(predictiveAlerts.acknowledgedAt),
        // escalationLevel < 3  (drizzle uses sql for <)
        sql`${predictiveAlerts.escalationLevel} < 3`,
      ),
    );

  for (const alert of alerts) {
    const severity = alert.severity ?? "MEDIUM";
    const thresholds = ESCALATION_MINUTES[severity] ?? ESCALATION_MINUTES.MEDIUM;
    const currentLevel = alert.escalationLevel ?? 0;
    const threshold = thresholds[currentLevel];
    if (threshold === undefined) continue;

    // Reference time: lastEscalatedAt if escalated before, else createdAt
    const refTime = alert.lastEscalatedAt ?? alert.createdAt;
    const elapsedMinutes = (now.getTime() - refTime.getTime()) / 60_000;

    if (elapsedMinutes < threshold) continue;

    const toLevel = currentLevel + 1;
    const reason = ESCALATION_REASONS[currentLevel] ?? "Alert escalated";

    // Update predictiveAlerts
    await db.update(predictiveAlerts)
      .set({
        escalationLevel: toLevel,
        lastEscalatedAt: now,
        updatedAt: now,
      })
      .where(eq(predictiveAlerts.id, alert.id));

    // Insert escalation log
    await db.insert(alertEscalations).values({
      alertId: alert.id,
      fromLevel: currentLevel,
      toLevel,
      reason,
      notifiedUserIds: [],
      escalatedAt: now,
    });

    // Emit real-time notification
    emitAlertEscalation({
      alertId: alert.id,
      alertTitle: alert.title,
      fromLevel: currentLevel,
      toLevel,
      severity,
      reason,
      machineId: alert.machineId ?? undefined,
      escalatedAt: now,
    });
  }
}

export function startEscalationScheduler(intervalMs = 60_000): void {
  if (_timer) return; // already running
  console.log(`[AlertEscalation] Scheduler started (interval: ${intervalMs / 1000}s)`);
  _timer = setInterval(async () => {
    try {
      await runEscalationCycle();
    } catch (err) {
      console.error("[AlertEscalation] Cycle error:", err);
    }
  }, intervalMs);
}

export function stopEscalationScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log("[AlertEscalation] Scheduler stopped");
  }
}
