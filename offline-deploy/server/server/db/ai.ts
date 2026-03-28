import { getDb } from "./connection";
import { eq, and, desc, sql, SQL } from "drizzle-orm";
import {
  aiModels, InsertAiModel,
  modelVersions, InsertModelVersion,
  inferenceResults, InsertInferenceResult,
} from "../../drizzle/schema";

// ============ AI MODEL FUNCTIONS ============

export async function createAiModel(data: InsertAiModel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(aiModels).values(data).returning();
  return result;
}

export async function getAiModels(options?: {
  modelType?: string;
  format?: "ONNX" | "TENSORRT" | "OPENVINO" | "CUSTOM";
  status?: "UPLOADING" | "VALIDATING" | "READY" | "ACTIVE" | "INACTIVE" | "FAILED" | "ARCHIVED";
  productModelId?: number;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.modelType) conditions.push(eq(aiModels.modelType, options.modelType));
  if (options?.format) conditions.push(eq(aiModels.format, options.format));
  if (options?.status) conditions.push(eq(aiModels.status, options.status));
  if (options?.productModelId) conditions.push(eq(aiModels.productModelId, options.productModelId));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(aiModels).where(where).orderBy(desc(aiModels.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

export async function getAiModelById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(aiModels).where(eq(aiModels.id, id)).limit(1);
  return result ?? null;
}

export async function getAiModelByCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(aiModels).where(eq(aiModels.code, code)).limit(1);
  return result ?? null;
}

export async function updateAiModel(id: number, data: Partial<InsertAiModel>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(aiModels).set({ ...data, updatedAt: new Date() }).where(eq(aiModels.id, id)).returning();
  return result;
}

export async function deleteAiModel(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(aiModels).where(eq(aiModels.id, id));
}

export async function getActiveModelForProduct(productModelId: number, modelType?: string) {
  const db = await getDb();
  if (!db) return null;
  const conditions: SQL[] = [
    eq(aiModels.productModelId, productModelId),
    eq(aiModels.status, "ACTIVE"),
  ];
  if (modelType) conditions.push(eq(aiModels.modelType, modelType));
  const [result] = await db.select().from(aiModels).where(and(...conditions)).limit(1);
  return result ?? null;
}

// ============ MODEL VERSION FUNCTIONS ============

export async function createModelVersion(data: InsertModelVersion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(modelVersions).values(data).returning();
  return result;
}

export async function getModelVersions(modelId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(modelVersions).where(eq(modelVersions.modelId, modelId)).orderBy(desc(modelVersions.createdAt));
}

export async function getModelVersionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select().from(modelVersions).where(eq(modelVersions.id, id)).limit(1);
  return result ?? null;
}

export async function updateModelVersion(id: number, data: Partial<InsertModelVersion>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.update(modelVersions).set(data).where(eq(modelVersions.id, id)).returning();
  return result;
}

// ============ INFERENCE RESULT FUNCTIONS ============

export async function createInferenceResult(data: InsertInferenceResult) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(inferenceResults).values(data).returning();
  return result;
}

export async function getInferenceResults(options?: {
  modelId?: number;
  inspectionId?: number;
  measurementResultId?: number;
  status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "TIMEOUT";
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: SQL[] = [];
  if (options?.modelId) conditions.push(eq(inferenceResults.modelId, options.modelId));
  if (options?.inspectionId) conditions.push(eq(inferenceResults.inspectionId, options.inspectionId));
  if (options?.measurementResultId) conditions.push(eq(inferenceResults.measurementResultId, options.measurementResultId));
  if (options?.status) conditions.push(eq(inferenceResults.status, options.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  return db.select().from(inferenceResults).where(where).orderBy(desc(inferenceResults.createdAt)).limit(options?.limit ?? 50).offset(options?.offset ?? 0);
}

export async function getInferenceStats(modelId: number) {
  const db = await getDb();
  if (!db) return null;
  const [result] = await db.select({
    totalInferences: sql<number>`count(*)::int`,
    avgProcessingTimeMs: sql<number>`avg("processingTimeMs")::int`,
    avgConfidence: sql<number>`avg("confidence"::numeric)::numeric(5,4)`,
    completedCount: sql<number>`count(*) filter (where "status" = 'COMPLETED')::int`,
    failedCount: sql<number>`count(*) filter (where "status" = 'FAILED')::int`,
  }).from(inferenceResults).where(eq(inferenceResults.modelId, modelId));
  return result;
}
