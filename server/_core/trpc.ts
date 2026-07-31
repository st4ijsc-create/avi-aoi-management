import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC } from "@trpc/server";
import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from "@trpc/server";
import superjson from "superjson";
import speakeasy from "speakeasy";
import type { TrpcContext } from "./context";
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
// ════════════════════════════════════════════════════════════════════════════

/** doc 40 CTL-07 — cờ bật step-up 2FA cho actuation/deploy (mặc định OFF). */
export function actuationStepUp2faEnabled(): boolean {
  return process.env.ACTUATION_STEPUP_2FA === "true" || process.env.ACTUATION_STEPUP_2FA === "1";
}

const STEPUP_TTL_MS = 10 * 60_000; // 10 phút
/** sessionKey → thời điểm hết hạn (epoch ms) của lần step-up gần nhất. */
const stepUpVerifiedUntil = new Map<string, number>();

/** Verify một OTP TƯƠI trên secret 2FA của user (speakeasy — cùng cơ chế đăng ký 2FA). Fail-closed. */
async function verifyFreshTotp(userId: number, code: string): Promise<boolean> {
  try {
    const [{ getDb }, { users }, { eq }] = await Promise.all([
      import("../db/connection"),
      import("../../drizzle/schema"),
      import("drizzle-orm"),
    ]);
    const db = await getDb();
    if (!db) return false;
    const [u] = await db
      .select({ secret: users.twoFactorSecret, enabled: users.twoFactorEnabled })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!u || !u.enabled || !u.secret) return false;
    return speakeasy.totp.verify({ secret: u.secret, encoding: "base32", token: code, window: 1 });
  } catch {
    return false; // fail-closed — lỗi tra cứu/verify ⇒ coi như KHÔNG hợp lệ
  }
}

/**
 * Middleware step-up 2FA. Export để router áp dần cho các mutation actuation/deploy. Khi cờ OFF
 * hoặc không phải mutation → pass-through. `totpCode` đọc từ raw input (không phá schema) — hỗ trợ
 * cả bao bì superjson (`{ json: { totpCode } }`).
 */
export const requireFreshTotp = t.middleware(async (opts) => {
  const { ctx, next, type } = opts;
  if (!actuationStepUp2faEnabled() || type !== "mutation") return next();
  if (!ctx.user) throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, UNAUTHED_ERR_MSG);

  const sessionKey = ctx.sessionToken || `user:${ctx.user.id}`;
  const now = Date.now();
  const until = stepUpVerifiedUntil.get(sessionKey);
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

  const ok = await verifyFreshTotp(ctx.user.id, totpCode);
  if (!ok) {
    throw appError("FORBIDDEN", "INVALID_VALUE", { field: "twoFactorCode" }, "Mã xác thực 2 bước không hợp lệ.");
  }

  stepUpVerifiedUntil.set(sessionKey, now + STEPUP_TTL_MS);
  // Dọn bộ nhớ (bounded): xoá các mục đã hết hạn khi map phình to.
  if (stepUpVerifiedUntil.size > 5000) {
    for (const [k, v] of stepUpVerifiedUntil) if (v <= now) stepUpVerifiedUntil.delete(k);
  }
  return next();
});

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
 * same role-floor + 2FA as actuation, PLUS doc 40 CTL-07 step-up 2FA (requireFreshTotp,
 * gated by ACTUATION_STEPUP_2FA — default OFF → identical to actuationProcedure). Call-sites
 * that adopt it may accept an optional `totpCode` in their input for the fresh-OTP challenge.
 */
export const deployProcedure = actuationProcedure.use(requireFreshTotp);
