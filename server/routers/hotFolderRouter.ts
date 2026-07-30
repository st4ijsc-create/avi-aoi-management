/**
 * Hot-folder ingestion router (key "hotFolder") — doc 27 §3 gap C1 · W2-A.
 *
 * tRPC surface over server/services/vision/hotFolderService.ts:
 *   • CRUD hot_folder_configs (watch folder + vendor adapter per machine).
 *   • status — per-config live runtime (watching / lastFile / lastError / counters).
 *   • recentFiles — processed-file ledger tail (audit trail per config).
 *   • processNow — manual "scan the folder now" trigger (same pipeline, dedup-safe).
 *   • dryRun — parse + normalize a SAMPLE file and return the canonical inspection
 *     WITHOUT persisting anything (W2-D's onboarding wizard calls this).
 *
 * GATING: HOT_FOLDER_INGEST_ENABLED (default OFF) — config CRUD and dryRun stay
 * available so a folder can be prepared before the flag is flipped; only the
 * WATCHERS and the manual processNow trigger require the flag (they touch fs +
 * persist inspections).
 *
 * RBAC (mirrors deviceAdapter/edgeRuntime): reads → machine_monitoring/canView;
 * create/processNow/dryRun → machine_control/canCreate; update → canEdit;
 * delete → canDelete.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import {
  hotFolderIngestEnabled,
  getHotFolderStatus,
  listHotFolderConfigs,
  createHotFolderConfig,
  updateHotFolderConfig,
  deleteHotFolderConfig,
  listRecentHotFolderFiles,
  scanConfigNow,
  dryRunSample,
} from "../services/vision/hotFolderService";

const configShape = {
  machineId: z.number().int().positive(),
  adapterKey: z.string().trim().min(1).max(64),
  watchPath: z.string().trim().min(1).max(2048),
  filePattern: z.string().trim().min(1).max(255).optional(),
  archivePath: z.string().trim().max(2048).nullish(),
  errorPath: z.string().trim().max(2048).nullish(),
  enabled: z.boolean().optional(),
  pollFallbackMs: z.number().int().min(0).max(3_600_000).optional(),
  stabilityWindowMs: z.number().int().min(200).max(600_000).optional(),
  deleteAfterDays: z.number().int().min(0).max(3650).optional(),
};

function asBadRequest(err: unknown): never {
  throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "manageHotFolder" }, err instanceof Error ? err.message : String(err));
}

export const hotFolderRouter = router({
  /** Flag + per-config live runtime status (watching/lastFile/lastError/counters). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => getHotFolderStatus()),

  /** All configs (config UI list). */
  listConfigs: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => listHotFolderConfigs()),

  /** Processed-file ledger tail for one config (newest first). */
  recentFiles: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ configId: z.number().int().positive(), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ input }) => listRecentHotFolderFiles(input.configId, input.limit ?? 20)),

  /** Create a config. Validates adapterKey (registry) + machine + absolute paths. */
  createConfig: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object(configShape))
    .mutation(async ({ input }) => {
      try {
        return await createHotFolderConfig(input);
      } catch (err) {
        asBadRequest(err);
      }
    }),

  /** Update a config (partial patch); the config's watcher is restarted live. */
  updateConfig: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(
      z.object({
        id: z.number().int().positive(),
        patch: z.object(configShape).partial(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await updateHotFolderConfig(input.id, input.patch);
      } catch (err) {
        asBadRequest(err);
      }
    }),

  /** Delete a config (its watcher is stopped first; ledger rows are kept for audit). */
  deleteConfig: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      try {
        return await deleteHotFolderConfig(input.id);
      } catch (err) {
        asBadRequest(err);
      }
    }),

  /**
   * Manual "process this folder now" — scans watchPath once through the SAME
   * pipeline (idempotent: already-ingested content dedups). Flag-gated because
   * it persists inspections.
   */
  processNow: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ configId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      if (!hotFolderIngestEnabled()) {
        return {
          enabled: false as const,
          message: "Hot-folder ingest is disabled (set HOT_FOLDER_INGEST_ENABLED=true to enable).",
        };
      }
      try {
        const result = await scanConfigNow(input.configId);
        return { enabled: true as const, ...result };
      } catch (err) {
        asBadRequest(err);
      }
    }),

  /**
   * Dry-run a SAMPLE file: parse (CSV/XML/JSON by extension) + adapter.normalize →
   * canonical inspection, persisting NOTHING (no db write, no fs). This is the
   * seam W2-D's onboarding wizard uses to validate a machine's real export file.
   */
  dryRun: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(
      z.object({
        adapterKey: z.string().trim().min(1).max(64),
        fileName: z.string().trim().min(1).max(512),
        /** Raw file text (CSV/XML/JSON are text formats); capped at ~2 MB. */
        content: z.string().min(1).max(2_000_000),
        machineCode: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ input }) => dryRunSample(input)),
});
