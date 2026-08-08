import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC } from "@trpc/server";
import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
// ★★★ Pha 6 Task 6 — CHỦ DUY NHẤT của phép xác minh TOTP (verify + tiêu mã). File này **không
// còn** nhập `speakeasy`: `totpReplayScan.test.ts` cưỡng chế ∀ trên toàn `server/**`.
import { verifyTotpOnce, dauLuotGoiMoi } from "./totpOnce";
// Doc 37 P0-3 — server-side per-module license gate (flag-gated pass-through).
import { moduleGate } from "./moduleGate";
import { appError, readAppErrorMeta } from "./appError";

/**
 * Đợt sửa cuối (Phần 4, khuyến nghị mạnh của review cuối) — CÔNG TẮC QUAY LUI.
 *
 * Trước đây `appCode`/`appParams` được gắn VÔ ĐIỀU KIỆN vào mọi phản hồi lỗi. Nếu
 * sau khi lên production phát hiện một câu dịch sai lan rộng (vd một khoá từ điển
 * gây hiểu nhầm nghiêm trọng hơn câu tiếng Anh gốc), cách duy nhất để lùi lại là
 * revert 43 commit + build lại toàn bộ FE — quá chậm cho một sự cố đang diễn ra.
 *
 * Mặc định BẬT (`!== "false"`, không phải `=== "true"`) — thiếu biến môi trường vẫn
 * giữ hành vi hiện tại (không đổi gì cho ai chưa biết tới cờ này). Đặt
 * `APP_ERROR_CODES_ENABLED=false` để client tự động rơi về ĐÚNG hành vi trước
 * sprint mã-lỗi (message thô làm câu hiện, không có appCode/appParams trong
 * shape.data) — KHÔNG cần đụng bundle FE, vì `trpcErrors.ts`/`errorCodes.ts` phía
 * client đã tự rơi về `fallback` khi `getAppError()` trả null (xem
 * client/src/lib/trpcErrors.ts `getAppError`).
 */
function appErrorCodesEnabled(): boolean {
  return process.env.APP_ERROR_CODES_ENABLED !== "false";
}

/** Xuất riêng để test (appError.test.ts) dựng lại ĐÚNG router thật thay vì chép tay
 *  errorFormatter — bài học §6(2): chặng nối tay bỏ sót làm chết im lặng trường mới. */
export const errorFormatter: TRPCErrorFormatter<
  TrpcContext,
  TRPCDefaultErrorShape & {
    data: TRPCDefaultErrorShape["data"] & {
      conflict?: unknown;
      appCode?: string;
      appParams?: Record<string, string | number>;
    };
  }
> = ({ shape, error }) => {
  // Doc 31 UX3 — additive forward of an optimistic-lock CONFLICT payload. Only
  // present when a mutation threw TRPCError({ cause: { mpConflict } }); every
  // other error is unaffected. Lets the client show current values + a
  // reload/overwrite choice without a second round-trip.
  const mpConflict = (error.cause as { mpConflict?: unknown } | undefined)?.mpConflict;
  // Sprint 5 §4.2 — mã lỗi máy-đọc-được. Chỉ có mặt khi lỗi được dựng bằng
  // appError(); mọi lỗi khác giữ nguyên hình dạng phản hồi như trước.
  const appMeta = appErrorCodesEnabled() ? readAppErrorMeta(error) : null;
  return {
    ...shape,
    data: {
      ...shape.data,
      // Strip stack traces in production to avoid leaking internals
      stack: process.env.NODE_ENV === 'production' ? undefined : shape.data.stack,
      ...(mpConflict ? { conflict: mpConflict } : {}),
      ...(appMeta ? { appCode: appMeta.appCode, ...(appMeta.appParams ? { appParams: appMeta.appParams } : {}) } : {}),
    },
  };
};

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    // Task 10 (F3, doc71) — AUTH_REQUIRED: chưa đăng nhập (ctx.user null), đúng
    // ngữ cảnh mã này được định nghĩa cho (khác PERMISSION_DENIED — có quyền
    // hay không CHỈ xét được sau khi biết là ai).
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, UNAUTHED_ERR_MSG);
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/**
 * Global audit middleware (Phase 0 WS0.5).
 *
 * Records every authenticated MUTATION to the audit log (who/what/when +
 * success|failure + duration). Scoped to authenticated procedures so the
 * high-volume public machine-ingest path (publicProcedure) is not flooded
 * into the audit trail. Fire-and-forget: auditing never blocks or fails the
 * request. Disable with AUDIT_ALL_MUTATIONS=false. Input values are NOT
 * logged here (avoids leaking secrets); call sites that need field-level
 * diffs continue to use auditTrailService directly.
 */
