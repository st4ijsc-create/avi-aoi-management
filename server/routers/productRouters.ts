import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { storagePut } from "../storage";
import { detectSpcViolations, detectEwma, rollingCapability } from "../utils/spcRules";
import { publishSpcAlert, loadDefaultSinksFromEnv } from "../utils/spcAlertSink";
import { calculateAnovaGrr, calculateBias, calculateLinearity, calculateStability } from "../utils/msaAdvanced";
import { assertInstrumentReady } from "../utils/instrumentGate";
import { parseCad } from "../utils/cadParsers";
import { createHash } from "node:crypto";
import {
  measurementGeometrySchema,
  pointShapeEnum,
  deriveLegacyAnchor,
  type MeasurementGeometry,
} from "../lib/measurementGeometry";

const legacyMeasurementTypeValues = ["DIMENSION", "VISUAL", "ELECTRICAL", "POSITION", "COLOR", "SURFACE", "OTHER"] as const;
const legacyMeasurementTypeSchema = z.enum(legacyMeasurementTypeValues);

const toleranceModeSchema = z.enum(["min_only", "max_only", "range", "bilateral"]);
const materialConditionSchema = z.enum(["MMC", "LMC", "RFS"]);

const criteriaItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("numeric_range"),
    metric: z.string().min(1).max(100),
    min: z.union([z.string(), z.number()]).optional(),
    max: z.union([z.string(), z.number()]).optional(),
    unit: z.string().max(20).optional(),
  }),
  z.object({
    kind: z.literal("boolean_check"),
    metric: z.string().min(1).max(100),
    expected: z.boolean(),
  }),
  z.object({
    kind: z.literal("text_match"),
    metric: z.string().min(1).max(100),
    expected: z.string().max(255),
    mode: z.enum(["exact", "contains", "regex"]).default("exact"),
  }),
]);

function mapCatalogCategoryToLegacyType(category?: string | null): z.infer<typeof legacyMeasurementTypeSchema> {
  switch ((category ?? "").toUpperCase()) {
    case "DIMENSION":
    case "GD_T":
      return "DIMENSION";
    case "ELECTRICAL":
      return "ELECTRICAL";
    case "POSITION":
      return "POSITION";
    case "COLOR":
      return "COLOR";
    case "SURFACE":
      return "SURFACE";
    case "OTHER":
      return "OTHER";
    default:
      return "VISUAL";
  }
}

function toNumberOrNull(value?: string | number | null): number | null {
  if (value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveLegacyLimitsFromTolerance(input: {
  toleranceMode?: z.infer<typeof toleranceModeSchema>;
  nominalValue?: string;
  tolPlus?: string;
  tolMinus?: string;
  lowerLimit?: string;
  upperLimit?: string;
}) {
  if (input.toleranceMode !== "bilateral") {
    return {
      lowerLimit: input.lowerLimit,
      upperLimit: input.upperLimit,
    };
  }
  const nominal = toNumberOrNull(input.nominalValue);
  const plus = toNumberOrNull(input.tolPlus);
  const minus = toNumberOrNull(input.tolMinus);
  if (nominal === null || plus === null || minus === null) {
    return {
      lowerLimit: input.lowerLimit,
      upperLimit: input.upperLimit,
    };
  }
  return {
    lowerLimit: String(nominal - minus),
    upperLimit: String(nominal + plus),
  };
}

async function resolveLegacyMeasurementType(measurementTypeCode?: string, fallback?: z.infer<typeof legacyMeasurementTypeSchema>) {
  if (measurementTypeCode) {
    const catalog = await db.getMeasurementTypeCatalogByCode(measurementTypeCode);
    if (catalog) {
      return mapCatalogCategoryToLegacyType(catalog.category);
    }
  }
  return fallback ?? "VISUAL";
}

// ============ PRODUCT MODEL ROUTER ============
export const productModelRouter = router({
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
      code: z.string().min(1).max(100).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      category: z.string().optional(),
      categoryId: z.number().int().positive().optional(),
      productLine: z.string().optional(),
      variant: z.string().optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      targetYieldRate: z.string().optional(),
      minYieldRate: z.string().optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      imageWidth: z.number().int().nonnegative().max(100000).optional(),
      imageHeight: z.number().int().nonnegative().max(100000).optional(),
      imageDisplayMode: z.enum(["contain", "cover", "stretch", "none"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let finalImageUrl = input.referenceImageUrl;
      let finalImageKey = input.referenceImageKey;
      
      // Check if referenceImageUrl is a base64 data URL and upload to S3
      let autoImageWidth: number | undefined;
      let autoImageHeight: number | undefined;
      if (input.referenceImageUrl && input.referenceImageUrl.startsWith('data:')) {
        const isForgeConfigured = !!(process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY);
        if (!isForgeConfigured) {
          // Forge storage is not configured – skip external upload but do not fail creation
          console.warn('Forge storage not configured, skipping product model image upload for create');
        } else {
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

              // Auto-extract image dimensions if not provided
              if (!input.imageWidth || !input.imageHeight) {
                try {
                  const sharp = (await import("sharp")).default;
                  const metadata = await sharp(buffer).metadata();
                  if (metadata.width && metadata.height) {
                    autoImageWidth = metadata.width;
                    autoImageHeight = metadata.height;
                  }
                } catch { /* sharp unavailable or invalid image */ }
              }
            }
          } catch (error) {
            console.error('Failed to upload product model image to S3:', error);
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload image' });
          }
        }
      }
      
      const id = await db.createProductModel({
        ...input,
        referenceImageUrl: finalImageUrl,
        referenceImageKey: finalImageKey,
        imageWidth: input.imageWidth ?? autoImageWidth,
        imageHeight: input.imageHeight ?? autoImageHeight,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: { code: input.code, name: input.name, lifecycleStatus: input.lifecycleStatus },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.create)", err);
      }
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(100).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash").optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      category: z.string().optional(),
      categoryId: z.number().int().positive().optional(),
      productLine: z.string().optional(),
      variant: z.string().optional(),
      lifecycleStatus: z.enum(["development", "active", "eol", "archived"]).optional(),
      targetYieldRate: z.string().optional(),
      minYieldRate: z.string().optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      imageWidth: z.number().int().nonnegative().max(100000).optional(),
      imageHeight: z.number().int().nonnegative().max(100000).optional(),
      imageDisplayMode: z.enum(["contain", "cover", "stretch", "none"]).optional(),
      isActive: z.boolean().optional(),
      changeReason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, changeReason, ...rest } = input;
      const data = rest;
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
        const isForgeConfigured = !!(process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY);
        if (!isForgeConfigured) {
          // Forge storage is not configured – skip external upload but do not fail update
          console.warn('Forge storage not configured, skipping product model image upload for update');
        } else {
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

              // Auto-extract image dimensions if not provided
              if (!data.imageWidth || !data.imageHeight) {
                try {
                  const sharp = (await import("sharp")).default;
                  const metadata = await sharp(buffer).metadata();
                  if (metadata.width && metadata.height) {
                    finalData.imageWidth = finalData.imageWidth ?? metadata.width;
                    finalData.imageHeight = finalData.imageHeight ?? metadata.height;
                  }
                } catch { /* sharp unavailable or invalid image */ }
              }
            }
          } catch (error) {
            console.error('Failed to upload product model image to S3:', error);
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload image' });
          }
        }
      }
      
      await db.updateProductModel(id, finalData);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.update",
          entityType: "product",
          entityId: id,
          entityName: data.code ?? undefined,
          details: { changedFields: Object.keys(finalData), changeReason: changeReason ?? null },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.update)", err);
      }
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getProductModelById(input.id);
      await db.deleteProductModel(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "product.delete",
          entityType: "product",
          entityId: input.id,
          entityName: existing?.code ?? undefined,
          details: { soft: true },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (product.delete)", err);
      }
      return { success: true };
    }),
});

