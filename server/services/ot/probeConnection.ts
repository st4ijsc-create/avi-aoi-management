/**
 * doc 81 Đợt 1B Task 1 — DÒ KẾT NỐI CÓ HẠN TỔNG cho mọi driver OT (đường dùng chung của
 * `deviceAdapter.testConnection`).
 *
 * Trước bản này router bọc connect và disconnect MỖI CÁI một hạn riêng (8 s + 8 s) và bỏ
 * mặc kết nối nếu connect xong muộn sau hạn — driver treo ở close(cb) (Modbus/Techman) hoặc
 * dropConnection (MC) giữ socket vĩnh viễn (BE1 §0 (1)(2)).
 *
 * Hợp đồng:
 *   - Một hạn TỔNG `timeoutMs + PROBE_MARGIN_MS` bao cả connect lẫn disconnect.
 *   - connect lỗi/hết hạn ⇒ reject với lỗi gốc (người gọi giữ nguyên chi tiết kỹ thuật).
 *   - LUÔN dọn: disconnect được gọi khi connect xong/lỗi; nếu connect còn treo lúc hết hạn
 *     thì gọi disconnect NGAY, và gọi LẠI khi connect rốt cuộc xong (kết nối muộn không rò).
 *   - Không đọc/ghi tag nào.
 */
import type { OtConnectionConfig, OtDriver } from "./otDriver";
import { withDeadline } from "./drivers/boundedClose";

/** Biên cộng vào timeoutMs cho hạn tổng (đóng có hạn của driver ≤ 2 s). */
export const PROBE_MARGIN_MS = 2000;

export interface ProbeResult {
  /** Thời gian tới khi connect thành công (ms). */
  latencyMs: number;
}

/**
 * Dò kết nối: connect → disconnect trong một hạn tổng. Resolve khi connect được;
 * reject (lỗi gốc hoặc lỗi hết hạn) khi không. Không bao giờ treo quá hạn tổng.
 */
export async function probeOtConnection(
  driver: OtDriver,
  cfg: OtConnectionConfig & { timeoutMs: number },
  overallMs: number = cfg.timeoutMs + PROBE_MARGIN_MS,
): Promise<ProbeResult> {
  const t0 = Date.now();
  const deadlineAt = t0 + overallMs;
  const safeDisconnect = () =>
    Promise.resolve()
      .then(() => driver.disconnect())
      .catch(() => undefined);

  const connectP = Promise.resolve().then(() => driver.connect(cfg));
  // Dọn khi connect settle — kể cả settle MUỘN sau hạn tổng (không await ngoài hạn).
  const settledCleanup = connectP.then(safeDisconnect, safeDisconnect);

  let connectPending = true;
  connectP.then(
    () => (connectPending = false),
    () => (connectPending = false),
  );

  try {
    await withDeadline(connectP, overallMs, `${driver.protocol} connect`);
    return { latencyMs: Date.now() - t0 };
  } finally {
    // connect còn treo lúc hết hạn ⇒ hạ transport ngay (best-effort, không đợi).
    if (connectPending) void safeDisconnect();
    const remain = Math.max(0, deadlineAt - Date.now());
    await withDeadline(settledCleanup, remain, `${driver.protocol} disconnect`).catch(() => undefined);
  }
}
