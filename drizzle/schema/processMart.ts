// doc 56 Đ5 — Process analytics MART (per-day rollup of process_results).
//
// A read-optimised daily rollup so fleet dashboards ("pass rate by machineType /
// deviceClass over 30 days") do not scan the raw process_results row-store. ONE row
// per (day, machineId, stepType); machineType is the denormalised snapshot carried
// from the raw rows (deviceClass is derived in code via DEVICE_CLASS_BY_TYPE — a
// constant, so it is NOT stored). Refreshed by refreshProcessResultDaily() (idempotent
// upsert); dashboards fall back to a live aggregate when the mart is cold.
//
// ADDITIVE — nothing reads or writes this until PROCESS_ANALYTICS_ENABLED is on.
import { pgTable, serial, integer, varchar, date, timestamp, doublePrecision, uniqueIndex, index } from "drizzle-orm/pg-core";
import { machineTypeEnum } from "./enums";

export const processResultDaily = pgTable(
  "process_result_daily",
  {
    id: serial("id").primaryKey(),
    day: date("day").notNull(),
    machineId: integer("machineId").notNull(),
    machineType: machineTypeEnum("machineType"), // denormalised snapshot (nullable)
    stepType: varchar("stepType", { length: 64 }).notNull(),
    pass: integer("pass").default(0).notNull(),
    fail: integer("fail").default(0).notNull(),
    warn: integer("warn").default(0).notNull(),
    skip: integer("skip").default(0).notNull(),
    total: integer("total").default(0).notNull(),
    // First-pass yield = pass / (pass+fail+warn), 0..1 (skip excluded). Stored for
    // fast dashboard reads; recomputed on every refresh.
    firstPassYield: doublePrecision("firstPassYield"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex("uq_process_result_daily").on(t.day, t.machineId, t.stepType),
    byDay: index("idx_process_result_daily_day").on(t.day),
    byMachine: index("idx_process_result_daily_machine").on(t.machineId),
    byType: index("idx_process_result_daily_type").on(t.machineType),
  }),
);

export type ProcessResultDaily = typeof processResultDaily.$inferSelect;
export type InsertProcessResultDaily = typeof processResultDaily.$inferInsert;
