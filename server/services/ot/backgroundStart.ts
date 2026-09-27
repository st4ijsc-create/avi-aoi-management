/**
 * doc 81 Đợt 1B Task 2 — khởi động OT NỀN, không bao giờ chặn boot (BE1 §0 (3)).
 *
 * Trước đây `server/_core/index.ts` gọi `await startOt()` TRƯỚC `server.listen`: một adapter
 * treo (Modbus trỏ cổng không ai nghe) ⇒ HTTP server không bao giờ listen. index.ts nay gọi
 * hàm này NGAY SAU `server.listen(...)`.
 *
 * Hợp đồng:
 *   - Trả về NGAY (startFn chưa chạy lúc hàm trả về — hoãn sang microtask kế).
 *   - Promise trả về KHÔNG BAO GIỜ reject: lỗi (ném đồng bộ hay reject) của startFn chỉ được
 *     log qua `logError`; người gọi không cần (và không nên) await.
 *   - Promise trả về resolve khi startFn xong (chỉ để test/quan sát).
 */
export type BackgroundStartLogger = (message: string, detail: unknown) => void;

/** Phần tối thiểu của http/https/net Server mà đuôi boot cần. */
export interface ListenableServer {
  listen(port: number, listeningListener?: () => void): unknown;
}

/**
 * doc 81 Đợt 1B Task 2 (Fix round 1) — ĐUÔI BOOT tách khỏi `server/_core/index.ts` để test được
 * bằng server thật: gọi `server.listen(port, onListening)` TRƯỚC, rồi mới khởi động OT nền qua
 * {@link startBackgroundOt}. Trả về ngay; promise trả về không bao giờ reject (chỉ để quan sát).
 */
export function listenThenStartOt(
  server: ListenableServer,
  port: number,
  onListening: () => void,
  startFn: () => unknown,
  logError: BackgroundStartLogger,
): Promise<void> {
  server.listen(port, onListening);
  return startBackgroundOt(startFn, logError);
}

export function startBackgroundOt(
  startFn: () => unknown,
  logError: BackgroundStartLogger,
): Promise<void> {
  return Promise.resolve()
    .then(startFn)
    .then(
      () => undefined,
      (err) => {
        try {
          logError("[OT] init failed:", (err as Error)?.message || err);
        } catch {
          // logger hỏng cũng không được biến thành unhandled rejection
        }
      },
    );
}
