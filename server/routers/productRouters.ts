import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { storagePut } from "../storage";

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
            }
          } catch (error) {
            console.error('Failed to upload product model image to S3:', error);
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to upload image' });
          }
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
