// Schema domain: AI/analytics loop completion (Khối 4, doc 16 §9 / doc 18 §6 I2)
//                — flags AI_ROBOT_ANOMALY_ENABLED + AI_MODEL_AUTOROLLBACK_ENABLED (both default OFF)
//
// ════════════════════════════════════════════════════════════════════════════
// I2 closes the AI/analytics loop with TWO append-only advisory ledgers. Neither
// opens a device-control path; both are records the AI writes so a human can react
// via the EXISTING gated surfaces (Andon / smart-alert / model activation).
//
//   robot_behavior_anomalies — ONE row per detected robot-behaviour anomaly
//     (I2-a). The detector (robotBehaviorAnomaly.detect) reuses the aiTimeSeries
//     engine (EWMA/CUSUM) over robot_telemetry (joint_states/pose) and robot_jobs
//     (per-job cycle time). Every row is ADVISORY — it raises a smart alert, never
//     a robot command. `kind` = trajectory_deviation | grip_force | cycle_time_trend.
//     `evidence` (jsonb) carries the honest data behind the score. When a required
//     signal is absent (e.g. grip force with no force telemetry) NO row is written
//     (honest null-skip) rather than a fabricated anomaly.
//
//   model_rollback_events — append-only audit of AUTOMATIC + MANUAL model
//     rollbacks (I2-b). When the ACTIVE version's live quality/confidence drops
//     below its eval baseline (or a drift detector fires) the auto-rollback flips
//     status back to the previous stable version and records ONE row here
//     {modelId, fromVersionId, toVersionId, reason, metrics}. `trigger` =
//     auto_drift | auto_accuracy | manual. This is the source of truth for "why did
//     the active model change"; it reuses model_versions (no model registry fork).
//
// ⚠ SAFETY: both tables are ADVISORY/AUDIT only. The anomaly ledger opens NO robot
//   command path; the rollback ledger only flips a model_versions.status flag
//   (the SAME operation activateModelVersion already performs manually).
//
// TENANT SCOPE: corporateCode (varchar) + factoryId (int) mirror fieldHealth/fleet.
// RLS is wired in 0150 with the shared inert-by-default app_tenant_allows() helper
// on corporateCode — a no-op until TENANT_RLS_ENABLED.
//
// status/kind/trigger columns are varchar (NOT pg enums) → the migration stays additive.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, timestamp, jsonb, decimal, index } from "drizzle-orm/pg-core";

/**
 * Robot behaviour anomaly ledger (I2-a) — append-only, ADVISORY.
 * One row per detection. Soft FK → robots.id (no DB FK; mirrors fieldHealth).
 */
export const robotBehaviorAnomalies = pgTable("robot_behavior_anomalies", {
  id: serial("id").primaryKey(),
  robotId: integer("robotId").notNull(),
  // trajectory_deviation | grip_force | cycle_time_trend
  kind: varchar("kind", { length: 32 }).notNull(),
  // Anomaly score (higher = more anomalous); scale depends on the detector.
  score: decimal("score", { precision: 10, scale: 4 }).notNull(),
  // Confidence 0..1 (how much data backed the detection).
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  // ISA-18.2-style severity band for the raised advisory (low|medium|high|critical).
  severity: varchar("severity", { length: 16 }).default("medium").notNull(),
  // Honest evidence behind the score (baseline, observed value, window, algorithm…).
  evidence: jsonb("evidence").$type<Record<string, unknown>>(),
  // The smart alert / predictive_alert id raised for this anomaly (null when flag off).
  alertId: integer("alertId"),
  // raised → acknowledged (advisory lifecycle; NO resolve-to-command path).
  status: varchar("status", { length: 16 }).default("raised").notNull(),
  acknowledgedBy: integer("acknowledgedBy"),
  acknowledgedAt: timestamp("acknowledgedAt"),
  scope: varchar("scope", { length: 64 }),
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  detectedAt: timestamp("detectedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_robotanom_robot").on(table.robotId),
  index("idx_robotanom_kind").on(table.kind),
  index("idx_robotanom_status").on(table.status),
  index("idx_robotanom_detected").on(table.detectedAt),
]);

export type RobotBehaviorAnomaly = typeof robotBehaviorAnomalies.$inferSelect;
export type InsertRobotBehaviorAnomaly = typeof robotBehaviorAnomalies.$inferInsert;

/**
 * Model rollback event ledger (I2-b) — append-only audit of auto + manual rollbacks.
 * Soft FK → ai_models.id / model_versions.id (no DB FK; mirrors ai domain style).
 */
export const modelRollbackEvents = pgTable("model_rollback_events", {
  id: serial("id").primaryKey(),
  modelId: integer("modelId").notNull(),
  fromVersionId: integer("fromVersionId"),
  toVersionId: integer("toVersionId"),
  fromVersion: varchar("fromVersion", { length: 50 }),
  toVersion: varchar("toVersion", { length: 50 }),
  // auto_drift | auto_accuracy | manual
  trigger: varchar("trigger", { length: 24 }).notNull(),
  reason: text("reason").notNull(),
  // Snapshot of the metrics that drove the decision (live vs baseline, drift score…).
  metrics: jsonb("metrics").$type<Record<string, unknown>>(),
  // The drift/predictive alert id emitted for this rollback (null when flag off / no alert).
  alertId: integer("alertId"),
  triggeredBy: integer("triggeredBy"), // user id for manual; null for automatic
  corporateCode: varchar("corporateCode", { length: 50 }),
  factoryId: integer("factoryId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_modelrollback_model").on(table.modelId),
  index("idx_modelrollback_trigger").on(table.trigger),
  index("idx_modelrollback_created").on(table.createdAt),
]);

export type ModelRollbackEvent = typeof modelRollbackEvents.$inferSelect;
export type InsertModelRollbackEvent = typeof modelRollbackEvents.$inferInsert;