const auditAllMutations = process.env.AUDIT_ALL_MUTATIONS !== "false";

const auditMutationMiddleware = t.middleware(async (opts) => {
  const { ctx, next, type, path } = opts;
  if (!auditAllMutations || type !== "mutation") {
    return next();
  }

  const startedAt = Date.now();
  const result = await next();

  // Fire-and-forget; dynamic import avoids module load-order coupling.
  try {
    const u = ctx.user as { id?: number; username?: string; name?: string } | null;
    const errorCode = result.ok ? undefined : (result as { error?: { code?: string } }).error?.code;
    void import("../services/auditTrailService")
      .then(({ logCrudOperation }) =>
        logCrudOperation(
          {
            userId: u?.id ?? null,
            userName: u?.username ?? u?.name ?? null,
            ipAddress: ctx.req?.ip ?? null,
            userAgent: (ctx.req?.headers?.["user-agent"] as string | undefined) ?? null,
            source: "trpc",
          },
          {
            action: path,
            entityType: "trpc_mutation",
            details: {
              operation: "mutation",
              duration: Date.now() - startedAt,
              metadata: { path, ok: result.ok },
              ...(errorCode ? { errorMessage: errorCode } : {}),
            },
            status: result.ok ? "success" : "failure",
          },
        ),
      )
      .catch(() => {
        /* auditing must never affect the request */
      });
  } catch {
    /* swallow */
  }

  return result;
});

/**
 * Tenant scope middleware (Phase 1 WS4 — RLS).
 *
 * When TENANT_RLS_ENABLED=true, derives the caller's tenant scope (factory /
 * corporate codes, admin → bypass) from their assignments and exposes it on
 * ctx.tenantScope. Data-layer code then runs tenant-table queries via
 * server/db/tenantContext.withTenantScope(db, ctx.tenantScope, fn) to activate
 * the RLS policies. Default off → zero cost and no behaviour change.
 */
const tenantRlsEnabled = process.env.TENANT_RLS_ENABLED === "true";

const tenantScopeMiddleware = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!tenantRlsEnabled || !ctx.user) return next();
  try {
    const { getTenantScope } = await import("./accessControl");
    const scope = await getTenantScope(ctx.user.id, String(ctx.user.role));
    return next({ ctx: { ...ctx, tenantScope: scope } });
  } catch {
    return next(); // never block a request on scope derivation
  }
});

export const protectedProcedure = t.procedure
  .use(requireUser)
  .use(auditMutationMiddleware)
  .use(tenantScopeMiddleware);

/**
 * Doc 37 P0-3 — SERVER-SIDE per-module license enforcement builder.
 *
 * `moduleProcedure('MOD_AI')` == `protectedProcedure.use(moduleGate('MOD_AI'))`:
 * an authenticated procedure that ALSO refuses (FORBIDDEN) when the deployment's
 * license does not include the given optional module. Gated by the
 * LICENSE_MODULE_GATE_ENABLED flag (default OFF → pure pass-through), so wiring a
 * router to it is safe to ship before the flag is flipped. Existing RBAC/permission
 * `.use(...)` chains still compose on top. See server/_core/moduleGate.ts.
 *
 * `moduleGate` is a plain middleware fn (mirrors accessControl.requirePermission),
 * so it can also be appended to admin/role procedures:
 *   `adminProcedure.use(moduleGate('MOD_FEDERATION'))`.
 */
export function moduleProcedure(moduleCode: string) {
  return protectedProcedure.use(moduleGate(moduleCode));
}

