/**
 * Twin/AI governance tRPC router — SYNAPSE §5.7/§5.8 (doc 33 H6). READ-ONLY.
 *
 * Previews of the twin-drift detector and the RL dispatch advisor (both pure). No mutations —
 * the twin sync + scheduler adopt these (flags TWIN_DRIFT / RL_ADVISOR).
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { detectDrift } from "../services/twin/driftDetector";
import { isTwinTrusted, runFidelityCheck } from "../services/twin/twinFidelityService";
import { adviseDispatch, newRlAdvisorState, type RlMode } from "../services/ai/rlDispatchAdvisor";

export const twinGovRouter = router({
  /** Twin↔reality drift report for a set of (simulated, actual) metric pairs. */
  driftReport: protectedProcedure
    .input(
      z.object({
        pairs: z.array(z.object({ metric: z.string(), simulated: z.number(), actual: z.number() })),
        threshold: z.number().min(0).max(1).optional(),
      }),
    )
    .query(({ input }) => detectDrift(input.pairs, input.threshold ?? 0.1)),

  /** doc 44 W5-A1 (G4.1) — is a twin trustworthy enough for AUTOMATED decisions? */
  twinTrusted: protectedProcedure
    .input(z.object({ twinRef: z.string().max(128) }))
    .query(({ input }) => isTwinTrusted(input.twinRef)),

  /** doc 44 W5-A1 — run ONE fidelity check now (DES-vs-reality) for a line; persists + upserts trust. */
  runFidelityCheck: protectedProcedure
    .input(z.object({ lineId: z.number().int().positive() }))
    .mutation(({ input }) => runFidelityCheck(input.lineId)),

  /** RL dispatch advice for a given mode + heuristic/RL choices + candidate set. */
  rlAdvice: protectedProcedure
    .input(
      z.object({
        mode: z.enum(["off", "shadow", "suggest", "auto"]),
        heuristicChoice: z.string(),
        rlChoice: z.string(),
        candidateSet: z.array(z.string()),
      }),
    )
    .query(({ input }) =>
      adviseDispatch(newRlAdvisorState(input.mode as RlMode), {
        heuristicChoice: input.heuristicChoice,
        rlChoice: input.rlChoice,
        candidateSet: input.candidateSet,
      }),
    ),
});
