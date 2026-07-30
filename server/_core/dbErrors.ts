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
import { appError } from "./appError";

const UNIQUE_VIOLATION = "23505";
const UNDEFINED_TABLE = "42P01";
const UNDEFINED_COLUMN = "42703";

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

/**
 * Walks err → err.cause → ... looking for a Postgres undefined-table error (42P01,
 * "relation ... does not exist"). Registry/store services across the codebase (e.g.
 * server/services/kbStudioService.ts, server/services/kbVectorStore.ts) use this to degrade
 * gracefully (empty result / `tableAvailable:false`) when a migration hasn't been applied
 * yet, instead of leaking a raw "Failed query: ..." error to the client.
 *
 * Mirrors {@link isUniqueViolation}'s cause-chain walk: postgres.js surfaces the raw driver
 * error with `code === '42P01'` directly, but drizzle-orm ≥0.44 wraps it in a
 * `DrizzleQueryError` (message starting with "Failed query: ...") that carries the real
 * driver error — code and all — on `.cause`. Checking only `(err as {code}).code` misses the
 * wrapped case entirely (the top-level `code` is `undefined`), which is exactly the bug this
 * walk fixes.
 */
export function isMissingTable(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object") {
      const e = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (e.code === UNDEFINED_TABLE) return true;
      if (typeof e.message === "string" && /relation .* does not exist/i.test(e.message)) {
        return true;
      }
      current = e.cause;
    } else {
      break;
    }
  }
  return false;
}

/**
 * Walks err → err.cause → ... looking for a Postgres undefined-column error (42703,
 * "column ... does not exist"). Mirrors {@link isMissingTable}'s cause-chain walk: a raw
 * postgres.js error surfaces `code === '42703'` directly, but drizzle-orm ≥0.44 wraps it in
 * a `DrizzleQueryError` (message starting with "Failed query: ...") that carries the real
 * driver error — code and all — on `.cause`. A naive `(err as {code}).code === '42703'`
 * check misses the wrapped case entirely, exactly like the `isMissingTable` bug this mirrors.
 */
export function isMissingColumn(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object") {
      const e = current as { code?: unknown; message?: unknown; cause?: unknown };
      if (e.code === UNDEFINED_COLUMN) return true;
      if (typeof e.message === "string" && /column .* does not exist/i.test(e.message)) {
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
    // Task 8 (Sprint 5 §4.5 đợt 4) — appError() thay throw TRPCError trần. Đây là
    // 1 trong ~24 call-site withDbErrors()/rethrowDbError() mà reviewer Task 7 chỉ
    // ra là NẰM NGOÀI đường quét appErrorCoverage.test.ts (chỉ quét server/routers),
    // nên cổng có thể về 0 mà những chỗ này vẫn phát lỗi không dịch được — lỗ hổng
    // đã vá bằng khẳng định riêng ở appErrorCoverage.test.ts (mục "dbErrors.ts").
    //
    // entity: "record" là khoá CHUNG có chủ đích — helper này được gọi từ ~24 nơi
    // (componentLibraryRouter/hierarchyRouters/kbStudioRouter/masterDataRouter/
    // processRouter/productRouters/systemRouters) với đủ loại thực thể khác nhau,
    // không có tên thực thể cụ thể ở tầng này để tham số hoá riêng cho từng cái
    // (khác appError() ở router — nơi luôn biết chính xác entity). Nếu để params
    // rỗng, template ENTITY_DUPLICATE "{{entity}} này đã tồn tại." sẽ hiện
    // "{{entity}}" trần cho người dùng (chưa nội suy được) — một lỗi hiển thị mới,
    // đúng thứ sprint này tồn tại để dẹp. Chi tiết CỤ THỂ (ví dụ "Mã kỹ năng đã tồn
    // tại") vẫn còn ở fallbackMessage (mỗi call-site tự truyền qua conflictMessage).
    throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "record" }, opts?.conflictMessage ?? "Mã đã tồn tại");
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
