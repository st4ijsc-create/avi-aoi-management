/**
 * doc 54 §11 P1.1 ⭐ — Full-Sim OT telemetry emitter (connectivity/monitoring activation).
 * ═══════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ (đòn bẩy §11.1 — monitoring KHÔNG có phần cứng): `machinePresenceService`
 * (đã nối dây, gated MACHINE_PRESENCE_ENABLED) suy trạng thái ONLINE của máy TỪ
 * RECENCY của `ot_telemetry` (sweepPresenceFromTelemetry: JOIN ot_telemetry.machineId
 * = machines.id, MAX(ts) mới hơn TTL ⇒ online). Trong triển khai Full-Sim KHÔNG có
 * adapter OT thật nào bơm `ot_telemetry`, nên bảng RỖNG → presence không bao giờ lật
 * máy sang online → dashboard giám sát / heartbeat "rỗng".
 *
 * DỊCH VỤ NÀY BỔ SUNG: một emitter nền, mỗi tick bơm telemetry TỔNG HỢP-NHƯNG-HỢP-LÝ
 * (heartbeat + machine_state + cycle_time + temperature) cho MỖI máy ACTIVE có
 * hierarchy đầy đủ, ĐI QUA ĐÚNG đường ingest thật `ingestTelemetry()` (unified
 * telemetry bus — normalize → resolve machineId → bulk-insert ot_telemetry →
 * broadcast telemetry:sample), CHÍNH XÁC như một adapter OT thật. Presence sweep sau
 * đó lật các máy này ONLINE và ghi machine_status_logs — mở "câu chuyện monitoring"
 * GĐ1 mà KHÔNG cần phần cứng.
 *
 * IDENTITY (đã kiểm chứng ở machinePresenceService + drizzle/schema/ot.ts):
 *   sweepPresenceFromTelemetry JOIN `ot_telemetry."machineId" = machines.id` và lọc
 *   `machines."isActive" = true`. Vậy mỗi sample PHẢI mang `machineId = machines.id`
 *   (int PK). Ta cung cấp `machineId` TRỰC TIẾP trong CanonicalSample (bus ưu tiên
 *   machineId có sẵn → BỎ QUA bước resolve deviceId→code) nên identity khớp tuyệt đối.
 *   `deviceId = machine.code` chỉ để idempotency (natural key uq_ot_telemetry_device_
 *   metric_ts = deviceId,metric,ts) + truy vết; KHÔNG dùng để resolve.
 *
 * HONEST / NO-FAKE-FOR-GHOSTS:
 *   - CHỈ bơm cho máy CÓ trong DB: active + đủ chuỗi machine→station→line→workshop
 *     (INNER JOIN — giống liveStatsRollupService). Máy không tồn tại/thiếu hierarchy →
 *     KHÔNG bịa hàng.
 *   - Thiếu DB ⇒ no-op. Emitter best-effort: một tick KHÔNG BAO GIỜ ném (bus cũng đã
 *     fail-safe). protocol='other' (khớp otProtocolToCanonical('stub') — quy ước OT
 *     sim/stub → canonical 'other'); quality='good'.
 *
 * CỜ (mặc định OFF — job GHI dữ liệu telemetry tổng hợp; CHỈ bật trên env Full-Sim,
 * KHÔNG bật ở production nơi ot_telemetry đến từ adapter/máy thật):
 *   SIM_OT_TELEMETRY_ENABLED=true        bật emitter (default OFF)
 *   SIM_OT_TELEMETRY_INTERVAL_MS=30000   chu kỳ (default 30s, floor 5s) — < presence
 *                                        TTL (default 120s) để máy giữ ONLINE ổn định
 */

import { getDb } from "../db/connection";
import { eq } from "drizzle-orm";
import { machines, stations, productionLines, workshops } from "../../drizzle/schema";
import { ingestTelemetry, type CanonicalSample } from "./telemetryBus";

// ─── Identity + pure sample generation (unit-tested; no I/O) ─────────────────────

