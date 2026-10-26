import { COOKIE_NAME } from "@shared/const";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { parse as parseCookieHeader } from "cookie";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { beginStopAuthWarm, isStopOnlyCall, noteAuthenticatedUser } from "../services/robot/robotStopAuthMemo"; // doc 81 Đợt 10 D fix review 5 (R-10-bb) + 7 (R-10-bg/bh)
import { HAN_TONG_STOP_HMI_MS, HAN_XAC_THUC_STOP_HMI_MS, laGoiChiDungMay, laLoiStopQuaHan, trongHanYeuCauStopHmi } from "./hanStopHmi";

/**
 * SCADA R1b-2a Task 4 (M-1; mở rộng R-10-bb cho STOP HMI) + fix round 1 (I-1): request CHỈ gồm `scadaCommands.dungMay` có MỘT hạn tổng
 * `HAN_TONG_STOP_HMI_MS` (2,5 s) bắt đầu Ở ĐÂY, gắn vào `ctx.hanChotStopHmi`; xác thực dùng min(`HAN_XAC_THUC_STOP_HMI_MS`, còn lại),
 * middleware và handler dùng phần còn lại. Chi tiết + những gì nằm NGOÀI hạn: server/_core/hanStopHmi.ts.
 */
export { HAN_TONG_STOP_HMI_MS, HAN_XAC_THUC_STOP_HMI_MS, laGoiChiDungMay };

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
  /**
   * SCADA R1b-2a T4 fix round 1 (I-1) — mốc epoch ms hết hạn TỔNG của request STOP HMI (`scadaCommands.dungMay` gửi một mình). Chỉ
   * createContext đặt (theo request, không đọc từ dây); cổng đổi mật khẩu / giấy phép / phạm vi tenant và `dungMayHmi` chờ DB trong phần còn
   * lại. Vắng ⇒ không hạn (mọi request khác).
   */
  hanChotStopHmi?: number;
  /**
   * SCADA R1b-2a final-fix (điều phối 2026-10-26) — `true` ⇔ người gọi ĐANG bị buộc đổi mật khẩu và thủ tục là `scadaCommands.dungMay`
   * (miễn cổng — `THU_TUC_STOP_MIEN_CONG_DOI_MAT_KHAU`). CHỈ `chanKhiPhaiDoiMatKhau` đặt (qua `next({ ctx })`); createContext không bao giờ
   * đặt, không đọc từ dây. `dungMayHmi` dùng nó để ghi audit "STOP khi đang bị buộc đổi mật khẩu".
   */
  stopKhiBuocDoiMatKhau?: true;
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

  // SCADA R1b-2a T4 fix round 1 (I-1) — hạn TỔNG của request STOP HMI, đo từ đây (theo request; middleware + handler đọc `ctx.hanChotStopHmi`)
  const hanChotStopHmi = laGoiChiDungMay(opts.info) ? Date.now() + HAN_TONG_STOP_HMI_MS : undefined;

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
    const xacThuc = sdk.authenticateRequest(opts.req, { boQuaCongDoiMatKhau: true });
    /**
     * SCADA R1b-2a T4 (+ fix round 1 I-1/I-2) — request CHỈ gồm STOP HMI (`scadaCommands.dungMay`): xác thực ĐẦY ĐỦ như mọi request (sổ
     * phiên, isActive, cổng đổi mật khẩu — KHÔNG có đường suy giảm như robot.consoleStop), dưới min(HAN_XAC_THUC_STOP_HMI_MS, còn lại của
     * hạn tổng). Quá hạn ⇒ NÉM `SCADA_STOP_PRECHECK_TIMEOUT {ma STOP_QUA_HAN, pha xac_thuc}` (HTTP 503; tRPC 11 trả nguyên TRPCError của
     * createContext — thủ tục KHÔNG chạy): fail-closed. Truy vấn bị bỏ rơi VẪN chạy nền. Chưa biết danh tính ⇒ không có dòng
     * scada_command_attempts (user_id NOT NULL) / audit — đếm trong bộ nhớ (M-3, `demStopQuaHanKhongGhiSo`) + log.
     */
    user = await trongHanYeuCauStopHmi(xacThuc, hanChotStopHmi, "xac_thuc", "xac_thuc", HAN_XAC_THUC_STOP_HMI_MS);
    noteAuthenticatedUser(user, extractSessionToken(opts.req), warmTicket); // R-10-bb / R-10-be (bound to the session) — the last identity a FULL authentication resolved (the degraded STOP's only fallback)
  } catch (error) {
    if (laLoiStopQuaHan(error)) throw error;
    // Authentication is optional for public procedures.
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    sessionToken: extractSessionToken(opts.req),
    ...(hanChotStopHmi !== undefined ? { hanChotStopHmi } : {}),
  };
}
