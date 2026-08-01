/**
 * doc 40 MON-F1 — Machine Presence Service (thống nhất ghi machine_status_logs cho MỌI transport).
 * ═══════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ (khoảng trống MON-F1): trước đây machine_status_logs CHỈ được ghi bởi đường
 * socket (server/_core/socket.ts — máy tự đăng ký qua WebSocket). Máy nối qua OT
 * (OPC-UA / Modbus / S7 / Mitsubishi-MC / EtherNet-IP), MQTT, MTConnect… KHÔNG bao giờ
 * sinh bản ghi online/offline → lịch sử trạng thái/uptime của chúng trống rỗng.
 *
 * DỊCH VỤ NÀY BỔ SUNG (không đụng socket.ts — đường socket giữ nguyên):
 *   1) recordPresence(): ghi machine_status_logs qua 1 hàm CHỐNG TRÙNG — chỉ ghi khi
 *      trạng thái ĐỔI (so với bản ghi mới nhất trong DB + cache in-memory). Tính `duration`
 *      (giây) của trạng thái trước từ timestamp bản ghi trước đó.
 *   2) recordPresenceEvent(): điểm nhận sự kiện adapter connected/disconnected từ
 *      connectionSupervisor (đẩy khi otManager truyền machineId).
 *   3) sweepPresenceFromTelemetry(): suy trạng thái online từ RECENCY của ot_telemetry
 *      theo TTL — mọi transport OT đều ghi ot_telemetry (kho telemetry chuẩn), nên đây là
 *      đường phủ ĐẦY ĐỦ các transport. Máy KHÔNG có ot_telemetry (vd máy chỉ-socket) sẽ bị
 *      BỎ QUA — tránh giẫm lên đường socket đã quản lý.
 *
 * HONEST / DEGRADE RÕ RÀNG:
 *   - Chỉ khẳng định presence cho máy CÓ lịch sử ot_telemetry (có tín hiệu thật). Máy chưa
 *     từng gửi telemetry → không bịa 'offline'.
 *   - Không tạo dữ liệu; chỉ phản ánh recency thật. Thiếu DB ⇒ no-op.
 *
 * CỜ (mặc định OFF — bật ở .env.sim để đánh giá, KHÔNG bật ở .env production):
 *   MACHINE_PRESENCE_ENABLED=true          bật sweep + nhận event
 *   MACHINE_PRESENCE_TTL_SECONDS=120       telemetry mới hơn TTL ⇒ online (default 120s)
 *   MACHINE_PRESENCE_SWEEP_MS=60000        chu kỳ sweep (default 60s, min 10s)
 */

import { getDb } from "../db";
import { sql, eq, desc } from "drizzle-orm";
import { machineStatusLogs } from "../../drizzle/schema";

type PresenceStatus = "online" | "offline";

/** Trạng thái đã GHI gần nhất theo máy (cache in-memory chống truy vấn/ghi trùng). */
const lastWrittenStatus = new Map<number, PresenceStatus>();

let sweepTimer: NodeJS.Timeout | null = null;
let sweeping = false;

function presenceEnabled(): boolean {
  return process.env.MACHINE_PRESENCE_ENABLED === "true";
}