// Re-export so a router can gate admin/role procedures directly, e.g.
// `adminProcedure.use(moduleGate('MOD_FEDERATION'))`.
export { moduleGate };

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      // Task 10 (F3, doc71) — điều kiện gộp CẢ "chưa đăng nhập" LẪN "đã đăng
      // nhập nhưng không phải admin" thành MỘT thông báo (tiền lệ ĐÃ CÓ, y hệt
      // hierarchyRouters.ts machineRegistrationGate: `ctx.user?.role !== "admin"`
      // → PERMISSION_DENIED{action:"adminAccess"}) — giữ NGUYÊN hành vi gộp
      // này (không tách thành AUTH_REQUIRED riêng cho nhánh !ctx.user), đúng
      // quy tắc "giữ nguyên trừ khi có lý do rõ": tách sẽ đổi hành vi ngoài
      // phạm vi di trú cơ chế ném lỗi của task này.
      throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "adminAccess" }, NOT_ADMIN_ERR_MSG);
    }

    if (!ctx.user.twoFactorEnabled) {
      throw appError(
        "FORBIDDEN",
        "TWO_FACTOR_NOT_SET_UP",
        // reason "setUpInSecuritySettings" — TÀI KHOẢN NÀY (đã đăng nhập, đã
        // biết là admin) cần ĐI THIẾT LẬP 2FA, đúng lớp 4/6 call site Task 4
        // (F6) đã chốt dùng reason này (không phải nhánh "đang tắt 2FA").
        { reason: "setUpInSecuritySettings" },
        "Tài khoản admin phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.",
      );
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
).use(auditMutationMiddleware).use(tenantScopeMiddleware);

// Role-based procedure factory — accepts an array of allowed roles
type UserRole = 'admin' | 'supervisor' | 'quality_inspector' | 'operator' | 'maintenance' | 'engineer' | 'viewer' | 'user';

// Privileged roles that MUST have 2FA enabled (IEC 62443-2-1 CL2 requirement).
// engineer holds machine_control (OT command authority) → 2FA required (doc 34 P3b decision).
const PRIVILEGED_ROLES: UserRole[] = ['admin', 'supervisor', 'quality_inspector', 'engineer'];

