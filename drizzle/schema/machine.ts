// Schema domain: Machine tables
import { pgTable, serial, integer, text, timestamp, varchar, decimal, boolean, index } from "drizzle-orm/pg-core";
import { statusEnum_1, operationStatusEnum, protocolEnum, connectionStatusEnum, maintenanceUrgencyEnum } from "./enums";

/**
 * Machine Status Logs - Lịch sử trạng thái kết nối máy
 */
export const machineStatusLogs = pgTable("machine_status_logs", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  status: statusEnum_1("status").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  duration: integer("duration"),
  notificationSent: boolean("notificationSent").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_status_logs_machine").on(table.machineId),
  index("idx_status_logs_timestamp").on(table.timestamp),
  index("idx_status_logs_status").on(table.status),
]);

export type MachineStatusLog = typeof machineStatusLogs.$inferSelect;
export type InsertMachineStatusLog = typeof machineStatusLogs.$inferInsert;

/**
 * Machine Heartbeat History - Lịch sử heartbeat chi tiết
 */
export const machineHeartbeats = pgTable("machine_heartbeats", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  status: operationStatusEnum("status").default("running").notNull(),
  cpuUsage: decimal("cpuUsage", { precision: 5, scale: 2 }),
  memoryUsage: decimal("memoryUsage", { precision: 5, scale: 2 }),
  diskUsage: decimal("diskUsage", { precision: 5, scale: 2 }),
  temperature: decimal("temperature", { precision: 5, scale: 2 }),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
}, (table) => [
  index("idx_heartbeats_machine").on(table.machineId),
  index("idx_heartbeats_timestamp").on(table.timestamp),
]);

export type MachineHeartbeat = typeof machineHeartbeats.$inferSelect;
export type InsertMachineHeartbeat = typeof machineHeartbeats.$inferInsert;


/**
 * Manual Machine Connections - Cấu hình kết nối máy thủ công qua IP:Port
 * Cho phép admin cấu hình kết nối socket đến máy mà không cần máy tự đăng ký
 */
export const manualMachineConnections = pgTable("manual_machine_connections", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }).notNull(), // IPv4 hoặc IPv6
  port: integer("port").notNull().default(8080),
  protocol: protocolEnum("protocol").default("websocket").notNull(),
  isEnabled: boolean("isEnabled").default(true).notNull(),
  lastConnectionAttempt: timestamp("lastConnectionAttempt"),
  lastSuccessfulConnection: timestamp("lastSuccessfulConnection"),
  connectionStatus: connectionStatusEnum("connectionStatus").default("pending").notNull(),
  errorMessage: text("errorMessage"),
  retryCount: integer("retryCount").default(0).notNull(),
  maxRetries: integer("maxRetries").default(5).notNull(),
  retryIntervalSeconds: integer("retryIntervalSeconds").default(30).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, (table) => [
  index("idx_manual_conn_machine").on(table.machineId),
  index("idx_manual_conn_ip").on(table.ipAddress),
  index("idx_manual_conn_status").on(table.connectionStatus),
]);

export type ManualMachineConnection = typeof manualMachineConnections.$inferSelect;
export type InsertManualMachineConnection = typeof manualMachineConnections.$inferInsert;

export const machineHealthHistory = pgTable("machine_health_history", {
  id: serial("id").primaryKey(),
  machineId: integer("machineId").notNull(),
  machineCode: varchar("machineCode", { length: 50 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  // Health score (0-100)
  healthScore: integer("healthScore").notNull(),
  // Contributing factors (stored as percentage * 100)
  oeeScore: integer("oeeScore").notNull(),
  uptimeScore: integer("uptimeScore").notNull(),
  errorRateScore: integer("errorRateScore").notNull(),
  cycleTimeScore: integer("cycleTimeScore").notNull(),
  // Raw metrics
  currentOEE: integer("currentOEE"),
  uptimePercentage: integer("uptimePercentage"),
  errorCount: integer("errorCount"),
  cycleTimeVariance: decimal("cycleTimeVariance", { precision: 10, scale: 2 }),
  // Predictions
  predictedFailureRisk: integer("predictedFailureRisk"), // 0-100
  recommendedMaintenanceDate: timestamp("recommendedMaintenanceDate"),
  maintenanceUrgency: maintenanceUrgencyEnum("maintenanceUrgency"),
  // Metadata
  calculationMethod: varchar("calculationMethod", { length: 50 }).default("WEIGHTED").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_health_machine").on(table.machineId),
  index("idx_health_machine_code").on(table.machineCode),
  index("idx_health_timestamp").on(table.timestamp),
  index("idx_health_score").on(table.healthScore),
  index("idx_health_machine_time").on(table.machineId, table.timestamp),
]);

export type MachineHealthHistory = typeof machineHealthHistory.$inferSelect;
export type InsertMachineHealthHistory = typeof machineHealthHistory.$inferInsert;