// ============ MEASUREMENT POINT DEFINITION ROUTER ============
export const measurementPointRouter = router({
  list: protectedProcedure
    .query(async () => {
      return db.listAllMeasurementPointDefs();
    }),

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
      productModelId: z.number().int().positive(),
      machineId: z.number().int().positive().optional(),
      workstationId: z.number().int().positive().optional(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      measurementType: legacyMeasurementTypeSchema.optional(),
      measurementTypeCode: z.string().min(3).max(100).optional(),
      unit: z.string().optional(),
      lowerLimit: z.string().optional(),
      upperLimit: z.string().optional(),
      nominalValue: z.string().optional(),
      toleranceMode: toleranceModeSchema.optional(),
      tolPlus: z.string().optional(),
      tolMinus: z.string().optional(),
      criteria: z.array(criteriaItemSchema).optional(),
      datumRefs: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
      materialCondition: materialConditionSchema.optional(),
      fitClass: z.string().max(20).optional(),
      positionZ: z.string().optional(),
      heightMin: z.string().optional(),
      heightMax: z.string().optional(),
      heightNominal: z.string().optional(),
      heightUnit: z.string().max(20).optional(),
      areaMin: z.string().optional(),
      areaMax: z.string().optional(),
      areaNominal: z.string().optional(),
      areaUnit: z.string().max(20).optional(),
      volumeMin: z.string().optional(),
      volumeMax: z.string().optional(),
      volumeNominal: z.string().optional(),
      volumeUnit: z.string().max(20).optional(),
      coplanarityMax: z.string().optional(),
      warpageMax: z.string().optional(),
      voidPctMax: z.string().optional(),
      offsetXMax: z.string().optional(),
      offsetYMax: z.string().optional(),
      tiltMax: z.string().optional(),
      thicknessMin: z.string().optional(),
      thicknessMax: z.string().optional(),
      depthMapUrl: z.string().url().optional(),
      pointCloudUrl: z.string().url().optional(),
      positionX: z.number().int().nonnegative().max(100000),
      positionY: z.number().int().nonnegative().max(100000),
      radius: z.number().int().nonnegative().max(100000).optional(),
      cropWidth: z.number().int().nonnegative().max(100000).optional().default(100),
      cropHeight: z.number().int().nonnegative().max(100000).optional().default(100),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional(),
      shape: pointShapeEnum.optional(),
      geometry: measurementGeometrySchema.optional(),
      preferredInstrumentId: z.number().int().positive().optional(),
      preferredSamplingPlanId: z.number().int().positive().optional(),
      productViewId: z.number().int().positive().optional(), // P3.4: multi-camera binding
    }))
    .mutation(async ({ ctx, input }) => {
      // P1: when caller supplies a geometry, derive legacy positionX/Y/radius
      // from the geometry centroid so legacy clients stay correct.
      let positionX = input.positionX;
      let positionY = input.positionY;
      let radius = input.radius;
      if (input.geometry) {
        const anchor = deriveLegacyAnchor(input.geometry as MeasurementGeometry);
        positionX = Math.max(0, Math.round(anchor.x));
        positionY = Math.max(0, Math.round(anchor.y));
        radius = Math.max(0, Math.round(anchor.radius));
      }
      // Auto-compute normalized coordinates from product model dimensions
      let normalizedX: string | undefined;
      let normalizedY: string | undefined;
      let normalizedRadius: string | undefined;
      if (positionX != null && positionY != null) {
        const productModel = await db.getProductModelById(input.productModelId);
        if (productModel?.imageWidth && productModel?.imageHeight) {
          normalizedX = (positionX / productModel.imageWidth).toFixed(8);
          normalizedY = (positionY / productModel.imageHeight).toFixed(8);
          if (radius != null) {
            normalizedRadius = (radius / productModel.imageWidth).toFixed(8);
          }
        }
      }
      // P3: Validate preferredInstrument if provided
      if (input.preferredInstrumentId) {
        const instrument = await db.getMeasurementInstrumentById(input.preferredInstrumentId);
        if (!instrument) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${input.preferredInstrumentId} not found` });
        }
        if (!instrument.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Instrument "${instrument.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3: Validate preferredSamplingPlan if provided
      if (input.preferredSamplingPlanId) {
        const samplingPlan = await db.getSamplingPlanById(input.preferredSamplingPlanId);
        if (!samplingPlan) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Sampling plan ID ${input.preferredSamplingPlanId} not found` });
        }
        if (samplingPlan.productModelId !== input.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan does not belong to this product model` });
        }
        if (!samplingPlan.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan "${samplingPlan.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3.4: Validate productView if provided (multi-camera binding)
      if (input.productViewId) {
        const productView = await db.getProductViewById(input.productViewId);
        if (!productView) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Product view ID ${input.productViewId} not found` });
        }
        if (productView.productModelId !== input.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view does not belong to this product model` });
        }
        if (!productView.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view "${productView.code}" is inactive; cannot assign to measurement point` });
        }
      }

      const legacyMeasurementType = await resolveLegacyMeasurementType(input.measurementTypeCode, input.measurementType);
      const legacyLimits = deriveLegacyLimitsFromTolerance({
        toleranceMode: input.toleranceMode,
        nominalValue: input.nominalValue,
        tolPlus: input.tolPlus,
        tolMinus: input.tolMinus,
        lowerLimit: input.lowerLimit,
        upperLimit: input.upperLimit,
      });

      const id = await db.createMeasurementPointDef({
        ...input,
        measurementType: legacyMeasurementType,
        lowerLimit: legacyLimits.lowerLimit,
        upperLimit: legacyLimits.upperLimit,
        positionX,
        positionY,
        radius,
        normalizedX,
        normalizedY,
        normalizedRadius,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: {
            productModelId: input.productModelId,
            machineId: input.machineId,
            measurementType: legacyMeasurementType,
            measurementTypeCode: input.measurementTypeCode,
            shape: input.shape ?? "circle",
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.create)", err);
      }
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash").optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      measurementType: legacyMeasurementTypeSchema.optional(),
      measurementTypeCode: z.string().min(3).max(100).optional(),
      unit: z.string().optional(),
      lowerLimit: z.string().optional(),
      upperLimit: z.string().optional(),
      nominalValue: z.string().optional(),
      toleranceMode: toleranceModeSchema.optional(),
      tolPlus: z.string().optional(),
      tolMinus: z.string().optional(),
      criteria: z.array(criteriaItemSchema).optional(),
      datumRefs: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
      materialCondition: materialConditionSchema.optional(),
      fitClass: z.string().max(20).optional(),
      positionZ: z.string().optional(),
      heightMin: z.string().optional(),
      heightMax: z.string().optional(),
      heightNominal: z.string().optional(),
      heightUnit: z.string().max(20).optional(),
      areaMin: z.string().optional(),
      areaMax: z.string().optional(),
      areaNominal: z.string().optional(),
      areaUnit: z.string().max(20).optional(),
      volumeMin: z.string().optional(),
      volumeMax: z.string().optional(),
      volumeNominal: z.string().optional(),
      volumeUnit: z.string().max(20).optional(),
      coplanarityMax: z.string().optional(),
      warpageMax: z.string().optional(),
      voidPctMax: z.string().optional(),
      offsetXMax: z.string().optional(),
      offsetYMax: z.string().optional(),
      tiltMax: z.string().optional(),
      thicknessMin: z.string().optional(),
      thicknessMax: z.string().optional(),
      depthMapUrl: z.string().url().optional(),
      pointCloudUrl: z.string().url().optional(),
      positionX: z.number().int().nonnegative().max(100000).optional(),
      positionY: z.number().int().nonnegative().max(100000).optional(),
      radius: z.number().int().nonnegative().max(100000).optional(),
      cropWidth: z.number().int().nonnegative().max(100000).optional(),
      cropHeight: z.number().int().nonnegative().max(100000).optional(),
      referenceImageUrl: z.string().optional(),
      referenceImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional(),
      workstationId: z.number().int().positive().optional(),
      preferredInstrumentId: z.number().int().positive().optional(),
      preferredSamplingPlanId: z.number().int().positive().optional(),
      productViewId: z.number().int().positive().optional(), // P3.4: multi-camera binding
      isActive: z.boolean().optional(),
      shape: pointShapeEnum.optional(),
      geometry: measurementGeometrySchema.optional(),
      changeReason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, changeReason, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      const existingPoint = await db.getMeasurementPointDefById(id);
      if (!existingPoint) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Measurement point not found" });
      }

      // P3: Validate preferredInstrument if provided or changed
      if (rest.preferredInstrumentId) {
        const instrument = await db.getMeasurementInstrumentById(rest.preferredInstrumentId);
        if (!instrument) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${rest.preferredInstrumentId} not found` });
        }
        if (!instrument.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Instrument "${instrument.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3: Validate preferredSamplingPlan if provided or changed
      if (rest.preferredSamplingPlanId) {
        const samplingPlan = await db.getSamplingPlanById(rest.preferredSamplingPlanId);
        if (!samplingPlan) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Sampling plan ID ${rest.preferredSamplingPlanId} not found` });
        }
        if (samplingPlan.productModelId !== existingPoint.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan does not belong to this product model` });
        }
        if (!samplingPlan.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Sampling plan "${samplingPlan.code}" is inactive; cannot assign to measurement point` });
        }
      }

      // P3.4: Validate productView if provided or changed (multi-camera binding)
      if (rest.productViewId) {
        const productView = await db.getProductViewById(rest.productViewId);
        if (!productView) {
          throw new TRPCError({ code: "NOT_FOUND", message: `Product view ID ${rest.productViewId} not found` });
        }
        if (productView.productModelId !== existingPoint.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view does not belong to this product model` });
        }
        if (!productView.isActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product view "${productView.code}" is inactive; cannot assign to measurement point` });
        }
      }

      const nextMeasurementTypeCode = rest.measurementTypeCode ?? existingPoint.measurementTypeCode ?? undefined;
      const nextLegacyType = await resolveLegacyMeasurementType(
        nextMeasurementTypeCode,
        (rest.measurementType ?? existingPoint.measurementType) as z.infer<typeof legacyMeasurementTypeSchema>,
      );
      data.measurementType = nextLegacyType;

      const legacyLimits = deriveLegacyLimitsFromTolerance({
        toleranceMode: (rest.toleranceMode ?? existingPoint.toleranceMode ?? undefined) as z.infer<typeof toleranceModeSchema> | undefined,
        nominalValue: (rest.nominalValue ?? existingPoint.nominalValue ?? undefined) as string | undefined,
        tolPlus: (rest.tolPlus ?? existingPoint.tolPlus ?? undefined) as string | undefined,
        tolMinus: (rest.tolMinus ?? existingPoint.tolMinus ?? undefined) as string | undefined,
        lowerLimit: (rest.lowerLimit ?? existingPoint.lowerLimit ?? undefined) as string | undefined,
        upperLimit: (rest.upperLimit ?? existingPoint.upperLimit ?? undefined) as string | undefined,
      });
      data.lowerLimit = legacyLimits.lowerLimit;
      data.upperLimit = legacyLimits.upperLimit;

      // P1: derive legacy x/y/r from supplied geometry (for any shape).
      if (rest.geometry) {
        const anchor = deriveLegacyAnchor(rest.geometry as MeasurementGeometry);
        data.positionX = Math.max(0, Math.round(anchor.x));
        data.positionY = Math.max(0, Math.round(anchor.y));
        data.radius = Math.max(0, Math.round(anchor.radius));
      }
      // Auto-compute normalized coordinates when position changes
      let normalizedData: Record<string, unknown> = { ...data };
      if (data.positionX != null || data.positionY != null || data.radius != null) {
        const productModel = await db.getProductModelById(existingPoint.productModelId);
        if (productModel?.imageWidth && productModel?.imageHeight) {
          const px = (data.positionX as number | undefined) ?? existingPoint.positionX;
          const py = (data.positionY as number | undefined) ?? existingPoint.positionY;
          const r = (data.radius as number | undefined) ?? existingPoint.radius;
          if (px != null && py != null) {
            normalizedData.normalizedX = (px / productModel.imageWidth).toFixed(8);
            normalizedData.normalizedY = (py / productModel.imageHeight).toFixed(8);
            if (r != null) {
              normalizedData.normalizedRadius = (r / productModel.imageWidth).toFixed(8);
            }
          }
        }
      }
      await db.updateMeasurementPointDef(id, normalizedData, {
        changedBy: ctx.user.id,
        changeReason: changeReason ?? null,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.update",
          entityType: "product",
          entityId: id,
          entityName: (data.code as string | undefined) ?? undefined,
          details: {
            changedFields: Object.keys(normalizedData),
            measurementType: nextLegacyType,
            measurementTypeCode: nextMeasurementTypeCode,
            changeReason: changeReason ?? null,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.update)", err);
      }
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getMeasurementPointDefById(input.id);
      await db.deleteMeasurementPointDef(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.delete",
          entityType: "product",
          entityId: input.id,
          entityName: existing?.code ?? undefined,
          details: { soft: true, productModelId: existing?.productModelId },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.delete)", err);
      }
      return { success: true };
    }),

  // Upload cropped reference image for measurement point
  uploadCroppedImage: adminProcedure
    .input(z.object({
      pointId: z.number().int().positive(),
      imageBase64: z.string(),
      mimeType: z.string().default('image/png'),
    }))
    .mutation(async ({ ctx, input }) => {
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

      // Update measurement point with cropped image URL (records a version snapshot)
      await db.updateMeasurementPointDef(input.pointId, {
        referenceImageUrl: url,
        referenceImageKey: key,
      }, {
        changedBy: ctx.user.id,
        changeReason: "uploadCroppedImage",
      });

      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementPoint.uploadCroppedImage",
          entityType: "product",
          entityId: input.pointId,
          entityName: point.code,
          details: { mimeType: input.mimeType, key },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (measurementPoint.uploadCroppedImage)", err);
      }

      return { success: true, imageUrl: url, imageKey: key };
    }),
});

