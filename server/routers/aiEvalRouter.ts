/**
 * AI Eval & Self-Learning Router — WS-1
 *
 * Endpoints for: dataset build, model-version evaluation, before/after compare
 * (quality gate), automatic active-learning scans (uncertainty/committee), and
 * the auto-retrain trigger check.
 *
 * License gating: this repo has no per-procedure license middleware in
 * server/_core/trpc.ts (only requireUser / role / 2FA). Privileged actions use
 * adminProcedure. TODO(WS-1): wire a `licenseProcedure` once a per-procedure
 * license middleware exists; for now licensing is enforced at the Express
 * module/route layer like the rest of the app.
 */

import { z } from "zod";
import { router, moduleProcedure, moduleGate, adminProcedure as adminProcedureBase } from "../_core/trpc";
// ★ Cổng giấy phép MOD_AI — chỉ THÊM chiều giấy phép, RBAC/vai/2FA giữ nguyên từng ký tự.
//   Không-brick + fail-safe ở `_core/moduleGate.ts`; lượng từ canh ở `congGiayPhepAiCensus.test.ts`.
const protectedProcedure = moduleProcedure("MOD_AI");
const adminProcedure = adminProcedureBase.use(moduleGate("MOD_AI"));
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { buildDataset } from "../services/aiDatasetBuilder";
import { evaluateModelVersion, compareBeforeAfter, evaluateQualityGate } from "../services/aiEvalHarness";
import { scanInferenceForUncertainty, scanCommitteeDisagreement } from "../services/aiActiveLearningAuto";
import { createTrainingJob, checkAutoRetrainTrigger } from "../services/aiTrainingPipeline";
import { listModelCards, generateModelCard, seedPortfolioCards } from "../services/aiModelCard";
import { checkConfidenceDrift, getDriftMetrics } from "../services/aiDriftMonitor";
import { bootstrapFirstClassifier, InsufficientLabeledSamplesError } from "../services/aiBootstrapClassifier";

