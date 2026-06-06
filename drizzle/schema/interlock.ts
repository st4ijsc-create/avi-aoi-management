// Schema domain: Interlock (Sprint F5a — Andon + Interlock model, ALERT-ONLY)
//
// ════════════════════════════════════════════════════════════════════════════
// SAFETY (F5a):
//   - An interlock RULE describes a condition over a data feed (SPC/NG-rate/
//     process-result/telemetry/cpk) and an intended action. In F5a the engine
//     NEVER writes a command to a machine. Rules default to the SAFEST state:
//       enabled=false, approvedBy=NULL, requiresHumanConfirm=true.
//   - The AI may only PROPOSE rules (always enabled=false/approvedBy=null);
//     enabling/approving is a human-only router action.
//   - interlock_events records what the engine observed. For block/stop with
//     requiresHumanConfirm=true → status 'proposed' (+ red Andon). Auto
//     block/stop (requiresHumanConfirm=false) → 'skipped' (command path is F5b).
//   - commandTag/commandValue/targetMachineId/targetAdapterId are RECORDED for
//     F5b but are NEVER dispatched in F5a.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, decimal, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import {
  interlockScopeEnum,
  interlockSourceTypeEnum,
  comparisonOperatorEnum,
  interlockActionEnum,
  interlockEventStatusEnum,
} from "./enums";

/**
 * Interlock Rules — định nghĩa điều kiện (nguồn + toán tử + ngưỡng + cửa sổ) và
 * hành động dự kiến. AN TOÀN MẶC ĐỊNH: enabled=false, approvedBy=null,
 * requiresHumanConfirm=true. AI chỉ được đề xuất (không bao giờ tự bật/duyệt).
 */
export const interlockRules = pgTable("interlock_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  scope: interlockScopeEnum("scope").notNull(),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  machineId: integer("machineId"),
  sourceType: interlockSourceTypeEnum("sourceType").notNull(),
  sourceKey: varchar("sourceKey", { length: 128 }),
  comparisonOperator: comparisonOperatorEnum("comparisonOperator").notNull(),
  threshold: decimal("threshold", { precision: 18, scale: 6 }),
  windowSize: integer("windowSize"),
  consecutiveCount: integer("consecutiveCount"),
  windowSeconds: integer("windowSeconds"),
  action: interlockActionEnum("action").notNull(),
  targetMachineId: integer("targetMachineId"),
  targetAdapterId: integer("targetAdapterId"),
  commandTag: varchar("commandTag", { length: 128 }),
  commandValue: jsonb("commandValue"),
  requiresHumanConfirm: boolean("requiresHumanConfirm").default(true).notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  approvedBy: integer("approvedBy"),
  approvedAt: timestamp("approvedAt"),
  cooldownSeconds: integer("cooldownSeconds").default(300).notNull(),
  lastFiredAt: timestamp("lastFiredAt"),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  updatedBy: integer("updatedBy"),
}, (table) => [
  index("idx_interlock_rules_scope").on(table.scope),
  index("idx_interlock_rules_source").on(table.sourceType),
  index("idx_interlock_rules_enabled").on(table.enabled),
]);

export type InterlockRule = typeof interlockRules.$inferSelect;
export type InsertInterlockRule = typeof interlockRules.$inferInsert;

/**
 * Interlock Events — bản ghi mỗi lần một rule "fired". status phản ánh kết quả:
 * alert_only (action=alert / rule chưa duyệt), proposed (block/stop + HITL),
 * skipped (auto block/stop — KHÔNG ghi lệnh trong F5a), resolved/failed.
 * andonEventId/commandLogId liên kết tới Andon đã raise / (F5b) command log.
 */
export const interlockEvents = pgTable("interlock_events", {
  id: serial("id").primaryKey(),
  ruleId: integer("ruleId").notNull(),
  firedAt: timestamp("firedAt").defaultNow().notNull(),
  sourceType: interlockSourceTypeEnum("sourceType"),
  observedValue: decimal("observedValue", { precision: 18, scale: 6 }),
  threshold: decimal("threshold", { precision: 18, scale: 6 }),
  detail: jsonb("detail"),
  action: interlockActionEnum("action"),
  status: interlockEventStatusEnum("status").default("fired").notNull(),
  andonEventId: integer("andonEventId"),
  commandLogId: integer("commandLogId"),
  pendingActionId: varchar("pendingActionId", { length: 64 }),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: integer("resolvedBy"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_interlock_events_rule").on(table.ruleId),
  index("idx_interlock_events_fired").on(table.firedAt),
  index("idx_interlock_events_status").on(table.status),
]);

export type InterlockEvent = typeof interlockEvents.$inferSelect;
export type InsertInterlockEvent = typeof interlockEvents.$inferInsert;
