import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "../db";
import { storagePut } from "../storage";
import { emitNGAlert, emitYieldWarning, emitDashboardUpdate } from "../_core/socket";
import { statsCache, CACHE_KEYS } from "../_core/cache";
import * as cachedStats from "../functions/cachedStatistics";
import {
  type PointDefCache,
  type WorkstationCache,
  resolveMeasurementPointDefinition,
  resolveWorkstationId,
  toOptionalDecimal,
  cleanUndefined,
  uploadPointReferenceImage,
} from "./_shared";

const measurementTypeValueList = [
  "DIMENSION",
  "VISUAL",
  "ELECTRICAL",
  "POSITION",
  "COLOR",
  "SURFACE",
  "OTHER",
] as const;

const measurementPointSyncSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(255),
  description: z.string().optional(),
  measurementType: z.preprocess(
    (val) => (typeof val === "string" ? val.toUpperCase() : val),
    z.enum(measurementTypeValueList)
  ).default("VISUAL"),
  unit: z.string().max(20).optional(),
  lowerLimit: z.union([z.string(), z.number()]).optional(),
  upperLimit: z.union([z.string(), z.number()]).optional(),
  nominalValue: z.union([z.string(), z.number()]).optional(),
  positionX: z.number().int(),
  positionY: z.number().int(),
  radius: z.number().int().positive().optional(),
  cropWidth: z.number().int().positive().optional(),
  cropHeight: z.number().int().positive().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
  workstationCode: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  imageBase64: z.string().optional(),
  imageMimeType: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

