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
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateFactory(id, data);
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
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      await db.updateMachine(id, data);
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await db.deleteMachine(input.id);
      return { success: true };
    }),
});

// ============ PRODUCT MODEL ROUTER ============
const productModelRouter = router({
  list: protectedProcedure.query(async () => {
    return db.getProductModels();
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
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      imageWidth: z.number().optional(),
      imageHeight: z.number().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      let finalData = { ...data };
      
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
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      orderIndex: z.number().optional(),
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

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
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
});

export type AppRouter = typeof appRouter;
