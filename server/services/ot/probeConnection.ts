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
  // doc 81 Đợt 1B Task 2 — cùng hợp đồng, nay đi qua dạng tổng quát probeWithDeadline.
  const { latencyMs } = await probeWithDeadline(
    {
      label: driver.protocol,
      connect: () => driver.connect(cfg),
      disconnect: () => driver.disconnect(),
    },
    overallMs,
  );
  return { latencyMs };
}

/**
 * doc 81 Đợt 1B Task 2 (R8) — dạng TỔNG QUÁT của phép dò có hạn, dùng chung cho mọi loại
 * driver (OT, robot, mặt tiền thiết bị). Cùng hợp đồng với probeOtConnection:
 *   - MỘT hạn tổng `overallMs` bao connect + afterConnect (vd health/getState) + disconnect;
 *   - lỗi/hết hạn ⇒ reject với lỗi gốc (hoặc `${label} connect timeout after …ms`);
 *   - LUÔN dọn: disconnect khi công việc settle (kể cả settle MUỘN sau hạn), và gọi ngay
 *     lúc hết hạn nếu công việc còn treo.
 */
export interface ProbeSteps<T> {
  /** Nhãn cho thông báo hết hạn (vd tên protocol/vendor). */
  label: string;
  connect: () => Promise<unknown>;
  /** Chạy sau khi connect thành công, trong CÙNG hạn tổng (vd health(), getState()). */
  afterConnect?: () => Promise<T>;
  disconnect: () => Promise<unknown>;
}

export interface ProbeOutcome<T> {
  /** Thời gian tới khi connect (+ afterConnect) xong (ms). */
  latencyMs: number;
  /** Kết quả afterConnect (undefined nếu không có). */
  value: T | undefined;
}

export async function probeWithDeadline<T>(steps: ProbeSteps<T>, overallMs: number): Promise<ProbeOutcome<T>> {
  const t0 = Date.now();
  const deadlineAt = t0 + overallMs;
  const safeDisconnect = () =>
    Promise.resolve()
      .then(() => steps.disconnect())
      .catch(() => undefined);

  const workP: Promise<T | undefined> = Promise.resolve()
    .then(() => steps.connect())
    .then(() => (steps.afterConnect ? steps.afterConnect() : undefined));
  // Dọn khi công việc settle — kể cả settle MUỘN sau hạn tổng (không await ngoài hạn).
  const settledCleanup = workP.then(safeDisconnect, safeDisconnect);

  let workPending = true;
  workP.then(
    () => (workPending = false),
    () => (workPending = false),
  );

  try {
    const value = await withDeadline(workP, overallMs, `${steps.label} connect`);
    return { latencyMs: Date.now() - t0, value };
  } finally {
    // công việc còn treo lúc hết hạn ⇒ hạ transport ngay (best-effort, không đợi).
    if (workPending) void safeDisconnect();
    const remain = Math.max(0, deadlineAt - Date.now());
    await withDeadline(settledCleanup, remain, `${steps.label} disconnect`).catch(() => undefined);
  }
}
