/**
 * AI Setup Advisor Router (LUỒNG ① + E.0 — Technician Copilot).
 *
 * suggestSetup: given a new machine's type (+ optional product model / target
 * machine), find the most similar existing machine and return a PROPOSED config
 * bundle (measurement points, thresholds [data vs copied], NG thresholds, station
 * suggestion, recommended model).
 *
 * ADVISORY ONLY. There is intentionally NO bulk-write here: the wizard applies
 * the bundle through its EXISTING RBAC'd create mutations (machine.create,
 * measurementPoint.*, ngRateThreshold.*, edgeDeployment.deployModel). HITL and
 * permissions stay exactly as they are. Read-only + fail-safe.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { MACHINE_TYPES } from "../constants/machineTypes";
import {
  findSimilarTemplate,
  buildConfigBundle,
  isSetupAdvisorEnabled,
} from "../services/aiSetupAdvisor";

export const aiSetupAdvisorRouter = router({
  /** Cheap flag probe for the UI (so it can show "chưa khả dụng"). */
  status: protectedProcedure.query(() => ({ enabled: isSetupAdvisorEnabled() })),

  suggestSetup: protectedProcedure
    .input(
      z.object({
        machineType: z.enum(MACHINE_TYPES),
        productModelId: z.number().int().positive().optional(),
        targetMachineId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input }) => {
      const template = await findSimilarTemplate(input);
      const bundle = await buildConfigBundle(input);
      return { template, bundle };
    }),
});