export const aiEvalRouter = router({
  // ─── Dataset materialization ────────────────────────────────
  buildDataset: adminProcedure
    .input(z.object({
      datasetId: z.number(),
      seed: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      return buildDataset(input.datasetId, { seed: input.seed });
    }),

  // ─── Evaluate a trained classifier on a split ───────────────
  evaluate: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      classifierPath: z.string().min(1),
      datasetId: z.number(),
      split: z.enum(["train", "val", "test"]).default("test"),
    }))
    .mutation(async ({ input }) => {
      return evaluateModelVersion({
        modelId: input.modelId,
        classifierPath: input.classifierPath,
        datasetId: input.datasetId,
        split: input.split,
      });
    }),

  // ─── Before/after compare + quality gate ────────────────────
  compareBeforeAfter: adminProcedure
    .input(z.object({
      modelId: z.number(),
      candidateClassifierPath: z.string().min(1),
      candidateVersionId: z.number().optional(),
      baselineClassifierPath: z.string().nullish(),
      baselineVersionId: z.number().nullish(),
      datasetId: z.number(),
      split: z.enum(["train", "val", "test"]).default("test"),
      epsilon: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      return compareBeforeAfter(input);
    }),

  // ─── Stateless quality-gate check (for UI confirmation dialogs) ─
  qualityGate: protectedProcedure
    .input(z.object({
      candidateAccuracy: z.number().min(0).max(1),
      baselineAccuracy: z.number().min(0).max(1).nullable(),
      epsilon: z.number().min(0).max(1).optional(),
    }))
    .query(({ input }) =>
      evaluateQualityGate(input.candidateAccuracy, input.baselineAccuracy, input.epsilon ?? 0),
    ),

  // ─── Auto active-learning: uncertainty scan ─────────────────
  scanUncertainty: adminProcedure
    .input(z.object({
      modelId: z.number(),
      uncertaintyThreshold: z.number().min(0).max(1).optional(),
      sinceHours: z.number().min(1).max(8760).optional(),
      maxItems: z.number().min(1).max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const since = input.sinceHours
        ? new Date(Date.now() - input.sinceHours * 3600_000)
        : undefined;
      return scanInferenceForUncertainty({
        modelId: input.modelId,
        uncertaintyThreshold: input.uncertaintyThreshold,
        since,
        maxItems: input.maxItems,
      });
    }),

  // ─── Auto active-learning: committee disagreement scan ──────
  scanCommittee: adminProcedure
    .input(z.object({
      modelIds: z.array(z.number()).min(2),
      disagreementThreshold: z.number().min(0).max(1).optional(),
      sinceHours: z.number().min(1).max(8760).optional(),
      maxItems: z.number().min(1).max(2000).optional(),
    }))
    .mutation(async ({ input }) => {
      const since = input.sinceHours
        ? new Date(Date.now() - input.sinceHours * 3600_000)
        : undefined;
      return scanCommitteeDisagreement({
        modelIds: input.modelIds,
        disagreementThreshold: input.disagreementThreshold,
        since,
        maxItems: input.maxItems,
      });
    }),

  // ─── Auto-retrain trigger check ─────────────────────────────
  autoRetrainCheck: protectedProcedure
    .input(z.object({ modelId: z.number() }))
    .query(({ input }) => checkAutoRetrainTrigger(input.modelId)),

  // ─── B5.4 Governance: list model cards (Qwen3 portfolio + registered) ─
  modelCards: protectedProcedure.query(() => listModelCards()),

  // ─── B5.4: (re)generate + persist a card for one registered model ─────
  generateModelCard: adminProcedure
    .input(z.object({ modelId: z.number() }))
    .mutation(async ({ input }) => {
      const card = await generateModelCard(input.modelId);
      if (!card) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "aiModel" }, `Model ${input.modelId} not found`);
      return card;
    }),

  // ─── B5.4: seed/refresh the Qwen3 portfolio cards (idempotent) ────────
  seedPortfolioCards: adminProcedure.mutation(() => seedPortfolioCards()),

  // ─── B5.2 Drift: confidence-distribution drift check (advisory-only) ──
  driftCheck: protectedProcedure
    .input(z.object({
      modelId: z.number(),
      modelVersion: z.string().optional(),
      // default true: persist an advisory model_drift_alerts row on drift.
      emitAlert: z.boolean().optional(),
    }))
    .mutation(({ input }) => checkConfidenceDrift({
      modelId: input.modelId,
      modelVersion: input.modelVersion,
      emitAlert: input.emitAlert,
    })),

  // ─── B5.2 Drift: in-memory detection counters (telemetry) ─────────────
  driftMetrics: protectedProcedure.query(() => getDriftMetrics()),

  // ─── Kick off a full Tier-1 training pipeline ───────────────
  startPipeline: adminProcedure
    .input(z.object({
      modelId: z.number(),
      targetVersion: z.string().min(1),
      classLabels: z.array(z.string().min(1)).min(2).max(100),
      datasetId: z.number().optional(),
      strategy: z.enum(["transfer", "fewshot"]).default("transfer"),
      // Tier-2 opt-in (default Tier-1 local-embedding). Sidecar only runs when
      // LOCAL_TRAINER_CMD is also set server-side.
      trainingMode: z.enum(["local-embedding", "local-sidecar"]).optional(),
      task: z.enum(["classification", "detection", "segmentation"]).optional(),
      framework: z.string().min(1).optional(),
      gateEpsilon: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!input.datasetId) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "datasetId" }, "datasetId is required (create + build a dataset first)");
      }
      return createTrainingJob({
        name: `pipeline-${input.modelId}-${input.targetVersion}`,
        modelId: input.modelId,
        targetVersion: input.targetVersion,
        datasetConfig: { classLabels: input.classLabels } as any,
        classLabels: input.classLabels,
        datasetId: input.datasetId,
        strategy: input.strategy,
        trainingMode: input.trainingMode,
        task: input.task,
        framework: input.framework,
        gateEpsilon: input.gateEpsilon ?? 0,
        createdBy: (ctx as any).user?.id,
      });
    }),

  // ─── doc 69 Wave 6 (F1), servability fixed in the F1 review — bootstrap the
  // FIRST defect classifier ─────
  // Admin-gated, end-to-end: honesty check (>= minSamplesPerClass REAL labeled
  // embedding samples) → train a DINOv2 embedding-head (the ONE classifier
  // shape aiInferenceEngine.runInference actually dispatches) → eval on the
  // locked TEST split → quality gate → register a model_versions row →
  // activate ONLY on a gate PASS, via the W0-2 gated activateModelVersionManual.
  // Never fabricates a model — see services/aiBootstrapClassifier.ts.
  bootstrapFirstClassifier: adminProcedure
    .input(z.object({
      baseModelId: z.number(),
      classifierCode: z.string().min(1).max(100),
      classifierName: z.string().min(1).max(255).optional(),
      classLabels: z.array(z.string().min(1)).min(2).max(100),
      productModelId: z.number().optional(),
      targetVersion: z.string().min(1).optional(),
      minSamplesPerClass: z.number().min(1).max(1000).optional(),
      datasetId: z.number().optional(),
      gateEpsilon: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        return await bootstrapFirstClassifier({
          ...input,
          actorUserId: ctx.user.id,
          createdBy: ctx.user.id,
        });
      } catch (err) {
        if (err instanceof InsufficientLabeledSamplesError) {
          throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "bootstrapFirstClassifier" }, err.message);
        }
        throw err;
      }
    }),
});
