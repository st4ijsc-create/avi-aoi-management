/**
 * Sprint 5 §4.2 — dựng TRPCError mang mã máy-đọc-được.
 *
 * Cơ chế bám đúng khuôn `mpConflict` đã có ở trpc.ts:16-24 (doc 31 UX3): gắn
 * dữ liệu lên `cause`, để `errorFormatter` nâng lên `shape.data`. Không phát
 * minh đường truyền mới.
 *
 * `fallbackMessage` KHÔNG bị bỏ đi: log máy chủ, API `/v1` cho bên thứ ba, và
 * client chưa có khoá i18n đều đọc nó. Nó là lưới an toàn, không phải rác.
 */
import { TRPCError } from "@trpc/server";
import type { AppErrorCode, AppErrorParams } from "./appErrorCodes";

export type { AppErrorCode, AppErrorParams };

type TrpcCode = ConstructorParameters<typeof TRPCError>[0]["code"];

interface AppErrorCause {
  appCode: AppErrorCode;
  appParams?: AppErrorParams;
}

export function appError(
  trpcCode: TrpcCode,
  appCode: AppErrorCode,
  params?: AppErrorParams,
  fallbackMessage?: string,
): TRPCError {
  const cause: AppErrorCause = { appCode, ...(params ? { appParams: params } : {}) };
  return new TRPCError({
    code: trpcCode,
    // Không bao giờ để message rỗng: log rỗng là log vô dụng.
    message: fallbackMessage ?? appCode,
    cause,
  });
}

/** Đọc lại metadata từ một lỗi bất kỳ. Trả null cho lỗi chưa di trú — dùng
 *  trong errorFormatter và trong test, không ném với đầu vào lạ. */
export function readAppErrorMeta(err: unknown): { appCode: string; appParams?: AppErrorParams } | null {
  if (!err || typeof err !== "object") return null;
  const cause = (err as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return null;
  const appCode = (cause as { appCode?: unknown }).appCode;
  if (typeof appCode !== "string") return null;
  const appParams = (cause as { appParams?: unknown }).appParams;
  return {
    appCode,
    appParams: appParams && typeof appParams === "object" ? (appParams as AppErrorParams) : undefined,
  };
}
