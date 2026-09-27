/**
 * Doc 80 Đợt 1 final wave (item 2) — MỘT chỗ gắn "client bỏ đi ⇒ huỷ lượt model" cho mọi tuyến SSE.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ `res.on("close")` + `!res.writableFinished`, KHÔNG `req.on("close")` — ĐO, KHÔNG ĐOÁN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 8 đo trên Node 24.18 (express thật, thân JSON): `req` phát `close` **~1 ms** sau khi handler
 * chạy — tức ngay khi thân yêu cầu đã đọc xong, KHÔNG phải khi client ngắt. Năm tuyến stream cũ
 * (`/api/ai/stream/{generate,chat,narrative}`, `/api/ai/local-kb/stream`, `/v1/chat/completions`)
 * đều gắn `req.on("close")` SAU một `await` (xác thực / kiểm engine) ⇒ sự kiện đã qua ⇒ lắng nghe
 * KHÔNG BAO GIỜ chạy ⇒ nút Dừng của người dùng không tới llama-server, khe bị giữ tới idle-timeout
 * (120 s). Final review 2026-09-27 xác nhận ở cả năm chỗ; tuyến duy nhất đúng là của Task 8
 * (`programmingCopilotStream.ts:86-91`) — đây là bản dùng chung của đúng mẫu ấy.
 *
 *   • `res` phát `close` đúng lúc socket đóng (đo: client abort ⇒ `res close` sau ~515 ms,
 *     `writableFinished:false`); khi CHÍNH TA `end()` xong thì `writableFinished:true` ⇒ không huỷ.
 *   • `close` có thể đã phát TRONG các `await` phía trên chỗ gắn ⇒ socket đã chết thì huỷ NGAY.
 *
 * `AbortController.signal` phải đi tiếp xuống `chatCompletionStream` / `generateTextStream` (đối số
 * THỨ BA) → `aiLlamaServerClient.streamChatCompletion` → `fetch` — đây chỉ là nửa "phát hiện"; nửa
 * "lan xuống" được lưới `aiStreamCancel.dot1FinalWave.test.ts` đo ở phía llama-server GIẢ.
 */
import type { Request, Response } from "express";

export function huyKhiClientBoDi(
  req: Request,
  res: Response,
  boHuy: AbortController,
  /** Chạy TRƯỚC `abort()` khi client bỏ đi (vd đặt cờ "thôi ghi ra res"). */
  truocKhiHuy?: () => void,
): void {
  const huy = () => {
    truocKhiHuy?.();
    boHuy.abort();
  };
  res.on("close", () => {
    if (!res.writableFinished) huy();
  });
  if (res.destroyed || req.socket?.destroyed) huy();
}
