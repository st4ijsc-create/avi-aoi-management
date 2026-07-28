/**
 * Data Comparison Service
 * So sánh dữ liệu giữa các kỳ (week-over-week, month-over-month)
 */

import * as db from "../db";
import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";
// doc69 W1 "modelfix" — shared env→GGUF-basename resolver; the comparison narrative must PIN a text
// model (un-pinned calls used to land on the 0.6B RAG embedder → repetition garbage).
import { resolveLogicalModel } from "./ai/modelResolver";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ComparisonPeriod = "day" | "week" | "month" | "quarter" | "custom";

export interface ComparisonRequest {
  periodType: ComparisonPeriod;
  currentStart: Date;
  currentEnd: Date;
  previousStart?: Date;
  previousEnd?: Date;
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  machineId?: number;
}

export interface PeriodSummary {
  totalInspections: number;
  okCount: number;
  ngCount: number;
  ntfCount: number;
  yieldRate: number;
  ngRate: number;
}

export interface ComparisonResult {
  currentPeriod: { start: string; end: string; summary: PeriodSummary };
  previousPeriod: { start: string; end: string; summary: PeriodSummary };
  changes: {
    totalInspections: { value: number; percent: number; direction: "up" | "down" | "same" };
    okCount: { value: number; percent: number; direction: "up" | "down" | "same" };
    ngCount: { value: number; percent: number; direction: "up" | "down" | "same" };
    yieldRate: { value: number; direction: "up" | "down" | "same" };
    ngRate: { value: number; direction: "up" | "down" | "same" };
  };
  dailyBreakdown: Array<{
    date: string;
    current: { totalInspections: number; okCount: number; ngCount: number; yieldRate: number };
    previous: { totalInspections: number; okCount: number; ngCount: number; yieldRate: number } | null;
  }>;
  machineComparison: Array<{
    machineId: number;
    machineName: string;
    machineCode: string;
    current: PeriodSummary;
    previous: PeriodSummary;
    yieldChange: number;
  }>;
  topImprovedPoints: Array<{
    pointName: string;
    currentNG: number;
    previousNG: number;
    change: number;
    improvement: boolean;
  }>;
}

// ─── Period Calculation ──────────────────────────────────────────────────────

export function calculatePreviousPeriod(
  periodType: ComparisonPeriod,
  currentStart: Date,
  currentEnd: Date
): { start: Date; end: Date } {
  const durationMs = currentEnd.getTime() - currentStart.getTime();

  switch (periodType) {
    case "day": {
      const start = new Date(currentStart);
      start.setDate(start.getDate() - 1);
      const end = new Date(currentEnd);
      end.setDate(end.getDate() - 1);
      return { start, end };
    }
    case "week": {
      const start = new Date(currentStart);
      start.setDate(start.getDate() - 7);
      const end = new Date(currentEnd);
      end.setDate(end.getDate() - 7);
      return { start, end };
    }
    case "month": {
      const start = new Date(currentStart);
      start.setMonth(start.getMonth() - 1);
      const end = new Date(currentEnd);
      end.setMonth(end.getMonth() - 1);
      return { start, end };
    }
    case "quarter": {
      const start = new Date(currentStart);
      start.setMonth(start.getMonth() - 3);
      const end = new Date(currentEnd);
      end.setMonth(end.getMonth() - 3);
      return { start, end };
    }
    default: {
      // Custom: shift back by exact duration
      return {
        start: new Date(currentStart.getTime() - durationMs - 1),
        end: new Date(currentStart.getTime() - 1),
      };
    }
  }
}

// ─── Core Comparison Logic ──────────────────────────────────────────────────

function computeChange(current: number, previous: number): { value: number; percent: number; direction: "up" | "down" | "same" } {
  const diff = current - previous;
  const pct = previous > 0 ? (diff / previous) * 100 : current > 0 ? 100 : 0;
  return {
    value: Math.round(diff * 100) / 100,
    percent: Math.round(pct * 10) / 10,
    direction: diff > 0 ? "up" : diff < 0 ? "down" : "same",
  };
}

