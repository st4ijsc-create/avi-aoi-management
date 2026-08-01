/**
 * DORA tRPC router — doc 44 W6-4 (gap G5.20). SYNAPSE_Tang5 Ch.15 (GitOps/DORA).
 *
 * READ (metrics/list) is available to any authenticated user (dashboard/exec view).
 * WRITE (record a deployment event) is admin-gated AND flag-gated by DORA_ENABLED
 * (recordDeployment no-ops honestly when the flag is off).
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDoraMetrics, listDeployments, recordDeployment, doraEnabled } from "../services/observability/doraService";

const statusEnum = z.enum(["success", "failed", "rolled_back"]);

export const doraRouter = router({
  /** Runtime state of the DORA feature (flag). */
  status: protectedProcedure.query(() => ({ enabled: doraEnabled() })),

  /** The four DORA metrics over a rolling window. Read-only; degrades to `no_data`. */
  metrics: protectedProcedure
    .input(
      z
        .object({
          environment: z.string().max(64).optional(),
          windowDays: z.number().int().min(1).max(365).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => getDoraMetrics(input ?? {})),

  /** Recent deployment events (for a table/timeline). */
  list: protectedProcedure
    .input(
      z
        .object({
          environment: z.string().max(64).optional(),
          windowDays: z.number().int().min(1).max(365).optional(),
          limit: z.number().int().min(1).max(2000).optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => listDeployments(input ?? {})),

  /**
   * Record a deployment event (CI/CD hook or manual). Admin-gated; no-ops when
   * DORA_ENABLED is off. Returns { recorded, id?, reason? } so a CI caller can log it.
   */
  record: adminProcedure
    .input(
      z.object({
        version: z.string().max(128).optional(),
        commitSha: z.string().max(64).optional(),
        environment: z.string().max(64).optional(),
        service: z.string().max(128).optional(),
        status: statusEnum.optional(),
        deployedBy: z.string().max(256).optional(),
        deployedAt: z.string().datetime().optional(),
        leadTimeMs: z.number().int().min(0).optional(),
        meta: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) =>
      recordDeployment({
        ...input,
        deployedBy: input.deployedBy ?? ctx.user?.name ?? ctx.user?.username ?? null,
      }),
    ),
});
