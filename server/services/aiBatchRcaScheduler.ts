/**
 * AI Batch RCA Scheduler — S3.4
 *
 * Runs daily at a configurable time (default 02:00 Asia/Ho_Chi_Minh) to
 * generate root-cause analysis for every machine with NG inspections in the
 * past 24 hours. Results are persisted into `root_cause_analysis`.
 *
 * The narrative + insight calls go through aiProviderRouter (with cache), so
 * repeated runs over identical defect distributions reuse the same LLM output.
 */

import * as cron from "node-cron";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { generateRCAInsights } from "./aiInsightsService";

const DEFAULT_CRON = process.env.AI_BATCH_RCA_CRON || "0 2 * * *"; // 02:00 daily
const TIMEZONE = process.env.AI_BATCH_RCA_TZ || "Asia/Ho_Chi_Minh";
const SYSTEM_USER_ID = Number(process.env.AI_BATCH_RCA_USER_ID || "1");
const MAX_MACHINES_PER_RUN = Number(process.env.AI_BATCH_RCA_MAX_MACHINES || "50");
const ENABLED = String(process.env.AI_BATCH_RCA_ENABLED ?? "true").toLowerCase() !== "false";

let dailyJob: cron.ScheduledTask | null = null;
let lastRunAt: Date | null = null;
let lastRunStats: { machinesProcessed: number; succeeded: number; failed: number; durationMs: number } | null = null;

interface MachineRow {
  id: number;
  code: string;
  ng_count: number;
}

interface InspectionRow {
  id: number;
  result: string;
  measurement_result: string | null;
  measurement_point_name: string | null;
}

async function fetchActiveMachines(db: any, since: Date, until: Date): Promise<MachineRow[]> {
  // postgres.js không bind native Date qua sql template — phải truyền ISO string + cast ::timestamptz
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();
  const result = (await db.execute(sql`
    SELECT m.id, m.code, COUNT(*)::int AS ng_count
    FROM product_inspections i
    JOIN machines m ON i."machineId" = m.id
    WHERE i."createdAt" BETWEEN ${sinceIso}::timestamptz AND ${untilIso}::timestamptz
      AND i."overallResult" = 'NG'
    GROUP BY m.id, m.code
    HAVING COUNT(*) > 0
    ORDER BY COUNT(*) DESC
    LIMIT ${MAX_MACHINES_PER_RUN}
  `)) as any;
  return result.rows || [];
}

async function fetchInspectionRows(db: any, machineId: number, since: Date, until: Date): Promise<InspectionRow[]> {
  const sinceIso = since.toISOString();
  const untilIso = until.toISOString();
  const result = (await db.execute(sql`
    SELECT i.id, i."overallResult" as result,
           mr.result as measurement_result,
           mpd.name as measurement_point_name
    FROM product_inspections i
    LEFT JOIN measurement_results mr ON mr."inspectionId" = i.id
    LEFT JOIN measurement_point_defs mpd ON mr."pointDefId" = mpd.id
    WHERE i."machineId" = ${machineId}
      AND i."createdAt" BETWEEN ${sinceIso}::timestamptz AND ${untilIso}::timestamptz
    LIMIT 100000
  `)) as any;
  return result.rows || [];
}

function buildTopFactors(rows: InspectionRow[]) {
  const defectsByPoint: Record<string, number> = {};
  for (const row of rows) {
    if (row.measurement_result === "NG") {
      const name = row.measurement_point_name || "Unknown";
      defectsByPoint[name] = (defectsByPoint[name] || 0) + 1;
    }
  }
  const totalDefects = Object.values(defectsByPoint).reduce((a, b) => a + b, 0);
  const topFactors = Object.entries(defectsByPoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([factor, count]) => ({
      factor,
      contribution: totalDefects > 0 ? Math.round((count / totalDefects) * 100) : 0,
      description: `${count} defects detected at ${factor}`,
      trend: "stable" as const,
    }));
  const paretoData: Array<{ category: string; count: number; percentage: number; cumulativePercentage: number }> = [];
  let cumulative = 0;
  for (const [category, count] of Object.entries(defectsByPoint).sort((a, b) => b[1] - a[1])) {
    cumulative += count;
    paretoData.push({
      category,
      count,
      percentage: totalDefects > 0 ? Math.round((count / totalDefects) * 100) : 0,
      cumulativePercentage: totalDefects > 0 ? Math.round((cumulative / totalDefects) * 100) : 0,
    });
  }
  return { topFactors, paretoData };
}

