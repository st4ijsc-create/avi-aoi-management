// Schema domain: Andon (Sprint F5a — Andon + Interlock model, ALERT-ONLY)
//
// An Andon is a VISUAL SIGNAL / NOTIFICATION raised when attention is needed
// (quality/material/maintenance/safety/setup). It is NEVER a control command —
// raising an Andon does not, and must not, write to any machine. The interlock
// engine raises system Andons; humans raise manual Andons via the router.
import { pgTable, serial, integer, varchar, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { andonStateEnum, andonReasonEnum, andonStatusEnum } from "./enums";

/**
 * Andon Events — một tín hiệu Andon (đèn báo / thông báo). KHÔNG phải lệnh điều khiển.
 * raisedBySystem=true khi do interlock engine sinh; sourceInterlockEventId liên kết về
 * interlock_events. MTTA = acknowledgedAt - raisedAt; MTTR = resolvedAt - raisedAt.
 */
export const andonEvents = pgTable("andon_events", {
  id: serial("id").primaryKey(),
  state: andonStateEnum("state").notNull(),
  reason: andonReasonEnum("reason").notNull(),
  status: andonStatusEnum("status").default("raised").notNull(),
  lineId: integer("lineId"),
  stationId: integer("stationId"),
  machineId: integer("machineId"),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message"),
  raisedBy: integer("raisedBy"),
  raisedBySystem: boolean("raisedBySystem").default(false).notNull(),
  sourceInterlockEventId: integer("sourceInterlockEventId"),
  raisedAt: timestamp("raisedAt").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
  acknowledgedBy: integer("acknowledgedBy"),
  resolvedAt: timestamp("resolvedAt"),
  resolvedBy: integer("resolvedBy"),
  escalationLevel: integer("escalationLevel").default(0).notNull(),
  mttaSeconds: integer("mttaSeconds"),
  mttrSeconds: integer("mttrSeconds"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("idx_andon_line").on(table.lineId),
  index("idx_andon_station").on(table.stationId),
  index("idx_andon_machine").on(table.machineId),
  index("idx_andon_status").on(table.status),
  index("idx_andon_raised").on(table.raisedAt),
]);

export type AndonEvent = typeof andonEvents.$inferSelect;
export type InsertAndonEvent = typeof andonEvents.$inferInsert;

/**
 * ★★★ ĐỢT 25 VIỆC 2 — GHI CHÚ XỬ LÝ CHO MỘT CẢNH BÁO ANDON (migration `0357`).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MỘT BẢNG RIÊNG, KHÔNG PHẢI MỘT CỘT TRÊN `andon_events`
 * ══════════════════════════════════════════════════════════════════════════════
 * Nghiệp vụ chủ dự án nêu là "**nhiều người cùng xử lý một sự cố**". Một cột `text`
 * trên hàng cảnh báo không đáp ứng được nó — ba lý do, đều đo được:
 *
 *   1. MẤT TÁC GIẢ VÀ THỜI ĐIỂM. Câu hỏi thật của ca trực sau là "ai đã thử gì,
 *      lúc mấy giờ?" — một ô text không trả lời được.
 *   2. GHI ĐÈ HOẶC NỐI CHUỖI, cả hai đều sai. Ghi đè lặp lại đúng lỗi của
 *      `resolve` (`andonService.ts:276` đặt `message: notes ?? current.message`,
 *      tức xoá mô tả gốc của người báo). Nối chuỗi tạo một khối không cấu trúc:
 *      không sắp theo thời gian, không lọc theo người, không sửa được một dòng.
 *   3. MẤT CẬP NHẬT KHI HAI NGƯỜI CÙNG GHI. Cột đơn buộc đọc-sửa-ghi; hai người
 *      bấm gửi cùng lúc thì người sau đè mất ghi chú người trước — **chính** tình
 *      huống nghiệp vụ yêu cầu. Một hàng mỗi ghi chú là INSERT thuần, không đua.
 *
 * Một cột `jsonb` chứa mảng `{tác giả, lúc, chữ}` KHÔNG thoát được (2) và (3): nó
 * là một cái bảng đội lốt một cột, mất thêm khoá ngoại và chỉ mục.
 *
 * ⚠ **Ghi chú KHÔNG đóng cảnh báo.** Bảng này không chạm cột nào của
 *   `andon_events`. Ghi chú = việc ĐANG xử lý; đóng = `resolve`. Hai việc, hai
 *   thủ tục (`andon.ghiChu` vs `andon.resolve`).
 *
 * ⚠ `createdBy` NULLABLE và KHÔNG khoá ngoại sang `users` — cùng hình dạng
 *   `andonEvents.raisedBy` ở trên: một tài khoản bị xoá không được kéo theo lịch
 *   sử xử lý sự cố.
 */
export const andonNotes = pgTable("andon_notes", {
  id: serial("id").primaryKey(),
  andonId: integer("andonId").notNull().references(() => andonEvents.id, { onDelete: "cascade" }),
  note: text("note").notNull(),
  createdBy: integer("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  // Đường đọc DUY NHẤT: "mọi ghi chú của MỘT cảnh báo, mới nhất trước".
  index("idx_andon_notes_andon_created").on(table.andonId, table.createdAt),
]);

export type AndonNote = typeof andonNotes.$inferSelect;
export type InsertAndonNote = typeof andonNotes.$inferInsert;
