import { protectedProcedure, router, roleProcedure, require2FA } from "../_core/trpc";
import { adminProcedure } from "./_shared";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { isUniqueViolation } from "../_core/dbErrors";
import {
  uploadModelFile,
  uploadModelVersion,
  activateModelVersionManual,
  getModelFileUrl,
  registerModel,
} from "../services/aiModelService";
import {
  runInference,
  evictSessionCache,
  getLoadedModels,
} from "../services/aiInferenceEngine";
import { promoteStage, listStages } from "../services/ai/modelStagePipeline";
import { checkActiveClassifierHealth } from "../services/aiClassifierHealth";
import {
  getModelCardStatus,
  isModelCardRequired,
  isCardComplete,
  isCardApproved,
} from "../services/aiModelCardGate";
import {
  ENTITY_TYPES,
  createAuditContext,
  logCreate,
  logUpdate,
} from "../services/auditTrailService";

// D3 (doc69 Giai đoạn 4/Wave 3) — model-card governance CRUD is admin/engineer gated
// (mirrors ecnRouter's ecnDecisionProcedure pattern: `roleProcedure("admin", ...,
// "engineer")`), broader than the admin-only `adminProcedure` this router uses
// elsewhere for model/version CRUD — governance authoring is an engineering task too.
//
// FIX (reviewer, security): create/update/approve are governance TRUST decisions
// (approve authorizes activation) — admin/engineer are both in `_core/trpc.ts`'s
// PRIVILEGED_ROLES, so this codebase's policy is these actions require step-up-free
// but ENABLED 2FA (IEC 62443-2-1 CL2), same as supervisorProcedure/qualityProcedure/
// actuationProcedure. `require2FA` is the SAME guard those use (now exported from
// _core/trpc.ts) — chained in the same order (role check, then audit/tenant via
// roleProcedure, then 2FA) as those pre-built procedures, not a new implementation.
// The read path (getCard, below) intentionally stays on plain `protectedProcedure`
// — the editor must be able to LOAD a card before 2FA has been stepped up.
const modelCardProcedure = roleProcedure("admin", "engineer").use(require2FA);

/** Card create/update/approve share this exact message so a raced double-create
 *  (see FIX below) surfaces identically whether caught by the check-then-insert
 *  read or by the DB's own unique constraint. */
const CARD_ALREADY_EXISTS_MESSAGE = "A model card already exists for this model — use update instead.";

/** Clean PRECONDITION_FAILED instead of a raw 42P01 "relation does not exist" 500 —
 *  mirrors productVariantRouter's assertVariantTableAvailable / qualityGateTemplateRouter's
 *  inline `err.code === '42P01'` guard. Only WRITE paths need this: the read path
 *  (getCard) already degrades via getModelCardStatus.
 *
 *  FIX (reviewer, minor): createCard's check-then-insert (below) is not
 *  transactional — a concurrent double-create can race past the `existing` check
 *  and hit the `ai_model_cards.modelId` unique constraint on INSERT, surfacing a
 *  raw Postgres 23505 instead of the intended CONFLICT. `isUniqueViolation` (from
 *  `_core/dbErrors.ts`, the shared helper already used by productVariantRouter/
 *  productCloneRouter/etc.) walks err.cause too (drizzle-orm wraps the driver error
 *  in DrizzleQueryError), so this catches the race under either error shape without
 *  swallowing unrelated errors. */
function rethrowCardTableError(err: unknown): never {
  if ((err as { code?: string } | null | undefined)?.code === "42P01") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Model card governance requires migration 0303 (ai_model_cards) to be applied first.",
    });
  }
  if (isUniqueViolation(err)) {
    throw new TRPCError({ code: "CONFLICT", message: CARD_ALREADY_EXISTS_MESSAGE });
  }
  throw err;
}

