/**
 * doc 44 W2-B1 / G2.16 — GET /v1/metrics/{metric} (SYNAPSE Tầng 2 §11.1/§15).
 *
 * THIN wrapper over the governed semantic layer: semantics/metricRegistry.
 * computeMetric — "chỉ số qua semantic layer, KHÔNG tự tính lại" (§11.3). The
 * response is the spec §10.2 MetricResult, ALWAYS stamped with
 * definition_version ("OEE@v1") for traceability. Honest error mapping:
 *   METRIC_NOT_FOUND → 404 · UNSUPPORTED_SCOPE / SCOPE_ID_REQUIRED /
 *   WINDOW_NOT_SUPPORTED → 400 · DB_UNAVAILABLE → 503.
 *
 * Query: ?scope=equipment|line|factory&scopeId=&from=&to= (from/to default to
 * the trailing 24 h window ending now). Scope: data:read. READ-ONLY.
 */
import { type Router, type Request, type Response } from "express";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";

function dateParam(raw: unknown, label: string, fallback: Date): Date {
  if (raw == null || raw === "") return fallback;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new ApiHttpError(400, "bad_request", `Invalid ${label} — expected an ISO date-time.`);
  return d;
}

/** Register GET /metrics/:metric on the /api/v1 router. */
export function registerMetricRoutes(r: Router): void {
  r.get(
    "/metrics/:metric",
    requireScope(API_SCOPES.DATA_READ),
    wrap(async (req: Request, res: Response) => {
      const metric = String(req.params.metric ?? "").trim();
      if (!metric) throw new ApiHttpError(400, "bad_request", "Metric name is required.");

      const scope = typeof req.query.scope === "string" ? req.query.scope.trim() : "";
      if (!scope) {
        throw new ApiHttpError(400, "bad_request", "Query param `scope` is required (e.g. equipment | line | factory).");
      }
      let scopeId: number | undefined;
      if (req.query.scopeId != null && req.query.scopeId !== "") {
        const n = Number(req.query.scopeId);
        if (!Number.isInteger(n) || n <= 0) throw new ApiHttpError(400, "bad_request", "Invalid scopeId.");
        scopeId = n;
      }
      const now = new Date();
      const to = dateParam(req.query.to, "to", now);
      const from = dateParam(req.query.from, "from", new Date(to.getTime() - 24 * 3600 * 1000));
      if (from.getTime() >= to.getTime()) {
        throw new ApiHttpError(400, "bad_request", "`from` must be earlier than `to`.");
      }

      const { computeMetric, MetricComputeError } = await import("../../services/semantics/metricRegistry");
      try {
        const result = await computeMetric(metric, { scope, scopeId, from, to });
        sendOk(res, result);
      } catch (err) {
        if (err instanceof MetricComputeError) {
          switch (err.code) {
            case "METRIC_NOT_FOUND":
              throw new ApiHttpError(404, "metric_not_found", err.message);
            case "DB_UNAVAILABLE":
              throw new ApiHttpError(503, "db_unavailable", err.message);
            default:
              // UNSUPPORTED_SCOPE | SCOPE_ID_REQUIRED | WINDOW_NOT_SUPPORTED
              throw new ApiHttpError(400, err.code.toLowerCase(), err.message);
          }
        }
        throw err;
      }
    }),
  );
}
