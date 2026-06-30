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

/** Guard mutating actions behind the flag (matches fleetRouter.requireFlag). */
function requireFlag() {
  if (!twinLiveEnabled()) {
    throw new TRPCError({ code: "CONFLICT", message: "Digital twin live disabled (set TWIN_LIVE_ENABLED=true)" });
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
