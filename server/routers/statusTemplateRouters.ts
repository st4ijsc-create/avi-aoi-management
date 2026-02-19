import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";

export const machineStatusRouter = router({
  listWithStatus: protectedProcedure.query(async () => {
    return db.getAllMachinesWithStatus();
  }),

  getLogs: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      limit: z.number().min(1).max(1000).default(100),
    }))
    .query(async ({ input }) => {
      return db.getMachineStatusLogs(input.machineId, input.limit);
    }),

  getHeartbeats: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      hours: z.number().min(1).max(168).default(24),
    }))
    .query(async ({ input }) => {
      return db.getHeartbeatHistory(input.machineId, input.hours);
    }),

  getUptimeStats: protectedProcedure
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
      return createTemplate({
        ...input,
        createdBy: ctx.user.id,
      });
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
    .mutation(async ({ input }) => {
      const { updateTemplate } = await import("../templateDb");
      const { id, ...data } = input;
      return updateTemplate(id, data);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteTemplate } = await import("../templateDb");
      return deleteTemplate(input.id);
    }),

  clone: adminProcedure
    .input(z.object({
      id: z.number(),
      newCode: z.string().min(1).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      const { cloneTemplate } = await import("../templateDb");
      return cloneTemplate(input.id, input.newCode, ctx.user.id);
    }),
});

// ============ BULK IMPORT ROUTER ============
export const bulkImportRouter = router({
  measurementPoints: adminProcedure
    .input(z.object({
      productModelId: z.number(),
      points: z.array(z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        measurementType: z.enum(['DIMENSION', 'VISUAL', 'ELECTRICAL', 'POSITION', 'COLOR', 'SURFACE', 'OTHER']),
        unit: z.string().optional(),
        lowerLimit: z.number().optional(),
        upperLimit: z.number().optional(),
        nominalValue: z.number().optional(),
        positionX: z.number(),
        positionY: z.number(),
        radius: z.number().default(20),
        cropWidth: z.number().default(100),
        cropHeight: z.number().default(100),
        orderIndex: z.number().default(0),
      })),
    }))
    .mutation(async ({ input }) => {
      const pointsWithProductModel = input.points.map((p, index) => ({
        ...p,
        productModelId: input.productModelId,
        orderIndex: p.orderIndex || index + 1,
        lowerLimit: p.lowerLimit?.toString(),
        upperLimit: p.upperLimit?.toString(),
        nominalValue: p.nominalValue?.toString(),
      }));
      
      return db.bulkCreateMeasurementPoints(pointsWithProductModel);
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