function computeRateChange(current: number, previous: number): { value: number; direction: "up" | "down" | "same" } {
  const diff = current - previous;
  return {
    value: Math.round(diff * 10) / 10,
    direction: diff > 0.05 ? "up" : diff < -0.05 ? "down" : "same",
  };
}

/**
 * Get period summary from DB via raw SQL
 */
async function getPeriodSummary(
  start: Date,
  end: Date,
  filters?: { factoryId?: number; workshopId?: number; lineId?: number; machineId?: number }
): Promise<PeriodSummary> {
  const conn = await getDb();
  if (!conn) return { totalInspections: 0, okCount: 0, ngCount: 0, ntfCount: 0, yieldRate: 0, ngRate: 0 };

  const startStr = start.toISOString();
  const endStr = end.toISOString();

  const query = sql`
    SELECT
      COUNT(*)::int as "totalInspections",
      SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END)::int as "okCount",
      SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END)::int as "ngCount",
      SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END)::int as "ntfCount"
    FROM product_inspections pi
    LEFT JOIN machines m ON pi."machineId" = m.id
    LEFT JOIN stations st ON m."stationId" = st.id
    LEFT JOIN production_lines l ON st."lineId" = l.id
    LEFT JOIN workshops w ON l."workshopId" = w.id
    WHERE pi."inspectionTime" >= ${startStr}
      AND pi."inspectionTime" <= ${endStr}
      ${filters?.factoryId ? sql`AND w."factoryId" = ${filters.factoryId}` : sql``}
      ${filters?.workshopId ? sql`AND l."workshopId" = ${filters.workshopId}` : sql``}
      ${filters?.lineId ? sql`AND st."lineId" = ${filters.lineId}` : sql``}
      ${filters?.machineId ? sql`AND pi."machineId" = ${filters.machineId}` : sql``}
  `;

  const result: any = await conn.execute(query);
  const rows = result.rows || result;
  const row = rows[0] || {};
  const total = Number(row.totalInspections) || 0;
  const ok = Number(row.okCount) || 0;
  const ng = Number(row.ngCount) || 0;
  const ntf = Number(row.ntfCount) || 0;

  return {
    totalInspections: total,
    okCount: ok,
    ngCount: ng,
    ntfCount: ntf,
    yieldRate: total > 0 ? Math.round((ok / total) * 1000) / 10 : 0,
    ngRate: total > 0 ? Math.round((ng / total) * 1000) / 10 : 0,
  };
}

/**
 * Daily breakdown comparison
 */
async function getDailyBreakdown(
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date,
  previousEnd: Date,
  filters?: { factoryId?: number; workshopId?: number; lineId?: number; machineId?: number }
): Promise<ComparisonResult["dailyBreakdown"]> {
  const conn = await getDb();
  if (!conn) return [];

  const buildQuery = (start: Date, end: Date) => sql`
    SELECT
      TO_CHAR(pi."inspectionTime", 'YYYY-MM-DD') as date,
      COUNT(*)::int as "totalInspections",
      SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END)::int as "okCount",
      SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END)::int as "ngCount",
      CASE WHEN COUNT(*) > 0 THEN
        ROUND(SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)
      ELSE 0 END as "yieldRate"
    FROM product_inspections pi
    LEFT JOIN machines m ON pi."machineId" = m.id
    LEFT JOIN stations st ON m."stationId" = st.id
    LEFT JOIN production_lines l ON st."lineId" = l.id
    LEFT JOIN workshops w ON l."workshopId" = w.id
    WHERE pi."inspectionTime" >= ${start.toISOString()}
      AND pi."inspectionTime" <= ${end.toISOString()}
      ${filters?.factoryId ? sql`AND w."factoryId" = ${filters.factoryId}` : sql``}
      ${filters?.workshopId ? sql`AND l."workshopId" = ${filters.workshopId}` : sql``}
      ${filters?.lineId ? sql`AND st."lineId" = ${filters.lineId}` : sql``}
      ${filters?.machineId ? sql`AND pi."machineId" = ${filters.machineId}` : sql``}
    GROUP BY TO_CHAR(pi."inspectionTime", 'YYYY-MM-DD')
    ORDER BY date ASC
  `;

  const [currentResult, previousResult] = await Promise.all([
    conn.execute(buildQuery(currentStart, currentEnd)),
    conn.execute(buildQuery(previousStart, previousEnd)),
  ]);

  const currentRows = ((currentResult as any).rows || currentResult) as any[];
  const previousRows = ((previousResult as any).rows || previousResult) as any[];

  // Create a map for previous data by relative day index
  const prevMap = new Map<number, any>();
  previousRows.forEach((row: any, idx: number) => {
    prevMap.set(idx, row);
  });

  return currentRows.map((row: any, idx: number) => {
    const prev = prevMap.get(idx);
    return {
      date: row.date,
      current: {
        totalInspections: Number(row.totalInspections),
        okCount: Number(row.okCount),
        ngCount: Number(row.ngCount),
        yieldRate: Number(row.yieldRate),
      },
      previous: prev
        ? {
            totalInspections: Number(prev.totalInspections),
            okCount: Number(prev.okCount),
            ngCount: Number(prev.ngCount),
            yieldRate: Number(prev.yieldRate),
          }
        : null,
    };
  });
}