export async function runBatchRCAOnce(): Promise<{ machinesProcessed: number; succeeded: number; failed: number; durationMs: number }> {
  const start = Date.now();
  const db = await getDb();
  if (!db) {
    console.warn("[aiBatchRcaScheduler] db unavailable, skipping");
    return { machinesProcessed: 0, succeeded: 0, failed: 0, durationMs: 0 };
  }
  const until = new Date();
  const since = new Date(until.getTime() - 24 * 60 * 60 * 1000);

  let machines: MachineRow[] = [];
  try {
    machines = await fetchActiveMachines(db, since, until);
  } catch (err) {
    console.error("[aiBatchRcaScheduler] fetchActiveMachines failed:", err);
    const durationMs = Date.now() - start;
    return { machinesProcessed: 0, succeeded: 0, failed: 0, durationMs };
  }

  console.log(`[aiBatchRcaScheduler] Found ${machines.length} active machines with NG in last 24h`);

  let succeeded = 0;
  let failed = 0;

  for (const m of machines) {
    try {
      const rows = await fetchInspectionRows(db, m.id, since, until);
      const totalInspections = new Set(rows.map(r => r.id)).size;
      const ngCount = rows.filter(r => r.result === "NG").length;
      const { topFactors, paretoData } = buildTopFactors(rows);

      const aiInsights = await generateRCAInsights(topFactors, {
        totalInspections,
        ngCount,
        defectRate: totalInspections > 0 ? (ngCount / totalInspections) * 100 : 0,
        analysisType: "DEFECT_ANALYSIS",
        machineCode: m.code,
        productModelCode: null,
      });

      await db.execute(sql`
        INSERT INTO root_cause_analysis
          (analysisType, machineId, machineCode, startDate, endDate, dataPointsAnalyzed,
           topFactors, aiInsights, paretoData, status, requestedBy, requestedByName, processingTime, "createdAt")
        VALUES
          ('DEFECT_ANALYSIS', ${m.id}, ${m.code}, ${since.toISOString()}::timestamptz, ${until.toISOString()}::timestamptz, ${rows.length},
           ${JSON.stringify(topFactors)}, ${JSON.stringify(aiInsights)}, ${JSON.stringify(paretoData)},
           'COMPLETED', ${SYSTEM_USER_ID}, 'SYSTEM_BATCH', ${0}, NOW())
      `);
      succeeded++;
    } catch (err) {
      console.error(`[aiBatchRcaScheduler] Machine ${m.code} (#${m.id}) failed:`, err);
      failed++;
    }
  }

  const durationMs = Date.now() - start;
  lastRunAt = new Date();
  lastRunStats = { machinesProcessed: machines.length, succeeded, failed, durationMs };
  console.log(`[aiBatchRcaScheduler] Done in ${durationMs}ms — ${succeeded} succeeded, ${failed} failed`);
  return lastRunStats;
}

export function initBatchRcaScheduler() {
  if (!ENABLED) {
    console.log("[aiBatchRcaScheduler] disabled via AI_BATCH_RCA_ENABLED=false");
    return;
  }
  if (dailyJob) return;
  dailyJob = cron.schedule(
    DEFAULT_CRON,
    () => {
      runBatchRCAOnce().catch(err => console.error("[aiBatchRcaScheduler] cron run error:", err));
    },
    { timezone: TIMEZONE },
  );
  console.log(`[aiBatchRcaScheduler] scheduled '${DEFAULT_CRON}' (${TIMEZONE})`);
}

export function stopBatchRcaScheduler() {
  if (dailyJob) {
    dailyJob.stop();
    dailyJob = null;
  }
}

export function getBatchRcaStatus() {
  return {
    enabled: ENABLED,
    cron: DEFAULT_CRON,
    timezone: TIMEZONE,
    running: !!dailyJob,
    lastRunAt,
    lastRunStats,
    maxMachinesPerRun: MAX_MACHINES_PER_RUN,
  };
}
