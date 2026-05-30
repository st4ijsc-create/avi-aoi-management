// Schema domain: Auto-scheduling (WS-4) tables
// Additive only — these tables are new and do not alter any existing table.
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, json, index } from "drizzle-orm/pg-core";
import { scheduleRunStatusEnum } from "./enums";

/**
 * Schedule Runs — audit record of each auto-schedule generation.
 * status: DRAFT (generated, not applied) / APPLIED / DISMISSED.
 */
export const scheduleRuns = pgTable("schedule_runs", {
  id: serial("id").primaryKey(),
  // Scope — both nullable: null/null = global, factoryId only = factory-wide, etc.
  factoryId: integer("factoryId"),
  lineId: integer("lineId"),
  algorithm: varchar("algorithm", { length: 20 }).notNull(), // FIFO / Priority / EDF
  status: scheduleRunStatusEnum("status").default("DRAFT").notNull(),
  // KPI summary snapshot (totals, late orders, utilization, makespan)
  kpiSummary: json("kpiSummary").$type<{
    totalOrders: number;
    scheduledOrders: number;
    unschedulableOrders: number;
    conflictCount: number;
    lateOrders: number;
    makespanHours: number | null;
    avgUtilization: number | null;
    aiExplanation?: string | null;
  }>(),
  conflictCount: integer("conflictCount").default(0).notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  appliedAt: timestamp("appliedAt"),
}, (table) => [
  index("idx_schedule_runs_factory").on(table.factoryId),
  index("idx_schedule_runs_line").on(table.lineId),
  index("idx_schedule_runs_status").on(table.status),
  index("idx_schedule_runs_created").on(table.createdAt),
]);

export type ScheduleRun = typeof scheduleRuns.$inferSelect;
export type InsertScheduleRun = typeof scheduleRuns.$inferInsert;

/**
 * Schedule Run Items — per-order suggested slot for a run.
 */
export const scheduleRunItems = pgTable("schedule_run_items", {
  id: serial("id").primaryKey(),
  runId: integer("runId").notNull(), // FK -> schedule_runs.id
  productionOrderId: integer("productionOrderId").notNull(),
  lineId: integer("lineId").notNull(),
  suggestedStart: timestamp("suggestedStart").notNull(),
  suggestedEnd: timestamp("suggestedEnd").notNull(),
  reason: text("reason"),
  applied: boolean("applied").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_schedule_run_items_run").on(table.runId),
  index("idx_schedule_run_items_order").on(table.productionOrderId),
  index("idx_schedule_run_items_line").on(table.lineId),
]);

export type ScheduleRunItem = typeof scheduleRunItems.$inferSelect;
export type InsertScheduleRunItem = typeof scheduleRunItems.$inferInsert;

/**
 * Machine Sensor Readings — optional, feature-flagged sensor stream (e.g. vibration).
 * Created ready-to-read; MQTT ingest is NOT wired here. Predictive maintenance
 * reads this table if rows exist, otherwise degrades to the 4 heartbeat metrics.
 */
export const machineSensorReadings = pgTable("machine_sensor_readings", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  sensorType: varchar("sensorType", { length: 50 }).notNull(), // vibration / current / pressure / ...
  value: decimal("value", { precision: 12, scale: 4 }).notNull(),
  unit: varchar("unit", { length: 20 }),
  timestamp: timestamp("timestamp").notNull(),
  source: varchar("source", { length: 50 }).default("mqtt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_sensor_readings_machine_ts").on(table.machineId, table.timestamp),
  index("idx_sensor_readings_type").on(table.sensorType),
]);

export type MachineSensorReading = typeof machineSensorReadings.$inferSelect;
export type InsertMachineSensorReading = typeof machineSensorReadings.$inferInsert;
