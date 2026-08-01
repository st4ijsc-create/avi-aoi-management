import { protectedProcedure, router } from "../_core/trpc";
// doc 54 Wave B — these machineStatus reads expose whole-plant inventory (status/logs/
// heartbeats/uptime). Gate them behind machine_monitoring/canView so plain `user` (and
// unassigned) roles can't enumerate the fleet.
import { requirePermission } from "../_core/accessControl";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
// Doc 31 Đợt C (MP7/MP8) — deep bulk-import derivation + lifecycle gate.
import {
  deepImportPointSchema,
  buildInsertFromImportPoint,
  mapCatalogCategoryToLegacyType,
  type LegacyMeasurementType,
} from "../utils/measurementPointImport";
import { resolveProductThresholdGate } from "../services/thresholdGovernanceService";

export const machineStatusRouter = router({
  listWithStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
    return db.getAllMachinesWithStatus();
  }),

  getLogs: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      machineId: z.number(),
      limit: z.number().min(1).max(1000).default(100),
    }))
    .query(async ({ input }) => {
      return db.getMachineStatusLogs(input.machineId, input.limit);
    }),

  getHeartbeats: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      machineId: z.number(),
      hours: z.number().min(1).max(168).default(24),
    }))
    .query(async ({ input }) => {
      return db.getHeartbeatHistory(input.machineId, input.hours);
    }),

  getUptimeStats: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      machineId: z.number(),
      hours: z.number().min(1).max(720).default(24),
    }))
    .query(async ({ input }) => {
      return db.getMachineUptimeStats(input.machineId, input.hours);
    }),

  getUnnotifiedOffline: adminProcedure
    .input(z.object({
      thresholdMinutes: z.number().min(1).max(60).default(5),
    }))
    .query(async ({ input }) => {
      return db.getUnnotifiedOfflineMachines(input.thresholdMinutes);
    }),

  markNotificationSent: adminProcedure
    .input(z.object({ logId: z.number() }))
    .mutation(async ({ input }) => {
      await db.markOfflineNotificationSent(input.logId);
      return { success: true };
    }),

  // Uptime Timeline
  getUptimeTimeline: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      hours: z.number().min(1).max(720).default(24),
    }))
    .query(async ({ input }) => {
      return db.getUptimeTimeline(input.machineId, input.hours);
    }),

  getAllUptimeTimelines: protectedProcedure
    .input(z.object({
      hours: z.number().min(1).max(720).default(24),
    }))
    .query(async ({ input }) => {
      return db.getAllMachinesUptimeTimeline(input.hours);
    }),

  // Alert Configuration
  getAlertConfig: adminProcedure.query(async () => {
    return db.getAlertConfiguration();
  }),

  updateAlertConfig: adminProcedure
    .input(z.object({
      thresholdMinutes: z.number().min(1).max(60),
      isActive: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await db.updateAlertConfiguration(input);
      return { success: true };
    }),

  // Machine Status Report
  getReport: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      startDate: z.string(),
      endDate: z.string(),
    }))
    .query(async ({ input }) => {
      return db.getMachineStatusReport(
        input.machineId,
        new Date(input.startDate),
        new Date(input.endDate)
      );
    }),
});

