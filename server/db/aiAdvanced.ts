import { getDb } from "./connection";
import { eq, and, desc, asc, sql, lt, gte, lte, SQL, isNull } from "drizzle-orm";
import {
  batchInferenceJobs, InsertBatchInferenceJob,
  batchInferenceItems, InsertBatchInferenceItem,
  abTestExperiments, InsertAbTestExperiment,
  abTestResults, InsertAbTestResult,
  modelPerformanceSnapshots, InsertModelPerformanceSnapshot,
  modelDriftAlerts, InsertModelDriftAlert,
  trainingJobs, InsertTrainingJob,
  trainingDatasets, InsertTrainingDataset,
  edgeDeployments, InsertEdgeDeployment,
  edgeInferenceSync, InsertEdgeInferenceSync,
  aiFeedback,
  modelVersions,
  inferenceResults,
} from "../../drizzle/schema";

// ============ BATCH INFERENCE JOB FUNCTIONS ============

export async function createBatchInferenceJob(data: InsertBatchInferenceJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(batchInferenceJobs).values(data).returning();
  return result!;
}

export async function getBatchInferenceJob(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(batchInferenceJobs).where(eq(batchInferenceJobs.id, id)).limit(1);
  return result ?? null;
}

export async function updateBatchInferenceJob(id: number, data: Partial<InsertBatchInferenceJob>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(batchInferenceJobs).set(data).where(eq(batchInferenceJobs.id, id)).returning();
  return result;
}

