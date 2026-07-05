// Schema domain: SYNAPSE observability/orchestration persistence (doc 33 W4).
//
// ════════════════════════════════════════════════════════════════════════════
// Persistence for the F6 decision-trace ("vì sao robot X được chọn") and the F8 durable
// RunEvent log (replay-from-events). Additive tables (migrations 0221/0222); the pure
// in-memory primitives flush here via a SINK when OBSERVABILITY/FOE_DURABLE is on, so the
// pure modules stay DB-free. Imported directly (not via the shared schema index) to avoid
// churning that file while a concurrent branch also edits it.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, varchar, text, jsonb, bigint, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

export const decisionTraces = pgTable("decision_traces", {
  id: serial("id").primaryKey(),
  decisionType: varchar("decisionType", { length: 64 }).notNull(),
  subject: varchar("subject", { length: 128 }).notNull(),
  chosen: varchar("chosen", { length: 128 }),
  candidatesJson: jsonb("candidatesJson"),
  version: varchar("version", { length: 64 }).notNull(),
  correlationId: varchar("correlationId", { length: 64 }),
  ts: bigint("ts", { mode: "number" }).notNull(),
  note: text("note"),
}, (t) => [
  index("idx_decision_traces_type").on(t.decisionType),
  index("idx_decision_traces_subject").on(t.subject),
  index("idx_decision_traces_ts").on(t.ts),
]);

export const orchestrationRunEvents = pgTable("orchestration_run_events", {
  id: serial("id").primaryKey(),
  runId: integer("runId").notNull(),
  seq: integer("seq").notNull(),
  type: varchar("type", { length: 48 }).notNull(),
  taskId: varchar("taskId", { length: 128 }),
  ts: bigint("ts", { mode: "number" }).notNull(),
  dataJson: jsonb("dataJson"),
}, (t) => [
  // UNIQUE so a lost seq-assignment race fails loudly instead of writing a duplicate seq
  // (belt-and-suspenders to the advisory-lock serialisation in runEventStore). — doc 33 §11 fix.
  uniqueIndex("idx_run_events_run").on(t.runId, t.seq),
]);

export type DecisionTraceRow = typeof decisionTraces.$inferSelect;
export type OrchestrationRunEventRow = typeof orchestrationRunEvents.$inferSelect;