// Exported so routers whose privileged-role set doesn't match one of the
// pre-built supervisorProcedure/qualityProcedure/actuationProcedure combos can
// still chain the SAME 2FA guard (e.g. `roleProcedure("admin","engineer").use(require2FA)`)
// instead of re-implementing the twoFactorEnabled check inline.
export const require2FA = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, UNAUTHED_ERR_MSG);
  }
  if (PRIVILEGED_ROLES.includes(ctx.user.role as UserRole) && !ctx.user.twoFactorEnabled) {
    throw appError(
      "FORBIDDEN",
      "TWO_FACTOR_NOT_SET_UP",
      { reason: "setUpInSecuritySettings" },
      "Tài khoản đặc quyền phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.",
    );
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

// ════════════════════════════════════════════════════════════════════════════
// doc 40 CTL-07 — STEP-UP 2FA cho actuation/deploy.
//
// require2FA (ở trên) chỉ kiểm tra user.twoFactorEnabled — nó KHÔNG re-verify một OTP
// TƯƠI theo từng lệnh. requireFreshTotp bổ sung lớp đó: SAU cờ ACTUATION_STEPUP_2FA
// (mặc định OFF → pass-through hoàn toàn, không đổi hành vi). Khi BẬT, mọi MUTATION đi
// qua middleware này phải kèm `totpCode` (OTP 6 số tươi); verify bằng speakeasy trên
// secret 2FA của user; xác minh thành công được cache 10 phút theo sessionToken để không
// phải nhập lại OTP cho từng lệnh trong phiên làm việc. Fail-closed: cache-miss + thiếu/
// sai OTP ⇒ FORBIDDEN. KHÔNG nới lỏng bất kỳ gate nào — chỉ THÊM một lớp.
//
// ══════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 6 Task 1 (M-4) — HAI BIẾN THỂ, VÀ SỰ KHÁC NHAU LÀ MỘT QUYẾT ĐỊNH AN NINH.
// ══════════════════════════════════════════════════════════════════════════════════════
// Nghiệm thu sống Pha 5 đo được: `engineer1` gọi `vram.preempt` **KHÔNG có `totpCode`**
// vẫn **QUA**, vì cache trên là cache **theo PHIÊN**, **dùng chung cho MỌI thủ tục đứng
// sau middleware này** — vừa step-up cho `programming.deployBuild` thì `vram.preempt`
// chạy 10 phút không hỏi OTP lần nào. Trong khi `VramBrokerPanel` bọc `stepUp.guard(...)`
// và hỏi OTP **mỗi lần bấm** ⇒ **UI che, máy chủ không đóng** (chiều NGƯỢC của lớp lỗi
// "mặt đọc hứa nhiều hơn mặt lệnh": ai đọc mã UI sẽ TƯỞNG đã đóng, và không triệu chứng
// nào xuất hiện).
//
//   • `requireFreshTotp`      — DÙNG cache phiên (hành vi doc 40 CTL-07 nguyên bản).
//   • `requirePerCallFreshTotp` — KHÔNG đọc và KHÔNG ghi cache. Mỗi lượt gọi phải mang
//                               `totpCode` của **CHÍNH lượt ấy**.
//
// ★★★ Pha 6 Task 1b (2026-08-06, quyết định chủ dự án) — `deployProcedure` chain **CẢ HAI**:
//   `actuationProcedure.use(requireFreshTotp).use(requirePerCallFreshTotp)`. Vì thế **cả 7**
//   thủ tục đứng trên nó (5 deploy + 2 lệnh phá huỷ VRAM) nay đòi OTP **mỗi lượt**. Bản đầu
//   của Task 1 hoãn 5 thủ tục kia bằng một luận cứ **SAI SỰ THẬT** (*"deployToFleet chạy 200
//   máy ⇒ siết toàn cục sẽ gãy giữa chừng"*): vòng lặp fleet nằm TRONG MÁY CHỦ, trong MỘT
//   request tRPC (`fleetRollout.ts` → `programmingService` — lời gọi hàm, không qua
//   middleware); client gọi **đúng một lần** và 5/5 điểm gọi đã bọc `stepUp.guard` + đã gửi
//   `totpCode`. ⇒ Rào cản KHÔNG TỒN TẠI, và mối lo #1 của Task 1 (một lượt VRAM có OTP hâm
//   nóng cache dùng chung cho `deployBuild`) nay đóng.
//
// ⚠ PHÁT BIỂU ĐÚNG LƯỢNG TỪ — và nó là **∀**, không phải **∃**:
//     ***∀ lượt gọi một thủ tục đứng sau `requirePerCallFreshTotp`: raw input PHẢI mang
//     một `totpCode` verify được TẠI THỜI ĐIỂM ẤY. KHÔNG lượt nào qua được bằng trạng
//     thái mà một lượt KHÁC để lại.***
// ⚠ Đây **KHÔNG** phải chống phát lại (replay). `speakeasy` verify với `window: 1` ⇒
//   **cùng một mã** dùng lại được trong ~90 s. Cái được đóng là *"qua cửa mà KHÔNG gửi mã
//   nào"* — đúng lỗ đã đo trên hệ sống. Chống phát lại là một cơ chế KHÁC (sổ mã đã dùng),
//   hệ này chưa có, và nó không thuộc phạm vi bản vá này.
// ⚠ `requirePerCallFreshTotp` CHỈ THU HẸP: nó chain **thêm** sau `deployProcedure`, không
//   thay thế và không hạ một tầng nào. Thủ tục nào không chain nó thì hành vi **y hệt** cũ.
// ════════════════════════════════════════════════════════════════════════════

/** doc 40 CTL-07 — cờ bật step-up 2FA cho actuation/deploy (mặc định OFF). */
export function actuationStepUp2faEnabled(): boolean {
  return process.env.ACTUATION_STEPUP_2FA === "true" || process.env.ACTUATION_STEPUP_2FA === "1";
}

const STEPUP_TTL_MS = 10 * 60_000; // 10 phút
/** sessionKey → thời điểm hết hạn (epoch ms) của lần step-up gần nhất. */
const stepUpVerifiedUntil = new Map<string, number>();

/**
 * Verify một OTP TƯƠI trên secret 2FA của user, **và tiêu mã** (Pha 6 Task 6). Fail-closed.
 *
 * ⚠ Lượt verify đi qua `verifyTotpOnce` — chủ DUY NHẤT của `speakeasy.totp.verify` trong
 * `server/**`. `luot` là dấu của **lượt gọi tRPC hiện tại**: chuỗi `deployProcedure` gọi hàm này
 * **2–3 lần cho MỘT lượt bấm nút** (khối I-4 bên dưới), nên không có `luot` thì sổ mã đã tiêu sẽ
 * **tự chặn mình** ngay ở lượt verify thứ hai và giết 100 % lệnh VRAM/deploy.
 */
async function verifyFreshTotp(
  userId: number,
  code: string,
  luot: string,
): Promise<{ hopLe: boolean; phatLai: boolean }> {
  try {
    const [{ getDb }, { users }, { eq }] = await Promise.all([
      import("../db/connection"),
      import("../../drizzle/schema"),
      import("drizzle-orm"),
    ]);
    const db = await getDb();
    if (!db) return { hopLe: false, phatLai: false };
    const [u] = await db
      .select({ secret: users.twoFactorSecret, enabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u || !u.enabled || !u.secret) return { hopLe: false, phatLai: false };
    return await verifyTotpOnce({ userId, secret: u.secret, token: code, luot });
  } catch {
    return { hopLe: false, phatLai: false }; // fail-closed — lỗi tra cứu/verify ⇒ coi như KHÔNG hợp lệ
  }
}

/**
 * Lõi step-up 2FA — **MỘT bản cài, hai chính sách cache**. Viết bản thứ hai là đẻ ra hai vị từ
 * trùng nhau dưới một bất biến, và lớp lỗi ấy đã tốn nhiều pha; ở đây khác biệt duy nhất được
 * nêu **thành một tham số có tên**, nên đọc một chỗ là biết cả hai.
 *
 * @param dungCachePhien `true` ⇒ một lượt step-up thành công mở cửa cho **mọi** thủ tục khác cùng
 *   phiên trong 10 phút (hành vi doc 40 CTL-07). `false` ⇒ **không đọc, không ghi** cache: mỗi lượt
 *   gọi phải mang `totpCode` của chính nó.
 */
function stepUpTotpMiddleware(dungCachePhien: boolean) {
  return t.middleware(async (opts) => {
  const { ctx, next, type } = opts;
  if (!actuationStepUp2faEnabled() || type !== "mutation") return next();
  if (!ctx.user) throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, UNAUTHED_ERR_MSG);

  const sessionKey = ctx.sessionToken || `user:${ctx.user.id}`;
  const now = Date.now();
  const until = dungCachePhien ? stepUpVerifiedUntil.get(sessionKey) : undefined;
  if (until && until > now) return next(); // đã step-up gần đây → khỏi nhập lại

  // Lấy OTP tươi từ raw input (middleware chạy trước khi zod parse).
  let totpCode: string | undefined;
  try {
    const raw = (await opts.getRawInput()) as { totpCode?: unknown; json?: { totpCode?: unknown } } | undefined;
    const candidate = raw?.totpCode ?? raw?.json?.totpCode;
    if (typeof candidate === "string") totpCode = candidate;
  } catch {
    /* raw input không đọc được → coi như thiếu OTP (fail-closed bên dưới) */
  }

  if (!totpCode || !/^\d{6}$/.test(totpCode)) {
    // Task 10 (F3, doc71) — điều kiện gộp "thiếu totpCode" LẪN "sai định dạng
    // (không đúng 6 số)". INVALID_VALUE{field:"twoFactorCode"} theo đúng tiền
    // lệ aoiOnboardingRouter.ts (review cuối, ca I-A #14): trường ".trim() ??
    // ''" gộp rỗng+quá-ngắn dùng INVALID_VALUE thay vì FIELD_REQUIRED, vì
    // FIELD_REQUIRED nói "thiếu" còn ở đây có thể ĐÃ CÓ giá trị (chỉ sai định
    // dạng) — cùng field key "twoFactorCode" đã dùng ở twoFactorRouter.ts:255.
    throw appError(
      "FORBIDDEN",
      "INVALID_VALUE",
      { field: "twoFactorCode" },
      "Yêu cầu mã xác thực 2 bước (OTP 6 số) cho lệnh điều khiển/triển khai.",
    );
  }

  /**
   * ★★★ Pha 6 Task 6 — **DẤU CỦA LƯỢT GỌI.** Middleware đầu tiên trong chuỗi thật sự verify sẽ
   * đúc dấu; các middleware sau **nhận lại đúng dấu ấy qua `ctx`** nên sổ mã đã tiêu biết chúng là
   * cùng MỘT lượt gọi. Ngữ cảnh tRPC chỉ chảy **xuôi trong chính lượt gọi ấy** — hai lượt gọi đi
   * chung một request HTTP gộp lô vẫn có hai chuỗi middleware riêng, mỗi chuỗi bắt đầu từ ngữ
   * cảnh gốc ⇒ dấu **không** rò sang lượt khác.
   */
  const luot = (ctx as { __luotXacMinhTotp?: string }).__luotXacMinhTotp ?? dauLuotGoiMoi();

  const kq = await verifyFreshTotp(ctx.user.id, totpCode, luot);
  if (!kq.hopLe) {
    throw appError(
      "FORBIDDEN",
      "INVALID_VALUE",
      { field: "twoFactorCode" },
      kq.phatLai
        ? "Mã xác thực 2 bước này đã được dùng rồi. Hãy chờ mã mới trên ứng dụng xác thực."
        : "Mã xác thực 2 bước không hợp lệ.",
    );
  }

  if (dungCachePhien) {
    stepUpVerifiedUntil.set(sessionKey, now + STEPUP_TTL_MS);
    // Dọn bộ nhớ (bounded): xoá các mục đã hết hạn khi map phình to.
    if (stepUpVerifiedUntil.size > 5000) {
      for (const [k, v] of stepUpVerifiedUntil) if (v <= now) stepUpVerifiedUntil.delete(k);
    }
  }
  // ★★★ Task 6 — truyền dấu lượt gọi XUỐNG DƯỚI. Chỉ ở nhánh này: đường thoát sớm (cờ OFF · không
  // phải mutation · cache-hit) **không** verify mã nào nên **không** được đúc dấu — nếu không, một
  // cache-hit sẽ phát cho middleware sau một tấm vé "mã này đã được lượt ta xác minh" mà chẳng có
  // mã nào từng được xác minh.
  return next({ ctx: { ...ctx, __luotXacMinhTotp: luot } });
  });
}

/**
 * Middleware step-up 2FA **có cache phiên 10 phút**. Export để router áp dần cho các mutation
 * actuation/deploy. Khi cờ OFF hoặc không phải mutation → pass-through. `totpCode` đọc từ raw input
 * (không phá schema) — hỗ trợ cả bao bì superjson (`{ json: { totpCode } }`).
 * ⚠ Cache là **theo PHIÊN**, không theo thủ tục: một lượt step-up ở bất kỳ thủ tục nào đứng sau
 * middleware này đều mở cửa cho **mọi** thủ tục còn lại trong 10 phút.
 * ⚠⚠ Pha 6 Task 1b — **một mình nó KHÔNG đủ để canh một đường deploy.** `deployProcedure` chain
 * thêm `requirePerCallFreshTotp` **ngay sau** nó, nên một cache-hit chỉ cho qua middleware này,
 * không cho qua cổng. Dùng riêng cái này cho một sàn thủ tục mới ⇒ sàn ấy **hở đúng lỗ M-4**.
 */
export const requireFreshTotp = stepUpTotpMiddleware(true);

/**
 * ★★★ Pha 6 Task 1 (M-4) — step-up 2FA **KHÔNG cache**: mỗi lượt gọi phải mang `totpCode` của
 * **CHÍNH lượt ấy**. Chain **THÊM** vào `deployProcedure` (Task 1b) — không thay thế, không hạ
 * tầng nào.
 *
 * Vì sao không cache **theo thủ tục** (đường đã cân nhắc và **không chọn**): cache theo thủ tục vẫn
 * để lượt gọi **thứ hai** của cùng thủ tục đi qua bằng OTP của lượt **thứ nhất** trong 10 phút —
 * vẫn là *"OTP của một lượt khác"*, tức vẫn không đạt cổng ra.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ I-4 (review TOÀN NHÁNH Pha 6) — **BẢNG CHI PHÍ CŨ SAI Ở CẢ HAI CON SỐ.** Bản trước viết
 * *"khi cache nguội thì OTP được verify **hai lần** … và nó **chỉ xảy ra trên đường cache-miss**"*.
 * Đếm lại trên chuỗi THẬT của `vram.preempt`/`releaseStale`:
 *   `requireFreshTotp` → `requirePerCallFreshTotp` (GỐC, Task 1b) → `requirePermission` →
 *   `requirePerCallFreshTotp` (**lần hai**, `vramRouter.ts`, Task 1 — cố ý giữ).
 * `stepUpTotpMiddleware(false)` **không có** đường thoát sớm (`until` luôn `undefined`), và mỗi
 * `verifyFreshTotp` là **1 `SELECT` trên `users` + 1 `speakeasy.totp.verify`**. ⇒
 *   • **cache-miss = 3 lượt verify** (KHÔNG phải 2);
 *   • **cache-hit  = 2 lượt verify** (KHÔNG phải 0) — tức lượt verify thừa xảy ra ở **MỌI lượt
 *     gọi**, đúng **ngược** với câu *"chỉ trên đường cache-miss"*.
 * Cùng một mã, cùng cửa sổ ⇒ mọi lượt cùng kết quả; **không phải lỗi an ninh** (thừa theo chiều
 * CHẶT), và `getRawInput()` an toàn khi gọi 3 lần (tRPC 11.18.0 bọc `memo()`). Nhưng ai đọc con số
 * cũ để quyết *"có nên chain per-call ở một sàn thứ ba không"* sẽ tính thiếu ~50 %, và một lượt
 * điều tra hiệu năng thấy 3 `SELECT users` cho **một** lượt bấm nút sẽ không tìm ra lời giải thích
 * đúng trong mã. Với hai thủ tục hiếm + đặc quyền thì cái giá ấy vẫn chấp nhận được — nhưng nó
 * phải được **ghi đúng**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ `vramRouter` chain nó **một lần nữa** sau `requirePermission` (Task 1). Dư thừa về hành vi,
 * **cố ý** giữ: lưới cấu trúc của `vramStepUpFreshness.test.ts` phân giải chuỗi **trong phạm vi
 * `vramRouter.ts`**, nên gỡ chỗ ấy đi là gỡ mất phép canh riêng của hai lệnh phá huỷ.
 * ⚠⚠ Lượng từ ∀ của C-2 (`quetLenhPhaHuyVram`, `server/routers/deployProcedureScan.ts`) nay chấp
 * nhận **cả hai** đường siết (tại chỗ **hoặc** qua GỐC), nên lượt `.use()` ở `vramRouter` **không
 * còn** là điều kiện tồn tại của phép canh — nếu chủ dự án muốn thu lại 1 lượt verify/lượt gọi thì
 * gỡ nó đi là an toàn về mặt lưới. Đó là một quyết định về chi phí, không phải về an ninh.
 */
export const requirePerCallFreshTotp = stepUpTotpMiddleware(false);

export function roleProcedure(...allowedRoles: UserRole[]) {
  return t.procedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      if (!ctx.user) {
        throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, UNAUTHED_ERR_MSG);
      }

      if (!allowedRoles.includes(ctx.user.role as UserRole)) {
        // Task 10 (F3, doc71) — `roleProcedure` là factory DÙNG CHUNG (bomRouter,
        // componentLibraryRouter, ...), mỗi call site truyền một tập role khác
        // nhau — không có TÊN hành động cụ thể để gán action. action:
        // "insufficientRole" là khoá CHUNG (giống mọi PERMISSION_DENIED khác đã
        // migrate trong sprint này, danh sách role cụ thể CHỈ còn ở
        // fallbackMessage — mất khi đã dịch, đúng tiền lệ đã chấp nhận cho toàn
        // bộ 687 call site requirePermission() ở accessControl.ts, xem
        // task-10-report.md).
        throw appError(
          "FORBIDDEN",
          "PERMISSION_DENIED",
          { action: "insufficientRole" },
          `Required role: ${allowedRoles.join(' or ')}`,
        );
      }

      return next({ ctx: { ...ctx, user: ctx.user } });
    }),
  ).use(auditMutationMiddleware).use(tenantScopeMiddleware);
}

