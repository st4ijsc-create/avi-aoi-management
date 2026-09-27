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

type ExpressHandlerOptions<TRouter extends AnyRouter> = Parameters<typeof createExpressMiddleware<TRouter>>[0];

export function createTrpcMiddleware<TRouter extends AnyRouter>(opts: ExpressHandlerOptions<TRouter>) {
  // Ép kiểu vì TS không thu hẹp được phép trải trên kiểu giao có điều kiện (PartialIf) của tRPC.
  return createExpressMiddleware<TRouter>({ ...opts, allowMethodOverride: true } as ExpressHandlerOptions<TRouter>);
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
