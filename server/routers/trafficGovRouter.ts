/**
 * Traffic governance tRPC router — SYNAPSE §5.4 (doc 33 H4). READ-ONLY.
 *
 * Stateless previews of the space-time traffic primitives: plan an earliest-arrival route over a
 * node-edge graph while avoiding a set of reserved slots. No mutations — the real traffic manager
 * adopts these engines (flag TRAFFIC_SPACETIME).
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { planSpaceTimeRoute, type RouteGraph } from "../services/traffic/spaceTimeAStar";
import { SpaceTimeReservations } from "../services/traffic/spaceTimeReservation";

export const trafficGovRouter = router({
  /** Preview an earliest-arrival space-time route (optionally avoiding reserved slots). */
  planRoute: protectedProcedure
    .input(
      z.object({
        graph: z.object({
          edges: z.array(
            z.object({ id: z.string(), from: z.string(), to: z.string(), travelMs: z.number().min(0) }),
          ),
        }),
        start: z.string(),
        goal: z.string(),
        robotId: z.string().default("preview"),
        departTs: z.number().optional(),
        bufferMs: z.number().optional(),
        reserved: z
          .array(z.object({ edgeId: z.string(), start: z.number(), end: z.number(), robotId: z.string() }))
          .optional(),
      }),
    )
    .query(({ input }) => {
      const reservations = new SpaceTimeReservations(input.bufferMs ?? 1500);
      for (const r of input.reserved ?? []) {
        reservations.reserve(r.edgeId, { start: r.start, end: r.end, robotId: r.robotId });
      }
      const route = planSpaceTimeRoute(input.graph as RouteGraph, input.start, input.goal, {
        robotId: input.robotId,
        departTs: input.departTs,
        bufferMs: input.bufferMs,
        reservations: input.reserved?.length ? reservations : undefined,
      });
      return { found: route !== null, route };
    }),
});