// Pre-built role procedures for common use cases
// supervisorProcedure and adminProcedure enforce 2FA for privileged roles
export const supervisorProcedure = roleProcedure('admin', 'supervisor').use(require2FA);
export const qualityProcedure = roleProcedure('admin', 'supervisor', 'quality_inspector').use(require2FA);
export const operatorProcedure = roleProcedure('admin', 'supervisor', 'operator');

// ════════════════════════════════════════════════════════════════════════════
// Doc 38 Đợt Q — RBAC hardening: role-floor procedures.
//
// Root gap this closes: `accessControl.requirePermission` only checks the per-user
// permission BIT — it has NO role-floor. A user of ANY role granted a stray
// machine_control/canCreate bit could therefore reach a deploy/actuation path.
// These procedures add a hard role ceiling that composes ON TOP of (never replaces)
// the existing per-user permission `.use(requirePermission(...))` chains.
// ════════════════════════════════════════════════════════════════════════════

// Roles that are read-only by default → blocked from writing master-data mutations.
const WRITE_DENIED_ROLES: UserRole[] = ['viewer', 'user'];

const requireWrite = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, UNAUTHED_ERR_MSG);
  }
  if (WRITE_DENIED_ROLES.includes(ctx.user.role as UserRole)) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      { action: "modifyData" },
      "Tài khoản chỉ-đọc (viewer/user) không có quyền thay đổi dữ liệu.",
    );
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

