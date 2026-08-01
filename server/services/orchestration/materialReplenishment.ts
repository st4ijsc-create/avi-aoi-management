/**
 * Doc 44 W3-B3 (G3.9) — QT-3 · CẤP LIỆU TỰ ĐỘNG THEO TIÊU HAO — watcher end-to-end.
 * SYNAPSE LDS-L3 §10.3 · §17.2 · §9.2 (điều phối AMR Ở MỨC NHIỆM VỤ — KHÔNG lái AMR).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * NGUỒN SỰ KIỆN low-material (2 nguồn chắc chắn có trong tree — chọn (a)+(b)):
 *   (a) BOM/feeder consumption threshold — TÁI DÙNG ngưỡng reorder sẵn có:
 *       bom.listFeedersBelowReorder() (qtyOnFeeder ≤ reorderLevel, logic phản ứng
 *       của consumeFeederMaterial — server/db/bom.ts:195).
 *   (b) Andon category 'material' — andon_events.reason='material' đang mở
 *       (raised/acknowledged).
 *   (Telemetry feeder tag: chưa có tag chuẩn hóa trong tree — không bịa nguồn.)
 *
 * KHI PHÁT HIỆN → tạo NHIỆM VỤ vận chuyển mức task qua fleet taskAllocator:
 *   • requiredCapability 'run_job' — verb robot CHUẨN duy nhất trong capabilityModel
 *     (không có verb 'transport' riêng); phân loại nghiệp vụ nằm trong
 *     payload.kind='material_transport'.
 *   • IDEMPOTENT theo CẶP material+station: khóa payload.replenishKey =
 *     `mat:<machineId>:<componentCode>` — còn task MỞ (pending/assigned/running)
 *     cùng khóa ⇒ KHÔNG tạo trùng. (taskKey thêm hậu tố thời gian để một chu kỳ
 *     cấp liệu MỚI sau khi task cũ done vẫn tạo được task mới.)
 *   • allocateTask (self-gated FLEET_ORCH_ENABLED) chọn AMR; KHÔNG có AMR đủ điều
 *     kiện ⇒ task ở 'pending' + Andon THÔNG BÁO THỦ CÔNG (honest — không bịa robot).
 *   • Ghi sự kiện eventBus 'material.replenish.requested'.
 *
 * KHI TASK DONE (poll trong sweep — chưa có producer 'task.completed' trên bus):
 *   → eventBus 'material.replenish.delivered' + resolve gate 'qt3-await-delivery'
 *     của run QT-3 gắn kèm (payload.qtRunId, best-effort) → THÔNG BÁO tuyến — tuyến
 *     KHÔNG dừng chờ (không transition nào bị gọi).
 *
 * CỜ (default OFF/safe):
 *   MATERIAL_REPLENISH_ENABLED              "true" → bật sweep (OFF mặc định)
 *   MATERIAL_REPLENISH_SWEEP_MS             chu kỳ sweep (mặc định 60000, sàn 10000)
 *   MATERIAL_REPLENISH_ALERT_COOLDOWN_MS    cooldown Andon per khóa (mặc định 600000)
 *   MATERIAL_REPLENISH_DELIVERED_LOOKBACK_MS cửa sổ quét task completed (mặc định 24h)
 *
 * AN TOÀN: module này CHỈ ghi task-state (bảng tasks) + phát sự kiện/Andon. Không
 * một lệnh thiết bị nào được phát — dispatch thật vẫn ở robotCommandDispatcher (gated).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, gte, inArray } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { tasks, andonEvents } from "../../../drizzle/schema";
import { listFeedersBelowReorder } from "../../db/bom";
import { allocateTask } from "../fleet/taskAllocator";
import { eventBus } from "../../_core/eventBus";

// ─── Flags / tunables (đọc tại call time — test-friendly) ─────────────────────

export function materialReplenishEnabled(): boolean {
  return process.env.MATERIAL_REPLENISH_ENABLED === "true" || process.env.MATERIAL_REPLENISH_ENABLED === "1";
}

export function materialReplenishSweepMs(): number {
  const n = Number(process.env.MATERIAL_REPLENISH_SWEEP_MS);
  return Number.isFinite(n) && n >= 10_000 ? n : 60_000;
}

function alertCooldownMs(): number {
  const n = Number(process.env.MATERIAL_REPLENISH_ALERT_COOLDOWN_MS);
  return Number.isFinite(n) && n >= 0 ? n : 10 * 60 * 1000;
}

function deliveredLookbackMs(): number {
  const n = Number(process.env.MATERIAL_REPLENISH_DELIVERED_LOOKBACK_MS);
  return Number.isFinite(n) && n >= 60_000 ? n : 24 * 60 * 60 * 1000;
}

// ─── Idempotency key + payload shape ──────────────────────────────────────────

/** Trạng thái task còn MỞ (đang trong một chu kỳ cấp liệu). */
export const OPEN_TASK_STATUSES = ["pending", "assigned", "running"] as const;