function ttlSeconds(): number {
  const n = Number(process.env.MACHINE_PRESENCE_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 120;
}

function sweepIntervalMs(): number {
  const n = Number(process.env.MACHINE_PRESENCE_SWEEP_MS);
  return Number.isFinite(n) && n >= 10_000 ? n : 60_000;
}

/**
 * Ghi machine_status_logs CHỐNG TRÙNG: chỉ ghi khi trạng thái đổi so với bản ghi mới
 * nhất trong DB (đồng thời cập nhật cache). Trả true nếu có ghi (state đổi), false nếu bỏ qua.
 * Non-throwing với caller trong sweep? — hàm này CÓ THỂ ném lỗi DB; caller tự bọc.
 */
export async function recordPresence(
  machineId: number,
  status: PresenceStatus,
  opts?: { ipAddress?: string | null; source?: string },
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Cache nhanh: nếu vừa ghi đúng trạng thái này thì bỏ qua (không truy vấn DB).
  if (lastWrittenStatus.get(machineId) === status) return false;

  // So với bản ghi mới nhất trong DB (đúng cả sau restart hoặc khi đường socket vừa ghi).
  const latest = await db
    .select({ status: machineStatusLogs.status, timestamp: machineStatusLogs.timestamp })
    .from(machineStatusLogs)
    .where(eq(machineStatusLogs.machineId, machineId))
    .orderBy(desc(machineStatusLogs.timestamp))
    .limit(1);

  const prev = latest[0];
  if (prev && prev.status === status) {
    lastWrittenStatus.set(machineId, status);
    return false; // không đổi → không ghi
  }

  // Thời lượng (giây) của trạng thái TRƯỚC (từ timestamp bản ghi trước đến giờ).
  const duration = prev
    ? Math.max(0, Math.round((Date.now() - new Date(prev.timestamp).getTime()) / 1000))
    : null;

  await db.insert(machineStatusLogs).values({
    machineId,
    status,
    ipAddress: opts?.ipAddress ?? null,
    duration,
  });
  lastWrittenStatus.set(machineId, status);

  // Phát socket (best-effort, không chặn) — song song đường socket.ts để UI cập nhật.
  try {
    const socketModule = await import("../_core/socket");
    const io = (socketModule as any).io;
    if (io) io.emit("machine:status_change", { machineId, status, source: opts?.source ?? "presence" });
  } catch {
    // socket.io chưa sẵn sàng → bỏ qua
  }

  return true;
}

/**
 * Điểm nhận sự kiện adapter connected/disconnected (từ connectionSupervisor). Gated bởi
 * MACHINE_PRESENCE_ENABLED; non-throwing (fire-and-forget từ supervisor). recordPresence
 * đã tự chống trùng nên gọi lặp lại vô hại.
 */
export async function recordPresenceEvent(
  machineId: number,
  online: boolean,
  opts?: { ipAddress?: string | null; source?: string },
): Promise<void> {
  if (!presenceEnabled()) return;
  try {
    await recordPresence(machineId, online ? "online" : "offline", opts);
  } catch (err) {
    console.error("[MachinePresence] recordPresenceEvent failed:", (err as Error)?.message ?? err);
  }
}

/**
 * Suy presence từ recency của ot_telemetry cho MỌI máy đang active CÓ telemetry: telemetry
 * mới hơn TTL ⇒ online, cũ hơn ⇒ offline. Máy chưa từng có ot_telemetry → bỏ qua (để đường
 * socket/heartbeat quản lý, tránh bịa offline). Ghi qua recordPresence (chống trùng).
 */
export async function sweepPresenceFromTelemetry(): Promise<{ checked: number; changed: number }> {
  const db = await getDb();
  if (!db) return { checked: 0, changed: 0 };

  const ttl = ttlSeconds();
  // MAX(ts) mỗi máy dùng index idx_ot_telemetry_machine_ts; chỉ máy active + có telemetry.
  const res = await db.execute(sql`
    SELECT m.id AS "machineId", t.max_ts AS "lastTs"
    FROM machines m
    JOIN (
      SELECT "machineId", MAX(ts) AS max_ts
      FROM ot_telemetry
      WHERE "machineId" IS NOT NULL
      GROUP BY "machineId"
    ) t ON t."machineId" = m.id
    WHERE m."isActive" = true
  `);

  const rows: Array<{ machineId: number; lastTs: string | Date | null }> =
    ((res as any).rows ?? res ?? []) as any;

  const nowMs = Date.now();
  const thresholdMs = ttl * 1000;
  let changed = 0;
  let checked = 0;

  for (const row of rows) {
    const machineId = Number(row.machineId);
    if (!Number.isFinite(machineId) || row.lastTs == null) continue;
    checked += 1;
    const lastMs = new Date(row.lastTs).getTime();
    if (!Number.isFinite(lastMs)) continue;
    const online = nowMs - lastMs <= thresholdMs;
    try {
      const wrote = await recordPresence(machineId, online ? "online" : "offline", { source: "telemetry" });
      if (wrote) changed += 1;
    } catch (err) {
      console.error(
        `[MachinePresence] recordPresence failed for machine ${machineId}:`,
        (err as Error)?.message ?? err,
      );
    }
  }

  return { checked, changed };
}

/** Bắt đầu sweep định kỳ suy presence từ telemetry recency. Idempotent + tự-gate cờ. */
export function startMachinePresence(): void {
  if (!presenceEnabled()) {
    console.log("[MachinePresence] disabled (set MACHINE_PRESENCE_ENABLED=true to enable)");
    return;
  }
  if (sweepTimer) {
    console.log("[MachinePresence] already running");
    return;
  }
  const intervalMs = sweepIntervalMs();
  console.log(
    `[MachinePresence] starting sweep (ttl=${ttlSeconds()}s, interval=${Math.round(intervalMs / 1000)}s)`,
  );

  const runSweep = async () => {
    if (sweeping) return; // không chồng lấn
    sweeping = true;
    try {
      const r = await sweepPresenceFromTelemetry();
      if (r.changed > 0) {
        console.log(`[MachinePresence] sweep: ${r.changed}/${r.checked} machine status change(s)`);
      }
    } catch (err) {
      console.error("[MachinePresence] sweep failed:", (err as Error)?.message ?? err);
    } finally {
      sweeping = false;
    }
  };

  // Chạy 1 lần ngay rồi lặp lại.
  void runSweep();
  const timer = setInterval(() => void runSweep(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  sweepTimer = timer;
}

/** Dừng sweep. Idempotent no-op khi chưa chạy. */
export function stopMachinePresence(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
    console.log("[MachinePresence] stopped");
  }
}

/** Cấu hình hiện tại (cho endpoint health / chẩn đoán). */
export function getMachinePresenceConfig() {
  return {
    enabled: presenceEnabled(),
    running: sweepTimer !== null,
    ttlSeconds: ttlSeconds(),
    sweepIntervalSeconds: Math.round(sweepIntervalMs() / 1000),
    trackedMachines: lastWrittenStatus.size,
  };
}
