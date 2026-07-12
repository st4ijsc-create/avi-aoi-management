/**
 * W0-F G4.27 (doc 44) — AI model registry over /api/v1: catalogue + drift report
 * (READ) and promote/rollback (MUTATION, flag-gated OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * READS (scope `models:read`) follow the moduleReads.ts pattern — reuse the SAME
 * db/service functions the tRPC AI routers call, `{ ok, data?, error? }` envelope,
 * honest-empty when the DB/data is absent.
 *
 * MUTATIONS (scope `models:write`) — DESIGN DECISION: /api/v1 has so far been
 * read-only for upper-layer modules; the only external mutations are the
 * HITL-gated equipment commands and flag-gated ERP intake. Model promote/rollback
 * changes which model serves production inference, so it follows the ERP-intake
 * safety pattern: a dedicated flag `V1_MODEL_MUTATIONS_ENABLED` (default OFF) —
 * OFF → structured 501 `v1_model_mutations_disabled` (published contract, not
 * yet open). ON → the endpoints wrap the EXACT internal lifecycle paths:
 *   • promote  → aiModelService.activateModelVersion (same as manual activation)
 *   • rollback → modelAutoRollback.manualRollback (same append-only
 *     model_rollback_events audit row the auto-rollback sweep writes)
 * No model-registry fork, no new lifecycle logic.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { type Router, type Request, type Response } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, sendError, wrap, ApiHttpError } from "./envelope";

/** True when /api/v1 model lifecycle mutations are enabled (default OFF). */
export function v1ModelMutationsEnabled(): boolean {
  return process.env.V1_MODEL_MUTATIONS_ENABLED === "true" || process.env.V1_MODEL_MUTATIONS_ENABLED === "1";
}

function posInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ApiHttpError(400, "bad_request", `Invalid ${label}.`);
  return n;
}

function limitParam(raw: unknown, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(1, Math.trunc(n)), max);
}

/** Guard: 501 when model mutations are not opened yet. */
function ensureMutationsEnabled(res: Response): boolean {
  if (!v1ModelMutationsEnabled()) {
    sendError(
      res,
      501,
      "v1_model_mutations_disabled",
      "Model promote/rollback over /api/v1 is not opened yet (set V1_MODEL_MUTATIONS_ENABLED=true). Use the internal gated flow.",
      { flag: "V1_MODEL_MUTATIONS_ENABLED" },
    );
    return false;
  }
  return true;
}