export const MATERIAL_TASK_KIND = "material_transport";

/** Khóa idempotent theo CẶP material+station (spec mục 2: "khóa theo cặp"). */
export function replenishKeyOf(machineId: number, componentCode: string): string {
  return `mat:${machineId}:${componentCode.trim().toLowerCase()}`;
}

export interface MaterialTaskPayload extends Record<string, unknown> {
  kind: typeof MATERIAL_TASK_KIND;
  replenishKey: string;
  machineId: number;
  componentCode: string;
  feederId?: number | null;
  andonId?: number | null;
  lineId?: number | null;
  /** Run QT-3 (FOE) gắn với nhiệm vụ này — watcher resolve gate khi task done. */
  qtRunId?: number | null;
  /** ISO timestamp khi watcher đã thông báo giao xong (chống thông báo trùng). */
  deliveredNotifiedAt?: string;
}

// ─── Andon manual-notify (best-effort, cooldown per khóa) ─────────────────────

const lastAlertAt = new Map<string, number>();

async function maybeAndonNotify(key: string, message: string, data: Record<string, unknown>): Promise<boolean> {
  const now = Date.now();
  if (now - (lastAlertAt.get(key) ?? 0) < alertCooldownMs()) return false;
  lastAlertAt.set(key, now);
  try {
    const { routeAlert } = await import("../aiSmartAlertRouter");
    await routeAlert({
      type: "PATTERN_ANOMALY",
      severity: "HIGH",
      message,
      data: { source: "materialReplenishment", ...data },
    });
    return true;
  } catch (err) {
    console.error("[MaterialReplenish] Andon routeAlert failed:", (err as Error)?.message ?? err);
    return false;
  }
}

// ─── Tạo nhiệm vụ vận chuyển (idempotent) ─────────────────────────────────────

export interface EnsureTransportTaskInput {
  machineId: number;
  componentCode: string;
  feederId?: number | null;
  andonId?: number | null;
  lineId?: number | null;
  qtRunId?: number | null;
  /** 1..5 — mặc định 4 (cấp liệu gấp hơn việc thường, dưới safety). */
  priority?: number;
  /** Ghi đè khóa idempotent (nguồn Andon không có componentCode thật). */
  replenishKeyOverride?: string;
}

export interface EnsureTransportTaskResult {
  ok: boolean;
  created: boolean;
  /** true khi đã có task MỞ cùng khóa (idempotent reuse). */
  existing: boolean;
  taskId?: number;
  allocated: boolean;
  assignedDeviceId?: number;
  replenishKey: string;
  message?: string;
}

/** Tìm task MỞ cùng khóa (lọc payload trong JS — tập open task nhỏ theo thiết kế). */
async function findOpenTaskByKey(key: string): Promise<{ id: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const open = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.status, [...OPEN_TASK_STATUSES]));
  for (const t of open) {
    const p = t.payload as MaterialTaskPayload | null;
    if (p?.kind === MATERIAL_TASK_KIND && p.replenishKey === key) return { id: t.id };
  }
  return null;
}

/**
 * Tạo (idempotent) MỘT nhiệm vụ vận chuyển cấp liệu cho cặp material+station.
 * KHÔNG lái AMR: chỉ insert task + nhờ taskAllocator gán thiết bị (task-level, §9.2).
 */
