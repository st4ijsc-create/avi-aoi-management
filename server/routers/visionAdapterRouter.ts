/**
 * Vision Adapter ingest router (key "visionAdapter").
 *
 * Vendor-agnostic ingest for third-party inspection systems (Cognex, Keyence, Koh
 * Young, TRI, Omron, generic …): the caller posts a vendor-specific `payload` plus a
 * `vendorKey`; we resolve the matching adapter, `normalize()` the payload into the
 * CANONICAL inspection shape, and hand it to the EXISTING machineApiRouter.submitInspection
 * persistence path (no duplicated insert logic — same image upload, point/defect
 * resolution, NG/MQTT alerts, cache invalidation as the native machine API).
 *
 * ── SAFETY / GATING ──────────────────────────────────────────────────────────────
 *   - Flag VISION_ADAPTERS_ENABLED (default OFF): when not "true", `ingest` is a
 *     no-op that returns { enabled:false } and persists NOTHING. `listAdapters` is
 *     always available (read-only discovery).
 *   - RBAC: machine_monitoring / machine_alerts canCreate (inspection-write perm).
 *   - Fail-safe: unknown vendor → clear NOT_FOUND; bad payload → BAD_REQUEST; never
 *     crashes the process.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getVisionAdapter, listVisionAdapters } from "../services/vision";
import "../services/vision"; // side-effect: register all built-in vendor adapters
import { machineApiRouter } from "./machineApiRouters";

/** Master flag — default OFF. Ingest persists nothing unless explicitly enabled. */
function visionAdaptersEnabled(): boolean {
  return process.env.VISION_ADAPTERS_ENABLED === "true";
}

export const visionAdapterRouter = router({
  /** Read-only discovery of registered vendor adapters (always available). */
  listAdapters: protectedProcedure
    .use(requirePermission("machine_alerts", "canView"))
    .query(() => {
      return {
        enabled: visionAdaptersEnabled(),
        adapters: listVisionAdapters(),
      };
    }),

  /**
   * Ingest a vendor payload → normalize → persist via submitInspection.
   * machineCode (optional) is injected into the adapter context so payloads that
   * don't carry machine identity (e.g. from a QR/NFC-scanned station) still resolve.
   */
  ingest: protectedProcedure
    .use(requirePermission("machine_alerts", "canCreate"))
    .input(
      z.object({
        vendorKey: z.string().min(1).max(64),
        payload: z.unknown(),
        machineCode: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // ── Flag gate: no-op when disabled ──
      if (!visionAdaptersEnabled()) {
        return {
          enabled: false,
          ingested: false,
          message: "Vision adapters are disabled (set VISION_ADAPTERS_ENABLED=true to enable).",
        };
      }

      // ── Resolve adapter (unknown vendor → clean NOT_FOUND) ──
      let adapter;
      try {
        adapter = getVisionAdapter(input.vendorKey);
      } catch (err) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: err instanceof Error ? err.message : `Unknown vendor "${input.vendorKey}"`,
        });
      }

      // ── Normalize (bad payload → BAD_REQUEST, never crash) ──
      let canonical;
      try {
        canonical = adapter.normalize(input.payload, { machineCode: input.machineCode });
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Payload validation failed for vendor "${input.vendorKey}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }

      if (!canonical.machineCode && !canonical.apiKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Could not resolve machine identity — provide machineCode (argument or payload) or apiKey.",
        });
      }

      // ── Persist via the EXISTING submitInspection path (no duplicated insert logic) ──
      // submitInspection is a publicProcedure; we call it through a server-side caller
      // so all of its side-effects (image upload, point/defect resolution, NG + MQTT
      // alerts, cache invalidation, yield/heartbeat updates) are reused verbatim.
      const machineApiCaller = machineApiRouter.createCaller(ctx);
      const result = await machineApiCaller.submitInspection(canonical);

      const ngCount = canonical.measurements.filter((m) => m.result === "NG").length;
      return {
        enabled: true,
        ingested: true,
        vendorKey: input.vendorKey,
        inspectionId: result.inspectionId,
        summary: {
          serialNumber: canonical.serialNumber,
          overallResult: canonical.overallResult,
          measurementCount: canonical.measurements.length,
          ngCount,
        },
      };
    }),
});
