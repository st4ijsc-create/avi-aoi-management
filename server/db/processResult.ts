// Sprint F2 — DB access for generic process results (parallel to inspection).
import { getDb } from "./connection";
import { eq, asc } from "drizzle-orm";
import { processResults, InsertProcessResult } from "../../drizzle/schema";

/** Insert one process-result row; returns the new id. */
export async function insertProcessResult(row: InsertProcessResult): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [inserted] = await db
    .insert(processResults)
    .values(row)
    .returning({ id: processResults.id });
  return inserted.id;
}

/** List all process-result rows for a serial, oldest first. */
export async function listProcessResultsBySerial(serialNumber: string, limit = 1000) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(processResults)
    .where(eq(processResults.serialNumber, serialNumber))
    .orderBy(asc(processResults.id))
    .limit(limit);
}
