/**
 * Contracts tRPC router — SYNAPSE §5.6/§8/§5.9 (doc 33 F7).
 *
 * Serves the published OpenAPI + AsyncAPI specs, the schema registry, a backward-compat
 * preview, and a reconciliation preview — the machine-readable surface a Developer Portal
 * (later) and integration partners consume.
 *
 * doc 44 Batch W0-E (gap G2.5): the registry is now persisted (`contract_schemas`, mig 0248,
 * seeded from contracts/canonical/*.schema.json). Added: DB-backed list/get, a
 * `validateMessage` preview (the not-yet-enforced ingest seam), and ONE governed mutation —
 * `register` (adminProcedure: admin + 2FA, per this repo's privileged-mutation pattern) which
 * routes through the BACKWARD gate before persisting.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { buildSeedSpecs } from "../services/contracts/apiSpec";
import {
  listSchemas,
  checkBackwardCompat,
  getLatestSchema,
  registerSchema,
  persistSchema,
  loadRegistryFromDb,
  validateMessage,
  SchemaCompatError,
} from "../services/contracts/schemaRegistry";
import { reconcile } from "../services/contracts/reconciliation";
import { listReconcileProviders, runReconciliationCycle } from "../services/contracts/reconciliationCron"; // doc 33 I6
// doc 44 W2-B2 (G2.6) — ingest-enforcement surface: quarantine review + live counters.
import { getIngestValidationStats } from "../services/contracts/ingestValidation";
import { CONTRACT_QUARANTINE_STATUSES } from "../../drizzle/schema/contracts";

const jsonSchema = z.record(z.string(), z.unknown());

export const contractsRouter = router({
  /** Published OpenAPI 3.1 (REST /api/v1). */
  openapi: protectedProcedure.query(() => buildSeedSpecs().openapi),

  /** Published AsyncAPI 2.6 (UNS / Sparkplug channels). */
  asyncapi: protectedProcedure.query(() => buildSeedSpecs().asyncapi),

  /** Registered schemas (name → latest version) — in-memory registry view. */
  schemas: protectedProcedure.query(() => listSchemas()),

  /** doc 44 G2.5: persisted registry rows (metadata only — schema body via getSchema). */
  listPersistedSchemas: protectedProcedure
    .input(z.object({ subject: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const { getDb } = await import("../db/connection");
      const db = await getDb();
      if (!db) return [] as const;
      const { contractSchemas } = await import("../../drizzle/schema/contracts");
      const { eq, asc } = await import("drizzle-orm");
      let q = db
        .select({
          id: contractSchemas.id,
          subject: contractSchemas.subject,
          version: contractSchemas.version,
          compatibility: contractSchemas.compatibility,
          schemaRef: contractSchemas.schemaRef,
          status: contractSchemas.status,
          owner: contractSchemas.owner,
          createdAt: contractSchemas.createdAt,
        })
        .from(contractSchemas)
        .$dynamic();
      if (input?.subject) q = q.where(eq(contractSchemas.subject, input.subject));
      return q.orderBy(asc(contractSchemas.subject), asc(contractSchemas.version));
    }),

  /** doc 44 G2.5: one persisted schema version (latest of the subject when version omitted). */
  getSchema: protectedProcedure
    .input(z.object({ subject: z.string().min(1), version: z.number().int().positive().optional() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db/connection");
      const db = await getDb();
      if (!db) throw appError("PRECONDITION_FAILED", "DB_UNAVAILABLE", undefined, "Database not available");
      const { contractSchemas } = await import("../../drizzle/schema/contracts");
      const { eq, and, desc } = await import("drizzle-orm");
      const where = input.version
        ? and(eq(contractSchemas.subject, input.subject), eq(contractSchemas.version, input.version))
        : eq(contractSchemas.subject, input.subject);
      const rows = await db
        .select()
        .from(contractSchemas)
        .where(where)
        .orderBy(desc(contractSchemas.version))
        .limit(1);
      if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: `No schema for subject "${input.subject}"` });
      return rows[0];
    }),

  /**
   * doc 44 G2.5: register a new schema version — admin-only (adminProcedure = admin + 2FA).
   * Hydrates the persisted lineage first so the BACKWARD gate compares against the true latest,
   * then registers (gate) and persists. `allowBreaking` is the explicit-major escape hatch.
   */
  register: adminProcedure
    .input(
      z.object({
        subject: z.string().min(1),
        schema: jsonSchema,
        allowBreaking: z.boolean().optional(),
        owner: z.string().optional(),
        schemaRef: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      await loadRegistryFromDb(); // no-op without DB; keeps gate honest vs persisted lineage
      try {
        const entry = registerSchema(input.subject, input.schema, { allowBreaking: input.allowBreaking });
        const persisted = await persistSchema(entry, {
          schemaRef: input.schemaRef,
          owner: input.owner,
          compatibility: input.allowBreaking ? "NONE" : "BACKWARD",
        });
        return { subject: entry.name, version: entry.version, persisted };
      } catch (err) {
        if (err instanceof SchemaCompatError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** doc 44 G2.5: preview the ingest validation seam (NOT enforced anywhere yet). */
  validateMessage: protectedProcedure
    .input(z.object({ subject: z.string().min(1), payload: z.unknown() }))
    .query(({ input }) => ({
      ...validateMessage(input.subject, input.payload),
      schemaVersion: getLatestSchema(input.subject)?.version ?? null,
    })),

  /** Preview a backward-compat check between two JSON-Schemas (governance). */
  checkCompat: protectedProcedure
    .input(z.object({ prev: jsonSchema, next: jsonSchema }))
    .query(({ input }) => checkBackwardCompat(input.prev, input.next)),

  /** Preview a reconciliation between internal + external metric maps. */
  reconcilePreview: protectedProcedure
    .input(
      z.object({
        internal: z.record(z.string(), z.number()),
        external: z.record(z.string(), z.number()),
        toleranceAbs: z.number().optional(),
        toleranceRel: z.number().optional(),
      }),
    )
    .query(({ input }) => reconcile(input)),

  /** doc 33 I6: registered reconciliation providers (MES/ERP/WMS). */
  reconcileProviders: protectedProcedure.query(() => listReconcileProviders()),

  /** doc 33 I6: run a reconciliation cycle across all providers now (read-only; raises tickets). */
  reconcileCycle: protectedProcedure.query(() => runReconciliationCycle()),

  // ══════════════════════════════════════════════════════════════════════════
  // doc 44 W2-B2 (G2.6) — quarantine review surface (contract_quarantine, mig 0254)
  // ══════════════════════════════════════════════════════════════════════════

  /** In-process ingest-validation counters (valid/invalid/quarantined per subject + mode). */
  ingestValidationStats: protectedProcedure.query(() => getIngestValidationStats()),

  /** Quarantined messages, newest first (filter by subject/status). */
  listQuarantine: protectedProcedure
    .input(
      z
        .object({
          subject: z.string().optional(),
          status: z.enum(CONTRACT_QUARANTINE_STATUSES).optional(),
          limit: z.number().int().positive().max(500).default(100),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const { getDb } = await import("../db/connection");
      const db = await getDb();
      if (!db) return [] as const;
      const { contractQuarantine } = await import("../../drizzle/schema/contracts");
      const { eq, and, desc } = await import("drizzle-orm");
      const conditions = [
        ...(input?.subject ? [eq(contractQuarantine.subject, input.subject)] : []),
        ...(input?.status ? [eq(contractQuarantine.status, input.status)] : []),
      ];
      let q = db.select().from(contractQuarantine).$dynamic();
      if (conditions.length > 0) q = q.where(and(...conditions));
      return q.orderBy(desc(contractQuarantine.receivedAt)).limit(input?.limit ?? 100);
    }),

  /** Mark ONE quarantined message reviewed or discarded (admin + 2FA). */
  reviewQuarantine: adminProcedure
    .input(z.object({ id: z.number().int().positive(), action: z.enum(["reviewed", "discarded"]) }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("../db/connection");
      const db = await getDb();
      if (!db) throw appError("PRECONDITION_FAILED", "DB_UNAVAILABLE", undefined, "Database not available");
      const { contractQuarantine } = await import("../../drizzle/schema/contracts");
      const { eq } = await import("drizzle-orm");
      const updated = await db
        .update(contractQuarantine)
        .set({ status: input.action, reviewedBy: ctx.user.id, reviewedAt: new Date() })
        .where(eq(contractQuarantine.id, input.id))
        .returning({ id: contractQuarantine.id, status: contractQuarantine.status });
      if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: `Quarantine item ${input.id} not found` });
      return updated[0];
    }),

  /**
   * "Replay" ONE quarantined message (admin + 2FA). HONEST LIMITATION: this does NOT
   * automatically re-inject the message into the pipeline — the quarantine row stores the
   * PARSED payload plus the subject PATTERN, not the original transport frame (concrete
   * MQTT topic / CanonicalSample fields), so a faithful automatic replay would have to
   * guess routing. Instead it marks the row 'replayed' and RETURNS {subject, source,
   * payload} for the caller to re-submit through the original transport (e.g. republish
   * to the device topic, or POST to the ingest API after fixing the producer).
   */
  replayQuarantine: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const { getDb } = await import("../db/connection");
      const db = await getDb();
      if (!db) throw appError("PRECONDITION_FAILED", "DB_UNAVAILABLE", undefined, "Database not available");
      const { contractQuarantine } = await import("../../drizzle/schema/contracts");
      const { eq } = await import("drizzle-orm");
      const updated = await db
        .update(contractQuarantine)
        .set({ status: "replayed", reviewedBy: ctx.user.id, reviewedAt: new Date() })
        .where(eq(contractQuarantine.id, input.id))
        .returning({
          id: contractQuarantine.id,
          subject: contractQuarantine.subject,
          source: contractQuarantine.source,
          payload: contractQuarantine.payload,
        });
      if (updated.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: `Quarantine item ${input.id} not found` });
      return { ...updated[0], reinjected: false as const };
    }),
});
