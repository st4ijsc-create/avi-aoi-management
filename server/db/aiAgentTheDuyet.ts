/**
 * ★★★ Đợt 11.8 · M4/S7 — thẻ duyệt GẮN LƯỢT AGENT (cột `ai_pending_actions."agentRunId"`, mig 0442) và cổng CHUNG của `confirmAction`.
 *
 * ⚠ Thẻ được gắn lượt NGAY TRONG câu INSERT của `proposeAction` (ctx.agentRunId) — KHÔNG có bước UPDATE gắn sau (khe fail-open).
 *
 * Bất biến: thẻ có `agentRunId` chỉ duyệt được khi lượt đó và MỌI tổ tiên (`ai_agent_runs.parentRunId`) còn `dang-chay`/`cho-duyet`,
 * cùng chủ với người duyệt. Không thấy hàng sổ / lỗi CSDL ⇒ KHÔNG hoạt động (fail-closed). Không phụ thuộc bộ nhớ tiến trình.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./connection";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lượt + mọi tổ tiên còn sống và cùng chủ? Hàng thiếu / lỗi ⇒ false. */
export async function luotConSong(runId: string, userId: number): Promise<boolean> {
  if (!RE_UUID.test(runId) || !Number.isInteger(userId) || userId <= 0) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const r = (await db.execute(sql`
      WITH RECURSIVE chuoi AS (
        SELECT id, "parentRunId", "trangThai", "userId", 0 AS d FROM ai_agent_runs WHERE id = ${runId}::uuid
        UNION ALL
        SELECT r.id, r."parentRunId", r."trangThai", r."userId", c.d + 1
          FROM ai_agent_runs r JOIN chuoi c ON r.id = c."parentRunId" WHERE c.d < 4
      )
      SELECT count(*)::int AS tong,
             count(*) FILTER (WHERE "trangThai" IN ('dang-chay', 'cho-duyet') AND "userId" = ${userId})::int AS tot
        FROM chuoi`)) as unknown as Array<{ tong: number; tot: number }>;
    const h = r[0];
    return !!h && h.tong >= 1 && h.tong === h.tot;
  } catch (err) {
    console.warn("[aiAgentTheDuyet] luotConSong hỏng (fail-closed):", err);
    return false;
  }
}

/** Đóng (huỷ) mọi thẻ `proposed` của lượt này VÀ mọi hậu duệ. Trả số thẻ đã đóng. */
export async function dongTheCuaCay(rootRunId: string): Promise<number> {
  if (!RE_UUID.test(rootRunId)) return 0;
  const db = await getDb();
  if (!db) return 0;
  try {
    const r = (await db.execute(sql`
      WITH RECURSIVE cay AS (
        SELECT id, 0 AS d FROM ai_agent_runs WHERE id = ${rootRunId}::uuid
        UNION ALL
        SELECT r.id, c.d + 1 FROM ai_agent_runs r JOIN cay c ON r."parentRunId" = c.id WHERE c.d < 4
      )
      UPDATE ai_pending_actions SET status = 'cancelled'
       WHERE status = 'proposed' AND "agentRunId" IN (SELECT id FROM cay) RETURNING id`)) as unknown as unknown[];
    return r.length;
  } catch (err) {
    console.warn("[aiAgentTheDuyet] dongTheCuaCay hỏng:", err);
    return 0;
  }
}
