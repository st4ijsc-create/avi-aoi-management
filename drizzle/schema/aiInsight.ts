// Schema domain: AI orchestration insights (Phase 4 WS4.2).
// Advisory output of the AI watcher: local-LLM reasoning over event-bus signals.
// Advisory-only (no executable action) — actions still go through ai_pending_actions (HITL).
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const aiInsights = pgTable("ai_insights", {
  id: serial("id").primaryKey(),
  source: varchar("source", { length: 64 }).notNull(), // rule/event that triggered it
  machineCode: varchar("machineCode", { length: 64 }),
  severity: varchar("severity", { length: 16 }).default("warning").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  body: text("body").notNull(),
  recommendation: text("recommendation"),
  contextJson: jsonb("contextJson").$type<Record<string, unknown>>(),
  status: varchar("status", { length: 16 }).default("new").notNull(), // new/acknowledged/dismissed
  acknowledgedBy: integer("acknowledgedBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_ai_insights_status_created").on(table.status, table.createdAt),
  index("idx_ai_insights_machine").on(table.machineCode),
]);

export type AiInsight = typeof aiInsights.$inferSelect;
export type InsertAiInsight = typeof aiInsights.$inferInsert;
