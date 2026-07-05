import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // Doc 31 UX3 — additive forward of an optimistic-lock CONFLICT payload. Only
    // present when a mutation threw TRPCError({ cause: { mpConflict } }); every
    // other error is unaffected. Lets the client show current values + a
    // reload/overwrite choice without a second round-trip.
    const mpConflict = (error.cause as { mpConflict?: unknown } | undefined)?.mpConflict;
    return {
      ...shape,
      data: {
        ...shape.data,
        // Strip stack traces in production to avoid leaking internals
        stack: process.env.NODE_ENV === 'production' ? undefined : shape.data.stack,
        ...(mpConflict ? { conflict: mpConflict } : {}),
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
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

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    if (!ctx.user.twoFactorEnabled) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Tài khoản admin phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.",
      });
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

// Privileged roles that MUST have 2FA enabled (IEC 62443-2-1 CL2 requirement)
const PRIVILEGED_ROLES: UserRole[] = ['admin', 'supervisor', 'quality_inspector'];

const require2FA = t.middleware(async opts => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  if (PRIVILEGED_ROLES.includes(ctx.user.role as UserRole) && !ctx.user.twoFactorEnabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Tài khoản đặc quyền phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.",
    });
  }
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export function roleProcedure(...allowedRoles: UserRole[]) {
  return t.procedure.use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      if (!ctx.user) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
      }

      if (!allowedRoles.includes(ctx.user.role as UserRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Required role: ${allowedRoles.join(' or ')}`,
        });
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
