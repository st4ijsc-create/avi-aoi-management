/**
 * G4.30 (doc 44 W5-A3) — SYNAPSE Tầng-4 ADVICE API (spec §13.1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The standardized "Tầng-3 & Ứng dụng gọi" surface the Intelligence layer exposes:
 *   • POST /v1/predict/{task}   task ∈ anomaly | forecast | defect → Prediction (§12.1)
 *   • POST /v1/recommend        {target, action_type}             → Recommendation (§12.1)
 *   • GET  /v1/recommendations  list ai_pending_actions (the HITL proposal store)
 *
 * ADVISORY-ONLY, by construction (spec Nguyên tắc: "AI KHUYẾN NGHỊ, KHÔNG TỰ Ý
 * HÀNH ĐỘNG"):
 *   - /predict + /recommend are READ / PURE-COMPUTE. They NEVER create an
 *     ai_pending_action, NEVER call a write-tool, NEVER touch a device. A
 *     Recommendation is DATA (carrying its guardrail + requires[]); turning it into
 *     a command is a SEPARATE, HITL + Policy-gated step (aiCopilotActions.confirm).
 *   - Everything reuses the SAME services the tRPC routers call (no logic dup).
 *   - HONEST degradation: advisor OFF / thin data → the payload says so (never a
 *     fabricated number); defect prediction needs image upload → an explicit 501
 *     pointing at the internal AOI ingest path (no fake classifier here).
 *
 * NOT self-registered: this router is exported for the operator to wire into
 * server/api/v1/router.ts behind the `advice:read` scope (snippet in the batch
 * report). Until wired, the endpoints are dark — consistent with a flag-OFF batch.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { type Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";

// Least-privilege scope (spec §13.1) — registered in API_SCOPES (W5-A3 wiring).
export const ADVICE_READ = API_SCOPES.ADVICE_READ;

const PREDICT_TASKS = ["anomaly", "forecast", "defect"] as const;
type PredictTask = (typeof PREDICT_TASKS)[number];

/** Parse a positive-integer body field or throw a 400 (mirrors pdmHealth.ts). */
function bodyPosInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ApiHttpError(400, "bad_request", `Invalid ${label}.`);
  return n;
}

function optBodyPosInt(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return bodyPosInt(raw, label);
}

