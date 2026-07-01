/**
 * Khối 7 (doc 16 §11.2 / §15 T1) — DIGITAL TWIN router.  Flag: TWIN_LIVE_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the T1 twin backend:
 *   • models.*    — Equipment 3D Model Registry (register/list/resolve/archive).
 *   • sceneGraph  — hierarchical factory → zone → station → device graph (shared
 *                   by sim + viz; carries live status + modelUri + active task).
 *   • replay      — ordered, downsampled per-device snapshot series from TimescaleDB
 *                   for incident scrubbing (read-only, size-capped).
 *   • occupancyGrid — the 2D static occupancy grid for a factory + A* demo route.
 *
 * RBAC (mirrors fleetRouter / orchestrationRouter):
 *   • read ops  → machine_monitoring / canView
 *   • mutations → machine_control / canCreate + requireFlag(TWIN_LIVE_ENABLED)
 * ctx.user is the source of truth — never the request body.
 *
 * SAFETY (ABSOLUTE): this router is read-only analytics + 3D-model METADATA. It opens
 * NO device-control path. The model registry stores already-converted asset URIs only
 * (CAD→glTF conversion is OUT OF SCOPE / external — see modelRegistry.ts).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  twinLiveEnabled,
  registerModel,
  listModels,
  resolveModel,
  archiveModel,
} from "../services/twin/modelRegistry";
import { buildSceneGraph } from "../services/twin/sceneGraph";
import { runReplay } from "../services/twin/twinReplay";
import { buildFactoryGrid, planPathOnGrid } from "../services/twin/occupancyGrid";
import {
  modelPipelineEnabled,
  convertUrdfModel,
  convertStepModel,
} from "../services/twin/pipeline/modelConversionService";
import { SAMPLE_URDF_3DOF_ARM, SAMPLE_URDF_2DOF_PLANAR } from "../services/twin/pipeline/sampleUrdfs";

/** Guard mutating actions behind the flag (matches fleetRouter.requireFlag). */
function requireFlag() {
  if (!twinLiveEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Digital twin live disabled (set TWIN_LIVE_ENABLED=true)" });
  }
}

/** Guard T2a model-pipeline mutations behind MODEL_PIPELINE_ENABLED. */
function requireModelPipelineFlag() {
  if (!modelPipelineEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Model pipeline disabled (set MODEL_PIPELINE_ENABLED=true)" });
  }
}