/**
 * Machine-level comparison between two periods
 */
async function getMachineComparison(
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date,
  previousEnd: Date,
  filters?: { factoryId?: number; workshopId?: number; lineId?: number }
): Promise<ComparisonResult["machineComparison"]> {
  const conn = await getDb();
  if (!conn) return [];

  const buildQuery = (start: Date, end: Date) => sql`
    SELECT
      m.id as "machineId",
      m.name as "machineName",
      m.code as "machineCode",
      COUNT(*)::int as "totalInspections",
      SUM(CASE WHEN pi."overallResult" = 'OK' THEN 1 ELSE 0 END)::int as "okCount",
      SUM(CASE WHEN pi."overallResult" = 'NG' THEN 1 ELSE 0 END)::int as "ngCount",
      SUM(CASE WHEN pi."overallResult" = 'NTF' THEN 1 ELSE 0 END)::int as "ntfCount"
    FROM product_inspections pi
    INNER JOIN machines m ON pi."machineId" = m.id
    LEFT JOIN stations st ON m."stationId" = st.id
    LEFT JOIN production_lines l ON st."lineId" = l.id
    LEFT JOIN workshops w ON l."workshopId" = w.id
    WHERE pi."inspectionTime" >= ${start.toISOString()}
      AND pi."inspectionTime" <= ${end.toISOString()}
      ${filters?.factoryId ? sql`AND w."factoryId" = ${filters.factoryId}` : sql``}
      ${filters?.workshopId ? sql`AND l."workshopId" = ${filters.workshopId}` : sql``}
      ${filters?.lineId ? sql`AND st."lineId" = ${filters.lineId}` : sql``}
    GROUP BY m.id, m.name, m.code
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `;

  const [currentResult, previousResult] = await Promise.all([
    conn.execute(buildQuery(currentStart, currentEnd)),
    conn.execute(buildQuery(previousStart, previousEnd)),
  ]);

  const currentRows = ((currentResult as any).rows || currentResult) as any[];
  const previousRows = ((previousResult as any).rows || previousResult) as any[];

  const prevMap = new Map<number, any>();
  previousRows.forEach((row: any) => prevMap.set(Number(row.machineId), row));

  return currentRows.map((row: any) => {
    const machineId = Number(row.machineId);
    const prev = prevMap.get(machineId);

    const currentTotal = Number(row.totalInspections);
    const currentOk = Number(row.okCount);
    const currentNg = Number(row.ngCount);
    const currentNtf = Number(row.ntfCount) || 0;
    const currentYield = currentTotal > 0 ? Math.round((currentOk / currentTotal) * 1000) / 10 : 0;
    const currentNgRate = currentTotal > 0 ? Math.round((currentNg / currentTotal) * 1000) / 10 : 0;

    const prevTotal = prev ? Number(prev.totalInspections) : 0;
    const prevOk = prev ? Number(prev.okCount) : 0;
    const prevNg = prev ? Number(prev.ngCount) : 0;
    const prevNtf = prev ? Number(prev.ntfCount) || 0 : 0;
    const prevYield = prevTotal > 0 ? Math.round((prevOk / prevTotal) * 1000) / 10 : 0;
    const prevNgRate = prevTotal > 0 ? Math.round((prevNg / prevTotal) * 1000) / 10 : 0;

    return {
      machineId,
      machineName: row.machineName,
      machineCode: row.machineCode,
      current: { totalInspections: currentTotal, okCount: currentOk, ngCount: currentNg, ntfCount: currentNtf, yieldRate: currentYield, ngRate: currentNgRate },
      previous: { totalInspections: prevTotal, okCount: prevOk, ngCount: prevNg, ntfCount: prevNtf, yieldRate: prevYield, ngRate: prevNgRate },
      yieldChange: Math.round((currentYield - prevYield) * 10) / 10,
    };
  });
}