/** Register the W0-F model-registry routes on the /api/v1 router. */
export function registerModelRegistryRoutes(r: Router): void {
  // ── GET /models — catalogue: ai_models + model_versions (stage/status) ──────
  r.get(
    "/models",
    requireScope(API_SCOPES.MODELS_READ),
    wrap(async (req: Request, res: Response) => {
      const { getDb } = await import("../../db/connection");
      const { aiModels, modelVersions } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) return sendOk(res, { models: [], count: 0 }); // honest-empty

      const limit = limitParam(req.query.limit, 100, 500);
      const status = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;

      const modelRows = await d
        .select({
          id: aiModels.id,
          code: aiModels.code,
          name: aiModels.name,
          modelType: aiModels.modelType,
          format: aiModels.format,
          currentVersion: aiModels.currentVersion,
          status: aiModels.status,
          productModelId: aiModels.productModelId,
          updatedAt: aiModels.updatedAt,
        })
        .from(aiModels)
        .where(status ? eq(aiModels.status, status as never) : undefined)
        .orderBy(desc(aiModels.updatedAt))
        .limit(limit);

      // One query for every listed model's versions (no N+1).
      const ids = modelRows.map((m) => m.id);
      const versionRows = ids.length
        ? await d
            .select({
              id: modelVersions.id,
              modelId: modelVersions.modelId,
              version: modelVersions.version,
              status: modelVersions.status,
              accuracy: modelVersions.accuracy,
              createdAt: modelVersions.createdAt,
            })
            .from(modelVersions)
            .where(inArray(modelVersions.modelId, ids))
            .orderBy(desc(modelVersions.createdAt))
        : [];

      const byModel = new Map<number, typeof versionRows>();
      for (const v of versionRows) {
        const list = byModel.get(v.modelId) ?? [];
        list.push(v);
        byModel.set(v.modelId, list);
      }

      const models = modelRows.map((m) => ({
        ...m,
        // "stage" for an external consumer = the registry status of the version
        // that is serving (ACTIVE) or its lifecycle status otherwise.
        versions: (byModel.get(m.id) ?? []).map((v) => ({
          id: v.id,
          version: v.version,
          stage: v.status, // UPLOADING/VALIDATING/READY/ACTIVE/INACTIVE/FAILED/ARCHIVED
          accuracy: v.accuracy != null ? Number(v.accuracy) : null,
          createdAt: v.createdAt,
        })),
      }));

      sendOk(res, { models, count: models.length, mutationsEnabled: v1ModelMutationsEnabled() });
    }),
  );

  // ── POST /models/:id/promote — activate a version (flag-gated, default OFF) ──
  r.post(
    "/models/:id/promote",
    requireScope(API_SCOPES.MODELS_WRITE),
    wrap(async (req, res) => {
      if (!ensureMutationsEnabled(res)) return;
      const modelId = posInt(req.params.id, "model id");
      const body = (req.body ?? {}) as { versionId?: number };
      if (!Number.isInteger(body.versionId) || (body.versionId as number) <= 0) {
        throw new ApiHttpError(400, "bad_request", "Body field `versionId` (positive integer) is required.");
      }
      const { activateModelVersion } = await import("../../services/aiModelService");
      try {
        // SAME path as manual activation (marks previous ACTIVE → INACTIVE,
        // bumps aiModels.currentVersion) — no registry fork.
        const target = await activateModelVersion(modelId, body.versionId as number);
        sendOk(res, {
          modelId,
          promotedVersionId: target.id,
          version: target.version,
          status: "ACTIVE",
          promotedBy: req.apiPrincipal?.name ?? "api-key",
        });
      } catch (err) {
        // activateModelVersion throws plain Errors for unknown model/version.
        throw new ApiHttpError(404, "not_found", (err as Error)?.message ?? "Promote failed.");
      }
    }),
  );

  // ── POST /models/:id/rollback — roll back to a stable version (flag-gated) ──
  r.post(
    "/models/:id/rollback",
    requireScope(API_SCOPES.MODELS_WRITE),
    wrap(async (req, res) => {
      if (!ensureMutationsEnabled(res)) return;
      const modelId = posInt(req.params.id, "model id");
      const body = (req.body ?? {}) as { toVersionId?: number; reason?: string };
      const { manualRollback, pickRollbackTarget } = await import("../../services/ai/modelAutoRollback");

      // Resolve the target: explicit toVersionId wins; otherwise pick the most
      // recent stable version via the SAME selector the auto-rollback sweep uses.
      let toVersionId = body.toVersionId;
      if (toVersionId == null) {
        const { getDb } = await import("../../db/connection");
        const { modelVersions } = await import("../../../drizzle/schema");
        const d = await getDb();
        if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");
        const versions = await d
          .select()
          .from(modelVersions)
          .where(eq(modelVersions.modelId, modelId))
          .orderBy(desc(modelVersions.createdAt));
        const active = versions.find((v) => v.status === "ACTIVE");
        if (!active) throw new ApiHttpError(409, "no_active_version", `Model ${modelId} has no ACTIVE version to roll back from.`);
        const target = pickRollbackTarget(versions, active.id);
        if (!target) throw new ApiHttpError(409, "no_rollback_target", `Model ${modelId} has no stable prior version with an eval baseline.`);
        toVersionId = target.id;
      } else if (!Number.isInteger(toVersionId) || toVersionId <= 0) {
        throw new ApiHttpError(400, "bad_request", "Body field `toVersionId` must be a positive integer.");
      }

      // SAME manualRollback path the internal operator flow uses — flips the
      // version via activateModelVersion AND records the append-only
      // model_rollback_events audit row. triggeredBy 0 = external API principal
      // (name carried in the response for audit correlation).
      const reason = typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : `Rollback via /api/v1 by ${req.apiPrincipal?.name ?? "api-key"}`;
      const outcome = await manualRollback(modelId, toVersionId, 0, reason);
      if (!outcome.rolledBack) {
        throw new ApiHttpError(409, "rollback_failed", outcome.reason);
      }
      sendOk(res, {
        modelId,
        rolledBack: true,
        fromVersionId: outcome.fromVersionId ?? null,
        toVersionId: outcome.toVersionId,
        eventId: outcome.eventId ?? null,
        reason,
        requestedBy: req.apiPrincipal?.name ?? "api-key",
      });
    }),
  );

  // ── GET /monitoring/drift — drift report (READ-ONLY, advisory) ──────────────
  r.get(
    "/monitoring/drift",
    requireScope(API_SCOPES.MODELS_READ),
    wrap(async (req, res) => {
      // In-process counters + flag state from the confidence-drift monitor.
      const { getDriftMetrics, isDriftMonitorEnabled } = await import("../../services/aiDriftMonitor");
      const metrics = getDriftMetrics();

      // Persisted advisory alerts (model_drift_alerts — the SAME table both
      // aiDriftMonitor and aiMonitoring write). HONEST: empty when absent.
      const { getDb } = await import("../../db/connection");
      const { modelDriftAlerts } = await import("../../../drizzle/schema");
      const d = await getDb();
      let alerts: unknown[] = [];
      if (d) {
        const modelId = req.query.modelId != null && req.query.modelId !== ""
          ? posInt(req.query.modelId, "modelId")
          : undefined;
        const limit = limitParam(req.query.limit, 50, 200);
        alerts = await d
          .select()
          .from(modelDriftAlerts)
          .where(modelId != null ? eq(modelDriftAlerts.modelId, modelId) : undefined)
          .orderBy(desc(modelDriftAlerts.createdAt))
          .limit(limit);
      }

      sendOk(res, {
        advisory: true, // drift monitoring never swaps a model by itself here
        monitorEnabled: isDriftMonitorEnabled(),
        counters: metrics.counters,
        alerts,
        count: alerts.length,
      });
    }),
  );
}
