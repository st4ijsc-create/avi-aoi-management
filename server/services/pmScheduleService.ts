/**
 * W4-A (doc 35 §W4.2) — Preventive-maintenance auto-scheduler.
 *
 * Closes the orphan gap: maintenance_schedules (mes.ts) carries scheduleType /
 * intervalDays / nextDueAt / lastPerformedAt, and maintenance_work_orders carries
 * a scheduleId FK + a trigger='SCHEDULE' enum value — but NOTHING ever read
 * nextDueAt to auto-generate a PREVENTIVE work order. Those columns were dead.
 *
 * This periodic job scans active schedules whose nextDueAt has passed and, for
 * each, generates ONE PREVENTIVE / OPEN work order (trigger='SCHEDULE',
 * scheduleId=the schedule) — finally using those columns — then advances
 * lastPerformedAt / nextDueAt by the schedule interval so it does not re-fire.
 *
 * ── DESIGN ───────────────────────────────────────────────────────────────────
 *   • Gated behind PM_SCHEDULE_GEN_ENABLED (default false). No-op when off.
 *   • IDEMPOTENT: skips generation when an OPEN-ish (OPEN / SCHEDULED /
 *     IN_PROGRESS / ON_HOLD) work order already exists for that scheduleId — a
 *     schedule that stays overdue across ticks yields ONE work order, not one per
 *     tick. The nextDueAt advance is the second guard.
 *   • Reuses the WO insert shape from pdmAutoWorkOrderService (same columns).
 *   • Fail-safe: per-schedule try/catch — one bad schedule never aborts the sweep.
 *     Unref'd non-overlapping timer (mirrors pdmWorkOrderService).
 *
 * SAFETY: pure maintenance master-data + WO lifecycle. NOTHING here writes a
 * value to a machine (no commandDispatcher / driver.writeTags). getDb()-guarded.
 */