// ============ PRODUCT MACHINE MAPPING ROUTER ============
export const productMachineMappingRouter = router({
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
      productModelId: z.number().int().positive(),
      machineId: z.number().int().positive(),
      priority: z.number().int().nonnegative().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await db.createProductMachineMapping(input);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productMachineMapping.create",
          entityType: "mapping",
          entityId: typeof result === "object" && result && "id" in result ? (result as any).id : undefined,
          details: { productModelId: input.productModelId, machineId: input.machineId, priority: input.priority },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (productMachineMapping.create)", err);
      }
      return result;
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      priority: z.number().int().nonnegative().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updateProductMachineMapping(id, data);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productMachineMapping.update",
          entityType: "mapping",
          entityId: id,
          details: { changedFields: Object.keys(data) },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (productMachineMapping.update)", err);
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteProductMachineMapping(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productMachineMapping.delete",
          entityType: "mapping",
          entityId: input.id,
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (productMachineMapping.delete)", err);
      }
      return { success: true };
    }),
});

// ============ PRODUCT CATEGORY ROUTER ============
export const productCategoryRouter = router({
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

// ============ PRODUCT DOCUMENT ROUTER ============
export const productDocumentRouter = router({
  list: protectedProcedure
    .input(z.object({ productModelId: z.number() }))
    .query(async ({ input }) => {
      const { productDocuments } = await import("../../drizzle/schema/product");
      const { eq, desc } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not connected' });
      return database.select().from(productDocuments)
        .where(eq(productDocuments.productModelId, input.productModelId))
        .orderBy(desc(productDocuments.createdAt));
    }),

  upload: protectedProcedure
    .input(z.object({
      productModelId: z.number(),
      fileName: z.string().min(1).max(255),
      fileBase64: z.string(),
      mimeType: z.string().refine(
        (v) => ['application/pdf', 'application/msword', 
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                 'image/png', 'image/jpeg'].includes(v),
        { message: 'Unsupported file type' }
      ),
    }))
    .mutation(async ({ ctx, input }) => {
      const { productDocuments } = await import("../../drizzle/schema/product");
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not connected' });

      const buffer = Buffer.from(input.fileBase64, 'base64');
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileKey = `product-documents/${input.productModelId}/${Date.now()}-${safeName}`;
      const stored = await storagePut(fileKey, buffer, input.mimeType);

      const [doc] = await database.insert(productDocuments).values({
        productModelId: input.productModelId,
        fileName: input.fileName,
        fileKey: stored.key,
        fileUrl: stored.url,
        fileSize: buffer.length,
        mimeType: input.mimeType,
        uploadedBy: ctx.user?.id ?? null,
        uploadedByName: ctx.user?.name ?? null,
      }).returning();

      return doc;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { productDocuments } = await import("../../drizzle/schema/product");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Database not connected' });
      await database.delete(productDocuments).where(eq(productDocuments.id, input.id));
      return { success: true };
    }),
});

// ============ FIDUCIAL MARK ROUTER (P1) ============
export const fiducialMarkRouter = router({
  listByProductModel: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getFiducialMarksByProductModel(input.productModelId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getFiducialMarkById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash"),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      type: z.enum(["cross", "circle", "square", "custom"]).optional().default("cross"),
      positionX: z.number().int().nonnegative().max(100000),
      positionY: z.number().int().nonnegative().max(100000),
      searchWindowW: z.number().int().positive().max(10000).optional().default(80),
      searchWindowH: z.number().int().positive().max(10000).optional().default(80),
      templateImageUrl: z.string().optional(),
      templateImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional().default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      // Auto-compute normalized X/Y from product model dimensions.
      let normalizedX: string | undefined;
      let normalizedY: string | undefined;
      const productModel = await db.getProductModelById(input.productModelId);
      if (productModel?.imageWidth && productModel?.imageHeight) {
        normalizedX = (input.positionX / productModel.imageWidth).toFixed(8);
        normalizedY = (input.positionY / productModel.imageHeight).toFixed(8);
      }
      const id = await db.createFiducialMark({
        ...input,
        normalizedX,
        normalizedY,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: { productModelId: input.productModelId, type: input.type },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.create)", err);
      }
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Code may only contain letters, digits, underscore, dash").optional(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      type: z.enum(["cross", "circle", "square", "custom"]).optional(),
      positionX: z.number().int().nonnegative().max(100000).optional(),
      positionY: z.number().int().nonnegative().max(100000).optional(),
      searchWindowW: z.number().int().positive().max(10000).optional(),
      searchWindowH: z.number().int().positive().max(10000).optional(),
      templateImageUrl: z.string().optional(),
      templateImageKey: z.string().optional(),
      orderIndex: z.number().int().nonnegative().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const data: Record<string, unknown> = { ...rest };
      // Re-normalize when position changes
      if (rest.positionX != null || rest.positionY != null) {
        const existing = await db.getFiducialMarkById(id);
        if (existing) {
          const productModel = await db.getProductModelById(existing.productModelId);
          if (productModel?.imageWidth && productModel?.imageHeight) {
            const px = rest.positionX ?? existing.positionX;
            const py = rest.positionY ?? existing.positionY;
            if (px != null && py != null) {
              data.normalizedX = (px / productModel.imageWidth).toFixed(8);
              data.normalizedY = (py / productModel.imageHeight).toFixed(8);
            }
          }
        }
      }
      await db.updateFiducialMark(id, data);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.update",
          entityType: "product",
          entityId: id,
          entityName: rest.code ?? undefined,
          details: { changedFields: Object.keys(data) },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.update)", err);
      }
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db.getFiducialMarkById(input.id);
      await db.deleteFiducialMark(input.id);
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.delete",
          entityType: "product",
          entityId: input.id,
          entityName: existing?.code ?? undefined,
          details: { soft: true, productModelId: existing?.productModelId },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.delete)", err);
      }
      return { success: true };
    }),

  uploadTemplateImage: adminProcedure
    .input(z.object({
      fiducialId: z.number().int().positive(),
      imageBase64: z.string(),
      mimeType: z.string().default("image/png"),
    }))
    .mutation(async ({ ctx, input }) => {
      const fid = await db.getFiducialMarkById(input.fiducialId);
      if (!fid) throw new TRPCError({ code: "NOT_FOUND", message: "Fiducial mark not found" });
      const buffer = Buffer.from(input.imageBase64, "base64");
      const ext = input.mimeType.split("/")[1] || "png";
      const fileKey = `fiducial-marks/${fid.productModelId}/${fid.code}-tpl-${nanoid(8)}.${ext}`;
      const { url, key } = await storagePut(fileKey, buffer, input.mimeType);
      await db.updateFiducialMark(input.fiducialId, {
        templateImageUrl: url,
        templateImageKey: key,
      });
      try {
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "fiducialMark.uploadTemplateImage",
          entityType: "product",
          entityId: input.fiducialId,
          entityName: fid.code,
          details: { mimeType: input.mimeType, key },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (fiducialMark.uploadTemplateImage)", err);
      }
      return { success: true, imageUrl: url, imageKey: key };
    }),
});

