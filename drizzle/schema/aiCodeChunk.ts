/**
 * ★★★ Đợt 2 (2026-10-17) — bảng `ai_code_chunks`, migration `0391`: CHỈ MỤC NGỮ NGHĨA mã nguồn theo DỰ ÁN cho vòng
 * agent (`server/services/ai/chiMucMa/nguNghia.ts`, tool `search_code`).
 *
 * ⚠ Mọi truy vấn khoá theo `projectId` (cách ly dự án) — người ghi/đọc DUY NHẤT là `nguNghia.ts` (SQL tay qua
 *   `db.execute`, vì drizzle không sinh được toán tử `<=>` của pgvector).
 * ⚠ CHECK ở `drizzle/0391_ai_code_chunks.sql`: projectId là ID, `duong` tương đối POSIX không `..`, băm hex64, dòng tăng.
 * ⚠ KHÔNG HNSW (cố ý): lọc `projectId` + HNSW của pgvector = lọc SAU ứng viên ⇒ mất recall im lặng; xem tệp SQL.
 */
import { pgTable, uuid, varchar, char, integer, text, timestamp, index, customType } from "drizzle-orm/pg-core";

/** pgvector `vector(N)` — bản sao cục bộ khuôn `kbStudio.ts` (helper ở `ai.ts` không được export). */
const pgvector = (soChieu: number) =>
  customType<{ data: string; driverData: string }>({
    dataType() {
      return `vector(${soChieu})`;
    },
  });

export const aiCodeChunks = pgTable(
  "ai_code_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: varchar("projectId", { length: 64 }).notNull(),
    /** Đường TƯƠNG ĐỐI POSIX trong gốc dự án. */
    duong: varchar("duong", { length: 1024 }).notNull(),
    /** sha256 hex của nội dung TỆP lúc nhúng — không đổi ⇒ không nhúng lại. */
    bam: char("bam", { length: 64 }).notNull(),
    dongDau: integer("dongDau").notNull(),
    dongCuoi: integer("dongCuoi").notNull(),
    /** Đoạn mã ĐÃ CHE BÍ MẬT. */
    noiDung: text("noiDung").notNull(),
    /** Tên model nhúng — tìm kiếm lọc theo cột này (đổi model ⇒ khác không gian vector). */
    moHinh: varchar("moHinh", { length: 200 }).notNull(),
    embedding: pgvector(1024)("embedding").notNull(),
    capNhat: timestamp("capNhat").defaultNow().notNull(),
  },
  (table) => [index("ai_code_chunks_du_an_tep_idx").on(table.projectId, table.duong)],
);

export type AiCodeChunk = typeof aiCodeChunks.$inferSelect;
export type InsertAiCodeChunk = typeof aiCodeChunks.$inferInsert;
