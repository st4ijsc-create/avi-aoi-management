/**
 * B7 — Data access cho defect_segmentations (mask + metrology).
 *
 * getDb() null-guard: read → trả rỗng/null an toàn; write → throw rõ ràng.
 * Additive: không đụng accessor cũ.
 */
import { getDb } from "./connection";
import { and, eq, desc, sql, SQL } from "drizzle-orm";
import {
  defectSegmentations,
  type DefectSegmentation,
  type InsertDefectSegmentation,
} from "../../drizzle/schema";

export async function insertDefectSegmentation(
  data: InsertDefectSegmentation,
): Promise<DefectSegmentation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(defectSegmentations).values(data).returning();
  return row;
}

export interface ListMasksFilter {
  measurementResultId?: number | null;
  inspectionId?: number | null;
  imageUrl?: string | null;
  source?: "human" | "model" | null;
  limit?: number;
}

export async function listDefectSegmentations(
  filter: ListMasksFilter = {},
): Promise<DefectSegmentation[]> {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [];
  if (filter.measurementResultId != null) conds.push(eq(defectSegmentations.measurementResultId, filter.measurementResultId));
  if (filter.inspectionId != null) conds.push(eq(defectSegmentations.inspectionId, filter.inspectionId));
  if (filter.imageUrl != null) conds.push(eq(defectSegmentations.imageUrl, filter.imageUrl));
  if (filter.source != null) conds.push(eq(defectSegmentations.source, filter.source));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select()
    .from(defectSegmentations)
    .where(where)
    .orderBy(desc(defectSegmentations.createdAt))
    .limit(filter.limit ?? 200);
}

export async function getDefectSegmentationById(id: number): Promise<DefectSegmentation | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(defectSegmentations).where(eq(defectSegmentations.id, id)).limit(1);
  return row ?? null;
}

export async function deleteDefectSegmentation(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(defectSegmentations).where(eq(defectSegmentations.id, id));
}
