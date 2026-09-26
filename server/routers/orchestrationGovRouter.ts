/**
 * Orchestration governance tRPC router — SYNAPSE §5.1/§5.3 (doc 33 F8). READ-ONLY.
 *
 * Previews the durable-orchestration primitives for a Control Tower / engineer: validate a
 * recipe DAG (topological + cycle check), order a task queue (priority/aging/EDF), and check
 * whether an action needs four-eyes approval. No mutations — the FOE engine adopts these.
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { validateDag } from "../services/orchestration/dag";
import { orderQueue, requiresFourEyes, type PriorityBand, type PrioritizedTask } from "../services/orchestration/slaPolicy";
import { loadRunEvents, replayPersistedRun } from "../services/orchestration/runEventStore"; // doc 33 W4

/**
 * doc 80 ORC-11 — every procedure: MOD_ENGINEERING license gate (like `orchestrationRouter`) +
 * `machine_monitoring/canView` (all are reads). Before this, a bare `protectedProcedure` let ANY
 * logged-in user read any run's durable event log by id (IDOR when FOE_DURABLE is on).
 */
const readProcedure = moduleProcedure("MOD_ENGINEERING").use(requirePermission("machine_monitoring", "canView"));

export const orchestrationGovRouter = router({
  /** Validate a recipe DAG (missing refs + cycle detection) → topological order. */
  validateDag: readProcedure
    .input(z.object({ nodes: z.array(z.object({ id: z.string(), deps: z.array(z.string()) })) }))
    .query(({ input }) => validateDag(input.nodes)),

  /** Order a task queue for dispatch (priority band + aging + EDF). */
  orderQueue: readProcedure
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
  fourEyesCheck: readProcedure
    .input(z.object({ context: z.record(z.string(), z.unknown()) }))
    .query(({ input }) => requiresFourEyes(input.context as { action?: string })),

  /** doc 33 W4: durable RunEvent log for a run (seq order). */
  runEvents: readProcedure
    .input(z.object({ runId: z.number() }))
    .query(({ input }) => loadRunEvents(input.runId)),

  /** doc 33 W4: replay a run's persisted events into its reconstructed state (F8 reducer). */
  replayRun: readProcedure
    .input(z.object({ runId: z.number() }))
    .query(({ input }) => replayPersistedRun(input.runId)),
});
