import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { createHmac, createHash } from "crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db";
import { productionSessions, dailyStatistics } from "../../drizzle/schema/production";

const SIGNOFF_ALGORITHM = "HMAC-SHA256";

// doc 40 QA-1b (owner-scope): operator chỉ được thao tác phiên của CHÍNH MÌNH; role
// điều phối (admin/supervisor/quality_inspector) thao tác mọi phiên của line.
const SESSION_SUPERVISOR_ROLES = new Set(["admin", "supervisor", "quality_inspector"]);
function assertSessionActor(session: { operatorId: number | null }, user: { id: number; role?: string } | undefined | null) {
  if (!user) throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "Chưa đăng nhập");
  if (SESSION_SUPERVISOR_ROLES.has(String(user.role))) return;
  if (session.operatorId != null && session.operatorId === user.id) return;
  throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "manageOwnProductionSession" }, "Bạn chỉ được thao tác phiên sản xuất của chính mình");
}

function buildSignoffPayload(input: {
  sessionId: number;
  operatorId: number;
  closedAt: Date;
  kpiSnapshot: unknown;
}) {
  return `${input.sessionId}:${input.operatorId}:${input.closedAt.toISOString()}:${JSON.stringify(input.kpiSnapshot ?? {})}`;
}

function signPayload(payload: string) {
  const secret = process.env.SIGNOFF_SECRET;
  if (!secret || secret.length < 16) {
    // Lỗi cấu hình khởi động (biến môi trường thiếu) — người dùng không tự gây ra được,
    // nhưng vẫn phải là appError() (không TRPCError trần) theo nguyên tắc #3 của Task 8.
    throw appError(
      "INTERNAL_SERVER_ERROR",
      "OPERATION_FAILED",
      { operation: "signProductionSession" },
      "SIGNOFF_SECRET chưa được cấu hình (tối thiểu 16 ký tự) để ký bản ghi 21 CFR Part 11",
    );
  }
  const hash = createHash("sha256").update(payload).digest("hex");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return { hash, signature, algorithm: SIGNOFF_ALGORITHM };
}

async function computeKpiSnapshot(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  session: { id: number; factoryId: number; workshopId: number; lineId: number | null; actualStart: Date; actualEnd: Date | null },
) {
  const start = session.actualStart;
  const end = session.actualEnd ?? new Date();
  const rows = await db
    .select({
      totalCount: sql<number>`COALESCE(SUM(${dailyStatistics.totalCount}), 0)`,
      okCount: sql<number>`COALESCE(SUM(${dailyStatistics.okCount}), 0)`,
      ngCount: sql<number>`COALESCE(SUM(${dailyStatistics.ngCount}), 0)`,
      avgCycle: sql<number>`AVG(${dailyStatistics.avgCycleTime})`,
    })
    .from(dailyStatistics)
    .where(
      and(
        eq(dailyStatistics.factoryId, session.factoryId),
        eq(dailyStatistics.workshopId, session.workshopId),
        gte(dailyStatistics.date, start),
        lte(dailyStatistics.date, end),
      ),
    );
  const row = rows[0] ?? { totalCount: 0, okCount: 0, ngCount: 0, avgCycle: null };
  const total = Number(row.totalCount) || 0;
  const ok = Number(row.okCount) || 0;
  const ng = Number(row.ngCount) || 0;
  const yieldRate = total > 0 ? (ok / total) * 100 : 0;
  const avgCycleMs = row.avgCycle != null ? Number(row.avgCycle) * 1000 : null;
  return {
    totalCount: total,
    okCount: ok,
    ngCount: ng,
    yieldRate: Number(yieldRate.toFixed(2)),
    oeePercent: null as number | null,
    avgCycleTimeMs: avgCycleMs,
  };
}

