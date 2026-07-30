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
import fs from "node:fs";
import path from "node:path";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { validateUpload } from "../_core/uploadValidation";
import {
  twinLiveEnabled,
  registerModel,
  listModels,
  resolveModel,
  archiveModel,
} from "../services/twin/modelRegistry";
import { buildSceneGraph } from "../services/twin/sceneGraph";
import { buildFactoryTwinModels } from "../services/twin/twinSchema";
import { buildFactoryUsda } from "../services/twin/usdExport";
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
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "twinLive" }, "Digital twin live disabled (set TWIN_LIVE_ENABLED=true)");
  }
}

/** Guard T2a model-pipeline mutations behind MODEL_PIPELINE_ENABLED. */
function requireModelPipelineFlag() {
  if (!modelPipelineEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "modelPipeline" }, "Model pipeline disabled (set MODEL_PIPELINE_ENABLED=true)");
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

    /**
     * UPLOAD a .glb/.gltf from the UI and register it for a machine in ONE call.
     * Reuses the RBAC middleware (machine_control/canCreate); intentionally NOT gated by
     * TWIN_LIVE_ENABLED — registering a viewer asset is a management op, independent of
     * live-twin streaming. Requires STORAGE_MODE=local so /uploads is served at runtime
     * (no rebuild). Stores a model URI ONLY — opens no device-control path.
     */
    uploadAndRegister: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(
        z.object({
          machineId: z.number().int().positive(),
          filename: z.string().min(1).max(256),
          // base64 of the .glb/.gltf bytes (decoded size is capped by validateUpload → 100MB).
          contentBase64: z.string().min(1).max(180_000_000),
          equipmentClass: z.string().max(64).optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (process.env.STORAGE_MODE !== "local") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Local storage is off — set STORAGE_MODE=local to upload & serve 3D models.",
          });
        }
        let buf: Buffer;
        try {
          buf = Buffer.from(input.contentBase64, "base64");
        } catch {
          throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "twinContent" }, "Invalid base64 content.");
        }
        const v = validateUpload(buf, "model3d");
        if (!v.ok) {
          throw new TRPCError({
            code: v.status === 413 ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
            message: v.error ?? "Invalid 3D model file.",
          });
        }
        const ext = v.detectedMime === "model/gltf-binary" ? ".glb" : ".gltf";
        const uploadsRoot = process.env.LOCAL_STORAGE_DIR
          ? path.resolve(process.env.LOCAL_STORAGE_DIR)
          : path.join(process.cwd(), "uploads");
        const modelsDir = path.join(uploadsRoot, "models");
        fs.mkdirSync(modelsDir, { recursive: true });
        // Timestamped filename → each upload is a fresh URI (cache-safe; the registry row
        // is updated in place with the new URI + a bumped version).
        const fileName = `machine-${input.machineId}-${Date.now()}${ext}`;
        fs.writeFileSync(path.join(modelsDir, fileName), buf);
        const modelUri = `/uploads/models/${fileName}`;
        const res = await registerModel({
          modelKey: `machine-${input.machineId}`,
          modelUri,
          machineId: input.machineId,
          equipmentClass: input.equipmentClass ?? null,
          modelKind: "gltf",
          sourceFormat: "gltf",
          conversionStatus: "ready",
          notes: input.notes ?? null,
          createdBy: (ctx as any).user?.id ?? null,
        });
        return { ok: res.ok, modelUri, id: res.id, version: res.version, sizeBytes: v.size ?? buf.length };
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

    /**
     * STEP/IGES → glTF via occt-import-js (T4). With `stepSource` (raw CAD text or base64) it
     * converts real CAD → a 'ready' registry row; without it, the honest 'pending' seam is kept.
     * A bad file / unavailable kernel → 'failed' + reason. Never fabricates geometry. Gated.
     */
    convertStep: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(
        z.object({
          modelKey: z.string().min(1).max(128),
          sourceFormat: z.enum(["step", "iges"]),
          // Raw STEP/IGES file contents (ISO-10303 text) or base64. Optional — omit to keep the seam.
          stepSource: z.string().min(1).max(50_000_000).optional(),
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
        return convertStepModel({ ...input, createdBy: (ctx as any).user?.id ?? null });
      }),
  }),

  // ── SCENE GRAPH (read-only) ────────────────────────────────────────────────
  sceneGraph: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input }) => buildSceneGraph(input.factoryId)),

  // ── T3 DTDL TWIN MODELS (read-only, queryable) ─────────────────────────────
  //   The scene-graph projected into a DTDL-v3-shaped twin graph: the metamodel
  //   Interfaces + the typed twin instances (Properties/Telemetry/Relationships/
  //   Components). Telemetry channels are sourced from the equipment capability model.
  //   Serializable projection only — the query API (TwinModelGraph) lives server-side.
  twinModels: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ factoryId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const g = await buildFactoryTwinModels(input.factoryId);
      return {
        interfaces: g.interfaces,
        twins: g.twins,
        counts: {
          total: g.size,
          devices: g.getAllDevices().length,
        },
      };
    }),

  // ── T3 USD (USDA) EXPORT (read-only, interchange) ──────────────────────────
  //   Emit the scene-graph as a valid USDA (ASCII USD) stage for Omniverse/Isaac —
  //   enriched with UsdPreviewSurface materials (per device state) + TRUE per-joint
  //   kinematics, and an OPT-IN UsdPhysics layer (rigid bodies + articulation joints).
  //   Returns the text + basic metrics (no device control, no writes).
  usdExport: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        upAxis: z.enum(["Y", "Z"]).optional(),
        metersPerUnit: z.number().positive().max(1000).optional(),
        /** Emit UsdPreviewSurface materials + bind them per device state (default on). */
        includeMaterials: z.boolean().optional(),
        /** Emit the opt-in UsdPhysics layer (PhysicsScene + rigid bodies + joints). */
        includePhysics: z.boolean().optional(),
      }),
    )
    .query(async ({ input }) => {
      const usda = await buildFactoryUsda(input.factoryId, {
        upAxis: input.upAxis,
        metersPerUnit: input.metersPerUnit,
        includeMaterials: input.includeMaterials,
        includePhysics: input.includePhysics,
      });
      return {
        usda,
        byteLength: Buffer.byteLength(usda, "utf8"),
        format: "usda" as const,
        includedPhysics: input.includePhysics ?? false,
        includedMaterials: input.includeMaterials ?? true,
      };
    }),

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
