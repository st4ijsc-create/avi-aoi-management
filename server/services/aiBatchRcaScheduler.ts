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
import { rootCauseAnalysis } from "../../drizzle/schema";
import { generateRCAInsights } from "./aiInsightsService";
// B2.4 — auto-ingest hook (flag-gated RAG_AUTO_INGEST_ENABLED, default OFF).
import { ingestKnowledgeRecordAsync } from "./aiLocalKnowledgeService";
// doc69 Wave 2 / A2 — converge batch RCA onto the evidence-rich copilot
// (Pareto+SPC+anomaly+VLM+audit+GraphRAG+quantitative-correlation) when
// AI_RCA_COPILOT_ENABLED is on. Flag OFF (default) keeps the shallow fallback below.
import { isRcaCopilotEnabled, runRca, persistRca, type RcaResult } from "./aiRcaCopilot";

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
  // W0-1 fix (doc 69): the postgres-js driver used by this project's drizzle
  // connection returns query rows DIRECTLY (no `.rows` wrapper — see the
  // established `result.rows || result` pattern in server/db/statistics.ts /
  // server/db/inspection.ts). `result.rows || []` always evaluated to `[]`,
  // so the scheduler always saw "0 active machines" and never ran.
  return result.rows || result || [];
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
  // W0-1 fix (doc 69): same `.rows` accessor bug as fetchActiveMachines above.
  return result.rows || result || [];
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
      if (isRcaCopilotEnabled()) {
        // ── doc69 Wave 2 / A2 — converged path: evidence-rich RCA via aiRcaCopilot
        // (Pareto+SPC+anomaly+VLM+audit+GraphRAG+quantitative-correlation), not just
        // aggregate Pareto counts. Fail-safe: runRca/persistRca never throw; a null
        // rcaId (persist failure) is counted as a per-machine failure without
        // aborting the batch (caught below too, defense in depth). ──
        const result: RcaResult = await runRca({ machineId: m.id, lang: "vi" });
        const rcaId = await persistRca({ result, requestedBy: SYSTEM_USER_ID, requestedByName: "SYSTEM_BATCH" });
        if (rcaId == null) {
          failed++;
          continue;
        }
        succeeded++;

        // B2.4 — same fire-and-forget KB ingest as the legacy path, sourced from
        // the copilot's real hypotheses instead of relabeled Pareto counts.
        const top = result.hypotheses[0];
        ingestKnowledgeRecordAsync({
          sourceId: `rca:${m.code}:${until.toISOString().slice(0, 10)}`,
          title: `RCA — ${m.code} (${until.toISOString().slice(0, 10)})`,
          sourceType: "incident",
          text: top
            ? `Machine ${m.code} RCA (evidence-rich). Top cause: ${top.cause} (${Math.round(top.confidence * 100)}%).\n` +
              `Evidence: ${top.evidence.join("; ")}\n` +
              `Recommended fix: ${top.recommendedFix.rationale}`
            : `Machine ${m.code} RCA (evidence-rich). ${result.note ?? "Needs human investigation — insufficient evidence."}`,
          keywords: ["rca", "defect", m.code.toLowerCase()],
        });
        continue;
      }

      // LEGACY (doc69 A2): superseded by aiRcaCopilot when AI_RCA_COPILOT_ENABLED is
      // on (branch above). Kept as the FALLBACK for default (flag-off) behavior —
      // shallow Pareto-relabeling only (topFactors = NG frequency by measurement
      // point), no SPC/anomaly/vision/causal-graph/quantitative-correlation evidence.
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

      // W0-1 fix (doc 69): was a raw INSERT with unquoted camelCase column names
      // (Postgres folds them to lowercase → "column analysistype does not exist"),
      // silently swallowed by the per-machine try/catch below → nothing persisted.
      // The drizzle builder quotes identifiers correctly and matches the physical
      // schema (drizzle/schema/ai.ts — quoted-camelCase columns).
      await db.insert(rootCauseAnalysis).values({
        analysisType: "DEFECT_ANALYSIS",
        machineId: m.id,
        machineCode: m.code,
        startDate: since,
        endDate: until,
        dataPointsAnalyzed: rows.length,
        topFactors,
        aiInsights,
        paretoData,
        status: "COMPLETED",
        requestedBy: SYSTEM_USER_ID,
        requestedByName: "SYSTEM_BATCH",
        processingTime: 0,
      });
      succeeded++;

      // B2.4 — fire-and-forget: feed this RCA back into the KB so future
      // retrieval/RCA can cite past incidents. No-op unless
      // RAG_AUTO_INGEST_ENABLED=true; idempotent (dedupes by sourceId); never
      // throws / never blocks the scheduler.
      ingestKnowledgeRecordAsync({
        sourceId: `rca:${m.code}:${until.toISOString().slice(0, 10)}`,
        title: `RCA — ${m.code} (${until.toISOString().slice(0, 10)})`,
        sourceType: "incident",
        text:
          `Machine ${m.code} defect analysis. NG=${ngCount}/${totalInspections}.\n` +
          `Summary: ${aiInsights.summary}\n` +
          `Root causes: ${aiInsights.rootCauses.map((c) => `${c.cause} (${Math.round(c.probability * 100)}%)`).join("; ")}\n` +
          `Recommendations: ${aiInsights.recommendations.join("; ")}`,
        keywords: ["rca", "defect", m.code.toLowerCase()],
      });
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