// ============ MEASUREMENT POINT TEMPLATE ROUTER ============
export const templateRouter = router({
  list: protectedProcedure.query(async () => {
    const { listTemplates } = await import("../templateDb");
    return listTemplates();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { getTemplateById } = await import("../templateDb");
      return getTemplateById(input.id);
    }),

  getByCategory: protectedProcedure
    .input(z.object({ category: z.string() }))
    .query(async ({ input }) => {
      const { getTemplatesByCategory } = await import("../templateDb");
      return getTemplatesByCategory(input.category);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      category: z.string().optional(),
      points: z.array(z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        measurementType: z.enum(['DIMENSION', 'VISUAL', 'ELECTRICAL', 'POSITION', 'COLOR', 'SURFACE', 'OTHER']),
        unit: z.string().optional(),
        lowerLimit: z.string().optional(),
        upperLimit: z.string().optional(),
        nominalValue: z.string().optional(),
        positionX: z.number(),
        positionY: z.number(),
        radius: z.number(),
        cropWidth: z.number(),
        cropHeight: z.number(),
        orderIndex: z.number(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const { createTemplate } = await import("../templateDb");
      const result = await createTemplate({
        ...input,
        createdBy: ctx.user.id,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "template.create",
          entityType: "product",
          entityId: typeof result === "object" && result && "id" in result ? (result as any).id : undefined,
          entityName: input.code,
          details: { code: input.code, name: input.name, category: input.category, pointCount: input.points.length },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (template.create)", err);
      }
      return result;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      points: z.array(z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        measurementType: z.enum(['DIMENSION', 'VISUAL', 'ELECTRICAL', 'POSITION', 'COLOR', 'SURFACE', 'OTHER']),
        unit: z.string().optional(),
        lowerLimit: z.string().optional(),
        upperLimit: z.string().optional(),
        nominalValue: z.string().optional(),
        positionX: z.number(),
        positionY: z.number(),
        radius: z.number(),
        cropWidth: z.number(),
        cropHeight: z.number(),
        orderIndex: z.number(),
      })).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { updateTemplate } = await import("../templateDb");
      const { id, ...data } = input;
      const result = await updateTemplate(id, data);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "template.update",
          entityType: "product",
          entityId: id,
          entityName: data.name ?? undefined,
          details: { changedFields: Object.keys(data) },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (template.update)", err);
      }
      return result;
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const { deleteTemplate } = await import("../templateDb");
      const result = await deleteTemplate(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "template.delete",
          entityType: "product",
          entityId: input.id,
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (template.delete)", err);
      }
      return result;
    }),

  clone: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      newCode: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
    }))
    .mutation(async ({ input, ctx }) => {
      const { cloneTemplate } = await import("../templateDb");
      const result = await cloneTemplate(input.id, input.newCode, ctx.user.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "template.clone",
          entityType: "product",
          entityId: typeof result === "object" && result && "id" in result ? (result as any).id : undefined,
          entityName: input.newCode,
          details: { sourceId: input.id, newCode: input.newCode },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (template.clone)", err);
      }
      return result;
    }),
});

// ============ BULK IMPORT ROUTER ============
export const bulkImportRouter = router({
  // Doc 31 Đợt C (MP7/MP8) — DEEP bulk import. The flat legacy shape is now the
  // `deepImportPointSchema` covering tolerance v2, shape+geometry, 3D/solder
  // fields and measurementTypeCode. Limits imported into a LIVE product (active/
  // eol/archived, or one with a released program) are stripped and surfaced via
  // `skipped` — they must be set through the Threshold Approvals queue (decision #4).
  measurementPoints: adminProcedure
    .input(z.object({
      productModelId: z.number(),
      points: z.array(deepImportPointSchema),
    }))
    .mutation(async ({ input }) => {
      // Resolve product dims once (normalized coords) …
      const product = await db.getProductModelById(input.productModelId);
      const dims = product
        ? { imageWidth: product.imageWidth, imageHeight: product.imageHeight }
        : null;
      // … and the lifecycle gate once (live product → strip imported limits).
      let gateLive = false;
      try {
        const gate = await resolveProductThresholdGate(input.productModelId);
        gateLive = gate.decision === "requires_approval" && gate.enforced;
      } catch {
        // fail-safe: if the gate cannot resolve, do NOT strip (best-effort import
        // on a development product); the per-point insert still validates.
        gateLive = false;
      }

      // Resolve legacy enum per unique measurementTypeCode (cached).
      const typeCache = new Map<string, LegacyMeasurementType>();
      const resolveLegacyType = async (
        typeCode?: string,
        fallback?: LegacyMeasurementType,
      ): Promise<LegacyMeasurementType> => {
        if (typeCode) {
          if (typeCache.has(typeCode)) return typeCache.get(typeCode)!;
          const cat = await db.getMeasurementTypeCatalogByCode(typeCode);
          const resolved = cat ? mapCatalogCategoryToLegacyType(cat.category) : (fallback ?? "VISUAL");
          typeCache.set(typeCode, resolved);
          return resolved;
        }
        return fallback ?? "VISUAL";
      };

      const rows = [];
      let limitsStrippedCount = 0;
      const strippedCodes: string[] = [];
      for (let i = 0; i < input.points.length; i++) {
        const p = input.points[i];
        const legacyType = await resolveLegacyType(p.measurementTypeCode, p.measurementType);
        const built = buildInsertFromImportPoint(
          p,
          input.productModelId,
          legacyType,
          p.orderIndex || i + 1,
          dims,
          gateLive,
        );
        if (built.limitsStripped) {
          limitsStrippedCount++;
          strippedCodes.push(p.code);
        }
        rows.push(built.row);
      }

      const result = await db.bulkCreateMeasurementPoints(rows);
      // Additive: `skipped` = points created WITHOUT their limits because the
      // product is live. Surfaced in the dialog so the engineer routes limits
      // through approval instead of assuming they imported.
      const skipped = limitsStrippedCount;
      const errors = [...result.errors];
      if (skipped > 0) {
        errors.push(
          `${skipped} point(s) imported WITHOUT limits — product is live; set limits via the Threshold Approvals queue. ` +
            `(${strippedCodes.slice(0, 10).join(", ")}${strippedCodes.length > 10 ? ", …" : ""}) / ` +
            `bị bỏ ngưỡng vì sản phẩm đang hoạt động — đặt ngưỡng qua hàng đợi duyệt.`,
        );
      }
      return { ...result, skipped, errors };
    }),
});

