/**
 * Pareto Analysis Service
 * Phân tích 80/20 defects theo loại/máy/dây chuyền/thời gian
 */

import { getDb } from "../db/connection";
import { sql } from "drizzle-orm";

export interface ParetoItem {
  category: string;
  categoryId?: number;
  count: number;
  percentage: number;
  cumulativeCount: number;
  cumulativePercentage: number;
}

export interface ParetoAnalysisResult {
  items: ParetoItem[];
  totalDefects: number;
  pareto80Count: number;       // Items contributing to 80%
  pareto80Categories: string[];
  analysisType: string;
  dateRange: { start: Date; end: Date };
}

/**
 * Pareto by defect type (measurement point)
 */
export async function paretoByDefectType(params: {
  startDate: Date;
  endDate: Date;
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  machineId?: number;
  limit?: number;
}): Promise<ParetoAnalysisResult> {
  const { startDate, endDate, factoryId, workshopId, lineId, machineId } = params;
  const limit = Number(params.limit) || 50;

  let whereClause = `WHERE pi."overallResult" = 'NG' AND pi."inspectionTime" BETWEEN '${startDate.toISOString()}' AND '${endDate.toISOString()}'`;
  if (factoryId) whereClause += ` AND w."factoryId" = ${factoryId}`;
  if (workshopId) whereClause += ` AND pl."workshopId" = ${workshopId}`;
  if (lineId) whereClause += ` AND st."lineId" = ${lineId}`;
  if (machineId) whereClause += ` AND pi."machineId" = ${machineId}`;

  const conn = await getDb();
  const result = await conn!.execute(sql.raw(`
    SELECT 
      COALESCE(mpd."name", 'Unknown') as category,
      mpd."id" as "categoryId",
      COUNT(*) as count
    FROM measurement_results mr
    JOIN product_inspections pi ON mr."inspectionId" = pi."id"
    LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd."id"
    LEFT JOIN machines m ON pi."machineId" = m."id"
    LEFT JOIN stations st ON m."stationId" = st."id"
    LEFT JOIN production_lines pl ON st."lineId" = pl."id"
    LEFT JOIN workshops w ON pl."workshopId" = w."id"
    ${whereClause}
      AND mr."result" = 'NG'
    GROUP BY COALESCE(mpd."name", 'Unknown'), mpd."id"
    ORDER BY count DESC
    LIMIT ${limit}
  `));

  return buildParetoResult(result.rows as any[], "defect_type", startDate, endDate);
}

/**
 * Pareto by machine
 */
export async function paretoByMachine(params: {
  startDate: Date;
  endDate: Date;
  factoryId?: number;
  workshopId?: number;
  lineId?: number;
  limit?: number;
}): Promise<ParetoAnalysisResult> {
  const { startDate, endDate, factoryId, workshopId, lineId } = params;
  const limit = Number(params.limit) || 50;

  let whereClause = `WHERE pi."overallResult" = 'NG' AND pi."inspectionTime" BETWEEN '${startDate.toISOString()}' AND '${endDate.toISOString()}'`;
  if (factoryId) whereClause += ` AND w."factoryId" = ${factoryId}`;
  if (workshopId) whereClause += ` AND pl."workshopId" = ${workshopId}`;
  if (lineId) whereClause += ` AND st."lineId" = ${lineId}`;

  const conn = await getDb();
  const result = await conn!.execute(sql.raw(`
    SELECT 
      COALESCE(m."name", m."code", 'Unknown') as category,
      pi."machineId" as "categoryId",
      COUNT(*) as count
    FROM product_inspections pi
    LEFT JOIN machines m ON pi."machineId" = m."id"
    LEFT JOIN stations st ON m."stationId" = st."id"
    LEFT JOIN production_lines pl ON st."lineId" = pl."id"
    LEFT JOIN workshops w ON pl."workshopId" = w."id"
    ${whereClause}
    GROUP BY COALESCE(m."name", m."code", 'Unknown'), pi."machineId"
    ORDER BY count DESC
    LIMIT ${limit}
  `));

  return buildParetoResult(result.rows as any[], "machine", startDate, endDate);
}

/**
 * Pareto by production line
 */