// ============ MEASUREMENT TYPE CATALOG ROUTER (P2) ============
export const measurementTypeCatalogRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      includeInactive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listMeasurementTypeCatalog(input);
    }),

  create: adminProcedure
    .input(z.object({
      category: z.string().min(1).max(50),
      subType: z.string().min(1).max(80),
      code: z.string().min(3).max(100),
      nameEn: z.string().max(200).optional(),
      nameVi: z.string().max(200).optional(),
      defaultUnit: z.string().max(20).optional(),
      valueKind: z.enum(["numeric", "text", "boolean", "composite"]).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createMeasurementTypeCatalog(input);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "measurementTypeCatalog.create",
        entityType: "product",
        entityId: id,
        entityName: input.code,
        details: input,
        status: "success",
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      category: z.string().min(1).max(50).optional(),
      subType: z.string().min(1).max(80).optional(),
      code: z.string().min(3).max(100).optional(),
      nameEn: z.string().max(200).optional(),
      nameVi: z.string().max(200).optional(),
      defaultUnit: z.string().max(20).optional(),
      valueKind: z.enum(["numeric", "text", "boolean", "composite"]).optional(),
      description: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const before = await db.getMeasurementTypeCatalogByCode(input.code ?? "");
      await db.updateMeasurementTypeCatalog(id, data);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "measurementTypeCatalog.update",
        entityType: "product",
        entityId: id,
        entityName: input.code ?? undefined,
        details: { before, after: data },
        status: "success",
      });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteMeasurementTypeCatalog(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "measurementTypeCatalog.delete",
        entityType: "product",
        entityId: input.id,
        details: { soft: true },
        status: "success",
      });
      return { success: true };
    }),
});

