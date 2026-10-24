/**
 * Doc 80 Đợt 1 Task 6 (XC-01) — adapter tRPC ↔ Express của app.
 *
 * `allowMethodOverride: true`: server nhận QUERY gửi bằng POST (input trong body). Client
 * (`client/src/lib/trpcLinks.ts`) chỉ dùng đường này khi input query serialize > 2 KB — GET
 * mang input trong URL từng gãy HTTP 431 ở 30 block IR / 20 rung POU / XML PLCopen 12 KB.
 *
 * Phạm vi của override (tRPC 11 `resolveResponse`): query/subscription chấp nhận GET **hoặc**
 * POST; mutation VẪN chỉ POST — override không mở GET cho mutation. Loại thủ tục (`_def.type`)
 * không đổi nên mọi middleware tRPC đọc `type` (audit, idempotency…) thấy đúng "query".
 *
 * Tầng Express đứng TRƯỚC tRPC mà suy "POST ⇒ ghi" (license readonly) phải tra loại thủ tục
 * thật bằng `trpcProcedureType` thay vì đoán theo phương thức HTTP.
 */
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import type { AnyRouter } from "@trpc/server";
import type { NextFunction, Request, Response } from "express";
import { TRPC_MAX_BATCH_SIZE, demThuTucTrongBatch } from "../../shared/trpcBatch";

type ExpressHandlerOptions<TRouter extends AnyRouter> = Parameters<typeof createExpressMiddleware<TRouter>>[0];

export function createTrpcMiddleware<TRouter extends AnyRouter>(opts: ExpressHandlerOptions<TRouter>) {
  // Ép kiểu vì TS không thu hẹp được phép trải trên kiểu giao có điều kiện (PartialIf) của tRPC.
  // `maxBatchSize`: lớp phòng thủ THỨ HAI trong chính tRPC (400 BAD_REQUEST "Batch call exceeds maximum size", không xử lý phần nào); lớp CHÍNH là `trpcBatchLimitMiddleware` bên dưới (mã lỗi rõ, log).
  return createExpressMiddleware<TRouter>({ ...opts, allowMethodOverride: true, maxBatchSize: TRPC_MAX_BATCH_SIZE } as ExpressHandlerOptions<TRouter>);
}

/**
 * ★★★ Trần số thủ tục trong một batch (`/api/trpc/a,b,c?batch=1`). Đứng TRƯỚC mọi thứ đắt (giấy phép, xác thực, bộ giới hạn): vượt trần ⇒ 400 `TRPC_BATCH_QUA_LON` NGAY, KHÔNG xử lý
 * một phần nào (không thủ tục nào chạy). Đếm theo path đã giải mã (%2C) nên không né được. Thân lỗi đúng hình tRPC + superjson (một đối tượng, client nhân ra cho mọi phần tử batch).
 */
export function trpcBatchLimitMiddleware(max: number = TRPC_MAX_BATCH_SIZE) {
  let lanLogCuoi = 0;
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.query?.batch !== "1") return next();
    const n = demThuTucTrongBatch(req.path);
    if (n <= max) return next();
    const bay = Date.now();
    if (bay - lanLogCuoi > 10_000) {
      lanLogCuoi = bay;
      console.warn(`[trpc] batch bị từ chối: ${n} thủ tục > trần ${max} (ip=${req.ip})`);
    }
    res.status(400).setHeader("Cache-Control", "no-store");
    res.json({
      error: {
        json: {
          message: `Yêu cầu gộp ${n} thủ tục, vượt trần ${max}. Tải lại trang để dùng bản client mới (tự chia nhỏ).`,
          code: -32600,
          data: { code: "BAD_REQUEST", httpStatus: 400, appCode: "TRPC_BATCH_QUA_LON", soThuTuc: n, tran: max },
        },
      },
    });
  };
}

export type TrpcProcedureKind = "query" | "mutation" | "subscription";

/**
 * Loại của thủ tục tại `path` (vd "ir.lint") trên router, hoặc `undefined` nếu không có.
 * Chỉ tra khoá RIÊNG của bản đồ thủ tục phẳng (`_def.procedures`) — "__proto__"/"constructor"
 * không bao giờ khớp. Người gọi phải coi `undefined` là "không biết" (fail-closed).
 */
export function trpcProcedureType(router: AnyRouter, path: string): TrpcProcedureKind | undefined {
  const procedures = router._def.procedures as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(procedures, path)) return undefined;
  const type = (procedures[path] as { _def?: { type?: unknown } } | undefined)?._def?.type;
  return type === "query" || type === "mutation" || type === "subscription" ? type : undefined;
}
