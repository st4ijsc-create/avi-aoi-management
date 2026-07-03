// Schema domain: Control Audit Log (audit doc 25 · T6 / task W2-7)
//
// ════════════════════════════════════════════════════════════════════════════
// Sổ audit APPEND-ONLY dùng chung cho các mutation cấu hình / an toàn: interlock
// rules (create/update/approve/enable/disable/delete), Equipment Standards Board
// (register/review/publish), và workforce/collaboration (close/abort).
//
// Mỗi dòng là MỘT sự kiện bất biến: AI (actorId) làm GÌ (action) lên thực thể nào
// (entityType/entityId), kèm ảnh chụp before/after (jsonb, tùy chọn) + lý do.
//
// BẤT BIẾN là quy ước ép ở tầng service — helper recordAuditEvent CHỈ INSERT (không
// cung cấp update/delete). Bảng additive (CREATE TABLE/INDEX, không ALTER TYPE, không
// enum pg mới) — action/entityType là varchar thường. entityId là varchar để chứa
// được cả id số (interlock rule, assignment, session) lẫn khóa chuỗi (crKey).
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";

export const controlAuditLog = pgTable("control_audit_log", {
  id: serial("id").primaryKey(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  action: varchar("action", { length: 48 }).notNull(),
  actorId: integer("actorId"),
  beforeJson: jsonb("beforeJson"),
  afterJson: jsonb("afterJson"),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_control_audit_entity").on(table.entityType, table.entityId),
  index("idx_control_audit_actor").on(table.actorId),
  index("idx_control_audit_created").on(table.createdAt),
]);

export type ControlAuditLog = typeof controlAuditLog.$inferSelect;
export type InsertControlAuditLog = typeof controlAuditLog.$inferInsert;