// ============ DEFECT CATALOG ROUTER (P2) ============
export const defectCatalogRouter = router({
  list: protectedProcedure
    .input(z.object({
      category: z.string().optional(),
      severity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
      includeInactive: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listDefectCatalog(input);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getDefectCatalogById(input.id);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(50),
      name: z.string().min(1).max(255),
      category: z.string().min(1).max(80),
      severity: z.enum(["critical", "major", "minor", "cosmetic"]),
      ipcReference: z.string().max(50).optional(),
      acceptanceClass: z.enum(["1", "2", "3"]).optional(),
      description: z.string().optional(),
      referenceImageKey: z.string().max(255).optional(),
      referenceImageUrl: z.string().url().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createDefectCatalog(input);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "defectCatalog.create",
        entityType: "product",
        entityId: id,
        entityName: input.code,
        details: input,
        status: "success",
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      code: z.string().min(1).max(50).optional(),
      name: z.string().min(1).max(255).optional(),
      category: z.string().min(1).max(80).optional(),
      severity: z.enum(["critical", "major", "minor", "cosmetic"]).optional(),
      ipcReference: z.string().max(50).optional(),
      acceptanceClass: z.enum(["1", "2", "3"]).optional(),
      description: z.string().optional(),
      referenceImageKey: z.string().max(255).optional(),
      referenceImageUrl: z.string().url().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const before = await db.getDefectCatalogById(id);
      await db.updateDefectCatalog(id, data);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "defectCatalog.update",
        entityType: "product",
        entityId: id,
        entityName: input.code ?? before?.code,
        details: { before, after: data },
        status: "success",
      });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteDefectCatalog(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "defectCatalog.delete",
        entityType: "product",
        entityId: input.id,
        details: { soft: true },
        status: "success",
      });
      return { success: true };
    }),
});

  // ============ P3.1 / P3.3 / P3.4 FOUNDATION ROUTERS ============
  export const measurementInstrumentRouter = router({
    list: protectedProcedure
      .input(z.object({
        instrumentType: z.string().optional(),
        includeInactive: z.boolean().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.listMeasurementInstruments(input);
      }),

    getById: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        return db.getMeasurementInstrumentById(input.id);
      }),

    create: adminProcedure
      .input(z.object({
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(255),
        instrumentType: z.string().min(1).max(80),
        manufacturer: z.string().max(120).optional(),
        model: z.string().max(120).optional(),
        serialNumber: z.string().max(120).optional(),
        defaultUnit: z.string().max(20).optional(),
        resolution: z.string().optional(),
        uncertainty: z.string().optional(),
        mmPerPixel: z.string().optional(), // P3.2: calibration factor (e.g., "0.05" mm/pixel)
        calibrationPeriodDays: z.number().int().positive().optional(),
        lastCalibrationAt: z.date().optional(),
        nextCalibrationAt: z.date().optional(),
        msaMethod: z.string().max(50).optional(),
        notes: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createMeasurementInstrument(input);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementInstrument.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: input,
          status: "success",
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(50).optional(),
        name: z.string().min(1).max(255).optional(),
        instrumentType: z.string().min(1).max(80).optional(),
        manufacturer: z.string().max(120).optional(),
        model: z.string().max(120).optional(),
        serialNumber: z.string().max(120).optional(),
        defaultUnit: z.string().max(20).optional(),
        resolution: z.string().optional(),
        uncertainty: z.string().optional(),
        mmPerPixel: z.string().optional(), // P3.2: calibration factor
        calibrationPeriodDays: z.number().int().positive().optional(),
        lastCalibrationAt: z.date().optional(),
        nextCalibrationAt: z.date().optional(),
        msaMethod: z.string().max(50).optional(),
        notes: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const before = await db.getMeasurementInstrumentById(id);
        await db.updateMeasurementInstrument(id, data);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementInstrument.update",
          entityType: "product",
          entityId: id,
          entityName: input.code ?? before?.code,
          details: { before, after: data },
          status: "success",
        });
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.softDeleteMeasurementInstrument(input.id);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "measurementInstrument.delete",
          entityType: "product",
          entityId: input.id,
          details: { soft: true },
          status: "success",
        });
        return { success: true };
      }),
  });

  export const samplingPlanRouter = router({
    listByProduct: protectedProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        includeInactive: z.boolean().optional(),
      }))
      .query(async ({ input }) => {
        return db.listSamplingPlansByProduct(input.productModelId, { includeInactive: input.includeInactive });
      }),

    create: adminProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        code: z.string().min(1).max(60),
        name: z.string().min(1).max(255),
        strategy: z.enum(["fixed_n", "aql", "risk_based"]).optional(),
        lotSize: z.number().int().positive().optional(),
        aqlCritical: z.string().optional(),
        aqlMajor: z.string().optional(),
        aqlMinor: z.string().optional(),
        sampleSize: z.number().int().positive().optional(),
        acceptanceQty: z.number().int().nonnegative().optional(),
        rejectionQty: z.number().int().nonnegative().optional(),
        rules: z.record(z.string(), z.any()).optional(),
        version: z.number().int().positive().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createSamplingPlan(input);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "samplingPlan.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: input,
          status: "success",
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(60).optional(),
        name: z.string().min(1).max(255).optional(),
        strategy: z.enum(["fixed_n", "aql", "risk_based"]).optional(),
        lotSize: z.number().int().positive().optional(),
        aqlCritical: z.string().optional(),
        aqlMajor: z.string().optional(),
        aqlMinor: z.string().optional(),
        sampleSize: z.number().int().positive().optional(),
        acceptanceQty: z.number().int().nonnegative().optional(),
        rejectionQty: z.number().int().nonnegative().optional(),
        rules: z.record(z.string(), z.any()).optional(),
        version: z.number().int().positive().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const before = await db.getSamplingPlanById(id);
        await db.updateSamplingPlan(id, data);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "samplingPlan.update",
          entityType: "product",
          entityId: id,
          entityName: input.code ?? before?.code,
          details: { before, after: data },
          status: "success",
        });
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.softDeleteSamplingPlan(input.id);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "samplingPlan.delete",
          entityType: "product",
          entityId: input.id,
          details: { soft: true },
          status: "success",
        });
        return { success: true };
      }),
  });

  export const productViewRouter = router({
    listByProduct: protectedProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        includeInactive: z.boolean().optional(),
      }))
      .query(async ({ input }) => {
        return db.listProductViewsByProduct(input.productModelId, { includeInactive: input.includeInactive });
      }),

    create: adminProcedure
      .input(z.object({
        productModelId: z.number().int().positive(),
        code: z.string().min(1).max(50),
        name: z.string().min(1).max(255),
        viewType: z.enum(["top", "bottom", "side", "isometric", "custom"]).optional(),
        referenceImageUrl: z.string().optional(),
        referenceImageKey: z.string().optional(),
        transform: z.record(z.string(), z.any()).optional(),
        orderIndex: z.number().int().nonnegative().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const id = await db.createProductView(input);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productView.create",
          entityType: "product",
          entityId: id,
          entityName: input.code,
          details: input,
          status: "success",
        });
        return { id };
      }),

    update: adminProcedure
      .input(z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(50).optional(),
        name: z.string().min(1).max(255).optional(),
        viewType: z.enum(["top", "bottom", "side", "isometric", "custom"]).optional(),
        referenceImageUrl: z.string().optional(),
        referenceImageKey: z.string().optional(),
        transform: z.record(z.string(), z.any()).optional(),
        orderIndex: z.number().int().nonnegative().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { id, ...data } = input;
        const before = await db.getProductViewById(id);
        await db.updateProductView(id, data);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productView.update",
          entityType: "product",
          entityId: id,
          entityName: input.code ?? before?.code,
          details: { before, after: data },
          status: "success",
        });
        return { success: true };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await db.softDeleteProductView(input.id);
        await db.createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "productView.delete",
          entityType: "product",
          entityId: input.id,
          details: { soft: true },
          status: "success",
        });
        return { success: true };
      }),
  });

