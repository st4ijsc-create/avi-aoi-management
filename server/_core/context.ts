import { COOKIE_NAME } from "@shared/const";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { beginStopAuthWarm, isStopOnlyCall, noteAuthenticatedUser } from "../services/robot/robotStopAuthMemo"; // doc 81 Đợt 10 D fix review 5 (R-10-bb) + 7 (R-10-bg/bh)

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

  // doc 81 Đợt 10 task D fix review 5 — ruling R-10-bb (L-7): a request made ONLY of the STOP-only procedure (robot.consoleStop)
  // skips the unbounded auth reads here; its own middleware (services/robot/robotStopAuth) verifies the JWT statelessly, then runs
  // session / user / permission / scope in parallel under 300 ms. Any other request (a batch mixing anything else) is unchanged.
  if (isStopOnlyCall(opts.info)) {
    return { req: opts.req, res: opts.res, user: null, sessionToken: extractSessionToken(opts.req) };
  }

  try {
    /**
     * 🔴🔴 Pha 8 Task 1 — **NGƯỜI GỌI DUY NHẤT được tắt cổng buộc-đổi-mật-khẩu ở biên xác thực.**
     *
     * ⚠⚠⚠ Đây **KHÔNG** phải một lỗ: nó là chỗ phép chặn được làm lại **MỊN HƠN**. Biên xác thực
     * không biết `path`, nên nếu nó chặn ở đây thì lượt `catch` ngay dưới sẽ đặt `user = null` cho
     * **mọi** thủ tục — kể cả `auth.me` và `user.changePassword` — và người bị chặn mất đúng ô họ
     * cần để biết phải đi đâu. Pha 7 đã deploy một lần ra **nhà tù thật 4/4 tài khoản** vì đúng
     * hình dạng ấy.
     * ⇒ Phép chặn của tRPC nằm ở `thuTucGoc` (`./trpc.ts::chanKhiPhaiDoiMatKhau`), nơi **biết**
     *   `path` nên tha được đúng bốn đường của vòng đời đổi mật khẩu (`THU_TUC_CHO_QUA`).
     * ⚠ Tập "được tắt" gồm **đúng một** phần tử và bị ghim ở
     *   `server/_core/buocDoiMatKhauMoiBeMat.test.ts` §5 (`BE_MAT_TU_CANH`) — thêm phần tử thứ hai
     *   là ĐỎ, không phải một dòng lặng lẽ.
     */
    const warmTicket = beginStopAuthWarm(); // R-10-bh — the invalidation generation at the START of this authentication (before its reads)
    user = await sdk.authenticateRequest(opts.req, { boQuaCongDoiMatKhau: true });
    noteAuthenticatedUser(user, extractSessionToken(opts.req), warmTicket); // R-10-bb / R-10-be (bound to the session) — the last identity a FULL authentication resolved (the degraded STOP's only fallback)
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
