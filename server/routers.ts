import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { emitNGAlert, emitYieldWarning, emitDashboardUpdate } from "./_core/socket";
import { systemRouter } from "./_core/systemRouter";
import { processRouter } from "./routers/processRouter";
import { spcAnalysisRouter } from "./routers/spcAnalysisRouter";
import { twoFactorRouter } from "./routers/twoFactorRouter";
import { sessionRouter } from "./routers/sessionRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "./db";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";
import { statsCache, CACHE_KEYS, CACHE_TTL } from "./_core/cache";
import * as cachedStats from "./functions/cachedStatistics";

// Admin procedure - only admin users can access
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

// ============ FACTORY ROUTER ============
const factoryRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getFactories();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getFactoryById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      address: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createFactory(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      address: z.string().optional(),
      isActive: z.boolean().optional(),
      mapPositionX: z.number().min(0).max(1).optional(),
      mapPositionY: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, mapPositionX, mapPositionY, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      if (mapPositionX !== undefined) data.mapPositionX = mapPositionX.toString();
      if (mapPositionY !== undefined) data.mapPositionY = mapPositionY.toString();
      await db.updateFactory(id, data);
      return { success: true };
    }),

  updateMapPosition: adminProcedure
    .input(z.object({
      id: z.number(),
      mapPositionX: z.number().min(0).max(1),
      mapPositionY: z.number().min(0).max(1),
    }))
    .mutation(async ({ input }) => {
      await db.updateFactory(input.id, {
        mapPositionX: input.mapPositionX.toString(),
        mapPositionY: input.mapPositionY.toString(),
      });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteFactory(input.id);
      return { success: true };
    }),
});

// ============ WORKSHOP ROUTER ============
const workshopRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getWorkshops();
  }),

  listByFactory: protectedProcedure
    .input(z.object({ factoryId: z.number() }))
    .query(async ({ input }) => {
      return db.getWorkshopsByFactory(input.factoryId);
    }),

  create: adminProcedure
    .input(z.object({
      factoryId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createWorkshop(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      factoryId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateWorkshop(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteWorkshop(input.id);
      return { success: true };
    }),
});

// ============ PRODUCTION LINE ROUTER ============
const lineRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getProductionLines();
  }),

  listByWorkshop: protectedProcedure
    .input(z.object({ workshopId: z.number() }))
    .query(async ({ input }) => {
      return db.getProductionLinesByWorkshop(input.workshopId);
    }),

  create: adminProcedure
    .input(z.object({
      workshopId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createProductionLine(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      workshopId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateProductionLine(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductionLine(input.id);
      return { success: true };
    }),
});

// ============ STATION ROUTER ============
const stationRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getStations();
  }),

  listByLine: protectedProcedure
    .input(z.object({ lineId: z.number() }))
    .query(async ({ input }) => {
      return db.getStationsByLine(input.lineId);
    }),

  create: adminProcedure
    .input(z.object({
      lineId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createStation(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      lineId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateStation(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteStation(input.id);
      return { success: true };
    }),
});

// ============ MACHINE ROUTER ============
const machineRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getMachines();
  }),

  listByStation: protectedProcedure
    .input(z.object({ stationId: z.number() }))
    .query(async ({ input }) => {
      return db.getMachinesByStation(input.stationId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMachineById(input.id);
    }),

  getStats: protectedProcedure
    .input(z.object({
      id: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getMachineStats(input.id, input.startDate, input.endDate);
    }),

  create: adminProcedure
    .input(z.object({
      stationId: z.number(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      machineType: z.enum(["AVI", "AOI", "AUTOMATION"]),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      description: z.string().optional(),
      image2DUrl: z.string().optional(),
      image2DKey: z.string().optional(),
      image3DUrl: z.string().optional(),
      image3DKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const apiKey = `mach_${nanoid(32)}`;
      const id = await db.createMachine({ ...input, apiKey });
      return { id, apiKey };
    }),

  regenerateApiKey: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const apiKey = `mach_${nanoid(32)}`;
      const dbInstance = await db.getDb();
      if (!dbInstance) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      
      const { machines } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await dbInstance.update(machines).set({ apiKey }).where(eq(machines.id, input.id));
      return { apiKey };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      stationId: z.number().optional(),
      name: z.string().min(1).max(255).optional(),
      model: z.string().optional(),
      manufacturer: z.string().optional(),
      description: z.string().optional(),
      image2DUrl: z.string().optional(),
      image2DKey: z.string().optional(),
      image3DUrl: z.string().optional(),
      image3DKey: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMachine(id, data);
      return { success: true };
    }),

  // Upload machine image
  uploadImage: adminProcedure
    .input(z.object({
      id: z.number(),
      imageType: z.enum(["2D", "3D"]),
      imageData: z.string(), // Base64 encoded image
      fileName: z.string(),
      contentType: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { id, imageType, imageData, fileName, contentType } = input;
      
      // Convert base64 to buffer
      const buffer = Buffer.from(imageData, 'base64');
      
      // Generate unique file key
      const fileKey = `machines/${id}/${imageType.toLowerCase()}-${Date.now()}-${fileName}`;
      
      // Upload to S3
      const { url } = await storagePut(fileKey, buffer, contentType);
      
      // Update machine record
      const updateData = imageType === "2D" 
        ? { image2DUrl: url, image2DKey: fileKey }
        : { image3DUrl: url, image3DKey: fileKey };
      
      await db.updateMachine(id, updateData);
      
      return { url, key: fileKey };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMachine(input.id);
      return { success: true };
    }),

  // Update machine layout position
  updateLayoutPosition: protectedProcedure
    .input(z.object({
      id: z.number(),
      layoutPositionX: z.number().min(0).max(1),
      layoutPositionY: z.number().min(0).max(1),
    }))
    .mutation(async ({ input }) => {
      const { id, layoutPositionX, layoutPositionY } = input;
      await db.updateMachine(id, {
        layoutPositionX: layoutPositionX.toString(),
        layoutPositionY: layoutPositionY.toString(),
      });
      return { success: true };
    }),
});

// ============ PRODUCT MODEL ROUTER ============
const productModelRouter = router({
  list: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      sortBy: z.enum(["code", "name", "createdAt", "updatedAt"]).optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductModels(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductModelById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const productModel = await db.getProductModelByCode(input.code);
      if (!productModel) return null;
      const measurementPoints = await db.getMeasurementPointDefsByProductModel(productModel.id);
      return { productModel, measurementPoints };
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(100),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      category: z.string().optional(),
      categoryId: z.number().optional(),
      productLine: z.string().optional(),
      variant: z.string().optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      targetYieldRate: z.string().optional(),
      minYieldRate: z.string().optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      imageWidth: z.number().optional(),
      imageHeight: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      let finalImageUrl = input.referenceImageUrl;
      let finalImageKey = input.referenceImageKey;
      
      // Check if referenceImageUrl is a base64 data URL and upload to S3
      if (input.referenceImageUrl && input.referenceImageUrl.startsWith('data:')) {
        try {
          // Parse base64 data URL
          const matches = input.referenceImageUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            
            // Determine file extension
            const extMap: Record<string, string> = {
              'image/jpeg': 'jpg',
              'image/png': 'png',
              'image/gif': 'gif',
              'image/webp': 'webp',
            };
            const ext = extMap[mimeType] || 'jpg';
            const fileKey = `product-models/${input.code}-${nanoid(8)}.${ext}`;
            
            // Upload to S3
            const { url, key } = await storagePut(fileKey, buffer, mimeType);
            finalImageUrl = url;
            finalImageKey = key;
          }
        } catch (error) {
          console.error('Failed to upload product model image to S3:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload image' });
        }
      }
      
      const id = await db.createProductModel({
        ...input,
        referenceImageUrl: finalImageUrl,
        referenceImageKey: finalImageKey,
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(100).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      categoryId: z.number().optional(),
      productLine: z.string().optional(),
      variant: z.string().optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      targetYieldRate: z.string().optional(),
      minYieldRate: z.string().optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      imageWidth: z.number().optional(),
      imageHeight: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      let finalData = { ...data };
      
      // Check if code is being updated and if it's a duplicate
      if (data.code) {
        const existing = await db.getProductModelById(id);
        if (existing && existing.code !== data.code) {
          // Code is changing, check for duplicates
          const duplicate = await db.getProductModelByCode(data.code);
          if (duplicate) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mã sản phẩm đã tồn tại' });
          }
        } else if (existing && existing.code === data.code) {
          // Code is not changing, remove it from update data to avoid duplicate key error
          delete finalData.code;
        }
      }
      
      // Check if referenceImageUrl is a base64 data URL and upload to S3
      if (data.referenceImageUrl && data.referenceImageUrl.startsWith('data:')) {
        try {
          const matches = data.referenceImageUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            const mimeType = matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, 'base64');
            
            const extMap: Record<string, string> = {
              'image/jpeg': 'jpg',
              'image/png': 'png',
              'image/gif': 'gif',
              'image/webp': 'webp',
            };
            const ext = extMap[mimeType] || 'jpg';
            const code = data.code || `product-${id}`;
            const fileKey = `product-models/${code}-${nanoid(8)}.${ext}`;
            
            const { url, key } = await storagePut(fileKey, buffer, mimeType);
            finalData.referenceImageUrl = url;
            finalData.referenceImageKey = key;
          }
        } catch (error) {
          console.error('Failed to upload product model image to S3:', error);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload image' });
        }
      }
      
      await db.updateProductModel(id, finalData);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductModel(input.id);
      return { success: true };
    }),
});

// ============ MEASUREMENT POINT DEFINITION ROUTER ============
const measurementPointRouter = router({
  listByProductModel: protectedProcedure
    .input(z.object({ productModelId: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementPointDefsByProductModel(input.productModelId);
    }),

  listByMachine: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementPointDefsByMachine(input.machineId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementPointDefById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      productModelId: z.number(),
      machineId: z.number().optional(),
      workstationId: z.number().optional(),
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      measurementType: z.enum(["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"]),
      unit: z.string().optional(),
      lowerLimit: z.string().optional(),
      upperLimit: z.string().optional(),
      nominalValue: z.string().optional(),
      positionX: z.number(),
      positionY: z.number(),
      radius: z.number().optional(),
      cropWidth: z.number().optional().default(100),
      cropHeight: z.number().optional().default(100),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createMeasurementPointDef(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      measurementType: z.enum(["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"]).optional(),
      unit: z.string().optional(),
      lowerLimit: z.string().optional(),
      upperLimit: z.string().optional(),
      nominalValue: z.string().optional(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
      radius: z.number().optional(),
      cropWidth: z.number().optional(),
      cropHeight: z.number().optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      orderIndex: z.number().optional(),
      workstationId: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMeasurementPointDef(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMeasurementPointDef(input.id);
      return { success: true };
    }),

  // Upload cropped reference image for measurement point
  uploadCroppedImage: adminProcedure
    .input(z.object({
      pointId: z.number(),
      imageBase64: z.string(),
      mimeType: z.string().default('image/png'),
    }))
    .mutation(async ({ input }) => {
      // Get point info
      const point = await db.getMeasurementPointDefById(input.pointId);
      if (!point) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement point not found' });
      }

      // Decode base64 and upload to S3
      const buffer = Buffer.from(input.imageBase64, 'base64');
      const ext = input.mimeType.split('/')[1] || 'png';
      const fileKey = `measurement-points/${point.productModelId}/${point.code}-crop-${nanoid(8)}.${ext}`;
      
      const { url, key } = await storagePut(fileKey, buffer, input.mimeType);

      // Update measurement point with cropped image URL
      await db.updateMeasurementPointDef(input.pointId, {
        referenceImageUrl: url,
        referenceImageKey: key,
      });

      return { success: true, imageUrl: url, imageKey: key };
    }),
});

// ============ INSPECTION ROUTER ============
const inspectionRouter = router({
  list: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
      serialNumber: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
    }))
    .query(async ({ input, ctx }) => {
      return db.getProductInspections({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role,
      });
    }),

  search: protectedProcedure
    .input(z.object({
      factoryCode: z.string().optional(),
      workshopCode: z.string().optional(),
      lineCode: z.string().optional(),
      stationCode: z.string().optional(),
      machineCode: z.string().optional(),
      serialNumber: z.string().optional(),
      productModel: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
    }))
    .query(async ({ input }) => {
      return db.searchInspections(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const inspection = await db.getProductInspectionById(input.id);
      if (!inspection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inspection not found' });
      }
      
      const measurements = await db.getMeasurementResultsByInspection(input.id);
      const machine = await db.getMachineById(inspection.machineId);
      
      return { inspection, measurements, machine };
    }),

  confirmNTF: protectedProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const inspection = await db.getProductInspectionById(input.id);
      if (!inspection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inspection not found' });
      }
      if (inspection.originalResult !== 'NG') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only NG results can be marked as NTF' });
      }
      
      await db.updateProductInspectionNTF(input.id, ctx.user.id, input.reason);
      return { success: true };
    }),

  // Cursor-based pagination for large datasets
  listCursor: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(500).optional(),
      direction: z.enum(['forward', 'backward']).optional(),
      machineId: z.number().optional(),
      serialNumber: z.string().optional(),
      productModel: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getProductInspectionsCursor(input);
    }),

  topNGPoints: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(50).optional(),
    }))
    .query(async ({ input }) => {
      return db.getTopNGMeasurementPoints(input);
    }),

  aiAnalysis: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      // Get daily statistics for analysis
      const stats = await db.getDailyStatistics({
        startDate: input.startDate,
        endDate: input.endDate,
      });

      if (!stats || stats.length < 3) {
        return {
          trendPrediction: null,
          anomalies: [],
          recommendations: [],
          summary: "Không đủ dữ liệu để phân tích (cần tối thiểu 3 ngày dữ liệu)",
        };
      }

      // Calculate yield rates
      const yieldRates = stats.map(s => {
        const total = s.okCount + s.ngCount + s.ntfCount;
        return {
          date: s.date,
          yieldRate: total > 0 ? ((s.okCount + s.ntfCount) / total * 100) : 0,
          total,
          okCount: s.okCount,
          ngCount: s.ngCount,
          ntfCount: s.ntfCount,
        };
      });

      // Linear regression for trend prediction
      const n = yieldRates.length;
      const xMean = (n - 1) / 2;
      const yMean = yieldRates.reduce((sum, r) => sum + r.yieldRate, 0) / n;
      
      let numerator = 0;
      let denominator = 0;
      yieldRates.forEach((r, i) => {
        numerator += (i - xMean) * (r.yieldRate - yMean);
        denominator += (i - xMean) ** 2;
      });
      
      const slope = denominator !== 0 ? numerator / denominator : 0;
      const intercept = yMean - slope * xMean;

      // Predict next 7 days
      const predictions = [];
      for (let i = 1; i <= 7; i++) {
        const predictedYield = Math.max(0, Math.min(100, intercept + slope * (n + i - 1)));
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + i);
        predictions.push({
          date: futureDate.toISOString().split('T')[0],
          predictedYield: Math.round(predictedYield * 100) / 100,
        });
      }

      // Anomaly detection using Z-score
      const stdDev = Math.sqrt(
        yieldRates.reduce((sum, r) => sum + (r.yieldRate - yMean) ** 2, 0) / n
      );
      
      const anomalies = yieldRates
        .filter(r => {
          const zScore = stdDev > 0 ? Math.abs(r.yieldRate - yMean) / stdDev : 0;
          return zScore > 2; // More than 2 standard deviations
        })
        .map(r => ({
          date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
          yieldRate: r.yieldRate,
          deviation: r.yieldRate - yMean,
          type: r.yieldRate < yMean ? 'low' as const : 'high' as const,
          severity: Math.abs(r.yieldRate - yMean) / (stdDev || 1) > 3 ? 'critical' as const : 'warning' as const,
        }));

      // Generate recommendations
      const recommendations: string[] = [];
      const currentYield = yieldRates[yieldRates.length - 1]?.yieldRate || 0;
      const avgYield = yMean;

      if (slope < -0.5) {
        recommendations.push("⚠️ Xu hướng giảm: Yield Rate đang giảm dần. Cần kiểm tra quy trình sản xuất và chất lượng nguyên liệu.");
      } else if (slope > 0.5) {
        recommendations.push("✅ Xu hướng tăng: Yield Rate đang cải thiện. Tiếp tục duy trì các biện pháp hiện tại.");
      }

      if (currentYield < 90) {
        recommendations.push("🚨 Yield Rate hiện tại dưới 90%. Cần hành động ngay để cải thiện chất lượng.");
      } else if (currentYield < 95) {
        recommendations.push("🔶 Yield Rate hiện tại dưới 95%. Xem xét các điểm đo lỗi nhiều nhất để cải thiện.");
      }

      if (anomalies.length > 0) {
        recommendations.push(`🔍 Phát hiện ${anomalies.length} ngày bất thường. Kiểm tra lại dữ liệu và điều kiện sản xuất trong những ngày này.`);
      }

      if (stdDev > 5) {
        recommendations.push("📉 Độ biến động cao: Yield Rate không ổn định. Cần chuẩn hóa quy trình sản xuất.");
      }

      return {
        trendPrediction: {
          slope: Math.round(slope * 1000) / 1000,
          trend: slope > 0.5 ? 'increasing' : slope < -0.5 ? 'decreasing' : 'stable',
          predictions,
          confidence: Math.min(100, Math.max(0, 100 - stdDev * 5)),
        },
        anomalies,
        recommendations,
        summary: `Phân tích ${n} ngày dữ liệu. Yield Rate trung bình: ${avgYield.toFixed(1)}%, Độ lệch chuẩn: ${stdDev.toFixed(2)}%`,
        statistics: {
          mean: avgYield,
          stdDev,
          min: Math.min(...yieldRates.map(r => r.yieldRate)),
          max: Math.max(...yieldRates.map(r => r.yieldRate)),
          current: currentYield,
        },
      };
    }),
});