export const msaWizardRouter = router({
  listCsvMappingPresets: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      sourceMachine: z.string().min(1).max(120).optional(),
    }))
    .query(async ({ input }) => {
      return db.listMsaCsvMappingPresetsByProduct(input.productModelId, {
        sourceMachine: input.sourceMachine,
      });
    }),

  saveCsvMappingPreset: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      sourceMachine: z.string().min(1).max(120),
      presetName: z.string().min(1).max(120),
      instrumentId: z.number().int().positive().optional(),
      hasHeader: z.boolean(),
      columnMap: z.object({
        operator: z.number().int().min(0),
        part: z.number().int().min(0),
        trial: z.number().int().min(0),
        value: z.number().int().min(0),
        notes: z.number().int().min(-1),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.instrumentId) {
        const inst = await db.getMeasurementInstrumentById(input.instrumentId);
        if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${input.instrumentId} not found` });
      }

      const id = await db.upsertMsaCsvMappingPreset({
        productModelId: input.productModelId,
        sourceMachine: input.sourceMachine,
        presetName: input.presetName,
        instrumentId: input.instrumentId,
        hasHeader: input.hasHeader,
        columnMap: input.columnMap,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.csv_preset.save",
        entityType: "product",
        entityId: input.productModelId,
        details: { id, sourceMachine: input.sourceMachine, presetName: input.presetName },
        status: "success",
      });

      return { id, success: true };
    }),

  deleteCsvMappingPreset: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteMsaCsvMappingPreset(input.id, ctx.user.id);

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.csv_preset.delete",
        entityType: "product",
        entityId: input.id,
        details: { soft: true },
        status: "success",
      });

      return { success: true };
    }),

  listByProduct: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      includeInactive: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      return db.listMsaStudiesByProduct(input.productModelId, { includeInactive: input.includeInactive });
    }),

  getStudy: protectedProcedure
    .input(z.object({ studyId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) {
        throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      }
      const observations = await db.listMsaObservationsByStudy(input.studyId);
      return { study, observations };
    }),

  startStudy: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      measurementPointDefId: z.number().int().positive().optional(),
      instrumentId: z.number().int().positive().optional(),
      studyCode: z.string().min(1).max(60),
      name: z.string().min(1).max(255),
      studyType: z.enum(["gage_rr", "bias", "linearity", "stability"]).optional(),
      operatorCount: z.number().int().min(1).max(20).optional(),
      partCount: z.number().int().min(1).max(200).optional(),
      trialCount: z.number().int().min(1).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.instrumentId) {
        const inst = await db.getMeasurementInstrumentById(input.instrumentId);
        if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: `Instrument ID ${input.instrumentId} not found` });
      }
      if (input.measurementPointDefId) {
        const point = await db.getMeasurementPointDefById(input.measurementPointDefId);
        if (!point) throw new TRPCError({ code: "NOT_FOUND", message: `Measurement point ID ${input.measurementPointDefId} not found` });
        if (point.productModelId !== input.productModelId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Measurement point does not belong to this product model" });
        }
      }

      const id = await db.createMsaStudy({
        productModelId: input.productModelId,
        measurementPointDefId: input.measurementPointDefId,
        instrumentId: input.instrumentId,
        studyCode: input.studyCode,
        name: input.name,
        studyType: input.studyType ?? "gage_rr",
        operatorCount: input.operatorCount ?? 3,
        partCount: input.partCount ?? 10,
        trialCount: input.trialCount ?? 2,
        status: "running",
        startedAt: new Date(),
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.study.start",
        entityType: "product",
        entityId: id,
        entityName: input.studyCode,
        details: input,
        status: "success",
      });
      return { id };
    }),

  addObservation: adminProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      operatorName: z.string().min(1).max(120),
      partLabel: z.string().min(1).max(120),
      trialNo: z.number().int().positive(),
      measuredValue: z.string().min(1),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      if (study.status === "completed" || study.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Study is closed" });
      }

      const duplicated = await db.getMsaObservationByCell(
        input.studyId,
        input.operatorName,
        input.partLabel,
        input.trialNo,
      );
      if (duplicated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Observation for (${input.operatorName}, ${input.partLabel}, trial ${input.trialNo}) already exists`,
        });
      }

      const value = Number(input.measuredValue);
      if (!Number.isFinite(value)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "measuredValue must be numeric" });
      }

      const id = await db.addMsaObservation({
        studyId: input.studyId,
        operatorName: input.operatorName,
        partLabel: input.partLabel,
        trialNo: input.trialNo,
        measuredValue: String(value),
        notes: input.notes,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.observation.add",
        entityType: "product",
        entityId: input.studyId,
        details: { observationId: id, operatorName: input.operatorName, partLabel: input.partLabel, trialNo: input.trialNo },
        status: "success",
      });
      return { id };
    }),

  addObservationsBatch: adminProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      skipDuplicates: z.boolean().optional(),
      rows: z.array(z.object({
        operatorName: z.string().min(1).max(120),
        partLabel: z.string().min(1).max(120),
        trialNo: z.number().int().positive(),
        measuredValue: z.string().min(1),
        notes: z.string().optional(),
      })).min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      if (study.status === "completed" || study.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Study is closed" });
      }

      const skipDuplicates = input.skipDuplicates !== false;
      let created = 0;
      let skipped = 0;
      const errors: Array<{ index: number; message: string }> = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];

        const value = Number(row.measuredValue);
        if (!Number.isFinite(value)) {
          errors.push({ index: i, message: "measuredValue must be numeric" });
          continue;
        }

        const duplicated = await db.getMsaObservationByCell(
          input.studyId,
          row.operatorName,
          row.partLabel,
          row.trialNo,
        );

        if (duplicated) {
          if (skipDuplicates) {
            skipped++;
            continue;
          }
          errors.push({
            index: i,
            message: `Duplicate cell (${row.operatorName}, ${row.partLabel}, trial ${row.trialNo})`,
          });
          continue;
        }

        await db.addMsaObservation({
          studyId: input.studyId,
          operatorName: row.operatorName,
          partLabel: row.partLabel,
          trialNo: row.trialNo,
          measuredValue: String(value),
          notes: row.notes,
        });
        created++;
      }

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.observation.batch_add",
        entityType: "product",
        entityId: input.studyId,
        details: { totalRows: input.rows.length, created, skipped, errorCount: errors.length, skipDuplicates },
        status: errors.length > 0 ? "failure" : "success",
      });

      return {
        success: true,
        created,
        skipped,
        errorCount: errors.length,
        errors,
      };
    }),

  generateMatrix: adminProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      overwriteExisting: z.boolean().optional(),
      baseValue: z.number().optional(),
      noisePct: z.number().min(0).max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      if (study.status === "completed" || study.status === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Study is closed" });
      }

      const result = await db.generateMsaObservationMatrix(input.studyId, {
        overwriteExisting: input.overwriteExisting,
        baseValue: input.baseValue,
        noisePct: input.noisePct,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.matrix.generate",
        entityType: "product",
        entityId: input.studyId,
        details: { ...input, ...result },
        status: "success",
      });

      return { success: true, ...result };
    }),

  completeStudy: adminProcedure
    .input(z.object({ studyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });

      const summary = await db.calculateMsaSummary(input.studyId);
      await db.updateMsaStudy(input.studyId, {
        status: "completed",
        completedAt: new Date(),
        summary,
      });

      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.study.complete",
        entityType: "product",
        entityId: input.studyId,
        details: summary,
        status: "success",
      });
      return { success: true, summary };
    }),

  cancelStudy: adminProcedure
    .input(z.object({ studyId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const study = await db.getMsaStudyById(input.studyId);
      if (!study) throw new TRPCError({ code: "NOT_FOUND", message: "MSA study not found" });
      await db.updateMsaStudy(input.studyId, { status: "cancelled", isActive: false });
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "msa.study.cancel",
        entityType: "product",
        entityId: input.studyId,
        status: "success",
      });
      return { success: true };
    }),
});

// (P4.A routers appended below)