export async function paretoByLine(params: {
  startDate: Date;
  endDate: Date;
  factoryId?: number;
  workshopId?: number;
  limit?: number;
}): Promise<ParetoAnalysisResult> {
  const { startDate, endDate, factoryId, workshopId } = params;
  const limit = Number(params.limit) || 50;

  let whereClause = `WHERE pi."overallResult" = 'NG' AND pi."inspectionTime" BETWEEN '${startDate.toISOString()}' AND '${endDate.toISOString()}'`;
  if (factoryId) whereClause += ` AND w."factoryId" = ${factoryId}`;
  if (workshopId) whereClause += ` AND pl."workshopId" = ${workshopId}`;

  const conn = await getDb();
  const result = await conn!.execute(sql.raw(`
    SELECT 
      COALESCE(pl."name", 'Line ' || pl."id", 'Unknown') as category,
      pl."id" as "categoryId",
      COUNT(*) as count
    FROM product_inspections pi
    LEFT JOIN machines m ON pi."machineId" = m."id"
    LEFT JOIN stations st ON m."stationId" = st."id"
    LEFT JOIN production_lines pl ON st."lineId" = pl."id"
    LEFT JOIN workshops w ON pl."workshopId" = w."id"
    ${whereClause}
    GROUP BY COALESCE(pl."name", 'Line ' || pl."id", 'Unknown'), pl."id"
    ORDER BY count DESC
    LIMIT ${limit}
  `));

  return buildParetoResult(result.rows as any[], "line", startDate, endDate);
}

/**
 * Pareto by time period (hour/shift/day)
 */
export async function paretoByTimePeriod(params: {
  startDate: Date;
  endDate: Date;
  groupBy: "hour" | "shift" | "day" | "week";
  factoryId?: number;
  machineId?: number;
  limit?: number;
}): Promise<ParetoAnalysisResult> {
  const { startDate, endDate, groupBy, factoryId, machineId } = params;
  const limit = Number(params.limit) || 50;

  let whereClause = `WHERE pi."overallResult" = 'NG' AND pi."inspectionTime" BETWEEN '${startDate.toISOString()}' AND '${endDate.toISOString()}'`;
  if (factoryId) whereClause += ` AND w."factoryId" = ${factoryId}`;
  if (machineId) whereClause += ` AND pi."machineId" = ${machineId}`;

  let timeExpr: string;
  switch (groupBy) {
    case "hour":
      timeExpr = `TO_CHAR(pi."inspectionTime", 'HH24:00')`;
      break;
    case "shift":
      timeExpr = `CASE 
        WHEN EXTRACT(HOUR FROM pi."inspectionTime") BETWEEN 6 AND 13 THEN 'Ca 1 (06:00-14:00)'
        WHEN EXTRACT(HOUR FROM pi."inspectionTime") BETWEEN 14 AND 21 THEN 'Ca 2 (14:00-22:00)'
        ELSE 'Ca 3 (22:00-06:00)'
      END`;
      break;
    case "week":
      timeExpr = `'Tuần ' || EXTRACT(WEEK FROM pi."inspectionTime")::text`;
      break;
    default:
      timeExpr = `TO_CHAR(pi."inspectionTime", 'YYYY-MM-DD')`;
  }

  const conn = await getDb();
  const result = await conn!.execute(sql.raw(`
    SELECT 
      ${timeExpr} as category,
      COUNT(*) as count
    FROM product_inspections pi
    LEFT JOIN machines m ON pi."machineId" = m."id"
    LEFT JOIN stations st ON m."stationId" = st."id"
    LEFT JOIN production_lines pl ON st."lineId" = pl."id"
    LEFT JOIN workshops w ON pl."workshopId" = w."id"
    ${whereClause}
    GROUP BY ${timeExpr}
    ORDER BY count DESC
    LIMIT ${limit}
  `));

  return buildParetoResult(result.rows as any[], `time_${groupBy}`, startDate, endDate);
}

/**
 * Build Pareto result with cumulative calculations
 */
