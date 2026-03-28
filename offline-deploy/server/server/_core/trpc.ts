import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from '@shared/const';
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        // Strip stack traces in production to avoid leaking internals
        stack: process.env.NODE_ENV === 'production' ? undefined : shape.data.stack,
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

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user || ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return next({
      ctx: {
        ...ctx,
        user: ctx.user,
      },
    });
  }),
);

// Role-based procedure factory — accepts an array of allowed roles
type UserRole = 'admin' | 'supervisor' | 'quality_inspector' | 'operator' | 'maintenance' | 'viewer' | 'user';

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
  );
}

// Pre-built role procedures for common use cases
export const supervisorProcedure = roleProcedure('admin', 'supervisor');
export const qualityProcedure = roleProcedure('admin', 'supervisor', 'quality_inspector');
export const operatorProcedure = roleProcedure('admin', 'supervisor', 'operator');
