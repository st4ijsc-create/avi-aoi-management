/**
 * Causal Knowledge Graph admin router (key "causalGraph").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Management CRUD over knowledge/causal-graph.json — the machine ↔ defect ↔ cause
 * ↔ action graph the RCA copilot / auto-proposer / orchestration consume. Until
 * now this file was hand-edited with no UI; this router exposes a validated,
 * atomic write path.
 *
 * SAFETY (non-negotiable):
 *   • Every write VALIDATES shape + referential integrity (edges reference
 *     existing node ids, node ids unique) before touching the file, then writes
 *     atomically (temp + rename) so the file the RCA engine reads can never be
 *     corrupted (see server/services/aiCausalGraph.ts).
 *   • The in-memory cache is invalidated on every save.
 *
 * RBAC (module-level): analytics_root_cause. Reads → canView; node/edge writes →
 * canEdit; raw replaceGraph (power users) → canEdit. Fail-safe: validation errors
 * surface as BAD_REQUEST, never a silent partial write.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  getEditableGraph,
  saveCausalGraph,
  addCausalNode,
  updateCausalNode,
  removeCausalNode,
  addCausalEdge,
  updateCausalEdge,
  removeCausalEdge,
  CausalGraphValidationError,
  type CausalNodeType,
  type CausalEdgeType,
  type EditableCausalGraph,
} from "../services/aiCausalGraph";

const nodeTypeSchema = z.enum(["machine", "defect", "cause", "action"]);
const edgeTypeSchema = z.enum([
  "machine_exhibits",
  "defect_caused_by",
  "cause_resolved_by",
  "cause_prevented_by",
]);

const nodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: nodeTypeSchema,
  label: z.string().min(1).max(255),
  aliases: z.array(z.string().min(1).max(128)).optional(),
});

const edgeSchema = z.object({
  from: z.string().min(1).max(128),
  to: z.string().min(1).max(128),
  type: edgeTypeSchema,
  weight: z.number().min(0).max(1).optional(),
});

const graphSchema = z.object({
  version: z.number().optional(),
  generatedAt: z.string().optional(),
  description: z.string().optional(),
  nodeTypes: z.array(z.string()).optional(),
  edgeTypes: z.array(z.string()).optional(),
  nodes: z.array(nodeSchema),
  edges: z.array(edgeSchema),
});

/** Run a write op and convert validation errors to clean BAD_REQUESTs. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof CausalGraphValidationError) {
      throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "causalGraph" }, err.message);
    }
    throw appError(
      "INTERNAL_SERVER_ERROR",
      "OPERATION_FAILED",
      { operation: "writeCausalGraph" },
      err instanceof Error ? err.message : "Causal graph write failed",
    );
  }
}

export const causalGraphRouter = router({
  /** Read the full editable graph (nodes + edges). */
  getGraph: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canView"))
    .query(() => getEditableGraph()),

  // ── Node CRUD ───────────────────────────────────────────────────────────────
  addNode: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canEdit"))
    .input(nodeSchema)
    .mutation(({ input }) =>
      guard(() =>
        addCausalNode({
          id: input.id,
          type: input.type as CausalNodeType,
          label: input.label,
          aliases: input.aliases,
        }),
      ),
    ),

  updateNode: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canEdit"))
    .input(
      z.object({
        id: z.string().min(1),
        newId: z.string().min(1).max(128).optional(),
        type: nodeTypeSchema.optional(),
        label: z.string().min(1).max(255).optional(),
        aliases: z.array(z.string().min(1).max(128)).optional(),
      }),
    )
    .mutation(({ input }) =>
      guard(() =>
        updateCausalNode(input.id, {
          newId: input.newId,
          type: input.type as CausalNodeType | undefined,
          label: input.label,
          aliases: input.aliases,
        }),
      ),
    ),

  deleteNode: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canDelete"))
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => guard(() => removeCausalNode(input.id))),

  // ── Edge CRUD ───────────────────────────────────────────────────────────────
  addEdge: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canEdit"))
    .input(edgeSchema)
    .mutation(({ input }) =>
      guard(() =>
        addCausalEdge({
          from: input.from,
          to: input.to,
          type: input.type as CausalEdgeType,
          weight: input.weight,
        }),
      ),
    ),

  updateEdge: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canEdit"))
    .input(
      z.object({
        match: z.object({ from: z.string(), to: z.string(), type: edgeTypeSchema }),
        patch: z.object({
          from: z.string().min(1).max(128).optional(),
          to: z.string().min(1).max(128).optional(),
          type: edgeTypeSchema.optional(),
          weight: z.number().min(0).max(1).optional(),
        }),
      }),
    )
    .mutation(({ input }) =>
      guard(() =>
        updateCausalEdge(
          { from: input.match.from, to: input.match.to, type: input.match.type as CausalEdgeType },
          {
            from: input.patch.from,
            to: input.patch.to,
            type: input.patch.type as CausalEdgeType | undefined,
            weight: input.patch.weight,
          },
        ),
      ),
    ),

  deleteEdge: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canDelete"))
    .input(z.object({ from: z.string(), to: z.string(), type: edgeTypeSchema }))
    .mutation(({ input }) =>
      guard(() =>
        removeCausalEdge({ from: input.from, to: input.to, type: input.type as CausalEdgeType }),
      ),
    ),

  /** Raw whole-graph replace for power users — validated + atomic. */
  replaceGraph: protectedProcedure
    .use(requirePermission("analytics_root_cause", "canEdit"))
    .input(z.object({ graph: graphSchema }))
    .mutation(({ input }) =>
      guard(() => saveCausalGraph(input.graph as EditableCausalGraph)),
    ),
});
