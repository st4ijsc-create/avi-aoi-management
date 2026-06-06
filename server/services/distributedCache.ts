/**
 * G0 — Distributed cache helpers (xây trên redisService).
 *
 * redisService đã cung cấp get/set/delete với Redis + fallback in-memory tự động,
 * nên module này KHÔNG tự kết nối hạ tầng — chỉ thêm các tiện ích an toàn đa-instance:
 *   - tryAcquireCooldown: chống spam (alert cooldown) dùng chung giữa các instance.
 *   - assignment cache: lưu/đọc bản đồ phân công (machine → operator/line...).
 *
 * Khi REDIS_URL chưa bật, mọi thứ vẫn chạy đúng ở chế độ in-memory (single instance).
 */

import { redisService } from "./redisService";

/**
 * Thử "chiếm" một cooldown. Trả về true nếu hành động được phép (và đặt cooldown),
 * false nếu vẫn đang trong thời gian chờ.
 *
 * Ở chế độ Redis dùng SET NX EX (atomic, an toàn đa-instance) khi client sẵn sàng;
 * fallback get/set khi không có Redis (single instance vẫn chính xác).
 */
export async function tryAcquireCooldown(key: string, ttlSeconds: number): Promise<boolean> {
  const cooldownKey = `cooldown:${key}`;

  // Ưu tiên đường atomic qua raw client nếu redisService đang kết nối Redis.
  const rawClient = (redisService as unknown as { redis?: any; isConnected?: boolean });
  if (rawClient?.isConnected && rawClient.redis) {
    try {
      // SET key val NX EX ttl → "OK" nếu set thành công (chưa tồn tại), null nếu đã có.
      const prefixed = `avi:${cooldownKey}`;
      const res = await rawClient.redis.set(prefixed, "1", "EX", ttlSeconds, "NX");
      return res === "OK";
    } catch {
      /* rơi xuống fallback */
    }
  }

  // Fallback (in-memory hoặc Redis lỗi tạm thời): check-then-set.
  const existing = await redisService.get<number>(cooldownKey);
  if (existing !== null) return false;
  await redisService.set(cooldownKey, Date.now(), ttlSeconds);
  return true;
}

/** Xóa cooldown thủ công (vd khi điều kiện cảnh báo đã hết). */
export async function clearCooldown(key: string): Promise<void> {
  await redisService.delete(`cooldown:${key}`);
}

/** Lưu giá trị assignment cache (machine→operator/line...) với TTL (mặc định 1h). */
export async function setAssignment<T>(scope: string, id: string, value: T, ttlSeconds = 3600): Promise<void> {
  await redisService.set(`assign:${scope}:${id}`, value, ttlSeconds);
}

/** Đọc giá trị assignment cache. */
export async function getAssignment<T>(scope: string, id: string): Promise<T | null> {
  return redisService.get<T>(`assign:${scope}:${id}`);
}

/** Vô hiệu hoá toàn bộ assignment cache của một scope. */
export async function invalidateAssignments(scope: string): Promise<number> {
  return redisService.invalidateByPattern(`assign:${scope}:*`);
}
