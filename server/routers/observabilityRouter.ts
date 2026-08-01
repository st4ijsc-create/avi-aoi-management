/**
 * Observability tRPC router — SYNAPSE §5.12 (doc 33 F6). READ-ONLY.
 *
 * Surfaces the SLO catalogue (+ a preview evaluator) and recent decision-traces so a Control
 * Tower can answer "vì sao robot X được chọn?" and show error-budget/burn-rate. No mutations.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { DEFAULT_SLOS, sloStatus, burnRate } from "../services/observability/slo";
import { queryDecisions } from "../services/observability/decisionTrace";
// Importing activates the decision-trace DB sink (doc 33 W4) — persists to decision_traces when OBSERVABILITY on.
import { queryPersistedDecisions } from "../services/observability/decisionTracePersistence";

const obsSchema = z.object({ good: z.number().min(0), total: z.number().min(0) });

export const observabilityRouter = router({
  /** The SLO catalogue (targets only). */
  slos: protectedProcedure.query(() => DEFAULT_SLOS),

  /** Preview: given (good,total) observations, compute status + burn-rate for an SLO. */
  evaluateSlo: protectedProcedure
    .input(
      z.object({
        sloId: z.string(),
        window: obsSchema,
        shortWindow: obsSchema.optional(),
        longWindow: obsSchema.optional(),
      }),
    )
    .query(({ input }) => {
      const target = DEFAULT_SLOS.find((s) => s.id === input.sloId);
      if (!target) return { found: false as const };
      const status = sloStatus(target, input.window);
      const burn =
        input.shortWindow && input.longWindow
          ? burnRate(target, input.shortWindow, input.longWindow)
          : null;
      return { found: true as const, status, burn };
    }),

  /** Recent decision traces from the in-memory ring (most recent first). */
  recentDecisions: protectedProcedure
    .input(
      z
        .object({
          decisionType: z.string().optional(),
          subject: z.string().optional(),
          correlationId: z.string().optional(),
          limit: z.number().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(({ input }) => queryDecisions(input ?? {})),

  /** doc 33 W4: persisted decision traces from the DB (survives restarts; historical). */
  persistedDecisions: protectedProcedure
    .input(
      z
        .object({
          decisionType: z.string().optional(),
          subject: z.string().optional(),
          since: z.number().optional(),
          limit: z.number().min(1).max(1000).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => queryPersistedDecisions(input ?? {})),
});