// ============ MEASUREMENT RESULT ROUTER ============
const measurementResultRouter = router({
  getByInspection: protectedProcedure
    .input(z.object({ inspectionId: z.number() }))
    .query(async ({ input }) => {
      return db.getMeasurementResultsByInspection(input.inspectionId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const result = await db.getMeasurementResultById(input.id);
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement result not found' });
      }
      
      // Get point definition for reference image
      const { measurementPointDefs } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      if (dbInstance) {
        const pointDef = await dbInstance.select().from(measurementPointDefs)
          .where(eq(measurementPointDefs.id, result.pointDefId)).limit(1);
        return { result, pointDef: pointDef[0] };
      }
      
      return { result, pointDef: null };
    }),

  updateRemark: protectedProcedure
    .input(z.object({
      id: z.number(),
      remark: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateMeasurementResultRemark(input.id, input.remark);
      return { success: true };
    }),

  analyzeWithAI: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const result = await db.getMeasurementResultById(input.id);
      if (!result || !result.imageUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No image available for analysis' });
      }

      // Get point definition for context
      const { measurementPointDefs } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      let pointDef = null;
      if (dbInstance) {
        const pointDefResult = await dbInstance.select().from(measurementPointDefs)
          .where(eq(measurementPointDefs.id, result.pointDefId)).limit(1);
        pointDef = pointDefResult[0];
      }

      const prompt = `Analyze this inspection image from an AVI/AOI machine.
${pointDef ? `Measurement point: ${pointDef.name} (${pointDef.measurementType})
${pointDef.description ? `Description: ${pointDef.description}` : ''}` : ''}

Please analyze the image and provide:
1. Overall quality assessment (OK/NG)
2. Detected defects or issues (if any)
3. Confidence level (0-100%)
4. Recommendations

Respond in JSON format:
{
  "assessment": "OK" or "NG",
  "defects": ["list of detected defects"],
  "confidence": 85,
  "recommendations": "your recommendations"
}`;

      try {
        const response = await invokeLLM({
          messages: [
            { role: "system", content: "You are an expert quality inspection AI for manufacturing. Analyze inspection images and provide detailed assessments." },
            { 
              role: "user", 
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: result.imageUrl, detail: "high" } }
              ]
            }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "inspection_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  assessment: { type: "string", enum: ["OK", "NG"] },
                  defects: { type: "array", items: { type: "string" } },
                  confidence: { type: "number" },
                  recommendations: { type: "string" }
                },
                required: ["assessment", "defects", "confidence", "recommendations"],
                additionalProperties: false
              }
            }
          }
        });

        const messageContent = response.choices[0].message.content;
        const contentStr = typeof messageContent === 'string' 
          ? messageContent 
          : Array.isArray(messageContent) 
            ? (messageContent.find((c: { type: string; text?: string }) => c.type === 'text') as { type: string; text?: string } | undefined)?.text || '{}'
            : '{}';
        const analysisResult = JSON.parse(contentStr);
        
        // Update the measurement result with AI analysis
        const { measurementResults } = await import("../drizzle/schema");
        if (dbInstance) {
          await dbInstance.update(measurementResults).set({
            aiAnalysisResult: JSON.stringify(analysisResult),
            aiConfidence: String(analysisResult.confidence / 100)
          }).where(eq(measurementResults.id, input.id));
        }

        return analysisResult;
      } catch (error) {
        console.error("AI analysis error:", error);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI analysis failed' });
      }
    }),

  correctResult: protectedProcedure
    .input(z.object({
      id: z.number(),
      result: z.enum(["OK", "NG", "NTF"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { measurementResults, productInspections } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      
      if (!dbInstance) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not available' });
      }

      // Get the measurement result
      const result = await db.getMeasurementResultById(input.id);
      if (!result) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement result not found' });
      }

      // Update the measurement result
      await dbInstance.update(measurementResults).set({
        result: input.result,
        remark: input.reason ? `[Corrected by ${ctx.user.name}] ${input.reason}` : result.remark,
      }).where(eq(measurementResults.id, input.id));

      // Recalculate overall inspection result
      const allResults = await db.getMeasurementResultsByInspection(result.inspectionId);
      const hasNG = allResults.some(r => r.id === input.id ? input.result === "NG" : r.result === "NG");
      const hasNTF = allResults.some(r => r.id === input.id ? input.result === "NTF" : r.result === "NTF");
      
      let overallResult: "OK" | "NG" | "NTF" = "OK";
      if (hasNG) overallResult = "NG";
      else if (hasNTF) overallResult = "NTF";

      await dbInstance.update(productInspections).set({
        overallResult,
      }).where(eq(productInspections.id, result.inspectionId));

      return { success: true, newOverallResult: overallResult };
    }),
});

// ============ LAYOUT ROUTER ============
const layoutRouter = router({
  listByWorkshop: protectedProcedure
    .input(z.object({ workshopId: z.number() }))
    .query(async ({ input }) => {
      return db.getFactoryLayoutsByWorkshop(input.workshopId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const layout = await db.getFactoryLayoutById(input.id);
      if (!layout) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout not found' });
      }
      
      const positions = await db.getMachinePositionsByLayout(input.id);
      return { layout, positions };
    }),

  create: adminProcedure
    .input(z.object({
      workshopId: z.number(),
      name: z.string().min(1).max(255),
      layoutType: z.enum(["2D", "3D"]).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      layoutData: z.string().optional(),
      backgroundImageUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createFactoryLayout(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      layoutType: z.enum(["2D", "3D"]).optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      layoutData: z.string().optional(),
      backgroundImageUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateFactoryLayout(id, data);
      return { success: true };
    }),

  addMachinePosition: adminProcedure
    .input(z.object({
      layoutId: z.number(),
      machineId: z.number(),
      positionX: z.number(),
      positionY: z.number(),
      positionZ: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createMachinePosition(input);
      return { id };
    }),

  updateMachinePosition: adminProcedure
    .input(z.object({
      id: z.number(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
      positionZ: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      rotation: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMachinePosition(id, data);
      return { success: true };
    }),

  removeMachinePosition: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMachinePosition(input.id);
      return { success: true };
    }),
});

// ============ DASHBOARD ROUTER ============

const dashboardRouter = router({
  getStats: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      // Check cache first
      const cacheKey = statsCache.generateKey(CACHE_KEYS.DASHBOARD_STATS, input);
      const cached = statsCache.get(cacheKey);
      if (cached) return cached;

      // Fetch from database
      const stats = await db.getDashboardStats(input);
      
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
      const cached = statsCache.get(cacheKey);
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
      const machinesWithHierarchy = await db.getMachinesWithHierarchy();
      const stats = await Promise.all(
        machinesWithHierarchy.map(async (item) => {
          const machineStats = await db.getMachineStats(item.machine.id, input.startDate, input.endDate);
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
      const cached = statsCache.get(cacheKey);
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
    .query(async ({ input }) => {
      return db.getStatsWithComparison(input);
    }),

  // Shift-based statistics
  getShiftStats: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getShiftStats(input);
    }),

  // Top and bottom performing machines
  getTopBottomMachines: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(5),
    }))
    .query(async ({ input }) => {
      return db.getTopBottomMachines(input);
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
const seedDataRouter = router({
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

// ============ MACHINE API ROUTER (for external machine integration) ============
const machineApiRouter = router({
  // Submit inspection data from machine
  submitInspection: publicProcedure
    .input(z.object({
      // Machine identification
      machineCode: z.string().optional(), // Mã máy (alternative to apiKey)
      apiKey: z.string().optional(), // API key (backward compatible)
      
      // Product information
      serialNumber: z.string(), // Số serial sản phẩm
      productModel: z.string().optional(), // Model sản phẩm
      batchNumber: z.string().optional(), // Số lô
      
      // Inspection results
      cycleTime: z.number().optional(), // Thời gian chu kỳ (giây)
      overallResult: z.enum(["OK", "NG"]), // Kết quả tổng thể
      inspectionTime: z.string().optional(), // Thời gian kiểm tra
      
      // Enterprise hierarchy (top-down)
      companyCode: z.string().optional(), // Mã tập đoàn/công ty
      factoryCode: z.string().optional(), // Mã nhà máy
      workshopCode: z.string().optional(), // Mã nhà xưởng
      lineCode: z.string().optional(), // Mã dây chuyền
      stageCode: z.string().optional(), // Mã công đoạn
      
      // Production context
      productionOrderCode: z.string().optional(), // Mã lệnh sản xuất
      operatorId: z.string().optional(), // Mã công nhân vận hành
      
      // Measurement data
      measurements: z.array(z.object({
        pointId: z.string().optional(), // ID điểm đo (new)
        pointCode: z.string().optional(), // Mã điểm đo (backward compatible)
        measuredValue: z.union([z.number(), z.string()]).optional(), // Giá trị đo (number hoặc string)
        result: z.enum(["OK", "NG"]), // Kết quả
        remark: z.string().optional(), // Ghi chú
        imageBase64: z.string().optional(), // Hình ảnh base64 (optional)
      })),
    }).refine(data => data.apiKey || data.machineCode, {
      message: "Either apiKey or machineCode must be provided"
    }))
    .mutation(async ({ input }) => {
      // Validate machine - support both apiKey and machineCode
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode);
      }
      
      if (!machine) {
        throw new TRPCError({ 
          code: 'UNAUTHORIZED', 
          message: input.apiKey ? 'Invalid API key' : 'Invalid machine code' 
        });
      }

      // Update machine heartbeat
      await db.updateMachineHeartbeat(machine.id);

      // Find production order if provided
      let productionOrderId: number | undefined;
      if (input.productionOrderCode) {
        const order = await db.getProductionOrderByCode(input.productionOrderCode);
        if (order) {
          productionOrderId = order.id;
        }
      }

      // Create inspection record
      const inspectionId = await db.createProductInspection({
        machineId: machine.id,
        serialNumber: input.serialNumber,
        productModel: input.productModel,
        batchNumber: input.batchNumber,
        overallResult: input.overallResult,
        originalResult: input.overallResult,
        corporateCode: input.companyCode, // Mã tập đoàn
        factoryCode: input.factoryCode, // Mã nhà máy
        inspectionTime: input.inspectionTime ? new Date(input.inspectionTime) : new Date(),
        cycleTime: input.cycleTime ? String(input.cycleTime) : undefined,

      });

      // Update production order quantities if linked
      if (productionOrderId) {
        const updateData: any = { completedQuantity: 1 };
        if (input.overallResult === 'OK') {
          updateData.okQuantity = 1;
        } else {
          updateData.ngQuantity = 1;
        }
        await db.updateProductionOrderQuantities(productionOrderId, updateData);
      }

      // Process measurements - support both pointId and pointCode
      const measurementResults = [];
      for (const measurement of input.measurements) {
        let pointDef;
        
        // Try pointId first (new format), then pointCode (backward compatible)
        if (measurement.pointId) {
          pointDef = await db.getMeasurementPointDefByCode(machine.id, measurement.pointId);
        }
        if (!pointDef && measurement.pointCode) {
          pointDef = await db.getMeasurementPointDefByCode(machine.id, measurement.pointCode);
        }
        
        if (pointDef) {
          measurementResults.push({
            inspectionId,
            pointDefId: pointDef.id,
            measuredValue: measurement.measuredValue !== undefined ? String(measurement.measuredValue) : undefined,
            result: measurement.result,
            remark: measurement.remark,
            // Store image if provided (will need to upload to S3 in production)
            imageUrl: measurement.imageBase64 ? measurement.imageBase64.substring(0, 100) + '...' : undefined,
          });
        }
      }

      if (measurementResults.length > 0) {
        await db.createMeasurementResults(measurementResults);
      }

      // Emit realtime alerts if NG
      if (input.overallResult === "NG") {
        // Get factory/workshop info for alert
        const station = await db.getStationById(machine.stationId);
        const line = station ? await db.getLineById(station.lineId) : null;
        const workshop = line ? await db.getWorkshopById(line.workshopId) : null;
        const factory = workshop ? await db.getFactoryById(workshop.factoryId) : null;

        emitNGAlert(
          machine.id,
          machine.name,
          machine.code,
          input.serialNumber,
          factory?.name,
          workshop?.name
        );
        
        // Publish NG alert to MQTT clients
        try {
          const { publishNGAlert } = await import('./services/mqttService');
          await publishNGAlert({
            machineId: machine.id,
            machineName: machine.name,
            machineCode: machine.code,
            serialNumber: input.serialNumber,
            stationId: machine.stationId,
            factoryName: factory?.name,
            workshopName: workshop?.name,
            lineName: line?.name,
            stationName: station?.name,
            inspectionId,
            timestamp: new Date(),
            measurementResults: input.measurements?.filter(m => m.result === 'NG').map(m => ({
              pointCode: m.pointId || m.pointCode || 'UNKNOWN',
              result: m.result,
              value: m.measuredValue,
            })) || [],
          });
        } catch (mqttError) {
          console.error('[MQTT] Failed to publish NG alert:', mqttError);
        }
      }

      // Invalidate cache after new inspection
      statsCache.invalidate(CACHE_KEYS.DASHBOARD_STATS);
      statsCache.invalidate(CACHE_KEYS.MACHINE_STATS);
      statsCache.invalidate(CACHE_KEYS.DAILY_STATS);
      
      // Invalidate statistics cache (async, don't await)
      cachedStats.invalidateStatisticsCache().catch(err => {
        console.error('[Cache] Failed to invalidate statistics cache:', err);
      });

      // Get updated stats and emit dashboard update
      const machineStats = await db.getMachineStats(machine.id);
      emitDashboardUpdate({
        type: "STATS_UPDATE",
        machineId: machine.id,
        stats: machineStats,
        timestamp: new Date(),
      });

      // Check yield rate and emit warning if below threshold
      if (machineStats.yieldRate < 90) {
        emitYieldWarning(
          machine.id,
          machine.name,
          machine.code,
          machineStats.yieldRate,
          90
        );
      }

      return { success: true, inspectionId };
    }),

  // Upload image for measurement
  uploadImage: publicProcedure
    .input(z.object({
      apiKey: z.string(),
      inspectionId: z.number(),
      pointCode: z.string(),
      imageBase64: z.string(),
      mimeType: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Validate API key
      const machine = await db.getMachineByApiKey(input.apiKey);
      if (!machine) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid API key' });
      }

      // Get point definition
      const pointDef = await db.getMeasurementPointDefByCode(machine.id, input.pointCode);
      if (!pointDef) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement point not found' });
      }

      // Find the measurement result
      const { measurementResults } = await import("../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");
      const dbInstance = await db.getDb();
      if (!dbInstance) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      }

      const results = await dbInstance.select().from(measurementResults)
        .where(and(
          eq(measurementResults.inspectionId, input.inspectionId),
          eq(measurementResults.pointDefId, pointDef.id)
        ))
        .limit(1);

      if (results.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement result not found' });
      }

      // Upload image to S3
      const buffer = Buffer.from(input.imageBase64, 'base64');
      const ext = input.mimeType?.split('/')[1] || 'jpg';
      const fileKey = `inspections/${input.inspectionId}/${input.pointCode}-${nanoid(8)}.${ext}`;
      
      const { url } = await storagePut(fileKey, buffer, input.mimeType || 'image/jpeg');

      // Update measurement result with image URL
      await dbInstance.update(measurementResults).set({
        imageUrl: url,
        imageKey: fileKey,
      }).where(eq(measurementResults.id, results[0].id));

      return { success: true, imageUrl: url };
    }),

  // Heartbeat endpoint
  heartbeat: publicProcedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input }) => {
      const machine = await db.getMachineByApiKey(input.apiKey);
      if (!machine) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid API key' });
      }
      
      await db.updateMachineHeartbeat(machine.id);
      return { success: true, machineId: machine.id };
    }),
});

