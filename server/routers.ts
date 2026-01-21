import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { emitNGAlert, emitYieldWarning, emitDashboardUpdate } from "./_core/socket";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "./db";
import { storagePut } from "./storage";
import { invokeLLM } from "./_core/llm";
import { statsCache, CACHE_KEYS, CACHE_TTL } from "./_core/cache";

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
      serialNumber: z.string().optional(),
      result: z.enum(["OK", "NG", "NTF"]).optional(),
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().min(1).max(1000).optional(),
      offset: z.number().min(0).optional(),
    }))
    .query(async ({ input }) => {
      return db.getProductInspections(input);
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
      apiKey: z.string(),
      serialNumber: z.string(),
      productModel: z.string().optional(),
      batchNumber: z.string().optional(),
      overallResult: z.enum(["OK", "NG"]),
      inspectionTime: z.string().optional(),
      cycleTime: z.number().optional(),
      // New fields for enterprise integration
      companyCode: z.string().optional(), // Mã công ty
      factoryCode: z.string().optional(), // Mã nhà máy
      workshopCode: z.string().optional(), // Mã nhà xưởng
      lineCode: z.string().optional(), // Mã dây chuyền
      stageCode: z.string().optional(), // Mã công đoạn
      productionOrderCode: z.string().optional(), // Mã lệnh sản xuất
      operatorId: z.string().optional(), // Mã công nhân
      measurements: z.array(z.object({
        pointCode: z.string(),
        measuredValue: z.number().optional(),
        result: z.enum(["OK", "NG"]),
        remark: z.string().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      // Validate API key
      const machine = await db.getMachineByApiKey(input.apiKey);
      if (!machine) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Invalid API key' });
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

      // Process measurements
      const measurementResults = [];
      for (const measurement of input.measurements) {
        const pointDef = await db.getMeasurementPointDefByCode(machine.id, measurement.pointCode);
        if (pointDef) {
          measurementResults.push({
            inspectionId,
            pointDefId: pointDef.id,
            measuredValue: measurement.measuredValue ? String(measurement.measuredValue) : undefined,
            result: measurement.result,
            remark: measurement.remark,
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
      }

      // Invalidate cache after new inspection
      statsCache.invalidate(CACHE_KEYS.DASHBOARD_STATS);
      statsCache.invalidate(CACHE_KEYS.MACHINE_STATS);
      statsCache.invalidate(CACHE_KEYS.DAILY_STATS);

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
    }))
    .mutation(async ({ input, ctx }) => {
      const id = await db.createScheduledReport({
        ...input,
        createdBy: ctx.user.id,
      });
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
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateScheduledReport(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
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
        
        // Create first admin user
        const userId = await db.createUser({
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
});

export type AppRouter = typeof appRouter;
