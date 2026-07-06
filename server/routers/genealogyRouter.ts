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
  GENESIS_HASH,
  hashEntry,
  verifyChain,
  type ChainRow,
} from "../utils/genealogyChain";

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
      const prevHash = (await db.getLastGenealogyHash()) ?? GENESIS_HASH;
      const currHash = hashEntry(prevHash, {
        serialNumber: input.serialNumber,
        parentSerial: input.parentSerial ?? null,
        eventType: input.eventType,
        stationCode: input.stationCode ?? null,
        lotCode: input.lotCode ?? null,
        productModelId: input.productModelId ?? null,
        payload: input.payload,
        recordedAt,
      });
      const inserted = await db.insertGenealogyChainRow({
        prevHash,
        currHash,
        serialNumber: input.serialNumber,
        parentSerial: input.parentSerial ?? null,
        eventType: input.eventType,
        stationCode: input.stationCode ?? null,
        lotCode: input.lotCode ?? null,
        productModelId: input.productModelId ?? null,
        payload: input.payload as Record<string, any>,
        recordedBy,
        recordedAt,
      });
      return { id: inserted.id, prevHash, currHash };
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
