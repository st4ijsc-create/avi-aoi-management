// Schema domain: OEE tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, index } from "drizzle-orm/pg-core";
import { periodTypeEnum, categoryEnum, detectionMethodEnum } from "./enums";

export const oeeMetrics = pgTable("oee_metrics", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  // Time period
  timestamp: timestamp("timestamp").notNull(),
  periodType: periodTypeEnum("periodType").default("HOUR").notNull(),
  // OEE Components (stored as percentage * 100, e.g., 85.5% = 8550)
  availability: integer("availability").notNull(), // Uptime / Planned time
  performance: integer("performance").notNull(), // Actual output / Theoretical output
  quality: integer("quality").notNull(), // Good output / Total output
  oee: integer("oee").notNull(), // A × P × Q / 10000
  // Raw data for calculation
  plannedTime: integer("plannedTime").notNull(), // Minutes
  runTime: integer("runTime").notNull(), // Minutes
  idealCycleTime: integer("idealCycleTime").notNull(), // Seconds per unit
  totalCount: integer("totalCount").notNull(), // Total units produced
  goodCount: integer("goodCount").notNull(), // Good units
  rejectCount: integer("rejectCount").notNull(), // Rejected units
  // Metadata
  calculatedBy: varchar("calculatedBy", { length: 50 }).default("AUTO").notNull(), // AUTO or user ID
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_oee_machine").on(table.machineId),
  index("idx_oee_machine_code").on(table.machineCode),
  index("idx_oee_timestamp").on(table.timestamp),
  index("idx_oee_period").on(table.periodType),
  index("idx_oee_machine_time").on(table.machineId, table.timestamp),
]);

export type OEEMetric = typeof oeeMetrics.$inferSelect;
export type InsertOEEMetric = typeof oeeMetrics.$inferInsert;

/**
 * Downtime Events - Machine downtime tracking
 */
export const downtimeEvents = pgTable("downtime_events", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  // Downtime classification
  category: categoryEnum("category").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  detailedReason: text("detailedReason"),
  // Time tracking
  startTime: timestamp("startTime").notNull(),
  endTime: timestamp("endTime"),
  duration: integer("duration"), // Minutes (calculated when endTime is set)
  // Detection method
  detectionMethod: detectionMethodEnum("detectionMethod").default("MANUAL").notNull(),
  // Responsible party
  reportedBy: integer("reportedBy"), // User ID who reported
  acknowledgedBy: integer("acknowledgedBy"), // User ID who acknowledged
  acknowledgedAt: timestamp("acknowledgedAt"),
  // Resolution
  resolution: text("resolution"),
  resolvedBy: integer("resolvedBy"), // User ID who resolved
  resolvedAt: timestamp("resolvedAt"),
  // Impact
  affectedUnits: integer("affectedUnits").default(0), // Units lost during downtime
  estimatedCost: decimal("estimatedCost", { precision: 10, scale: 2 }), // Cost impact
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_downtime_machine").on(table.machineId),
  index("idx_downtime_machine_code").on(table.machineCode),
  index("idx_downtime_category").on(table.category),
  index("idx_downtime_start").on(table.startTime),
  index("idx_downtime_end").on(table.endTime),
  index("idx_downtime_machine_time").on(table.machineId, table.startTime),
]);

export type DowntimeEvent = typeof downtimeEvents.$inferSelect;
export type InsertDowntimeEvent = typeof downtimeEvents.$inferInsert;

/**
 * OEE Targets - Target OEE values for machines/lines
 */
export const oeeTargets = pgTable("oee_targets", {
  id: serial("id").primaryKey(),
  // Target scope
  machineId: integer("machineId"), // Specific machine (null = line level)
  lineId: integer("lineId"), // Production line (null = machine level)
  // Target values (stored as percentage * 100)
  targetOEE: integer("targetOEE").notNull().default(8000), // 80%
  targetAvailability: integer("targetAvailability").notNull().default(9000), // 90%
  targetPerformance: integer("targetPerformance").notNull().default(9500), // 95%
  targetQuality: integer("targetQuality").notNull().default(9900), // 99%
  // Alert thresholds
  alertThreshold: integer("alertThreshold").notNull().default(7000), // Alert when OEE < 70%
  criticalThreshold: integer("criticalThreshold").notNull().default(6000), // Critical when OEE < 60%
  // Validity period
  effectiveFrom: timestamp("effectiveFrom").notNull().defaultNow(),
  effectiveTo: timestamp("effectiveTo"),
  isActive: boolean("isActive").default(true).notNull(),
  // Metadata
  setBy: integer("setBy").notNull(), // User ID who set the target
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_oee_target_machine").on(table.machineId),
  index("idx_oee_target_line").on(table.lineId),
  index("idx_oee_target_active").on(table.isActive),
  index("idx_oee_target_effective").on(table.effectiveFrom, table.effectiveTo),
]);

export type OEETarget = typeof oeeTargets.$inferSelect;
export type InsertOEETarget = typeof oeeTargets.$inferInsert;