// ============================================================
// P4.A G19 — Instrument Calibration & MSA records routers
// ============================================================
export const instrumentCalibrationRouter = router({
  list: protectedProcedure
    .input(z.object({ instrumentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listInstrumentCalibrations(input.instrumentId);
    }),

  health: protectedProcedure
    .input(z.object({ instrumentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getInstrumentHealth(input.instrumentId);
    }),

  create: adminProcedure
    .input(z.object({
      instrumentId: z.number().int().positive(),
      certNumber: z.string().min(1).max(120),
      certPdfUrl: z.string().url().optional(),
      certPdfKey: z.string().max(255).optional(),
      traceability: z.string().max(80).optional(),
      performedAt: z.coerce.date(),
      validUntil: z.coerce.date(),
      performedBy: z.string().max(255).optional(),
      performedByOrg: z.string().max(255).optional(),
      referenceStandard: z.string().max(255).optional(),
      asFoundBias: z.string().optional(),
      asLeftBias: z.string().optional(),
      uncertainty: z.string().optional(),
      result: z.enum(["pass", "conditional", "fail"]).default("pass"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await db.getMeasurementInstrumentById(input.instrumentId);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found" });
      const id = await db.createInstrumentCalibration({ ...input, createdBy: ctx.user.id });
      // Sync convenience: update instrument's lastCalibrationAt / nextCalibrationAt
      if (input.result !== "fail") {
        await db.updateMeasurementInstrument(input.instrumentId, {
          lastCalibrationAt: input.performedAt,
          nextCalibrationAt: input.validUntil,
        });
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentCalibration.create",
        entityType: "instrument",
        entityId: input.instrumentId,
        entityName: inst.code,
        details: { certNumber: input.certNumber, result: input.result, validUntil: input.validUntil },
        status: "success",
      });
      return { id };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteInstrumentCalibration(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentCalibration.delete",
        entityType: "instrument",
        entityId: input.id,
        status: "success",
      });
      return { success: true };
    }),
});

export const instrumentMsaRecordRouter = router({
  list: protectedProcedure
    .input(z.object({ instrumentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listInstrumentMsaRecords(input.instrumentId);
    }),

  create: adminProcedure
    .input(z.object({
      instrumentId: z.number().int().positive(),
      msaStudyId: z.number().int().positive().optional(),
      method: z.enum(["ARM", "ANOVA", "BIAS", "LINEARITY", "STABILITY"]).default("ARM"),
      performedAt: z.coerce.date().optional(),
      validUntil: z.coerce.date(),
      evPct: z.string().optional(),
      avPct: z.string().optional(),
      grrPct: z.string().optional(),
      ndc: z.number().int().nonnegative().optional(),
      ptRatio: z.string().optional(),
      biasValue: z.string().optional(),
      linearityScore: z.string().optional(),
      stabilityScore: z.string().optional(),
      verdict: z.enum(["good", "acceptable", "poor", "unknown"]).default("unknown"),
      notes: z.string().optional(),
      reportPdfUrl: z.string().url().optional(),
      reportPdfKey: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const inst = await db.getMeasurementInstrumentById(input.instrumentId);
      if (!inst) throw new TRPCError({ code: "NOT_FOUND", message: "Instrument not found" });
      const id = await db.createInstrumentMsaRecord({ ...input, createdBy: ctx.user.id });
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentMsaRecord.create",
        entityType: "instrument",
        entityId: input.instrumentId,
        entityName: inst.code,
        details: { method: input.method, verdict: input.verdict, validUntil: input.validUntil },
        status: "success",
      });
      return { id };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteInstrumentMsaRecord(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "instrumentMsaRecord.delete",
        entityType: "instrument",
        entityId: input.id,
        status: "success",
      });
      return { success: true };
    }),
});

// ============================================================
// P4.A G17 — MP Lighting Profile router
// ============================================================
export const mpLightingProfileRouter = router({
  listByPoint: protectedProcedure
    .input(z.object({ pointDefId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listMpLightingProfiles(input.pointDefId);
    }),

  create: adminProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      shotIndex: z.number().int().positive().default(1),
      name: z.string().max(120).optional(),
      lightSource: z.enum([
        "ring", "coaxial", "dome", "side_low_angle", "back",
        "uv", "ir", "multi_spectral", "dark_field",
      ]).default("ring"),
      color: z.enum(["white", "red", "green", "blue", "rgb", "ir", "uv", "custom"]).default("white"),
      colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      intensityPct: z.number().int().min(0).max(100).default(100),
      angleDeg: z.number().int().min(0).max(90).optional(),
      exposureUs: z.number().int().positive().optional(),
      gain: z.string().optional(),
      focusOffsetUm: z.number().int().optional(),
      opticalFilter: z.string().max(60).optional(),
      purpose: z.string().max(60).optional(),
      referenceImageUrl: z.string().url().optional(),
      referenceImageKey: z.string().max(255).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = await db.createMpLightingProfile(input);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "mpLightingProfile.create",
        entityType: "measurementPoint",
        entityId: input.pointDefId,
        details: { shotIndex: input.shotIndex, lightSource: input.lightSource, color: input.color },
        status: "success",
      });
      return { id };
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      shotIndex: z.number().int().positive().optional(),
      name: z.string().max(120).optional(),
      lightSource: z.enum([
        "ring", "coaxial", "dome", "side_low_angle", "back",
        "uv", "ir", "multi_spectral", "dark_field",
      ]).optional(),
      color: z.enum(["white", "red", "green", "blue", "rgb", "ir", "uv", "custom"]).optional(),
      colorHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      intensityPct: z.number().int().min(0).max(100).optional(),
      angleDeg: z.number().int().min(0).max(90).optional(),
      exposureUs: z.number().int().positive().optional(),
      gain: z.string().optional(),
      focusOffsetUm: z.number().int().optional(),
      opticalFilter: z.string().max(60).optional(),
      purpose: z.string().max(60).optional(),
      referenceImageUrl: z.string().url().optional(),
      referenceImageKey: z.string().max(255).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      await db.updateMpLightingProfile(id, data);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "mpLightingProfile.update",
        entityType: "measurementPoint",
        entityId: id,
        details: data,
        status: "success",
      });
      return { success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await db.softDeleteMpLightingProfile(input.id);
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "mpLightingProfile.delete",
        entityType: "measurementPoint",
        entityId: input.id,
        status: "success",
      });
      return { success: true };
    }),
});

// (P4.B routers appended)

// ============================================================
// P4.B G14 — measurement_samples ingest + SPC analytics router
// ============================================================
export const measurementSamplesRouter = router({
  /**
   * Bulk ingest samples (typically from a machine submission). Returns count.
   * Auto-creates monthly partitions as needed.
   */
  ingest: protectedProcedure
    .input(z.object({
      rows: z.array(z.object({
        pointDefId: z.number().int().positive(),
        machineId: z.number().int().positive().optional(),
        inspectionId: z.number().int().positive().optional(),
        serialNumber: z.string().max(128).optional(),
        stationCode: z.string().max(50).optional(),
        value: z.number(),
        isOk: z.boolean().optional(),
        operatorId: z.number().int().positive().optional(),
        instrumentId: z.number().int().positive().optional(),
        lotCode: z.string().max(80).optional(),
        shiftCode: z.string().max(20).optional(),
        envTempC: z.number().optional(),
        envRhPct: z.number().optional(),
        sampledAt: z.coerce.date(),
      })).min(1).max(5000),
    }))
    .mutation(async ({ input }) => {
      // P4.B G19 — hard gate: validate every distinct instrumentId referenced
      // in the batch is fit-for-use (active, in-date calibration, valid MSA).
      const instrumentIds = Array.from(new Set(
        input.rows.map((r) => r.instrumentId).filter((v): v is number => typeof v === "number"),
      ));
      for (const id of instrumentIds) {
        await assertInstrumentReady(id);
      }
      const inserted = await db.insertMeasurementSamples(
        input.rows.map((r) => ({
          ...r,
          value: String(r.value) as any,
          envTempC: r.envTempC != null ? (String(r.envTempC) as any) : undefined,
          envRhPct: r.envRhPct != null ? (String(r.envRhPct) as any) : undefined,
        })) as any,
      );
      return { inserted };
    }),

  /**
   * Recent samples for SPC chart (chronological).
   */
  list: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      windowSize: z.number().int().min(1).max(2000).optional(),
      fromTs: z.coerce.date().optional(),
      toTs: z.coerce.date().optional(),
    }))
    .query(async ({ input }) => {
      return db.listMeasurementSamples(input);
    }),

  /**
   * Compute SPC stats + WE/Nelson/EWMA violations on the fly. Optionally upserts
   * the rolling cache + persists detected alerts.
   */
  analyze: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      windowSize: z.number().int().min(10).max(1000).default(50),
      // Optional explicit limits — otherwise computed from window
      mean: z.number().optional(),
      sigma: z.number().positive().optional(),
      usl: z.number().optional(),
      lsl: z.number().optional(),
      persistAlerts: z.boolean().default(false),
      persistRolling: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const samples = await db.listMeasurementSamples({
        pointDefId: input.pointDefId,
        windowSize: input.windowSize,
      });
      if (samples.length === 0) {
        return { samples: 0, violations: [], capability: null, ewma: null };
      }
      const values = samples.map((s) => Number(s.value));
      const cap = rollingCapability(values, input.usl ?? null, input.lsl ?? null);
      const limits = {
        mean: input.mean ?? cap.mean,
        sigma: input.sigma ?? cap.sigmaWithin,
      };
      const sampleTuples = samples.map((s) => ({
        id: Number(s.id), value: Number(s.value), sampledAt: s.sampledAt,
      }));
      const violations = detectSpcViolations(sampleTuples, limits);
      const ewma = detectEwma(sampleTuples, limits);
      const allViolations = [...violations, ...ewma.violations];

      if (input.persistAlerts) {
        const sinks = loadDefaultSinksFromEnv();
        for (const v of allViolations) {
          await db.createSpcAlert({
            pointDefId: input.pointDefId,
            ruleCode: v.ruleCode,
            ruleName: v.ruleName,
            severity: v.severity,
            windowFrom: v.windowFrom,
            windowTo: v.windowTo,
            sampleIds: v.sampleIds as any,
            summary: v.summary as any,
          });
          // Fire-and-forget — do not block the mutation on sink errors.
          publishSpcAlert({
            pointDefId: input.pointDefId,
            ruleCode: v.ruleCode,
            ruleName: v.ruleName,
            severity: v.severity,
            windowFrom: v.windowFrom,
            windowTo: v.windowTo,
            sampleIds: v.sampleIds as number[],
            summary: v.summary,
          }, sinks).catch(() => undefined);
        }
      }
      if (input.persistRolling) {
        await db.upsertRollingSpc({
          pointDefId: input.pointDefId,
          windowSize: input.windowSize,
          n: samples.length,
          mean: String(cap.mean) as any,
          stdDev: String(cap.sigmaOverall) as any,
          minValue: String(Math.min(...values)) as any,
          maxValue: String(Math.max(...values)) as any,
          cp: cap.cp != null ? (String(cap.cp) as any) : undefined,
          cpk: cap.cpk != null ? (String(cap.cpk) as any) : undefined,
          pp: cap.pp != null ? (String(cap.pp) as any) : undefined,
          ppk: cap.ppk != null ? (String(cap.ppk) as any) : undefined,
          ewmaLast: ewma.ewma.length ? (String(ewma.ewma[ewma.ewma.length - 1]) as any) : undefined,
        });
      }
      return {
        samples: samples.length,
        capability: cap,
        violations: allViolations,
        ewma: { ewma: ewma.ewma, ucl: ewma.ucl, lcl: ewma.lcl },
        limits,
      };
    }),
});

