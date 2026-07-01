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
import type { Site, SiteDetailRow, SiteAlertRollup, SiteAlertEntry } from "../../../drizzle/schema";

/** Top-N defect pareto entry as landed into site_kpi_rollup.defectPareto. */
export interface ParetoEntry {
  pointCode: string;
  pointName: string;
  ngCount: number;
  pct: number;
}

/**
 * U5 — per-category metric bags carried alongside the inspection KPIs. Each is
 * honest-null when the site does not (yet) expose that feed. These land as
 * per-category roll-up rows (fleet/safety/pdm) + on the "overall" snapshot.metrics.
 */
export interface FleetMetrics {
  tasksPending: number | null;
  tasksRunning: number | null;
  robotsOnline: number | null;
  robotsTotal: number | null;
}
export interface SafetyMetrics {
  openEvents: number | null;
  nearMisses: number | null;
  critical: number | null;
}
export interface PdmMetrics {
  openPredictiveWos: number | null;
  highRiskMachines: number | null;
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
  oee: number | null; // real when the site exposes OEE; honest null otherwise
  avgCycleTime: number | null; // seconds
  defectPareto: ParetoEntry[] | null;
  // ── U5 (doc 21 §6 / G-7): retained detail + generalized categories + alerts ──
  detailRows: SiteDetailRow[] | null; // per-machine/station rows (was DISCARDED)
  fleet: FleetMetrics | null; // honest null if the site has no fleet feed
  safety: SafetyMetrics | null; // honest null if the site has no safety feed
  pdm: PdmMetrics | null; // honest null if the site has no PdM feed
  alertRollup: SiteAlertRollup | null; // compact cross-site alert summary
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
  // U5 — RETAIN the per-machine/station detail rows (previously computed-over-then-
  // discarded). These drive the site → factory/station → device drill; we keep the
  // raw shape normalized so the Command Center can assemble the tree.
  let detailRows: SiteDetailRow[] | null = null;
  if (Array.isArray(summary.details) && summary.details.length > 0) {
    let wSum = 0;
    let wTotal = 0;
    const rows: SiteDetailRow[] = [];
    for (const d of summary.details) {
      const ct = num(d.avgCycleTime);
      const w = num(d.totalInspections) ?? 0;
      if (ct != null && w > 0) {
        wSum += ct * w;
        wTotal += w;
      }
      rows.push({
        machineId: num(d.machineId),
        machineCode: String(d.machineCode ?? ""),
        machineName: String(d.machineName ?? ""),
        stationId: num(d.stationId),
        stationCode: String(d.stationCode ?? ""),
        stationName: String(d.stationName ?? ""),
        productModelId: num(d.productModelId),
        productCode: d.productCode ? String(d.productCode) : undefined,
        productName: d.productName ? String(d.productName) : undefined,
        totalInspections: num(d.totalInspections),
        okCount: num(d.okCount),
        ngCount: num(d.ngCount),
        ntfCount: num(d.ntfCount),
        yieldRate: num(d.yieldRate),
        avgCycleTime: ct,
      });
    }
    if (wTotal > 0) avgCycleTime = Number((wSum / wTotal).toFixed(2));
    detailRows = rows;
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

  // ── U5 best-effort: OEE + fleet + safety + PdM + alert roll-up ───────────────
  // Each is a self-isolated read against a NEW /api/external/* feed (see
  // externalInspectionApi). A site that predates these feeds (404) or errors leaves
  // the category HONEST-NULL — it is never fabricated with zeros, and never turns a
  // summary-OK poll into a failure.
  const oee = await fetchOptional(base, headers, timeoutMs, endpointsHit, `/api/external/oee/summary?${qs}`, (data) =>
    num(data?.oee),
  );
  const fleet = await fetchOptional<FleetMetrics>(base, headers, timeoutMs, endpointsHit, `/api/external/fleet/summary`, (data) => ({
    tasksPending: num(data?.tasksPending),
    tasksRunning: num(data?.tasksRunning),
    robotsOnline: num(data?.robotsOnline),
    robotsTotal: num(data?.robotsTotal),
  }));
  const safety = await fetchOptional<SafetyMetrics>(base, headers, timeoutMs, endpointsHit, `/api/external/safety/summary`, (data) => ({
    openEvents: num(data?.openEvents),
    nearMisses: num(data?.nearMisses),
    critical: num(data?.critical),
  }));
  const pdm = await fetchOptional<PdmMetrics>(base, headers, timeoutMs, endpointsHit, `/api/external/pdm/summary`, (data) => ({
    openPredictiveWos: num(data?.openPredictiveWos),
    highRiskMachines: num(data?.highRiskMachines),
  }));
  const alertRollup = await fetchOptional<SiteAlertRollup>(base, headers, timeoutMs, endpointsHit, `/api/external/alerts/summary`, (data) => ({
    open: num(data?.open) ?? 0,
    critical: num(data?.critical) ?? 0,
    nearMiss: num(data?.nearMiss),
    top: Array.isArray(data?.top)
      ? data.top.slice(0, 10).map((t: any): SiteAlertEntry => ({
          kind: String(t?.kind ?? "event"),
          severity: normalizeSeverity(t?.severity),
          count: num(t?.count) ?? 1,
          title: String(t?.title ?? t?.kind ?? "Alert"),
          at: t?.at ? String(t.at) : null,
        }))
      : [],
  }));

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
      oee, // real when the site's OEE feed answers; honest null otherwise
      avgCycleTime,
      defectPareto,
      detailRows,
      fleet,
      safety,
      pdm,
      alertRollup,
      endpointsHit,
    },
  };
}

type Severity = "info" | "low" | "medium" | "high" | "critical";
function normalizeSeverity(v: unknown): Severity {
  const s = String(v ?? "").toLowerCase();
  return s === "critical" || s === "high" || s === "medium" || s === "low" || s === "info" ? (s as Severity) : "medium";
}

/**
 * One self-isolated best-effort GET against an OPTIONAL /api/external/* feed. Any
 * non-2xx (incl. 404 from an older site), non-`success` body, or thrown error
 * (timeout/network) resolves to `null` — the category stays HONEST-NULL and the
 * caller's summary-OK poll is NOT downgraded. Records the base path in endpointsHit.
 */
async function fetchOptional<T>(
  base: string,
  headers: Record<string, string>,
  timeoutMs: number,
  endpointsHit: string[],
  path: string,
  map: (data: any) => T,
): Promise<T | null> {
  try {
    endpointsHit.push(path.split("?")[0]);
    const { httpStatus, body } = await getJson(`${base}${path}`, headers, timeoutMs);
    if (httpStatus < 200 || httpStatus >= 300) return null;
    if (!body || body.success === false || body.data == null) return null;
    return map(body.data);
  } catch {
    return null; // honest null — a missing/old feed never fails the poll
  }
}
