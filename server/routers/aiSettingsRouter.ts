/**
 * AI Settings Router — API Key management, Model Config, System Config, Data Pipeline
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { router, protectedProcedure } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { getDb } from "../db/connection";
import { aiApiKeys, aiSystemConfig, aiImageEmbeddings } from "../../drizzle/schema/ai";
import { eq, desc, sql } from "drizzle-orm";
import { extractEmbedding, storeEmbedding } from "../services/aiImageEmbedding";
import { encryptSecret, decryptSecret, isEncrypted } from "../services/security/secretBox";

// ─── Pipeline helpers ─────────────────────────────────────────────────────────

type PipelineRunStatus = "completed" | "error";
interface PipelineRun {
  startedAt: string;
  processedCount: number;
  failedCount: number;
  status: PipelineRunStatus;
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"]);

function getImageFilesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getImageFilesInDir(fullPath));
      } else if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  } catch {
    // ignore unreadable dirs
  }
  return results;
}

type DbType = NonNullable<Awaited<ReturnType<typeof getDb>>>;
async function upsertConfigValue(db: DbType, key: string, value: string): Promise<void> {
  await db
    .insert(aiSystemConfig)
    .values({ key, value })
    .onConflictDoUpdate({ target: aiSystemConfig.key, set: { value, updatedAt: new Date() } });
}

// ─── API key at-rest secret helpers (doc 69 W0-4) ─────────────────────────────
//
// The `aiApiKeys.encryptedKey` column used to hold `Buffer.from(apiKey).toString("base64")`
// — reversible ENCODING, not encryption (doc-51 P0 finding). It now stores the output of
// `secretBox.encryptSecret` (AES-256-GCM, `enc:v1:...`). The decrypted plaintext must NEVER
// be sent to a client — only a last-4 mask is exposed, and only for internal use (masking /
// a future reachability check) do we ever call `resolveAndMigrateApiKeySecret`.

/** Last-4 mask for display — never return the full secret over the wire. */
function maskKeyTail(secret: string | null): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? secret : secret.slice(-4);
}

/**
 * Decrypt a stored `aiApiKeys.encryptedKey` value for INTERNAL use only (masking). Handles
 * legacy rows written by the pre-W0-4 base64 "encoding" gracefully: decodes them and
 * opportunistically re-encrypts at rest with secretBox so they self-heal on next read
 * (best-effort — a failed re-write never blocks the read, e.g. no SECRET_ENCRYPTION_KEY set).
 */
async function resolveAndMigrateApiKeySecret(
  db: DbType,
  row: { id: number; encryptedKey: string },
): Promise<string | null> {
  const { encryptedKey } = row;
  if (isEncrypted(encryptedKey)) return decryptSecret(encryptedKey);

  // Legacy base64 "encoding" from the pre-W0-4 code path — Buffer base64-decode never
  // throws in Node, so this can't crash even on an unexpected/corrupt value.
  const legacyPlaintext = Buffer.from(encryptedKey, "base64").toString("utf8");
  try {
    const reEncrypted = encryptSecret(legacyPlaintext);
    if (reEncrypted) {
      await db
        .update(aiApiKeys)
        .set({ encryptedKey: reEncrypted, updatedAt: new Date() })
        .where(eq(aiApiKeys.id, row.id));
    }
  } catch {
    // best-effort migration; the read path must still succeed even if this write fails
  }
  return legacyPlaintext;
}