export const twinRouter = router({
  /** UI gating hint — is the twin flag on? */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: twinLiveEnabled() })),

  // ── EQUIPMENT 3D MODELS ────────────────────────────────────────────────────
  models: router({
    list: protectedProcedure
      .use(requirePermission("machine_monitoring", "canView"))
      .input(
        z
          .object({
            equipmentClass: z.string().max(64).optional(),
            status: z.enum(["active", "archived"]).optional(),
            limit: z.number().int().min(1).max(1000).default(200),
          })
          .optional(),
      )
      .query(async ({ input }) => listModels(input)),

    /** Resolve the best model for an equipment/class (most-specific wins). */
    resolve: protectedProcedure
      .use(requirePermission("machine_monitoring", "canView"))
      .input(
        z.object({
          machineId: z.number().int().positive().optional(),
          equipmentId: z.string().max(128).optional(),
          equipmentClass: z.string().max(64).optional(),
        }),
      )
      .query(async ({ input }) => resolveModel(input)),

    /** Register (or re-register, version-bumped) an already-converted model URI. */
    register: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(
        z.object({
          modelKey: z.string().min(1).max(128),
          modelUri: z.string().min(1),
          machineId: z.number().int().positive().optional(),
          equipmentId: z.string().max(128).optional(),
          equipmentClass: z.string().max(64).optional(),
          modelKind: z.enum(["gltf", "urdf"]).optional(),
          sourceFormat: z.enum(["step", "iges", "urdf", "gltf"]).optional(),
          conversionStatus: z.enum(["pending", "converting", "ready", "failed", "external"]).optional(),
          bounds: z.record(z.string(), z.unknown()).optional(),
          scope: z.string().max(64).optional(),
          notes: z.string().max(2000).optional(),
          corporateCode: z.string().max(50).optional(),
          factoryId: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireFlag();
        return registerModel({ ...input, createdBy: (ctx as any).user?.id ?? null });
      }),

    archive: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        requireFlag();
        return archiveModel(input.id);
      }),
  }),

  // ── T2a MODEL PIPELINE (URDF→glTF conversion → registry 'ready') ───────────
  //   reads → machine_monitoring/canView ; mutations → machine_control/canCreate
  //   + requireFlag(MODEL_PIPELINE_ENABLED). Opens NO device path (pure conversion).
  pipeline: router({
    /** UI gating hint — is the model pipeline flag on? */
    status: protectedProcedure
      .use(requirePermission("machine_monitoring", "canView"))
      .query(() => ({ enabled: modelPipelineEnabled() })),

    /** List the built-in convertible URDF sample sources (name + kind). */
    sampleSources: protectedProcedure
      .use(requirePermission("machine_monitoring", "canView"))
      .query(() => [
        { key: "sample-3dof-arm", name: "sample_3dof_arm", format: "urdf", dof: 3 },
        { key: "sample-2dof-planar", name: "sample_2dof_planar", format: "urdf", dof: 2 },
      ]),

    /** Convert a URDF source → glTF asset + registry 'ready' row. Gated. */
    convertUrdf: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(
        z.object({
          modelKey: z.string().min(1).max(128),
          // Either paste URDF XML directly, or pick a built-in sample by key.
          urdfSource: z.string().min(1).optional(),
          sample: z.enum(["sample-3dof-arm", "sample-2dof-planar"]).optional(),
          machineId: z.number().int().positive().optional(),
          equipmentId: z.string().max(128).optional(),
          equipmentClass: z.string().max(64).optional(),
          scope: z.string().max(64).optional(),
          corporateCode: z.string().max(50).optional(),
          factoryId: z.number().int().positive().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireModelPipelineFlag();
        const urdfSource =
          input.urdfSource ??
          (input.sample === "sample-3dof-arm"
            ? SAMPLE_URDF_3DOF_ARM
            : input.sample === "sample-2dof-planar"
              ? SAMPLE_URDF_2DOF_PLANAR
              : undefined);
        if (!urdfSource) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Provide urdfSource or a sample key." });
        }
        return convertUrdfModel({
          urdfSource,
          modelKey: input.modelKey,
          machineId: input.machineId ?? null,
          equipmentId: input.equipmentId ?? null,
          equipmentClass: input.equipmentClass ?? null,
          scope: input.scope ?? null,
          corporateCode: input.corporateCode ?? null,
          factoryId: input.factoryId ?? null,
          createdBy: (ctx as any).user?.id ?? null,
        });
      }),

    /** STEP/IGES seam — registers 'pending' (phase-2), never fakes geometry. Gated. */
    convertStep: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(
        z.object({
          modelKey: z.string().min(1).max(128),
          sourceFormat: z.enum(["step", "iges"]),
          machineId: z.number().int().positive().optional(),
          equipmentId: z.string().max(128).optional(),
          equipmentClass: z.string().max(64).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        requireModelPipelineFlag();
        return convertStepModel({ ...input, createdBy: (ctx as any).user?.id ?? null });
      }),
  }),

  // ── SCENE GRAPH (read-only) ────────────────────────────────────────────────
  sceneGraph: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input }) => buildSceneGraph(input.factoryId)),

  // ── REPLAY (read-only, size-capped) ────────────────────────────────────────
  replay: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        from: z.coerce.date(),
        to: z.coerce.date(),
        step: z.number().int().min(1).max(3600).default(5), // seconds per frame
      }),
    )
    .query(async ({ input }) => {
      if (input.to.getTime() <= input.from.getTime()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "`to` must be after `from`" });
      }
      return runReplay({ factoryId: input.factoryId, from: input.from, to: input.to, stepSec: input.step });
    }),

  // ── OCCUPANCY GRID (read-only) + optional A* demo route ────────────────────
  occupancyGrid: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        cellSize: z.number().positive().max(50).optional(),
        inflate: z.number().min(0).max(50).optional(),
        // Optional A* probe: route between two world points over the built grid.
        from: z.object({ x: z.number(), y: z.number() }).optional(),
        to: z.object({ x: z.number(), y: z.number() }).optional(),
      }),
    )
    .query(async ({ input }) => {
      const built = await buildFactoryGrid({ factoryId: input.factoryId, cellSize: input.cellSize, inflate: input.inflate });
      let route = null;
      if (built.grid && input.from && input.to) {
        route = planPathOnGrid(built.grid, input.from, input.to);
      }
      // Return grid metadata (not the full boolean matrix unless small) to keep the
      // payload bounded — the FE can request the matrix explicitly if needed.
      const g = built.grid;
      const includeCells = g != null && g.cols * g.rows <= 4096;
      return {
        enabled: built.enabled,
        obstacleCount: built.obstacleCount,
        note: built.note,
        grid: g
          ? {
              originX: g.originX,
              originY: g.originY,
              cols: g.cols,
              rows: g.rows,
              cellSize: g.cellSize,
              cells: includeCells ? g.cells : undefined,
            }
          : null,
        route,
      };
    }),
});