// ============ MANUAL MACHINE MAPPING ROUTER ============
export const manualMappingRouter = router({
  list: protectedProcedure.query(async () => {
    return db.listManualConnections();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getManualConnectionById(input.id);
    }),

  getByMachineId: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      return db.getManualConnectionByMachineId(input.machineId);
    }),

  create: adminProcedure
    .input(z.object({
      machineId: z.number(),
      ipAddress: z.string().min(1).max(45),
      port: z.number().min(1).max(65535).default(8080),
      protocol: z.enum(['websocket', 'tcp', 'http']).default('websocket'),
      isEnabled: z.boolean().default(true),
      maxRetries: z.number().min(1).max(100).default(5),
      retryIntervalSeconds: z.number().min(5).max(3600).default(30),
    }))
    .mutation(async ({ input }) => {
      // Check if machine already has a manual connection
      const existing = await db.getManualConnectionByMachineId(input.machineId);
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Máy này đã có cấu hình kết nối thủ công',
        });
      }
      return db.createManualConnection(input);
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      ipAddress: z.string().min(1).max(45).optional(),
      port: z.number().min(1).max(65535).optional(),
      protocol: z.enum(['websocket', 'tcp', 'http']).optional(),
      isEnabled: z.boolean().optional(),
      maxRetries: z.number().min(1).max(100).optional(),
      retryIntervalSeconds: z.number().min(5).max(3600).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateManualConnection(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteManualConnection(input.id);
      return { success: true };
    }),

  updateStatus: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(['connected', 'disconnected', 'error', 'pending']),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.updateManualConnectionStatus(input.id, input.status, input.errorMessage);
      return { success: true };
    }),

  testConnection: adminProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ input }) => {
      const connection = await db.getManualConnectionById(input.id);
      if (!connection) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Không tìm thấy cấu hình kết nối',
        });
      }
      
      // Update status to pending
      await db.updateManualConnectionStatus(input.id, 'pending');
      
      // Test actual connection using socket module
      try {
        const { testManualConnection } = await import('../_core/socket');
        const result = await testManualConnection(
          connection.ipAddress,
          connection.port,
          connection.protocol,
          5000 // 5 second timeout
        );
        
        if (result.success) {
          await db.updateManualConnectionStatus(input.id, 'connected');
          return { 
            success: true, 
            message: result.message,
            latencyMs: result.latencyMs 
          };
        } else {
          await db.updateManualConnectionStatus(input.id, 'error', result.message);
          return { success: false, message: result.message };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Lỗi không xác định';
        await db.updateManualConnectionStatus(input.id, 'error', errorMessage);
        return { success: false, message: errorMessage };
      }
    }),
});
