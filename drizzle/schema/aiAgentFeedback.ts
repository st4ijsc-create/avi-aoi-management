/**
 * ★★★ AI Local Đợt 5 (2026-10-17) — migration `0397`: hai bảng của "Training làm AI thông minh hơn".
 *
 *   • `ai_agent_feedback` — PHẢN HỒI từ dùng thật (5.1): 👍/👎 + lý do cho câu trả lời của một lượt agent (runId + chỉ số
 *     khối trả lời) và cho diff được duyệt/bác (đường dẫn, diff ĐÃ CHE bí mật, lý do bác). PHẠM VI CHỦ (`userId`).
 *     Người ghi/đọc DUY NHẤT: `server/db/aiAgentFeedback.ts`.
 *   • `kb_eval_ma_runs` — lượt EVAL MÃ của Training Studio (5.2): corpus BẬT/TẮT (A/B) trong cùng một lượt, chạy nền có
 *     huỷ + %. Người ghi/đọc DUY NHẤT: `server/services/kbStudioEvalMa.ts`.
 *
 * ⚠ CHECK ở `drizzle/0397_ai_phan_hoi_eval_ma.sql` (hình dạng tra-loi/diff; danhGia ∈ {−1, 1}; quyết định ∈ {duyet, bac};
 *   `dang-chay` ⇔ ketThuc NULL; `xong` ⇒ có tongHop). Mốc giờ `timestamptz`, ghi bằng `now()` phía SQL.
 */
import { pgTable, varchar, integer, smallint, text, timestamp, uuid, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const aiAgentFeedback = pgTable(
  "ai_agent_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `tra-loi` | `diff`. */
    loai: varchar("loai", { length: 8 }).notNull(),
    runId: uuid("runId"),
    /** tra-loi: thứ tự KHỐI TRẢ LỜI trong lượt chạy (`khoiTraLoiTuSuKien`), từ 0. */
    chiSoTin: integer("chiSoTin"),
    /** diff: id hàng `ai_pending_actions`. */
    actionId: varchar("actionId", { length: 64 }),
    projectId: varchar("projectId", { length: 64 }),
    /** −1 | 1 | NULL (diff chỉ mang quyết định, chưa bỏ phiếu). */
    danhGia: smallint("danhGia"),
    lyDo: varchar("lyDo", { length: 2000 }),
    /** diff: `duyet` | `bac` — ghi từ CỬA duyệt/bác thật (`thuTucLuotChay`), không từ client. */
    quyetDinh: varchar("quyetDinh", { length: 8 }),
    lyDoBac: varchar("lyDoBac", { length: 2000 }),
    /** Chỉ dẫn của lượt chạy (đã che bí mật). */
    cauHoi: text("cauHoi"),
    /** tra-loi: văn bản trả lời; diff: unified diff — ĐÃ CHE bí mật. */
    noiDung: text("noiDung"),
    duongDan: varchar("duongDan", { length: 1000 }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("ai_agent_feedback_owner_idx").on(table.userId, table.createdAt)],
);

export type AiAgentFeedback = typeof aiAgentFeedback.$inferSelect;
export type InsertAiAgentFeedback = typeof aiAgentFeedback.$inferInsert;

export const kbEvalMaRuns = pgTable(
  "kb_eval_ma_runs",
  {
    id: uuid("id").primaryKey(),
    corpus: varchar("corpus", { length: 120 }).notNull(),
    /** Tên tệp bộ bài trong `scripts/ai-eval/codegen-chay-duoc/` (không đuôi). */
    boBai: varchar("boBai", { length: 120 }).notNull(),
    boBaiHash: varchar("boBaiHash", { length: 16 }).notNull(),
    /** `dang-chay` | `xong` | `huy` | `loi` | `khong-do-duoc`. */
    trangThai: varchar("trangThai", { length: 16 }).notNull(),
    tienDo: integer("tienDo").default(0).notNull(),
    soBai: integer("soBai").notNull(),
    soLap: integer("soLap").notNull(),
    tongHop: jsonb("tongHop"),
    ketQua: jsonb("ketQua").default([]).notNull(),
    lyDo: varchar("lyDo", { length: 1000 }),
    /** Tiến trình giữ hàng `dang-chay` (máy:pid). */
    tienTrinh: varchar("tienTrinh", { length: 120 }).notNull(),
    createdBy: integer("createdBy").references(() => users.id, { onDelete: "set null" }),
    batDau: timestamp("batDau", { withTimezone: true }).defaultNow().notNull(),
    ketThuc: timestamp("ketThuc", { withTimezone: true }),
    capNhat: timestamp("capNhat", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("kb_eval_ma_runs_corpus_idx").on(table.corpus, table.batDau)],
);

export type KbEvalMaRun = typeof kbEvalMaRuns.$inferSelect;
