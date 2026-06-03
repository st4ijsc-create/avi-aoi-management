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
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { buildDataset } from "../services/aiDatasetBuilder";
import { evaluateModelVersion, compareBeforeAfter, evaluateQualityGate } from "../services/aiEvalHarness";
import { scanInferenceForUncertainty, scanCommitteeDisagreement } from "../services/aiActiveLearningAuto";
import { createTrainingJob, checkAutoRetrainTrigger } from "../services/aiTrainingPipeline";

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
        throw new TRPCError({ code: "BAD_REQUEST", message: "datasetId is required (create + build a dataset first)" });
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
});