// ============ ALERT ROUTER ============
// ============ PRODUCT-MACHINE MAPPING ROUTER ============
const productMachineMappingRouter = router({
  list: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      productModelId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductMachineMappings(input?.machineId, input?.productModelId);
    }),

  byMachine: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      return db.getMappingsByMachine(input.machineId);
    }),

  byProduct: protectedProcedure
    .input(z.object({ productModelId: z.number() }))
    .query(async ({ input }) => {
      return db.getMappingsByProduct(input.productModelId);
    }),

  create: protectedProcedure
    .input(z.object({
      productModelId: z.number(),
      machineId: z.number(),
      priority: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return db.createProductMachineMapping(input);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      priority: z.number().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateProductMachineMapping(id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductMachineMapping(input.id);
      return { success: true };
    }),
});

// ============ SHIFT CONFIG ROUTER ============
const shiftConfigRouter = router({
  list: protectedProcedure
    .input(z.object({ factoryId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.getShiftConfigs(input?.factoryId);
    }),

  defaults: protectedProcedure
    .query(async () => {
      return db.getDefaultShiftConfigs();
    }),

  create: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      name: z.string(),
      code: z.string(),
      startHour: z.number().min(0).max(23),
      startMinute: z.number().min(0).max(59).optional(),
      endHour: z.number().min(0).max(23),
      endMinute: z.number().min(0).max(59).optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return db.createShiftConfig(input);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      code: z.string().optional(),
      startHour: z.number().min(0).max(23).optional(),
      startMinute: z.number().min(0).max(59).optional(),
      endHour: z.number().min(0).max(23).optional(),
      endMinute: z.number().min(0).max(59).optional(),
      isActive: z.boolean().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateShiftConfig(id, data);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteShiftConfig(input.id);
      return { success: true };
    }),
});

// ============ USER ROUTER ============
const userRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
    }
    return db.getAllUsers();
  }),

  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const user = await db.getUserById(input.id);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy người dùng' });
      }
      // Don't return passwordHash
      const { passwordHash, ...safeUser } = user;
      return safeUser;
    }),

  search: adminProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ input }) => {
      const users = await db.searchUsers(input.query);
      return users.map(u => {
        const { passwordHash, ...safeUser } = u;
        return safeUser;
      });
    }),

  create: adminProcedure
    .input(z.object({
      username: z.string().min(3).max(100),
      password: z.string().min(6).max(100),
      name: z.string().min(1).max(255),
      email: z.string().email().optional(),
      phone: z.string().max(20).optional(),
      department: z.string().max(100).optional(),
      position: z.string().max(100).optional(),
      role: z.enum(['user', 'admin']).default('user'),
    }))
    .mutation(async ({ input }) => {
      // Check if username already exists
      const existing = await db.getUserByUsername(input.username);
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Tên đăng nhập đã tồn tại' });
      }
      
      // Hash password
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(input.password, 10);
      
      const { password, ...userData } = input;
      const result = await db.createLocalUser({
        ...userData,
        passwordHash,
      });
      
      return { success: true, id: result.id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional().nullable(),
      phone: z.string().max(20).optional().nullable(),
      department: z.string().max(100).optional().nullable(),
      position: z.string().max(100).optional().nullable(),
      role: z.enum(['user', 'admin']).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...inputData } = input;
      
      // Prevent admin from deactivating themselves
      if (id === ctx.user.id && inputData.isActive === false) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể vô hiệu hóa tài khoản của chính mình' });
      }
      
      // Prevent admin from changing their own role
      if (id === ctx.user.id && inputData.role && inputData.role !== ctx.user.role) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Không thể thay đổi vai trò của chính mình' });
      }
      
      // Convert null to undefined for db.updateUser
      const data: Parameters<typeof db.updateUser>[1] = {
        name: inputData.name,
        email: inputData.email ?? undefined,
        phone: inputData.phone ?? undefined,
        department: inputData.department ?? undefined,
        position: inputData.position ?? undefined,
        role: inputData.role,
        isActive: inputData.isActive,
      };
      
      await db.updateUser(id, data);
      return { success: true };
    }),

  updatePassword: adminProcedure
    .input(z.object({
      id: z.number(),
      newPassword: z.string().min(6).max(100),
    }))
    .mutation(async ({ input }) => {
      const user = await db.getUserById(input.id);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy người dùng' });
      }
      
      // Only local users can have password changed
      if (user.loginMethod !== 'local') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ có thể đổi mật khẩu cho tài khoản nội bộ' });
      }
      
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(input.newPassword, 10);
      await db.updateUserPassword(input.id, passwordHash);
      
      return { success: true };
    }),

  updateRole: protectedProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(['user', 'admin']),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot change your own role' });
      }
      await db.updateUserRole(input.userId, input.role);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({
      userId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot delete yourself' });
      }
      await db.deleteUser(input.userId);
      return { success: true };
    }),

  // User self-service: update own profile
  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255).optional(),
      email: z.string().email().optional(),
      phone: z.string().max(20).optional(),
      department: z.string().max(100).optional(),
      position: z.string().max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.updateUser(ctx.user.id, input);
      return { success: true };
    }),

  // User self-service: change own password
  changePassword: protectedProcedure
    .input(z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(6).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.getUserById(ctx.user.id);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy người dùng' });
      }
      
      // Only local users can change password
      if (user.loginMethod !== 'local' || !user.passwordHash) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chỉ tài khoản nội bộ mới có thể đổi mật khẩu' });
      }
      
      // Verify current password
      const bcrypt = await import('bcryptjs');
      const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mật khẩu hiện tại không đúng' });
      }
      
      // Hash and save new password
      const newPasswordHash = await bcrypt.hash(input.newPassword, 10);
      await db.updateUserPassword(ctx.user.id, newPasswordHash);
      
      return { success: true };
    }),

  // 2FA Setup - Generate secret and QR code
  setup2FA: protectedProcedure
    .mutation(async ({ ctx }) => {
      const { OTP } = await import('otplib');
      const QRCode = await import('qrcode');
      
      // Create OTP instance
      const otp = new OTP({ strategy: 'totp' });
      
      // Generate secret
      const secret = otp.generateSecret();
      
      // Save secret to database (not enabled yet)
      await db.setup2FA(ctx.user.id, secret);
      
      // Generate QR code URL
      const user = await db.getUserById(ctx.user.id);
      const appName = 'AVI-AOI-Management';
      const accountName = user?.username || user?.email || `user_${ctx.user.id}`;
      const otpauth = otp.generateURI({
        issuer: appName,
        label: accountName,
        secret: secret,
      });
      
      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(otpauth);
      
      return {
        secret,
        qrCode: qrCodeDataUrl,
        otpauth,
      };
    }),

  // 2FA Verify and Enable
  verify2FA: protectedProcedure
    .input(z.object({
      token: z.string().length(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const { OTP } = await import('otplib');
      
      // Get user's 2FA secret
      const status = await db.get2FAStatus(ctx.user.id);
      if (!status?.twoFactorSecret) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Chưa thiết lập 2FA. Vui lòng thiết lập trước.' });
      }
      
      // Verify token
      const otp = new OTP({ strategy: 'totp' });
      const result = await otp.verify({
        token: input.token,
        secret: status.twoFactorSecret,
      });
      
      if (!result.valid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mã xác thực không hợp lệ' });
      }
      
      // Enable 2FA
      await db.enable2FA(ctx.user.id);
      
      return { success: true };
    }),

  // 2FA Disable
  disable2FA: protectedProcedure
    .input(z.object({
      token: z.string().length(6),
      password: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const { OTP } = await import('otplib');
      const bcrypt = await import('bcryptjs');
      
      // Get user
      const user = await db.getUserById(ctx.user.id);
      if (!user) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Không tìm thấy người dùng' });
      }
      
      // Verify password for local users
      if (user.loginMethod === 'local' && user.passwordHash) {
        const isValidPassword = await bcrypt.compare(input.password, user.passwordHash);
        if (!isValidPassword) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mật khẩu không đúng' });
        }
      }
      
      // Get 2FA status
      const status = await db.get2FAStatus(ctx.user.id);
      if (!status?.twoFactorEnabled || !status.twoFactorSecret) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '2FA chưa được bật' });
      }
      
      // Verify token
      const otp = new OTP({ strategy: 'totp' });
      const result = await otp.verify({
        token: input.token,
        secret: status.twoFactorSecret,
      });
      
      if (!result.valid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mã xác thực không hợp lệ' });
      }
      
      // Disable 2FA
      await db.disable2FA(ctx.user.id);
      
      return { success: true };
    }),

  // Get 2FA status
  get2FAStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const status = await db.get2FAStatus(ctx.user.id);
      return {
        enabled: status?.twoFactorEnabled || false,
        hasSecret: !!status?.twoFactorSecret,
      };
    }),

  // Generate backup codes
  generateBackupCodes: protectedProcedure
    .mutation(async ({ ctx }) => {
      const crypto = await import('crypto');
      
      // Generate 10 backup codes
      const codes: string[] = [];
      for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push(code);
      }
      
      await db.generateBackupCodes(ctx.user.id, codes);
      
      return { codes };
    }),

  // Get backup codes status
  getBackupCodesStatus: protectedProcedure
    .query(async ({ ctx }) => {
      const count = await db.getUnusedBackupCodesCount(ctx.user.id);
      return { unusedCount: count };
    }),

  // Get user sessions
  getSessions: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserSessions(ctx.user.id);
    }),

  // Revoke a session
  revokeSession: protectedProcedure
    .input(z.object({
      sessionId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.revokeSession(input.sessionId, ctx.user.id);
      return { success: true };
    }),

  // Revoke all other sessions
  revokeAllSessions: protectedProcedure
    .input(z.object({
      exceptCurrentSession: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // TODO: Get current session ID from context if needed
      await db.revokeAllSessions(ctx.user.id);
      return { success: true };
    }),
});

const alertRouter = router({
  list: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getAlertSettings(ctx.user.id);
    }),

  listAll: adminProcedure
    .query(async () => {
      return db.getAlertSettings();
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      // Only owner or admin can view
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      return alert;
    }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      alertType: z.enum(['yield_rate', 'ng_count', 'machine_status']),
      threshold: z.number(),
      comparisonOperator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']).optional(),
      machineId: z.number().optional(),
      factoryId: z.number().optional(),
      notifyEmail: z.boolean().optional(),
      notifySms: z.boolean().optional(),
      notifyInApp: z.boolean().optional(),
      cooldownMinutes: z.number().min(5).max(1440).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createAlertSetting({
        ...input,
        userId: ctx.user.id,
        threshold: String(input.threshold),
      });
      return result;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      threshold: z.number().optional(),
      comparisonOperator: z.enum(['lt', 'lte', 'gt', 'gte', 'eq']).optional(),
      isActive: z.boolean().optional(),
      notifyEmail: z.boolean().optional(),
      notifySms: z.boolean().optional(),
      notifyInApp: z.boolean().optional(),
      cooldownMinutes: z.number().min(5).max(1440).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      const { id, threshold, ...updateData } = input;
      await db.updateAlertSetting(id, {
        ...updateData,
        ...(threshold !== undefined ? { threshold: String(threshold) } : {}),
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }
      await db.deleteAlertSetting(input.id);
      return { success: true };
    }),

  history: protectedProcedure
    .input(z.object({
      alertSettingId: z.number().optional(),
      limit: z.number().min(1).max(100).optional(),
    }))
    .query(async ({ input }) => {
      return db.getAlertHistory(input.alertSettingId, input.limit);
    }),

  // Cursor-based pagination for alert history
  historyCursor: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().min(1).max(200).optional(),
      direction: z.enum(['forward', 'backward']).optional(),
      alertSettingId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getAlertHistoryCursor(input);
    }),

  acknowledge: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      await db.acknowledgeAlert(input.id, ctx.user.id);
      return { success: true };
    }),

  // Test alert - send a test notification
  test: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const alert = await db.getAlertSettingById(input.id);
      if (!alert) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Alert setting not found' });
      }
      if (alert.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
      }

      // Send test notification to owner
      const { notifyOwner } = await import('./_core/notification');
      const success = await notifyOwner({
        title: `[Đang kiểm tra] ${alert.name}`,
        content: `Đây là thông báo kiểm tra cho cảnh báo "${alert.name}".\n\nLoại: ${alert.alertType}\nNgưỡng: ${alert.threshold}%`,
      });

      if (success) {
        // Log to history
        await db.createAlertHistory({
          alertSettingId: alert.id,
          triggeredValue: alert.threshold,
          message: `[TEST] Kiểm tra cảnh báo "${alert.name}"`,
          sentEmail: alert.notifyEmail,
          sentInApp: alert.notifyInApp,
        });
      }

      return { success };
    }),
});