export async function ensureTransportTask(input: EnsureTransportTaskInput): Promise<EnsureTransportTaskResult> {
  const key = input.replenishKeyOverride ?? replenishKeyOf(input.machineId, input.componentCode);
  const db = await getDb();
  if (!db) return { ok: false, created: false, existing: false, allocated: false, replenishKey: key, message: "db unavailable" };

  try {
    const dup = await findOpenTaskByKey(key);
    if (dup) {
      return { ok: true, created: false, existing: true, taskId: dup.id, allocated: false, replenishKey: key };
    }

    const payload: MaterialTaskPayload = {
      kind: MATERIAL_TASK_KIND,
      replenishKey: key,
      machineId: input.machineId,
      componentCode: input.componentCode,
      feederId: input.feederId ?? null,
      andonId: input.andonId ?? null,
      lineId: input.lineId ?? null,
      qtRunId: input.qtRunId ?? null,
    };
    const [row] = await db
      .insert(tasks)
      .values({
        // Hậu tố thời gian: chu kỳ cấp liệu MỚI (sau khi task cũ done) tạo được task mới;
        // idempotency trong-chu-kỳ do replenishKey (open-task check) đảm bảo.
        taskKey: `material:${input.machineId}:${input.componentCode}:${Date.now().toString(36)}`,
        requiredCapability: "run_job", // verb robot chuẩn duy nhất của capabilityModel
        priority: Math.max(1, Math.min(5, input.priority ?? 4)),
        status: "pending",
        payload,
      })
      .returning({ id: tasks.id });
    const taskId = row?.id;
    if (taskId == null) {
      return { ok: false, created: false, existing: false, allocated: false, replenishKey: key, message: "insert failed" };
    }

    try {
      eventBus.publish(
        "material.replenish.requested",
        { taskId, replenishKey: key, machineId: input.machineId, componentCode: input.componentCode, feederId: input.feederId ?? null, andonId: input.andonId ?? null },
        "materialReplenishment",
      );
    } catch {
      /* event best-effort */
    }

    // Gán AMR ở mức nhiệm vụ (self-gated FLEET_ORCH_ENABLED — không lệnh thiết bị).
    let allocated = false;
    let assignedDeviceId: number | undefined;
    try {
      const alloc = await allocateTask(taskId);
      allocated = alloc.ok && alloc.assignedDeviceId != null;
      assignedDeviceId = alloc.assignedDeviceId;
    } catch (err) {
      console.error(`[MaterialReplenish] allocateTask(${taskId}) failed:`, (err as Error)?.message ?? err);
    }
    if (!allocated) {
      // HONEST: không có AMR nhận → task vẫn pending + báo người vận chuyển thủ công.
      await maybeAndonNotify(
        key,
        `[QT-3 Cấp liệu] Sắp hết vật tư ${input.componentCode} tại máy ${input.machineId} — CHƯA có AMR nhận nhiệm vụ (task ${taskId} pending). Cần vận chuyển thủ công.`,
        { taskId, replenishKey: key, machineId: input.machineId, componentCode: input.componentCode },
      );
    }

    console.log(
      `[MaterialReplenish] task ${taskId} created (${key})${allocated ? ` → AMR ${assignedDeviceId}` : " — pending, Andon manual notify"}`,
    );
    return { ok: true, created: true, existing: false, taskId, allocated, assignedDeviceId, replenishKey: key };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[MaterialReplenish] ensureTransportTask(${key}) failed:`, message);
    return { ok: false, created: false, existing: false, allocated: false, replenishKey: key, message };
  }
}

/** §18.2 (bù trừ QT-3): hủy task MỞ của cặp material+station. Chỉ ghi task-state. */
export async function cancelOpenTransportTask(
  machineId: number,
  componentCode: string,
  reason: string,
): Promise<{ ok: boolean; cancelled: number }> {
  const key = replenishKeyOf(machineId, componentCode);
  const db = await getDb();
  if (!db) return { ok: false, cancelled: 0 };
  let cancelled = 0;
  try {
    const open = await db
      .select()
      .from(tasks)
      .where(inArray(tasks.status, [...OPEN_TASK_STATUSES]));
    for (const t of open) {
      const p = t.payload as MaterialTaskPayload | null;
      if (p?.kind !== MATERIAL_TASK_KIND || p.replenishKey !== key) continue;
      await db
        .update(tasks)
        .set({ status: "cancelled", lastError: reason, updatedAt: new Date() })
        .where(eq(tasks.id, t.id));
      cancelled += 1;
      console.log(`[MaterialReplenish] task ${t.id} cancelled (${key}): ${reason}`);
    }
    return { ok: true, cancelled };
  } catch (err) {
    console.error(`[MaterialReplenish] cancelOpenTransportTask(${key}) failed:`, (err as Error)?.message ?? err);
    return { ok: false, cancelled };
  }
}

// ─── Sweep: phát hiện low-material + theo dõi giao xong ───────────────────────

export interface MaterialReplenishSweepStats {
  feedersLow: number;
  andonMaterial: number;
  tasksCreated: number;
  duplicatesSkipped: number;
  delivered: number;
  errors: number;
  ms: number;
}

/**
 * MỘT lượt sweep (exported cho test/on-demand; KHÔNG gate cờ ở đây — scheduler gate):
 *   1. Feeder dưới ngưỡng reorder (nguồn a) → ensureTransportTask (idempotent).
 *   2. Andon 'material' đang mở (nguồn b)   → ensureTransportTask (khóa theo andon).
 *   3. Task material ĐÃ completed chưa thông báo → event delivered + resolve gate
 *      QT-3 (best-effort) — tuyến KHÔNG dừng chờ, không transition nào được gọi.
 */
export async function sweepMaterialReplenishmentOnce(): Promise<MaterialReplenishSweepStats> {
  const t0 = Date.now();
  const stats: MaterialReplenishSweepStats = {
    feedersLow: 0,
    andonMaterial: 0,
    tasksCreated: 0,
    duplicatesSkipped: 0,
    delivered: 0,
    errors: 0,
    ms: 0,
  };

  // (a) BOM/feeder threshold — tái dùng ngưỡng reorder của bom.ts.
  try {
    const feeders = await listFeedersBelowReorder();
    for (const f of feeders) {
      if (f.status === "removed") continue; // feeder đã tháo — không cấp liệu
      stats.feedersLow += 1;
      try {
        const res = await ensureTransportTask({
          machineId: f.machineId,
          componentCode: f.componentCode,
          feederId: f.id,
        });
        if (res.created) stats.tasksCreated += 1;
        else if (res.existing) stats.duplicatesSkipped += 1;
        else if (!res.ok) stats.errors += 1;
      } catch {
        stats.errors += 1;
      }
    }
  } catch (err) {
    stats.errors += 1;
    console.error("[MaterialReplenish] feeder scan failed:", (err as Error)?.message ?? err);
  }

  // (b) Andon 'material' đang mở.
  try {
    const db = await getDb();
    if (db) {
      const open = await db
        .select()
        .from(andonEvents)
        .where(and(eq(andonEvents.reason, "material"), inArray(andonEvents.status, ["raised", "acknowledged"])));
      for (const a of open) {
        stats.andonMaterial += 1;
        if (a.machineId == null && a.stationId == null && a.lineId == null) continue; // không định vị được — bỏ qua honest
        try {
          const res = await ensureTransportTask({
            machineId: a.machineId ?? 0,
            componentCode: `andon-${a.id}`,
            andonId: a.id,
            lineId: a.lineId ?? null,
            // Khóa theo andon (component thật không có trên andon) — 1 andon = 1 nhiệm vụ mở.
            replenishKeyOverride: `mat-andon:${a.id}`,
          });
          if (res.created) stats.tasksCreated += 1;
          else if (res.existing) stats.duplicatesSkipped += 1;
          else if (!res.ok) stats.errors += 1;
        } catch {
          stats.errors += 1;
        }
      }
    }
  } catch (err) {
    stats.errors += 1;
    console.error("[MaterialReplenish] andon scan failed:", (err as Error)?.message ?? err);
  }

  // (c) Task material completed → thông báo giao xong (một lần) + resolve gate QT-3.
  try {
    const db = await getDb();
    if (db) {
      const cutoff = new Date(Date.now() - deliveredLookbackMs());
      const done = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.status, "completed"), gte(tasks.updatedAt, cutoff)));
      for (const t of done) {
        const p = t.payload as MaterialTaskPayload | null;
        if (p?.kind !== MATERIAL_TASK_KIND || p.deliveredNotifiedAt) continue;
        try {
          eventBus.publish(
            "material.replenish.delivered",
            { taskId: t.id, replenishKey: p.replenishKey, machineId: p.machineId, componentCode: p.componentCode, lineId: p.lineId ?? null },
            "materialReplenishment",
          );
        } catch {
          /* event best-effort */
        }
        // Resolve gate 'qt3-await-delivery' của run QT-3 gắn kèm — best-effort, không chặn sweep.
        if (typeof p.qtRunId === "number" && p.qtRunId > 0) {
          try {
            const { resolveQtGate } = await import("./templates/qtRunner");
            await resolveQtGate(p.qtRunId, {
              approved: true,
              note: `watcher: task ${t.id} completed — vật tư đã giao (${p.replenishKey})`,
            });
          } catch (err) {
            console.error(`[MaterialReplenish] resolveQtGate(run ${p.qtRunId}) failed:`, (err as Error)?.message ?? err);
          }
        }
        await db
          .update(tasks)
          .set({ payload: { ...p, deliveredNotifiedAt: new Date().toISOString() }, updatedAt: new Date() })
          .where(eq(tasks.id, t.id));
        stats.delivered += 1;
        console.log(`[MaterialReplenish] delivered: task ${t.id} (${p.replenishKey}) — line notified, tuyến không dừng`);
      }
    }
  } catch (err) {
    stats.errors += 1;
    console.error("[MaterialReplenish] delivered scan failed:", (err as Error)?.message ?? err);
  }

  stats.ms = Date.now() - t0;
  lastSweepAt = new Date().toISOString();
  lastSweepStats = stats;
  return stats;
}

// ─── Scheduler lifecycle (mirror lineControllerService) ───────────────────────

let sweepTimer: NodeJS.Timeout | null = null;
let sweepRunning = false;
let lastSweepAt: string | null = null;
let lastSweepStats: MaterialReplenishSweepStats | null = null;

/** Bật watcher QT-3. No-op (log lý do) khi MATERIAL_REPLENISH_ENABLED off (default). */
export function startMaterialReplenishment(): void {
  if (!materialReplenishEnabled()) {
    console.log("[MaterialReplenish] disabled (set MATERIAL_REPLENISH_ENABLED=true to enable)");
    return;
  }
  if (sweepTimer) return; // guard double-start
  const interval = materialReplenishSweepMs();
  sweepTimer = setInterval(() => {
    if (sweepRunning) return; // không chồng lượt
    sweepRunning = true;
    sweepMaterialReplenishmentOnce()
      .then((s) => {
        if (s.tasksCreated > 0 || s.delivered > 0 || s.errors > 0) {
          console.log(
            `[MaterialReplenish] sweep: low=${s.feedersLow} andon=${s.andonMaterial} created=${s.tasksCreated} ` +
              `dup=${s.duplicatesSkipped} delivered=${s.delivered} err=${s.errors} in ${s.ms}ms`,
          );
        }
      })
      .catch((err) => console.error("[MaterialReplenish] sweep tick failed:", (err as Error)?.message ?? err))
      .finally(() => {
        sweepRunning = false;
      });
  }, interval);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  console.log(`[MaterialReplenish] watcher started (every ${interval}ms — task-level only, no AMR command)`);
}

/** Dừng watcher (shutdown/tests). An toàn khi chưa start. */
export function stopMaterialReplenishment(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Trạng thái runtime cho health/dashboard. */
export function getMaterialReplenishmentStatus() {
  return {
    enabled: materialReplenishEnabled(),
    sweepMs: materialReplenishSweepMs(),
    running: !!sweepTimer,
    lastSweepAt,
    lastSweepStats,
  };
}

/** Test seam: reset module state. */
export function _resetMaterialReplenishmentForTests(): void {
  stopMaterialReplenishment();
  sweepRunning = false;
  lastSweepAt = null;
  lastSweepStats = null;
  lastAlertAt.clear();
}
