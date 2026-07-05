/**
 * Security governance tRPC router — SYNAPSE §5.11 (doc 33 F5). READ-ONLY.
 *
 * Surfaces the policy-as-code rule set and lets an operator DRY-RUN a decision for a
 * hypothetical context (governance preview). No mutations: policy authoring/versioning via a
 * governance workflow is a later phase. The write-gate consults `evaluatePolicies` directly.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { DEFAULT_POLICIES, evaluatePolicies } from "../services/security/policyEngine";

export const securityRouter = router({
  /** The active first-party policy set (versioned). */
  policies: protectedProcedure.query(() =>
    DEFAULT_POLICIES.map((p) => ({
      id: p.id,
      effect: p.effect,
      version: p.version,
      reason: p.reason,
      actions: p.actions ?? [],
      conditionCount: p.conditions.length,
    })),
  ),

  /** Dry-run: evaluate a hypothetical context against the policy set (preview a decision). */
  evaluate: protectedProcedure
    .input(z.object({ context: z.record(z.string(), z.unknown()) }))
    .query(({ input }) => evaluatePolicies(input.context as { action?: string }, DEFAULT_POLICIES)),
});
