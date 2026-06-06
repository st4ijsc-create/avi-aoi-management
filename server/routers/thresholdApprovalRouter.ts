/**
 * P4.B G18 — Threshold suggestion approval workflow router.
 *
 * Operator/engineer flow:
 *   1. `request`  — submit a proposed LSL/USL (typically derived from
 *                   `thresholdSuggestion.suggestForPoint`).
 *   2. `approve`  — quality manager accepts → optional `apply: true` writes
 *                   the new limits onto the `measurement_point_defs` row.
 *   3. `reject`   — quality manager rejects with a reason.
 *   4. `withdraw` — original requester pulls back a still-pending request.
 *   5. `list`     — filter by status / pointDefId / requester.
 *
 * All transitions are logged into the `threshold_approvals` row itself
 * (decidedBy, decidedAt, decidedComment) — full audit trail.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { thresholdApprovals, measurementPointDefs } from "../../drizzle/schema/product";

const STATUS_PENDING = "requested";
const STATUS_APPROVED = "approved";
const STATUS_REJECTED = "rejected";
const STATUS_APPLIED = "applied";
const STATUS_WITHDRAWN = "withdrawn";

async function getById(id: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
  const [row] = await db
    .select()
    .from(thresholdApprovals)
    .where(eq(thresholdApprovals.id, id))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `threshold_approval ${id} not found` });
  return row;
}

export const thresholdApprovalRouter = router({
  request: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      proposedLsl: z.number(),
      proposedUsl: z.number(),
      proposedNominal: z.number().optional(),
      suggestion: z.record(z.string(), z.any()).optional(),
      comment: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!(input.proposedLsl < input.proposedUsl)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "proposedLsl must be < proposedUsl" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [mp] = await db
        .select({
          id: measurementPointDefs.id,
          lsl: measurementPointDefs.lowerLimit,
          usl: measurementPointDefs.upperLimit,
          nominalValue: measurementPointDefs.nominalValue,
        })
        .from(measurementPointDefs)
        .where(eq(measurementPointDefs.id, input.pointDefId))
        .limit(1);
      if (!mp) {
        throw new TRPCError({ code: "NOT_FOUND", message: `measurement_point_def ${input.pointDefId} not found` });
      }

      const [row] = await db.insert(thresholdApprovals).values({
        pointDefId: input.pointDefId,
        requestedBy: ctx.user.id,
        suggestion: (input.suggestion ?? {}) as any,
        currentLsl: mp.lsl as any,
        currentUsl: mp.usl as any,
        currentNominal: mp.nominalValue as any,
        proposedLsl: String(input.proposedLsl) as any,
        proposedUsl: String(input.proposedUsl) as any,
        proposedNominal: input.proposedNominal != null ? (String(input.proposedNominal) as any) : undefined,
        comment: input.comment,
        status: STATUS_PENDING,
      }).returning();
      return row;
    }),

  approve: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      apply: z.boolean().default(true),
      comment: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const row = await getById(input.id);
      if (row.status !== STATUS_PENDING) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot approve from status ${row.status}` });
      }

      const newStatus = input.apply ? STATUS_APPLIED : STATUS_APPROVED;
      const [updated] = await db.update(thresholdApprovals)
        .set({
          status: newStatus,
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decidedComment: input.comment,
          updatedAt: new Date(),
        })
        .where(eq(thresholdApprovals.id, input.id))
        .returning();

      if (input.apply) {
        await db.update(measurementPointDefs)
          .set({
            lowerLimit: row.proposedLsl as any,
            upperLimit: row.proposedUsl as any,
            ...(row.proposedNominal != null ? { nominalValue: row.proposedNominal as any } : {}),
            updatedAt: new Date(),
          })
          .where(eq(measurementPointDefs.id, row.pointDefId));
      }
      return updated;
    }),

  reject: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      comment: z.string().max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const row = await getById(input.id);
      if (row.status !== STATUS_PENDING) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot reject from status ${row.status}` });
      }
      const [updated] = await db.update(thresholdApprovals)
        .set({
          status: STATUS_REJECTED,
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decidedComment: input.comment,
          updatedAt: new Date(),
        })
        .where(eq(thresholdApprovals.id, input.id))
        .returning();
      return updated;
    }),

  withdraw: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const row = await getById(input.id);
      if (row.status !== STATUS_PENDING) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot withdraw from status ${row.status}` });
      }
      if (row.requestedBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the requester can withdraw" });
      }
      const [updated] = await db.update(thresholdApprovals)
        .set({
          status: STATUS_WITHDRAWN,
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decidedComment: input.comment,
          updatedAt: new Date(),
        })
        .where(eq(thresholdApprovals.id, input.id))
        .returning();
      return updated;
    }),

  list: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive().optional(),
      status: z.enum(["requested", "approved", "rejected", "applied", "withdrawn"]).optional(),
      requestedBy: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const conds = [] as any[];
      if (input?.pointDefId) conds.push(eq(thresholdApprovals.pointDefId, input.pointDefId));
      if (input?.status) conds.push(eq(thresholdApprovals.status, input.status));
      if (input?.requestedBy) conds.push(eq(thresholdApprovals.requestedBy, input.requestedBy));

      const rows = await db.select().from(thresholdApprovals)
        .where(conds.length ? (and(...conds) as any) : (sql`true` as any))
        .orderBy(desc(thresholdApprovals.createdAt))
        .limit(input?.limit ?? 100);
      return rows;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => getById(input.id)),
});
