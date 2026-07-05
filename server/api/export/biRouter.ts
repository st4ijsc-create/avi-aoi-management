/**
 * W5-D (doc 27 §6 gap A10) — BI DATASET FEED for Power BI / Tableau web
 * connectors.
 * ════════════════════════════════════════════════════════════════════════════
 *   GET /api/bi/datasets                    — dataset catalog (name/params)
 *   GET /api/bi/datasets/:name              — paged JSON rows + nextToken
 *
 * Datasets (all AGGREGATE/rollup level — raw rows live on /api/export):
 *   • inspections_daily — canonical final-yield per machine per factory-TZ day.
 *     Served from the `hourly_yield_cache` MV when FRESH (same freshness rule
 *     as the dashboard read path, W4-B/A7), otherwise a live query using the
 *     0174 `to_factory_time()` bucketing (fallback: naive date_trunc when the
 *     helper functions are not installed).
 *   • defect_pareto     — NG measurement count per defect class
 *     (defect_catalog), window-scoped.
 *   • machine_oee       — per machine per day averages from `oee_metrics`.
 *
 * Contract (documented in docs/ECOSYSTEM/30_BI_EXPORT_API.md):
 *   • AUTH — API key with the `bi:read` scope (Bearer / X-API-Key).
 *   • PAGING — plain JSON `{ dataset, rows, nextToken }`; pass `nextToken`
 *     back verbatim to fetch the next page (@odata.nextLink-STYLE continuation
 *     — full OData $filter/$select/$orderby is deliberately NOT implemented
 *     and documented as unsupported).
 *   • WINDOW — optional from/to (ISO); default last 30 days; span capped at
 *     366 days.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { Router, type Request, type Response } from "express";
import { API_SCOPES } from "../v1/scopes";
import { requireScope } from "../v1/auth";

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const DEFAULT_PAGE_SIZE = intEnv("BI_DATASET_PAGE_SIZE", 1000);
const MAX_PAGE_SIZE = intEnv("BI_DATASET_MAX_PAGE_SIZE", 5000);
export const BI_MAX_WINDOW_DAYS = intEnv("BI_MAX_WINDOW_DAYS", 366);

// ── Continuation token (offset-based; datasets are bounded rollups) ──────────

export function encodeNextToken(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), "utf8").toString("base64url");
}

export function decodeNextToken(token: unknown): number {
  if (typeof token !== "string" || !token) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const o = Number(parsed?.o);
    return Number.isInteger(o) && o >= 0 ? o : 0;
  } catch {
    return 0;
  }
}

// ── Window (optional, defaulted) ──────────────────────────────────────────────

function parseBiWindow(req: Request): { from: Date; to: Date; error?: string } {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 86_400_000);
  let from = defaultFrom;
  let to = now;
  if (typeof req.query.from === "string" && req.query.from) {
    const d = new Date(req.query.from);
    if (Number.isNaN(d.getTime())) return { from, to, error: "Invalid `from` (ISO-8601 expected)." };
    from = d;
  }
  if (typeof req.query.to === "string" && req.query.to) {
    const d = new Date(req.query.to);
    if (Number.isNaN(d.getTime())) return { from, to, error: "Invalid `to` (ISO-8601 expected)." };
    to = d;
  }
  if (from.getTime() >= to.getTime()) return { from, to, error: "`from` must be before `to`." };
  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > BI_MAX_WINDOW_DAYS) {
    return { from, to, error: `Window too large: max ${BI_MAX_WINDOW_DAYS} days.` };
  }
  return { from, to };
}

function pageParams(req: Request): { offset: number; pageSize: number } {
  const offset = decodeNextToken(req.query.nextToken);
  const rawSize = Number(req.query.pageSize);
  const pageSize =
    Number.isInteger(rawSize) && rawSize > 0 ? Math.min(rawSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { offset, pageSize };
}

// ── Dataset catalog ───────────────────────────────────────────────────────────

export const BI_DATASETS = [
  {
    name: "inspections_daily",
    description:
      "Canonical final-yield rollup per machine per factory-timezone day: total/ok/ng/ntf/yield_rate (NTF counts as pass).",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["day", "machine_id", "total", "ok", "ng", "ntf", "yield_rate"],
  },
  {
    name: "defect_pareto",
    description:
      "NG measurement count per defect class (defect_catalog) in the window, with share-of-total (pct). Unclassified NG rows appear as defect_code=UNCLASSIFIED.",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["defect_code", "defect_name", "defect_name_vi", "count", "pct"],
  },
  {
    name: "machine_oee",
    description:
      "Per machine per day averages from oee_metrics: availability/performance/quality/oee (%), plus summed counts.",
    params: { from: "ISO date (default now-30d)", to: "ISO date (default now)", machineId: "optional int", nextToken: "continuation", pageSize: `≤${MAX_PAGE_SIZE}` },
    columns: ["day", "machine_id", "machine_code", "availability", "performance", "quality", "oee", "total_count", "good_count", "reject_count"],
  },
] as const;

export type BiDatasetName = (typeof BI_DATASETS)[number]["name"];

// ── Dataset queries (LIMIT pageSize+1 to detect more; offset continuation) ────

type Rows = Array<Record<string, unknown>>;

async function queryInspectionsDaily(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  offset: number,
  pageSize: number,
): Promise<Rows> {
  const { getDb } = await import("../../db/connection");
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../../utils/kpi");
  const db = await getDb();
  if (!db) return [];

  const machineFilterMv = machineId ? sql` AND machine_id = ${machineId}` : sql``;
  const machineFilterLive = machineId ? sql` AND pi."machineId" = ${machineId}` : sql``;

  // 1) MV-first (A7 read path) — only when the MV is FRESH (same rule as the
  //    dashboard: stale/absent → live query, never silently stale).
  try {
    const { getMvFreshness } = await import("../../functions/cachedStatistics");
    const freshness = await getMvFreshness();
    if (freshness) {
      const res = await db.execute(sql`
        SELECT
          TO_CHAR(bucket_hour, 'YYYY-MM-DD') AS day,
          machine_id,
          SUM(total)::int AS total,
          SUM(ok)::int    AS ok,
          SUM(ng)::int    AS ng,
          SUM(ntf)::int   AS ntf,
          ROUND(100.0 * SUM(ok + ntf) / NULLIF(SUM(total), 0), 2)::float AS yield_rate
        FROM hourly_yield_cache
        WHERE bucket_hour >= ${window.from} AND bucket_hour < ${window.to}${machineFilterMv}
        GROUP BY 1, 2
        ORDER BY 1, 2
        LIMIT ${pageSize + 1} OFFSET ${offset}
      `);
      return executeRows(res);
    }
  } catch (err) {
    console.warn("[BI] inspections_daily MV read failed — live fallback:", (err as Error)?.message ?? err);
  }

  // 2) Live query with factory-TZ day bucketing (0174 helpers).
  try {
    const res = await db.execute(sql`
      SELECT
        TO_CHAR(date_trunc('day', public.to_factory_time(pi."inspectionTime")), 'YYYY-MM-DD') AS day,
        pi."machineId" AS machine_id,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')::int  AS ok,
        COUNT(*) FILTER (WHERE pi."overallResult" = 'NG')::int  AS ng,
        COUNT(*) FILTER (WHERE pi."overallResult" = 'NTF')::int AS ntf,
        ROUND(100.0 * COUNT(*) FILTER (WHERE pi."overallResult" IN ('OK','NTF'))
          / NULLIF(COUNT(*), 0), 2)::float AS yield_rate
      FROM product_inspections pi
      WHERE pi."inspectionTime" >= ${window.from} AND pi."inspectionTime" < ${window.to}${machineFilterLive}
      GROUP BY 1, 2
      ORDER BY 1, 2
      LIMIT ${pageSize + 1} OFFSET ${offset}
    `);
    return executeRows(res);
  } catch (err) {
    console.warn("[BI] to_factory_time unavailable — naive day bucketing fallback:", (err as Error)?.message ?? err);
  }

  // 3) Last resort: naive date_trunc (pre-0174 DBs).
  const res = await db.execute(sql`
    SELECT
      TO_CHAR(date_trunc('day', pi."inspectionTime"), 'YYYY-MM-DD') AS day,
      pi."machineId" AS machine_id,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')::int  AS ok,
      COUNT(*) FILTER (WHERE pi."overallResult" = 'NG')::int  AS ng,
      COUNT(*) FILTER (WHERE pi."overallResult" = 'NTF')::int AS ntf,
      ROUND(100.0 * COUNT(*) FILTER (WHERE pi."overallResult" IN ('OK','NTF'))
        / NULLIF(COUNT(*), 0), 2)::float AS yield_rate
    FROM product_inspections pi
    WHERE pi."inspectionTime" >= ${window.from} AND pi."inspectionTime" < ${window.to}${machineFilterLive}
    GROUP BY 1, 2
    ORDER BY 1, 2
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `);
  const { executeRows: rows2 } = await import("../../utils/kpi");
  return rows2(res);
}

async function queryDefectPareto(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  offset: number,
  pageSize: number,
): Promise<Rows> {
  const { getDb } = await import("../../db/connection");
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../../utils/kpi");
  const db = await getDb();
  if (!db) return [];
  const machineFilter = machineId ? sql` AND pi."machineId" = ${machineId}` : sql``;
  const res = await db.execute(sql`
    WITH ng AS (
      SELECT COALESCE(dc.code, 'UNCLASSIFIED')  AS defect_code,
             COALESCE(dc.name, 'Unclassified')  AS defect_name,
             dc."nameVi"                        AS defect_name_vi,
             COUNT(*)::int                      AS count
      FROM measurement_results mr
      JOIN product_inspections pi ON pi.id = mr."inspectionId"
      LEFT JOIN defect_catalog dc ON dc.id = mr."defectCatalogId"
      WHERE mr.result = 'NG'
        AND pi."inspectionTime" >= ${window.from} AND pi."inspectionTime" < ${window.to}${machineFilter}
      GROUP BY 1, 2, 3
    )
    SELECT defect_code, defect_name, defect_name_vi, count,
           ROUND(100.0 * count / NULLIF(SUM(count) OVER (), 0), 2)::float AS pct
    FROM ng
    ORDER BY count DESC, defect_code
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `);
  return executeRows(res);
}

async function queryMachineOee(
  window: { from: Date; to: Date },
  machineId: number | undefined,
  offset: number,
  pageSize: number,
): Promise<Rows> {
  const { getDb } = await import("../../db/connection");
  const { sql } = await import("drizzle-orm");
  const { executeRows } = await import("../../utils/kpi");
  const db = await getDb();
  if (!db) return [];
  const machineFilter = machineId ? sql` AND "machineId" = ${machineId}` : sql``;
  // oee_metrics stores percentages ×100 (8550 = 85.50%) → /100 on the way out.
  const res = await db.execute(sql`
    SELECT
      TO_CHAR(date_trunc('day', "timestamp"), 'YYYY-MM-DD') AS day,
      "machineId"   AS machine_id,
      "machineCode" AS machine_code,
      ROUND(AVG(availability) / 100.0, 2)::float AS availability,
      ROUND(AVG(performance)  / 100.0, 2)::float AS performance,
      ROUND(AVG(quality)      / 100.0, 2)::float AS quality,
      ROUND(AVG(oee)          / 100.0, 2)::float AS oee,
      SUM("totalCount")::int  AS total_count,
      SUM("goodCount")::int   AS good_count,
      SUM("rejectCount")::int AS reject_count
    FROM oee_metrics
    WHERE "timestamp" >= ${window.from} AND "timestamp" < ${window.to}${machineFilter}
    GROUP BY 1, 2, 3
    ORDER BY 1, 2
    LIMIT ${pageSize + 1} OFFSET ${offset}
  `);
  return executeRows(res);
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createBiRouter(): Router {
  const r = Router();

  // GET /datasets — catalog (requires bi:read like the data itself).
  r.get("/datasets", requireScope(API_SCOPES.BI_READ), (_req: Request, res: Response) => {
    res.json({
      datasets: BI_DATASETS,
      paging: "Pass the returned nextToken back as ?nextToken= to fetch the next page. nextToken=null means done.",
      odata: "OData $filter/$select/$orderby are NOT supported — use from/to/machineId params.",
      docs: "docs/ECOSYSTEM/30_BI_EXPORT_API.md",
    });
  });

  // GET /datasets/:name — one page of rows + continuation token.
  r.get("/datasets/:name", requireScope(API_SCOPES.BI_READ), async (req: Request, res: Response) => {
    const name = req.params.name as BiDatasetName;
    if (!BI_DATASETS.some((d) => d.name === name)) {
      return res.status(404).json({ error: `Unknown dataset "${name}".`, available: BI_DATASETS.map((d) => d.name) });
    }
    const window = parseBiWindow(req);
    if (window.error) return res.status(400).json({ error: window.error });
    const { offset, pageSize } = pageParams(req);
    const machineIdRaw = Number(req.query.machineId);
    const machineId = Number.isInteger(machineIdRaw) && machineIdRaw > 0 ? machineIdRaw : undefined;

    try {
      let rows: Rows;
      if (name === "inspections_daily") rows = await queryInspectionsDaily(window, machineId, offset, pageSize);
      else if (name === "defect_pareto") rows = await queryDefectPareto(window, machineId, offset, pageSize);
      else rows = await queryMachineOee(window, machineId, offset, pageSize);

      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      res.setHeader("Cache-Control", "no-store");
      res.json({
        dataset: name,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        count: page.length,
        rows: page,
        nextToken: hasMore ? encodeNextToken(offset + pageSize) : null,
      });
    } catch (err) {
      console.error(`[BI] dataset ${name} failed:`, (err as Error)?.message ?? err);
      res.status(500).json({ error: "Dataset query failed." });
    }
  });

  // Unknown /api/bi path → structured 404.
  r.use((_req, res) =>
    res.status(404).json({ error: "Unknown /api/bi endpoint.", available: ["/api/bi/datasets", "/api/bi/datasets/:name"] }),
  );

  return r;
}
