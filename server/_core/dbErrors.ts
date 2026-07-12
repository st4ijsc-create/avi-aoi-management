/**
 * Doc 42 Đợt 0.4 — shared unique-violation handler.
 *
 * Postgres unique violations (SQLSTATE 23505) surface to routers in two shapes:
 *  - postgres.js error with `code === '23505'` (raw driver error), or
 *  - drizzle-orm ≥0.44 `DrizzleQueryError` whose message starts with
 *    "Failed query: INSERT ..." and carries the driver error in `cause`.
 * Letting either bubble to tRPC leaks the raw SQL statement to the client toast
 * (information disclosure — 9 màn hình in the audit). Routers should translate
 * them into a CONFLICT with a human message instead.
 *
 * Usage (either style):
 *   return withDbErrors(() => db.insert(...), { conflictMessage: "Mã kỹ năng đã tồn tại" });
 *   // or
 *   try { ... } catch (err) { rethrowDbError(err, { conflictMessage: "..." }); }
 */
import { TRPCError } from "@trpc/server";

const UNIQUE_VIOLATION = "23505";

export interface DbErrorOptions {
  /** Message for the CONFLICT error shown to the user. Default: "Mã đã tồn tại". */
  conflictMessage?: string;
}

/** Walks err → err.cause → ... looking for a Postgres unique-violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object") {
      const e = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (e.code === UNIQUE_VIOLATION) return true;
      if (
        typeof e.message === "string" &&
        (e.message.includes("duplicate key value violates unique constraint") ||
          e.message.includes(UNIQUE_VIOLATION))
      ) {
        return true;
      }
      current = e.cause;
    } else {
      break;
    }
  }
  return false;
}

/** Constraint name of the violated unique index, when the driver exposes it. */
export function getViolatedConstraint(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object") {
      const e = current as { constraint_name?: unknown; constraint?: unknown; cause?: unknown };
      if (typeof e.constraint_name === "string") return e.constraint_name;
      if (typeof e.constraint === "string") return e.constraint;
      current = e.cause;
    } else {
      break;
    }
  }
  return undefined;
}

/**
 * Re-throws a DB error as a friendly TRPCError. Unique violations become
 * CONFLICT ("Mã đã tồn tại" by default); TRPCErrors pass through untouched;
 * everything else is re-thrown as-is (the client-side mapper hides raw SQL).
 */
export function rethrowDbError(err: unknown, opts?: DbErrorOptions): never {
  if (err instanceof TRPCError) throw err;
  if (isUniqueViolation(err)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: opts?.conflictMessage ?? "Mã đã tồn tại",
      cause: err instanceof Error ? err : undefined,
    });
  }
  throw err;
}

/** Runs `fn`, translating unique violations into CONFLICT. */
export async function withDbErrors<T>(fn: () => Promise<T>, opts?: DbErrorOptions): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    rethrowDbError(err, opts);
  }
}
