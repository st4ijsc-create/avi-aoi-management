/**
 * AI Settings Router — API Key management, Model Config, System Config, Data Pipeline
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { getDb } from "../db/connection";
import { aiApiKeys, aiSystemConfig } from "../../drizzle/schema/ai";
import { eq, desc, sql } from "drizzle-orm";

export const aiSettingsRouter = router({
  // ═══════════════ API Key Management ═══════════════

  listApiKeys: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const keys = await db
      .select({
        id: aiApiKeys.id,
        name: aiApiKeys.name,
        provider: aiApiKeys.provider,
        endpoint: aiApiKeys.endpoint,
        status: aiApiKeys.status,
        lastTestedAt: aiApiKeys.lastTestedAt,
        createdBy: aiApiKeys.createdBy,
        createdAt: aiApiKeys.createdAt,
        updatedAt: aiApiKeys.updatedAt,
      })
      .from(aiApiKeys)
      .orderBy(desc(aiApiKeys.createdAt));
    return keys;
  }),

  createApiKey: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        provider: z.enum(["openai", "azure_openai", "huggingface", "custom"]),
        apiKey: z.string().min(1),
        endpoint: z.string().url().optional().or(z.literal("")),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      // Store key with basic base64 obfuscation (in production, use proper encryption)
      const encryptedKey = Buffer.from(input.apiKey).toString("base64");
      const [result] = await db
        .insert(aiApiKeys)
        .values({
          name: input.name,
          provider: input.provider,
          encryptedKey,
          endpoint: input.endpoint || null,
          status: "active",
          createdBy: ctx.user.id,
        })
        .returning({
          id: aiApiKeys.id,
          name: aiApiKeys.name,
          provider: aiApiKeys.provider,
          status: aiApiKeys.status,
          createdAt: aiApiKeys.createdAt,
        });
      return result;
    }),

  deleteApiKey: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      const [existing] = await db
        .select({ id: aiApiKeys.id })
        .from(aiApiKeys)
        .where(eq(aiApiKeys.id, input.id))
        .limit(1);
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      await db.delete(aiApiKeys).where(eq(aiApiKeys.id, input.id));
      return { success: true };
    }),

  testApiKey: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      const [key] = await db
        .select()
        .from(aiApiKeys)
        .where(eq(aiApiKeys.id, input.id))
        .limit(1);
      if (!key)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      // Simulate API key test — in production, make a real API call
      const isValid = key.encryptedKey.length > 0;
      await db
        .update(aiApiKeys)
        .set({
          lastTestedAt: new Date(),
          status: isValid ? "active" : "error",
          updatedAt: new Date(),
        })
        .where(eq(aiApiKeys.id, input.id));
      return { success: isValid, testedAt: new Date() };
    }),

  toggleApiKey: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      const [key] = await db
        .select({ id: aiApiKeys.id, status: aiApiKeys.status })
        .from(aiApiKeys)
        .where(eq(aiApiKeys.id, input.id))
        .limit(1);
      if (!key)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      const newStatus = key.status === "active" ? "inactive" : "active";
      const [result] = await db
        .update(aiApiKeys)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(aiApiKeys.id, input.id))
        .returning({
          id: aiApiKeys.id,
          status: aiApiKeys.status,
        });
      return result;
    }),

  // ═══════════════ Model Config ═══════════════

  getConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        defaultModelId: null,
        confidenceThreshold: 0.7,
        maxConcurrentInferences: 4,
        gpuAcceleration: false,
        autoScale: false,
      };
    const configs = await db
      .select()
      .from(aiSystemConfig)
      .where(
        sql`${aiSystemConfig.key} IN ('defaultModelId', 'confidenceThreshold', 'maxConcurrentInferences', 'gpuAcceleration', 'autoScale')`
      );
    const map = new Map(configs.map((c) => [c.key, c.value]));
    return {
      defaultModelId: map.get("defaultModelId")
        ? Number(map.get("defaultModelId"))
        : null,
      confidenceThreshold: Number(map.get("confidenceThreshold") ?? 0.7),
      maxConcurrentInferences: Number(
        map.get("maxConcurrentInferences") ?? 4
      ),
      gpuAcceleration: map.get("gpuAcceleration") === "true",
      autoScale: map.get("autoScale") === "true",
    };
  }),

  updateConfig: adminProcedure
    .input(
      z.object({
        defaultModelId: z.number().nullable().optional(),
        confidenceThreshold: z.number().min(0).max(1).optional(),
        maxConcurrentInferences: z.number().min(1).max(32).optional(),
        gpuAcceleration: z.boolean().optional(),
        autoScale: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      const entries = Object.entries(input).filter(
        ([, v]) => v !== undefined
      );
      for (const [key, value] of entries) {
        const strValue = String(value ?? "");
        await db
          .insert(aiSystemConfig)
          .values({
            key,
            value: strValue,
            updatedBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: aiSystemConfig.key,
            set: { value: strValue, updatedBy: ctx.user.id, updatedAt: new Date() },
          });
      }
      return { success: true };
    }),

  // ═══════════════ System Config ═══════════════

  getSystemConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db)
      return {
        aiEnabled: true,
        inferenceLogging: true,
        dataRetentionDays: 90,
        maxUploadSizeMb: 100,
      };
    const configs = await db
      .select()
      .from(aiSystemConfig)
      .where(
        sql`${aiSystemConfig.key} IN ('aiEnabled', 'inferenceLogging', 'dataRetentionDays', 'maxUploadSizeMb')`
      );
    const map = new Map(configs.map((c) => [c.key, c.value]));
    return {
      aiEnabled: map.get("aiEnabled") !== "false",
      inferenceLogging: map.get("inferenceLogging") !== "false",
      dataRetentionDays: Number(map.get("dataRetentionDays") ?? 90),
      maxUploadSizeMb: Number(map.get("maxUploadSizeMb") ?? 100),
    };
  }),

  updateSystemConfig: adminProcedure
    .input(
      z.object({
        aiEnabled: z.boolean().optional(),
        inferenceLogging: z.boolean().optional(),
        dataRetentionDays: z.number().min(1).max(3650).optional(),
        maxUploadSizeMb: z.number().min(1).max(10000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      const entries = Object.entries(input).filter(
        ([, v]) => v !== undefined
      );
      for (const [key, value] of entries) {
        const strValue = String(value);
        await db
          .insert(aiSystemConfig)
          .values({
            key,
            value: strValue,
            updatedBy: ctx.user.id,
          })
          .onConflictDoUpdate({
            target: aiSystemConfig.key,
            set: { value: strValue, updatedBy: ctx.user.id, updatedAt: new Date() },
          });
      }
      return { success: true };
    }),

  // ═══════════════ Data Pipeline ═══════════════

  getDataPipelineStats: protectedProcedure.query(async () => {
    // Returns pipeline statistics — in production, query from actual pipeline tables
    return {
      stats: {
        totalImages: 0,
        processedImages: 0,
        pendingImages: 0,
        failedImages: 0,
        lastRunAt: null as string | null,
        status: "idle" as const,
      },
    };
  }),

  runDataPipeline: adminProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      // Placeholder: start data processing pipeline
      return { success: true, message: "Pipeline started" };
    }),

  runAugmentation: adminProcedure
    .input(
      z.object({
        augmentations: z.array(z.string()),
        multiplier: z.number().min(1).max(20),
      })
    )
    .mutation(async ({ input }) => {
      // Placeholder: start augmentation job
      return {
        success: true,
        augmentations: input.augmentations,
        multiplier: input.multiplier,
        message: "Augmentation job started",
      };
    }),
});