/**
 * Top improved / declined measurement points
 */
async function getTopChangedPoints(
  currentStart: Date,
  currentEnd: Date,
  previousStart: Date,
  previousEnd: Date,
  filters?: { factoryId?: number; workshopId?: number; lineId?: number }
): Promise<ComparisonResult["topImprovedPoints"]> {
  const conn = await getDb();
  if (!conn) return [];

  const buildQuery = (start: Date, end: Date) => sql`
    SELECT
      mpd.name as "pointName",
      SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END)::int as "ngCount"
    FROM measurement_results mr
    INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
    LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
    LEFT JOIN machines m ON pi."machineId" = m.id
    LEFT JOIN stations st ON m."stationId" = st.id
    LEFT JOIN production_lines l ON st."lineId" = l.id
    LEFT JOIN workshops w ON l."workshopId" = w.id
    WHERE pi."inspectionTime" >= ${start.toISOString()}
      AND pi."inspectionTime" <= ${end.toISOString()}
      ${filters?.factoryId ? sql`AND w."factoryId" = ${filters.factoryId}` : sql``}
      ${filters?.workshopId ? sql`AND l."workshopId" = ${filters.workshopId}` : sql``}
      ${filters?.lineId ? sql`AND st."lineId" = ${filters.lineId}` : sql``}
    GROUP BY mpd.name
    HAVING SUM(CASE WHEN mr.result = 'NG' THEN 1 ELSE 0 END) > 0
    ORDER BY "ngCount" DESC
    LIMIT 20
  `;

  const [currentResult, previousResult] = await Promise.all([
    conn.execute(buildQuery(currentStart, currentEnd)),
    conn.execute(buildQuery(previousStart, previousEnd)),
  ]);

  const currentRows = ((currentResult as any).rows || currentResult) as any[];
  const previousRows = ((previousResult as any).rows || previousResult) as any[];

  const prevMap = new Map<string, number>();
  previousRows.forEach((row: any) => prevMap.set(row.pointName, Number(row.ngCount)));

  // Combine all points
  const allPoints = new Map<string, { currentNG: number; previousNG: number }>();
  currentRows.forEach((row: any) => {
    allPoints.set(row.pointName, {
      currentNG: Number(row.ngCount),
      previousNG: prevMap.get(row.pointName) || 0,
    });
  });
  previousRows.forEach((row: any) => {
    if (!allPoints.has(row.pointName)) {
      allPoints.set(row.pointName, {
        currentNG: 0,
        previousNG: Number(row.ngCount),
      });
    }
  });

  const result = Array.from(allPoints.entries())
    .map(([pointName, data]) => ({
      pointName,
      currentNG: data.currentNG,
      previousNG: data.previousNG,
      change: data.currentNG - data.previousNG,
      improvement: data.currentNG < data.previousNG,
    }))
    .sort((a, b) => a.change - b.change); // Most improved first

  return result.slice(0, 15);
}

// ─── Main Comparison Function ───────────────────────────────────────────────

