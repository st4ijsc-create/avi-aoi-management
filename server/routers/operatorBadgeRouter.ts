/**
 * Operator/Badge master router (key "operatorBadge") — doc 29 §3 (W8-B, 0192).
 *
 * Admin CRUD over operator_badges (issue / revoke / re-issue / assign user) +
 * the read-side resolution probe. Pure master data: nothing here touches the
 * ingest path (ingest stamps operatorUserId fail-open via operatorBadgeService).
 *
 * RBAC: module "masterdata" (same convention as masterDataRouter — admin always
 * passes; non-admin needs an explicit grant).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { getUserByUsername } from "../db/auth";
import { operatorBadges, users } from "../../drizzle/schema";
import {
  issueBadge,
  revokeBadge,
  updateBadge,
  resolveOperator,
} from "../services/operatorBadgeService";

const MODULE = "masterdata";

const dateInput = z
  .union([z.string(), z.date()])
  .nullish()
  .transform((v, ctx) => {
    // Key VẮNG MẶT phải ra undefined (không phải null) — nếu gộp về null thì
    // update sẽ ghi NULL đè validFrom/validTo cũ khi client chỉ gửi userId.
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    // Task 9 (F2, doc71) — CỐ Ý KHÔNG di trú sang appError() ở đây. Zod
    // `.transform()` chạy bên trong `createInputMiddleware` của tRPC
    // (@trpc/server), nơi MỌI throw (kể cả TRPCError của appError()) đều bị
    // BỌC LẦN NỮA thành một TRPCError code "BAD_REQUEST" mới với `cause` là lỗi gốc
    // (xem node_modules/@trpc/server/dist/initTRPC-*.mjs). `readAppErrorMeta()`
    // (server/_core/appError.ts) chỉ đọc `error.cause` MỘT cấp — với cấu trúc
    // bọc-lồng này, `appCode` thật nằm ở `error.cause.cause.appCode`, hai cấp
    // sâu hơn, nên bị bỏ sót (đọc ra `null`) và người dùng vẫn thấy
    // fallbackMessage thô, không dịch được — migrate ở ĐÚNG vị trí này là vô
    // ích (cổng gõ chữ xanh, bug không đổi). Sửa đúng cách cần tách validate
    // ngày ra khỏi transform (chuyển vào thân handler), một thay đổi lớn hơn
    // phạm vi "một mã, một chuỗi, cơ học" của task này — để nguyên, báo cáo
    // riêng cho người giao việc quyết.
    // ── F2 (2026-08-22) — ĐƯỜNG THỨ BA mà ghi chú bên trên chưa xét ────────────────
    // Ghi chú đó ĐÚNG về mặt kỹ thuật: `appError()` vô ích ở đây, vì tRPC bọc lại mọi
    // throw trong `createInputMiddleware` và đẩy `appCode` xuống `error.cause.cause` —
    // sâu hơn một cấp so với tầm đọc của `readAppErrorMeta()`.
    //
    // Nhưng kết luận rút ra lúc đó ("phải tách validate ra khỏi transform, ngoài phạm
    // vi") bỏ sót một lối thoát ngắn hơn nhiều: `ctx.addIssue()` là cách của CHÍNH ZOD
    // để báo lỗi từ trong transform. Nó không ném gì cả — nó ghi một zod issue thật vào
    // kết quả parse, nên đi thẳng ra đường `parseZodIssues → formatZodIssue` của
    // `mapTrpcError`. Và từ bản vá F1 (2026-08-21), `ZOD_MESSAGE_KEY` dịch được ĐÚNG
    // chuỗi "Invalid date" sang vi/en/zh.
    //
    // ⇒ Bài học: một ghi chú "đã cân nhắc, không làm được" chỉ đóng những cửa nó ĐÃ THỬ.
    //   Đọc kỹ để khỏi lặp lại việc cũ, nhưng đừng coi nó là danh sách đầy đủ.
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid date" });
      return z.NEVER;
    }
    return d;
  });

export const operatorBadgeRouter = router({
  /**
   * List badges (joined with the mapped user's name). Filters:
   *   unassignedOnly — the doc-29 "badge chưa gán người" queue (userId NULL);
   *   activeOnly     — current holders only;
   *   search         — badgeCode/displayName substring.
   */
  list: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({
      unassignedOnly: z.boolean().optional(),
      activeOnly: z.boolean().optional(),
      search: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(500).default(200),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { badges: [], total: 0 };
      const conditions = [];
      if (input?.unassignedOnly) conditions.push(isNull(operatorBadges.userId));
      if (input?.activeOnly) conditions.push(eq(operatorBadges.isActive, true));
      if (input?.search?.trim()) {
        const term = `%${input.search.trim()}%`;
        conditions.push(
          sql`(${operatorBadges.badgeCode} ILIKE ${term} OR ${operatorBadges.displayName} ILIKE ${term})`,
        );
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const badges = await db
        .select({
          id: operatorBadges.id,
          badgeCode: operatorBadges.badgeCode,
          userId: operatorBadges.userId,
          userName: users.name,
          displayName: operatorBadges.displayName,
          source: operatorBadges.source,
          validFrom: operatorBadges.validFrom,
          validTo: operatorBadges.validTo,
          issuedBy: operatorBadges.issuedBy,
          isActive: operatorBadges.isActive,
          notes: operatorBadges.notes,
          createdAt: operatorBadges.createdAt,
        })
        .from(operatorBadges)
        .leftJoin(users, eq(operatorBadges.userId, users.id))
        .where(where)
        .orderBy(desc(operatorBadges.isActive), desc(operatorBadges.createdAt))
        .limit(input?.limit ?? 200)
        .offset(input?.offset ?? 0);
      const [count] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(operatorBadges)
        .where(where);
      return { badges, total: Number(count?.count) || 0 };
    }),

  /** Count of unassigned (userId NULL) active badges — the admin queue size. */
  unassignedCount: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return { count: 0 };
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(operatorBadges)
        .where(and(isNull(operatorBadges.userId), eq(operatorBadges.isActive, true)));
      return { count: Number(row?.count) || 0 };
    }),

  /** Resolution probe: which user does badgeCode resolve to at time `at`? */
  resolve: protectedProcedure
    .use(requirePermission(MODULE, "canView"))
    .input(z.object({ badgeCode: z.string().trim().min(1).max(50), at: dateInput }))
    .query(async ({ input }) => {
      const resolved = await resolveOperator(input.badgeCode, input.at ?? new Date());
      return { resolved };
    }),

  /** Issue (or RE-issue — an existing active row is closed at the cutover). */
  issue: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      badgeCode: z.string().trim().min(1).max(50),
      userId: z.number().int().positive().nullish(),
      displayName: z.string().max(255).nullish(),
      validFrom: dateInput,
      validTo: dateInput,
      notes: z.string().max(2000).nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const id = await issueBadge({
          badgeCode: input.badgeCode,
          userId: input.userId ?? null,
          displayName: input.displayName ?? null,
          validFrom: input.validFrom,
          validTo: input.validTo,
          notes: input.notes ?? null,
          issuedBy: ctx.user?.id ?? null,
          source: "manual",
        });
        return { id };
      } catch (err) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "issueOperatorBadge" }, err instanceof Error ? err.message : "Failed to issue badge");
      }
    }),

  /** Assign a user / edit display name / window / notes on an existing row. */
  update: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({
      id: z.number().int().positive(),
      userId: z.number().int().positive().nullish().optional(),
      displayName: z.string().max(255).nullish().optional(),
      validFrom: dateInput.optional(),
      validTo: dateInput.optional(),
      notes: z.string().max(2000).nullish().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...patch } = input;
      const row = await updateBadge(id, {
        ...(patch.userId !== undefined ? { userId: patch.userId ?? null } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName ?? null } : {}),
        ...(patch.validFrom !== undefined ? { validFrom: patch.validFrom } : {}),
        ...(patch.validTo !== undefined ? { validTo: patch.validTo } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes ?? null } : {}),
      });
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "badge" }, "Badge not found");
      return row;
    }),

  /** Revoke a badge row (validTo defaults to now; history kept for resolution). */
  revoke: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({ id: z.number().int().positive(), validTo: dateInput }))
    .mutation(async ({ input }) => {
      const row = await revokeBadge(input.id, input.validTo ?? undefined);
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "badge" }, "Badge not found");
      return row;
    }),

  /**
   * Doc 54 §11 P0.5 — bulk-import operator badges from an HR CSV/array.
   * Gated on the SAME permission as single-row create (masterdata.canCreate) —
   * NOT adminProcedure (mirrors doc-54 P0.3). Idempotent: a row whose badgeCode
   * already has an ACTIVE holder is UPDATED in place (re-map / re-window); a new
   * badgeCode is ISSUED (source='hr_sync'). userId resolves from `userId` or, if
   * absent, `username` (unknown username → that row fails, not the batch).
   * Returns {inserted, updated, failed, errors[]} like dataRouters.import*.
   */
  importBadges: protectedProcedure
    .use(requirePermission(MODULE, "canCreate"))
    .input(z.object({
      rows: z.array(z.object({
        badgeCode: z.string().trim().min(1).max(50),
        userId: z.number().int().positive().nullish(),
        username: z.string().trim().max(100).nullish(),
        displayName: z.string().max(255).nullish(),
        validFrom: dateInput,
        validTo: dateInput,
        notes: z.string().max(2000).nullish(),
      })).min(1).max(5000),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = { inserted: 0, updated: 0, failed: 0, errors: [] as string[] };
      const db = await getDb();
      if (!db) {
        return { inserted: 0, updated: 0, failed: input.rows.length, errors: ["Database not available"] };
      }
      for (const row of input.rows) {
        const code = row.badgeCode.trim();
        try {
          const userProvided = row.userId != null || (row.username != null && row.username.trim() !== "");
          let userId: number | null = row.userId ?? null;
          if (userId == null && row.username && row.username.trim()) {
            const user = await getUserByUsername(row.username.trim());
            if (!user) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "user" }, `Không tìm thấy người dùng "${row.username.trim()}"`);
            userId = user.id;
          }
          const [existing] = await db
            .select()
            .from(operatorBadges)
            .where(and(eq(operatorBadges.badgeCode, code), eq(operatorBadges.isActive, true)))
            .limit(1);
          if (existing) {
            await updateBadge(existing.id, {
              ...(userProvided ? { userId } : {}),
              ...(row.displayName != null ? { displayName: row.displayName } : {}),
              validFrom: row.validFrom,
              validTo: row.validTo,
              ...(row.notes != null ? { notes: row.notes } : {}),
            });
            result.updated++;
          } else {
            await issueBadge({
              badgeCode: code,
              userId,
              displayName: row.displayName ?? null,
              source: "hr_sync",
              validFrom: row.validFrom,
              validTo: row.validTo,
              notes: row.notes ?? null,
              issuedBy: ctx.user?.id ?? null,
            });
            result.inserted++;
          }
        } catch (err) {
          result.failed++;
          result.errors.push(`${code}: ${err instanceof Error ? err.message : "lỗi import"}`);
        }
      }
      return result;
    }),
});

export type OperatorBadgeRouter = typeof operatorBadgeRouter;