/** Register the G4.30 Advice API routes on the /api/v1 router. */
export function registerAdviceRoutes(r: Router): void {
  // ── POST /predict/:task — anomaly | forecast → Prediction; defect → honest 501 ──
  r.post(
    "/predict/:task",
    requireScope(ADVICE_READ),
    wrap(async (req: Request, res: Response) => {
      const task = String(req.params.task) as PredictTask;
      if (!PREDICT_TASKS.includes(task)) {
        throw new ApiHttpError(400, "bad_request", `Unknown predict task. Expected one of: ${PREDICT_TASKS.join(", ")}.`);
      }
      const body = (req.body ?? {}) as { assetId?: unknown; windowHours?: unknown };

      // defect: needs an image + a loaded vision model → NOT a JSON-only prediction.
      // Honest 501 pointing at the internal inline-AOI path (never a fake verdict).
      if (task === "defect") {
        throw new ApiHttpError(
          501,
          "not_implemented",
          "Defect prediction requires an image upload + a loaded vision model. Submit inspections/images " +
            "through the inline AOI ingest path (POST /api/v1/ingest/inspection), which runs the gated vision " +
            "verdict — this JSON endpoint does not classify images.",
        );
      }

      const assetId = bodyPosInt(body.assetId, "assetId");
      const windowHours = optBodyPosInt(body.windowHours, "windowHours");

      const { getDb } = await import("../../db/connection");
      const { machines } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");
      const [machine] = await d
        .select({ id: machines.id, code: machines.code })
        .from(machines)
        .where(eq(machines.id, assetId))
        .limit(1);
      if (!machine) throw new ApiHttpError(404, "not_found", `Asset ${assetId} not found.`);

      if (task === "forecast") {
        // PdM forecast → RUL/failure-risk (reuse the SAME service the tRPC PdM router calls).
        const { computeFailureRisk } = await import("../../services/predictiveMaintenanceService");
        const risk = await computeFailureRisk(assetId, windowHours);
        const rulDays = risk.predictedTimeframeHours != null ? Math.round((risk.predictedTimeframeHours / 24) * 10) / 10 : null;
        return sendOk(res, {
          pred_id: `PRD-fc-${assetId}-${Date.now()}`,
          model: "pdm-risk@heuristic",
          asset: machine.code,
          type: "forecast",
          value: {
            failure_risk: risk.failureRisk,
            rul_hours: risk.predictedTimeframeHours,
            rul_days: rulDays,
            urgency: risk.maintenanceUrgency,
          },
          confidence: risk.confidenceScore / 100,
          explain: risk.factors.map((f) => `${f.name}: ${f.description}`),
          ts: new Date().toISOString(),
        });
      }

      // task === "anomaly" → latest PATTERN_ANOMALY prediction for the asset.
      const { predictiveAlerts } = await import("../../../drizzle/schema");
      const [alert] = await d
        .select({
          id: predictiveAlerts.id,
          predictedValue: predictiveAlerts.predictedValue,
          currentValue: predictiveAlerts.currentValue,
          threshold: predictiveAlerts.threshold,
          confidenceScore: predictiveAlerts.confidenceScore,
          predictedTimeframe: predictiveAlerts.predictedTimeframe,
          title: predictiveAlerts.title,
          description: predictiveAlerts.description,
          createdAt: predictiveAlerts.createdAt,
        })
        .from(predictiveAlerts)
        .where(and(eq(predictiveAlerts.machineId, assetId), eq(predictiveAlerts.alertType, "PATTERN_ANOMALY" as never)))
        .orderBy(desc(predictiveAlerts.createdAt))
        .limit(1);

      if (!alert) {
        // HONEST: no anomaly prediction on record → null value, not a fabricated one.
        return sendOk(res, {
          pred_id: null,
          model: "anomaly-detector",
          asset: machine.code,
          type: "anomaly",
          value: null,
          confidence: null,
          explain: ["No anomaly prediction on record for this asset."],
          ts: new Date().toISOString(),
        });
      }

      const conf = alert.confidenceScore != null ? Number(alert.confidenceScore) : null;
      sendOk(res, {
        pred_id: `PRD-an-${alert.id}`,
        model: "anomaly-detector",
        asset: machine.code,
        type: "anomaly",
        value: {
          predicted: alert.predictedValue != null ? Number(alert.predictedValue) : null,
          current: alert.currentValue != null ? Number(alert.currentValue) : null,
          threshold: alert.threshold != null ? Number(alert.threshold) : null,
          timeframe: alert.predictedTimeframe,
        },
        // confidenceScore is 0..100 in this table → normalize to 0..1 (spec shape).
        confidence: conf != null ? Math.round((conf > 1 ? conf / 100 : conf) * 100) / 100 : null,
        explain: [alert.title, alert.description].filter((x): x is string => typeof x === "string" && x.length > 0),
        ts: alert.createdAt,
      });
    }),
  );

  // ── POST /recommend — {target, action_type} → Recommendation (§12.1) ──────────
  // Pure ADVISORY: calls the threshold advisor in READ mode (it computes but does
  // NOT create a pending action). The response carries guardrail + requires[] so
  // Tầng-3 can enforce the safety contract before turning it into a command.
  r.post(
    "/recommend",
    requireScope(ADVICE_READ),
    wrap(async (req, res) => {
      const body = (req.body ?? {}) as {
        target?: { ngThresholdId?: unknown; measurementPointId?: unknown; machineId?: unknown; productModelId?: unknown } | string;
        action_type?: unknown;
        windowDays?: unknown;
      };
      const actionType = typeof body.action_type === "string" ? body.action_type : "";
      const KNOWN_ACTIONS = ["adjust_ng_threshold", "adjust_param"];
      if (!KNOWN_ACTIONS.includes(actionType)) {
        throw new ApiHttpError(400, "bad_request", `Unknown action_type. Expected one of: ${KNOWN_ACTIONS.join(", ")}.`);
      }
      const target = (typeof body.target === "object" && body.target ? body.target : {}) as {
        ngThresholdId?: unknown;
        measurementPointId?: unknown;
        machineId?: unknown;
        productModelId?: unknown;
      };
      const windowDays = optBodyPosInt(body.windowDays, "windowDays");

      if (actionType === "adjust_ng_threshold") {
        const ngThresholdId = bodyPosInt(target.ngThresholdId, "target.ngThresholdId");
        const { recommendNgThreshold } = await import("../../services/aiThresholdAdvisor");
        const rec = await recommendNgThreshold({ ngThresholdId, windowDays });
        return sendOk(res, {
          rec_id: `REC-ng-${ngThresholdId}`,
          source: "aiThresholdAdvisor",
          target: `ng_threshold:${ngThresholdId}`,
          action: "adjust_ng_threshold",
          proposal: { warningThreshold: rec.recommended.warning, criticalThreshold: rec.recommended.critical },
          expected: {}, // no closed-form FPY gain for an NG-rate threshold move
          confidence: null, // NgRecommendation carries no confidence score (honest)
          guardrail: { min: 0, max: 100, unit: "%", key: "warningThreshold" },
          requires: ["policy_permit"],
          // Honest advisory metadata (not part of the spec shape but load-bearing).
          advisory: true,
          disabled: rec.disabled ?? false,
          degraded: rec.degraded,
          basis: rec.basis,
          note: rec.note ?? null,
        });
      }

      // adjust_param → measurement-point limits (twin-first per spec §16).
      const measurementPointId = bodyPosInt(target.measurementPointId, "target.measurementPointId");
      const machineId = optBodyPosInt(target.machineId, "target.machineId");
      const productModelId = optBodyPosInt(target.productModelId, "target.productModelId");
      const { recommendForMeasurementPoint } = await import("../../services/aiThresholdAdvisor");
      const rec = await recommendForMeasurementPoint({ measurementPointId, machineId, productModelId, windowDays });

      const guardrail =
        rec.current.lsl != null && rec.current.usl != null && rec.current.usl > rec.current.lsl
          ? { min: rec.current.lsl, max: rec.current.usl, unit: rec.unit ?? undefined, key: "target" }
          : undefined;

      sendOk(res, {
        rec_id: `REC-mp-${measurementPointId}`,
        source: "aiThresholdAdvisor",
        target: `measurement_point:${measurementPointId}`,
        action: "adjust_param",
        proposal: { lsl: rec.recommended.lsl, usl: rec.recommended.usl, target: rec.recommended.target },
        expected: { projectedCpk: rec.recommended.projectedCpk },
        confidence: rec.confidence,
        ...(guardrail ? { guardrail } : {}),
        requires: ["twin_validation", "policy_permit"],
        advisory: true,
        disabled: rec.disabled ?? false,
        degraded: rec.degraded,
        needsReview: rec.needsReview ?? false,
        basis: rec.basis,
        note: rec.note ?? null,
      });
    }),
  );

  // ── GET /recommendations — list the HITL proposal store (ai_pending_actions) ──
  r.get(
    "/recommendations",
    requireScope(ADVICE_READ),
    wrap(async (req, res) => {
      const { getDb } = await import("../../db/connection");
      const { aiPendingActions } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) return sendOk(res, { recommendations: [], count: 0 }); // honest-empty

      const KNOWN_STATUS = ["proposed", "confirmed", "executed", "denied", "expired", "cancelled"];
      const statusRaw = typeof req.query.status === "string" && req.query.status ? req.query.status : undefined;
      if (statusRaw && !KNOWN_STATUS.includes(statusRaw)) {
        throw new ApiHttpError(400, "bad_request", `Invalid status. Expected one of: ${KNOWN_STATUS.join(", ")}.`);
      }
      const tool = typeof req.query.tool === "string" && req.query.tool ? req.query.tool : undefined;
      const limRaw = Number(req.query.limit);
      const limit = Number.isFinite(limRaw) ? Math.min(Math.max(1, Math.trunc(limRaw)), 200) : 50;

      const conds = [];
      if (statusRaw) conds.push(eq(aiPendingActions.status, statusRaw as never));
      if (tool) conds.push(eq(aiPendingActions.tool, tool));

      const rows = await d
        .select({
          id: aiPendingActions.id,
          tool: aiPendingActions.tool,
          status: aiPendingActions.status,
          summary: aiPendingActions.summary,
          requiredPermission: aiPendingActions.requiredPermissionJson,
          previewJson: aiPendingActions.previewJson,
          createdAt: aiPendingActions.createdAt,
          expiresAt: aiPendingActions.expiresAt,
        })
        .from(aiPendingActions)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(aiPendingActions.createdAt))
        .limit(limit);

      const recommendations = rows.map((row) => {
        const contract = (row.previewJson && typeof row.previewJson === "object"
          ? (row.previewJson as Record<string, unknown>).contract
          : null) as { guardrail?: unknown; requires?: unknown; confidence?: unknown } | null;
        return {
          rec_id: row.id,
          tool: row.tool,
          status: row.status,
          summary: row.summary,
          requiredPermission: row.requiredPermission ?? null,
          guardrail: contract?.guardrail ?? null,
          requires: contract?.requires ?? null,
          confidence: contract?.confidence ?? null,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        };
      });

      sendOk(res, { recommendations, count: recommendations.length });
    }),
  );
}
