/**
 * doc 24 Wave-4 · T5 — DISCRETE-EVENT SIMULATION router (throughput / bottleneck what-if).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the PURE discrete-event simulator (server/services/simulation/*).
 * Lets a planner answer throughput / bottleneck / staffing what-if and feeds the
 * sim-predicted cycle-time + bottleneck back to production scheduling as an ADVISORY.
 *
 * SAFETY (ABSOLUTE): 100% read-only analytics. NO device path, NO writes, NO schedule
 * mutation — the scheduling feedback is surfaced, never auto-applied. Every procedure is
 * a `query` gated by machine_monitoring/canView (mirrors orchestration.simulate). NOT
 * flag-gated: a pure simulation is always safe. ctx.user is the source of truth.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { runDes, type LineModel, type SimConfig } from "../services/simulation/desEngine";
import {
  buildLineModelFromScene,
  runScenarioComparison,
  buildThroughputAdvisory,
  reconcileCapacityAdvisory,
  type StationParam,
  type ScenarioOp,
} from "../services/simulation/desModel";
import { buildSceneGraph } from "../services/twin/sceneGraph";

// ── Zod schemas (mirror the engine/model TS types) ──────────────────────────────────

const processDistSchema = z.enum(["deterministic", "exponential", "normal", "triangular"]);

const stationSpecSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(200).optional(),
  capacity: z.number(),
  processTimeSec: z.number(),
  processDist: processDistSchema.optional(),
  processCV: z.number().optional(),
  yield: z.number().optional(),
  onFail: z.enum(["scrap", "rework"]).optional(),
  maxRework: z.number().int().optional(),
  // JSON has no Infinity — omit → engine treats the buffer as unbounded (no blocking).
  bufferCapacity: z.number().optional(),
});

const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("batch"), count: z.number().int().min(0).max(1_000_000) }),
  z.object({
    kind: z.literal("interarrival"),
    meanSec: z.number().positive(),
    dist: processDistSchema.optional(),
    cv: z.number().optional(),
    count: z.number().int().min(0).max(1_000_000).optional(),
  }),
]);

const lineModelSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(200).optional(),
  stations: z.array(stationSpecSchema).min(0).max(200),
  source: sourceSchema,
});

const configSchema = z
  .object({
    seed: z.number().int().optional(),
    horizonSec: z.number().positive().max(10_000_000).optional(),
    warmupSec: z.number().min(0).optional(),
    maxEvents: z.number().int().positive().max(20_000_000).optional(),
  })
  .optional();

const scenarioOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setProcessTime"), stationId: z.string(), processTimeSec: z.number() }),
  z.object({ op: z.literal("setCapacity"), stationId: z.string(), capacity: z.number() }),
  z.object({ op: z.literal("addCapacity"), stationId: z.string(), delta: z.number() }),
  z.object({ op: z.literal("setYield"), stationId: z.string(), yield: z.number() }),
  z.object({ op: z.literal("addStation"), afterStationId: z.string().nullable().optional(), station: stationSpecSchema }),
  z.object({ op: z.literal("removeStation"), stationId: z.string() }),
  z.object({ op: z.literal("setSource"), source: sourceSchema }),
]);

const stationParamSchema = z.object({
  processTimeSec: z.number().optional(),
  capacity: z.number().optional(),
  yield: z.number().optional(),
  processDist: processDistSchema.optional(),
  processCV: z.number().optional(),
  onFail: z.enum(["scrap", "rework"]).optional(),
  maxRework: z.number().int().optional(),
  bufferCapacity: z.number().optional(),
});

export const simulationRouter = router({
  /**
   * Run a self-contained DES on an inline `LineModel` (throughput / bottleneck / staffing
   * what-if). PURE + deterministic (seeded). Returns the full KPI result + a scheduling
   * advisory. Read-only.
   */
  runLine: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ model: lineModelSchema, config: configSchema }))
    .query(({ input }) => {
      const result = runDes(input.model as LineModel, (input.config ?? {}) as SimConfig);
      return { result, advisory: buildThroughputAdvisory(result) };
    }),

  /**
   * Run a BASELINE vs a SCENARIO (add a station / change a rate / change yield / add
   * capacity) and return KPI deltas + the moved bottleneck. Deterministic under the seed.
   */
  scenario: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        model: lineModelSchema,
        ops: z.array(scenarioOpSchema).min(1).max(50),
        config: configSchema,
      }),
    )
    .query(({ input }) =>
      runScenarioComparison(input.model as LineModel, input.ops as ScenarioOp[], (input.config ?? {}) as SimConfig),
    ),

  /**
   * Build a DES model from REAL topology — a factory line's ordered stations from the twin
   * sceneGraph (resource capacity = device count) — merged with a per-station rate/yield
   * param table, then run it. Returns the KPI result, a scheduling advisory, and (when a
   * `configuredCapacityPerHour` is supplied) a reconciliation the planner can surface next
   * to the line's configured capacity. ADVISORY ONLY — no schedule is changed.
   */
  fromScene: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        factoryId: z.number().int().positive(),
        lineId: z.number().int().positive().optional(),
        lineRef: z.string().max(128).optional(),
        params: z.record(z.string(), stationParamSchema).optional(),
        source: sourceSchema.optional(),
        stationOrder: z.array(z.string()).optional(),
        defaultBufferCapacity: z.number().optional(),
        config: configSchema,
        /** The scheduler's configured capacity/hour for this line (to reconcile). */
        configuredCapacityPerHour: z.number().nullable().optional(),
      }),
    )
    .query(async ({ input }) => {
      const scene = await buildSceneGraph(input.factoryId);
      if (scene.lines.length === 0) {
        return {
          ok: false,
          degraded: true,
          note: "No lines found for this factory (or DB unavailable) — nothing to simulate.",
          result: null,
          advisory: null,
          reconciliation: null,
        };
      }
      const line =
        input.lineId != null
          ? scene.lines.find((l) => l.refId === input.lineId)
          : input.lineRef != null
            ? scene.lines.find((l) => l.id === input.lineRef || l.code === input.lineRef)
            : scene.lines[0];
      if (!line) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Requested line not found in the factory scene graph." });
      }

      const model = buildLineModelFromScene(line, {
        params: input.params as Record<string, StationParam> | undefined,
        source: input.source,
        stationOrder: input.stationOrder,
        defaultBufferCapacity: input.defaultBufferCapacity,
      });
      const result = runDes(model, (input.config ?? {}) as SimConfig);
      const advisory = buildThroughputAdvisory(result, line.refId);
      const reconciliation =
        input.configuredCapacityPerHour !== undefined
          ? reconcileCapacityAdvisory(input.configuredCapacityPerHour ?? null, advisory)
          : null;

      return {
        ok: result.ok,
        degraded: result.degraded,
        note: null as string | null,
        line: { id: line.id, refId: line.refId, code: line.code, name: line.name, stationCount: line.stations.length },
        model,
        result,
        advisory,
        reconciliation,
      };
    }),
});
