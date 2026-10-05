// Schema domain: Engineering assignments (doc 81 Đợt 3 Task 4, QĐ-3a, migration 0363)
//
// ════════════════════════════════════════════════════════════════════════════
// Người được giao cho một mục CHỜ DUYỆT của tầng Kỹ thuật (ECN · recipe nháp · interlock rule · changeover ·
// orchestration run đang giữ). Bảng CHUNG — không thêm cột vào bảng nghiệp vụ. Danh sách loại hợp lệ ở
// `shared/engineeringAssignment.ts` (một chỗ duy nhất; DB không có CHECK lặp lại).
//
// BẤT BIẾN:
//   • tối đa MỘT hàng `active` cho mỗi (entity_type, entity_id) — `uq_engineering_assignments_one_active`
//     (UNIQUE … WHERE active); bỏ giao / giao lại = `active=false` trên hàng cũ, hàng mới cho người mới;
//   • `avi_app` chỉ UPDATE được cột `active` (quyền mức cột) — không sửa người/thời điểm, không DELETE;
//   • ĐƯỢC GIAO ≠ ĐƯỢC DUYỆT — không cổng duyệt / maker-checker nào đọc bảng này.
//   • (fix 1, R-3-f) phân công chỉ SỐNG trong ĐỢT chờ duyệt lúc giao (`pending_episode`); mục rời chờ duyệt ⇒ hết.
// Tên cột snake_case đúng như QĐ-3a của chủ dự án.
// ════════════════════════════════════════════════════════════════════════════
import { pgTable, serial, integer, varchar, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const engineeringAssignments = pgTable("engineering_assignments", {
  id: serial("id").primaryKey(),
  entityType: varchar("entity_type", { length: 32 }).notNull(),
  entityId: integer("entity_id").notNull(),
  assigneeUserId: integer("assignee_user_id").notNull(),
  assignedBy: integer("assigned_by").notNull(),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  note: text("note"),
  active: boolean("active").default(true).notNull(),
  /**
   * doc 81 Đợt 3 Task 4 fix 1 (R-3-f) — khoá ĐỢT CHỜ DUYỆT của mục lúc giao (`EPISODE_SQL` ở
   * `services/engineeringAssignment/assignmentService.ts`). Phân công chỉ "sống" khi khoá này BẰNG khoá hiện tại.
   */
  pendingEpisode: varchar("pending_episode", { length: 160 }).default("").notNull(),
}, (table) => [
  index("idx_engineering_assignments_assignee_active").on(table.assigneeUserId, table.active),
  uniqueIndex("uq_engineering_assignments_one_active").on(table.entityType, table.entityId).where(sql`${table.active}`),
]);

export type EngineeringAssignment = typeof engineeringAssignments.$inferSelect;
export type InsertEngineeringAssignment = typeof engineeringAssignments.$inferInsert;
