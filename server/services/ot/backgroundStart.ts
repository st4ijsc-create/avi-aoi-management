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
