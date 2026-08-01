/**
 * Enhanced Audit Trail Router
 * 
 * Extends the inline audit router with:
 * - Timeline view with full detail
 * - Entity history tracking
 * - Change diff viewer
 * - Advanced filtering & search
 * - Export audit logs
 * - Entity-level activity feed
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { requirePermission } from "../_core/accessControl";
import * as db from "../db";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
import { AUDIT_ACTIONS, ENTITY_TYPES } from "../services/auditTrailService";

export const enhancedAuditRouter = router({
  /**
   * Advanced list with full filtering, search, and pagination
   */
  list: adminProcedure
    .input(z.object({
      userId: z.number().optional(),
      action: z.string().optional(),
      actions: z.array(z.string()).optional(),
      entityType: z.string().optional(),
      entityId: z.number().optional(),
      status: z.enum(["success", "failure"]).optional(),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      search: z.string().optional(), // Search in entityName, details
      source: z.enum(["web", "api", "mqtt", "system", "scheduler"]).optional(),
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
      sortBy: z.enum(["createdAt", "action", "entityType"]).default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    }))
    .query(async ({ input }) => {
      const conn = await getDb();
      if (!conn) return { items: [], total: 0 };

      // Build parameterized conditions using Drizzle sql template tags
      const conditions: ReturnType<typeof sql>[] = [sql`1=1`];

      if (input.userId) conditions.push(sql`al."userId" = ${input.userId}`);
      if (input.action) conditions.push(sql`al."action" = ${input.action}`);
      if (input.actions?.length) {
        conditions.push(sql`al."action" IN ${sql`(${sql.join(input.actions.map(a => sql`${a}`), sql`, `)})`}`);
      }
      if (input.entityType) conditions.push(sql`al."entityType" = ${input.entityType}`);
      if (input.entityId) conditions.push(sql`al."entityId" = ${input.entityId}`);
      if (input.status) conditions.push(sql`al."status" = ${input.status}`);
      if (input.source) conditions.push(sql`al."details"->>'source' = ${input.source}`);
      if (input.startDate) conditions.push(sql`al."createdAt" >= ${input.startDate}`);
      if (input.endDate) conditions.push(sql`al."createdAt" <= ${input.endDate}`);

      const whereClause = sql.join(conditions, sql` AND `);

      // Whitelist sort column and direction to prevent injection
      const sortColumn = ({ createdAt: '"createdAt"', action: '"action"', entityType: '"entityType"' } as const)[input.sortBy];
      const sortDir = input.sortOrder === 'asc' ? sql`ASC` : sql`DESC`;

      const query = sql`
        SELECT al.*, u."name" as "displayUserName"
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        WHERE ${whereClause}
        ORDER BY al.${sql.raw(sortColumn)} ${sortDir}
        LIMIT ${input.limit} OFFSET ${input.offset}
      `;

      const result: any = await conn.execute(query);
      const rows = result.rows || result;

      // Count total with same parameterized conditions
      const countQuery = sql`
        SELECT COUNT(*)::int as total
        FROM audit_logs al
        WHERE ${whereClause}
      `;
      const countResult: any = await conn.execute(countQuery);
      const countRows = countResult.rows || countResult;

      return {
        items: rows,
        total: countRows[0]?.total || 0,
      };
    }),

  /**
   * Get entity history - all changes for a specific entity
   */
  entityHistory: adminProcedure
    .input(z.object({
      entityType: z.string(),
      entityId: z.number(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ input }) => {
      const conn = await getDb();
      if (!conn) return { history: [], entity: null };

      const result: any = await conn.execute(sql`
        SELECT al.*, u."name" as "displayUserName"
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        WHERE al."entityType" = ${input.entityType}
          AND al."entityId" = ${input.entityId}
        ORDER BY al."createdAt" DESC
        LIMIT ${input.limit}
      `);
      const rows = result.rows || result;

      // Build timeline: show entity creation → all updates → current state
      const timeline = rows.map((row: any) => {
        const details = row.details || {};
        return {
          id: row.id,
          action: row.action,
          userName: row.displayUserName || row.userName || `User #${row.userId}`,
          timestamp: row.createdAt,
          changes: details.changes || [],
          affectedFields: details.affectedFields || [],
          status: row.status,
          source: details.source || "web",
          duration: details.duration,
          batchId: details.batchId,
        };
      });

      return {
        history: timeline,
        entity: {
          type: input.entityType,
          id: input.entityId,
          name: rows[0]?.entityName || null,
          firstSeen: rows.length > 0 ? rows[rows.length - 1]?.createdAt : null,
          lastModified: rows.length > 0 ? rows[0]?.createdAt : null,
          totalChanges: rows.length,
        },
      };
    }),

  /**
   * Get change diff detail for a specific audit log entry
   */
  getChangeDiff: adminProcedure
    .input(z.number())
    .query(async ({ input: id }) => {
      const conn = await getDb();
      if (!conn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result: any = await conn.execute(sql`
        SELECT al.*, u."name" as "displayUserName"
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        WHERE al.id = ${id}
      `);
      const rows = result.rows || result;
      if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });

      const entry = rows[0];
      const details = entry.details || {};

      return {
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        entityName: entry.entityName,
        userName: entry.displayUserName || entry.userName,
        timestamp: entry.createdAt,
        status: entry.status,
        before: details.before || null,
        after: details.after || null,
        changes: details.changes || [],
        metadata: details.metadata || null,
        error: details.errorMessage || null,
        duration: details.duration || null,
        source: details.source || "web",
        requestId: details.requestId,
        batchId: details.batchId,
        batchSize: details.batchSize,
      };
    }),

  /**
   * Enhanced statistics with breakdowns
   */
  stats: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(365).default(30),
      groupBy: z.enum(["day", "week", "entity", "action", "user"]).default("day"),
    }))
    .query(async ({ input }) => {
      const conn = await getDb();
      if (!conn) return { stats: [], summary: {} };

      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);

      // Summary counts
      const summaryResult: any = await conn.execute(sql`
        SELECT 
          COUNT(*)::int as "totalActions",
          COUNT(DISTINCT "userId")::int as "uniqueUsers",
          COUNT(*) FILTER (WHERE status = 'failure')::int as "failedActions",
          COUNT(*) FILTER (WHERE action = 'create')::int as "creates",
          COUNT(*) FILTER (WHERE action = 'update')::int as "updates",
          COUNT(*) FILTER (WHERE action = 'delete')::int as "deletes",
          COUNT(*) FILTER (WHERE action LIKE 'login%')::int as "logins"
        FROM audit_logs
        WHERE "createdAt" >= ${since.toISOString()}
      `);
      const summaryRows = summaryResult.rows || summaryResult;
      const summary = summaryRows[0] || {};

      // Grouped data
      let groupQuery;
      switch (input.groupBy) {
        case "day":
          groupQuery = sql`
            SELECT 
              DATE_TRUNC('day', "createdAt")::date as label,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE status = 'failure')::int as "failureCount"
            FROM audit_logs
            WHERE "createdAt" >= ${since.toISOString()}
            GROUP BY DATE_TRUNC('day', "createdAt")
            ORDER BY label DESC
          `;
          break;
        case "week":
          groupQuery = sql`
            SELECT 
              DATE_TRUNC('week', "createdAt")::date as label,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE status = 'failure')::int as "failureCount"
            FROM audit_logs
            WHERE "createdAt" >= ${since.toISOString()}
            GROUP BY DATE_TRUNC('week', "createdAt")
            ORDER BY label DESC
          `;
          break;
        case "entity":
          groupQuery = sql`
            SELECT 
              "entityType" as label,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE status = 'failure')::int as "failureCount"
            FROM audit_logs
            WHERE "createdAt" >= ${since.toISOString()}
            GROUP BY "entityType"
            ORDER BY count DESC
            LIMIT 20
          `;
          break;
        case "action":
          groupQuery = sql`
            SELECT 
              "action" as label,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE status = 'failure')::int as "failureCount"
            FROM audit_logs
            WHERE "createdAt" >= ${since.toISOString()}
            GROUP BY "action"
            ORDER BY count DESC
            LIMIT 20
          `;
          break;
        case "user":
          groupQuery = sql`
            SELECT 
              COALESCE(u."name", 'System') as label,
              COUNT(*)::int as count,
              COUNT(*) FILTER (WHERE al.status = 'failure')::int as "failureCount"
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al."userId"
            WHERE al."createdAt" >= ${since.toISOString()}
            GROUP BY COALESCE(u."name", 'System')
            ORDER BY count DESC
            LIMIT 20
          `;
          break;
      }

      const groupResult: any = await conn.execute(groupQuery);
      const groupRows = groupResult.rows || groupResult;

      return { stats: groupRows, summary };
    }),

  /**
   * Get recent activity feed (timeline view)
   */
  activityFeed: protectedProcedure
    .input(z.object({
      limit: z.number().min(5).max(50).default(20),
      entityTypes: z.array(z.string()).optional(),
      excludeActions: z.array(z.string()).optional(),
    }).optional())
    .query(async ({ input }) => {
      const conn = await getDb();
      if (!conn) return [];

      const limit = input?.limit || 20;

      const result: any = await conn.execute(sql`
        SELECT 
          al.id,
          al.action,
          al."entityType",
          al."entityId",
          al."entityName",
          al.status,
          al."createdAt",
          u."name" as "userName",
          al.details->>'source' as source
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        ORDER BY al."createdAt" DESC
        LIMIT ${limit}
      `);
      const rows = result.rows || result;

      return rows.map((row: any) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        entityName: row.entityName,
        userName: row.userName || "System",
        status: row.status,
        timestamp: row.createdAt,
        source: row.source || "web",
        // Generate human-readable message
        message: generateActivityMessage(row),
      }));
    }),

  /**
   * Get available filter options
   */
  getFilterOptions: adminProcedure.query(async () => {
    const conn = await getDb();
    if (!conn) return { actions: [], entityTypes: [], users: [] };

    const [actionsResult, entitiesResult, usersResult] = await Promise.all([
      conn.execute(sql`
        SELECT DISTINCT action FROM audit_logs ORDER BY action
      `),
      conn.execute(sql`
        SELECT DISTINCT "entityType" FROM audit_logs ORDER BY "entityType"
      `),
      conn.execute(sql`
        SELECT DISTINCT al."userId", u."name"
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        WHERE al."userId" IS NOT NULL
        ORDER BY u."name"
      `),
    ]);

    const actionsRows = (actionsResult as any).rows || actionsResult;
    const entitiesRows = (entitiesResult as any).rows || entitiesResult;
    const usersRows = (usersResult as any).rows || usersResult;

    return {
      actions: actionsRows.map((r: any) => r.action),
      entityTypes: entitiesRows.map((r: any) => r.entityType),
      users: usersRows.map((r: any) => ({ id: r.userId, name: r.name })),
      // Also return constants for reference
      predefinedActions: AUDIT_ACTIONS,
      predefinedEntityTypes: ENTITY_TYPES,
    };
  }),

  /**
   * Export audit logs as CSV
   */
  exportCsv: adminProcedure
    .input(z.object({
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      entityType: z.string().optional(),
      action: z.string().optional(),
      userId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const conn = await getDb();
      if (!conn) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const result: any = await conn.execute(sql`
        SELECT 
          al.id,
          al.action,
          al."entityType",
          al."entityId",
          al."entityName",
          al.status,
          al."createdAt",
          al."ipAddress",
          u."name" as "userName",
          al.details
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        WHERE al."createdAt" >= ${input.startDate}
          AND al."createdAt" <= ${input.endDate}
          ${input.entityType ? sql`AND al."entityType" = ${input.entityType}` : sql``}
          ${input.action ? sql`AND al."action" = ${input.action}` : sql``}
          ${input.userId ? sql`AND al."userId" = ${input.userId}` : sql``}
        ORDER BY al."createdAt" DESC
        LIMIT 10000
      `);
      const rows = (result as any).rows || result;

      // Build CSV
      const headers = ["ID", "Thời gian", "Người dùng", "Hành động", "Loại", "Entity ID", "Tên Entity", "Trạng thái", "IP"];
      const csvRows = rows.map((r: any) => [
        r.id,
        new Date(r.createdAt).toLocaleString("vi-VN"),
        r.userName || "System",
        r.action,
        r.entityType,
        r.entityId || "",
        r.entityName || "",
        r.status,
        r.ipAddress || "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));

      const csv = [headers.join(","), ...csvRows].join("\n");
      const buffer = Buffer.from("\uFEFF" + csv, "utf-8"); // BOM for Excel

      return {
        data: buffer.toString("base64"),
        filename: `audit_logs_${input.startDate.toISOString().split("T")[0]}_${input.endDate.toISOString().split("T")[0]}.csv`,
        contentType: "text/csv; charset=utf-8",
      };
    }),

  // ── doc 42 Đợt 4B (H4) — MASTER-DATA AUDIT TRAIL (read-only) ────────────────
  // Surfaces "ai đổi gì, khi nào" cho module Quản lý dữ liệu. Đọc audit_logs
  // THẬT (chủ yếu bản ghi trpc_mutation với action = đường dẫn router; kèm các
  // bản ghi domain có entityName). Gate bằng quyền module "masterdata" (admin
  // luôn qua) — KHÔNG dùng adminProcedure để người dùng có canView masterdata
  // cũng xem được (doc 42 §9 Đợt 4 mục 2). Chỉ ĐỌC — không ghi/không sửa audit.

  /**
   * Tùy chọn bộ lọc cho trang audit master-data: danh mục "thực thể" (key→nhãn)
   * và danh sách người dùng đã có thao tác (lấy TỪ dữ liệu audit thật, nên luôn
   * hợp quyền — không phụ thuộc user.list admin-only).
   */
  masterDataAuditFilters: protectedProcedure
    .use(requirePermission("masterdata", "canView"))
    .query(async () => {
      const domains = Object.entries(MASTER_DATA_DOMAINS).map(([key, v]) => ({
        key,
        label: v.label,
      }));
      const conn = await getDb();
      if (!conn) return { domains, users: [] as { id: number; name: string }[] };

      const allPrefixes = Object.values(MASTER_DATA_DOMAINS).flatMap((d) => d.prefixes);
      const prefixCond = sql.join(
        allPrefixes.map((p) => sql`al."action" LIKE ${p + "%"}`),
        sql` OR `,
      );

      const result: any = await conn.execute(sql`
        SELECT DISTINCT al."userId" AS id, COALESCE(u."name", al."userName") AS name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        WHERE (${prefixCond}) AND al."userId" IS NOT NULL
        ORDER BY name
      `);
      const rows = result.rows || result;
      return {
        domains,
        users: rows.map((r: any) => ({
          id: r.id as number,
          name: (r.name as string) || `User #${r.id}`,
        })),
      };
    }),

  /**
   * Danh sách bản ghi kiểm toán của master data — lọc theo thực thể (nhóm router),
   * hành động (create/update/delete), người dùng, khoảng thời gian và tìm kiếm tự do.
   */
  masterDataList: protectedProcedure
    .use(requirePermission("masterdata", "canView"))
    .input(
      z.object({
        domain: z.string().optional(),
        op: z.enum(["create", "update", "delete"]).optional(),
        userId: z.number().optional(),
        search: z.string().optional(),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        limit: z.number().min(1).max(500).default(200),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const conn = await getDb();
      if (!conn) return { items: [] as MasterDataAuditItem[], total: 0 };

      // Path-prefixes to match on al.action (either the selected domain, or all).
      const prefixes =
        input.domain && MASTER_DATA_DOMAINS[input.domain]
          ? MASTER_DATA_DOMAINS[input.domain].prefixes
          : Object.values(MASTER_DATA_DOMAINS).flatMap((d) => d.prefixes);

      const prefixCond = sql.join(
        prefixes.map((p) => sql`al."action" LIKE ${p + "%"}`),
        sql` OR `,
      );

      // Classify a router path into create/update/delete/other. Used by BOTH the
      // SELECT column and the op filter so display and filtering always agree.
      const opClassSql = sql`CASE
        WHEN al."action" ~* 'delete|revoke|remove|cleanup' THEN 'delete'
        WHEN al."action" ~* 'create|issue|grant|add|import|clone|upsert' THEN 'create'
        WHEN al."action" ~* 'update|reorder|reissue|savedraft|complete|restore|move|position' THEN 'update'
        ELSE 'other' END`;

      const conditions: ReturnType<typeof sql>[] = [sql`(${prefixCond})`];
      if (input.userId) conditions.push(sql`al."userId" = ${input.userId}`);
      if (input.startDate) conditions.push(sql`al."createdAt" >= ${input.startDate}`);
      if (input.endDate) conditions.push(sql`al."createdAt" <= ${input.endDate}`);
      if (input.op) conditions.push(sql`(${opClassSql}) = ${input.op}`);
      if (input.search) {
        const like = `%${input.search}%`;
        conditions.push(
          sql`(al."entityName" ILIKE ${like} OR al."action" ILIKE ${like} OR al."userName" ILIKE ${like})`,
        );
      }

      const whereClause = sql.join(conditions, sql` AND `);

      const result: any = await conn.execute(sql`
        SELECT al.id, al."action", al."entityType", al."entityId", al."entityName",
               al."userId", al."userName", al."status", al."createdAt", al."details",
               (${opClassSql}) AS "opClass",
               u."name" AS "displayUserName"
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al."userId"
        WHERE ${whereClause}
        ORDER BY al."createdAt" DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);
      const rows = result.rows || result;

      const countResult: any = await conn.execute(sql`
        SELECT COUNT(*)::int AS total FROM audit_logs al WHERE ${whereClause}
      `);
      const countRows = countResult.rows || countResult;

      return {
        items: rows.map(normalizeMasterDataAuditRow) as MasterDataAuditItem[],
        total: countRows[0]?.total || 0,
      };
    }),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

// ── doc 42 Đợt 4B (H4) — master-data audit helpers ───────────────────────────

export interface MasterDataAuditItem {
  id: number;
  createdAt: string | Date;
  path: string;
  opClass: "create" | "update" | "delete" | "other";
  entityType: string | null;
  entityName: string | null;
  userId: number | null;
  userName: string | null;
  status: string;
  summary: string;
}

/**
 * Nhóm "thực thể" master data → tiền tố đường dẫn router (al.action). Đây là NGUỒN
 * LỌC DUY NHẤT (server-owned) để lọc audit_logs theo từng khu vực dữ liệu; UI chỉ
 * cần gửi `key`, nhãn `label` được trả về cho dropdown (giữ FE/BE không lệch nhau).
 */
const MASTER_DATA_DOMAINS: Record<string, { label: string; prefixes: string[] }> = {
  tradePartners: { label: "Nhà cung cấp & Khách hàng", prefixes: ["masterData.suppliers.", "masterData.customers."] },
  materialsUom: { label: "Vật tư & Đơn vị", prefixes: ["masterData.materials.", "masterData.uom."] },
  calendarInventory: { label: "Lịch & Kho", prefixes: ["masterData.calendar.", "masterData.inventory."] },
  workforce: { label: "Kỹ năng & Dụng cụ", prefixes: ["masterData.skills.", "masterData.tools."] },
  componentLibrary: { label: "Thư viện linh kiện", prefixes: ["componentLibrary."] },
  operatorBadges: { label: "Thẻ vận hành", prefixes: ["operatorBadge."] },
  products: { label: "Sản phẩm", prefixes: ["productModel.", "product.", "productOnboarding.", "fiducialMark."] },
  productMapping: { label: "Gán sản phẩm ↔ máy", prefixes: ["productMachineMapping."] },
  workstations: { label: "Trạm làm việc", prefixes: ["workstation."] },
  processes: { label: "Quy trình", prefixes: ["process."] },
  factoryConfig: { label: "Cấu hình nhà máy", prefixes: ["factory.", "workshop.", "line.", "station.", "machine."] },
  layout: { label: "Sơ đồ bố trí", prefixes: ["layout."] },
};

/** Parse cột details (TEXT chứa JSON) an toàn → object rỗng nếu thiếu/hỏng. */
function parseAuditDetails(raw: unknown): Record<string, any> {
  if (raw == null) return {};
  if (typeof raw === "object") return raw as Record<string, any>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return {};
}

/** Tóm tắt thay đổi (vi) đọc TỪ details thật — không bịa; chuỗi rỗng nếu không rõ. */
function summarizeAudit(details: Record<string, any>): string {
  if (typeof details.total === "number" && ("inserted" in details || "updated" in details)) {
    const parts = [`thêm ${details.inserted ?? 0}`, `cập nhật ${details.updated ?? 0}`];
    if (details.failed) parts.push(`lỗi ${details.failed}`);
    return `Nhập ${details.total} dòng (${parts.join(", ")})`;
  }
  if (typeof details.deleted === "number") return `Đã xoá ${details.deleted} bản ghi`;
  if (details.soft === true) return "Xoá mềm (giữ lịch sử)";
  if (Array.isArray(details.changes) && details.changes.length > 0) {
    return `${details.changes.length} trường thay đổi`;
  }
  if (details.metadata && details.metadata.ok === false) return "Thao tác thất bại";
  return "";
}

function normalizeMasterDataAuditRow(r: any): MasterDataAuditItem {
  const details = parseAuditDetails(r.details);
  return {
    id: r.id,
    createdAt: r.createdAt,
    path: r.action,
    opClass: (r.opClass as MasterDataAuditItem["opClass"]) || "other",
    entityType: r.entityType ?? null,
    entityName: r.entityName ?? null,
    userId: r.userId ?? null,
    userName: r.displayUserName || r.userName || null,
    status: r.status || "success",
    summary: summarizeAudit(details),
  };
}

function generateActivityMessage(row: any): string {
  const actionMap: Record<string, string> = {
    create: "đã tạo",
    update: "đã cập nhật",
    delete: "đã xóa",
    login: "đã đăng nhập",
    login_failed: "đăng nhập thất bại",
    logout: "đã đăng xuất",
    import: "đã nhập dữ liệu",
    export: "đã xuất dữ liệu",
    inspection_submit: "đã gửi kiểm tra",
    inspection_correct: "đã sửa kiểm tra",
    report_generate: "đã tạo báo cáo",
    report_export: "đã xuất báo cáo",
    config_change: "đã thay đổi cấu hình",
    role_change: "đã thay đổi quyền",
  };

  const entityMap: Record<string, string> = {
    user: "người dùng",
    factory: "nhà máy",
    workshop: "phân xưởng",
    line: "dây chuyền",
    machine: "máy",
    product_model: "model sản phẩm",
    inspection: "kiểm tra",
    alert: "cảnh báo",
    report: "báo cáo",
    system_config: "cấu hình hệ thống",
  };

  const actionText = actionMap[row.action] || row.action;
  const entityText = entityMap[row.entityType] || row.entityType;
  const entityName = row.entityName ? ` "${row.entityName}"` : "";
  const userName = row.userName || "System";

  return `${userName} ${actionText} ${entityText}${entityName}`;
}
