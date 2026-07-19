/**
 * P4.C G11 — Genealogy hash-chain tRPC router.
 *
 * Append-only ledger of unit / lot / station events with SHA-256 chain
 * verification. Use `appendEvent` to record (parent, child, station,
 * merge, split, scrap, ship) events; `verifyChain` walks the chain to
 * confirm no row was tampered with.
 */
import { z } from "zod";
import { moduleProcedure, router } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_PRODUCTION (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_PRODUCTION");
import * as db from "../db";
import { TRPCError } from "@trpc/server";
import {
  hashEntry,
  verifyChain,
  type ChainRow,
} from "../utils/genealogyChain";
// doc 44 W2-B2 (G5.17) — cross-layer trace: stamp the ALS correlation id (if any)
// on appended rows. OUTSIDE the hash input → verifyChain unaffected.
import { getCorrelationId } from "../services/observability/correlation";

const eventTypeSchema = z.enum([
  "born",
  "station",
  "merge",
  "split",
  "rework",
  "scrap",
  "ship",
  "custom",
]);

function rowsToChainRows(rows: any[]): ChainRow[] {
  return rows.map((r) => ({
    id: r.id,
    prevHash: r.prevHash,
    currHash: r.currHash,
    serialNumber: r.serialNumber,
    parentSerial: r.parentSerial ?? null,
    eventType: r.eventType,
    stationCode: r.stationCode ?? null,
    lotCode: r.lotCode ?? null,
    productModelId: r.productModelId ?? null,
    payload: (r.payload ?? {}) as Record<string, any>,
    recordedBy: r.recordedBy ?? null,
    recordedAt: r.recordedAt instanceof Date ? r.recordedAt : new Date(r.recordedAt),
    // G5.17 (0255): trace metadata — read-side passthrough, never part of the hash.
    correlationId: r.correlationId ?? null,
  }));
}

export const genealogyRouter = router({
  /** Append a new event to the chain. */
  appendEvent: protectedProcedure
    .input(z.object({
      serialNumber: z.string().min(1).max(128),
      parentSerial: z.string().min(1).max(128).optional(),
      eventType: eventTypeSchema,
      stationCode: z.string().max(50).optional(),
      lotCode: z.string().max(80).optional(),
      productModelId: z.number().int().positive().optional(),
      payload: z.record(z.string(), z.any()).default({}),
    }))
    .mutation(async ({ input, ctx }) => {
      const recordedAt = new Date();
      const recordedBy = (ctx as any)?.user?.id ?? null;
      // G5.17 (0255) — trace id from the ALS backbone; null outside a context.
      // NOT part of hashEntry's input (fixed field list) → chain hashes unchanged.
      const correlationId = getCorrelationId() ?? null;
      // R4 fork-fix: read-tail → compute currHash → insert ATOMICALLY (serialised
      // advisory lock inside appendGenealogyChainRow) so concurrent manual appends
      // cannot fork the tamper-evident hash-chain.
      const inserted = await db.appendGenealogyChainRow((prevHash) => ({
        prevHash,
        currHash: hashEntry(prevHash, {
          serialNumber: input.serialNumber,
          parentSerial: input.parentSerial ?? null,
          eventType: input.eventType,
          stationCode: input.stationCode ?? null,
          lotCode: input.lotCode ?? null,
          productModelId: input.productModelId ?? null,
          payload: input.payload,
          recordedAt,
        }),
        serialNumber: input.serialNumber,
        parentSerial: input.parentSerial ?? null,
        eventType: input.eventType,
        stationCode: input.stationCode ?? null,
        lotCode: input.lotCode ?? null,
        productModelId: input.productModelId ?? null,
        payload: input.payload as Record<string, any>,
        recordedBy,
        recordedAt,
        // Conditional so pre-0255 databases keep working when no context is active.
        ...(correlationId ? { correlationId } : {}),
      }));
      return {
        id: inserted.id,
        prevHash: inserted.prevHash,
        currHash: inserted.currHash,
        correlationId,
      };
    }),

  /** Get the full chain for a serial. */
  getBySerial: protectedProcedure
    .input(z.object({
      serialNumber: z.string().min(1).max(128),
      limit: z.number().int().positive().max(5000).optional(),
    }))
    .query(async ({ input }) => {
      const rows = await db.listGenealogyChainBySerial(input.serialNumber, input.limit ?? 1000);
      return rowsToChainRows(rows);
    }),

  /**
   * doc 54 P2.5 — RECURSIVE lineage walk over the parent→child edges of the
   * genealogy chain. Unlike getBySerial (one serial's own events), this traces the
   * full multi-level tree: descendants (parent→child→…), ancestors (child→parent→…),
   * or both. Cycle-safe + depth-bounded. Honest: a serial with no edges returns a
   * single-node tree (itself), never a fabricated relationship.
   */
  getLineage: protectedProcedure
    .input(z.object({
      serialNumber: z.string().min(1).max(128),
      direction: z.enum(["ancestors", "descendants", "both"]).default("both"),
      maxDepth: z.number().int().positive().max(100).default(20),
    }))
    .query(async ({ input }) => {
      const { getGenealogyLineage } = await import("../services/genealogyLineageService");
      return getGenealogyLineage({
        rootSerial: input.serialNumber,
        direction: input.direction,
        maxDepth: input.maxDepth,
      });
    }),

  /**
   * doc 63 DEP-05 (AUD-04 / IPC-1782a) — FULL cross-station history for one serial via
   * tRPC. Reuses the REST /v1/genealogy/:unitId assembler (assembleRecord): chain events
   * ∪ product_inspections ∪ process_results ∪ component installations, ordered into one
   * station timeline + materials. Honest: unknown serial → { found: false, record: null }
   * (never a fabricated history).
   */
  getFullHistory: protectedProcedure
    .input(z.object({ serialNumber: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const { assembleRecord } = await import("../api/v1/genealogyApi");
      const record = await assembleRecord(input.serialNumber);
      return { found: record !== null, record };
    }),

  /** Get the full chain for a lot. */
  getByLot: protectedProcedure
    .input(z.object({
      lotCode: z.string().min(1).max(80),
      limit: z.number().int().positive().max(20000).optional(),
    }))
    .query(async ({ input }) => {
      const rows = await db.listGenealogyChainByLot(input.lotCode, input.limit ?? 5000);
      return rowsToChainRows(rows);
    }),

  /**
   * Verify a slice of the chain. By default verifies the rows for one
   * serial; pass `scope: "all"` to verify the global chain.
   *
   * NOTE: per-serial verification recomputes hashes against neighbours
   * present in the slice, so a missing global predecessor will be
   * reported. For a true tamper check, prefer scope="all".
   */
  verify: protectedProcedure
    .input(z.object({
      scope: z.enum(["serial", "lot", "all"]).default("serial"),
      serialNumber: z.string().min(1).max(128).optional(),
      lotCode: z.string().min(1).max(80).optional(),
      limit: z.number().int().positive().max(200000).optional(),
    }))
    .query(async ({ input }) => {
      let rows: any[] = [];
      if (input.scope === "serial") {
        if (!input.serialNumber) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "serialNumber required for scope=serial" });
        }
        rows = await db.listGenealogyChainBySerial(input.serialNumber, input.limit ?? 5000);
      } else if (input.scope === "lot") {
        if (!input.lotCode) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "lotCode required for scope=lot" });
        }
        rows = await db.listGenealogyChainByLot(input.lotCode, input.limit ?? 20000);
      } else {
        rows = await db.listGenealogyChainAll(input.limit ?? 100000);
      }
      const chainRows = rowsToChainRows(rows);
      const result = verifyChain(chainRows);
      return { ...result, scope: input.scope };
    }),
});