export async function generateComparison(request: ComparisonRequest): Promise<ComparisonResult> {
  const { periodType, currentStart, currentEnd } = request;

  // Calculate previous period if not specified
  const previous = request.previousStart && request.previousEnd
    ? { start: request.previousStart, end: request.previousEnd }
    : calculatePreviousPeriod(periodType, currentStart, currentEnd);

  const filters = {
    factoryId: request.factoryId,
    workshopId: request.workshopId,
    lineId: request.lineId,
    machineId: request.machineId,
  };

  // Run all queries in parallel for performance
  const [currentSummary, previousSummary, dailyBreakdown, machineComparison, topChangedPoints] =
    await Promise.all([
      getPeriodSummary(currentStart, currentEnd, filters),
      getPeriodSummary(previous.start, previous.end, filters),
      getDailyBreakdown(currentStart, currentEnd, previous.start, previous.end, filters),
      getMachineComparison(currentStart, currentEnd, previous.start, previous.end, filters),
      getTopChangedPoints(currentStart, currentEnd, previous.start, previous.end, filters),
    ]);

  return {
    currentPeriod: {
      start: currentStart.toISOString(),
      end: currentEnd.toISOString(),
      summary: currentSummary,
    },
    previousPeriod: {
      start: previous.start.toISOString(),
      end: previous.end.toISOString(),
      summary: previousSummary,
    },
    changes: {
      totalInspections: computeChange(currentSummary.totalInspections, previousSummary.totalInspections),
      okCount: computeChange(currentSummary.okCount, previousSummary.okCount),
      ngCount: computeChange(currentSummary.ngCount, previousSummary.ngCount),
      yieldRate: computeRateChange(currentSummary.yieldRate, previousSummary.yieldRate),
      ngRate: computeRateChange(currentSummary.ngRate, previousSummary.ngRate),
    },
    dailyBreakdown,
    machineComparison,
    topImprovedPoints: topChangedPoints,
  };
}

// ─── AI Comparison Narrative ────────────────────────────────────────────────

/**
 * Generate AI narrative for comparison results.
 * Explains numeric deltas and infers likely root causes.
 * Non-blocking — returns null on failure.
 */
async function narrateComparison(result: ComparisonResult): Promise<string | null> {
  try {
    const { generateText } = await import('./aiGgufEngine');

    const summary = {
      period: `${result.currentPeriod.start.slice(0, 10)} vs ${result.previousPeriod.start.slice(0, 10)}`,
      yieldChange: result.changes.yieldRate,
      ngChange: result.changes.ngCount,
      volumeChange: result.changes.totalInspections,
      topMachineChanges: result.machineComparison
        .sort((a, b) => Math.abs(b.yieldChange) - Math.abs(a.yieldChange))
        .slice(0, 5)
        .map(m => `${m.machineName}: yield ${m.yieldChange > 0 ? '+' : ''}${m.yieldChange.toFixed(1)}%`),
      topImproved: result.topImprovedPoints
        .filter(p => p.improvement)
        .slice(0, 3)
        .map(p => `${p.pointName}: ${p.previousNG}→${p.currentNG}`),
      topDeclined: result.topImprovedPoints
        .filter(p => !p.improvement && p.change > 0)
        .slice(0, 3)
        .map(p => `${p.pointName}: ${p.previousNG}→${p.currentNG}`),
    };

    const response = await generateText({
      systemPrompt: `You are a manufacturing data analyst. Given period-over-period comparison data, provide a concise narrative (3-5 sentences) explaining what changed, which machines/defects drove the change, and suggest likely root causes.`,
      prompt: `Comparison: ${JSON.stringify(summary)}`,
      maxTokens: 300,
      temperature: 0.5,
    }, resolveLogicalModel("chat"));

    return response.text?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Generate comparison with AI narrative explanation
 */
export async function generateComparisonWithNarration(
  request: ComparisonRequest,
): Promise<ComparisonResult & { narration: string | null }> {
  const result = await generateComparison(request);
  const narration = await narrateComparison(result);
  return { ...result, narration };
}