// ============ MACHINE API ROUTER (for external machine integration) ============
export const machineApiRouter = router({
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
        machine = await db.getMachineByCode(input.machineCode.trim());
      }
      
      if (!machine) {
        throw new TRPCError({ 
          code: 'UNAUTHORIZED', 
          message: input.apiKey ? 'Invalid API key' : 'Invalid machine code' 
        });
      }

      const normalizedProductModelCode = input.productModel?.trim();
      const productModelRecord = normalizedProductModelCode
        ? await db.getProductModelByCode(normalizedProductModelCode)
        : undefined;
      const resolvedProductModelCode = productModelRecord?.code || normalizedProductModelCode;

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
        productModelId: productModelRecord?.id,
        productModel: resolvedProductModelCode,
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
      const productPointCache: PointDefCache = new Map();
      const machinePointCache: PointDefCache = new Map();
      const missingPointCodes: string[] = []; // Track missing point definitions
      
      for (const measurement of input.measurements) {
        const candidateCodes = [measurement.pointId, measurement.pointCode].filter((code): code is string => Boolean(code));
        let pointDef: Awaited<ReturnType<typeof resolveMeasurementPointDefinition>> = null;
        let usedCode: string | undefined;
        
        for (const code of candidateCodes) {
          pointDef = await resolveMeasurementPointDefinition(
            code,
            productModelRecord?.id,
            machine.id,
            productPointCache,
            machinePointCache,
          );
          if (pointDef) {
            usedCode = code;
            break;
          }
        }

        // Even if point definition not found, still save measurement with pointDefId = 0
        // This allows data to be captured even if point is not pre-configured
        const pointCode = measurement.pointId || measurement.pointCode || 'UNKNOWN';
        if (!pointDef) {
          missingPointCodes.push(pointCode);
          console.warn(`[submitInspection] Point definition not found for: ${pointCode} (machine: ${machine.code}, product: ${resolvedProductModelCode || 'N/A'})`);
        }

        // Route measuredValue to the correct DB column based on type
        const rawValue = measurement.measuredValue;
        let numericValue: string | undefined = undefined;
        let textValue: string | undefined = undefined;
        if (rawValue !== undefined && rawValue !== null) {
          const num = Number(rawValue);
          if (!isNaN(num) && rawValue !== '') {
            numericValue = String(num); // decimal column accepts numeric string
          } else {
            textValue = String(rawValue); // non-numeric → measuredValueText
          }
        }

        // Auto-upload image to storage if base64 is provided
        let uploadedImageUrl: string | undefined = undefined;
        let uploadedImageKey: string | undefined = undefined;
        if (measurement.imageBase64 && measurement.imageBase64.length > 200) {
          try {
            // If already a URL, use as-is
            if (measurement.imageBase64.startsWith('http') || measurement.imageBase64.startsWith('/uploads')) {
              uploadedImageUrl = measurement.imageBase64;
            } else {
              // Strip data URI prefix if present
              const base64Data = measurement.imageBase64.replace(/^data:image\/[^;]+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');
              const ext = measurement.imageBase64.startsWith('data:image/png') ? 'png' : 'jpg';
              const fileKey = `inspections/${inspectionId}/${pointCode}-${nanoid(8)}.${ext}`;
              const { url } = await storagePut(fileKey, buffer, `image/${ext === 'png' ? 'png' : 'jpeg'}`);
              uploadedImageUrl = url;
              uploadedImageKey = fileKey;
            }
          } catch (imgErr) {
            console.error(`[submitInspection] Image upload failed for point ${pointCode}:`, imgErr);
          }
        }

        measurementResults.push({
          inspectionId,
          pointDefId: pointDef?.id || 0,
          measuredValue: numericValue,
          measuredValueText: textValue,
          result: measurement.result,
          remark: measurement.remark || (pointDef ? undefined : `Point: ${pointCode}`),
          imageUrl: uploadedImageUrl,
          imageKey: uploadedImageKey,
        });
      }
      
      // Log summary of missing point definitions
      if (missingPointCodes.length > 0) {
        console.warn(`[submitInspection] ${missingPointCodes.length} measurement(s) saved without point definition: ${missingPointCodes.join(', ')}`);
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
          const { publishNGAlert } = await import('../services/mqttService');
          const productModelInfo = productModelRecord || null;
          
          // Build pointCode→imageUrl lookup from auto-uploaded images
          const pointImageMap = new Map<string, string>();
          // Build pointCode→referenceImageUrl lookup from resolved point definitions
          const pointRefImageMap = new Map<string, string>();
          if (input.measurements) {
            for (let i = 0; i < input.measurements.length; i++) {
              const m = input.measurements[i];
              const mr = measurementResults[i];
              if (mr?.imageUrl) {
                const code = m.pointId || m.pointCode || 'UNKNOWN';
                pointImageMap.set(code, mr.imageUrl);
              }
              // Lookup reference image from resolved pointDef cache
              const code = m.pointId || m.pointCode || 'UNKNOWN';
              const normalizedCode = code.trim();
              // Check product cache first, then machine cache
              const cachedDef = productPointCache.get(normalizedCode) || machinePointCache.get(normalizedCode);
              if (cachedDef?.referenceImageUrl) {
                pointRefImageMap.set(code, cachedDef.referenceImageUrl);
              }
            }
          }

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
            // Enhanced product info
            productModelId: productModelInfo?.id,
            productModelName: productModelInfo?.name || resolvedProductModelCode,
            productModelCode: productModelInfo?.code || resolvedProductModelCode,
            // Measurement results with proper uploaded image URLs (not base64)
            measurementResults: input.measurements?.filter(m => m.result === 'NG').map(m => {
              const pointCode = m.pointId || m.pointCode || 'UNKNOWN';
              return {
                pointId: undefined,
                pointCode,
                result: m.result,
                value: m.measuredValue,
                imageUrl: pointImageMap.get(pointCode),
                referenceImageUrl: pointRefImageMap.get(pointCode),
              };
            }) || [],
            // Determine severity based on NG count
            severity: (input.measurements?.filter(m => m.result === 'NG').length || 0) >= 3 ? 'critical' : 'high',
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

      // Check NG rate thresholds per measurement point → auto MQTT alert
      try {
        const { checkNgRateAfterInspection } = await import('../services/ngRateAlertService');
        // Run async, don't block the response
        checkNgRateAfterInspection({
          stationId: machine.stationId,
          machineId: machine.id,
          inspectionId,
          productModelId: productModelRecord?.id,
        }).catch(err => {
          console.error('[NgRateAlert] Failed to check NG rate thresholds:', err);
        });
      } catch (ngRateErr) {
        console.error('[NgRateAlert] Failed to import ngRateAlertService:', ngRateErr);
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

      const inspection = await db.getProductInspectionById(input.inspectionId);
      if (!inspection) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Inspection not found' });
      }

      const inspectionModel = inspection.productModelId
        ? await db.getProductModelById(inspection.productModelId)
        : inspection.productModel
          ? await db.getProductModelByCode(inspection.productModel.trim())
          : undefined;

      const productPointCache: PointDefCache = new Map();
      const machinePointCache: PointDefCache = new Map();
      const pointDef = await resolveMeasurementPointDefinition(
        input.pointCode,
        inspectionModel?.id,
        machine.id,
        productPointCache,
        machinePointCache,
      );
      if (!pointDef) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Measurement point not found' });
      }

      // Find the measurement result
      const { measurementResults } = await import("../../drizzle/schema");
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

  syncMeasurementPoints: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      points: z.array(measurementPointSyncSchema).min(1),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .mutation(async ({ input }) => {
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode.trim());
      }

      if (!machine) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: input.apiKey ? 'Invalid API key' : 'Invalid machine code' });
      }

      await db.updateMachineHeartbeat(machine.id);

      const normalizedModelCode = input.productModelCode.trim();
      const productModel = await db.getProductModelByCode(normalizedModelCode);
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product model not found' });
      }

      const workstationCache: WorkstationCache = new Map();
      const results: Array<{ code: string; id: number; action: 'created' | 'updated' }> = [];
      const errors: Array<{ code: string; message: string }> = [];

      for (let index = 0; index < input.points.length; index++) {
        const point = input.points[index];
        try {
          const existing = await db.getMeasurementPointDefByCode(productModel.id, point.code);
          const workstationId = await resolveWorkstationId(point.workstationCode, workstationCache);
          const referenceImage = await uploadPointReferenceImage(
            productModel.id,
            point.code,
            point.imageBase64,
            point.imageMimeType,
            point.imageUrl,
          );

          if (existing) {
            const updatePayload = cleanUndefined({
              name: point.name,
              description: point.description,
              measurementType: point.measurementType,
              unit: point.unit,
              lowerLimit: toOptionalDecimal(point.lowerLimit),
              upperLimit: toOptionalDecimal(point.upperLimit),
              nominalValue: toOptionalDecimal(point.nominalValue),
              positionX: point.positionX,
              positionY: point.positionY,
              radius: point.radius,
              cropWidth: point.cropWidth,
              cropHeight: point.cropHeight,
              orderIndex: point.orderIndex,
              workstationId,
              machineId: machine.id,
              isActive: point.isActive ?? true,
              updatedAt: new Date(),
            });

            if (referenceImage) {
              Object.assign(updatePayload, { referenceImageUrl: referenceImage.url });
              if (referenceImage.key) {
                Object.assign(updatePayload, { referenceImageKey: referenceImage.key });
              }
            }

            await db.updateMeasurementPointDef(existing.id, updatePayload);
            results.push({ code: point.code, id: existing.id, action: 'updated' });
          } else {
            const newPoint = {
              productModelId: productModel.id,
              machineId: machine.id,
              workstationId,
              code: point.code,
              name: point.name,
              description: point.description,
              measurementType: point.measurementType,
              unit: point.unit,
              lowerLimit: toOptionalDecimal(point.lowerLimit),
              upperLimit: toOptionalDecimal(point.upperLimit),
              nominalValue: toOptionalDecimal(point.nominalValue),
              positionX: point.positionX,
              positionY: point.positionY,
              radius: point.radius ?? 20,
              cropWidth: point.cropWidth ?? 100,
              cropHeight: point.cropHeight ?? 100,
              orderIndex: point.orderIndex ?? index,
              isActive: point.isActive ?? true,
            };

            if (referenceImage) {
              Object.assign(newPoint, { referenceImageUrl: referenceImage.url });
              if (referenceImage.key) {
                Object.assign(newPoint, { referenceImageKey: referenceImage.key });
              }
            }

            const id = await db.createMeasurementPointDef(newPoint);
            results.push({ code: point.code, id, action: 'created' });
          }
        } catch (error) {
          errors.push({
            code: point.code,
            message: error instanceof TRPCError
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Unknown error',
          });
        }
      }

      const createdCount = results.filter((r) => r.action === 'created').length;
      const updatedCount = results.filter((r) => r.action === 'updated').length;

      return {
        success: errors.length === 0,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        total: input.points.length,
        created: createdCount,
        updated: updatedCount,
        failed: errors.length,
        points: results,
        errors,
      };
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

  // ============================================================
  // GET Points — Machine client downloads measurement point definitions from server
  // Direction 2: Server → Client (machine pulls points)
  // ============================================================
  getPoints: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1).optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input }) => {
      // Authenticate machine
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode.trim());
      }

      if (!machine) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: input.apiKey ? 'Invalid API key' : 'Invalid machine code',
        });
      }

      // Update heartbeat
      await db.updateMachineHeartbeat(machine.id);

      // If productModelCode is provided, get points for that specific product model
      if (input.productModelCode) {
        const normalizedModelCode = input.productModelCode.trim();
        const productModel = await db.getProductModelByCode(normalizedModelCode);
        if (!productModel) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${normalizedModelCode}' not found` });
        }

        const points = await db.getMeasurementPointDefsByProductModel(productModel.id);

        return {
          success: true,
          machineId: machine.id,
          machineCode: machine.code,
          productModels: [{
            productModelId: productModel.id,
            productModelCode: productModel.code,
            productModelName: productModel.name,
            totalPoints: points.length,
            points: points.map((p) => ({
              id: p.id,
              code: p.code,
              name: p.name,
              description: p.description,
              measurementType: p.measurementType,
              unit: p.unit,
              lowerLimit: p.lowerLimit,
              upperLimit: p.upperLimit,
              nominalValue: p.nominalValue,
              positionX: p.positionX,
              positionY: p.positionY,
              radius: p.radius,
              cropWidth: p.cropWidth,
              cropHeight: p.cropHeight,
              orderIndex: p.orderIndex,
              referenceImageUrl: p.referenceImageUrl,
              isActive: p.isActive,
              workstationId: p.workstationId,
            })),
          }],
        };
      }

      // No productModelCode: get all points for all product models mapped to this machine
      const mappings = await db.getMappingsByMachine(machine.id);
      const productModels: Array<{
        productModelId: number;
        productModelCode: string;
        productModelName: string;
        totalPoints: number;
        points: Array<Record<string, unknown>>;
      }> = [];

      for (const { product: pm } of mappings) {
        if (!pm) continue;

        const points = await db.getMeasurementPointDefsByProductModel(pm.id);
        productModels.push({
          productModelId: pm.id,
          productModelCode: pm.code,
          productModelName: pm.name,
          totalPoints: points.length,
          points: points.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            description: p.description,
            measurementType: p.measurementType,
            unit: p.unit,
            lowerLimit: p.lowerLimit,
            upperLimit: p.upperLimit,
            nominalValue: p.nominalValue,
            positionX: p.positionX,
            positionY: p.positionY,
            radius: p.radius,
            cropWidth: p.cropWidth,
            cropHeight: p.cropHeight,
            orderIndex: p.orderIndex,
            referenceImageUrl: p.referenceImageUrl,
            isActive: p.isActive,
            workstationId: p.workstationId,
          })),
        });
      }

      return {
        success: true,
        machineId: machine.id,
        machineCode: machine.code,
        productModels,
      };
    }),
});