/** Định danh tối thiểu của một máy để sinh telemetry (khớp cột presence dùng). */
export interface SimMachineIdentity {
  /** = machines.id (int PK) — CHÍNH XÁC cột ot_telemetry.machineId presence JOIN. */
  machineId: number;
  /** = machines.code — dùng làm deviceId (idempotency natural key + truy vết). */
  code: string;
}

/**
 * Bộ tag emitter sinh MỖI tick MỖI máy (tập ỔN ĐỊNH — unit-test soi chiếu):
 *   heartbeat      (num, =1)         — liveness; đủ để presence tính recency.
 *   machine_state  (text, RUNNING…)  — trạng thái máy (phần lớn RUNNING).
 *   cycle_time     (num, s)          — thời gian chu kỳ hợp lý ~18–40s.
 *   temperature    (num, °C)         — nhiệt độ hợp lý ~40–52°C.
 */
export const SIM_OT_METRICS = ["heartbeat", "machine_state", "cycle_time", "temperature"] as const;

/** Tập trạng thái máy hợp lệ (nghiêng về RUNNING để giống nhà máy đang chạy). */
export const SIM_OT_MACHINE_STATES = ["RUNNING", "RUNNING", "RUNNING", "IDLE"] as const;

function round(x: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * PURE — sinh CanonicalSample[] cho MỘT máy tại thời điểm `now`. Không I/O, testable.
 * Mọi sample mang cùng ts/machineId/deviceId/protocol/quality; identity (machineId)
 * lấy TRỰC TIẾP để khớp tuyệt đối cột presence JOIN. Giá trị bị chặn trong khoảng hợp
 * lý nên unit-test kiểm được cả shape lẫn range mà không cần seed RNG.
 */
export function buildTelemetrySamples(
  machine: SimMachineIdentity,
  now: Date = new Date(),
): CanonicalSample[] {
  // protocol/quality là literal của enum canonical (telemetryProtocolEnum/…Quality).
  const base: Pick<CanonicalSample, "ts" | "machineId" | "deviceId" | "protocol" | "quality"> = {
    ts: now,
    machineId: machine.machineId,
    deviceId: machine.code,
    protocol: "other", // sim/stub OT → canonical 'other' (mirrors ot/ingest.otProtocolToCanonical)
    quality: "good",
  };
  const meta: Record<string, unknown> = { source: "SIM-OT", doc: "54-P1.1" };

  return [
    { ...base, metric: "heartbeat", value: 1, meta },
    { ...base, metric: "machine_state", value: pick(SIM_OT_MACHINE_STATES), meta },
    { ...base, metric: "cycle_time", value: round(18 + rand(0, 22)), unit: "s", meta },
    { ...base, metric: "temperature", value: round(40 + rand(0, 12)), unit: "°C", meta },
  ];
}

// ─── Flags / helpers ────────────────────────────────────────────────────────────

function simEnabled(): boolean {
  return process.env.SIM_OT_TELEMETRY_ENABLED === "true";
}

/** Interval ms; default 30s, hard floor 5s, NaN-safe (exported cho unit-test). */
export function simIntervalMs(): number {
  const n = Number(process.env.SIM_OT_TELEMETRY_INTERVAL_MS);
  return Number.isFinite(n) && n >= 5_000 ? n : 30_000;
}

// ─── Module state ─────────────────────────────────────────────────────────────
let emitTimer: NodeJS.Timeout | null = null;
let emitting = false;
let lastRunAt: string | null = null;
let lastRunStats: SimOtTelemetryStats | null = null;

export interface SimOtTelemetryStats {
  /** Số máy active + đủ hierarchy đã sinh telemetry. */
  machines: number;
  /** Tổng số sample đã đẩy vào bus (machines × |SIM_OT_METRICS|). */
  samples: number;
  ms: number;
}

// ─── Core run (KHÔNG gated bởi cờ — cờ chỉ điều khiển scheduling, nên callable
//     on-demand / trong test). Never throws. ────────────────────────────────────
export async function emitSimTelemetryNow(opts?: { now?: Date }): Promise<SimOtTelemetryStats> {
  const t0 = Date.now();
  const now = opts?.now ?? new Date();
  const stats: SimOtTelemetryStats = { machines: 0, samples: 0, ms: 0 };

  try {
    const db = await getDb();
    if (!db) {
      stats.ms = Date.now() - t0;
      return stats; // DB-missing = no-op (honest, KHÔNG bịa).
    }

    // Máy ACTIVE + đủ chuỗi machine→station→line→workshop (INNER JOIN loại máy mồ côi).
    // Chỉ cần id (= identity) + code (= deviceId). Mirror liveStatsRollupService hierarchy.
    const rows = await db
      .select({ machineId: machines.id, code: machines.code })
      .from(machines)
      .innerJoin(stations, eq(machines.stationId, stations.id))
      .innerJoin(productionLines, eq(stations.lineId, productionLines.id))
      .innerJoin(workshops, eq(productionLines.workshopId, workshops.id))
      .where(eq(machines.isActive, true));

    if (rows.length === 0) {
      stats.ms = Date.now() - t0;
      lastRunAt = new Date().toISOString();
      lastRunStats = stats;
      return stats;
    }

    const samples: CanonicalSample[] = [];
    for (const m of rows) {
      samples.push(...buildTelemetrySamples({ machineId: Number(m.machineId), code: m.code }, now));
    }
    stats.machines = rows.length;
    stats.samples = samples.length;

    // ĐI QUA ĐÚNG đường ingest thật (KHÔNG bypass): unified bus persist → ot_telemetry
    // + broadcast telemetry:sample. Bus tự fail-safe (không ném vào caller).
    await ingestTelemetry(samples);
  } catch (e) {
    // Top-level guard: một run KHÔNG BAO GIỜ ném.
    console.error("[simOtTelemetry] emit error:", (e as Error)?.message ?? e);
  }

  stats.ms = Date.now() - t0;
  lastRunAt = new Date().toISOString();
  lastRunStats = stats;
  return stats;
}

// ─── Scheduler lifecycle (mirrors liveStatsRollupService/machinePresenceService:
//     gated, unref'd, non-overlapping, idempotent) ───────────────────────────────

/** Bắt đầu emitter định kỳ. Idempotent + tự-gate SIM_OT_TELEMETRY_ENABLED. */
export function startSimOtTelemetry(): void {
  if (!simEnabled()) {
    console.log(
      "[simOtTelemetry] disabled (set SIM_OT_TELEMETRY_ENABLED=true to enable — Full-Sim only, WRITES ot_telemetry)",
    );
    return;
  }
  if (emitTimer) {
    console.log("[simOtTelemetry] already running");
    return;
  }
  const intervalMs = simIntervalMs();
  console.log(`[simOtTelemetry] starting (interval=${Math.round(intervalMs / 1000)}s)`);

  const run = async () => {
    if (emitting) return; // no overlap
    emitting = true;
    try {
      const r = await emitSimTelemetryNow();
      if (r.samples > 0) {
        console.log(
          `[simOtTelemetry] emitted ${r.samples} sample(s) for ${r.machines} machine(s) in ${r.ms}ms`,
        );
      }
    } catch (e) {
      console.error("[simOtTelemetry] run failed:", (e as Error)?.message ?? e);
    } finally {
      emitting = false;
    }
  };

  // Chạy 1 lần ngay rồi lặp theo interval.
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  emitTimer = timer;
}

/** Dừng emitter. Idempotent no-op khi chưa chạy. */
export function stopSimOtTelemetry(): void {
  if (emitTimer) {
    clearInterval(emitTimer);
    emitTimer = null;
    console.log("[simOtTelemetry] stopped");
  }
}

/** Cấu hình/trạng thái hiện tại (cho health / chẩn đoán). */
export function getSimOtTelemetryConfig() {
  return {
    enabled: simEnabled(),
    running: emitTimer !== null,
    intervalSeconds: Math.round(simIntervalMs() / 1000),
    metrics: [...SIM_OT_METRICS],
    lastRunAt,
    lastRunStats,
  };
}