/**
 * `writeProcedure` — a default write floor: authenticated + NOT a read-only role
 * (viewer/user). Use for master-data mutations that currently sit on a bare
 * `protectedProcedure` with no other guard. Fine-grained `requirePermission(...)`
 * still composes on top when a module-level check is wanted.
 */
export const writeProcedure = protectedProcedure.use(requireWrite);

// Actuation / deploy role-floor: ONLY these roles may issue a device-control or a
// deploy command, regardless of any per-user permission bit. All three are in
// PRIVILEGED_ROLES → 2FA is mandatory (enforced by require2FA below).
const ACTUATION_ROLES: UserRole[] = ['admin', 'supervisor', 'engineer'];

/**
 * `actuationProcedure` — role-floor (admin/supervisor/engineer) + 2FA. Use for EVERY
 * machine-control / deploy path. Chain the per-user permission on top when applying,
 * e.g. `actuationProcedure.use(requirePermission('machine_control','canCreate'))`, and
 * append `.use(moduleGate('MOD_X'))` to also license-gate the surface.
 */
export const actuationProcedure = roleProcedure(...ACTUATION_ROLES).use(require2FA);

/**
 * `deployProcedure` — deploy of a program / workflow / recipe / fleet-task shares the
 * same role-floor + 2FA as actuation, PLUS doc 40 CTL-07 step-up 2FA (gated by
 * ACTUATION_STEPUP_2FA — default OFF → identical to actuationProcedure). Call-sites that
 * adopt it MUST accept a `totpCode` in their input for the fresh-OTP challenge.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * ★★★ Pha 6 Task 1b — PHÉP SIẾT PER-CALL NẰM Ở **GỐC NÀY**, KHÔNG Ở BẢY CHỖ CHAIN TAY.
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Task 1 chain `requirePerCallFreshTotp` cho **hai** lệnh phá huỷ VRAM và hoãn **năm** thủ
 * tục deploy còn lại. Chủ dự án đã chốt **siết nốt** (2026-08-06), nên bất biến đúng nay là
 *
 *   ***∀ thủ tục có chuỗi bắt nguồn từ `deployProcedure`: MỌI lượt gọi phải mang một
 *   `totpCode` verify được TẠI THỜI ĐIỂM ẤY.***
 *
 * Câu ấy là một **∀**, nên phép siết phải nằm ở **một** chỗ mà mọi thủ tục **buộc** đi qua —
 * chính khai báo này. Chain tay ở bảy điểm gọi sẽ biến nó thành một **DANH SÁCH**, và lớp lỗi
 * *"danh sách nào cũng có phần tử thứ N+1"* đã tái diễn 13 lần trong dự án. Ở đây, một thủ tục
 * deploy **thứ tám** sinh ra ở một file **chưa tồn tại** cũng được che **theo cấu tạo**.
 * Lưới: `server/routers/deployStepUpFreshness.test.ts` (phép thử M3 + 5 ca hành vi + 5 đối
 * chứng dương). Xem `task-1b-report.md`.
 *
 * ⚠ **CHỈ THU HẸP**: `requireFreshTotp` giữ nguyên **phía trước** — không gỡ, không hạ tầng
 *   nào. Nó vẫn đọc/ghi cache phiên, nhưng một cache-hit chỉ cho qua **middleware thứ nhất**;
 *   middleware thứ hai vẫn đòi OTP của chính lượt ấy. Giữ nó có hai tác dụng đo được:
 *   (a) các ca đỏ của lưới vẫn **dựng được** cảnh *"OTP của một lượt khác"* — bỏ nó đi thì
 *       cache biến mất và ca đỏ ấy thành **chân lý rỗng**, không còn chứng minh gì;
 *   (b) hỏng-theo-chiều-an-toàn: gỡ nhầm một trong hai vẫn còn cái kia.
 *   Giá phải trả (★ I-4 — **con số cũ SAI**, đã đếm lại trên chuỗi thật): **2 lượt verify ở MỌI
 *   lượt gọi** (`requireFreshTotp` cache-hit + per-call ở gốc), và **3** khi cache nguội. Riêng
 *   `vram.preempt`/`releaseStale` chain per-call **một lần nữa** ở `vramRouter.ts` ⇒ **3 / 4**.
 *   Mỗi lượt verify = 1 `SELECT users` + 1 `speakeasy.totp.verify`. Lệnh deploy là hiếm + đặc
 *   quyền ⇒ chấp nhận được; nhưng câu cũ (*"hai lần, và chỉ trên đường cache-miss"*) sai **cả hai
 *   con số** và sai **cả điều kiện** — đừng trích lại nó.
 */
export const deployProcedure = actuationProcedure.use(requireFreshTotp).use(requirePerCallFreshTotp);
