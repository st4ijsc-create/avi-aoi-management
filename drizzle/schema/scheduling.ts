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
    // G2.5a APS additive (type-only): how the run was produced + solver objective.
    solverMode?: "cpsat" | "fallback_heuristic";
    objective?: {
      makespanMin?: number | null;
      totalTardinessMin?: number | null;
      totalSetupMin?: number | null;
    } | null;
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
  // G2.5a APS additive (all nullable, backward-compatible with heuristic runs).
  stationId: integer("stationId"),       // station/machine the op was placed on
  setupMinutes: integer("setupMinutes"), // changeover minutes before this op
  sequenceIndex: integer("sequenceIndex"), // ordering position on its station
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_schedule_run_items_run").on(table.runId),
  index("idx_schedule_run_items_order").on(table.productionOrderId),
  index("idx_schedule_run_items_line").on(table.lineId),
]);

export type ScheduleRunItem = typeof scheduleRunItems.$inferSelect;
export type InsertScheduleRunItem = typeof scheduleRunItems.$inferInsert;

/**
 * Machine Capacity — G2.5a APS resource model.
 * Describes parallel capacity + default changeover per machine/station/line so
 * the CP-SAT solver can model AddNoOverlap intervals. Additive, opt-in: when a
 * line has no rows the solver falls back to single-capacity-per-station.
 */
export const machineCapacity = pgTable("machine_capacity", {
  id: serial("id").primaryKey(),
  lineId: integer("lineId").notNull(),
  stationId: integer("stationId"),
  machineId: integer("machineId"),
  parallelCapacity: integer("parallelCapacity").default(1).notNull(),
  changeoverDefaultMin: integer("changeoverDefaultMin").default(0).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_machine_capacity_line").on(table.lineId),
  index("idx_machine_capacity_station").on(table.stationId),
  index("idx_machine_capacity_machine").on(table.machineId),
]);

export type MachineCapacity = typeof machineCapacity.$inferSelect;
export type InsertMachineCapacity = typeof machineCapacity.$inferInsert;

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
