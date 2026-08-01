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
  .transform((v) => {
    // Key VẮNG MẶT phải ra undefined (không phải null) — nếu gộp về null thì
    // update sẽ ghi NULL đè validFrom/validTo cũ khi client chỉ gửi userId.
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const d = v instanceof Date ? v : new Date(v);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "Failed to issue badge",
        });
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
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Badge not found" });
      return row;
    }),

  /** Revoke a badge row (validTo defaults to now; history kept for resolution). */
  revoke: protectedProcedure
    .use(requirePermission(MODULE, "canEdit"))
    .input(z.object({ id: z.number().int().positive(), validTo: dateInput }))
    .mutation(async ({ input }) => {
      const row = await revokeBadge(input.id, input.validTo ?? undefined);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Badge not found" });
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
            if (!user) throw new Error(`Không tìm thấy người dùng "${row.username.trim()}"`);
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
