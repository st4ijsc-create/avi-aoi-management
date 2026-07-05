/**
 * Orchestration governance tRPC router — SYNAPSE §5.1/§5.3 (doc 33 F8). READ-ONLY.
 *
 * Previews the durable-orchestration primitives for a Control Tower / engineer: validate a
 * recipe DAG (topological + cycle check), order a task queue (priority/aging/EDF), and check
 * whether an action needs four-eyes approval. No mutations — the FOE engine adopts these.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { validateDag } from "../services/orchestration/dag";
import { orderQueue, requiresFourEyes, type PriorityBand, type PrioritizedTask } from "../services/orchestration/slaPolicy";

export const orchestrationGovRouter = router({
  /** Validate a recipe DAG (missing refs + cycle detection) → topological order. */
  validateDag: protectedProcedure
    .input(z.object({ nodes: z.array(z.object({ id: z.string(), deps: z.array(z.string()) })) }))
    .query(({ input }) => validateDag(input.nodes)),

  /** Order a task queue for dispatch (priority band + aging + EDF). */
  orderQueue: protectedProcedure
    .input(
      z.object({
        now: z.number(),
        agingMs: z.number().optional(),
        tasks: z.array(
          z.object({
            id: z.string(),
            priority: z.number().min(0).max(3),
            createdTs: z.number(),
            deadlineTs: z.number().optional(),
            preemptible: z.boolean().optional(),
          }),
        ),
      }),
    )
    .query(({ input }) =>
      orderQueue(
        input.tasks.map((t) => ({ ...t, priority: t.priority as PriorityBand })) as PrioritizedTask[],
        input.now,
        input.agingMs,
      ).map((t) => t.id),
    ),

  /** Does an action require four-eyes approval? (delegates to the F5 policy engine) */
  fourEyesCheck: protectedProcedure
    .input(z.object({ context: z.record(z.string(), z.unknown()) }))
    .query(({ input }) => requiresFourEyes(input.context as { action?: string })),
});
