import { COOKIE_NAME } from "@shared/const";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /**
   * Raw session cookie (the signed session JWT) for the current request, or
   * null when unauthenticated. This IS the canonical session identifier: the
   * same value stored in `user_sessions.sessionToken` at login time. Session
   * procedures (sessionRouter / userRouter) use it so `isCurrent` resolves
   * correctly and `revokeAll` keeps the CALLER's session while revoking the
   * others. Previously this was never populated, so `revokeAll` logged the
   * caller out of everything and `isCurrent` was always false (audit A bug #3).
   *
   * Optional in the type so existing `createCaller({...})` test contexts keep
   * compiling; createContext() always populates it at runtime.
   */
  sessionToken?: string | null;
  /**
   * ★★★ Pha 6 Task 6 — **DẤU CỦA LƯỢT GỌI**, do `stepUpTotpMiddleware` đúc ra sau một lượt
   * `speakeasy.totp.verify` THÀNH CÔNG và truyền xuống bằng `next({ ctx })`.
   *
   * ⚠ `createContext()` **KHÔNG BAO GIỜ** đặt ô này — nó không tới từ người gọi, không đọc được
   * từ dây, không đoán được. Nó tồn tại **chỉ trong bộ nhớ của một lượt gọi đang chạy**, để sổ mã
   * OTP đã tiêu (`_core/totpOnce.ts`) phân biệt được *"lượt verify thứ N của CÙNG lượt gọi"* —
   * chuỗi `deployProcedure` verify **cùng một mã 2–3 lần** cho MỘT lượt bấm nút — với *"một lượt
   * gọi KHÁC đang phát lại mã"*. Không có ô này thì sổ tự chặn mình và giết 100 % lệnh
   * VRAM/deploy; xem khối docstring ở `_core/totpOnce.ts`.
   */
  __luotXacMinhTotp?: string;
};

function extractSessionToken(
  req: CreateExpressContextOptions["req"]
): string | null {
  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return null;
  const parsed = parseCookieHeader(cookieHeader);
  return parsed[COOKIE_NAME] ?? null;
}

export async function createContext(
  opts: { req: CreateExpressContextOptions["req"]; res: CreateExpressContextOptions["res"]; info?: unknown }
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    sessionToken: extractSessionToken(opts.req),
  };
}
