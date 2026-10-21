/**
 * ★★ Đợt 8.1 Task 4b — TUYẾN WEBHOOK của Luồng AI: `POST /api/flow/webhook/:flowId/:nodeId`, header `x-flow-token`.
 *
 * ⚠⚠ VÌ SAO TUYẾN NÀY KHÔNG ĐÒI PHIÊN: bên gọi là HỆ THỐNG NGOÀI (máy AOI, MES, kịch bản) — không có cookie phiên để
 *   trình. Chứng thực duy nhất là token THEO LUỒNG: 32 byte ngẫu nhiên, CSDL chỉ giữ sha256 (mig 0402), so thời gian hằng,
 *   sinh khi người có quyền BẬT luồng (tRPC `flow.datPhienBanHoatDong`, hạng ≥ `ngoai-ghi` đòi admin). Logic ở
 *   `server/services/flow/kichHoat/webhook.ts`; tệp này chỉ dịch kết quả ra HTTP.
 * ⚠ Cổng giấy phép MOD_AI: `chanTuyenAiTheoGiayPhep()` đứng TRƯỚC handler (tuyến không nằm dưới nhánh `/api/ai`).
 * ⚠ Thân JSON tự đọc với trần 256 KB — `_core/index.ts` bỏ qua bộ đọc thân chung (25 MB) cho tiền tố này.
 * Trả: 202 `{ runId }` · 401 token sai/thiếu · 404 node không phải webhook · 409 luồng tắt · 413 thân quá lớn.
 */
import express from "express";
import { chanTuyenAiTheoGiayPhep } from "./congGiayPhepAiExpress";

export const TIEN_TO_WEBHOOK_LUONG = "/api/flow/webhook/";

function docThanJson(): express.RequestHandler {
  const docJson = express.json({ limit: "256kb", type: () => true });
  return (req, res, next) => {
    docJson(req, res, (err?: unknown) => {
      if (!err) return next();
      const loai = (err as { type?: string }).type;
      const ma = loai === "entity.too.large" ? 413 : 400;
      res.status(ma).setHeader("Cache-Control", "no-store");
      // data-raw-ok: thân lỗi cho client MÁY (hệ thống ngoài gọi webhook) — `code` là hợp đồng, client web không đọc tuyến này.
      res.json({ success: false, code: "INVALID_VALUE", error: ma === 413 ? "body exceeds 256 KB" : "body is not valid JSON" });
    });
  };
}

/** ★ Đợt 9 (L3) — token TRƯỚC thân: sai/thiếu ⇒ 401 và ĐÓNG kết nối, KHÔNG đọc thân (bộ đọc JSON đứng sau middleware này). */
function kiemTokenTruoc(): express.RequestHandler {
  return async (req, res, next) => {
    try {
      const { kiemTokenTruocThan } = await import("../services/flow/kichHoat/webhook");
      const kq = await kiemTokenTruocThan({ flowId: String(req.params.flowId ?? ""), nodeId: String(req.params.nodeId ?? ""), token: req.get("x-flow-token") });
      if (kq.ok) return next();
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Connection", "close");
      // data-raw-ok: thân lỗi cho client MÁY — `code` là hợp đồng (cùng mã/thông điệp với xuLyWebhook).
      res.status(kq.ma).json(kq.ma === 401 ? { success: false, code: "AUTH_REQUIRED", error: "token webhook sai hoặc thiếu" } : { success: false, code: "DB_UNAVAILABLE", error: "không có kết nối CSDL" });
    } catch (err) {
      console.error("[luong-ai] webhook (kiểm token) lỗi:", String((err as Error)?.message ?? err).slice(0, 300));
      // data-raw-ok: không đẩy thông điệp ngoại lệ nội bộ ra ngoài.
      res.status(500).json({ success: false, code: "OPERATION_FAILED", error: "internal error" });
    }
  };
}

export function registerFlowWebhookRoutes(app: express.Express): void {
  app.post("/api/flow/webhook/:flowId/:nodeId", chanTuyenAiTheoGiayPhep(), kiemTokenTruoc(), docThanJson(), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const { xuLyWebhook } = await import("../services/flow/kichHoat/webhook");
      const kq = await xuLyWebhook({
        flowId: String(req.params.flowId ?? ""),
        nodeId: String(req.params.nodeId ?? ""),
        token: req.get("x-flow-token"),
        than: req.body,
        kichThuoc: Number(req.get("content-length") ?? 0),
        idemKey: req.get("idempotency-key"),
      });
      if (kq.ma === 202) {
        res.status(202).json({ success: true, runId: kq.runId, trung: kq.trung });
        return;
      }
      if (kq.ma === 429 && kq.retryAfterS) res.set("Retry-After", String(kq.retryAfterS));
      // data-raw-ok: thân lỗi cho client MÁY — `code` (mã AppError đã có bản dịch) là hợp đồng.
      res.status(kq.ma).json({ success: false, code: kq.code, error: kq.thongDiep });
    } catch (err) {
      console.error("[luong-ai] webhook lỗi:", String((err as Error)?.message ?? err).slice(0, 300));
      // data-raw-ok: không đẩy thông điệp ngoại lệ nội bộ ra ngoài.
      res.status(500).json({ success: false, code: "OPERATION_FAILED", error: "internal error" });
    }
  });
}
