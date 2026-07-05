/**
 * Contracts tRPC router — SYNAPSE §5.6/§8/§5.9 (doc 33 F7). READ-ONLY.
 *
 * Serves the published OpenAPI + AsyncAPI specs, the schema registry, a backward-compat
 * preview, and a reconciliation preview — the machine-readable surface a Developer Portal
 * (later) and integration partners consume. No mutations.
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { buildSeedSpecs } from "../services/contracts/apiSpec";
import { listSchemas, checkBackwardCompat } from "../services/contracts/schemaRegistry";
import { reconcile } from "../services/contracts/reconciliation";

const jsonSchema = z.record(z.string(), z.unknown());

export const contractsRouter = router({
  /** Published OpenAPI 3.1 (REST /api/v1). */
  openapi: protectedProcedure.query(() => buildSeedSpecs().openapi),

  /** Published AsyncAPI 2.6 (UNS / Sparkplug channels). */
  asyncapi: protectedProcedure.query(() => buildSeedSpecs().asyncapi),

  /** Registered schemas (name → latest version). */
  schemas: protectedProcedure.query(() => listSchemas()),

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
});
