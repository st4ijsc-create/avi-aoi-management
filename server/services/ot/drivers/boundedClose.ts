/**
 * doc 81 Đợt 1B Task 1 — ĐÓNG CÓ HẠN GIỜ cho client của driver hiện trường.
 *
 * Vì sao cần: thư viện giao thức đóng kết nối bằng callback mà KHÔNG bảo đảm callback chạy.
 *   • `modbus-serial` 8.0.25 `TcpPort.close(cb)` chỉ gọi `socket.end()` rồi đợi sự kiện
 *     `close` — và chỉ gọi cb khi `openFlag` còn true (ports/tcpport.js:145-155, 203). Socket
 *     đã đứt / chưa từng mở / peer không trả FIN ⇒ cb KHÔNG BAO GIỜ chạy.
 *   • `mcprotocol` 0.1.2 `dropConnection()` không nhận callback nào.
 * Driver `await` những callback đó ⇒ `connect()` (nhánh catch), `disconnect()`, `sup.stop()`
 * treo vĩnh viễn (BE1 §0 (1)(2)).
 *
 * Hợp đồng: gọi đóng êm; nếu không xong trong `closeTimeoutMs` (mặc định 2000) thì
 * `destroy()` transport nền rồi TRẢ VỀ. Không bao giờ ném, không bao giờ treo.
 *
 * API công khai (Task 2 dùng lại cho hạn giờ khởi động từng adapter):
 *   - `boundedClose({ close, destroy, closeTimeoutMs?, skipGraceful? })` — dạng tổng quát.
 *   - `closeModbusClient(client, closeTimeoutMs?)` — cho `ModbusRTU` của modbus-serial.
 *   - `withDeadline(p, ms, label)` — race có hạn, DỌN timer (không giữ event loop).
 */

export const DEFAULT_CLOSE_TIMEOUT_MS = 2000;

/** Cách kết thúc: đóng êm kịp hạn · phải destroy · không có gì để đóng. */
export type BoundedCloseOutcome = "closed" | "destroyed" | "noop";

export interface BoundedCloseOptions {
  /** Đóng êm; gọi `done` khi xong. Được phép ném hoặc không bao giờ gọi `done`. */
  close: (done: () => void) => void;
  /** Hạ cứng transport nền (đồng bộ, idempotent). Lỗi bị nuốt. */
  destroy: () => void;
  /** Hạn cho đóng êm (ms). Mặc định {@link DEFAULT_CLOSE_TIMEOUT_MS}. */
  closeTimeoutMs?: number;
  /**
   * true ⇒ không có gì để đóng êm (socket chưa từng mở / đã đứt): destroy ngay,
   * không đợi hạn — tránh cộng thêm closeTimeoutMs vào mỗi lần connect thất bại.
   */
  skipGraceful?: boolean;
}

function safeDestroy(destroy: () => void): void {
  try {
    destroy();
  } catch {
    // destroy là lưới cuối — không để nó ném ra host
  }
}

/**
 * Đóng có hạn giờ. Luôn resolve (không reject) trong ≤ closeTimeoutMs (+ một tick).
 */
export function boundedClose(opts: BoundedCloseOptions): Promise<BoundedCloseOutcome> {
  const ms =
    typeof opts.closeTimeoutMs === "number" && opts.closeTimeoutMs >= 0
      ? opts.closeTimeoutMs
      : DEFAULT_CLOSE_TIMEOUT_MS;

  if (opts.skipGraceful) {
    safeDestroy(opts.destroy);
    return Promise.resolve("destroyed");
  }

  return new Promise<BoundedCloseOutcome>((resolve) => {
    let finished = false;
    const finish = (outcome: BoundedCloseOutcome) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    // Lưới dự phòng: đóng êm không xong trong hạn ⇒ destroy transport nền rồi trả về.
    const timer = setTimeout(() => {
      safeDestroy(opts.destroy);
      finish("destroyed");
    }, ms);
    try {
      opts.close(() => finish("closed"));
    } catch {
      safeDestroy(opts.destroy);
      finish("destroyed");
    }
  });
}

/**
 * Đóng có hạn một `ModbusRTU` (modbus-serial). Socket nền là `client._port._client`
 * (net.Socket của TcpPort). Cổng không mở (`isOpen === false`: chưa từng nối được hoặc
 * đã đứt) ⇒ `close(cb)` chắc chắn không gọi cb ⇒ destroy ngay, không đợi.
 * Client giả (test mock) không có `isOpen`/`_port` ⇒ đi đường đóng êm như cũ.
 */
export function closeModbusClient(
  client: any,
  closeTimeoutMs: number = DEFAULT_CLOSE_TIMEOUT_MS,
): Promise<BoundedCloseOutcome> {
  if (!client) return Promise.resolve("noop");
  const destroy = () => {
    if (typeof client.destroy === "function") {
      try {
        client.destroy(() => undefined);
      } catch {
        // tiếp tục hạ socket nền trực tiếp
      }
    }
    const sock = client?._port?._client;
    if (sock && typeof sock.destroy === "function" && !sock.destroyed) sock.destroy();
  };
  if (typeof client.close !== "function") {
    safeDestroy(destroy);
    return Promise.resolve("destroyed");
  }
  return boundedClose({
    close: (done) => client.close(() => done()),
    destroy,
    closeTimeoutMs,
    skipGraceful: client.isOpen === false,
  });
}

/**
 * Race `p` với hạn `ms`; hết hạn ⇒ reject Error(`${label} timeout after ${ms}ms`).
 * Timer luôn được dọn (không giữ tiến trình sống sau khi p xong).
 */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
