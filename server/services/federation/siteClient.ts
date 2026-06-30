/**
 * Federation site client (doc 13 §4) — READ-ONLY HTTP to a site's /api/external/*.
 *
 * This module is the ONLY place the core talks to a site, and it issues GETs
 * exclusively. There is no code path here that writes to, commands, or mutates a
 * site — the federation thesis ("core never writes to a site") is enforced at
 * this boundary. Each call carries the site's env-resolved per-site read token
 * (never a DB-stored secret) and a hard AbortController timeout so one slow site
 * cannot stall the aggregator cycle.
 */
import { ENV } from "../../_core/env";
import { resolveSiteToken, siteTokenEnvVar } from "./secretStore";
import type { Site } from "../../../drizzle/schema";

/** Top-N defect pareto entry as landed into site_kpi_rollup.defectPareto. */
export interface ParetoEntry {
  pointCode: string;
  pointName: string;
  ngCount: number;
  pct: number;
}

/** Normalized KPI snapshot pulled from a site for the current window. */
export interface SiteKpiSnapshot {
  asOf: Date; // the window the KPIs describe (end of window / fetch instant)
  windowStart: Date;
  windowEnd: Date;
  totalInspections: number | null;
  okCount: number | null;
  ngCount: number | null;
  ntfCount: number | null;
  yieldRate: number | null; // %
  ngRate: number | null; // %
  throughput: number | null; // units = totalInspections in window
  oee: number | null; // null until a site exposes OEE
  avgCycleTime: number | null; // seconds
  defectPareto: ParetoEntry[] | null;
  endpointsHit: string[];
}

export interface FetchResult {
  ok: boolean;
  httpStatus?: number;
  error?: string;
  snapshot?: SiteKpiSnapshot;
  endpointsHit: string[];
}

function normalizeBaseUrl(u: string): string {
  return u.trim().replace(/\/+$/, "");
}

function authHeaders(site: Site, token: string): Record<string, string> {
  return site.authType === "bearer"
    ? { Authorization: `Bearer ${token}` }
    : { "x-master-key": token };
}

/** One read-only GET with a hard timeout. Returns parsed JSON or throws. */
async function getJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ httpStatus: number; body: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: "GET", headers, signal: controller.signal });
    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      /* non-JSON body tolerated; caller checks resp.ok */
    }
    return { httpStatus: resp.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull the KPI snapshot for a site over a [windowStart, windowEnd] window using
 * the existing read-only feed:
 *   • /api/external/inspections/summary       → yield/OK/NG/NTF/throughput/cycle
 *   • /api/external/inspections/defect-pareto  → top-N defects (best-effort)
 *
 * The summary call is REQUIRED for a usable snapshot; the pareto call is
 * best-effort (its failure degrades to defectPareto=null, not a hard failure —
 * "honest partial"). Never throws for a site-level error; returns FetchResult.
 */
export async function fetchSiteKpis(
  site: Site,
  windowStart: Date,
  windowEnd: Date,
): Promise<FetchResult> {
  const endpointsHit: string[] = [];
  const token = resolveSiteToken(site.code, { isLocal: site.isLocal });
  if (!token) {
    return {
      ok: false,
      error: `No read token configured (set env ${siteTokenEnvVar(site.code)})`,
      endpointsHit,
    };
  }

  const base = normalizeBaseUrl(site.baseUrl);
  const headers = authHeaders(site, token);
  const timeoutMs = ENV.federationFetchTimeoutMs;
  const qs = `startDate=${encodeURIComponent(windowStart.toISOString())}&endDate=${encodeURIComponent(windowEnd.toISOString())}`;

  // ── Required: summary ──────────────────────────────────────────────────────
  let summary: any;
  try {
    const path = `/api/external/inspections/summary?${qs}`;
    endpointsHit.push(path.split("?")[0]);
    const { httpStatus, body } = await getJson(`${base}${path}`, headers, timeoutMs);
    if (httpStatus < 200 || httpStatus >= 300) {
      return { ok: false, httpStatus, error: `summary HTTP ${httpStatus}`, endpointsHit };
    }
    if (!body || body.success === false || !body.data) {
      return { ok: false, httpStatus, error: body?.message || "summary returned no data", endpointsHit };
    }
    summary = body.data;
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? `summary timed out after ${timeoutMs}ms` : e?.message || "summary fetch failed";
    return { ok: false, error: msg, endpointsHit };
  }

  const totals = summary.totals ?? {};
  const totalInspections = num(totals.totalInspections);
  const okCount = num(totals.okCount);
  const ngCount = num(totals.ngCount);
  const ntfCount = num(totals.ntfCount);
  const yieldRate = num(totals.yieldRate);
  const ngRate =
    totalInspections && totalInspections > 0 && ngCount != null
      ? Number(((ngCount / totalInspections) * 100).toFixed(2))
      : null;
  // avg cycle time across detail rows (units-weighted) — best effort, may be absent.
  let avgCycleTime: number | null = null;
  if (Array.isArray(summary.details) && summary.details.length > 0) {
    let wSum = 0;
    let wTotal = 0;
    for (const d of summary.details) {
      const ct = num(d.avgCycleTime);
      const w = num(d.totalInspections) ?? 0;
      if (ct != null && w > 0) {
        wSum += ct * w;
        wTotal += w;
      }
    }
    if (wTotal > 0) avgCycleTime = Number((wSum / wTotal).toFixed(2));
  }

  // ── Best-effort: defect pareto ─────────────────────────────────────────────
  let defectPareto: ParetoEntry[] | null = null;
  try {
    const path = `/api/external/inspections/defect-pareto?${qs}&limit=10`;
    endpointsHit.push(path.split("?")[0]);
    const { httpStatus, body } = await getJson(`${base}${path}`, headers, timeoutMs);
    if (httpStatus >= 200 && httpStatus < 300 && body?.success !== false && Array.isArray(body?.data?.items)) {
      defectPareto = body.data.items.slice(0, 10).map((i: any) => ({
        pointCode: String(i.pointCode ?? ""),
        pointName: String(i.pointName ?? ""),
        ngCount: num(i.ngCount) ?? 0,
        pct: num(i.percentage) ?? 0,
      }));
    }
  } catch {
    /* pareto is optional — honest partial: leave defectPareto=null */
  }

  return {
    ok: true,
    httpStatus: 200,
    endpointsHit,
    snapshot: {
      asOf: windowEnd,
      windowStart,
      windowEnd,
      totalInspections,
      okCount,
      ngCount,
      ntfCount,
      yieldRate,
      ngRate,
      throughput: totalInspections,
      oee: null, // no OEE endpoint in the site feed yet (honest: null, not 0)
      avgCycleTime,
      defectPareto,
      endpointsHit,
    },
  };
}