export const productionSessionRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        factoryId: z.number().optional(),
        workshopId: z.number().optional(),
        lineId: z.number().optional(),
        status: z.enum(["open", "paused", "closed", "signed_off"]).optional(),
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
        limit: z.number().min(1).max(500).default(100),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const filters = [] as any[];
      if (input?.factoryId) filters.push(eq(productionSessions.factoryId, input.factoryId));
      if (input?.workshopId) filters.push(eq(productionSessions.workshopId, input.workshopId));
      if (input?.lineId) filters.push(eq(productionSessions.lineId, input.lineId));
      if (input?.status) filters.push(eq(productionSessions.status, input.status as any));
      if (input?.fromDate) filters.push(gte(productionSessions.shiftDate, new Date(input.fromDate)));
      if (input?.toDate) filters.push(lte(productionSessions.shiftDate, new Date(input.toDate)));
      const where = filters.length > 0 ? and(...filters) : undefined;
      const rows = await db
        .select()
        .from(productionSessions)
        .where(where as any)
        .orderBy(desc(productionSessions.shiftDate), desc(productionSessions.id))
        .limit(input?.limit ?? 100);
      return rows;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [row] = await db.select().from(productionSessions).where(eq(productionSessions.id, input.id));
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionSession" }, "Không tìm thấy phiên sản xuất");
      return row;
    }),

  open: protectedProcedure
    .use(requirePermission("production_session", "canCreate"))
    .input(z.object({
      shiftConfigId: z.number(),
      factoryId: z.number(),
      workshopId: z.number(),
      lineId: z.number().optional(),
      productionOrderId: z.number().optional(),
      operatorId: z.number(),
      supervisorId: z.number().optional(),
      shiftDate: z.string().datetime(),
      plannedStart: z.string().datetime(),
      plannedEnd: z.string().datetime(),
      operatorNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      const sessionCode = `PS-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const [created] = await db.insert(productionSessions).values({
        sessionCode,
        shiftConfigId: input.shiftConfigId,
        factoryId: input.factoryId,
        workshopId: input.workshopId,
        lineId: input.lineId,
        productionOrderId: input.productionOrderId,
        operatorId: input.operatorId,
        supervisorId: input.supervisorId,
        status: "open",
        shiftDate: new Date(input.shiftDate),
        plannedStart: new Date(input.plannedStart),
        plannedEnd: new Date(input.plannedEnd),
        actualStart: new Date(),
        operatorNotes: input.operatorNotes,
      }).returning();

      return { success: true, session: created };
    }),

  pause: protectedProcedure
    .use(requirePermission("production_session", "canEdit"))
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [existing] = await db.select().from(productionSessions).where(eq(productionSessions.id, input.id));
      if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionSession" }, "Không tìm thấy phiên sản xuất");
      assertSessionActor(existing, ctx.user);
      const [updated] = await db
        .update(productionSessions)
        .set({ status: "paused" as any, updatedAt: new Date() })
        .where(eq(productionSessions.id, input.id))
        .returning();
      return { success: true, session: updated };
    }),

  resume: protectedProcedure
    .use(requirePermission("production_session", "canEdit"))
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [existing] = await db.select().from(productionSessions).where(eq(productionSessions.id, input.id));
      if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionSession" }, "Không tìm thấy phiên sản xuất");
      assertSessionActor(existing, ctx.user);
      const [updated] = await db
        .update(productionSessions)
        .set({ status: "open" as any, updatedAt: new Date() })
        .where(eq(productionSessions.id, input.id))
        .returning();
      return { success: true, session: updated };
    }),

  close: protectedProcedure
    .use(requirePermission("production_session", "canEdit"))
    .input(z.object({ id: z.number(), operatorNotes: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [session] = await db.select().from(productionSessions).where(eq(productionSessions.id, input.id));
      if (!session) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionSession" }, "Không tìm thấy phiên sản xuất");
      assertSessionActor(session, ctx.user);
      if (session.status === "closed" || (session.status as any) === "signed_off") {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "closeProductionSession" }, "Phiên đã đóng hoặc đã ký");
      }
      const closedAt = new Date();
      const kpi = await computeKpiSnapshot(db, {
        id: session.id,
        factoryId: session.factoryId,
        workshopId: session.workshopId,
        lineId: session.lineId,
        actualStart: session.actualStart,
        actualEnd: closedAt,
      });
      const [updated] = await db
        .update(productionSessions)
        .set({
          status: "closed" as any,
          actualEnd: closedAt,
          kpiSnapshot: kpi,
          operatorNotes: input.operatorNotes ?? session.operatorNotes,
          updatedAt: new Date(),
        })
        .where(eq(productionSessions.id, input.id))
        .returning();
      return { success: true, session: updated, kpiSnapshot: kpi };
    }),

  handover: protectedProcedure
    .use(requirePermission("production_session", "canEdit"))
    .input(z.object({
      fromSessionId: z.number(),
      toSessionId: z.number(),
      handoverNotes: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [updated] = await db
        .update(productionSessions)
        .set({
          handoverToSessionId: input.toSessionId,
          handoverNotes: input.handoverNotes,
          updatedAt: new Date(),
        })
        .where(eq(productionSessions.id, input.fromSessionId))
        .returning();
      if (!updated) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionSession" }, "Không tìm thấy phiên nguồn");
      return { success: true, session: updated };
    }),

  supervisorSignOff: protectedProcedure
    .input(z.object({ id: z.number(), supervisorPasswordConfirmed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");

      if (ctx.user?.role !== "admin" && ctx.user?.role !== "supervisor") {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "signOffProductionSession" }, "Chỉ supervisor hoặc admin được ký duyệt phiên");
      }
      if (!input.supervisorPasswordConfirmed) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "supervisorPasswordConfirmed" }, "Cần xác nhận lại mật khẩu trước khi ký (21 CFR Part 11 §11.200)");
      }

      const [session] = await db.select().from(productionSessions).where(eq(productionSessions.id, input.id));
      if (!session) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionSession" }, "Không tìm thấy phiên sản xuất");
      if (session.status !== "closed") {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "signOffProductionSession" }, "Phiên phải ở trạng thái 'closed' trước khi ký duyệt");
      }
      if (session.supervisorSignoff) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "signOffProductionSession" }, "Phiên đã được ký duyệt trước đó");
      }

      const signedAt = new Date();
      const payload = buildSignoffPayload({
        sessionId: session.id,
        operatorId: session.operatorId,
        closedAt: session.actualEnd ?? signedAt,
        kpiSnapshot: session.kpiSnapshot,
      });
      const { hash, signature, algorithm } = signPayload(payload);

      const [signed] = await db
        .update(productionSessions)
        .set({
          status: "signed_off" as any,
          supervisorId: ctx.user.id,
          supervisorSignoff: true,
          supervisorSignoffAt: signedAt,
          signoffPayload: payload,
          signoffPayloadHash: hash,
          signoffSignature: signature,
          signoffAlgorithm: algorithm,
          updatedAt: new Date(),
        })
        .where(eq(productionSessions.id, input.id))
        .returning();

      return {
        success: true,
        session: signed,
        signoff: { algorithm, hash, signaturePreview: signature.slice(0, 16) + "…" },
      };
    }),

  verifySignoff: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
      const [session] = await db.select().from(productionSessions).where(eq(productionSessions.id, input.id));
      if (!session) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "productionSession" }, "Không tìm thấy phiên sản xuất");
      if (!session.supervisorSignoff || !session.signoffPayload || !session.signoffSignature) {
        return { signed: false as const, valid: false as const, reason: "Phiên chưa được ký duyệt" };
      }
      const { hash, signature } = signPayload(session.signoffPayload);
      const valid = hash === session.signoffPayloadHash && signature === session.signoffSignature;
      return {
        signed: true as const,
        valid,
        algorithm: session.signoffAlgorithm,
        signedAt: session.supervisorSignoffAt,
        supervisorId: session.supervisorId,
        reason: valid ? "Chữ ký HMAC khớp — bản ghi không bị thay đổi" : "Chữ ký HMAC không khớp — bản ghi đã bị sửa đổi",
      };
    }),
});
