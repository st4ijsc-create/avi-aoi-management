/**
 * P4.C G15 — Station triangulation tRPC router.
 *
 * Cross-station defect/escape attribution across SPI / AOI_PRE / REFLOW /
 * AOI_POST / AXI / ICT / FCT. Backed by `measurementSamples.stationCode`
 * and persisted to `station_traces` (one row per serial).
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import {
  summariseSerial,
  summariseLot,
  stationCorrelationMatrix,
  escapeAttribution,
  type SampleRow,
} from "../utils/stationTriangulation";

function rowsToSampleRows(rows: any[]): SampleRow[] {
  return rows.map((r) => ({
    serialNumber: r.serialNumber ?? null,
    stationCode: r.stationCode ?? null,
    isOk: r.isOk ?? null,
    value: r.value ?? null,
    sampledAt: r.sampledAt instanceof Date ? r.sampledAt : new Date(r.sampledAt),
    pointDefId: r.pointDefId,
    lotCode: r.lotCode ?? null,
  }));
}

export const stationTriangulationRouter = router({
  /** Recompute and upsert the station_traces row for a single serial. */
  recomputeForSerial: protectedProcedure
    .input(z.object({
      serialNumber: z.string().min(1).max(128),
      productModelId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input }) => {
      const samples = rowsToSampleRows(await db.listSamplesForSerial(input.serialNumber));
      if (samples.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No measurement samples for serial ${input.serialNumber}`,
        });
      }
      const summary = summariseSerial(input.serialNumber, samples);
      const lotCode = samples.find((s) => s.lotCode)?.lotCode ?? null;
      const id = await db.upsertStationTrace({
        serialNumber: summary.serialNumber,
        productModelId: input.productModelId ?? null,
        lotCode,
        firstSeenAt: summary.firstSeenAt,
        lastSeenAt: summary.lastSeenAt,
        stationsTouched: summary.stationsTouched,
        firstDefectStation: summary.firstDefectStation,
        firstEscapeStation: summary.firstEscapeStation,
        totalDefects: summary.totalDefects,
        totalEscapes: summary.totalEscapes,
        summary: summary.perStation as Record<string, any>,
      } as any);
      return { id, summary };
    }),

  /** Recompute every serial in a lot. Bounded by `limit`. */
  recomputeForLot: protectedProcedure
    .input(z.object({
      lotCode: z.string().min(1).max(80),
      productModelId: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(20000).optional(),
    }))
    .mutation(async ({ input }) => {
      const rows = rowsToSampleRows(await db.listSamplesForLot(input.lotCode, input.limit ?? 5000));
      const traces = summariseLot(rows);
      let written = 0;
      for (const t of traces) {
        await db.upsertStationTrace({
          serialNumber: t.serialNumber,
          productModelId: input.productModelId ?? null,
          lotCode: input.lotCode,
          firstSeenAt: t.firstSeenAt,
          lastSeenAt: t.lastSeenAt,
          stationsTouched: t.stationsTouched,
          firstDefectStation: t.firstDefectStation,
          firstEscapeStation: t.firstEscapeStation,
          totalDefects: t.totalDefects,
          totalEscapes: t.totalEscapes,
          summary: t.perStation as Record<string, any>,
        } as any);
        written += 1;
      }
      return { serialsProcessed: written };
    }),

  /** Read the persisted trace for one serial. */
  getTrace: protectedProcedure
    .input(z.object({ serialNumber: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const trace = await db.getStationTrace(input.serialNumber);
      if (!trace) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Trace not found" });
      }
      return trace;
    }),

  /** List traces for a lot. */
  listByLot: protectedProcedure
    .input(z.object({
      lotCode: z.string().min(1).max(80),
      limit: z.number().int().positive().max(5000).optional(),
    }))
    .query(async ({ input }) => {
      return db.listStationTracesByLot(input.lotCode, input.limit ?? 1000);
    }),

  /** List traces for a product model. */
  listByProduct: protectedProcedure
    .input(z.object({
      productModelId: z.number().int().positive(),
      limit: z.number().int().positive().max(5000).optional(),
    }))
    .query(async ({ input }) => {
      return db.listStationTracesByProduct(input.productModelId, input.limit ?? 1000);
    }),

  /** Escape attribution: which stations are letting defects through? */
  escapeAttribution: protectedProcedure
    .input(z.object({
      lotCode: z.string().min(1).max(80).optional(),
      productModelId: z.number().int().positive().optional(),
    }))
    .query(async ({ input }) => {
      if (!input.lotCode && !input.productModelId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Provide lotCode or productModelId",
        });
      }
      const traces = input.lotCode
        ? await db.listStationTracesByLot(input.lotCode, 5000)
        : await db.listStationTracesByProduct(input.productModelId!, 5000);
      // Adapt persisted rows back to the in-memory TraceSummary shape needed by
      // escapeAttribution. Only firstDefectStation / firstEscapeStation are read.
      const adapted = traces.map((t) => ({
        serialNumber: t.serialNumber,
        stationsTouched: t.stationsTouched ?? [],
        firstSeenAt: t.firstSeenAt,
        lastSeenAt: t.lastSeenAt,
        firstDefectStation: t.firstDefectStation,
        firstEscapeStation: t.firstEscapeStation,
        totalDefects: t.totalDefects,
        totalEscapes: t.totalEscapes,
        perStation: (t.summary ?? {}) as Record<
          string,
          { ok: number; ng: number; firstAt: Date | null; lastAt: Date | null }
        >,
      }));
      return escapeAttribution(adapted);
    }),

  /** Pearson correlation matrix of station NG-rates across serials in a lot. */
  correlationMatrix: protectedProcedure
    .input(z.object({
      lotCode: z.string().min(1).max(80),
      limit: z.number().int().positive().max(20000).optional(),
    }))
    .query(async ({ input }) => {
      const rows = rowsToSampleRows(await db.listSamplesForLot(input.lotCode, input.limit ?? 5000));
      const traces = summariseLot(rows);
      return stationCorrelationMatrix(traces);
    }),
});