// ============ PRODUCTION ORDER ROUTER ============
const productionOrderRouter = router({
  list: protectedProcedure
    .input(z.object({
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      status: z.string().optional(),
      companyCode: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductionOrders(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductionOrderById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ orderCode: z.string() }))
    .query(async ({ input }) => {
      return db.getProductionOrderByCode(input.orderCode);
    }),

  create: adminProcedure
    .input(z.object({
      orderCode: z.string().min(1).max(100),
      companyCode: z.string().min(1).max(50),
      factoryId: z.number(),
      workshopId: z.number(),
      lineId: z.number(),
      productModelId: z.number(),
      targetQuantity: z.number().min(1),
      priority: z.number().optional(),
      plannedStartDate: z.date().optional(),
      plannedEndDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createProductionOrder({
        ...input,
        createdBy: ctx.user.id,
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      orderCode: z.string().min(1).max(100).optional(),
      companyCode: z.string().min(1).max(50).optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      productModelId: z.number().optional(),
      targetQuantity: z.number().min(1).optional(),
      status: z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'paused']).optional(),
      priority: z.number().optional(),
      plannedStartDate: z.date().optional(),
      plannedEndDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateProductionOrder(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductionOrder(input.id);
      return { success: true };
    }),

  // Reschedule production order (drag-drop from Gantt chart)
  // Check for schedule overlap
  checkScheduleOverlap: protectedProcedure
    .input(z.object({
      lineId: z.number(),
      startDate: z.date(),
      endDate: z.date(),
      excludeOrderId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const orders = await db.getProductionOrders({ lineId: input.lineId });
      
      const overlappingOrders = orders.filter(order => {
        // Skip the order being rescheduled
        if (input.excludeOrderId && order.id === input.excludeOrderId) {
          return false;
        }
        
        // Skip cancelled orders
        if (order.status === 'cancelled') {
          return false;
        }
        
        // Check for date overlap
        const orderStart = order.plannedStartDate ? new Date(order.plannedStartDate) : null;
        const orderEnd = order.plannedEndDate ? new Date(order.plannedEndDate) : null;
        
        if (!orderStart || !orderEnd) {
          return false;
        }
        
        // Overlap exists if: newStart < existingEnd AND newEnd > existingStart
        return input.startDate < orderEnd && input.endDate > orderStart;
      });
      
      return {
        hasOverlap: overlappingOrders.length > 0,
        overlappingOrders: overlappingOrders.map(o => ({
          id: o.id,
          orderCode: o.orderCode,
          plannedStartDate: o.plannedStartDate,
          plannedEndDate: o.plannedEndDate,
          status: o.status,
        })),
      };
    }),

  reschedule: adminProcedure
    .input(z.object({
      id: z.number(),
      scheduledStartDate: z.date(),
      scheduledEndDate: z.date(),
      lineId: z.number().optional(),
      forceOverride: z.boolean().optional(), // Allow override overlap
    }))
    .mutation(async ({ input, ctx }) => {
      const order = await db.getProductionOrderById(input.id);
      if (!order) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Production order not found' });
      }

      const targetLineId = input.lineId || order.lineId;

      // Get line info for capacity check
      const lines = await db.getProductionLines();
      const targetLine = lines.find(l => l.id === targetLineId);
      if (!targetLine) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Production line not found' });
      }

      // Check for overlap unless force override is set
      if (!input.forceOverride) {
        const orders = await db.getProductionOrders({ lineId: targetLineId });
        
        const overlappingOrders = orders.filter(o => {
          if (o.id === input.id || o.status === 'cancelled') return false;
          
          const oStart = o.plannedStartDate ? new Date(o.plannedStartDate) : null;
          const oEnd = o.plannedEndDate ? new Date(o.plannedEndDate) : null;
          
          if (!oStart || !oEnd) return false;
          
          return input.scheduledStartDate < oEnd && input.scheduledEndDate > oStart;
        });
        
        if (overlappingOrders.length > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Lịch trùng với ${overlappingOrders.length} lệnh sản xuất khác: ${overlappingOrders.map(o => o.orderCode).join(', ')}. Sử dụng forceOverride=true để bỏ qua.`,
          });
        }

        // Capacity validation - check max concurrent orders
        const maxConcurrent = targetLine.maxConcurrentOrders || 1;
        const concurrentOrders = orders.filter(o => {
          if (o.id === input.id || o.status === 'cancelled' || o.status === 'completed') return false;
          
          const oStart = o.plannedStartDate ? new Date(o.plannedStartDate) : null;
          const oEnd = o.plannedEndDate ? new Date(o.plannedEndDate) : null;
          
          if (!oStart || !oEnd) return false;
          
          // Check if order overlaps with new schedule
          return input.scheduledStartDate < oEnd && input.scheduledEndDate > oStart;
        });

        if (concurrentOrders.length >= maxConcurrent) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: `Dây chuyền ${targetLine.name} chỉ hỗ trợ tối đa ${maxConcurrent} lệnh cùng lúc. Hiện đã có ${concurrentOrders.length} lệnh trong khoảng thời gian này. Sử dụng forceOverride=true để bỏ qua.`,
          });
        }

        // Capacity validation - check production capacity
        if (targetLine.capacityPerHour && order.targetQuantity) {
          const durationHours = (input.scheduledEndDate.getTime() - input.scheduledStartDate.getTime()) / (1000 * 60 * 60);
          const maxCapacity = targetLine.capacityPerHour * durationHours;
          
          if (order.targetQuantity > maxCapacity) {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: `Số lượng ${order.targetQuantity} vượt quá năng lực dây chuyền (${Math.floor(maxCapacity)} sản phẩm trong ${durationHours.toFixed(1)} giờ với ${targetLine.capacityPerHour} sp/giờ). Sử dụng forceOverride=true để bỏ qua.`,
            });
          }
        }
      }

      const updateData: Record<string, unknown> = {
        plannedStartDate: input.scheduledStartDate,
        plannedEndDate: input.scheduledEndDate,
      };

      // If line changed, also update workshopId from the new line
      if (input.lineId && input.lineId !== order.lineId) {
        const newLine = lines.find(l => l.id === input.lineId);
        if (!newLine) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Production line not found' });
        }
        updateData.lineId = input.lineId;
        updateData.workshopId = newLine.workshopId;
      }

      await db.updateProductionOrder(input.id, updateData);

      // Log the reschedule action
      await db.createAuditLog({
        userId: ctx.user.id,
        action: 'reschedule_production_order',
        entityType: 'production_order',
        entityId: input.id,
        entityName: order.orderCode,
        details: {
          oldStartDate: order.plannedStartDate,
          oldEndDate: order.plannedEndDate,
          oldLineId: order.lineId,
          newStartDate: input.scheduledStartDate,
          newEndDate: input.scheduledEndDate,
          newLineId: input.lineId || order.lineId,
          forceOverride: input.forceOverride || false,
        },
      });

      return { success: true };
    }),

  // Order Templates
  listTemplates: protectedProcedure
    .input(z.object({ factoryId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.listOrderTemplates(input?.factoryId);
    }),

  getTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getOrderTemplate(input.id);
    }),

  createTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      productModelId: z.number().optional(),
      defaultTargetQuantity: z.number().default(1000),
      defaultPriority: z.number().default(0),
      defaultNotes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createOrderTemplate({ ...input, createdBy: ctx.user.id });
    }),

  updateTemplate: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      productModelId: z.number().optional(),
      defaultTargetQuantity: z.number().optional(),
      defaultPriority: z.number().optional(),
      defaultNotes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateOrderTemplate(id, data);
      return { success: true };
    }),

  deleteTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteOrderTemplate(input.id);
      return { success: true };
    }),

  createFromTemplate: protectedProcedure
    .input(z.object({
      templateId: z.number(),
      orderCode: z.string().min(1),
      lineId: z.number(),
      targetQuantity: z.number().optional(),
      priority: z.number().optional(),
      notes: z.string().optional(),
      scheduledStartDate: z.date().optional(),
      scheduledEndDate: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const template = await db.getOrderTemplate(input.templateId);
      if (!template) throw new Error('Template not found');

      const orderData = {
        orderCode: input.orderCode,
        companyCode: 'DEFAULT',
        factoryId: template.factoryId || 1,
        workshopId: template.workshopId || 1,
        lineId: input.lineId,
        productModelId: template.productModelId || 1,
        targetQuantity: input.targetQuantity || template.defaultTargetQuantity,
        priority: input.priority ?? template.defaultPriority,
        notes: input.notes || template.defaultNotes,
        plannedStartDate: input.scheduledStartDate,
        plannedEndDate: input.scheduledEndDate,
        status: 'pending' as const,
      };

      const id = await db.createProductionOrder(orderData);
      return { id };
    }),

  // WIP Tracking
  getWIPStatus: protectedProcedure
    .input(z.object({ factoryId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.getWIPStatus(input?.factoryId);
    }),

  getWIPByLine: protectedProcedure
    .input(z.object({ lineId: z.number() }))
    .query(async ({ input }) => {
      return db.getWIPByLine(input.lineId);
    }),

  // Scheduling Optimization
  optimizeSchedule: protectedProcedure
    .input(z.object({ factoryId: z.number() }))
    .mutation(async ({ input }) => {
      return db.optimizeSchedule(input.factoryId);
    }),

  applyScheduleSuggestion: adminProcedure
    .input(z.object({
      orderId: z.number(),
      suggestedLineId: z.number(),
      suggestedStartDate: z.date(),
      suggestedEndDate: z.date(),
      reason: z.string(),
      score: z.number(),
    }))
    .mutation(async ({ input }) => {
      await db.applyScheduleSuggestion(input);
      return { success: true };
    }),
});

// ============ LINE STAGE ROUTER ============
const lineStageRouter = router({
  list: protectedProcedure
    .input(z.object({ lineId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      return db.getLineStages(input?.lineId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getLineStageById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      lineId: z.number(),
      code: z.string().min(1).max(20),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
      stationId: z.number().optional(),
      cycleTimeTarget: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createLineStage(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(20).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      orderIndex: z.number().optional(),
      stationId: z.number().optional(),
      cycleTimeTarget: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateLineStage(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteLineStage(input.id);
      return { success: true };
    }),

  reorder: adminProcedure
    .input(z.object({
      lineId: z.number(),
      stageIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      await db.reorderLineStages(input.lineId, input.stageIds);
      return { success: true };
    }),
});

// ============ LINE PRODUCT ASSIGNMENT ROUTER ============
const lineProductAssignmentRouter = router({
  list: protectedProcedure
    .input(z.object({
      lineId: z.number().optional(),
      productModelId: z.number().optional(),
      productionOrderId: z.number().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getLineProductAssignments(input);
    }),

  create: adminProcedure
    .input(z.object({
      lineId: z.number(),
      productModelId: z.number(),
      productionOrderId: z.number().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createLineProductAssignment(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      lineId: z.number().optional(),
      productModelId: z.number().optional(),
      productionOrderId: z.number().optional(),
      isActive: z.boolean().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateLineProductAssignment(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteLineProductAssignment(input.id);
      return { success: true };
    }),
});

// ============ MACHINE STATUS ROUTER ============
const machineStatusRouter = router({
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
const templateRouter = router({
  list: protectedProcedure.query(async () => {
    const { listTemplates } = await import("./templateDb");
    return listTemplates();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const { getTemplateById } = await import("./templateDb");
      return getTemplateById(input.id);
    }),

  getByCategory: protectedProcedure
    .input(z.object({ category: z.string() }))
    .query(async ({ input }) => {
      const { getTemplatesByCategory } = await import("./templateDb");
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
      const { createTemplate } = await import("./templateDb");
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
      const { updateTemplate } = await import("./templateDb");
      const { id, ...data } = input;
      return updateTemplate(id, data);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { deleteTemplate } = await import("./templateDb");
      return deleteTemplate(input.id);
    }),

  clone: adminProcedure
    .input(z.object({
      id: z.number(),
      newCode: z.string().min(1).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      const { cloneTemplate } = await import("./templateDb");
      return cloneTemplate(input.id, input.newCode, ctx.user.id);
    }),
});

// ============ BULK IMPORT ROUTER ============
const bulkImportRouter = router({
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
const manualMappingRouter = router({
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
        const { testManualConnection } = await import('./_core/socket');
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

// ============ MQTT CLIENT ROUTER ============
const mqttClientRouter = router({
  // List all MQTT clients with optional filters
  list: protectedProcedure
    .input(z.object({
      approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
      connectionStatus: z.enum(['ONLINE', 'OFFLINE', 'DISCONNECTED']).optional(),
      stationId: z.number().optional(),
      mappingType: z.enum(['AUTO', 'MANUAL']).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getMqttClients(input);
    }),

  // Get single client by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMqttClientById(input.id);
    }),

  // Get pending approval count
  pendingCount: protectedProcedure.query(async () => {
    const clients = await db.getMqttClients({ approvalStatus: 'PENDING' });
    return { count: clients.length };
  }),

  // Approve client registration
  approve: adminProcedure
    .input(z.object({
      id: z.number(),
      stationId: z.number().optional(),
      mappingType: z.enum(['AUTO', 'MANUAL']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.approveMqttClient(input.id, ctx.user.id, input.stationId, input.mappingType);
      return { success: true };
    }),

  // Reject client registration
  reject: adminProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await db.rejectMqttClient(input.id, input.reason);
      return { success: true };
    }),

  // Update client mapping (station assignment)
  updateMapping: adminProcedure
    .input(z.object({
      id: z.number(),
      stationId: z.number().nullable(),
      processId: z.number().nullable().optional(),
      mappingType: z.enum(['AUTO', 'MANUAL']).optional(),
      autoReconnect: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMqttClientMapping(id, data);
      return { success: true };
    }),

  // Update client settings
  updateSettings: adminProcedure
    .input(z.object({
      id: z.number(),
      deviceName: z.string().optional(),
      receiveNGAlerts: z.boolean().optional(),
      receiveDailySummary: z.boolean().optional(),
      receiveWeeklySummary: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMqttClientSettings(id, data);
      return { success: true };
    }),

  // Delete client
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMqttClient(input.id);
      return { success: true };
    }),

  // Disconnect and reset mapping
  disconnectAndReset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.disconnectAndResetMqttClient(input.id);
      return { success: true };
    }),

  // Get MQTT status
  status: protectedProcedure.query(async () => {
    const { isMqttRunning, getConnectedClientsCount, getExternalMqttInfo } = await import('./services/mqttService');
    return {
      enabled: isMqttRunning(),
      connectedClients: getConnectedClientsCount(),
      external: getExternalMqttInfo(),
    };
  }),

  // Get error summaries
  errorSummaries: protectedProcedure
    .input(z.object({
      stationId: z.number().optional(),
      summaryType: z.enum(['DAILY', 'WEEKLY']).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ input }) => {
      return db.getMqttErrorSummaries(input);
    }),

  // Get message logs
  messageLogs: protectedProcedure
    .input(z.object({
      clientId: z.number().optional(),
      stationId: z.number().optional(),
      messageType: z.enum(['NG_ALERT', 'DAILY_SUMMARY', 'WEEKLY_SUMMARY', 'CUSTOM']).optional(),
      limit: z.number().default(100),
    }).optional())
    .query(async ({ input }) => {
      return db.getMqttMessageLogs(input);
    }),

  // Manually trigger summary (for testing)
  triggerSummary: adminProcedure
    .input(z.object({
      type: z.enum(['DAILY', 'WEEKLY']),
    }))
    .mutation(async ({ input }) => {
      const { triggerDailySummary, triggerWeeklySummary } = await import('./services/mqttSummaryScheduler');
      if (input.type === 'DAILY') {
        await triggerDailySummary();
      } else {
        await triggerWeeklySummary();
      }
      return { success: true };
    }),

  // Dashboard statistics
  dashboardStats: protectedProcedure.query(async () => {
    return db.getMqttDashboardStats();
  }),

  // Message trend for charts
  messageTrend: protectedProcedure
    .input(z.object({ days: z.number().default(7) }).optional())
    .query(async ({ input }) => {
      return db.getMqttMessageTrend(input?.days || 7);
    }),

  // Recent messages for activity feed
  recentMessages: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }).optional())
    .query(async ({ input }) => {
      return db.getRecentMqttMessages(input?.limit || 20);
    }),

  // Update FCM token for push notifications
  updateFcmToken: protectedProcedure
    .input(z.object({
      clientId: z.number(),
      fcmToken: z.string(),
    }))
    .mutation(async ({ input }) => {
      await db.updateMqttClientFcmToken(input.clientId, input.fcmToken);
      return { success: true };
    }),

  // Test NG Alert - Simulate NG inspection for testing MQTT publish
  testNGAlert: protectedProcedure
    .input(z.object({
      machineName: z.string().optional(),
      machineId: z.number().optional(),
      stationId: z.number().optional(),
      serialNumber: z.string().optional(),
      ngPointName: z.string().optional(),
      ngValue: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { publishNGAlert, publishToExternalMqtt, isMqttRunning } = await import('./services/mqttService');
      
      // Get a real station from database if not provided
      let stationId = input.stationId;
      if (!stationId) {
        const stationList = await db.getStations();
        if (stationList.length > 0) {
          stationId = stationList[0].id;
        } else {
          stationId = 1; // Fallback
        }
      }
      
      const testData = {
        machineId: input.machineId || 1,
        machineName: input.machineName || 'Test Machine',
        machineCode: 'TEST',
        stationId,
        stationName: 'Test Station',
        serialNumber: input.serialNumber || `SN-${Date.now()}`,
        inspectionId: Date.now(),
        timestamp: new Date(),
        measurementResults: [{
          pointCode: input.ngPointName || 'Test Point',
          result: 'NG' as const,
          value: input.ngValue || 0.5,
        }],
      };
      
      // Publish to local broker
      const localResult = await publishNGAlert(testData);
      
      // Also publish to external broker
      const externalTopic = `avi-aoi/factory/1/station/${stationId}/ng-alert`;
      const externalPayload = JSON.stringify({
        type: 'NG_ALERT_TEST',
        ...testData,
        timestamp: testData.timestamp.toISOString(),
      });
      publishToExternalMqtt(externalTopic, externalPayload);
      
      return { 
        success: true, 
        message: `NG Alert published (Local: ${localResult ? 'OK' : 'Failed'}, External: sent)`,
        data: testData,
        mqttEnabled: isMqttRunning(),
      };
    }),

  // Realtime MQTT statistics for monitoring dashboard
  realtimeStats: protectedProcedure.query(async () => {
    const { getExternalMqttInfo, isMqttRunning } = await import('./services/mqttService');
    
    // Get message stats from last hour for throughput calculation
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    
    // Get message counts
    const [hourlyStats, fiveMinStats, oneMinStats] = await Promise.all([
      db.getMqttMessageCountSince(oneHourAgo),
      db.getMqttMessageCountSince(fiveMinAgo),
      db.getMqttMessageCountSince(oneMinAgo),
    ]);
    
    // Calculate throughput (messages per minute)
    const throughputPerHour = hourlyStats.total / 60;
    const throughputPer5Min = fiveMinStats.total / 5;
    const throughputPerMin = oneMinStats.total;
    
    // Get latency stats
    const latencyStats = await db.getMqttLatencyStats();
    
    // Get external MQTT info
    const externalInfo = getExternalMqttInfo();
    
    return {
      localBroker: {
        enabled: isMqttRunning(),
        port: 1883,
      },
      externalBroker: {
        enabled: externalInfo.enabled,
        broker: externalInfo.broker,
        port: externalInfo.port,
        connected: externalInfo.connected,
        useTLS: externalInfo.useTLS,
        hasCredentials: externalInfo.hasCredentials,
      },
      throughput: {
        lastMinute: throughputPerMin,
        last5Minutes: Math.round(throughputPer5Min * 100) / 100,
        lastHour: Math.round(throughputPerHour * 100) / 100,
      },
      latency: {
        avgMs: latencyStats.avgMs || 0,
        minMs: latencyStats.minMs || 0,
        maxMs: latencyStats.maxMs || 0,
        p95Ms: latencyStats.p95Ms || 0,
      },
      messages: {
        lastMinute: oneMinStats,
        last5Minutes: fiveMinStats,
        lastHour: hourlyStats,
      },
      timestamp: new Date(),
    };
  }),

  // Throughput history for line chart (last 60 minutes by default)
  throughputHistory: protectedProcedure
    .input(z.object({ minutes: z.number().default(60) }).optional())
    .query(async ({ input }) => {
      return db.getMqttThroughputHistory(input?.minutes || 60);
    }),

  // ============ MQTT MESSAGE REPLAY ============
  messageHistory: protectedProcedure
    .input(z.object({
      topic: z.string().optional(),
      machineCode: z.string().optional(),
      startTime: z.date().optional(),
      endTime: z.date().optional(),
      limit: z.number().default(100),
    }))
    .query(async ({ input }) => {
      const { getMqttMessageHistory } = await import('./_core/socket');
      return getMqttMessageHistory(input);
    }),

  // ============ MACHINE AUTO-DISCOVERY ============
  discoveredMachines: protectedProcedure.query(async () => {
    const { getDiscoveredMachines } = await import('./_core/socket');
    return getDiscoveredMachines();
  }),

  // ============ OEE CALCULATION ============
  calculateOEE: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      machineCode: z.string(),
      plannedTime: z.number(), // minutes
      runTime: z.number(), // minutes
      idealCycleTime: z.number(), // seconds per unit
      totalCount: z.number(),
      goodCount: z.number(),
    }))
    .mutation(async ({ input }) => {
      const { calculateOEE } = await import('./_core/socket');
      return calculateOEE(input.machineId, input.machineCode, {
        plannedTime: input.plannedTime,
        runTime: input.runTime,
        idealCycleTime: input.idealCycleTime,
        totalCount: input.totalCount,
        goodCount: input.goodCount,
      });
    }),

  getMachineOEE: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      const { getMachineOEE } = await import('./_core/socket');
      return getMachineOEE(input.machineId);
    }),

  getAllOEE: protectedProcedure.query(async () => {
    const { getAllMachinesOEE } = await import('./_core/socket');
    return getAllMachinesOEE();
  }),

  // ============ DOWNTIME TRACKING ============
  startDowntime: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      machineCode: z.string(),
      category: z.enum(['planned', 'unplanned', 'breakdown', 'changeover', 'maintenance', 'other']),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { startDowntime } = await import('./_core/socket');
      return startDowntime(input.machineId, input.machineCode, input.category, input.reason, ctx.user?.name ?? undefined);
    }),

  endDowntime: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { endDowntime } = await import('./_core/socket');
      return endDowntime(input.machineId, input.notes);
    }),

  getActiveDowntime: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      const { getActiveDowntime } = await import('./_core/socket');
      return getActiveDowntime(input.machineId);
    }),

  getDowntimeHistory: protectedProcedure
    .input(z.object({
      machineId: z.number().optional(),
      category: z.enum(['planned', 'unplanned', 'breakdown', 'changeover', 'maintenance', 'other']).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const { getDowntimeHistory } = await import('./_core/socket');
      return getDowntimeHistory(input);
    }),

  // ============ PREDICTIVE MAINTENANCE ============
  calculateMachineHealth: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      machineCode: z.string(),
      oee: z.number().optional(),
      uptime: z.number().optional(),
      errorRate: z.number().optional(),
      cycleTimeVariance: z.number().optional(),
      downtimeFrequency: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { calculateMachineHealth } = await import('./_core/socket');
      return calculateMachineHealth(input.machineId, input.machineCode, {
        oee: input.oee,
        uptime: input.uptime,
        errorRate: input.errorRate,
        cycleTimeVariance: input.cycleTimeVariance,
        downtimeFrequency: input.downtimeFrequency,
      });
    }),

  getMachineHealth: protectedProcedure
    .input(z.object({ machineId: z.number() }))
    .query(async ({ input }) => {
      const { getMachineHealthScore } = await import('./_core/socket');
      return getMachineHealthScore(input.machineId);
    }),

  // ============ MACHINE BENCHMARKING ============
  calculateBenchmarks: protectedProcedure
    .input(z.object({
      machines: z.array(z.object({
        machineId: z.number(),
        machineCode: z.string(),
        lineId: z.number(),
        oee: z.number(),
        yield: z.number(),
        cycleTime: z.number(),
        output: z.number(),
        downtime: z.number(),
        errors: z.number(),
      })),
      startDate: z.date(),
      endDate: z.date(),
    }))
    .mutation(async ({ input }) => {
      const { calculateLineBenchmarks } = await import('./_core/socket');
      return calculateLineBenchmarks(input.machines, { start: input.startDate, end: input.endDate });
    }),
});

// MQTT Alert Rules Router
const mqttAlertRouter = router({
  // List all alert rules
  list: protectedProcedure.query(async () => {
    return db.getMqttAlertRules();
  }),

  // Get single rule by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getMqttAlertRuleById(input.id);
    }),

  // Create new alert rule
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      ruleType: z.enum(['LATENCY_THRESHOLD', 'BROKER_DISCONNECT', 'MESSAGE_FAILURE_RATE', 'THROUGHPUT_LOW', 'THROUGHPUT_HIGH', 'CLIENT_OFFLINE']),
      thresholdValue: z.number(),
      thresholdUnit: z.string().default('ms'),
      comparisonOperator: z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ']).default('GT'),
      timeWindowMinutes: z.number().default(5),
      notifyOwner: z.boolean().default(true),
      notifyEmail: z.boolean().default(false),
      notifyMqtt: z.boolean().default(false),
      cooldownMinutes: z.number().default(15),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createMqttAlertRule({
        ...input,
        thresholdValue: String(input.thresholdValue),
        createdBy: ctx.user?.id,
      });
      return result;
    }),

  // Update alert rule
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().optional(),
      description: z.string().optional(),
      thresholdValue: z.number().optional(),
      thresholdUnit: z.string().optional(),
      comparisonOperator: z.enum(['GT', 'GTE', 'LT', 'LTE', 'EQ']).optional(),
      timeWindowMinutes: z.number().optional(),
      notifyOwner: z.boolean().optional(),
      notifyEmail: z.boolean().optional(),
      notifyMqtt: z.boolean().optional(),
      cooldownMinutes: z.number().optional(),
      isEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, thresholdValue, ...rest } = input;
      await db.updateMqttAlertRule(id, {
        ...rest,
        ...(thresholdValue !== undefined ? { thresholdValue: String(thresholdValue) } : {}),
      });
      return { success: true };
    }),

  // Delete alert rule
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMqttAlertRule(input.id);
      return { success: true };
    }),

  // Toggle enable/disable
  toggle: protectedProcedure
    .input(z.object({ id: z.number(), isEnabled: z.boolean() }))
    .mutation(async ({ input }) => {
      await db.updateMqttAlertRule(input.id, { isEnabled: input.isEnabled });
      return { success: true };
    }),

  // Get alert history
  history: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }).optional())
    .query(async ({ input }) => {
      return db.getMqttAlertHistory(input?.limit || 50);
    }),

  // Get unresolved alerts
  unresolved: protectedProcedure.query(async () => {
    return db.getUnresolvedMqttAlerts();
  }),

  // Resolve an alert
  resolve: protectedProcedure
    .input(z.object({
      id: z.number(),
      note: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
      await db.resolveMqttAlert(input.id, ctx.user.id, input.note);
      return { success: true };
    }),
});

// Yield Alert Threshold Router
const yieldThresholdRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getYieldAlertThresholds();
  }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getYieldAlertThresholdById(input.id);
    }),

  getByType: protectedProcedure
    .input(z.object({ metricType: z.enum(['FPY', 'FY', 'NTF', 'UPH']) }))
    .query(async ({ input }) => {
      return db.getYieldAlertThresholdByType(input.metricType);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      warningThreshold: z.number().optional(),
      criticalThreshold: z.number().optional(),
      targetValue: z.number().optional(),
      comparisonOperator: z.enum(['gt', 'lt', 'gte', 'lte']).optional(),
      isEnabled: z.boolean().optional(),
      notifyOnWarning: z.boolean().optional(),
      notifyOnCritical: z.boolean().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      // Convert numbers to strings for decimal fields
      const updateData: any = {};
      if (data.warningThreshold !== undefined) updateData.warningThreshold = String(data.warningThreshold);
      if (data.criticalThreshold !== undefined) updateData.criticalThreshold = String(data.criticalThreshold);
      if (data.targetValue !== undefined) updateData.targetValue = String(data.targetValue);
      if (data.comparisonOperator !== undefined) updateData.comparisonOperator = data.comparisonOperator;
      if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
      if (data.notifyOnWarning !== undefined) updateData.notifyOnWarning = data.notifyOnWarning;
      if (data.notifyOnCritical !== undefined) updateData.notifyOnCritical = data.notifyOnCritical;
      if (data.description !== undefined) updateData.description = data.description;
      
      await db.updateYieldAlertThreshold(id, updateData);
      return { success: true };
    }),

  getEnabled: protectedProcedure.query(async () => {
    return db.getEnabledYieldAlertThresholds();
  }),

  // History procedures
  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().optional() }))
    .query(async ({ input }) => {
      return db.getAllYieldThresholdHistory(input.limit || 100);
    }),

  getHistoryByType: protectedProcedure
    .input(z.object({ 
      metricType: z.enum(['FPY', 'FY', 'NTF', 'UPH']),
      days: z.number().optional()
    }))
    .query(async ({ input }) => {
      return db.getYieldThresholdHistoryWithComparison(input.metricType, input.days || 30);
    }),

  getHistoryByThreshold: protectedProcedure
    .input(z.object({ thresholdId: z.number() }))
    .query(async ({ input }) => {
      return db.getYieldThresholdHistoryByThreshold(input.thresholdId);
    }),

  // Update with history tracking
  updateWithHistory: protectedProcedure
    .input(z.object({
      id: z.number(),
      warningThreshold: z.number().optional(),
      criticalThreshold: z.number().optional(),
      targetValue: z.number().optional(),
      comparisonOperator: z.enum(['gt', 'lt', 'gte', 'lte']).optional(),
      isEnabled: z.boolean().optional(),
      notifyOnWarning: z.boolean().optional(),
      notifyOnCritical: z.boolean().optional(),
      description: z.string().optional(),
      changeReason: z.string().optional(),
      actualValueAtChange: z.number().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, changeReason, actualValueAtChange, ...data } = input;
      
      // Get current threshold for history
      const current = await db.getYieldAlertThresholdById(id);
      if (!current) throw new Error('Threshold not found');

      // Create history record if thresholds changed
      if (data.warningThreshold !== undefined || data.criticalThreshold !== undefined || data.targetValue !== undefined) {
        await db.createYieldThresholdHistory({
          thresholdId: id,
          metricType: current.metricType,
          previousWarning: current.warningThreshold,
          newWarning: data.warningThreshold !== undefined ? String(data.warningThreshold) : current.warningThreshold,
          previousCritical: current.criticalThreshold,
          newCritical: data.criticalThreshold !== undefined ? String(data.criticalThreshold) : current.criticalThreshold,
          previousTarget: current.targetValue,
          newTarget: data.targetValue !== undefined ? String(data.targetValue) : current.targetValue,
          changeReason: changeReason || null,
          changedBy: ctx.user?.id || null,
          changedByName: ctx.user?.name || null,
          actualValueAtChange: actualValueAtChange !== undefined ? String(actualValueAtChange) : null,
        });
      }

      // Convert numbers to strings for decimal fields
      const updateData: any = {};
      if (data.warningThreshold !== undefined) updateData.warningThreshold = String(data.warningThreshold);
      if (data.criticalThreshold !== undefined) updateData.criticalThreshold = String(data.criticalThreshold);
      if (data.targetValue !== undefined) updateData.targetValue = String(data.targetValue);
      if (data.comparisonOperator !== undefined) updateData.comparisonOperator = data.comparisonOperator;
      if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
      if (data.notifyOnWarning !== undefined) updateData.notifyOnWarning = data.notifyOnWarning;
      if (data.notifyOnCritical !== undefined) updateData.notifyOnCritical = data.notifyOnCritical;
      if (data.description !== undefined) updateData.description = data.description;
      
      await db.updateYieldAlertThreshold(id, updateData);
      return { success: true };
    }),
});

const auditRouter = router({
  list: adminProcedure
    .input(z.object({
      userId: z.number().optional(),
      action: z.string().optional(),
      entityType: z.string().optional(),
      entityId: z.number().optional(),
      status: z.enum(['success', 'failure']).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      return db.getAuditLogs(input);
    }),

  stats: adminProcedure
    .input(z.object({
      days: z.number().min(1).max(90).default(7),
    }))
    .query(async ({ input }) => {
      return db.getAuditLogStats(input.days);
    }),
});

// Workstation Router
const workstationRouter = router({
  list: protectedProcedure
    .input(z.object({
      lineId: z.number().optional(),
      workshopId: z.number().optional(),
      factoryId: z.number().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getWorkstations(input);
    }),

  getById: protectedProcedure
    .input(z.number())
    .query(async ({ input }) => {
      return db.getWorkstationById(input);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      lineId: z.number().optional(),
      workshopId: z.number().optional(),
      factoryId: z.number().optional(),
      processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'OTHER']).optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await db.createWorkstation(input);
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      lineId: z.number().nullable().optional(),
      workshopId: z.number().nullable().optional(),
      factoryId: z.number().nullable().optional(),
      processType: z.enum(['SMT', 'DIP', 'ASSEMBLY', 'TESTING', 'PACKAGING', 'OTHER']).optional(),
      orderIndex: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateWorkstation(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.number())
    .mutation(async ({ input }) => {
      await db.deleteWorkstation(input);
      return { success: true };
    }),

  defectsByWorkstation: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      productModelId: z.number().optional(),
      machineId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getDefectsByWorkstation(input);
    }),

  summary: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getWorkstationSummary(input);
    }),

  topNGMeasurementPoints: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().default(10),
    }).optional())
    .query(async ({ input }) => {
      return db.getTopNGMeasurementPointsByWorkstation(input);
    }),

  measurementPointsByWorkstation: protectedProcedure
    .input(z.object({
      workstationId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.getMeasurementPointsByWorkstation(input);
    }),

  // NG Trend by day
  ngTrend: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      workstationId: z.number().optional(),
      measurementPointDefId: z.number().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getNGTrendByDay(input);
    }),

  // NG Comparison between two periods
  ngComparison: protectedProcedure
    .input(z.object({
      currentStartDate: z.date(),
      currentEndDate: z.date(),
      previousStartDate: z.date(),
      previousEndDate: z.date(),
    }))
    .query(async ({ input }) => {
      return db.getNGComparison(input);
    }),
});

// ============ SCHEDULED REPORT ROUTER ============
import { scheduleReport, stopScheduledReport } from "./services/reportScheduler";

const scheduledReportRouter = router({
  list: protectedProcedure
    .input(z.object({
      isActive: z.boolean().optional(),
      reportType: z.string().optional(),
      schedule: z.string().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getScheduledReports(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getScheduledReportById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      reportType: z.enum(["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM"]).default("NG_VISUAL"),
      schedule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("DAILY"),
      scheduleTime: z.string().default("08:00"),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      recipients: z.array(z.string().email()),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      includeWorkstationHeatmap: z.boolean().default(true),
      includeTopNGPoints: z.boolean().default(true),
      includeTrendChart: z.boolean().default(true),
      includeComparison: z.boolean().default(true),
      isActive: z.boolean().default(true),
      // Customization fields
      reportFormat: z.enum(["HTML", "PDF", "EXCEL"]).default("HTML"),
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createScheduledReport({
        ...input,
        createdBy: ctx.user.id,
      });
      
      // Schedule the report if active
      if (input.isActive) {
        const report = await db.getScheduledReportById(id);
        if (report) {
          scheduleReport({
            id: report.id,
            schedule: report.schedule,
            scheduleTime: report.scheduleTime,
            scheduleDayOfWeek: report.scheduleDayOfWeek,
            scheduleDayOfMonth: report.scheduleDayOfMonth,
          });
        }
      }
      
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      reportType: z.enum(["NG_VISUAL", "DAILY_SUMMARY", "WEEKLY_SUMMARY", "MONTHLY_SUMMARY", "CUSTOM"]).optional(),
      schedule: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
      scheduleTime: z.string().optional(),
      scheduleDayOfWeek: z.number().min(0).max(6).optional(),
      scheduleDayOfMonth: z.number().min(1).max(31).optional(),
      recipients: z.array(z.string().email()).optional(),
      factoryId: z.number().optional(),
      workshopId: z.number().optional(),
      lineId: z.number().optional(),
      includeWorkstationHeatmap: z.boolean().optional(),
      includeTopNGPoints: z.boolean().optional(),
      includeTrendChart: z.boolean().optional(),
      includeComparison: z.boolean().optional(),
      isActive: z.boolean().optional(),
      // Customization fields
      reportFormat: z.enum(["HTML", "PDF", "EXCEL"]).optional(),
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      footerText: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateScheduledReport(id, data);
      
      // Re-schedule if schedule/time changed or isActive changed
      const report = await db.getScheduledReportById(id);
      if (report) {
        if (report.isActive) {
          scheduleReport({
            id: report.id,
            schedule: report.schedule,
            scheduleTime: report.scheduleTime,
            scheduleDayOfWeek: report.scheduleDayOfWeek,
            scheduleDayOfMonth: report.scheduleDayOfMonth,
          });
        } else {
          stopScheduledReport(id);
        }
      }
      
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      // Stop scheduler first
      stopScheduledReport(input.id);
      
      await db.deleteScheduledReport(input.id);
      return { success: true };
    }),

  getLogs: protectedProcedure
    .input(z.object({
      reportId: z.number(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      return db.getScheduledReportLogs(input.reportId, input.limit);
    }),

  sendTest: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const report = await db.getScheduledReportById(input.id);
      if (!report) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      }

      const smtpConfig = await db.getSmtpConfig();
      if (!smtpConfig) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'SMTP config not found. Please configure SMTP first.' });
      }

      try {
        const { generateNGVisualReport, generateNGVisualEmailHTML, generateReport } = await import('./services/reportGenerator');
        const { createTransporterFromConfig } = await import('./_core/email');
        
        // Generate report data
        const reportData = await generateNGVisualReport({
          startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          endDate: new Date(),
          factoryId: report.factoryId ?? undefined,
          workshopId: report.workshopId ?? undefined,
          lineId: report.lineId ?? undefined,
        });

        // Get customization from report
        const customization = {
          logoUrl: (report as any).logoUrl,
          primaryColor: (report as any).primaryColor,
          footerText: (report as any).footerText,
          reportFormat: (report as any).reportFormat || 'HTML',
        };

        // Generate HTML email (always needed for email body)
        const emailHtml = generateNGVisualEmailHTML(reportData, customization);

        // Create email transporter
        const transporter = createTransporterFromConfig(smtpConfig);

        // Prepare email options
        const mailOptions: any = {
          from: `${smtpConfig.fromName} <${smtpConfig.fromEmail}>`,
          to: report.recipients.join(','),
          subject: `[TEST] ${report.name} - NG Visual Report`,
          html: emailHtml,
        };

        // Add attachment if PDF or Excel format
        if (customization.reportFormat === 'PDF' || customization.reportFormat === 'EXCEL') {
          const { content, mimeType, extension } = await generateReport(
            reportData,
            customization.reportFormat,
            customization
          );
          
          const dateStr = new Date().toISOString().split('T')[0];
          mailOptions.attachments = [{
            filename: `NG_Visual_Report_${dateStr}.${extension}`,
            content: content,
            contentType: mimeType,
          }];
        }

        // Send test email
        await transporter.sendMail(mailOptions);

        // Log test send
        await db.createScheduledReportLog({
          reportId: report.id,
          status: 'SUCCESS',
          sentAt: new Date(),
          recipientCount: report.recipients.length,
          errorMessage: null,
        });

        return { success: true, message: `Test email sent successfully (format: ${customization.reportFormat})` };
      } catch (error: any) {
        // Log failure
        await db.createScheduledReportLog({
          reportId: report.id,
          status: 'FAILED',
          sentAt: new Date(),
          recipientCount: 0,
          errorMessage: error.message,
        });

        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `Failed to send test email: ${error.message}` 
        });
      }
    }),

  // Preview email with real data
  previewEmail: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const report = await db.getScheduledReportById(input.id);
      if (!report) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Report not found' });
      }

      const { generateNGVisualReport, generateNGVisualEmailHTML } = await import('./services/reportGenerator');
      
      // Generate report data with real filters
      const reportData = await generateNGVisualReport({
        startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        endDate: new Date(),
        factoryId: report.factoryId ?? undefined,
        workshopId: report.workshopId ?? undefined,
        lineId: report.lineId ?? undefined,
      });

      // Get customization from report
      const customization = {
        logoUrl: (report as any).logoUrl,
        primaryColor: (report as any).primaryColor,
        footerText: (report as any).footerText,
        reportFormat: (report as any).reportFormat || 'HTML',
      };

      // Generate HTML email
      const emailHtml = generateNGVisualEmailHTML(reportData, customization);

      return {
        html: emailHtml,
        reportData,
        customization,
      };
    }),

  uploadLogo: adminProcedure
    .input(z.object({
      base64: z.string(),
      filename: z.string(),
      mimeType: z.string(),
    }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import('./storage');
      
      // Extract base64 data
      const base64Data = input.base64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      
      // Generate unique filename
      const ext = input.filename.split('.').pop() || 'png';
      const uniqueFilename = `report-logos/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
      
      // Upload to S3
      const { url } = await storagePut(uniqueFilename, buffer, input.mimeType);
      
      return { url };
    }),

  // Preview statistics report
  previewStatisticsReport: adminProcedure
    .input(z.object({
      frequency: z.enum(['daily', 'weekly', 'monthly']),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { scheduledReportService } = await import('./services/scheduledReportService');
      return scheduledReportService.previewReport(input);
    }),

  // Send one-time statistics report
  sendStatisticsReport: adminProcedure
    .input(z.object({
      name: z.string(),
      frequency: z.enum(['daily', 'weekly', 'monthly']),
      recipients: z.array(z.string().email()).min(1),
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { scheduledReportService } = await import('./services/scheduledReportService');
      const content = await scheduledReportService.generateAndSendReport({
        name: input.name,
        type: 'statistics',
        frequency: input.frequency,
        recipients: input.recipients,
        corporateCode: input.corporateCode,
        factoryCode: input.factoryCode,
      });
      return { 
        success: true, 
        message: `Report sent to ${input.recipients.length} recipients`,
        summary: content.summary,
      };
    }),
});

// ============= SMTP Configuration Router =============
const smtpRouter = router({
  getConfig: adminProcedure
    .query(async () => {
      const config = await db.getSmtpConfig();
      // Don't return password to frontend
      if (config) {
        return {
          ...config,
          password: config.password ? '********' : '',
        };
      }
      return null;
    }),

  updateConfig: adminProcedure
    .input(z.object({
      host: z.string().min(1),
      port: z.number().min(1).max(65535),
      secure: z.boolean(),
      username: z.string().min(1),
      password: z.string().optional(),
      fromEmail: z.string().email(),
      fromName: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      // If password is '********', don't update it
      const dataToUpdate: any = { ...input };
      if (input.password === '********' || !input.password) {
        const existing = await db.getSmtpConfig();
        if (existing) {
          dataToUpdate.password = existing.password;
        } else {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password is required for new SMTP config' });
        }
      }
      
      const id = await db.createOrUpdateSmtpConfig(dataToUpdate);
      return { success: true, id };
    }),

  testConnection: adminProcedure
    .input(z.object({
      host: z.string().optional(),
      port: z.number().optional(),
      secure: z.boolean().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      fromEmail: z.string().optional(),
      fromName: z.string().optional(),
    }).optional())
    .mutation(async ({ input }) => {
      let config: any;
      
      if (input && input.host && input.username) {
        // Use provided config for testing
        config = input;
        // If password is masked, get from database
        if (input.password === '********' || !input.password) {
          const existingConfig = await db.getSmtpConfig();
          if (existingConfig) {
            config.password = existingConfig.password;
          } else {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Password is required' });
          }
        }
      } else {
        // Use saved config from database
        config = await db.getSmtpConfig();
        if (!config) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'SMTP config not found. Please save config first.' });
        }
      }
      
      try {
        const { testSmtpConnection } = await import('./_core/email');
        await testSmtpConnection(config);
        return { success: true, message: 'SMTP connection successful' };
      } catch (error: any) {
        throw new TRPCError({ 
          code: 'INTERNAL_SERVER_ERROR', 
          message: `SMTP connection failed: ${error.message}` 
        });
      }
    }),

  // Email Template Config endpoints
  getEmailTemplates: adminProcedure.query(async () => {
    return db.getEmailTemplateConfigs();
  }),

  getEmailTemplateById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getEmailTemplateConfigById(input.id);
    }),

  getDefaultEmailTemplate: adminProcedure.query(async () => {
    return db.getDefaultEmailTemplateConfig();
  }),

  createEmailTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      logoUrl: z.string().optional().nullable(),
      companyName: z.string().optional().nullable(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      warningColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      dangerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      fontFamily: z.string().optional(),
      footerText: z.string().optional().nullable(),
      footerLinks: z.string().optional().nullable(), // JSON string
      contactEmail: z.string().email().optional().nullable(),
      contactPhone: z.string().optional().nullable(),
      contactAddress: z.string().optional().nullable(),
      socialLinks: z.string().optional().nullable(), // JSON string
      isDefault: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.createEmailTemplateConfig({
        ...input,
        createdBy: ctx.user.id,
      });
      return result;
    }),

  updateEmailTemplate: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      logoUrl: z.string().optional().nullable(),
      companyName: z.string().optional().nullable(),
      primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      warningColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      dangerColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      fontFamily: z.string().optional(),
      footerText: z.string().optional().nullable(),
      footerLinks: z.string().optional().nullable(),
      contactEmail: z.string().email().optional().nullable(),
      contactPhone: z.string().optional().nullable(),
      contactAddress: z.string().optional().nullable(),
      socialLinks: z.string().optional().nullable(),
      isDefault: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateEmailTemplateConfig(id, data);
      return { success: true };
    }),

  deleteEmailTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteEmailTemplateConfig(input.id);
      return { success: true };
    }),

  setDefaultEmailTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.setDefaultEmailTemplateConfig(input.id);
      return { success: true };
    }),
});

