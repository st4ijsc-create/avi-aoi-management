/**
 * Doc 35 W4-C.2 — MSD floor-life clock router (J-STD-020).
 *
 * Endpoints:
 *   - openExposure : start the floor-life clock for a reel removed from dry storage.
 *   - startBake    : mark a bake started (status → baking; clock pauses).
 *   - closeExposure: reel returned to dry storage (clock stops).
 *   - listActive   : all OPEN exposures with live computed status.
 *   - expiringSoon : open exposures whose status is warning/expired.
 *   - mslTable     : the MSL-level → allowed-floor-life-hours lookup used (reference).
 *
 * ADVISORY only — no hard enforcement. Any scheduler is gated by MSD_TRACKING_ENABLED.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  openExposure,
  startBake,
  closeExposure,
  listActive,
  expiringSoon,
  MSL_FLOOR_LIFE_HOURS,
  isMsdTrackingEnabled,
} from "../services/msdService";

const mslLevelSchema = z.enum(["1", "2", "2a", "3", "4", "5", "5a", "6"]);

export const msdRouter = router({
  openExposure: protectedProcedure
    .input(
      z.object({
        componentCode: z.string().min(1).max(100),
        reelId: z.string().max(128).nullable().optional(),
        materialId: z.number().int().positive().nullable().optional(),
        mslLevel: mslLevelSchema,
        removedFromDryAt: z.coerce.date().optional(),
        machineId: z.number().int().positive().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return openExposure({ ...input, loggedBy: ctx.user?.id ?? null });
    }),

  startBake: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), bakeStartedAt: z.coerce.date().optional() }))
    .mutation(async ({ input }) => {
      return startBake(input.id, input.bakeStartedAt);
    }),

  closeExposure: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), closedAt: z.coerce.date().optional() }))
    .mutation(async ({ input }) => {
      return closeExposure(input.id, input.closedAt);
    }),

  listActive: protectedProcedure.query(async () => {
    return listActive();
  }),

  expiringSoon: protectedProcedure.query(async () => {
    return expiringSoon();
  }),

  mslTable: protectedProcedure.query(async () => {
    return { table: MSL_FLOOR_LIFE_HOURS, trackingEnabled: isMsdTrackingEnabled() };
  }),
});