import { and, eq, lte, isNotNull, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { logger } from "../logger";
import { maintenanceSchedules, maintenanceWorkOrders } from "../../drizzle/schema";

export const PM_SCHEDULE_GEN_ENABLED_FLAG = "PM_SCHEDULE_GEN_ENABLED";

const POLL_INTERVAL_MS = Number(process.env.PM_SCHEDULE_GEN_INTERVAL_MS ?? 60 * 60 * 1000); // hourly
const DAY_MS = 24 * 60 * 60 * 1000;

/** Open-ish statuses that suppress a duplicate PM work order for a schedule. */
const OPEN_WO_STATUSES = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"] as const;

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function isPmScheduleGenEnabled(): boolean {
  return process.env[PM_SCHEDULE_GEN_ENABLED_FLAG] === "true";
}

export function isPmScheduleGenRunning(): boolean {
  return _running;
}

/**
 * One sweep: for every active schedule that is due (nextDueAt <= now), generate a
 * PREVENTIVE work order (unless one is already open for it) and advance the
 * schedule's lastPerformedAt / nextDueAt by intervalDays.
 *
 * @returns number of work orders created this sweep. Never throws.
 */
export async function runPmScheduleGenerationCycle(): Promise<number> {
  if (!isPmScheduleGenEnabled()) return 0;
  const db = await getDb();
  if (!db) return 0;

  const now = new Date();

  // Due, active schedules with a concrete nextDueAt in the past.
  const due = await db
    .select()
    .from(maintenanceSchedules)
    .where(
      and(
        eq(maintenanceSchedules.isActive, true),
        isNotNull(maintenanceSchedules.nextDueAt),
        lte(maintenanceSchedules.nextDueAt, now),
      ),
    );

  if (due.length === 0) return 0;

  const scheduleIds = due.map((s) => s.id);

  // Idempotency: which of these schedules already have an open-ish PM work order?
  const openForSchedule = await db
    .select({ scheduleId: maintenanceWorkOrders.scheduleId })
    .from(maintenanceWorkOrders)
    .where(
      and(
        inArray(maintenanceWorkOrders.scheduleId, scheduleIds),
        inArray(maintenanceWorkOrders.status, OPEN_WO_STATUSES as unknown as any),
      ),
    );
  const hasOpen = new Set(openForSchedule.map((r) => r.scheduleId));

  let created = 0;
  for (const sched of due) {
    try {
      // Advance the schedule first so a mid-sweep crash cannot re-fire it: base
      // the next window on max(oldNextDue, now) to avoid drift/immediate re-due.
      if (sched.intervalDays && sched.intervalDays > 0) {
        const base = Math.max(sched.nextDueAt ? sched.nextDueAt.getTime() : now.getTime(), now.getTime());
        const nextDueAt = new Date(base + sched.intervalDays * DAY_MS);
        await db
          .update(maintenanceSchedules)
          .set({ lastPerformedAt: now, nextDueAt, updatedAt: now })
          .where(eq(maintenanceSchedules.id, sched.id));
      } else {
        // No interval to compute the next window (e.g. USAGE_BASED without days):
        // clear nextDueAt so it stops recurring until rescheduled, but still stamp
        // lastPerformedAt. The open-WO guard covers dedupe if it stays due.
        await db
          .update(maintenanceSchedules)
          .set({ lastPerformedAt: now, nextDueAt: null, updatedAt: now })
          .where(eq(maintenanceSchedules.id, sched.id));
      }

      if (hasOpen.has(sched.id)) continue; // duplicate suppressed

      const woNumber = `WO-PM-${sched.id}-${Date.now()}`;
      await db.insert(maintenanceWorkOrders).values({
        workOrderNumber: woNumber,
        machineId: sched.machineId,
        machineCode: sched.machineCode ?? null,
        scheduleId: sched.id,
        type: "PREVENTIVE",
        status: "OPEN",
        trigger: "SCHEDULE",
        priority: 3,
        title: `Preventive maintenance — ${sched.taskName}`,
        description:
          `Auto-generated from maintenance schedule #${sched.id} (${sched.scheduleType}). ` +
          `${sched.description ?? ""}`.trim(),
        scheduledFor: now,
        corporateCode: sched.corporateCode ?? null,
        factoryId: sched.factoryId ?? null,
      } as any);
      created++;

      // Best-effort ecosystem event (never throws into the sweep).
      try {
        const { publishWorkOrderCreated } = await import("./ecosystem/ecosystemEvents");
        publishWorkOrderCreated({
          workOrderNumber: woNumber,
          machineId: sched.machineId,
          machineCode: sched.machineCode ?? null,
          type: "PREVENTIVE",
          priority: 3,
          failureRisk: null,
          predictedTimeframe: null,
        } as any);
      } catch { /* event publish is best-effort */ }
    } catch (err) {
      logger.error(
        { scheduleId: sched.id, err: (err as Error)?.message },
        "[PmSchedule] schedule generation failed",
      );
    }
  }

  return created;
}

export function startPmScheduleService(): void {
  if (!isPmScheduleGenEnabled()) {
    console.log("[PmSchedule] disabled (PM_SCHEDULE_GEN_ENABLED != true) — no-op");
    return;
  }
  if (_timer) return;
  _running = true;
  console.log(`[PmSchedule] enabled — preventive WO generation every ${POLL_INTERVAL_MS}ms`);

  let sweeping = false;
  const tick = async () => {
    if (sweeping) return; // no overlap
    sweeping = true;
    try {
      const n = await runPmScheduleGenerationCycle();
      if (n > 0) console.log(`[PmSchedule] generated ${n} preventive work order(s)`);
    } catch (err) {
      console.error("[PmSchedule] cycle failed:", err instanceof Error ? err.message : err);
    } finally {
      sweeping = false;
    }
  };

  void tick();
  _timer = setInterval(tick, POLL_INTERVAL_MS);
  if (typeof _timer.unref === "function") _timer.unref();
}

export function stopPmScheduleService(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
}