// ============ SYSTEM CONFIG ROUTER ============
const systemConfigRouter = router({
  list: adminProcedure.query(async () => {
    return db.getAllSystemConfig();
  }),

  getByKey: adminProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      return db.getSystemConfigByKey(input.key);
    }),

  update: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      await db.updateSystemConfig(input.key, input.value, ctx.user.id);
      return { success: true };
    }),

  create: adminProcedure
    .input(z.object({
      configKey: z.string(),
      configValue: z.string(),
      description: z.string().optional(),
      dataType: z.enum(["STRING", "NUMBER", "BOOLEAN", "JSON"]).optional(),
      isEditable: z.boolean().optional(),
      requiresRestart: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      return db.createSystemConfig(input);
    }),
});

const corporateFactoryStatsRouter = router({
  yieldRateByCorporate: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedYieldRateByCorporate({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  yieldRateByFactory: protectedProcedure
    .input(z.object({
      corporateCode: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedYieldRateByFactory({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  throughputByCorporate: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      interval: z.enum(['hour', 'day', 'week']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedThroughputByCorporate({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  throughputByFactory: protectedProcedure
    .input(z.object({
      corporateCode: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      interval: z.enum(['hour', 'day', 'week']).optional(),
    }))
    .query(async ({ ctx, input }) => {
      return cachedStats.getCachedThroughputByFactory({
        ...input,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
    }),

  // Machine statistics with caching
  machineStats: protectedProcedure
    .input(z.object({
      machineId: z.number(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .query(async ({ input }) => {
      return cachedStats.getCachedMachineStats(input);
    }),

  // Cache statistics for monitoring
  cacheStats: adminProcedure
    .query(async () => {
      return cachedStats.getCacheStats();
    }),

  // Cache health check
  cacheHealth: adminProcedure
    .query(async () => {
      return cachedStats.getCacheHealth();
    }),

  // Redis connection status with history
  redisConnectionStatus: adminProcedure
    .query(async () => {
      const { redisService } = await import('./services/redisService');
      return redisService.getConnectionStatus();
    }),

  // Redis connection history
  redisConnectionHistory: adminProcedure
    .query(async () => {
      const { redisService } = await import('./services/redisService');
      return redisService.getConnectionHistory();
    }),

  // Clear all statistics cache
  clearCache: adminProcedure
    .mutation(async () => {
      await cachedStats.invalidateStatisticsCache();
      return { success: true, message: 'Statistics cache cleared' };
    }),

  // Cache warming statistics
  warmingStats: adminProcedure
    .query(async () => {
      const { cacheWarmingService } = await import('./services/cacheWarmingService');
      return cacheWarmingService.getStats();
    }),

  // Trigger cache warming manually
  triggerWarming: adminProcedure
    .mutation(async () => {
      const { cacheWarmingService } = await import('./services/cacheWarmingService');
      await cacheWarmingService.triggerWarming();
      return { success: true, message: 'Cache warming triggered' };
    }),

  // Update cache warming configuration
  updateWarmingConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().min(5).max(1440).optional(), // 5 min to 24 hours
      warmOnStartup: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { cacheWarmingService } = await import('./services/cacheWarmingService');
      cacheWarmingService.updateConfig(input);
      return { success: true, message: 'Cache warming triggered' };
    }),
});

const importRouter = router({  
  importFactories: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        address: z.string().optional(),
        region: z.string().optional(),
        country: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Check if factory code already exists
          const existing = await db.getFactoryByCode(item.code);
          if (existing) {
            throw new Error('Factory code already exists');
          }
          
          await db.createFactory(item);
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importWorkshops: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        factoryCode: z.string(),
        code: z.string(),
        name: z.string(),
        description: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Lookup factory by code
          const factory = await db.getFactoryByCode(item.factoryCode);
          if (!factory) {
            throw new Error(`Factory ${item.factoryCode} not found`);
          }
          
          // Check if workshop code already exists
          const existing = await db.getWorkshopByCode(item.code);
          if (existing) {
            throw new Error('Workshop code already exists');
          }
          
          await db.createWorkshop({
            factoryId: factory.id,
            code: item.code,
            name: item.name,
            description: item.description,
            isActive: item.isActive ?? true,
          });
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),

  importMachines: adminProcedure
    .input(z.object({
      data: z.array(z.object({
        stationCode: z.string(),
        code: z.string(),
        name: z.string(),
        machineType: z.enum(['AVI', 'AOI', 'AUTOMATION']),
        model: z.string().optional(),
        manufacturer: z.string().optional(),
        isActive: z.boolean().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const results = { success: 0, failed: 0, errors: [] as string[] };
      
      for (const item of input.data) {
        try {
          // Lookup station by code
          const station = await db.getStationByCode(item.stationCode);
          if (!station) {
            throw new Error(`Station ${item.stationCode} not found`);
          }
          
          // Generate API key
          const crypto = await import('crypto');
          const apiKey = crypto.randomBytes(32).toString('hex');
          
          await db.createMachine({
            stationId: station.id,
            code: item.code,
            name: item.name,
            machineType: item.machineType,
            model: item.model,
            manufacturer: item.manufacturer,
            apiKey,
            isActive: item.isActive ?? true,
          });
          results.success++;
        } catch (error: any) {
          results.failed++;
          results.errors.push(`${item.code}: ${error.message}`);
        }
      }
      
      return results;
    }),
});

const exportRouter = router({
  exportInspections: protectedProcedure
    .input(z.object({
      corporateCode: z.string().optional(),
      factoryCode: z.string().optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
    }))
    .mutation(async ({ input }) => {
      const XLSX = await import('xlsx');
      
      const inspections = await db.getProductInspections({
        corporateCode: input.corporateCode,
        factoryCode: input.factoryCode,
        startDate: input.startDate,
        endDate: input.endDate,
        limit: 10000, // Max export limit
      });

      // Transform data for Excel
      const data = inspections.data.map((i: any) => ({
        'Inspection ID': i.id,
        'Corporate Code': i.corporateCode || 'N/A',
        'Factory Code': i.factoryCode || 'N/A',
        'Serial Number': i.serialNumber,
        'Product Model': i.productModelName || i.productModelCode,
        'Result': i.overallResult,
        'Inspection Time': new Date(i.inspectionTime).toLocaleString('vi-VN'),
        'Batch Number': i.batchNumber || '',
        'Machine Code': i.machineCode,
        'Station Code': i.stationCode,
      }));

      // Create workbook
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, 'Inspections');

      // Generate buffer
      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      // Upload to S3
      const { storagePut } = await import('./storage');
      const filename = `inspections_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename, count: data.length };
    }),

  exportStatistics: adminProcedure
    .input(z.object({
      startDate: z.date(),
      endDate: z.date(),
    }))
    .mutation(async ({ input }) => {
      const XLSX = await import('xlsx');
      
      const corporateStats = await db.getYieldRateByCorporate(input);
      const factoryStats = await db.getYieldRateByFactory(input);

      const wb = XLSX.utils.book_new();
      
      // Corporate sheet
      const corporateWs = XLSX.utils.json_to_sheet(corporateStats.map((s: any) => ({
        'Corporate Code': s.corporateCode,
        'Total Inspections': s.totalInspections,
        'OK Count': s.okCount,
        'NG Count': s.ngCount,
        'NTF Count': s.ntfCount,
        'Yield Rate (%)': s.yieldRate,
      })));
      XLSX.utils.book_append_sheet(wb, corporateWs, 'Corporate Stats');

      // Factory sheet
      const factoryWs = XLSX.utils.json_to_sheet(factoryStats.map((s: any) => ({
        'Corporate Code': s.corporateCode,
        'Factory Code': s.factoryCode,
        'Total Inspections': s.totalInspections,
        'OK Count': s.okCount,
        'NG Count': s.ngCount,
        'NTF Count': s.ntfCount,
        'Yield Rate (%)': s.yieldRate,
      })));
      XLSX.utils.book_append_sheet(wb, factoryWs, 'Factory Stats');

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      
      const { storagePut } = await import('./storage');
      const filename = `statistics_${Date.now()}.xlsx`;
      const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      
      return { url, filename };
    }),

  // Export Dashboard Statistics to Excel/PDF
  exportDashboardStats: protectedProcedure
    .input(z.object({
      startDate: z.date(),
      endDate: z.date(),
      format: z.enum(['excel', 'pdf']).default('excel'),
      corporateCode: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const XLSX = await import('xlsx');
      
      // Get statistics with access control
      const corporateStats = await cachedStats.getCachedYieldRateByCorporate({
        startDate: input.startDate,
        endDate: input.endDate,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
      
      const factoryStats = await cachedStats.getCachedYieldRateByFactory({
        corporateCode: input.corporateCode,
        startDate: input.startDate,
        endDate: input.endDate,
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });
      
      const throughputCorporate = await cachedStats.getCachedThroughputByCorporate({
        startDate: input.startDate,
        endDate: input.endDate,
        interval: 'day',
        userId: ctx.user.id,
        userRole: ctx.user.role as 'admin' | 'user',
      });

      if (input.format === 'excel') {
        const wb = XLSX.utils.book_new();
        
        // Summary sheet
        const totalInspections = corporateStats.reduce((sum, s) => sum + s.totalInspections, 0);
        const totalOK = corporateStats.reduce((sum, s) => sum + s.okCount, 0);
        const totalNG = corporateStats.reduce((sum, s) => sum + s.ngCount, 0);
        const totalNTF = corporateStats.reduce((sum, s) => sum + s.ntfCount, 0);
        const overallYield = totalInspections > 0 ? ((totalOK / totalInspections) * 100).toFixed(2) : '0.00';
        
        const summaryData = [
          { 'Metric': 'Report Period', 'Value': `${input.startDate.toLocaleDateString('vi-VN')} - ${input.endDate.toLocaleDateString('vi-VN')}` },
          { 'Metric': 'Total Inspections', 'Value': totalInspections },
          { 'Metric': 'OK Count', 'Value': totalOK },
          { 'Metric': 'NG Count', 'Value': totalNG },
          { 'Metric': 'NTF Count', 'Value': totalNTF },
          { 'Metric': 'Overall Yield Rate', 'Value': `${overallYield}%` },
          { 'Metric': 'Number of Corporates', 'Value': corporateStats.length },
          { 'Metric': 'Number of Factories', 'Value': factoryStats.length },
          { 'Metric': 'Generated At', 'Value': new Date().toLocaleString('vi-VN') },
          { 'Metric': 'Generated By', 'Value': ctx.user.name || ctx.user.email },
        ];
        const summaryWs = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
        
        // Corporate Stats sheet
        const corporateWs = XLSX.utils.json_to_sheet(corporateStats.map((s: any) => ({
          'Mã Công ty': s.corporateCode,
          'Tổng kiểm tra': s.totalInspections,
          'Số OK': s.okCount,
          'Số NG': s.ngCount,
          'Số NTF': s.ntfCount,
          'Tỷ lệ đạt (%)': s.yieldRate,
        })));
        XLSX.utils.book_append_sheet(wb, corporateWs, 'Corporate Stats');

        // Factory Stats sheet
        const factoryWs = XLSX.utils.json_to_sheet(factoryStats.map((s: any) => ({
          'Mã Công ty': s.corporateCode,
          'Mã Nhà máy': s.factoryCode,
          'Tổng kiểm tra': s.totalInspections,
          'Số OK': s.okCount,
          'Số NG': s.ngCount,
          'Số NTF': s.ntfCount,
          'Tỷ lệ đạt (%)': s.yieldRate,
        })));
        XLSX.utils.book_append_sheet(wb, factoryWs, 'Factory Stats');

        // Daily Throughput sheet
        const throughputWs = XLSX.utils.json_to_sheet(throughputCorporate.map((t: any) => ({
          'Mã Công ty': t.corporateCode,
          'Ngày': t.timeInterval,
          'Số lượng': t.count,
        })));
        XLSX.utils.book_append_sheet(wb, throughputWs, 'Daily Throughput');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        const { storagePut } = await import('./storage');
        const filename = `dashboard_stats_${Date.now()}.xlsx`;
        const { url } = await storagePut(`exports/${filename}`, buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
        return { url, filename, format: 'excel' };
      } else {
        // PDF export using HTML template
        const totalInspections = corporateStats.reduce((sum, s) => sum + s.totalInspections, 0);
        const totalOK = corporateStats.reduce((sum, s) => sum + s.okCount, 0);
        const totalNG = corporateStats.reduce((sum, s) => sum + s.ngCount, 0);
        const totalNTF = corporateStats.reduce((sum, s) => sum + s.ntfCount, 0);
        const overallYield = totalInspections > 0 ? ((totalOK / totalInspections) * 100).toFixed(2) : '0.00';
        
        const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Dashboard Statistics Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1a1a2e; border-bottom: 2px solid #3b82f6; padding-bottom: 10px; }
    h2 { color: #1a1a2e; margin-top: 30px; }
    .summary { background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .stat-card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-value { font-size: 24px; font-weight: bold; color: #3b82f6; }
    .stat-label { color: #64748b; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 12px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    tr:nth-child(even) { background: #f8fafc; }
    .ok { color: #10b981; }
    .ng { color: #ef4444; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Báo cáo Thống kê Dashboard</h1>
  
  <div class="summary">
    <p><strong>Kỳ báo cáo:</strong> ${input.startDate.toLocaleDateString('vi-VN')} - ${input.endDate.toLocaleDateString('vi-VN')}</p>
    <div class="summary-grid">
      <div class="stat-card">
        <div class="stat-value">${totalInspections.toLocaleString()}</div>
        <div class="stat-label">Tổng kiểm tra</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ok">${totalOK.toLocaleString()}</div>
        <div class="stat-label">Số OK</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ng">${totalNG.toLocaleString()}</div>
        <div class="stat-label">Số NG</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${overallYield}%</div>
        <div class="stat-label">Tỷ lệ đạt</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${corporateStats.length}</div>
        <div class="stat-label">Số công ty</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${factoryStats.length}</div>
        <div class="stat-label">Số nhà máy</div>
      </div>
    </div>
  </div>

  <h2>Thống kê theo Công ty</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Công ty</th>
        <th>Tổng kiểm tra</th>
        <th>OK</th>
        <th>NG</th>
        <th>NTF</th>
        <th>Tỷ lệ đạt (%)</th>
      </tr>
    </thead>
    <tbody>
      ${corporateStats.map((s: any) => `
        <tr>
          <td>${s.corporateCode}</td>
          <td>${s.totalInspections.toLocaleString()}</td>
          <td class="ok">${s.okCount.toLocaleString()}</td>
          <td class="ng">${s.ngCount.toLocaleString()}</td>
          <td>${s.ntfCount.toLocaleString()}</td>
          <td>${s.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <h2>Thống kê theo Nhà máy</h2>
  <table>
    <thead>
      <tr>
        <th>Mã Công ty</th>
        <th>Mã Nhà máy</th>
        <th>Tổng kiểm tra</th>
        <th>OK</th>
        <th>NG</th>
        <th>NTF</th>
        <th>Tỷ lệ đạt (%)</th>
      </tr>
    </thead>
    <tbody>
      ${factoryStats.map((s: any) => `
        <tr>
          <td>${s.corporateCode}</td>
          <td>${s.factoryCode}</td>
          <td>${s.totalInspections.toLocaleString()}</td>
          <td class="ok">${s.okCount.toLocaleString()}</td>
          <td class="ng">${s.ngCount.toLocaleString()}</td>
          <td>${s.ntfCount.toLocaleString()}</td>
          <td>${s.yieldRate}%</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>Báo cáo được tạo lúc: ${new Date().toLocaleString('vi-VN')}</p>
    <p>Người tạo: ${ctx.user.name || ctx.user.email}</p>
  </div>
</body>
</html>
        `;
        
        // Convert HTML to PDF using WeasyPrint or return HTML for now
        const { storagePut } = await import('./storage');
        const filename = `dashboard_stats_${Date.now()}.html`;
        const { url } = await storagePut(`exports/${filename}`, Buffer.from(htmlContent), 'text/html');
        
        return { url, filename, format: 'html' };
      }
    }),
});

const userAssignmentRouter = router({
  // Get current user's assignments
  getMyAssignments: protectedProcedure
    .query(async ({ ctx }) => {
      const corporates = await db.getUserCorporateAssignments(ctx.user.id);
      const factories = await db.getUserFactoryAssignments(ctx.user.id);
      return { corporates, factories };
    }),

  // Get all users with their assignments (admin only)
  getAllUserAssignments: adminProcedure
    .query(async () => {
      const users = await db.getUsers();
      const result = [];
      for (const user of users) {
        const corporates = await db.getUserCorporateAssignments(user.id);
        const factories = await db.getUserFactoryAssignments(user.id);
        result.push({ user, corporates, factories });
      }
      return result;
    }),

  // Assign user to corporate (admin only)
  assignCorporate: adminProcedure
    .input(z.object({
      userId: z.number(),
      corporateCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createCorporateAssignment({
        userId: input.userId,
        corporateCode: input.corporateCode,
        assignedBy: ctx.user.id,
      });
    }),

  // Assign user to factory (admin only)
  assignFactory: adminProcedure
    .input(z.object({
      userId: z.number(),
      factoryCode: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      return db.createFactoryAssignment({
        userId: input.userId,
        factoryCode: input.factoryCode,
        assignedBy: ctx.user.id,
      });
    }),

  // Remove corporate assignment (admin only)
  removeCorporateAssignment: adminProcedure
    .input(z.object({
      userId: z.number(),
      corporateCode: z.string(),
    }))
    .mutation(async ({ input }) => {
      return db.deleteCorporateAssignment(input.userId, input.corporateCode);
    }),

  // Remove factory assignment (admin only)
  removeFactoryAssignment: adminProcedure
    .input(z.object({
      userId: z.number(),
      factoryCode: z.string(),
    }))
    .mutation(async ({ input }) => {
      return db.deleteFactoryAssignment(input.userId, input.factoryCode);
    }),
});

// ============= NOTIFICATION ROUTER =============
const notificationRouter = router({
  list: protectedProcedure
    .input(z.object({
      type: z.enum(['ALERT', 'REPORT', 'SYSTEM', 'INFO', 'WARNING', 'SUCCESS']).optional(),
      isRead: z.boolean().optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      return db.getNotifications(ctx.user.id, input);
    }),

  unreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUnreadNotificationCount(ctx.user.id);
    }),

  markAsRead: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.markNotificationAsRead(input.id, ctx.user.id);
      const { emitNotificationRead } = await import('./services/notificationService');
      emitNotificationRead(ctx.user.id, input.id);
      return { success: true };
    }),

  markAllAsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      await db.markAllNotificationsAsRead(ctx.user.id);
      const { emitAllNotificationsRead } = await import('./services/notificationService');
      emitAllNotificationsRead(ctx.user.id);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteNotification(input.id, ctx.user.id);
      return { success: true };
    }),

  deleteOld: protectedProcedure
    .input(z.object({ daysOld: z.number().min(1).max(365).optional() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteOldNotifications(ctx.user.id, input?.daysOld || 30);
      return { success: true };
    }),

  // Notification preferences
  getPreferences: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserNotificationPreferences(ctx.user.id);
    }),

  updatePreferences: protectedProcedure
    .input(z.object({
      emailEnabled: z.boolean().optional(),
      emailAlerts: z.boolean().optional(),
      emailReports: z.boolean().optional(),
      emailSystem: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      pushAlerts: z.boolean().optional(),
      pushReports: z.boolean().optional(),
      pushSystem: z.boolean().optional(),
      inAppEnabled: z.boolean().optional(),
      inAppAlerts: z.boolean().optional(),
      inAppReports: z.boolean().optional(),
      inAppSystem: z.boolean().optional(),
      soundEnabled: z.boolean().optional(),
      quietHoursEnabled: z.boolean().optional(),
      quietHoursStart: z.string().optional(),
      quietHoursEnd: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertUserNotificationPreferences(ctx.user.id, input);
      return { success: true };
    }),

  // Admin: send notification to user
  sendToUser: adminProcedure
    .input(z.object({
      userId: z.number(),
      type: z.enum(['ALERT', 'REPORT', 'SYSTEM', 'INFO', 'WARNING', 'SUCCESS']),
      title: z.string(),
      message: z.string(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    }))
    .mutation(async ({ input }) => {
      const { sendNotification } = await import('./services/notificationService');
      return sendNotification(input.userId, {
        type: input.type,
        title: input.title,
        message: input.message,
        priority: input.priority,
      });
    }),

  // Admin: broadcast notification to all users
  broadcast: adminProcedure
    .input(z.object({
      type: z.enum(['ALERT', 'REPORT', 'SYSTEM', 'INFO', 'WARNING', 'SUCCESS']),
      title: z.string(),
      message: z.string(),
      priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    }))
    .mutation(async ({ input }) => {
      const users = await db.getUsers();
      const userIds = users.map(u => u.id);
      const { sendBroadcastNotification } = await import('./services/notificationService');
      return sendBroadcastNotification(userIds, {
        type: input.type,
        title: input.title,
        message: input.message,
        priority: input.priority,
      });
    }),
});

// ============= USER SETTINGS ROUTER =============
const userSettingsRouter = router({
  get: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserSettings(ctx.user.id);
    }),

  update: protectedProcedure
    .input(z.object({
      language: z.string().optional(),
      theme: z.enum(['light', 'dark', 'system']).optional(),
      timezone: z.string().optional(),
      dateFormat: z.string().optional(),
      timeFormat: z.string().optional(),
      numberFormat: z.string().optional(),
      defaultDashboardTab: z.string().optional(),
      sidebarCollapsed: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.upsertUserSettings(ctx.user.id, input);
      return { success: true };
    }),
});

// ============= DASHBOARD WIDGET ROUTER =============
const dashboardWidgetRouter = router({
  getLayout: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getDashboardWidgetLayout(ctx.user.id);
    }),

  saveLayout: protectedProcedure
    .input(z.object({
      widgets: z.array(z.object({
        id: z.string(),
        type: z.string(),
        title: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        settings: z.record(z.string(), z.any()).optional(),
        visible: z.boolean(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.saveDashboardWidgetLayout(ctx.user.id, input.widgets);
    }),

  resetLayout: protectedProcedure
    .mutation(async ({ ctx }) => {
      await db.resetDashboardWidgetLayout(ctx.user.id);
      return { success: true };
    }),

  // ============= SHARED TEMPLATES =============
  
  // Get all shared templates (public or created by user)
  getSharedTemplates: protectedProcedure
    .query(async ({ ctx }) => {
      // Get all public templates
      const publicTemplates = await db.getDashboardTemplates({ isPublic: true });
      
      // Get user's own templates (if not admin)
      let userTemplates: Awaited<ReturnType<typeof db.getDashboardTemplates>> = [];
      if (ctx.user.role !== 'admin') {
        userTemplates = await db.getDashboardTemplates({ createdBy: ctx.user.id, isPublic: false });
      }
      
      // Combine and deduplicate
      const allTemplates = [...publicTemplates, ...userTemplates];
      const uniqueTemplates = allTemplates.filter((t, i, arr) => 
        arr.findIndex(x => x.id === t.id) === i
      );
      
      return uniqueTemplates;
    }),

  // Get template by ID
  getSharedTemplateById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getDashboardTemplateById(input.id);
    }),

  // Create shared template (admin only)
  createSharedTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      widgets: z.array(z.string()),
      layout: z.array(z.object({
        i: z.string(),
        x: z.number(),
        y: z.number(),
        w: z.number(),
        h: z.number(),
        minW: z.number().optional(),
        minH: z.number().optional(),
      })),
      isPublic: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      return db.createDashboardTemplate({
        name: input.name,
        description: input.description,
        templateType: 'shared',
        widgets: input.widgets,
        layout: input.layout,
        isPublic: input.isPublic,
        createdBy: ctx.user.id,
      });
    }),

  // Update shared template (admin only)
  updateSharedTemplate: adminProcedure
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
        minW: z.number().optional(),
        minH: z.number().optional(),
      })).optional(),
      isPublic: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateDashboardTemplate(id, data);
      return { success: true };
    }),

  // Delete shared template (admin only)
  deleteSharedTemplate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteDashboardTemplate(input.id);
      return { success: true };
    }),

  // Apply shared template (increment usage count)
  applySharedTemplate: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.incrementTemplateUsage(input.id);
      return { success: true };
    }),

  // Save current layout as shared template (admin only)
  saveAsSharedTemplate: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      isPublic: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get current user's layout
      const currentLayout = await db.getDashboardWidgetLayout(ctx.user.id);
      
      if (!currentLayout) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No layout found to save' });
      }
      
      // Extract widgets and layout from current layout
      const widgets = currentLayout.widgets.map(w => w.id);
      const layout = currentLayout.widgets.map(w => ({
        i: w.id,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
      }));
      
      return db.createDashboardTemplate({
        name: input.name,
        description: input.description,
        templateType: 'shared',
        widgets,
        layout,
        isPublic: input.isPublic,
        createdBy: ctx.user.id,
      });
    }),

  // ============= WIDGET STYLE PRESETS =============
  
  // Get all style presets (user's own + public + system)
  getStylePresets: protectedProcedure
    .query(async ({ ctx }) => {
      return db.getUserWidgetStylePresets(ctx.user.id);
    }),

  // Get preset by ID
  getStylePresetById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getWidgetStylePresetById(input.id);
    }),

  // Create style preset
  createStylePreset: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      backgroundColor: z.string().default('#ffffff'),
      textColor: z.string().default('#1f2937'),
      borderColor: z.string().default('#e5e7eb'),
      accentColor: z.string().default('#3b82f6'),
      borderRadius: z.string().default('0.5rem'),
      shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']).default('sm'),
      opacity: z.string().default('1.00'),
      presetType: z.enum(['user', 'shared']).default('user'),
      isPublic: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Only admin can create shared presets
      if (input.presetType === 'shared' && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admin can create shared presets' });
      }
      return db.createWidgetStylePreset({
        ...input,
        createdBy: ctx.user.id,
      });
    }),

  // Update style preset
  updateStylePreset: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
      borderColor: z.string().optional(),
      accentColor: z.string().optional(),
      borderRadius: z.string().optional(),
      shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']).optional(),
      opacity: z.string().optional(),
      isPublic: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Only owner or admin can update
      if (preset.createdBy !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to update this preset' });
      }
      const { id, ...data } = input;
      await db.updateWidgetStylePreset(id, data);
      return { success: true };
    }),

  // Delete style preset
  deleteStylePreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Only owner or admin can delete
      if (preset.createdBy !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to delete this preset' });
      }
      // Cannot delete system presets
      if (preset.presetType === 'system') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete system presets' });
      }
      await db.deleteWidgetStylePreset(input.id);
      return { success: true };
    }),

  // Apply style preset (increment usage count)
  applyStylePreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.incrementWidgetStylePresetUsage(input.id);
      return { success: true };
    }),

  // Get public style presets only
  getPublicStylePresets: protectedProcedure
    .query(async () => {
      return db.getPublicWidgetStylePresets();
    }),

  // Export preset as JSON
  exportStylePreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Check access - user can export their own, public, or system presets
      if (preset.createdBy !== ctx.user.id && !preset.isPublic && preset.presetType !== 'system') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to export this preset' });
      }
      return {
        name: preset.name,
        description: preset.description,
        backgroundColor: preset.backgroundColor,
        textColor: preset.textColor,
        borderColor: preset.borderColor,
        accentColor: preset.accentColor,
        borderRadius: preset.borderRadius,
        shadow: preset.shadow,
        opacity: preset.opacity,
        exportedAt: new Date().toISOString(),
        exportedBy: ctx.user.name,
        version: '1.0',
      };
    }),

  // Import preset from JSON
  importStylePreset: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      backgroundColor: z.string(),
      textColor: z.string(),
      borderColor: z.string(),
      accentColor: z.string(),
      borderRadius: z.string(),
      shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']),
      opacity: z.string(),
      isPublic: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      // Check for duplicate name
      const existingPresets = await db.getUserWidgetStylePresets(ctx.user.id);
      const duplicateName = existingPresets.find(p => p.name === input.name && p.createdBy === ctx.user.id);
      if (duplicateName) {
        // Append timestamp to make unique
        input.name = `${input.name} (imported ${new Date().toLocaleDateString()})`;
      }
      
      // Only admin can create public presets
      if (input.isPublic && ctx.user.role !== 'admin') {
        input.isPublic = false;
      }
      
      return db.createWidgetStylePreset({
        ...input,
        presetType: 'user',
        createdBy: ctx.user.id,
      });
    }),

  // Bulk export presets
  exportAllUserPresets: protectedProcedure
    .query(async ({ ctx }) => {
      const presets = await db.getUserWidgetStylePresets(ctx.user.id);
      const userPresets = presets.filter(p => p.createdBy === ctx.user.id);
      return {
        presets: userPresets.map(p => ({
          name: p.name,
          description: p.description,
          backgroundColor: p.backgroundColor,
          textColor: p.textColor,
          borderColor: p.borderColor,
          accentColor: p.accentColor,
          borderRadius: p.borderRadius,
          shadow: p.shadow,
          opacity: p.opacity,
        })),
        exportedAt: new Date().toISOString(),
        exportedBy: ctx.user.name,
        version: '1.0',
        count: userPresets.length,
      };
    }),

  // Bulk import presets
  importMultiplePresets: protectedProcedure
    .input(z.object({
      presets: z.array(z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        backgroundColor: z.string(),
        textColor: z.string(),
        borderColor: z.string(),
        accentColor: z.string(),
        borderRadius: z.string(),
        shadow: z.enum(['none', 'sm', 'md', 'lg', 'xl']),
        opacity: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const results: { name: string; success: boolean; error?: string }[] = [];
      const existingPresets = await db.getUserWidgetStylePresets(ctx.user.id);
      const existingNames = new Set(existingPresets.filter(p => p.createdBy === ctx.user.id).map(p => p.name));
      
      for (const preset of input.presets) {
        try {
          let name = preset.name;
          // Handle duplicate names
          if (existingNames.has(name)) {
            name = `${name} (imported ${new Date().toLocaleDateString()})`;
          }
          
          await db.createWidgetStylePreset({
            ...preset,
            name,
            presetType: 'user',
            isPublic: false,
            createdBy: ctx.user.id,
          });
          existingNames.add(name);
          results.push({ name: preset.name, success: true });
        } catch (error) {
          results.push({ name: preset.name, success: false, error: (error as Error).message });
        }
      }
      
      return {
        imported: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      };
    }),

  // Share preset with team (admin only)
  sharePreset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Update preset to be shared and public
      await db.updateWidgetStylePreset(input.id, {
        presetType: 'shared',
        isPublic: true,
      });
      return { success: true, message: 'Preset shared with team' };
    }),

  // Unshare preset (admin only)
  unsharePreset: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Cannot unshare system presets
      if (preset.presetType === 'system') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot modify system presets' });
      }
      // Update preset to be private
      await db.updateWidgetStylePreset(input.id, {
        presetType: 'user',
        isPublic: false,
      });
      return { success: true, message: 'Preset is now private' };
    }),

  // Get all shared presets (for team members)
  getSharedStylePresets: protectedProcedure
    .query(async () => {
      return db.getSharedWidgetStylePresets();
    }),

  // Clone shared preset to user's collection
  cloneSharedPreset: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const preset = await db.getWidgetStylePresetById(input.id);
      if (!preset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Preset not found' });
      }
      // Check if preset is accessible (public or shared)
      if (!preset.isPublic && preset.presetType !== 'shared' && preset.createdBy !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized to clone this preset' });
      }
      // Create a copy for the user
      const newPresetId = await db.createWidgetStylePreset({
        name: `${preset.name} (copy)`,
        description: preset.description || undefined,
        backgroundColor: preset.backgroundColor,
        textColor: preset.textColor,
        borderColor: preset.borderColor,
        accentColor: preset.accentColor,
        borderRadius: preset.borderRadius,
        shadow: preset.shadow,
        opacity: preset.opacity,
        presetType: 'user',
        isPublic: false,
        createdBy: ctx.user.id,
      });
      return { success: true, newPresetId };
    }),
});

