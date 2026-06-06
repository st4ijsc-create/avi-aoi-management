// PdM Work-Order Service (Giai đoạn 2 — G7 closed-loop)
// Đọc machine_health_history.predictedFailureRisk → tự sinh maintenance_work_orders.
// Code-only, feature-flag PDM_WORKORDER_ENABLED. No-op khi cờ tắt hoặc DB chưa sẵn sàng.
import { sql, and, eq, gte, desc, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { machineHealthHistory, maintenanceWorkOrders } from "../../drizzle/schema";

const RISK_THRESHOLD = Number(process.env.PDM_RISK_THRESHOLD ?? 70); // 0-100
const POLL_INTERVAL_MS = Number(process.env.PDM_POLL_INTERVAL_MS ?? 15 * 60 * 1000); // 15 phút
const LOOKBACK_HOURS = Number(process.env.PDM_LOOKBACK_HOURS ?? 24);

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

export function isPdmWorkOrderEnabled(): boolean {
  return process.env.PDM_WORKORDER_ENABLED === "true";
}

export function isPdmWorkOrderRunning(): boolean {
  return _running;
}

function mapUrgencyToPriority(urgency: string | null | undefined): number {
  switch (urgency) {
    case "CRITICAL": return 1;
    case "HIGH": return 2;
    case "MEDIUM": return 3;
    case "LOW": return 4;
    default: return 3;
  }
}

/**
 * Một chu kỳ quét: tìm máy có predictedFailureRisk >= ngưỡng trong cửa sổ lookback,
 * tạo work-order PREDICTIVE nếu chưa có WO đang mở cho máy đó.
 * Trả về số work-order được tạo mới.
 */
export async function runPdmWorkOrderCycle(): Promise<number> {
  if (!isPdmWorkOrderEnabled()) return 0;
  const db = await getDb();
  if (!db) return 0;

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);

  // Lấy bản ghi health gần nhất theo máy có rủi ro cao
  const atRisk = await db
    .select()
    .from(machineHealthHistory)
    .where(
      and(
        gte(machineHealthHistory.timestamp, since),
        sql`${machineHealthHistory.predictedFailureRisk} >= ${RISK_THRESHOLD}`,
      ),
    )
    .orderBy(desc(machineHealthHistory.timestamp));

  if (atRisk.length === 0) return 0;

  // Giữ bản ghi mới nhất cho mỗi máy
  const latestByMachine = new Map<number, typeof atRisk[number]>();
  for (const row of atRisk) {
    if (!latestByMachine.has(row.machineId)) latestByMachine.set(row.machineId, row);
  }

  const machineIds = [...latestByMachine.keys()];

  // Máy đã có work-order chưa đóng → bỏ qua để tránh trùng
  const openStatuses = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD"] as const;
  const existing = await db
    .select({ machineId: maintenanceWorkOrders.machineId })
    .from(maintenanceWorkOrders)
    .where(
      and(
        inArray(maintenanceWorkOrders.machineId, machineIds),
        inArray(maintenanceWorkOrders.status, openStatuses as unknown as any),
      ),
    );
  const hasOpen = new Set(existing.map((e) => e.machineId));

  let created = 0;
  for (const [machineId, health] of latestByMachine) {
    if (hasOpen.has(machineId)) continue;

    const woNumber = `WO-PDM-${machineId}-${Date.now()}`;
    await db.insert(maintenanceWorkOrders).values({
      workOrderNumber: woNumber,
      machineId,
      machineCode: health.machineCode ?? null,
      type: "PREDICTIVE",
      status: "OPEN",
      trigger: "PREDICTED_FAILURE",
      predictedFailureRisk: health.predictedFailureRisk ?? null,
      healthScore: health.healthScore ?? null,
      priority: mapUrgencyToPriority(health.maintenanceUrgency),
      title: `Predictive maintenance — máy ${health.machineCode ?? machineId}`,
      description:
        `Tự sinh từ PdM: predictedFailureRisk=${health.predictedFailureRisk}, ` +
        `healthScore=${health.healthScore}, urgency=${health.maintenanceUrgency ?? "N/A"}.`,
      scheduledFor: health.recommendedMaintenanceDate ?? null,
    } as any);
    created++;
  }

  return created;
}

/**
 * Tính MTTR (phút) và MTBF (giờ) cho một máy trong khoảng thời gian.
 * MTTR = trung bình downtime của các WO đã đóng; MTBF = trung bình khoảng cách giữa các lần hỏng.
 */
export async function computeMttrMtbf(
  machineId: number,
  from: Date,
  to: Date,
): Promise<{ mttrMinutes: number | null; mtbfHours: number | null; failureCount: number }> {
  const db = await getDb();
  if (!db) return { mttrMinutes: null, mtbfHours: null, failureCount: 0 };

  const orders = await db
    .select()
    .from(maintenanceWorkOrders)
    .where(
      and(
        eq(maintenanceWorkOrders.machineId, machineId),
        gte(maintenanceWorkOrders.openedAt, from),
        eq(maintenanceWorkOrders.status, "COMPLETED"),
      ),
    )
    .orderBy(maintenanceWorkOrders.openedAt);

  const failures = orders.filter((o) => o.openedAt && o.openedAt <= to);
  const failureCount = failures.length;
  if (failureCount === 0) return { mttrMinutes: null, mtbfHours: null, failureCount: 0 };

  // MTTR
  const downtimes = failures
    .map((o) => o.downtimeMinutes ?? (o.closedAt && o.repairStartedAt
      ? Math.round((o.closedAt.getTime() - o.repairStartedAt.getTime()) / 60000)
      : null))
    .filter((d): d is number => d != null && d >= 0);
  const mttrMinutes = downtimes.length > 0
    ? downtimes.reduce((a, b) => a + b, 0) / downtimes.length
    : null;

  // MTBF: khoảng giữa các thời điểm openedAt liên tiếp
  let mtbfHours: number | null = null;
  if (failureCount >= 2) {
    let totalGapMs = 0;
    for (let i = 1; i < failures.length; i++) {
      totalGapMs += failures[i].openedAt!.getTime() - failures[i - 1].openedAt!.getTime();
    }
    mtbfHours = totalGapMs / (failureCount - 1) / (60 * 60 * 1000);
  }

  return { mttrMinutes, mtbfHours, failureCount };
}

export function startPdmWorkOrderService(): void {
  if (!isPdmWorkOrderEnabled()) {
    console.log("[PdmWorkOrder] disabled (PDM_WORKORDER_ENABLED != true) — no-op");
    return;
  }
  if (_timer) return;
  _running = true;
  console.log(
    `[PdmWorkOrder] enabled — risk>=${RISK_THRESHOLD}, every ${POLL_INTERVAL_MS}ms, lookback ${LOOKBACK_HOURS}h`,
  );

  const tick = async () => {
    try {
      const n = await runPdmWorkOrderCycle();
      if (n > 0) console.log(`[PdmWorkOrder] created ${n} predictive work order(s)`);
    } catch (err) {
      console.error("[PdmWorkOrder] cycle failed:", err instanceof Error ? err.message : err);
    }
  };

  // Chạy ngay một lần rồi đặt lịch
  void tick();
  _timer = setInterval(tick, POLL_INTERVAL_MS);
  if (typeof _timer.unref === "function") _timer.unref();
}

export function stopPdmWorkOrderService(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
}
