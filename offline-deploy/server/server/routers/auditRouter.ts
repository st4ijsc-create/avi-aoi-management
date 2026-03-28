import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { auditLogs, users } from "../../drizzle/schema";
import { eq, and, desc, gte, lte, like, sql, or } from "drizzle-orm";

// Admin procedure - only admin users can access
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

export const auditLogRouter = router({
  // List audit logs with pagination and filters
  list: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
      userId: z.number().optional(),
      action: z.string().optional(),
      entityType: z.string().optional(),
      status: z.enum(["success", "failure"]).optional(),
      startDate: z.string().optional(), // ISO date string
      endDate: z.string().optional(), // ISO date string
      search: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { page, limit, userId, action, entityType, status, startDate, endDate, search } = input;
      const offset = (page - 1) * limit;

      // Build conditions
      const conditions = [];
      
      if (userId) {
        conditions.push(eq(auditLogs.userId, userId));
      }
      if (action) {
        conditions.push(eq(auditLogs.action, action));
      }
      if (entityType) {
        conditions.push(eq(auditLogs.entityType, entityType));
      }
      if (status) {
        conditions.push(eq(auditLogs.status, status));
      }
      if (startDate) {
        conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
      }
      if (endDate) {
        conditions.push(lte(auditLogs.createdAt, new Date(endDate)));
      }
      if (search) {
        conditions.push(
          or(
            like(auditLogs.userName, `%${search}%`),
            like(auditLogs.entityName, `%${search}%`),
            like(auditLogs.details, `%${search}%`)
          )
        );
      }

      // Get total count
      const countResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(auditLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      const total = Number(countResult[0]?.count || 0);

      // Get logs
      const logs = await db
        .select()
        .from(auditLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }),

  // Get unique action types for filter
  getActionTypes: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    }

    const result = await db
      .selectDistinct({ action: auditLogs.action })
      .from(auditLogs)
      .orderBy(auditLogs.action);

    return result.map(r => r.action);
  }),

  // Get unique entity types for filter
  getEntityTypes: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    }

    const result = await db
      .selectDistinct({ entityType: auditLogs.entityType })
      .from(auditLogs)
      .where(sql`${auditLogs.entityType} IS NOT NULL`)
      .orderBy(auditLogs.entityType);

    return result.map(r => r.entityType).filter(Boolean);
  }),

  // Get users for filter
  getUsers: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    }

    const result = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .orderBy(users.name);

    return result;
  }),

  // Get audit log statistics
  getStats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    }

    // Total logs
    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs);
    const total = Number(totalResult[0]?.count || 0);

    // Success/Failure counts
    const statusResult = await db
      .select({ 
        status: auditLogs.status, 
        count: sql<number>`count(*)` 
      })
      .from(auditLogs)
      .groupBy(auditLogs.status);

    const successCount = Number(statusResult.find(r => r.status === 'success')?.count || 0);
    const failureCount = Number(statusResult.find(r => r.status === 'failure')?.count || 0);

    // Today's logs
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(gte(auditLogs.createdAt, today));
    const todayCount = Number(todayResult[0]?.count || 0);

    // Top actions
    const topActionsResult = await db
      .select({ 
        action: auditLogs.action, 
        count: sql<number>`count(*)` 
      })
      .from(auditLogs)
      .groupBy(auditLogs.action)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    return {
      total,
      successCount,
      failureCount,
      todayCount,
      topActions: topActionsResult.map(r => ({
        action: r.action,
        count: Number(r.count),
      })),
    };
  }),

  // Export audit logs to CSV
  export: adminProcedure
    .input(z.object({
      userId: z.number().optional(),
      action: z.string().optional(),
      entityType: z.string().optional(),
      status: z.enum(["success", "failure"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      }

      const { userId, action, entityType, status, startDate, endDate } = input;

      // Build conditions
      const conditions = [];
      
      if (userId) conditions.push(eq(auditLogs.userId, userId));
      if (action) conditions.push(eq(auditLogs.action, action));
      if (entityType) conditions.push(eq(auditLogs.entityType, entityType));
      if (status) conditions.push(eq(auditLogs.status, status));
      if (startDate) conditions.push(gte(auditLogs.createdAt, new Date(startDate)));
      if (endDate) conditions.push(lte(auditLogs.createdAt, new Date(endDate)));

      // Get all logs (limit to 10000)
      const logs = await db
        .select()
        .from(auditLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(auditLogs.createdAt))
        .limit(10000);

      // Generate CSV
      const headers = ['ID', 'User', 'Action', 'Entity Type', 'Entity Name', 'Status', 'IP Address', 'Timestamp'];
      const rows = logs.map(log => [
        log.id,
        log.userName || 'System',
        log.action,
        log.entityType || '',
        log.entityName || '',
        log.status,
        log.ipAddress || '',
        log.createdAt.toISOString(),
      ]);

      const csv = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      return { csv, count: logs.length };
    }),
});

export default auditLogRouter;
