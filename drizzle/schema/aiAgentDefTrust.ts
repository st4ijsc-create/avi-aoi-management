/**
 * ★★★ Đợt 11.8 · T5 (2026-10-27) — bảng `ai_agent_def_trust`, migration `0441`: TIN-LẦN-ĐẦU theo BĂM cho định nghĩa agent
 * (`.thoca/agents/<tên>.md`, nguồn repo = KHÔNG TIN CẬY). Người dùng đọc nội dung hiển thị rồi xác nhận BĂM; `delegate` chỉ
 * dùng định nghĩa khi băm TÍNH LẠI lúc dùng khớp một hàng của CHÍNH người đó cho dự án đó.
 *
 * ⚠ Phạm vi CHỦ (`userId` trong mệnh đề WHERE — `server/db/aiAgentDefTrust.ts`): tin cậy của A không áp cho B.
 * ⚠ CHECK ở `drizzle/0441_ai_agent_cha_con_tin_cay.sql`: projectId là ID, tên agent đúng dạng, băm 64 hex.
 */
import { pgTable, uuid, integer, varchar, char, timestamp, index, unique } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const aiAgentDefTrust = pgTable(
  "ai_agent_def_trust",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: varchar("projectId", { length: 64 }).notNull(),
    agentName: varchar("agentName", { length: 32 }).notNull(),
    contentHash: char("contentHash", { length: 64 }).notNull(),
    confirmedAt: timestamp("confirmedAt").defaultNow().notNull(),
  },
  (table) => [
    unique("uq_ai_agent_def_trust_key").on(table.userId, table.projectId, table.agentName, table.contentHash),
    index("ai_agent_def_trust_owner_idx").on(table.userId, table.projectId, table.agentName),
  ],
);

export type AiAgentDefTrust = typeof aiAgentDefTrust.$inferSelect;
export type InsertAiAgentDefTrust = typeof aiAgentDefTrust.$inferInsert;
