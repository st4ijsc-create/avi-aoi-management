import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as db from "../db";
// ★★★ Pha 8 Task 5 — chủ DUY NHẤT của "cột nào của `user_sessions` được rời máy chủ".
import { toPublicSessions, type PublicSession } from "../_core/publicSession";

/**
 * Hình dạng `session.list` trả cho client: **phép chiếu công khai** (cổng KIỂU giữ nguyên — phần
 * giao `{ [K in ServerOnlySessionField]?: never }` vẫn cấm `sessionToken`) **cộng** các giá trị
 * thay thế cho ô rỗng, là hợp đồng hiển thị sẵn có của `client/src/components/SessionManagement.tsx`.
 */
type PhienHienThi = PublicSession & {
  deviceName: string;
  deviceType: string;
  browser: string;
  os: string;
  ipAddress: string;
  location: string;
};

/**
 * Session management router.
 *
 * Canonical session logic lives in server/db/auth.ts (getUserSessions /
 * getSessionByToken / revokeSession / revokeAllSessions). Both this router and
 * userRouter's session procedures delegate to those helpers — no duplicated
 * query logic (audit A bug #3).
 *
 * `ctx.sessionToken` (set in _core/context.ts from the session cookie) is the
 * canonical identifier of the CALLER's session, so `isCurrent` resolves
 * correctly and `revokeAll` preserves the caller's own session.
 *
 * TODO(doc 12 §12.5): session TTL is still the pending 1-year default — do NOT
 * shorten it here until that decision is finalised with the user.
 */
export const sessionRouter = router({
  /**
   * ★★★ Pha 8 Task 5 — phép chiếu nay đi qua **CHỦ DUY NHẤT** `_core/publicSession.ts`.
   *
   * ⚠ Trước bản vá, đây là **bên ĐÚNG** của một cặp song song bất đồng: nó liệt kê tay 10 cột và
   *   **không** trả `sessionToken`, trong khi tuyến song song `user.getSessions` trả **nguyên hàng**.
   *   Nhưng "đúng nhờ liệt kê tay" là đúng **theo thời điểm**: một cột nhạy cảm mới thêm vào
   *   `user_sessions` sẽ không tự vào danh sách này, và bên kia vẫn ở đó để hở lại.
   * ⚠⚠ Các giá trị thay thế (`"Unknown Device"` …) **giữ nguyên** — chúng là hợp đồng hiển thị của
   *    `client/src/components/SessionManagement.tsx`, và đổi chúng là một quyết định về UI, không
   *    phải một phần của bản vá an ninh này. Chúng nay phủ **lên trên** phép chiếu, chứ không còn
   *    **thay** phép chiếu.
   */
  list: protectedProcedure.query(async ({ ctx }): Promise<PhienHienThi[]> => {
    const sessions = await db.getUserSessions(ctx.user.id);
    return toPublicSessions(sessions, ctx.sessionToken).map((s) => ({
      ...s,
      deviceName: s.deviceName || "Unknown Device",
      deviceType: s.deviceType || "unknown",
      browser: s.browser || "Unknown Browser",
      os: s.os || "Unknown OS",
      ipAddress: s.ipAddress || "Unknown",
      location: s.location || "Unknown Location",
    }));
  }),

  // Revoke a specific session (ownership enforced inside db.revokeSession)
  revoke: protectedProcedure
    .input(z.object({ sessionId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.revokeSession(input.sessionId, ctx.user.id);
      return { success: true, message: "Session revoked successfully" };
    }),

  // Revoke all sessions EXCEPT the caller's current one
  revokeAll: protectedProcedure.mutation(async ({ ctx }) => {
    const currentSessionToken = ctx.sessionToken;

    // Resolve the caller's current session row so we can preserve it.
    let currentSessionId: number | undefined;
    if (currentSessionToken) {
      const current = await db.getSessionByToken(currentSessionToken);
      if (current && current.userId === ctx.user.id) {
        currentSessionId = current.id;
      }
    }

    await db.revokeAllSessions(ctx.user.id, currentSessionId);
    return { success: true, message: "All other sessions revoked successfully" };
  }),

  // Count active sessions
  count: protectedProcedure.query(async ({ ctx }) => {
    const sessions = await db.getUserSessions(ctx.user.id);
    return { count: sessions.length };
  }),
});

export default sessionRouter;
