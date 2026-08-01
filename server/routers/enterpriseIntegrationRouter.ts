/**
 * ENTERPRISE INTEGRATION router (key "enterpriseIntegration") — doc 44 W6-5
 * (G5.24) · SYNAPSE_Tang5 §8–9.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Admin surface over the WMS/PLM/CMMS connectors + enterprise reconciliation:
 *   • READS (protectedProcedure + admin_system:canView) — connector flag state,
 *     sync-log status/rows, id-map rows, configured reconciliation providers.
 *   • MUTATIONS (adminProcedure — admin role + 2FA) — trigger a MANUAL inbound sync
 *     per system, push predictive work orders to the CMMS, and run a reconciliation
 *     cycle on demand (view discrepancies/tickets).
 *
 * The mutations are thin wrappers over the connectors, which are each gated by their
 * own feature flag (WMS/PLM/CMMS_INTEGRATION_ENABLED, default OFF) — a manual trigger
 * while a connector is disabled returns `{ disabled: true }`, it does NOT bypass the
 * flag. Connector calls are fail-safe (they never throw into the request), and the
 * endpoint URL / field-mapping is supplied per-call (or defaulted from env), so no
 * vendor shape is baked into the surface.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  connectorFlags,
  syncStatusSummary,
  listSyncLog,
  listIdMap,
} from "../services/integration/enterpriseIntegrationCore";
import { pullInventory } from "../services/integration/wmsConnector";
import { pullPlm } from "../services/integration/plmConnector";
import { pullSchedules, syncPredictiveWorkOrdersToCmms } from "../services/integration/cmmsConnector";
import { runReconciliationCycle, listReconcileProviders } from "../services/contracts/reconciliationCron";

const systemEnum = z.enum(["wms", "plm", "cmms"]);
const headersSchema = z.record(z.string(), z.string()).optional();

export const enterpriseIntegrationRouter = router({
  // ── READS ────────────────────────────────────────────────────────────────

  /** Connector flags + sync status summary + configured reconciliation providers. */
  status: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(async () => {
      const [summary, providers] = await Promise.all([syncStatusSummary(), Promise.resolve(listReconcileProviders())]);
      return { flags: connectorFlags(), syncSummary: summary, reconcileProviders: providers };
    }),

  /** Recent sync-log rows (audit of inbound/outbound ops). */
  syncLog: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .input(z.object({ system: systemEnum.optional(), limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ input }) => {
      const rows = await listSyncLog({ system: input?.system, limit: input?.limit ?? 50 });
      return { rows, count: rows.length };
    }),

  /** External↔canonical id-map rows (anti-corruption mapping). */
  idMap: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .input(z.object({ system: systemEnum.optional(), entityType: z.string().max(48).optional(), limit: z.number().int().min(1).max(500).optional() }).optional())
    .query(async ({ input }) => {
      const rows = await listIdMap({ system: input?.system, entityType: input?.entityType, limit: input?.limit ?? 100 });
      return { rows, count: rows.length };
    }),

  // ── MUTATIONS (adminProcedure: admin role + 2FA) ───────────────────────────

  /** Trigger a manual WMS inventory pull (durable, idempotent, fail-safe). */
  wmsPullInventory: adminProcedure
    .input(
      z.object({
        url: z.string().url().optional(),
        externalIdField: z.string().min(1).default("materialId"),
        quantityField: z.string().min(1).default("onHand"),
        componentCodeField: z.string().min(1).optional(),
        itemsPath: z.string().min(1).optional(),
        headers: headersSchema,
        corporateCode: z.string().max(50).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const url = input.url ?? process.env.WMS_INVENTORY_URL;
      if (!url) return { ok: false, error: "no url (pass input.url or set WMS_INVENTORY_URL)" };
      return pullInventory({
        url,
        externalIdField: input.externalIdField,
        quantityField: input.quantityField,
        componentCodeField: input.componentCodeField,
        itemsPath: input.itemsPath,
        headers: input.headers,
        corporateCode: input.corporateCode ?? null,
      });
    }),

  /** Trigger a manual PLM pull for one entity type (product|bom|recipe|ecn). */
  plmPull: adminProcedure
    .input(
      z.object({
        entity: z.enum(["product", "bom", "recipe", "ecn"]),
        url: z.string().url().optional(),
        itemsPath: z.string().min(1).optional(),
        headers: headersSchema,
      }),
    )
    .mutation(async ({ input }) => {
      const url = input.url ?? process.env.PLM_PULL_URL;
      if (!url) return { ok: false, error: "no url (pass input.url or set PLM_PULL_URL)" };
      return pullPlm({ entity: input.entity, url, itemsPath: input.itemsPath, headers: input.headers });
    }),

  /** Trigger a manual CMMS maintenance-schedule pull. */
  cmmsPullSchedules: adminProcedure
    .input(
      z.object({
        url: z.string().url().optional(),
        itemsPath: z.string().min(1).optional(),
        headers: headersSchema,
      }).optional(),
    )
    .mutation(async ({ input }) => {
      const url = input?.url ?? process.env.CMMS_SCHEDULE_URL;
      if (!url) return { ok: false, error: "no url (pass input.url or set CMMS_SCHEDULE_URL)" };
      return pullSchedules({ url, itemsPath: input?.itemsPath, headers: input?.headers });
    }),

  /** Push open predictive work orders (PdM/RUL) to the CMMS (idempotent per WO). */
  cmmsPushPredictive: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
    .mutation(async ({ input }) => {
      return syncPredictiveWorkOrdersToCmms(input?.limit ?? 100);
    }),

  /** Run a reconciliation cycle now and return discrepancies/tickets. */
  runReconciliation: adminProcedure.mutation(async () => {
    return runReconciliationCycle();
  }),
});