export const spcAlertsRouter = router({
  list: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive().optional(),
      unackedOnly: z.boolean().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.listSpcAlerts(input ?? {});
    }),

  ack: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      note: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await db.ackSpcAlert(input.id, ctx.user.id, input.note);
      return { success: true };
    }),
});

// ============================================================
// P4.B G10 — Per-MP defect heatmap stats router
// ============================================================
export const mpDefectStatsRouter = router({
  byProductModel: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      productViewId: z.number().int().positive().optional(),
      machineId: z.number().int().positive().optional(),
      fromTs: z.coerce.date().optional(),
      toTs: z.coerce.date().optional(),
      // Convenience: lastNDays overrides fromTs/toTs.
      lastNDays: z.number().int().min(1).max(365).optional(),
    }))
    .query(async ({ input }) => {
      let fromTs = input.fromTs;
      let toTs = input.toTs;
      if (input.lastNDays) {
        const now = new Date();
        toTs = now;
        fromTs = new Date(now.getTime() - input.lastNDays * 24 * 3600 * 1000);
      }
      return db.getMpDefectStatsForProduct({
        productModelId: input.productModelId,
        productViewId: input.productViewId,
        machineId: input.machineId,
        fromTs,
        toTs,
      });
    }),
});

// (P4.B G12 MSA advanced router appended)

// ============================================================
// P4.B G12 — Advanced MSA: ANOVA, Bias, Linearity, Stability
// Stateless analytical endpoints (the inputs come from CSV/observations the
// caller already has). Persist results via instrumentMsaRecordRouter.create.
// ============================================================
export const msaAdvancedRouter = router({
  anovaGrr: protectedProcedure
    .input(z.object({
      observations: z.array(z.object({
        operator: z.string().min(1),
        part: z.string().min(1),
        trial: z.number().int().positive(),
        value: z.number(),
      })).min(4),
      tolerance: z.number().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      return calculateAnovaGrr(input.observations, input.tolerance);
    }),

  bias: protectedProcedure
    .input(z.object({
      values: z.array(z.number()).min(2),
      refValue: z.number(),
    }))
    .mutation(async ({ input }) => {
      return calculateBias(input.values, input.refValue);
    }),

  linearity: protectedProcedure
    .input(z.object({
      points: z.array(z.object({
        refValue: z.number(),
        measurements: z.array(z.number()).min(1),
      })).min(2),
    }))
    .mutation(async ({ input }) => {
      return calculateLinearity(input.points);
    }),

  stability: protectedProcedure
    .input(z.object({
      readings: z.array(z.object({
        timestamp: z.coerce.date(),
        values: z.array(z.number()).min(2).max(10),
      })).min(2),
    }))
    .mutation(async ({ input }) => {
      return calculateStability(input.readings);
    }),

  /**
   * For ANOVA on an existing MSA study (uses the study's observations table).
   */
  anovaOfStudy: protectedProcedure
    .input(z.object({
      studyId: z.number().int().positive(),
      tolerance: z.number().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const obs = await db.listMsaObservationsByStudy(input.studyId);
      const adapted = obs.map((o: any) => ({
        operator: String(o.operatorName ?? "?"),
        part: String(o.partLabel ?? "?"),
        trial: Number(o.trialNumber ?? 1),
        value: Number(o.measuredValue),
      })).filter((o) => Number.isFinite(o.value));
      return calculateAnovaGrr(adapted, input.tolerance);
    }),
});

// (P4.B G9 CAD import router appended)

// ============================================================
// P4.B G9 — CAD Import (STEP AP242 + DXF) router
// Two-step flow:
//   1) parseUpload  — uploads CAD text + parses → creates job + candidates.
//   2) listCandidates / setSelection — user reviews, toggles candidates.
//   3) apply — converts selected candidates into measurement_point_defs.
// ============================================================
export const cadImportRouter = router({
  list: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listCadImportJobsByProduct(input.productModelId);
    }),

  getJob: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.getCadImportJobById(input.id);
    }),

  parseUpload: adminProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      fileName: z.string().min(1).max(255),
      // Base64-encoded contents OR raw text (set isBase64 accordingly).
      content: z.string().min(1).max(50 * 1024 * 1024),
      isBase64: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const text = input.isBase64
        ? Buffer.from(input.content, "base64").toString("utf-8")
        : input.content;
      const buf = Buffer.from(text, "utf-8");
      const sha256 = createHash("sha256").update(buf).digest("hex");

      // Persist raw file in storage (best-effort).
      const key = `cad-imports/${input.productModelId}/${Date.now()}_${input.fileName}`;
      let stored: { key: string; url: string } | null = null;
      try {
        stored = await storagePut(key, buf, "application/octet-stream");
      } catch (e: any) {
        // Don't block parsing if storage fails.
      }

      const parsed = parseCad(input.fileName, text);
      const jobId = await db.createCadImportJob({
        productModelId: input.productModelId,
        format: parsed.format,
        fileName: input.fileName,
        fileKey: stored?.key,
        fileUrl: stored?.url,
        fileSizeBytes: buf.length,
        fileSha256: sha256,
        status: "parsed",
        parserVersion: parsed.parserVersion,
        entityCounts: parsed.entityCounts,
        candidatePointCount: parsed.candidates.length,
        uploadedBy: ctx.user.id,
      });
      if (parsed.candidates.length > 0) {
        await db.bulkInsertCadImportCandidates(parsed.candidates.map((c) => ({
          jobId,
          candidateIndex: c.candidateIndex,
          code: c.code,
          name: c.name,
          shape: c.shape,
          positionX: String(c.positionX) as any,
          positionY: String(c.positionY) as any,
          positionZ: c.positionZ != null ? (String(c.positionZ) as any) : undefined,
          radius: c.radius != null ? (String(c.radius) as any) : undefined,
          geometry: c.geometry as any,
          sourceEntityType: c.sourceEntityType,
          sourceEntityId: c.sourceEntityId,
        })));
      }
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "cadImport.parse",
        entityType: "product",
        entityId: input.productModelId,
        entityName: input.fileName,
        details: {
          jobId, format: parsed.format,
          candidates: parsed.candidates.length,
          warnings: parsed.warnings,
        },
        status: "success",
      });
      return {
        jobId,
        format: parsed.format,
        candidates: parsed.candidates.length,
        entityCounts: parsed.entityCounts,
        warnings: parsed.warnings,
      };
    }),

  listCandidates: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return db.listCadImportCandidates(input.jobId);
    }),

  setSelection: adminProcedure
    .input(z.object({
      jobId: z.number().int().positive(),
      candidateIds: z.array(z.number().int().positive()).max(10000),
      selected: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      await db.setCadCandidateSelection(input.jobId, input.candidateIds, input.selected);
      return { success: true };
    }),

  applyJob: adminProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const job = await db.getCadImportJobById(input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "CAD import job not found" });
      if (job.status === "applied") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CAD import job already applied" });
      }
      const count = await db.applyCadImportJob(input.jobId, ctx.user.id);
      // Bump pointsConfigVersion so machines re-fetch
      try {
        const pm = await db.getProductModelById(job.productModelId);
        const next = (pm?.pointsConfigVersion ?? 1) + 1;
        await db.updateProductModel(job.productModelId, {
          pointsConfigVersion: next,
          updatedAt: new Date(),
        } as any);
      } catch {}
      await db.createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "cadImport.apply",
        entityType: "product",
        entityId: job.productModelId,
        entityName: job.fileName,
        details: { jobId: input.jobId, applied: count },
        status: "success",
      });
      return { applied: count };
    }),
});