export async function getBatchInferenceJobs(options?: {
  status?: string;
  modelId?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.status) conditions.push(eq(batchInferenceJobs.status, options.status as any));
  if (options?.modelId) conditions.push(eq(batchInferenceJobs.modelId, options.modelId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(batchInferenceJobs).where(where).orderBy(desc(batchInferenceJobs.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

// ============ BATCH INFERENCE ITEM FUNCTIONS ============

export async function createBatchInferenceItem(data: InsertBatchInferenceItem) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(batchInferenceItems).values(data).returning();
  return result!;
}

export async function createBatchInferenceItems(items: InsertBatchInferenceItem[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.insert(batchInferenceItems).values(items).returning();
}

export async function getBatchInferenceItems(batchJobId: number, status?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [eq(batchInferenceItems.batchJobId, batchJobId)];
  if (status) conditions.push(eq(batchInferenceItems.status, status as any));
  return db.select().from(batchInferenceItems).where(and(...conditions)).orderBy(asc(batchInferenceItems.id));
}

export async function updateBatchInferenceItem(id: number, data: Partial<InsertBatchInferenceItem>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(batchInferenceItems).set(data).where(eq(batchInferenceItems.id, id)).returning();
  return result;
}

export async function updateBatchItemsByJob(batchJobId: number, fromStatus: string, data: Partial<InsertBatchInferenceItem>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.update(batchInferenceItems).set(data).where(
    and(eq(batchInferenceItems.batchJobId, batchJobId), eq(batchInferenceItems.status, fromStatus as any)),
  );
}

// ============ A/B TEST EXPERIMENT FUNCTIONS ============

export async function createABTestExperiment(data: InsertAbTestExperiment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(abTestExperiments).values(data).returning();
  return result!;
}

export async function getABTestExperiment(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(abTestExperiments).where(eq(abTestExperiments.id, id)).limit(1);
  return result ?? null;
}

export async function updateABTestExperiment(id: number, data: Partial<InsertAbTestExperiment> & Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(abTestExperiments).set({ ...data, updatedAt: new Date() } as any).where(eq(abTestExperiments.id, id)).returning();
  return result;
}

export async function getABTestExperiments(options?: {
  status?: string;
  productModelId?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.status) conditions.push(eq(abTestExperiments.status, options.status as any));
  if (options?.productModelId) conditions.push(eq(abTestExperiments.productModelId, options.productModelId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(abTestExperiments).where(where).orderBy(desc(abTestExperiments.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

// ============ A/B TEST RESULT FUNCTIONS ============

export async function createABTestResult(data: InsertAbTestResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(abTestResults).values(data).returning();
  return result!;
}

export async function updateABTestResult(id: number, data: Partial<InsertAbTestResult>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(abTestResults).set(data).where(eq(abTestResults.id, id)).returning();
  return result;
}

export async function getABTestStats(experimentId: number) {
  const db = await getDb();
  if (!db) return {
    modelACount: 0, modelBCount: 0,
    modelAAvgConfidence: 0, modelBAvgConfidence: 0,
    modelAAvgLatency: 0, modelBAvgLatency: 0,
    modelAAccuracy: 0, modelBAccuracy: 0,
    modelAFeedbackCount: 0, modelBFeedbackCount: 0,
  };

  const [statsA] = await db.select({
    count: sql<number>`count(*)::int`,
    avgConfidence: sql<number>`coalesce(avg("confidence"::numeric), 0)::numeric(5,4)`,
    avgLatency: sql<number>`coalesce(avg("processingTimeMs"), 0)::int`,
    feedbackCount: sql<number>`count(*) filter (where "feedbackType" is not null)::int`,
    correctCount: sql<number>`count(*) filter (where "isCorrect" = true)::int`,
  }).from(abTestResults).where(
    and(eq(abTestResults.experimentId, experimentId), eq(abTestResults.variant, "A")),
  );

  const [statsB] = await db.select({
    count: sql<number>`count(*)::int`,
    avgConfidence: sql<number>`coalesce(avg("confidence"::numeric), 0)::numeric(5,4)`,
    avgLatency: sql<number>`coalesce(avg("processingTimeMs"), 0)::int`,
    feedbackCount: sql<number>`count(*) filter (where "feedbackType" is not null)::int`,
    correctCount: sql<number>`count(*) filter (where "isCorrect" = true)::int`,
  }).from(abTestResults).where(
    and(eq(abTestResults.experimentId, experimentId), eq(abTestResults.variant, "B")),
  );

  return {
    modelACount: statsA?.count ?? 0,
    modelBCount: statsB?.count ?? 0,
    modelAAvgConfidence: Number(statsA?.avgConfidence ?? 0),
    modelBAvgConfidence: Number(statsB?.avgConfidence ?? 0),
    modelAAvgLatency: statsA?.avgLatency ?? 0,
    modelBAvgLatency: statsB?.avgLatency ?? 0,
    modelAAccuracy: statsA?.feedbackCount ? statsA.correctCount / statsA.feedbackCount : 0,
    modelBAccuracy: statsB?.feedbackCount ? statsB.correctCount / statsB.feedbackCount : 0,
    modelAFeedbackCount: statsA?.feedbackCount ?? 0,
    modelBFeedbackCount: statsB?.feedbackCount ?? 0,
  };
}

// ============ PERFORMANCE SNAPSHOT FUNCTIONS ============

export async function createPerformanceSnapshot(data: InsertModelPerformanceSnapshot) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(modelPerformanceSnapshots).values(data).returning();
  return result!;
}

export async function updatePerformanceSnapshot(id: number, data: Partial<InsertModelPerformanceSnapshot>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(modelPerformanceSnapshots).set(data).where(eq(modelPerformanceSnapshots.id, id)).returning();
  return result;
}

export async function getLatestPerformanceSnapshot(modelId: number, modelVersion?: string) {
  const db = await getDb();
  if (!db) return null;
  const conditions: SQL[] = [eq(modelPerformanceSnapshots.modelId, modelId)];
  if (modelVersion) conditions.push(eq(modelPerformanceSnapshots.modelVersion, modelVersion));
  const [result] = await db.select().from(modelPerformanceSnapshots).where(and(...conditions)).orderBy(desc(modelPerformanceSnapshots.periodEnd)).limit(1);
  return result ?? null;
}

export async function getBaselineSnapshot(modelId: number, modelVersion: string) {
  const db = await getDb();
  if (!db) return null;
  // Use the oldest snapshot as baseline
  const [result] = await db.select().from(modelPerformanceSnapshots).where(
    and(eq(modelPerformanceSnapshots.modelId, modelId), eq(modelPerformanceSnapshots.modelVersion, modelVersion)),
  ).orderBy(asc(modelPerformanceSnapshots.periodStart)).limit(1);
  return result ?? null;
}

export async function getPerformanceSnapshots(modelId: number, modelVersion?: string, lastNDays?: number) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [eq(modelPerformanceSnapshots.modelId, modelId)];
  if (modelVersion) conditions.push(eq(modelPerformanceSnapshots.modelVersion, modelVersion));
  if (lastNDays) {
    const since = new Date();
    since.setDate(since.getDate() - lastNDays);
    conditions.push(gte(modelPerformanceSnapshots.periodEnd, since));
  }
  return db.select().from(modelPerformanceSnapshots).where(and(...conditions)).orderBy(desc(modelPerformanceSnapshots.periodEnd));
}

export async function getInferenceStatsForPeriod(
  modelId: number, modelVersion: string, periodStart: Date, periodEnd: Date,
) {
  const db = await getDb();
  if (!db) return {
    totalInferences: 0, completedInferences: 0, failedInferences: 0,
    avgLatencyMs: 0, p50LatencyMs: 0, p95LatencyMs: 0, p99LatencyMs: 0,
    accuracy: null, precision: null, recall: null, f1Score: null,
    confidenceDistribution: null, labelDistribution: null,
    errorRate: 0, timeoutRate: 0,
  };

  const [result] = await db.select({
    totalInferences: sql<number>`count(*)::int`,
    completedInferences: sql<number>`count(*) filter (where "status" = 'COMPLETED')::int`,
    failedInferences: sql<number>`count(*) filter (where "status" = 'FAILED')::int`,
    avgLatencyMs: sql<number>`coalesce(avg("processingTimeMs"), 0)::int`,
    p50LatencyMs: sql<number>`coalesce(percentile_cont(0.5) within group (order by "processingTimeMs"), 0)::int`,
    p95LatencyMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by "processingTimeMs"), 0)::int`,
    p99LatencyMs: sql<number>`coalesce(percentile_cont(0.99) within group (order by "processingTimeMs"), 0)::int`,
    errorRate: sql<number>`case when count(*) > 0 then count(*) filter (where "status" = 'FAILED')::numeric / count(*)::numeric else 0 end`,
    timeoutRate: sql<number>`case when count(*) > 0 then count(*) filter (where "status" = 'TIMEOUT')::numeric / count(*)::numeric else 0 end`,
  }).from(inferenceResults).where(
    and(
      eq(inferenceResults.modelId, modelId),
      eq(inferenceResults.modelVersion, modelVersion),
      gte(inferenceResults.createdAt, periodStart),
      lte(inferenceResults.createdAt, periodEnd),
    ),
  );

  // Calculate label distribution
  const labelDist = await db.select({
    label: sql<string>`"topLabel"`,
    count: sql<number>`count(*)::int`,
  }).from(inferenceResults).where(
    and(
      eq(inferenceResults.modelId, modelId),
      eq(inferenceResults.modelVersion, modelVersion),
      gte(inferenceResults.createdAt, periodStart),
      lte(inferenceResults.createdAt, periodEnd),
      sql`"topLabel" is not null`,
    ),
  ).groupBy(sql`"topLabel"`);

  const labelDistribution: Record<string, number> = {};
  for (const row of labelDist) {
    if (row.label) labelDistribution[row.label] = row.count;
  }

  return {
    totalInferences: result?.totalInferences ?? 0,
    completedInferences: result?.completedInferences ?? 0,
    failedInferences: result?.failedInferences ?? 0,
    avgLatencyMs: result?.avgLatencyMs ?? 0,
    p50LatencyMs: result?.p50LatencyMs ?? 0,
    p95LatencyMs: result?.p95LatencyMs ?? 0,
    p99LatencyMs: result?.p99LatencyMs ?? 0,
    accuracy: null as number | null,
    precision: null as number | null,
    recall: null as number | null,
    f1Score: null as number | null,
    confidenceDistribution: null,
    labelDistribution: Object.keys(labelDistribution).length > 0 ? labelDistribution : null,
    errorRate: Number(result?.errorRate ?? 0),
    timeoutRate: Number(result?.timeoutRate ?? 0),
  };
}

// ============ DRIFT ALERT FUNCTIONS ============

export async function createDriftAlert(data: InsertModelDriftAlert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(modelDriftAlerts).values(data).returning();
  return result!;
}

export async function updateDriftAlert(id: number, data: Partial<InsertModelDriftAlert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(modelDriftAlerts).set(data).where(eq(modelDriftAlerts.id, id)).returning();
  return result;
}

export async function getUnacknowledgedAlerts(modelId: number, modelVersion?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [
    eq(modelDriftAlerts.modelId, modelId),
    eq(modelDriftAlerts.acknowledged, false),
    isNull(modelDriftAlerts.resolvedAt),
  ];
  if (modelVersion) conditions.push(eq(modelDriftAlerts.modelVersion, modelVersion));
  return db.select().from(modelDriftAlerts).where(and(...conditions)).orderBy(desc(modelDriftAlerts.createdAt));
}

export async function getDriftAlerts(options?: {
  modelId?: number;
  severity?: string;
  acknowledged?: boolean;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.modelId) conditions.push(eq(modelDriftAlerts.modelId, options.modelId));
  if (options?.severity) conditions.push(eq(modelDriftAlerts.severity, options.severity as any));
  if (options?.acknowledged !== undefined) conditions.push(eq(modelDriftAlerts.acknowledged, options.acknowledged));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(modelDriftAlerts).where(where).orderBy(desc(modelDriftAlerts.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

// ============ TRAINING JOB FUNCTIONS ============

export async function createTrainingJob(data: InsertTrainingJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(trainingJobs).values(data).returning();
  return result!;
}

export async function getTrainingJob(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(trainingJobs).where(eq(trainingJobs.id, id)).limit(1);
  return result ?? null;
}

export async function updateTrainingJob(id: number, data: Partial<InsertTrainingJob> & Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(trainingJobs).set({ ...data, updatedAt: new Date() } as any).where(eq(trainingJobs.id, id)).returning();
  return result;
}

export async function getTrainingJobs(options?: {
  modelId?: number;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.modelId) conditions.push(eq(trainingJobs.modelId, options.modelId));
  if (options?.status) conditions.push(eq(trainingJobs.status, options.status as any));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(trainingJobs).where(where).orderBy(desc(trainingJobs.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

export async function getTrainingDataStats(modelId: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select({
    totalFeedback: sql<number>`count(*)::int`,
    incorrectCount: sql<number>`count(*) filter (where "feedbackType" = 'incorrect')::int`,
    correctCount: sql<number>`count(*) filter (where "feedbackType" = 'correct')::int`,
    partialCount: sql<number>`count(*) filter (where "feedbackType" = 'partial')::int`,
  }).from(aiFeedback);
  return result ?? null;
}

// ============ TRAINING DATASET FUNCTIONS ============

export async function createTrainingDataset(data: InsertTrainingDataset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(trainingDatasets).values(data).returning();
  return result!;
}

export async function getTrainingDataset(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(trainingDatasets).where(eq(trainingDatasets.id, id)).limit(1);
  return result ?? null;
}

export async function getTrainingDatasets(options?: {
  modelId?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.modelId) conditions.push(eq(trainingDatasets.modelId, options.modelId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(trainingDatasets).where(where).orderBy(desc(trainingDatasets.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

// ============ EDGE DEPLOYMENT FUNCTIONS ============

export async function createEdgeDeployment(data: InsertEdgeDeployment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(edgeDeployments).values(data).returning();
  return result!;
}

export async function getEdgeDeployment(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(edgeDeployments).where(eq(edgeDeployments.id, id)).limit(1);
  return result ?? null;
}

export async function updateEdgeDeployment(id: number, data: Partial<InsertEdgeDeployment> & Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(edgeDeployments).set({ ...data, updatedAt: new Date() } as any).where(eq(edgeDeployments.id, id)).returning();
  return result;
}

export async function getEdgeDeploymentsByDevice(deviceId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(edgeDeployments).where(eq(edgeDeployments.deviceId, deviceId)).orderBy(desc(edgeDeployments.createdAt));
}

export async function getEdgeDeployments(options?: {
  modelId?: number;
  status?: string;
  machineId?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.modelId) conditions.push(eq(edgeDeployments.modelId, options.modelId));
  if (options?.status) conditions.push(eq(edgeDeployments.status, options.status as any));
  if (options?.machineId) conditions.push(eq(edgeDeployments.machineId, options.machineId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(edgeDeployments).where(where).orderBy(desc(edgeDeployments.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

export async function getStaleDeployments(thresholdMinutes: number) {
  const db = await getDb();
  if (!db) return [];
  const threshold = new Date();
  threshold.setMinutes(threshold.getMinutes() - thresholdMinutes);
  return db.select().from(edgeDeployments).where(
    and(
      eq(edgeDeployments.status, "ACTIVE"),
      lt(edgeDeployments.lastHeartbeatAt, threshold),
    ),
  );
}

export async function getModelVersionForDeployment(modelId: number, version: string) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(modelVersions).where(
    and(eq(modelVersions.modelId, modelId), eq(modelVersions.version, version)),
  ).limit(1);
  return result ?? null;
}

// ============ EDGE INFERENCE SYNC FUNCTIONS ============

export async function createEdgeInferenceSync(data: InsertEdgeInferenceSync) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(edgeInferenceSync).values(data).returning();
  return result!;
}

export async function getEdgeInferenceResults(options?: {
  deploymentId?: number;
  deviceId?: string;
  synced?: boolean;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.deploymentId) conditions.push(eq(edgeInferenceSync.deploymentId, options.deploymentId));
  if (options?.deviceId) conditions.push(eq(edgeInferenceSync.deviceId, options.deviceId));
  if (options?.synced !== undefined) conditions.push(eq(edgeInferenceSync.synced, options.synced));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(edgeInferenceSync).where(where).orderBy(desc(edgeInferenceSync.inferredAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}
