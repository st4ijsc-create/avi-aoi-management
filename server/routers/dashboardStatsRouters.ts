import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import * as db from "../db";
import { statsCache, CACHE_KEYS, CACHE_TTL } from "../_core/cache";

export const dashboardRouter = router({
  getStats: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      // Check cache first
      const cacheKey = statsCache.generateKey(CACHE_KEYS.DASHBOARD_STATS, input);
      const cached = statsCache.get<Awaited<ReturnType<typeof db.getDashboardStats>>>(cacheKey);
      if (cached) return cached;

      // Fetch from database
      const stats = await db.getDashboardStats({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
      
      // Cache for 30 seconds
      statsCache.set(cacheKey, stats, CACHE_TTL.SHORT);
      return stats;
    }),

  getMachineStats: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = statsCache.generateKey(CACHE_KEYS.MACHINE_STATS, input);
      const cached = statsCache.get<Awaited<ReturnType<typeof db.getMachineStats>>>(cacheKey);
      if (cached) return cached;

      const stats = await db.getMachineStats(input.machineId, input.startDate, input.endDate);
      statsCache.set(cacheKey, stats, CACHE_TTL.SHORT);
      return stats;
    }),

  getAllMachinesStats: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      // Check cache first to avoid N+1 queries
      const cacheKey = statsCache.generateKey(CACHE_KEYS.MACHINE_STATS + '_all', input);

      const compute = async () => {
        const machinesWithHierarchy = await db.getMachinesWithHierarchy();
        const stats = await Promise.all(
          machinesWithHierarchy.map(async (item) => {
            // Use per-machine cache to avoid redundant DB calls
            const perMachineCacheKey = statsCache.generateKey(CACHE_KEYS.MACHINE_STATS, { machineId: item.machine.id, startDate: input.startDate, endDate: input.endDate });
            let machineStats = statsCache.get<Awaited<ReturnType<typeof db.getMachineStats>>>(perMachineCacheKey);
            if (!machineStats) {
              machineStats = await db.getMachineStats(item.machine.id, input.startDate, input.endDate);
              statsCache.set(perMachineCacheKey, machineStats, CACHE_TTL.SHORT);
            }
            return {
              machine: item.machine,
              station: item.station,
              line: item.line,
              workshop: item.workshop,
              factory: item.factory,
              stats: machineStats,
            };
          })
        );
        return stats;
      };

      const cached = statsCache.get<Awaited<ReturnType<typeof compute>>>(cacheKey);
      if (cached) return cached;

      const stats = await compute();
      statsCache.set(cacheKey, stats, CACHE_TTL.SHORT);
      return stats;
    }),

  getDailyStats: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = statsCache.generateKey(CACHE_KEYS.DAILY_STATS, input);
      const cached = statsCache.get<Awaited<ReturnType<typeof db.getDailyStats>>>(cacheKey);
      if (cached) return cached;

      const stats = await db.getDailyStats(input.factoryId, input.workshopId, input.days);
      statsCache.set(cacheKey, stats, CACHE_TTL.MEDIUM);
      return stats;
    }),

  // Stats with comparison to previous period
  getStatsWithComparison: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      machineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return db.getStatsWithComparison({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
    }),

  // Shift-based statistics
  getShiftStats: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input, ctx }) => {
      return db.getShiftStats({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
    }),

  // Top and bottom performing machines
  getTopBottomMachines: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(5),
    }))
    .query(async ({ input, ctx }) => {
      return db.getTopBottomMachines({ ...input, userId: ctx.user.id, userRole: ctx.user.role });
    }),

  // Active alerts count
  getActiveAlertsCount: protectedProcedure
    .query(async () => {
      return db.getActiveAlertsCount();
    }),

  // Hourly stats for timeline chart
  getHourlyStats: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      machineId: z.number().optional(),
      hours: z.number().default(24),
    }))
    .query(async ({ input }) => {
      return db.getHourlyStats(input);
    }),

  // Dashboard Templates
  listTemplates: protectedProcedure
    .query(async () => {
      return db.listDashboardTemplates();
    }),

  getTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getDashboardTemplateById(input.id);
    }),

  createTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      templateType: z.enum(['system', 'shared']).default('shared'),
      widgets: z.array(z.string()),
      layout: z.array(z.object({
        i: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      })),
      previewImageUrl: z.string().optional(),
      isPublic: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createDashboardTemplate({
        name: input.name,
        description: input.description,
        templateType: input.templateType,
        widgets: input.widgets,
        layout: input.layout,
        previewImageUrl: input.previewImageUrl,
        isPublic: input.isPublic,
        createdBy: ctx.user.id,
      });
    }),

  updateTemplate: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      widgets: z.array(z.string()).optional(),
      layout: z.array(z.object({
        i: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
      })).optional(),
      previewImageUrl: z.string().optional(),
      isPublic: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.updateDashboardTemplate(id, data);
    }),

  deleteTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return db.deleteDashboardTemplate(input.id);
    }),

  applyTemplate: protectedProcedure
    .input(z.object({ templateId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      return db.applyDashboardTemplate(ctx.user.id, input.templateId);
    }),
});

// ============ SEED DATA ROUTER ============
export const seedDataRouter = router({
  seed: adminProcedure.mutation(async () => {
    return db.seedSampleData();
  }),
  
  seedInspections: adminProcedure
    .input(z.object({ count: z.number().min(1).max(500).default(100) }))
    .mutation(async ({ input }) => {
      return db.seedInspectionData(input.count);
    }),

  seedWorkstationAnalytics: adminProcedure
    .input(z.object({ 
      inspectionCount: z.number().min(1).max(1000).default(500),
      daysBack: z.number().min(1).max(30).default(7)
    }))
    .mutation(async ({ input }) => {
      return db.seedWorkstationAnalyticsData(input);
    }),
});
