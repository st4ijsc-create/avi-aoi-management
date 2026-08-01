/**
 * W0-F G4.11 (doc 44) — PdM REST reads: asset health + prediction history.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * GAP closed: the only /api/v1 PdM surface was GET /pdm/risk (a raw
 * computeFailureRisk echo). A CMMS/MES integrating predictive maintenance needs
 * (a) a per-ASSET health view — predicted health + RUL + confidence + factors —
 * and (b) the PREDICTION/ALERT history to reconcile against its own work orders.
 *
 * Follows the moduleReads.ts pattern exactly:
 *   • READ-ONLY, scope-gated (reuses `pdm:read` — same least-privilege scope as
 *     /pdm/risk), `{ ok, data?, error? }` envelope, wrap() fail-safe.
 *   • Reuses the SAME service/tables the tRPC routers use (computeFailureRisk,
 *     machine_health_history, predictive_alerts) — no logic duplication.
 *   • HONEST: no DB → empty payloads; no snapshot → healthScore:null; the RUL is
 *     explicitly labelled a heuristic proxy (EWMA forecast crossing + MTBF cap),
 *     never presented as a trained survival model.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { type Router, type Request, type Response } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";

/** Parse a positive-integer param or throw a 400 (mirrors moduleReads.ts). */
function posInt(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ApiHttpError(400, "bad_request", `Invalid ${label}.`);
  return n;
}

function optPosInt(raw: unknown, label: string): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  return posInt(raw, label);
}

/** Optional ISO date query param → Date | undefined (400 on garbage). */
function optDate(raw: unknown, label: string): Date | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new ApiHttpError(400, "bad_request", `Invalid ${label} (expect ISO date-time).`);
  return d;
}

function limitParam(raw: unknown, def: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(1, Math.trunc(n)), max);
}

/** Register the W0-F PdM health/prediction READ routes on the /api/v1 router. */
export function registerPdmHealthRoutes(r: Router): void {
  // ── GET /health/assets/:id — predicted health + RUL + confidence + factors ──
  r.get(
    "/health/assets/:id",
    requireScope(API_SCOPES.PDM_READ),
    wrap(async (req: Request, res: Response) => {
      const machineId = posInt(req.params.id, "asset id");
      const windowHours = optPosInt(req.query.windowHours, "windowHours");

      const { getDb } = await import("../../db/connection");
      const { machines, machineHealthHistory } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) throw new ApiHttpError(500, "db_unavailable", "Database not connected.");

      const [machine] = await d
        .select({ id: machines.id, code: machines.code, name: machines.name })
        .from(machines)
        .where(eq(machines.id, machineId))
        .limit(1);
      if (!machine) throw new ApiHttpError(404, "not_found", `Asset ${machineId} not found.`);

      // Reuse the SAME risk computation the tRPC PdM router calls.
      const { computeFailureRisk } = await import("../../services/predictiveMaintenanceService");
      const risk = await computeFailureRisk(machineId, windowHours);

      // Latest health snapshot (measured or PdM-written). HONEST: null when none.
      const [latest] = await d
        .select({
          healthScore: machineHealthHistory.healthScore,
          timestamp: machineHealthHistory.timestamp,
          calculationMethod: machineHealthHistory.calculationMethod,
        })
        .from(machineHealthHistory)
        .where(eq(machineHealthHistory.machineId, machineId))
        .orderBy(desc(machineHealthHistory.timestamp))
        .limit(1);

      sendOk(res, {
        assetId: machine.id,
        assetCode: machine.code,
        assetName: machine.name,
        health: latest
          ? {
              score: Number(latest.healthScore),
              at: latest.timestamp,
              method: latest.calculationMethod,
            }
          : null, // honest: no snapshot yet → no fabricated health number
        failureRisk: risk.failureRisk,
        confidenceScore: risk.confidenceScore,
        maintenanceUrgency: risk.maintenanceUrgency,
        rul: {
          hours: risk.predictedTimeframeHours,
          description: risk.predictedTimeframe,
          recommendedMaintenanceDate: risk.recommendedMaintenanceDate,
          // HONEST label: heuristic proxy (EWMA health-forecast crossing capped
          // by MTBF) — not a trained remaining-useful-life model.
          method: "heuristic-proxy",
        },
        factors: risk.factors,
        dataPoints: risk.dataPoints,
      });
    }),
  );

  // ── GET /predictions — prediction/alert history from predictive_alerts ──────
  // Reads the SAME central table the smart-alert router + PdM cycle write to.
  r.get(
    "/predictions",
    requireScope(API_SCOPES.PDM_READ),
    wrap(async (req, res) => {
      const { getDb } = await import("../../db/connection");
      const { predictiveAlerts } = await import("../../../drizzle/schema");
      const d = await getDb();
      if (!d) return sendOk(res, { predictions: [], count: 0 }); // honest-empty

      const assetId = optPosInt(req.query.assetId, "assetId");
      // `type` is a Postgres enum — validate up-front so garbage is a clean 400,
      // not an enum-cast 500.
      const KNOWN_TYPES = ["DEFECT_SPIKE", "YIELD_DROP", "MACHINE_FAILURE", "QUALITY_DEGRADATION", "PATTERN_ANOMALY"];
      const type = typeof req.query.type === "string" && req.query.type ? req.query.type : undefined;
      if (type && !KNOWN_TYPES.includes(type)) {
        throw new ApiHttpError(400, "bad_request", `Invalid type. Expected one of: ${KNOWN_TYPES.join(", ")}.`);
      }
      const from = optDate(req.query.from, "from");
      const to = optDate(req.query.to, "to");
      const limit = limitParam(req.query.limit, 100, 500);

      const conds = [];
      if (assetId != null) conds.push(eq(predictiveAlerts.machineId, assetId));
      if (type) conds.push(eq(predictiveAlerts.alertType, type as never));
      if (from) conds.push(gte(predictiveAlerts.createdAt, from));
      if (to) conds.push(lte(predictiveAlerts.createdAt, to));

      const rows = await d
        .select({
          id: predictiveAlerts.id,
          type: predictiveAlerts.alertType,
          severity: predictiveAlerts.severity,
          title: predictiveAlerts.title,
          description: predictiveAlerts.description,
          assetId: predictiveAlerts.machineId,
          assetCode: predictiveAlerts.machineCode,
          predictedValue: predictiveAlerts.predictedValue,
          currentValue: predictiveAlerts.currentValue,
          threshold: predictiveAlerts.threshold,
          confidenceScore: predictiveAlerts.confidenceScore,
          predictedTimeframe: predictiveAlerts.predictedTimeframe,
          status: predictiveAlerts.status,
          createdAt: predictiveAlerts.createdAt,
        })
        .from(predictiveAlerts)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(predictiveAlerts.createdAt))
        .limit(limit);

      sendOk(res, { predictions: rows, count: rows.length });
    }),
  );
}
