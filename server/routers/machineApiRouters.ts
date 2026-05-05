import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import * as db from "../db";
import { storagePut, storageGet, resolveImageToDataUrl } from "../storage";
import { emitNGAlert, emitYieldWarning, emitDashboardUpdate } from "../_core/socket";
import { statsCache, CACHE_KEYS } from "../_core/cache";
import * as cachedStats from "../functions/cachedStatistics";
import { publishPointsConfigChanged } from "../services/mqttService";
import {
  type PointDefCache,
  type WorkstationCache,
  resolveMeasurementPointDefinition,
  resolveWorkstationId,
  toOptionalDecimal,
  cleanUndefined,
  computeImageHash,
  uploadPointReferenceImage,
  uploadProductReferenceImage,
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
  // Normalized coordinates (0.0 - 1.0) relative to source image dimensions
  // If provided, these take priority over absolute coordinates for cross-resolution sync
  normalizedX: z.number().min(0).max(1).optional(),
  normalizedY: z.number().min(0).max(1).optional(),
  normalizedRadius: z.number().min(0).max(1).optional(),
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
      overallResult: z.enum(["OK", "NG", "NTF"]), // Kết quả tổng thể
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
        result: z.enum(["OK", "NG", "NTF"]), // Kết quả
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
      // Fix timezone: Drizzle ORM serializes Date via .toISOString() (UTC),
      // but timestamp without time zone strips Z → stores UTC value.
      // Shift to "fake UTC" so PostgreSQL stores local time.
      const rawInspTime = input.inspectionTime ? new Date(input.inspectionTime) : new Date();
      const localInspTime = new Date(rawInspTime.getTime() - rawInspTime.getTimezoneOffset() * 60000);

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
        workshopCode: input.workshopCode, // Mã nhà xưởng
        lineCode: input.lineCode, // Mã dây chuyền
        stageCode: input.stageCode, // Mã công đoạn
        productionOrderCode: input.productionOrderCode, // Mã lệnh sản xuất
        operatorId: input.operatorId, // Mã công nhân vận hành
        inspectionTime: localInspTime,
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
            // Overall inspection result
            overallResult: input.overallResult,
            // Measurement results with proper uploaded image URLs (not base64)
            measurementResults: input.measurements?.filter(m => m.result === 'NG').map(m => {
              const pointCode = m.pointId || m.pointCode || 'UNKNOWN';
              const normalizedPc = pointCode.trim();
              const def = productPointCache.get(normalizedPc) || machinePointCache.get(normalizedPc);
              return {
                pointId: def?.id,
                pointCode,
                result: m.result,
                value: m.measuredValue,
                imageUrl: pointImageMap.get(pointCode),
                referenceImageUrl: pointRefImageMap.get(pointCode),
                workstationId: def?.workstationId ?? undefined,
                normalizedX: def?.normalizedX != null ? Number(def.normalizedX) : undefined,
                normalizedY: def?.normalizedY != null ? Number(def.normalizedY) : undefined,
                normalizedRadius: def?.normalizedRadius != null ? Number(def.normalizedRadius) : undefined,
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
      // Source image dimensions from the third-party app
      // Used to auto-transform absolute pixel coordinates when resolutions differ
      sourceImageWidth: z.number().int().positive().optional(),
      sourceImageHeight: z.number().int().positive().optional(),
      clientVersion: z.string().max(50).optional(),
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

      const syncStartTime = Date.now();
      const normalizedModelCode = input.productModelCode.trim();
      const productModel = await db.getProductModelByCode(normalizedModelCode);
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product model not found' });
      }

      const workstationCache: WorkstationCache = new Map();
      const results: Array<{ code: string; id: number; action: 'created' | 'updated'; coordTransformed?: boolean }> = [];
      const errors: Array<{ code: string; message: string }> = [];

      // Coordinate normalization helpers
      const serverW = productModel.imageWidth;
      const serverH = productModel.imageHeight;
      const sourceW = input.sourceImageWidth;
      const sourceH = input.sourceImageHeight;
      const hasServerDimensions = serverW != null && serverH != null && serverW > 0 && serverH > 0;

      /**
       * Resolve coordinates: handles 3 scenarios:
       * 1. Client sends normalizedX/Y → compute absolute from server dimensions
       * 2. Client sends sourceImageWidth/Height (different from server) → transform absolute coords
       * 3. Same resolution or no info → use absolute coords as-is
       * Always computes normalizedX/Y for storage
       */
      function resolveCoordinates(point: typeof input.points[0]) {
        let finalX = point.positionX;
        let finalY = point.positionY;
        let finalRadius = point.radius ?? 20;
        let normX: string | undefined;
        let normY: string | undefined;
        let normR: string | undefined;
        let transformed = false;

        if (point.normalizedX != null && point.normalizedY != null && hasServerDimensions) {
          // Case 1: Client sent normalized coordinates → compute absolute for server image
          finalX = Math.round(point.normalizedX * serverW!);
          finalY = Math.round(point.normalizedY * serverH!);
          normX = point.normalizedX.toFixed(8);
          normY = point.normalizedY.toFixed(8);
          if (point.normalizedRadius != null) {
            finalRadius = Math.round(point.normalizedRadius * serverW!);
            normR = point.normalizedRadius.toFixed(8);
          }
          transformed = true;
        } else if (sourceW && sourceH && hasServerDimensions && (sourceW !== serverW || sourceH !== serverH)) {
          // Case 2: Source resolution differs from server → transform coordinates
          const scaleX = serverW! / sourceW;
          const scaleY = serverH! / sourceH;
          finalX = Math.round(point.positionX * scaleX);
          finalY = Math.round(point.positionY * scaleY);
          finalRadius = Math.round(finalRadius * scaleX);
          normX = (finalX / serverW!).toFixed(8);
          normY = (finalY / serverH!).toFixed(8);
          normR = (finalRadius / serverW!).toFixed(8);
          transformed = true;
        } else if (hasServerDimensions) {
          // Case 3: Same resolution or no source info → compute normalized from absolute
          normX = (point.positionX / serverW!).toFixed(8);
          normY = (point.positionY / serverH!).toFixed(8);
          normR = (finalRadius / serverW!).toFixed(8);
        }

        return { finalX, finalY, finalRadius, normX, normY, normR, transformed };
      }

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

          const { finalX, finalY, finalRadius, normX, normY, normR, transformed } = resolveCoordinates(point);

          if (existing) {
            const updatePayload = cleanUndefined({
              name: point.name,
              description: point.description,
              measurementType: point.measurementType,
              unit: point.unit,
              lowerLimit: toOptionalDecimal(point.lowerLimit),
              upperLimit: toOptionalDecimal(point.upperLimit),
              nominalValue: toOptionalDecimal(point.nominalValue),
              positionX: finalX,
              positionY: finalY,
              radius: finalRadius,
              normalizedX: normX,
              normalizedY: normY,
              normalizedRadius: normR,
              cropWidth: point.cropWidth,
              cropHeight: point.cropHeight,
              orderIndex: point.orderIndex,
              workstationId,
              machineId: machine.id,
              isActive: point.isActive ?? true,
              updatedAt: new Date(),
              lastModifiedAt: new Date(),
            });

            if (referenceImage) {
              Object.assign(updatePayload, { referenceImageUrl: referenceImage.url });
              if (referenceImage.key) {
                Object.assign(updatePayload, { referenceImageKey: referenceImage.key });
              }
              // Compute and store image hash for deduplication
              if (referenceImage.hash) {
                Object.assign(updatePayload, { imageHash: referenceImage.hash });
              }
            }

            await db.updateMeasurementPointDef(existing.id, updatePayload);
            results.push({ code: point.code, id: existing.id, action: 'updated', coordTransformed: transformed });
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
              positionX: finalX,
              positionY: finalY,
              radius: finalRadius,
              normalizedX: normX,
              normalizedY: normY,
              normalizedRadius: normR,
              cropWidth: point.cropWidth ?? 100,
              cropHeight: point.cropHeight ?? 100,
              orderIndex: point.orderIndex ?? index,
              isActive: point.isActive ?? true,
              lastModifiedAt: new Date(),
            };

            if (referenceImage) {
              Object.assign(newPoint, { referenceImageUrl: referenceImage.url });
              if (referenceImage.key) {
                Object.assign(newPoint, { referenceImageKey: referenceImage.key });
              }
              if (referenceImage.hash) {
                Object.assign(newPoint, { imageHash: referenceImage.hash });
              }
            }

            const id = await db.createMeasurementPointDef(newPoint);
            results.push({ code: point.code, id, action: 'created', coordTransformed: transformed });
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
      const transformedCount = results.filter((r) => r.coordTransformed).length;

      // Bump pointsConfigVersion if any points were created or updated
      let newConfigVersion = productModel.pointsConfigVersion ?? 1;
      if (results.length > 0) {
        newConfigVersion += 1;
        await db.updateProductModel(productModel.id, {
          pointsConfigVersion: newConfigVersion,
          updatedAt: new Date(),
        });

        // Notify all subscribers about config change
        publishPointsConfigChanged(productModel.code, newConfigVersion, input.machineCode);
      }

      const syncDurationMs = Date.now() - syncStartTime;

      // Log sync operation
      db.createProductSyncLog({
        machineId: machine.id,
        machineCode: input.machineCode ?? machine.code,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        syncOperation: "POINTS_PUSH",
        syncStatus: errors.length === 0 ? "SUCCESS" : errors.length < input.points.length ? "PARTIAL" : "FAILED",
        pointsSynced: results.length,
        pointsCreated: createdCount,
        pointsUpdated: updatedCount,
        pointsFailed: errors.length,
        errorDetails: errors.length > 0 ? errors : null,
        sourceImageWidth: input.sourceImageWidth ?? null,
        sourceImageHeight: input.sourceImageHeight ?? null,
        serverImageWidth: productModel.imageWidth ?? null,
        serverImageHeight: productModel.imageHeight ?? null,
        coordTransformations: transformedCount,
        fromVersion: productModel.pointsConfigVersion ?? 1,
        toVersion: newConfigVersion,
        durationMs: syncDurationMs,
        clientVersion: input.clientVersion ?? null,
      }).catch(() => {}); // fire-and-forget, don't block response

      return {
        success: errors.length === 0,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        pointsConfigVersion: newConfigVersion,
        total: input.points.length,
        created: createdCount,
        updated: updatedCount,
        failed: errors.length,
        coordTransformed: transformedCount,
        serverImageWidth: productModel.imageWidth,
        serverImageHeight: productModel.imageHeight,
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
  // CHECK Points Config Version — Lightweight check to see if points need re-sync
  // Returns the current pointsConfigVersion for each product model
  // Client compares with its cached version to decide whether to call getPoints
  // ============================================================
  checkPointsVersion: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1).optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input }) => {
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode.trim());
      }
      if (!machine) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: input.apiKey ? 'Invalid API key' : 'Invalid machine code' });
      }

      if (input.productModelCode) {
        const productModel = await db.getProductModelByCode(input.productModelCode.trim());
        if (!productModel) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
        }
        return {
          success: true,
          productModels: [{
            productModelCode: productModel.code,
            pointsConfigVersion: productModel.pointsConfigVersion,
            imageWidth: productModel.imageWidth,
            imageHeight: productModel.imageHeight,
          }],
        };
      }

      // All product models mapped to this machine
      const mappings = await db.getMappingsByMachine(machine.id);
      return {
        success: true,
        productModels: mappings
          .filter(m => m.product)
          .map(m => ({
            productModelCode: m.product!.code,
            pointsConfigVersion: m.product!.pointsConfigVersion,
            imageWidth: m.product!.imageWidth,
            imageHeight: m.product!.imageHeight,
          })),
      };
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
            referenceImageUrl: productModel.referenceImageUrl,
            imageWidth: productModel.imageWidth,
            imageHeight: productModel.imageHeight,
            pointsConfigVersion: productModel.pointsConfigVersion,
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
              normalizedX: p.normalizedX ? Number(p.normalizedX) : null,
              normalizedY: p.normalizedY ? Number(p.normalizedY) : null,
              normalizedRadius: p.normalizedRadius ? Number(p.normalizedRadius) : null,
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
        referenceImageUrl: string | null;
        imageWidth: number | null;
        imageHeight: number | null;
        pointsConfigVersion: number;
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
          referenceImageUrl: pm.referenceImageUrl,
          imageWidth: pm.imageWidth,
          imageHeight: pm.imageHeight,
          pointsConfigVersion: pm.pointsConfigVersion,
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
            normalizedX: p.normalizedX ? Number(p.normalizedX) : null,
            normalizedY: p.normalizedY ? Number(p.normalizedY) : null,
            normalizedRadius: p.normalizedRadius ? Number(p.normalizedRadius) : null,
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

  // ============================================================
  // GET Product Image — Machine client downloads product reference image from server
  // Direction: Server → AOI Machine
  // ============================================================
  getProductImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input }) => {
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

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      if (!productModel.referenceImageUrl && !productModel.referenceImageKey) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Product has no reference image' });
      }

      let downloadUrl = productModel.referenceImageUrl;
      if (productModel.referenceImageKey) {
        const result = await storageGet(productModel.referenceImageKey);
        downloadUrl = result.url;
      }

      // Convert relative /uploads/ URLs to base64 data URLs for external clients
      const imageUrl = await resolveImageToDataUrl(downloadUrl);

      return {
        success: true,
        data: {
          productModelId: productModel.id,
          productModelCode: productModel.code,
          productModelName: productModel.name,
          imageUrl,
          imageWidth: productModel.imageWidth,
          imageHeight: productModel.imageHeight,
        },
      };
    }),

  // ============================================================
  // SYNC Product Image — Machine pushes product reference image to server (AOI → Server)
  // ============================================================
  syncProductImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      imageBase64: z.string().optional(),
      imageMimeType: z.string().optional(),
      imageUrl: z.string().url().optional(),
      imageWidth: z.number().int().positive().optional(),
      imageHeight: z.number().int().positive().optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }).refine((data) => data.imageBase64 || data.imageUrl, {
      message: 'Either imageBase64 or imageUrl must be provided',
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

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      // Compute image hash for deduplication
      const imageData = input.imageBase64 || input.imageUrl;
      let newHash: string | null = null;
      let imageSkipped = false;

      if (input.imageBase64 && input.imageBase64.trim().length > 0 && !/^https?:\/\//i.test(input.imageBase64.trim())) {
        newHash = computeImageHash(input.imageBase64);

        // Skip upload if hash matches existing
        if (productModel.imageHash && productModel.imageHash === newHash) {
          imageSkipped = true;
          // Log skipped sync
          db.createProductSyncLog({
            machineId: machine.id,
            machineCode: input.machineCode ?? machine.code,
            productModelId: productModel.id,
            productModelCode: productModel.code,
            syncOperation: "IMAGE_PUSH",
            syncStatus: "SUCCESS",
            imageHashBefore: productModel.imageHash,
            imageHashAfter: newHash,
            imageSkipped: true,
          }).catch(() => {});

          return {
            success: true,
            machineId: machine.id,
            productModelId: productModel.id,
            productModelCode: productModel.code,
            imageSkipped: true,
            imageHash: newHash,
            message: "Image unchanged (hash match), upload skipped",
          };
        }
      }

      const referenceImage = await uploadProductReferenceImage(
        productModel.id,
        input.imageBase64,
        input.imageMimeType,
        input.imageUrl,
      );

      if (!referenceImage) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid image data provided' });
      }

      const updatePayload: Record<string, unknown> = {
        referenceImageUrl: referenceImage.url,
        updatedAt: new Date(),
      };
      if (referenceImage.key) {
        updatePayload.referenceImageKey = referenceImage.key;
      }
      if (input.imageWidth) {
        updatePayload.imageWidth = input.imageWidth;
      }
      if (input.imageHeight) {
        updatePayload.imageHeight = input.imageHeight;
      }
      if (newHash) {
        updatePayload.imageHash = newHash;
      }

      await db.updateProductModel(productModel.id, updatePayload);

      // Log image sync
      db.createProductSyncLog({
        machineId: machine.id,
        machineCode: input.machineCode ?? machine.code,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        syncOperation: "IMAGE_PUSH",
        syncStatus: "SUCCESS",
        imageHashBefore: productModel.imageHash ?? null,
        imageHashAfter: newHash,
        imageSkipped: false,
      }).catch(() => {});

      return {
        success: true,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        imageUrl: referenceImage.url,
        imageKey: referenceImage.key,
        imageHash: newHash,
        imageSkipped: false,
      };
    }),

  // ============================================================
  // SYNC Point Reference Image — Upload reference image for a single measurement point
  // Dedicated endpoint so the App doesn't have to re-sync all points just to update one image
  // Direction: AOI App → Server
  // ============================================================
  syncPointImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      pointCode: z.string().trim().min(1),
      imageBase64: z.string().optional(),
      imageMimeType: z.string().optional(),
      imageUrl: z.string().url().optional(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }).refine((data) => data.imageBase64 || data.imageUrl, {
      message: 'Either imageBase64 or imageUrl must be provided',
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

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      const existing = await db.getMeasurementPointDefByCode(productModel.id, input.pointCode.trim());
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Measurement point '${input.pointCode}' not found in product model '${input.productModelCode}'` });
      }

      // Compute image hash for deduplication (same pattern as syncProductImage)
      let pointImageHash: string | null = null;
      if (input.imageBase64 && input.imageBase64.trim().length > 0 && !/^https?:\/\//i.test(input.imageBase64.trim())) {
        pointImageHash = computeImageHash(input.imageBase64);
        // Skip upload if hash matches existing point image hash
        if (existing.imageHash && existing.imageHash === pointImageHash) {
          return {
            success: true,
            machineId: machine.id,
            productModelId: productModel.id,
            productModelCode: productModel.code,
            pointId: existing.id,
            pointCode: existing.code,
            referenceImageUrl: existing.referenceImageUrl,
            referenceImageKey: existing.referenceImageKey ?? null,
            imageSkipped: true,
            imageHash: pointImageHash,
            message: 'Image unchanged (hash match), upload skipped',
          };
        }
      }

      const referenceImage = await uploadPointReferenceImage(
        productModel.id,
        input.pointCode.trim(),
        input.imageBase64,
        input.imageMimeType,
        input.imageUrl,
      );

      if (!referenceImage) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No valid image data provided' });
      }

      const updatePayload: Record<string, unknown> = {
        referenceImageUrl: referenceImage.url,
        updatedAt: new Date(),
        lastModifiedAt: new Date(),
      };
      if (referenceImage.key) {
        updatePayload.referenceImageKey = referenceImage.key;
      }
      if (pointImageHash) {
        updatePayload.imageHash = pointImageHash;
      }

      await db.updateMeasurementPointDef(existing.id, updatePayload);

      return {
        success: true,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        pointId: existing.id,
        pointCode: existing.code,
        referenceImageUrl: referenceImage.url,
        referenceImageKey: referenceImage.key,
        imageSkipped: false,
        imageHash: pointImageHash,
      };
    }),

  // ============================================================
  // GET Point Reference Image — Download reference image for a single measurement point by code
  // Direction: Server → AOI App
  // ============================================================
  getPointImage: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      pointCode: z.string().trim().min(1),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input }) => {
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

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      const point = await db.getMeasurementPointDefByCode(productModel.id, input.pointCode.trim());
      if (!point) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Measurement point '${input.pointCode}' not found in product model '${input.productModelCode}'` });
      }

      if (!point.referenceImageUrl) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Measurement point '${input.pointCode}' has no reference image` });
      }

      // Convert relative /uploads/ URLs to base64 data URLs for external clients
      const referenceImageUrl = await resolveImageToDataUrl(point.referenceImageUrl);
      const productReferenceImageUrl = await resolveImageToDataUrl(productModel.referenceImageUrl);

      return {
        success: true,
        machineId: machine.id,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        pointId: point.id,
        pointCode: point.code,
        pointName: point.name,
        referenceImageUrl,
        position: {
          x: point.positionX,
          y: point.positionY,
          radius: point.radius,
          normalizedX: point.normalizedX ? Number(point.normalizedX) : null,
          normalizedY: point.normalizedY ? Number(point.normalizedY) : null,
          normalizedRadius: point.normalizedRadius ? Number(point.normalizedRadius) : null,
          cropWidth: point.cropWidth,
          cropHeight: point.cropHeight,
        },
        productReferenceImageUrl,
      };
    }),

  // ============================================================
  // DELTA SYNC — Returns only points changed since a given version
  // Client sends its cached version, server returns diff
  // ============================================================
  deltaSyncPoints: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().min(1),
      sinceVersion: z.number().int().nonnegative(),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input }) => {
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

      const productModel = await db.getProductModelByCode(input.productModelCode.trim());
      if (!productModel) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Product model '${input.productModelCode}' not found` });
      }

      const currentVersion = productModel.pointsConfigVersion ?? 1;

      // No changes since client version
      if (currentVersion <= input.sinceVersion) {
        return {
          success: true,
          hasChanges: false,
          currentVersion,
          sinceVersion: input.sinceVersion,
          points: [],
        };
      }

      // Get changed points
      const { points } = await db.getPointsChangedSinceVersion(productModel.id, input.sinceVersion);

      // Log delta sync pull
      db.createProductSyncLog({
        machineId: machine.id,
        machineCode: input.machineCode ?? machine.code,
        productModelId: productModel.id,
        productModelCode: productModel.code,
        syncOperation: "DELTA_SYNC",
        syncStatus: "SUCCESS",
        pointsSynced: points.length,
        fromVersion: input.sinceVersion,
        toVersion: currentVersion,
      }).catch(() => {});

      return {
        success: true,
        hasChanges: true,
        currentVersion,
        sinceVersion: input.sinceVersion,
        serverImageWidth: productModel.imageWidth,
        serverImageHeight: productModel.imageHeight,
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
          normalizedX: p.normalizedX,
          normalizedY: p.normalizedY,
          normalizedRadius: p.normalizedRadius,
          cropWidth: p.cropWidth,
          cropHeight: p.cropHeight,
          orderIndex: p.orderIndex,
          isActive: p.isActive,
          lastModifiedAt: p.lastModifiedAt?.toISOString() ?? null,
        })),
      };
    }),

  // ============================================================
  // SYNC HISTORY — Returns sync log entries for a machine
  // ============================================================
  getSyncHistory: publicProcedure
    .input(z.object({
      machineCode: z.string().optional(),
      apiKey: z.string().optional(),
      productModelCode: z.string().trim().optional(),
      syncOperation: z.enum(["POINTS_PUSH", "POINTS_PULL", "IMAGE_PUSH", "IMAGE_PULL", "FULL_SYNC", "DELTA_SYNC"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().nonnegative().default(0),
    }).refine((data) => data.apiKey || data.machineCode, {
      message: 'Either apiKey or machineCode must be provided',
    }))
    .query(async ({ input }) => {
      let machine;
      if (input.apiKey) {
        machine = await db.getMachineByApiKey(input.apiKey);
      } else if (input.machineCode) {
        machine = await db.getMachineByCode(input.machineCode.trim());
      }

      if (!machine) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: input.apiKey ? 'Invalid API key' : 'Invalid machine code' });
      }

      let productModelId: number | undefined;
      if (input.productModelCode) {
        const productModel = await db.getProductModelByCode(input.productModelCode.trim());
        if (productModel) productModelId = productModel.id;
      }

      const logs = await db.getProductSyncLogs({
        machineId: machine.id,
        productModelId,
        syncOperation: input.syncOperation,
        limit: input.limit,
        offset: input.offset,
      });

      return {
        success: true,
        machineId: machine.id,
        machineCode: machine.code,
        logs,
      };
    }),
});
