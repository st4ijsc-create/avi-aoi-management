/**
 * AI Quality Gate Router
 * 
 * Endpoints for managing quality gate configs, processing inspections,
 * and reviewing AI decisions.
 */
import { protectedProcedure, router } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  aiQualityGateConfigs,
  aiQualityGateResults,
  aiEnsembleConfigs,
  productInspections,
} from "../../drizzle/schema";
import {
  processQualityGate,
  getQualityGateConfig,
  getQualityGateStats,
  invalidateConfigCache,
} from "../services/aiQualityGate";
import fs from "fs";
import path from "path";

export const aiQualityGateRouter = router({
  // ─── Config Management ──────────────────────────────────

  listConfigs: protectedProcedure
    .input(
      z.object({
        machineId: z.number().optional(),
        productModelId: z.number().optional(),
        enabled: z.boolean().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [];
      if (input?.machineId) conditions.push(eq(aiQualityGateConfigs.machineId, input.machineId));
      if (input?.productModelId) conditions.push(eq(aiQualityGateConfigs.productModelId, input.productModelId));
      if (input?.enabled !== undefined) conditions.push(eq(aiQualityGateConfigs.enabled, input.enabled));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      return db
        .select()
        .from(aiQualityGateConfigs)
        .where(where)
        .orderBy(desc(aiQualityGateConfigs.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
    }),

  getConfig: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [config] = await db.select().from(aiQualityGateConfigs).where(eq(aiQualityGateConfigs.id, input.id)).limit(1);
      if (!config) throw new TRPCError({ code: "NOT_FOUND", message: "Quality gate config not found" });
      return config;
    }),

  createConfig: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        machineId: z.number().optional(),
        productModelId: z.number().optional(),
        modelId: z.number(),
        enabled: z.boolean().default(true),
        autoOkThreshold: z.number().min(0).max(1).default(0.95),
        autoNgThreshold: z.number().min(0).max(1).default(0.85),
        reviewThreshold: z.number().min(0).max(1).default(0.60),
        ngLabels: z.array(z.string()).default([]),
        okLabels: z.array(z.string()).default([]),
        ensembleConfigId: z.number().optional(),
        alertOnAutoNg: z.boolean().default(true),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [result] = await db
        .insert(aiQualityGateConfigs)
        .values({
          ...input,
          autoOkThreshold: input.autoOkThreshold.toFixed(4),
          autoNgThreshold: input.autoNgThreshold.toFixed(4),
          reviewThreshold: input.reviewThreshold.toFixed(4),
          createdBy: ctx.user.id,
        })
        .returning();
      invalidateConfigCache(input.machineId);
      return result;
    }),

  updateConfig: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        modelId: z.number().optional(),
        enabled: z.boolean().optional(),
        autoOkThreshold: z.number().min(0).max(1).optional(),
        autoNgThreshold: z.number().min(0).max(1).optional(),
        reviewThreshold: z.number().min(0).max(1).optional(),
        ngLabels: z.array(z.string()).optional(),
        okLabels: z.array(z.string()).optional(),
        ensembleConfigId: z.number().nullable().optional(),
        alertOnAutoNg: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { id, autoOkThreshold, autoNgThreshold, reviewThreshold, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
      if (autoOkThreshold !== undefined) updateData.autoOkThreshold = autoOkThreshold.toFixed(4);
      if (autoNgThreshold !== undefined) updateData.autoNgThreshold = autoNgThreshold.toFixed(4);
      if (reviewThreshold !== undefined) updateData.reviewThreshold = reviewThreshold.toFixed(4);
      const [result] = await db
        .update(aiQualityGateConfigs)
        .set(updateData)
        .where(eq(aiQualityGateConfigs.id, id))
        .returning();
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Config not found" });
      invalidateConfigCache();
      return result;
    }),

  deleteConfig: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.delete(aiQualityGateConfigs).where(eq(aiQualityGateConfigs.id, input.id));
      invalidateConfigCache();
      return { success: true };
    }),

  // ─── Process Inspection ──────────────────────────────────

  processInspection: protectedProcedure
    .input(
      z.object({
        inspectionId: z.number(),
        imageKey: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Get inspection to find machine & product
      const inspResult = await db.execute(
        sql`SELECT "machineId", "productModelId" FROM product_inspections WHERE id = ${input.inspectionId}`,
      ) as any;
      const insp = inspResult.rows?.[0];
      if (!insp) throw new TRPCError({ code: "NOT_FOUND", message: "Inspection not found" });

      // Find matching quality gate config
      const config = await getQualityGateConfig(
        insp.machineId,
        insp.productModelId,
      );
      if (!config) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No quality gate config found for this machine/product",
        });
      }

      // Load image from storage
      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");
      const imagePath = path.join(uploadsRoot, input.imageKey);
      if (!fs.existsSync(imagePath)) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Image file not found" });
      }
      const imageBuffer = fs.readFileSync(imagePath);

      const decision = await processQualityGate(
        input.inspectionId,
        imageBuffer,
        config,
      );
      return decision;
    }),

  // ─── Review Decisions ────────────────────────────────────

  listResults: protectedProcedure
    .input(
      z.object({
        configId: z.number().optional(),
        decision: z.enum(["AUTO_OK", "AUTO_NG", "NEEDS_REVIEW", "MANUAL"]).optional(),
        inspectionId: z.number().optional(),
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [];
      if (input?.configId) conditions.push(eq(aiQualityGateResults.configId, input.configId));
      if (input?.decision) conditions.push(eq(aiQualityGateResults.decision, input.decision));
      if (input?.inspectionId) conditions.push(eq(aiQualityGateResults.inspectionId, input.inspectionId));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      return db
        .select()
        .from(aiQualityGateResults)
        .where(where)
        .orderBy(desc(aiQualityGateResults.createdAt))
        .limit(input?.limit ?? 50)
        .offset(input?.offset ?? 0);
    }),

  reviewDecision: protectedProcedure
    .input(
      z.object({
        resultId: z.number(),
        reviewDecision: z.enum(["OK", "NG"]),
        reviewNotes: z.string().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [result] = await db
        .update(aiQualityGateResults)
        .set({
          reviewedBy: ctx.user.id,
          reviewedAt: new Date(),
          reviewDecision: input.reviewDecision,
          reviewNotes: input.reviewNotes,
        })
        .where(eq(aiQualityGateResults.id, input.resultId))
        .returning();
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Quality gate result not found" });

      // Also update the inspection's AI decision based on human review
      const newDecision = input.reviewDecision === "OK" ? "AUTO_OK" : "AUTO_NG";
      await db
        .update(productInspections)
        .set({ aiDecision: newDecision as any })
        .where(eq(productInspections.id, result.inspectionId));

      return result;
    }),

  // ─── Statistics ──────────────────────────────────────────

  stats: protectedProcedure
    .input(
      z.object({
        configId: z.number().optional(),
        machineId: z.number().optional(),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
      }).optional(),
    )
    .query(async ({ input }) => {
      return getQualityGateStats(input ?? {});
    }),

  // ─── Ensemble Config Management ──────────────────────────

  listEnsembles: protectedProcedure
    .input(
      z.object({
        productModelId: z.number().optional(),
        enabled: z.boolean().optional(),
        limit: z.number().min(1).max(200).default(50),
      }).optional(),
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [];
      if (input?.productModelId) conditions.push(eq(aiEnsembleConfigs.productModelId, input.productModelId));
      if (input?.enabled !== undefined) conditions.push(eq(aiEnsembleConfigs.enabled, input.enabled));
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      return db
        .select()
        .from(aiEnsembleConfigs)
        .where(where)
        .orderBy(desc(aiEnsembleConfigs.createdAt))
        .limit(input?.limit ?? 50);
    }),

  createEnsemble: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        strategy: z.enum(["VOTING", "WEIGHTED_AVERAGE", "STACKING", "CASCADE"]).default("VOTING"),
        modelIds: z.array(z.number()).min(2).max(10),
        weights: z.array(z.number()).optional(),
        productModelId: z.number().optional(),
        cascadeThreshold: z.number().min(0).max(1).optional(),
        enabled: z.boolean().default(true),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [result] = await db
        .insert(aiEnsembleConfigs)
        .values({
          ...input,
          cascadeThreshold: input.cascadeThreshold?.toFixed(4),
          createdBy: ctx.user.id,
        })
        .returning();
      return result;
    }),

  updateEnsemble: adminProcedure
    .input(
      z.object({
        id: z.number(),
        name: z.string().min(1).max(255).optional(),
        strategy: z.enum(["VOTING", "WEIGHTED_AVERAGE", "STACKING", "CASCADE"]).optional(),
        modelIds: z.array(z.number()).min(2).max(10).optional(),
        weights: z.array(z.number()).optional(),
        cascadeThreshold: z.number().min(0).max(1).optional(),
        enabled: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { id, cascadeThreshold, ...rest } = input;
      const updateData: Record<string, unknown> = { ...rest, updatedAt: new Date() };
      if (cascadeThreshold !== undefined) updateData.cascadeThreshold = cascadeThreshold.toFixed(4);
      const [result] = await db
        .update(aiEnsembleConfigs)
        .set(updateData)
        .where(eq(aiEnsembleConfigs.id, id))
        .returning();
      if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "Ensemble config not found" });
      return result;
    }),

  deleteEnsemble: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.delete(aiEnsembleConfigs).where(eq(aiEnsembleConfigs.id, input.id));
      return { success: true };
    }),
});
