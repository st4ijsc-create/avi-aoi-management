/**
 * doc 81 Đợt 9 task S1 (mig 0370) — NARROW projections of the two edge-execution tables:
 *   • `edge_node_credentials`              — one secret per edge node (SHA-256 of the token; revoke terminal; rotation);
 *   • `orchestration_run_edge_assignments` — the EDGE ASSIGNMENT of a central run (ID mapping: the edge executes this runId /
 *                                            workflowId exactly) + the current CLAIM (claimSeq, claim token hash, progress).
 * Kept OUT of drizzle/schema on purpose (Group R interface note / 0368 lesson): nothing is added to the full-row objects the
 * ABORT / STOP paths read; a missing 0370 only ever surfaces where these tables are used (assignment refused, node 401).
 */
import { eq, inArray } from "drizzle-orm";
import { bigint, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const edgeNodeCredentials = pgTable("edge_node_credentials", {
  id: serial("id").primaryKey(),
  edgeNodeId: integer("edgeNodeId").notNull(),
  keyPrefix: varchar("keyPrefix", { length: 32 }).notNull(),
  secretHash: varchar("secretHash", { length: 64 }).notNull(),
  status: varchar("status", { length: 16 }).notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  rotatedFromId: integer("rotatedFromId"),
  revokedAt: timestamp("revokedAt", { withTimezone: true }),
  revokedBy: integer("revokedBy"),
  revokeReason: text("revokeReason"),
  lastUsedAt: timestamp("lastUsedAt", { withTimezone: true }),
});

export const runEdgeAssignments = pgTable("orchestration_run_edge_assignments", {
  runId: integer("runId").primaryKey(),
  edgeNodeId: integer("edgeNodeId").notNull(),
  workflowId: integer("workflowId").notNull(),
  workflowVersion: integer("workflowVersion").notNull(),
  defHash: varchar("defHash", { length: 64 }).notNull(),
  assignedBy: integer("assignedBy"),
  assignedAt: timestamp("assignedAt", { withTimezone: true }).defaultNow().notNull(),
  claimSeq: integer("claimSeq").notNull().default(0),
  claimTokenHash: varchar("claimTokenHash", { length: 64 }),
  claimedByCredentialId: integer("claimedByCredentialId"),
  claimedAt: timestamp("claimedAt", { withTimezone: true }),
  progressSeq: bigint("progressSeq", { mode: "number" }).notNull().default(0),
  lastProgressAt: timestamp("lastProgressAt", { withTimezone: true }),
});

export type RunEdgeAssignment = typeof runEdgeAssignments.$inferSelect;

/** 42P01 undefined_table / 42703 undefined_column — migration 0370 not applied (postgres-js: code on err or err.cause). */
export function isEdgeSchemaMissing(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = e?.code ?? e?.cause?.code;
  return c === "42P01" || c === "42703";
}

/**
 * The edge assignment of a run (null ⇔ none). 0370 not applied ⇒ null (no run can have one). THROWS on any other DB error —
 * callers decide fail-closed for their own path.
 */
export async function readEdgeAssignment(d: { select: (...a: any[]) => any }, runId: number): Promise<RunEdgeAssignment | null> {
  try {
    const [row] = await d.select().from(runEdgeAssignments).where(eq(runEdgeAssignments.runId, runId)).limit(1);
    return (row as RunEdgeAssignment | undefined) ?? null;
  } catch (err) {
    if (isEdgeSchemaMissing(err)) return null;
    throw err;
  }
}

/** Which of these runs are assigned to an edge node. 0370 missing ⇒ none. THROWS on any other DB error. */
export async function edgeAssignedRunIdsAmong(d: { select: (...a: any[]) => any }, runIds: number[]): Promise<Set<number>> {
  if (runIds.length === 0) return new Set();
  try {
    const rows: Array<{ runId: number }> = await d.select({ runId: runEdgeAssignments.runId }).from(runEdgeAssignments).where(inArray(runEdgeAssignments.runId, runIds));
    return new Set(rows.map((r) => r.runId));
  } catch (err) {
    if (isEdgeSchemaMissing(err)) return new Set();
    throw err;
  }
}
