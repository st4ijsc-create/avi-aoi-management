/**
 * ★★★ ĐỢT 50 MỤC E — MỘT CHỖ DUY NHẤT ĐỌC "TELEMETRY MỚI NHẤT MỖI ROBOT".
 * ════════════════════════════════════════════════════════════════════════════
 * LỚP LỖI (G110 — vá một lớp lỗi ở N chỗ mà không quét chỗ thứ N+1): ba nơi trong
 * `server/` cùng viết đúng một câu
 *     `select().from(robotTelemetry).where(inArray(robotId, ids)).orderBy(desc(timestamp))`
 * KHÔNG `LIMIT`, rồi giữ hàng đầu tiên của mỗi robot bằng một vòng `for` ở Node:
 *     · `routers/fleetRouter.ts`            robotPositions (bản đồ đội robot)
 *     · `services/fleet/taskAllocator.ts`   loadCandidatesFromDb  ← nhịp 60 s
 *     · `services/fleet/trafficManager.ts`  loadRobotObstacles
 * Trên DB dev (robot_telemetry = 1,38 triệu hàng) mỗi lượt như thế kéo TOÀN BỘ
 * lịch sử về Node: 4,2 – 16,0 giây, chiếm kết nối pool và chẹn vòng lặp sự kiện.
 * Đo được: `[Fleet] pending-drain sweep started (every 60000ms)` gọi `allocateTask`
 * ⇒ số lượt sweep khớp 1:1 với số câu telemetry > 2 s trong log (6/6 và 4/4), và
 * chính nhịp 60 s ấy là nhịp các ĐỘT BIẾN 2,6 – 6,9 s khi vào màn mà QA lần 7 thấy.
 *
 * CÁCH ĐÚNG (đo, không đoán — `.qa-dot50/A-do.json`):
 *   DISTINCT ON      703 – 827 ms   (Seq Scan 3 chunk chưa nén + external merge)
 *   JOIN LATERAL     198 – 317 ms   (biến tương quan chặn ChunkAppend loại chunk)
 *   LIMIT 1/robot    1,9 – 4,3 ms   ← hằng số `robotId` vào kế hoạch, EXPLAIN cho
 *                                     9/10 chunk "never executed"
 * ⇒ ĐẦU RA GIỐNG TỪNG BYTE (md5 `7fcbb5de…` cho cả câu cũ lẫn câu mới).
 *
 * KHÔNG index mới, KHÔNG migration: `idx_robot_telemetry_robot_time`
 * (`"robotId","timestamp"`) ĐÃ CÓ trên mọi chunk; thứ thiếu là một hằng số
 * `robotId` trong kế hoạch, không phải một index.
 */
import { desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { robotTelemetry } from "../../drizzle/schema";

/** Chính kiểu `getDb()` trả về — không dựng kiểu cấu trúc riêng (dễ lệch khỏi drizzle thật). */
type BoDocDrizzle = PostgresJsDatabase<Record<string, unknown>>;

/** Một hàng `robot_telemetry` như drizzle đọc ra. */
export type HangTelemetryRobot = typeof robotTelemetry.$inferSelect;

/**
 * Số câu chạy song song trong một lô. Chặn để một đội robot lớn không nuốt hết
 * pool (`DB_POOL_MAX` mặc định 25) — mọi người gọi đều nằm trên đường ĐỌC hoặc
 * trên nhịp nền, không được phép làm đói các thủ tục khác.
 */
export const BUOC_TELEMETRY = 8;

/** Bản ghi telemetry mới nhất của MỘT robot (hoặc `undefined` nếu robot chưa gửi gì). */
export async function traTelemetryRobotMoiNhat(
  d: BoDocDrizzle,
  robotId: number,
): Promise<HangTelemetryRobot | undefined> {
  const [hang] = await d
    .select()
    .from(robotTelemetry)
    .where(eq(robotTelemetry.robotId, robotId))
    .orderBy(desc(robotTelemetry.timestamp))
    .limit(1);
  return hang;
}

/**
 * Map robotId → bản ghi telemetry mới nhất, cho một danh sách robot.
 *
 * ★ Hợp đồng GIỐNG HỆT vòng `for` cũ: robot chưa có telemetry thì VẮNG khỏi map
 *   (không phải `null`, không bịa hàng rỗng), và KHÔNG có cửa sổ thời gian —
 *   robot im lặng ba tháng vẫn trả về bản ghi cuối cùng của nó.
 */
export async function traTelemetryMoiNhatTheoRobot(
  d: BoDocDrizzle,
  ids: number[],
): Promise<Map<number, HangTelemetryRobot>> {
  const moiNhat = new Map<number, HangTelemetryRobot>();
  for (let i = 0; i < ids.length; i += BUOC_TELEMETRY) {
    const lo = ids.slice(i, i + BUOC_TELEMETRY);
    const ket = await Promise.all(lo.map((id) => traTelemetryRobotMoiNhat(d, id)));
    for (const [j, tel] of ket.entries()) if (tel) moiNhat.set(lo[j], tel);
  }
  return moiNhat;
}
