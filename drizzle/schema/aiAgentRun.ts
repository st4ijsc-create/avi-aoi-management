/**
 * ★★★ Đợt 1 · T4 (2026-10-17) — bảng `ai_agent_runs`, migration `0390`: SỔ lượt chạy của vòng agent máy chủ
 * (`server/services/ai/agent/quanLyLuotChay.ts`). Lượt chạy sống trong bộ nhớ; hàng này giữ trạng thái,
 * bộ đếm, checkpoint và bản ghi sự kiện ĐÃ GỘP để xem lại / nối lại sau khi rời bộ nhớ.
 *
 * ⚠ Phạm vi CHỦ LƯỢT CHẠY (`userId` trong mệnh đề WHERE — `server/db/aiAgentRuns.ts`), như `ai_coding_sessions`.
 * ⚠ CHECK ở `drizzle/0390_ai_agent_runs.sql`: projectId là ID (không đường dẫn), cheDo/trangThai trong tập, mảng jsonb.
 */
import { pgTable, uuid, integer, varchar, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const aiAgentRuns = pgTable(
  "ai_agent_runs",
  {
    /** Server sinh (`randomUUID`) — cũng là `runId` của checkpoint (T3). */
    id: uuid("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: varchar("projectId", { length: 64 }).notNull(),
    /** `hoi` | `sua` | `tu-dong` */
    cheDo: varchar("cheDo", { length: 16 }).notNull(),
    cauHoi: text("cauHoi").notNull(),
    /** `dang-chay` | `cho-duyet` | `xong` | `huy` | `loi` | `gian-doan` */
    trangThai: varchar("trangThai", { length: 16 }).notNull().default("dang-chay"),
    /** `LyDoDung` của lõi (hoan-thanh, het-luot, …) khi lượt kết thúc. */
    lyDoDung: varchar("lyDoDung", { length: 32 }),
    soLuot: integer("soLuot").notNull().default(0),
    tokenVao: integer("tokenVao").notNull().default(0),
    tokenRa: integer("tokenRa").notNull().default(0),
    tokenNghi: integer("tokenNghi").notNull().default(0),
    /** `[{seq, suKien}]` — đã gộp delta liền nhau, cắt trần ở tầng ứng dụng. */
    suKien: jsonb("suKien").notNull().default([]),
    checkpointIds: jsonb("checkpointIds").notNull().default([]),
    tomTat: text("tomTat"),
    sessionId: uuid("sessionId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [index("ai_agent_runs_owner_idx").on(table.userId, table.projectId, table.createdAt)],
);

export type AiAgentRun = typeof aiAgentRuns.$inferSelect;
export type InsertAiAgentRun = typeof aiAgentRuns.$inferInsert;
