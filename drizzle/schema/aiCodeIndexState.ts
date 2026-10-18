/**
 * ★★★ (2026-10-17) — bảng `ai_code_index_state`, migration `0395`: TRẠNG THÁI LƯỢT DỰNG chỉ mục ngữ nghĩa mã
 * (`ai_code_chunks`, 0391) theo (dự án × model nhúng). `san-sang` CHỈ khi hàng = `xong` — "có đoạn trong bảng" không
 * chứng minh lượt dựng đã trọn (đo sống: 393/~50.000 đoạn khai "sẵn sàng" mãi).
 *
 * ⚠ Người ghi/đọc DUY NHẤT là `server/services/ai/chiMucMa/nguNghia.ts` (SQL tay, mốc giờ ghi bằng `now()` phía SQL).
 * ⚠ CHECK ở `drizzle/0395_ai_code_index_state.sql`: trạng thái ∈ 4 giá trị; `dang-dung` ⇔ `ketThuc` NULL.
 */
import { pgTable, varchar, integer, boolean, timestamp, uuid, primaryKey } from "drizzle-orm/pg-core";

export const aiCodeIndexState = pgTable(
  "ai_code_index_state",
  {
    projectId: varchar("projectId", { length: 64 }).notNull(),
    /** Model nhúng — đổi model ⇒ hàng khác ⇒ chưa `xong`. */
    moHinh: varchar("moHinh", { length: 200 }).notNull(),
    /** `dang-dung` | `xong` | `do-dang` | `loi`. */
    trangThai: varchar("trangThai", { length: 16 }).notNull(),
    batDau: timestamp("batDau", { withTimezone: true }).defaultNow().notNull(),
    ketThuc: timestamp("ketThuc", { withTimezone: true }),
    soTep: integer("soTep").default(0).notNull(),
    soDoan: integer("soDoan").default(0).notNull(),
    /** Chạm trần cấu trúc (tệp/đoạn/byte) — chỉ mục `xong` nhưng thiếu phần ngoài trần. */
    catBot: boolean("catBot").default(false).notNull(),
    /** Lỗi rút gọn (đã che). */
    loi: varchar("loi", { length: 500 }),
    /** Tiến trình giữ hàng `dang-dung` (máy:pid:ngẫu nhiên). */
    tienTrinh: varchar("tienTrinh", { length: 120 }).notNull(),
    /** Id lượt dựng — chỉ lượt đã ghi `dang-dung` mới được chốt hàng. */
    luot: uuid("luot").notNull(),
    /** Nhịp sống lúc `dang-dung` (30 s); quá hạn ⇒ tiến trình đã chết. */
    capNhat: timestamp("capNhat", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.moHinh] })],
);

export type AiCodeIndexState = typeof aiCodeIndexState.$inferSelect;
export type InsertAiCodeIndexState = typeof aiCodeIndexState.$inferInsert;