function buildParetoResult(
  rows: Array<{ category: string; categoryId?: number; count: string | number }>,
  analysisType: string,
  startDate: Date,
  endDate: Date,
): ParetoAnalysisResult {
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return {
      items: [],
      totalDefects: 0,
      pareto80Count: 0,
      pareto80Categories: [],
      analysisType,
      dateRange: { start: startDate, end: endDate },
    };
  }
  
  const totalDefects = rows.reduce((sum, r) => sum + Number(r.count), 0);
  
  let cumulativeCount = 0;
  const items: ParetoItem[] = rows.map((row) => {
    const count = Number(row.count);
    cumulativeCount += count;
    return {
      category: row.category,
      categoryId: row.categoryId ? Number(row.categoryId) : undefined,
      count,
      percentage: totalDefects > 0 ? (count / totalDefects) * 100 : 0,
      cumulativeCount,
      cumulativePercentage: totalDefects > 0 ? (cumulativeCount / totalDefects) * 100 : 0,
    };
  });

  // Find 80% threshold
  const pareto80Items = items.filter(i => i.cumulativePercentage <= 80);
  // Include the item that crosses 80%
  if (pareto80Items.length < items.length) {
    const nextItem = items[pareto80Items.length];
    if (nextItem) pareto80Items.push(nextItem);
  }

  return {
    items,
    totalDefects,
    pareto80Count: pareto80Items.length,
    pareto80Categories: pareto80Items.map(i => i.category),
    analysisType,
    dateRange: { start: startDate, end: endDate },
  };
}

// ─── AI Recommendation Layer ───────────────────────────────────────────

export interface ParetoRecommendation {
  category: string;
  action: string;
  estimatedImpact: string;
  priority: number;
}

export interface ParetoAnalysisWithRecommendations extends ParetoAnalysisResult {
  recommendations: ParetoRecommendation[] | null;
}

/**
 * Generate AI-powered improvement recommendations from Pareto results.
 * Non-blocking — returns null on any failure.
 */
async function generateParetoRecommendations(
  result: ParetoAnalysisResult,
): Promise<ParetoRecommendation[] | null> {
  if (result.items.length === 0) return null;

  try {
    const { generateText } = await import("./aiGgufEngine");

    const top10 = result.items.slice(0, 10);
    const paretoSummary = top10.map((item, i) =>
      `${i + 1}. ${item.category}: ${item.count} defects (${item.percentage.toFixed(1)}%, cumulative ${item.cumulativePercentage.toFixed(1)}%)`
    ).join("\n");

    const response = await generateText({
      systemPrompt: `You are a manufacturing quality improvement expert specializing in AOI/AVI defect reduction.
Given Pareto analysis results, generate specific, actionable recommendations for the top contributors.
Focus on practical factory-floor actions with estimated impact.
Reply in JSON: { "recommendations": [{ "category": string, "action": string, "estimatedImpact": string, "priority": number (1=highest) }] }`,
      prompt: `Pareto Analysis (${result.analysisType}) — Total: ${result.totalDefects} defects
80% threshold: ${result.pareto80Count} categories (${result.pareto80Categories.join(", ")})
Period: ${result.dateRange.start.toISOString().slice(0, 10)} to ${result.dateRange.end.toISOString().slice(0, 10)}

Top contributors:
${paretoSummary}

Generate improvement recommendations for the categories contributing to 80% of defects. Include estimated recovery if addressed.`,
      maxTokens: 512,
      temperature: 0.3,
      jsonMode: true,
    });

    const parsed = JSON.parse(response.text);
    if (Array.isArray(parsed.recommendations)) {
      return parsed.recommendations;
    }
    // Try regex fallback for array extraction
    const match = response.text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return null;
  } catch {
    return null;
  }
}

/**
 * Pareto by defect type with AI recommendations
 */
export async function paretoByDefectTypeWithRecommendations(
  params: Parameters<typeof paretoByDefectType>[0],
): Promise<ParetoAnalysisWithRecommendations> {
  const result = await paretoByDefectType(params);
  const recommendations = await generateParetoRecommendations(result);
  return { ...result, recommendations };
}

/**
 * Pareto by machine with AI recommendations
 */
export async function paretoByMachineWithRecommendations(
  params: Parameters<typeof paretoByMachine>[0],
): Promise<ParetoAnalysisWithRecommendations> {
  const result = await paretoByMachine(params);
  const recommendations = await generateParetoRecommendations(result);
  return { ...result, recommendations };
}

/**
 * Pareto by line with AI recommendations
 */
export async function paretoByLineWithRecommendations(
  params: Parameters<typeof paretoByLine>[0],
): Promise<ParetoAnalysisWithRecommendations> {
  const result = await paretoByLine(params);
  const recommendations = await generateParetoRecommendations(result);
  return { ...result, recommendations };
}

/**
 * Pareto by time period with AI recommendations
 */
export async function paretoByTimePeriodWithRecommendations(
  params: Parameters<typeof paretoByTimePeriod>[0],
): Promise<ParetoAnalysisWithRecommendations> {
  const result = await paretoByTimePeriod(params);
  const recommendations = await generateParetoRecommendations(result);
  return { ...result, recommendations };
}