export const aiModelRouter = router({
  // ─── doc 69 Wave 6 (F1) — "no active classifier" health signal ─────
  // Surfaces whether an ACTIVE defect-classifier exists so the FE can warn
  // operators when the quality-gate / A-B pipeline is inert. Fail-safe.
  classifierHealth: protectedProcedure.query(() => checkActiveClassifierHealth()),

  // ─── Model CRUD ──────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      modelType: z.string().optional(),
      format: z.enum(["ONNX", "TENSORRT", "OPENVINO", "CUSTOM", "GGUF"]).optional(),
      status: z.enum(["UPLOADING", "VALIDATING", "READY", "ACTIVE", "INACTIVE", "FAILED", "ARCHIVED"]).optional(),
      productModelId: z.number().optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getAiModels((input ?? undefined) as any);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const model = await db.getAiModelById(input.id);
      if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      return model;
    }),

  getByCode: protectedProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const model = await db.getAiModelByCode(input.code);
      if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      return model;
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(100),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      modelType: z.string().min(1).max(100),
      format: z.enum(["ONNX", "TENSORRT", "OPENVINO", "CUSTOM", "GGUF"]).optional(),
      inputShape: z.array(z.number()).optional(),
      outputShape: z.array(z.number()).optional(),
      labels: z.array(z.string()).optional(),
      preprocessConfig: z.object({
        resize: z.object({ width: z.number(), height: z.number() }).optional(),
        normalize: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }).optional(),
        colorSpace: z.enum(["RGB", "BGR", "GRAY"]).optional(),
        channelFirst: z.boolean().optional(),
      }).optional(),
      postprocessConfig: z.object({
        type: z.string(),
        confidenceThreshold: z.number().optional(),
        nmsThreshold: z.number().optional(),
        topK: z.number().optional(),
      }).optional(),
      productModelId: z.number().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return registerModel({
        ...input,
        createdBy: ctx.user.id,
        status: "UPLOADING",
      } as any);
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      modelType: z.string().optional(),
      inputShape: z.array(z.number()).optional(),
      outputShape: z.array(z.number()).optional(),
      labels: z.array(z.string()).optional(),
      preprocessConfig: z.object({
        resize: z.object({ width: z.number(), height: z.number() }).optional(),
        normalize: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }).optional(),
        colorSpace: z.enum(["RGB", "BGR", "GRAY"]).optional(),
        channelFirst: z.boolean().optional(),
      }).optional(),
      postprocessConfig: z.object({
        type: z.string(),
        confidenceThreshold: z.number().optional(),
        nmsThreshold: z.number().optional(),
        topK: z.number().optional(),
      }).optional(),
      productModelId: z.number().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const existing = await db.getAiModelById(id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      return db.updateAiModel(id, data as any);
    }),

  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const existing = await db.getAiModelById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });
      evictSessionCache(input.id);
      await db.deleteAiModel(input.id);
      return { success: true };
    }),

  // ─── Model File Upload ──────────────────────────────────
  uploadFile: adminProcedure
    .input(z.object({
      modelId: z.number(),
      fileBase64: z.string(),
      filename: z.string(),
      contentType: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const fileBuffer = Buffer.from(input.fileBase64, "base64");
      return uploadModelFile(input.modelId, fileBuffer, input.filename, input.contentType);
    }),

  // ─── Version Management ─────────────────────────────────
  listVersions: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return db.getModelVersions(input.modelId);
    }),

  createVersion: adminProcedure
    .input(z.object({
      modelId: z.number(),
      version: z.string().min(1),
      fileBase64: z.string(),
      filename: z.string(),
      changeLog: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fileBuffer = Buffer.from(input.fileBase64, "base64");
      return uploadModelVersion(input.modelId, input.version, fileBuffer, input.filename, input.changeLog, ctx.user.id);
    }),

  activateVersion: adminProcedure
    .input(z.object({
      modelId: z.number(),
      versionId: z.number(),
      // W0-2 (doc 69) — explicit, audited override for a version that hasn't passed
      // (or hasn't run) the eval quality gate. See aiModelService.activateModelVersionManual.
      force: z.boolean().optional(),
      reason: z.string().min(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const activated = await activateModelVersionManual(input.modelId, input.versionId, {
        force: input.force,
        reason: input.reason,
        actorUserId: ctx.user.id,
      });
      evictSessionCache(input.modelId);
      return activated;
    }),

  getFileUrl: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return getModelFileUrl(input.modelId);
    }),

  // ─── Inference ──────────────────────────────────────────
  runInference: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      imageBase64: z.string(),
      inspectionId: z.number().optional(),
      measurementResultId: z.number().optional(),
      inputReference: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const imageBuffer = Buffer.from(input.imageBase64, "base64");
      return runInference(input.modelId, imageBuffer, {
        inspectionId: input.inspectionId,
        measurementResultId: input.measurementResultId,
        inputReference: input.inputReference,
      });
    }),

  getInferenceResults: protectedProcedure
    .input(z.object({
      modelId: z.number().optional(),
      inspectionId: z.number().optional(),
      measurementResultId: z.number().optional(),
      status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"]).optional(),
      limit: z.number().min(1).max(200).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return db.getInferenceResults(input ?? undefined);
    }),

  getInferenceStats: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return db.getInferenceStats(input.modelId);
    }),

  // ─── Active Model Lookup ────────────────────────────────
  getActiveForProduct: protectedProcedure
    .input(z.object({
      productModelId: z.number(),
      modelType: z.string().optional(),
    }))
    .query(async ({ input }) => {
      return db.getActiveModelForProduct(input.productModelId, input.modelType);
    }),

  // ─── Model Stage Pipeline (G4.24/G4.25) ─────────────────
  // Registry view: each version's stage + append-only stage_history + ModelCard bits.
  listStages: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      return listStages(input.modelId);
    }),

  // Promote a version through the mandatory MLOps gates. adminProcedure + optional
  // second `approver` (required by the canary→production two-person rule). A gate
  // violation surfaces as PRECONDITION_FAILED carrying the machine code.
  promoteStage: adminProcedure
    .input(z.object({
      versionId: z.number(),
      toStage: z.enum(["staging", "shadow", "canary", "production", "retired"]),
      approver: z.number().optional(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await promoteStage(input.versionId, input.toStage, {
        actor: ctx.user.id,
        approver: input.approver,
        reason: input.reason,
      });
      if (!result.ok) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `[${result.code}] ${result.reason}`,
        });
      }
      // A production promotion changes the served model → evict its inference cache.
      if (input.toStage === "production") {
        const v = await db.getModelVersionById(input.versionId);
        if (v) evictSessionCache(v.modelId);
      }
      return result;
    }),

  // ─── Model Card Governance (D3, doc69 Giai đoạn 4/Wave 3) ────
  // ONE governance card per model. `getCard` is read-only for any authenticated user
  // (matches the rest of this router's read paths) and is fail-safe against an
  // unmigrated ai_model_cards table (getModelCardStatus catches 42P01). Deliberately
  // NOT built on evaluateCardGate — that short-circuits WITHOUT a DB read when
  // AI_MODEL_CARD_REQUIRED is off (the default), which would make an already-authored
  // card invisible to the FE viewer/editor whenever the flag is off. `getCard` always
  // attempts the read; `required`/`blocking` are computed separately from the flag so
  // the FE can distinguish "no card yet" from "card exists but isn't enforced yet".
  // Writes (create/update/approve) are admin/engineer gated and audited via the
  // generic CRUD audit (logCreate/logUpdate) — a SEPARATE concern from the
  // AI_MODEL_GOVERNANCE lifecycle-audit row aiModelService writes on activate/
  // rollback/override.
  getCard: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(async ({ input }) => {
      const status = await getModelCardStatus(input.modelId);
      const complete = isCardComplete(status.card);
      const approved = isCardApproved(status.card);
      const required = isModelCardRequired();
      const blocking = required && status.tableAvailable && !(complete && approved);
      let reason: string | undefined;
      if (blocking) {
        reason = !status.card
          ? "No model card exists for this model — create and approve one before activating."
          : !complete
            ? "Model card is incomplete (missing required governance fields)."
            : "Model card has not been approved yet.";
      }
      return {
        card: status.card,
        tableAvailable: status.tableAvailable,
        required,
        complete,
        approved,
        satisfied: !required || (status.tableAvailable && complete && approved),
        // Would activation ACTUALLY be refused right now without a force override?
        blocking,
        reason,
      };
    }),

  createCard: modelCardProcedure
    .input(z.object({
      modelId: z.number(),
      intendedUse: z.string().min(1).max(4000),
      trainingDataDesc: z.string().min(1).max(4000),
      evalSummary: z.string().min(1).max(4000),
      limitations: z.string().min(1).max(4000),
      riskClass: z.enum(["low", "medium", "high"]),
      owner: z.string().min(1).max(255).optional(),
      notes: z.string().max(4000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const model = await db.getAiModelById(input.modelId);
      if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "AI model not found" });

      try {
        const existing = await db.getModelCardByModelId(input.modelId);
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: CARD_ALREADY_EXISTS_MESSAGE,
          });
        }

        // ModelCard §12.2 back-compat: fall back to the LATEST version's inline
        // `owner` when the card doesn't specify one explicitly — the card, once
        // created, becomes the source of truth (see drizzle/schema/ai.ts's doc
        // comment on aiModelCards).
        let owner = input.owner;
        if (!owner) {
          const versions = await db.getModelVersions(input.modelId);
          owner = versions.find((v) => v.owner)?.owner ?? undefined;
        }

        const card = await db.createModelCard({
          modelId: input.modelId,
          intendedUse: input.intendedUse,
          trainingDataDesc: input.trainingDataDesc,
          evalSummary: input.evalSummary,
          limitations: input.limitations,
          riskClass: input.riskClass,
          owner,
          notes: input.notes,
          createdBy: ctx.user.id,
        });

        try {
          await logCreate(createAuditContext(ctx), ENTITY_TYPES.AI_MODEL_CARD, card.id, model.name, card as any);
        } catch { /* best-effort — never let audit logging fail the create */ }

        return card;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        rethrowCardTableError(err);
      }
    }),

  updateCard: modelCardProcedure
    .input(z.object({
      modelId: z.number(),
      intendedUse: z.string().min(1).max(4000).optional(),
      trainingDataDesc: z.string().min(1).max(4000).optional(),
      evalSummary: z.string().min(1).max(4000).optional(),
      limitations: z.string().min(1).max(4000).optional(),
      riskClass: z.enum(["low", "medium", "high"]).optional(),
      owner: z.string().min(1).max(255).optional(),
      notes: z.string().max(4000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { modelId, ...patch } = input;
      try {
        const existing = await db.getModelCardByModelId(modelId);
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No model card exists for this model yet — create one first.",
          });
        }
        const updated = await db.updateModelCardByModelId(modelId, patch);
        try {
          await logUpdate(
            createAuditContext(ctx),
            ENTITY_TYPES.AI_MODEL_CARD,
            existing.id,
            `model ${modelId}`,
            existing as any,
            (updated ?? existing) as any,
          );
        } catch { /* best-effort */ }
        return updated;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        rethrowCardTableError(err);
      }
    }),

  approveCard: modelCardProcedure
    .input(z.object({ modelId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const existing = await db.getModelCardByModelId(input.modelId);
        if (!existing) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No model card exists for this model yet — create one first.",
          });
        }
        if (!isCardComplete(existing)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Cannot approve an incomplete model card — fill in all required governance fields first.",
          });
        }
        const approved = await db.approveModelCardByModelId(input.modelId, ctx.user.id);
        try {
          await logUpdate(
            createAuditContext(ctx),
            ENTITY_TYPES.AI_MODEL_CARD,
            existing.id,
            `model ${input.modelId}`,
            existing as any,
            (approved ?? existing) as any,
          );
        } catch { /* best-effort */ }
        return approved;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        rethrowCardTableError(err);
      }
    }),

  // ─── Health Check ───────────────────────────────────────
  loadedModels: protectedProcedure
    .query(async () => {
      return getLoadedModels();
    }),
});