// ============ PRODUCT CATEGORY ROUTER ============
const productCategoryRouter = router({
  list: protectedProcedure
    .input(z.object({
      parentId: z.number().nullable().optional(),
      isActive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getProductCategories(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return db.getProductCategoryById(input.id);
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      return db.getProductCategoryByCode(input.code);
    }),

  getTree: protectedProcedure
    .query(async () => {
      return db.getProductCategoryTree();
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      parentId: z.number().nullable().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      orderIndex: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      // Check if code already exists
      const existing = await db.getProductCategoryByCode(input.code);
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Category code already exists' });
      }
      const result = await db.createProductCategory(input);
      return { id: result.id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      parentId: z.number().nullable().optional(),
      color: z.string().optional(),
      icon: z.string().optional(),
      orderIndex: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      // Check if code already exists (if changing code)
      if (data.code) {
        const existing = await db.getProductCategoryByCode(data.code);
        if (existing && existing.id !== id) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Category code already exists' });
        }
      }
      await db.updateProductCategory(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteProductCategory(input.id);
      return { success: true };
    }),

  reorder: adminProcedure
    .input(z.object({ categoryIds: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      await db.reorderProductCategories(input.categoryIds);
      return { success: true };
    }),

  updateCount: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.updateProductCategoryCount(input.id);
      return { success: true };
    }),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    setupAdmin: publicProcedure
      .input(z.object({
        username: z.string().min(3).max(50),
        email: z.string().email(),
        name: z.string().min(1),
        password: z.string().min(8),
      }))
      .mutation(async ({ input }) => {
        // Check if any admin exists
        const existingAdmins = await db.getUsersByRole('admin');
        if (existingAdmins.length > 0) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin already exists' });
        }
        
        // Check if username already exists
        const existingUser = await db.getUserByUsername(input.username);
        if (existingUser) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Tên đăng nhập đã tồn tại' });
        }
        
        // Create first admin user
        const userId = await db.createUser({
          username: input.username,
          email: input.email,
          name: input.name,
          password: input.password,
          role: 'admin',
        });
        
        return { success: true, userId };
      }),
  }),

  // Feature routers
  factory: factoryRouter,
  workshop: workshopRouter,
  line: lineRouter,
  station: stationRouter,
  machine: machineRouter,
  productModel: productModelRouter,
  measurementPoint: measurementPointRouter,
  inspection: inspectionRouter,
  measurementResult: measurementResultRouter,
  layout: layoutRouter,
  dashboard: dashboardRouter,
  machineApi: machineApiRouter,
  seedData: seedDataRouter,
  alert: alertRouter,
  user: userRouter,
  productMachineMapping: productMachineMappingRouter,
  shiftConfig: shiftConfigRouter,
  productionOrder: productionOrderRouter,
  lineStage: lineStageRouter,
  lineProductAssignment: lineProductAssignmentRouter,
  machineStatus: machineStatusRouter,
  bulkImport: bulkImportRouter,
  manualMapping: manualMappingRouter,
  yieldThreshold: yieldThresholdRouter,
  audit: auditRouter,
  workstation: workstationRouter,
  template: templateRouter,
  scheduledReport: scheduledReportRouter,
  smtp: smtpRouter,
  mqttClient: mqttClientRouter,
  mqttAlert: mqttAlertRouter,
  systemConfig: systemConfigRouter,
  corporateFactoryStats: corporateFactoryStatsRouter,
  import: importRouter,
  export: exportRouter,
  userAssignment: userAssignmentRouter,
  notification: notificationRouter,
  userSettingsRouter: userSettingsRouter,
  dashboardWidget: dashboardWidgetRouter,
  process: processRouter,
  spcAnalysis: spcAnalysisRouter,
  twoFactor: twoFactorRouter,
  session: sessionRouter,
  productCategory: productCategoryRouter,
});

export type AppRouter = typeof appRouter;