export const aiSettingsRouter = router({
  // ═══════════════ API Key Management ═══════════════

  listApiKeys: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const keys = await db
      .select()
      .from(aiApiKeys)
      .orderBy(desc(aiApiKeys.createdAt));
    // The plaintext secret is decrypted here ONLY to derive a last-4 mask — it is never
    // included in the returned objects (doc-51 P0 / doc-69 W0-4: list/get must not leak
    // the raw key, not even base64-encoded).
    const result = [];
    for (const k of keys) {
      const plaintext = await resolveAndMigrateApiKeySecret(db, k);
      result.push({
        id: k.id,
        name: k.name,
        provider: k.provider,
        endpoint: k.endpoint,
        status: k.status,
        lastTestedAt: k.lastTestedAt,
        createdBy: k.createdBy,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt,
        // FE's ApiKeyEntry.maskedKey is `string | undefined` (optional prop) — use
        // undefined, not null, so this stays a plain additive field for existing callers.
        maskedKey: maskKeyTail(plaintext) ?? undefined,
      });
    }
    return result;
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
      // doc 69 W0-4: real encryption at rest (AES-256-GCM via secretBox) — replaces the
      // prior Buffer.from(...).toString("base64"), which was reversible ENCODING, not
      // encryption (doc-51 P0 finding).
      const encryptedKey = encryptSecret(input.apiKey);
      if (!encryptedKey) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to encrypt API key",
        });
      }
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
      // doc 69 W0-4: the system is 100% local (cloud LLM removed at WS-G3) — there is no
      // real provider endpoint to call here. The previous "isValid = encryptedKey.length > 0"
      // check was a FABRICATED pass (doc-51 P0 finding). Report an honest "not supported"
      // result instead of a fake success, and do NOT overwrite `status` with a made-up
      // verdict (we didn't actually test connectivity, so we don't get to say active/error).
      const testedAt = new Date();
      await db
        .update(aiApiKeys)
        .set({ lastTestedAt: testedAt, updatedAt: testedAt })
        .where(eq(aiApiKeys.id, input.id));
      return {
        success: false,
        supported: false,
        testedAt,
        message:
          "Connectivity testing is not available: this deployment runs local-only inference (no outbound calls to cloud AI providers).",
      };
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
    const db = await getDb();
    if (!db) {
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
    }

    const [embRow] = await db
      .select({ count: sql<string>`count(*)` })
      .from(aiImageEmbeddings);
    const processedImages = parseInt(embRow?.count ?? "0", 10);

    const uploadsRoot = process.env.LOCAL_STORAGE_DIR
      ? path.resolve(process.env.LOCAL_STORAGE_DIR)
      : path.join(process.cwd(), "uploads");
    const totalFiles = getImageFilesInDir(uploadsRoot).filter(
      (f) =>
        !f.includes(path.sep + "augmented" + path.sep) &&
        !f.includes(path.sep + "temp" + path.sep)
    ).length;
    const totalImages = Math.max(totalFiles, processedImages);

    const configRows = await db
      .select()
      .from(aiSystemConfig)
      .where(
        sql`${aiSystemConfig.key} IN ('pipeline_status', 'pipeline_last_run_at', 'pipeline_failed_count')`
      );
    const cfgMap = new Map(configRows.map((c) => [c.key, c.value]));

    return {
      stats: {
        totalImages,
        processedImages,
        pendingImages: Math.max(0, totalImages - processedImages),
        failedImages: parseInt(cfgMap.get("pipeline_failed_count") ?? "0", 10),
        lastRunAt: cfgMap.get("pipeline_last_run_at") ?? null,
        status: (cfgMap.get("pipeline_status") ?? "idle") as
          | "idle"
          | "running"
          | "completed"
          | "error",
      },
    };
  }),

  runDataPipeline: adminProcedure
    .input(z.object({}).optional())
    .mutation(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const startedAt = new Date().toISOString();
      await upsertConfigValue(db, "pipeline_status", "running");
      await upsertConfigValue(db, "pipeline_last_run_at", startedAt);

      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");

      setImmediate(async () => {
        let processedCount = 0;
        let failedCount = 0;
        try {
          const [modelCfgRow] = await db
            .select()
            .from(aiSystemConfig)
            .where(eq(aiSystemConfig.key, "defaultModelId"))
            .limit(1);
          const modelId = parseInt(modelCfgRow?.value ?? "1", 10);

          const existingRows = await db
            .select({ imageUrl: aiImageEmbeddings.imageUrl })
            .from(aiImageEmbeddings);
          const processedSet = new Set(existingRows.map((r) => r.imageUrl));

          const imageFiles = getImageFilesInDir(uploadsRoot).filter(
            (f) =>
              !f.includes(path.sep + "augmented" + path.sep) &&
              !f.includes(path.sep + "temp" + path.sep)
          );

          for (const imgFile of imageFiles) {
            const relPath = path.relative(uploadsRoot, imgFile).replace(/\\/g, "/");
            if (processedSet.has(relPath)) continue;
            try {
              const imgBuffer = fs.readFileSync(imgFile);
              const embResult = await extractEmbedding(modelId, imgBuffer);
              await storeEmbedding({
                imageUrl: relPath,
                embedding: embResult.embedding,
                dim: embResult.dim,
                modelCode: embResult.modelCode,
              });
              processedCount++;
            } catch {
              failedCount++;
            }
          }

          await upsertConfigValue(db, "pipeline_status", "completed");
          await upsertConfigValue(db, "pipeline_failed_count", String(failedCount));
        } catch {
          await upsertConfigValue(db, "pipeline_status", "error");
        }

        try {
          const [histRow] = await db
            .select()
            .from(aiSystemConfig)
            .where(eq(aiSystemConfig.key, "pipeline_run_history"))
            .limit(1);
          const history: PipelineRun[] = histRow ? JSON.parse(histRow.value) : [];
          history.unshift({
            startedAt,
            processedCount,
            failedCount,
            status: failedCount === 0 ? "completed" : "error",
          });
          await upsertConfigValue(
            db,
            "pipeline_run_history",
            JSON.stringify(history.slice(0, 10))
          );
        } catch {
          // non-critical
        }
      });

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
      const uploadsRoot = process.env.LOCAL_STORAGE_DIR
        ? path.resolve(process.env.LOCAL_STORAGE_DIR)
        : path.join(process.cwd(), "uploads");
      const augDir = path.join(uploadsRoot, "augmented");
      if (!fs.existsSync(augDir)) {
        fs.mkdirSync(augDir, { recursive: true });
      }

      const imageFiles = getImageFilesInDir(uploadsRoot).filter(
        (f) =>
          !f.includes(path.sep + "augmented" + path.sep) &&
          !f.includes(path.sep + "temp" + path.sep)
      );

      setImmediate(async () => {
        for (const imgFile of imageFiles) {
          const ext = path.extname(imgFile);
          const base = path.basename(imgFile, ext);
          for (let i = 0; i < input.multiplier; i++) {
            const outPath = path.join(augDir, `${base}_aug${i}${ext}`);
            try {
              let pipeline = sharp(imgFile);
              if (input.augmentations.includes("flip")) {
                pipeline = i % 2 === 0 ? pipeline.flip() : pipeline.flop();
              }
              if (input.augmentations.includes("rotate")) {
                const angles = [90, 180, 270] as const;
                pipeline = pipeline.rotate(angles[i % 3]);
              }
              if (input.augmentations.includes("brightness")) {
                pipeline = pipeline.modulate({ brightness: 0.8 + (i % 5) * 0.1 });
              }
              if (input.augmentations.includes("contrast")) {
                pipeline = pipeline.linear(0.8 + (i % 5) * 0.1, 0);
              }
              if (input.augmentations.includes("blur")) {
                pipeline = pipeline.blur(1 + (i % 3));
              }
              if (input.augmentations.includes("noise")) {
                pipeline = pipeline.blur(0.5 + (i % 3) * 0.3);
              }
              if (input.augmentations.includes("grayscale")) {
                pipeline = pipeline.grayscale();
              }
              if (input.augmentations.includes("resize")) {
                const sizes = [224, 256, 320, 448, 512];
                const sz = sizes[i % sizes.length];
                pipeline = pipeline.resize(sz, sz, { fit: "contain" });
              }
              if (input.augmentations.includes("crop")) {
                const meta = await sharp(imgFile).metadata();
                const w = meta.width ?? 640;
                const h = meta.height ?? 640;
                const cw = Math.floor(w * 0.8);
                const ch = Math.floor(h * 0.8);
                const left = Math.floor((w - cw) * ((i % 3) / 2));
                const top = Math.floor((h - ch) * ((i % 3) / 2));
                pipeline = pipeline.extract({ left, top, width: cw, height: ch });
              }
              await pipeline.toFile(outPath);
            } catch {
              // skip individual failures
            }
          }
        }
      });

      return {
        success: true,
        augmentations: input.augmentations,
        multiplier: input.multiplier,
        message: `Augmentation job started for ${imageFiles.length} source images`,
      };
    }),

  // ═══════════════ Preprocessing Config ═══════════════

  getPreprocessingConfig: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;
    const rows = await db
      .select()
      .from(aiSystemConfig)
      .where(
        sql`${aiSystemConfig.key} IN ('pp_targetWidth', 'pp_targetHeight', 'pp_normalize', 'pp_grayscale', 'pp_removeBackground', 'pp_autoContrast', 'pp_resizeMode')`
      );
    const m = new Map(rows.map((r) => [r.key, r.value]));
    return {
      targetWidth: m.get("pp_targetWidth") ?? "640",
      targetHeight: m.get("pp_targetHeight") ?? "640",
      normalize: m.get("pp_normalize") !== "false",
      grayscale: m.get("pp_grayscale") === "true",
      removeBackground: m.get("pp_removeBackground") === "true",
      autoContrast: m.get("pp_autoContrast") !== "false",
      resizeMode: m.get("pp_resizeMode") ?? "letterbox",
    };
  }),

  savePreprocessingConfig: adminProcedure
    .input(
      z.object({
        targetWidth: z.string().optional(),
        targetHeight: z.string().optional(),
        normalize: z.boolean().optional(),
        grayscale: z.boolean().optional(),
        removeBackground: z.boolean().optional(),
        autoContrast: z.boolean().optional(),
        resizeMode: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const updates: [string, string][] = (
        [
          input.targetWidth !== undefined ? ["pp_targetWidth", input.targetWidth] : null,
          input.targetHeight !== undefined ? ["pp_targetHeight", input.targetHeight] : null,
          input.normalize !== undefined ? ["pp_normalize", String(input.normalize)] : null,
          input.grayscale !== undefined ? ["pp_grayscale", String(input.grayscale)] : null,
          input.removeBackground !== undefined ? ["pp_removeBackground", String(input.removeBackground)] : null,
          input.autoContrast !== undefined ? ["pp_autoContrast", String(input.autoContrast)] : null,
          input.resizeMode !== undefined ? ["pp_resizeMode", input.resizeMode] : null,
        ] as ([string, string] | null)[]
      ).filter((x): x is [string, string] => x !== null);
      for (const [key, value] of updates) {
        await upsertConfigValue(db, key, value);
      }
      return { success: true };
    }),

  // ═══════════════ Pipeline Run History ═══════════════

  getPipelineHistory: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [] as PipelineRun[];
    const [row] = await db
      .select()
      .from(aiSystemConfig)
      .where(eq(aiSystemConfig.key, "pipeline_run_history"))
      .limit(1);
    if (!row) return [] as PipelineRun[];
    try {
      return JSON.parse(row.value) as PipelineRun[];
    } catch {
      return [] as PipelineRun[];
    }
  }),

  // ═══════════════ Hybrid AI Provider (S2.6) ═══════════════

  getHybridProviderStatus: adminProcedure.query(async () => {
    const {
      getProviderConfig,
      getBreakerSnapshot,
      getRecentEvents,
    } = await import("../services/aiProviderRouter");
    const { isGgufAvailable } = await import("../services/aiGgufEngine");
    const config = getProviderConfig();
    const ggufAvailable = await isGgufAvailable().catch(() => false);
    return {
      config,
      ggufAvailable,
      openaiConfigured: !!process.env.OPENAI_API_KEY,
      breakers: getBreakerSnapshot(),
      recentEvents: getRecentEvents(100),
    };
  }),

  setHybridProviderConfig: adminProcedure
    .input(
      z.object({
        primary: z.enum(["openai", "gguf"]).optional(),
        fallbackEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { setProviderConfig } = await import("../services/aiProviderRouter");
      return setProviderConfig(input);
    }),

  resetHybridBreaker: adminProcedure
    .input(z.object({ key: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { resetBreaker } = await import("../services/aiProviderRouter");
      resetBreaker(input.key);
      return { success: true };
    }),

  // ═══════════════ S3.2 — Async Job Queue ═══════════════

  enqueueNarrativeJob: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(20000),
        systemPrompt: z.string().max(8000).optional(),
        maxTokens: z.number().int().min(1).max(8192).optional(),
        temperature: z.number().min(0).max(2).optional(),
        language: z.enum(["en", "vi"]).optional(),
        cacheKey: z.string().max(128).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { enqueueNarrative } = await import("../services/aiJobQueue");
      return enqueueNarrative(input, ctx.user?.id);
    }),

  getAiJob: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { getJob } = await import("../services/aiJobQueue");
      const job = getJob(input.id, ctx.user?.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      return job;
    }),

  listAiJobs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const { listJobs, getQueueSnapshot } = await import("../services/aiJobQueue");
      return {
        jobs: listJobs(ctx.user?.id, input?.limit ?? 50),
        snapshot: getQueueSnapshot(),
      };
    }),

  cancelAiJob: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { cancelJob } = await import("../services/aiJobQueue");
      const ok = cancelJob(input.id, ctx.user?.id);
      return { success: ok };
    }),

  // ═══════════════ S3.4 — Batch RCA cron ═══════════════

  getBatchRcaStatus: adminProcedure.query(async () => {
    const { getBatchRcaStatus } = await import("../services/aiBatchRcaScheduler");
    return getBatchRcaStatus();
  }),

  runBatchRcaNow: adminProcedure.mutation(async () => {
    const { runBatchRCAOnce } = await import("../services/aiBatchRcaScheduler");
    return runBatchRCAOnce();
  }),
});
