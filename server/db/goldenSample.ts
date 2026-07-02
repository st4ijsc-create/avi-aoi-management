/**
 * AOI-B — Data access for golden_sample_references (get/set/list golden references).
 *
 * getDb() null-guard: read → returns empty/null safely; write → throws clearly.
 * Additive: does not touch existing accessors.
 */
import { getDb } from "./connection";
import { and, eq, desc, isNull, SQL } from "drizzle-orm";
import {
  goldenSampleReferences,
  type GoldenSampleReference,
  type InsertGoldenSampleReference,
} from "../../drizzle/schema";

/** Key that identifies a golden-sample slot. Any subset may be set. */
export interface GoldenKey {
  productCode?: string | null;
  recipeCode?: string | null;
  stationCode?: string | null;
  roiKey?: string | null;
}

/** Equality predicate that treats undefined as NULL (exact-key match). */
function keyConds(key: GoldenKey): SQL[] {
  const conds: SQL[] = [];
  conds.push(key.productCode != null ? eq(goldenSampleReferences.productCode, key.productCode) : isNull(goldenSampleReferences.productCode));
  conds.push(key.recipeCode != null ? eq(goldenSampleReferences.recipeCode, key.recipeCode) : isNull(goldenSampleReferences.recipeCode));
  conds.push(key.stationCode != null ? eq(goldenSampleReferences.stationCode, key.stationCode) : isNull(goldenSampleReferences.stationCode));
  conds.push(key.roiKey != null ? eq(goldenSampleReferences.roiKey, key.roiKey) : isNull(goldenSampleReferences.roiKey));
  return conds;
}

/** Fetch the current ACTIVE reference for an exact key (null when none / no DB). */
export async function getActiveGoldenReference(key: GoldenKey): Promise<GoldenSampleReference | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(goldenSampleReferences)
    .where(and(eq(goldenSampleReferences.active, true), ...keyConds(key)))
    .orderBy(desc(goldenSampleReferences.version))
    .limit(1);
  return row ?? null;
}

/** Highest existing version for a key (0 when none). Used to bump on set. */
export async function getMaxGoldenVersion(key: GoldenKey): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select()
    .from(goldenSampleReferences)
    .where(and(...keyConds(key)))
    .orderBy(desc(goldenSampleReferences.version))
    .limit(1);
  return row?.version ?? 0;
}

/**
 * Set (insert) a new ACTIVE reference for a key and deactivate any prior active rows
 * for the same key. `version` is bumped to max+1. Throws when the DB is unavailable
 * (write path is honest — never silently no-ops).
 */
export async function setGoldenReference(
  values: InsertGoldenSampleReference,
): Promise<GoldenSampleReference> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const key: GoldenKey = {
    productCode: values.productCode ?? null,
    recipeCode: values.recipeCode ?? null,
    stationCode: values.stationCode ?? null,
    roiKey: values.roiKey ?? null,
  };
  const nextVersion = (await getMaxGoldenVersion(key)) + 1;
  // Deactivate prior active rows for this exact key.
  await db
    .update(goldenSampleReferences)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(goldenSampleReferences.active, true), ...keyConds(key)));
  const [row] = await db
    .insert(goldenSampleReferences)
    .values({ ...values, version: nextVersion, active: true })
    .returning();
  return row;
}

export interface ListGoldenFilter {
  productCode?: string | null;
  recipeCode?: string | null;
  activeOnly?: boolean;
  limit?: number;
}

/** List references (optionally filtered). Read-only; returns [] when no DB. */
export async function listGoldenReferences(
  filter: ListGoldenFilter = {},
): Promise<GoldenSampleReference[]> {
  const db = await getDb();
  if (!db) return [];
  const conds: SQL[] = [];
  if (filter.productCode != null) conds.push(eq(goldenSampleReferences.productCode, filter.productCode));
  if (filter.recipeCode != null) conds.push(eq(goldenSampleReferences.recipeCode, filter.recipeCode));
  if (filter.activeOnly) conds.push(eq(goldenSampleReferences.active, true));
  return db
    .select()
    .from(goldenSampleReferences)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(goldenSampleReferences.updatedAt))
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 1000));
}

/** Deactivate a reference by id (soft delete). Throws when no DB. */
export async function deactivateGoldenReference(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(goldenSampleReferences)
    .set({ active: false, updatedAt: new Date() })
    .where(eq(goldenSampleReferences.id, id));
}
