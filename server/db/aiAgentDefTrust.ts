/**
 * ★★★ Đợt 11.8 · T6 — TẦNG DỮ LIỆU "tin-lần-đầu theo băm" của định nghĩa agent (`ai_agent_def_trust`, mig 0441).
 *
 * ⚠⚠ LUẬT DUY NHẤT: mọi hàm nhận `userId` là THAM SỐ BẮT BUỘC ĐẦU TIÊN và mọi câu truy vấn mang `eq(userId)` — tin cậy của A
 *   KHÔNG áp cho B. `userId` phải đến từ `ctx.user.id` của phiên đăng nhập, KHÔNG BAO GIỜ từ input/tool/tóm tắt con.
 * ⚠ Hàm xác nhận chỉ được gọi từ thủ tục tRPC của NGƯỜI (không phải công cụ của agent).
 * ⚠ FAIL-CLOSED: CSDL vắng / bảng thiếu / lỗi ⇒ `daTinCay` = false (không bao giờ "tin" vì lỗi).
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./connection";
import { aiAgentDefTrust } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";

const RE_DU_AN = /^[A-Za-z0-9_-]{1,64}$/;
const RE_TEN = /^[a-z][a-z0-9-]{0,31}$/;
const RE_BAM = /^[0-9a-f]{64}$/;

function canhBao(cho: string, err: unknown): void {
  if (!isMissingTable(err)) console.warn(`[aiAgentDefTrust] ${cho} hỏng (degrade):`, err);
}

const hopLeUser = (u: number) => Number.isInteger(u) && u > 0;
const hopLeKhoa = (p: string, t: string) => RE_DU_AN.test(p) && RE_TEN.test(t);

/** Người này đã xác nhận ĐÚNG băm này cho agent này ở dự án này chưa. Lỗi ⇒ false. */
export async function daTinCay(userId: number, projectId: string, agentName: string, contentHash: string): Promise<boolean> {
  if (!hopLeUser(userId) || !hopLeKhoa(projectId, agentName) || !RE_BAM.test(contentHash)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const rows = await db
      .select({ id: aiAgentDefTrust.id })
      .from(aiAgentDefTrust)
      .where(
        and(
          eq(aiAgentDefTrust.userId, userId),
          eq(aiAgentDefTrust.projectId, projectId),
          eq(aiAgentDefTrust.agentName, agentName),
          eq(aiAgentDefTrust.contentHash, contentHash),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    canhBao("daTinCay", err);
    return false;
  }
}

/** Ghi tin cậy (idempotent). Trả false khi tham số méo / CSDL lỗi. */
export async function xacNhanTinCay(userId: number, projectId: string, agentName: string, contentHash: string): Promise<boolean> {
  if (!hopLeUser(userId) || !hopLeKhoa(projectId, agentName) || !RE_BAM.test(contentHash)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(aiAgentDefTrust).values({ userId, projectId, agentName, contentHash }).onConflictDoNothing();
    return true;
  } catch (err) {
    canhBao("xacNhanTinCay", err);
    return false;
  }
}

/** Gỡ MỌI tin cậy của người này cho agent này ở dự án này. Trả số hàng đã gỡ. */
export async function goTinCay(userId: number, projectId: string, agentName: string): Promise<number> {
  if (!hopLeUser(userId) || !hopLeKhoa(projectId, agentName)) return 0;
  const db = await getDb();
  if (!db) return 0;
  try {
    const ra = await db
      .delete(aiAgentDefTrust)
      .where(and(eq(aiAgentDefTrust.userId, userId), eq(aiAgentDefTrust.projectId, projectId), eq(aiAgentDefTrust.agentName, agentName)))
      .returning({ id: aiAgentDefTrust.id });
    return ra.length;
  } catch (err) {
    canhBao("goTinCay", err);
    return 0;
  }
}

/** Các băm người này đã tin ở dự án này: `Map<tên, Set<băm>>`. */
export async function danhSachTinCay(userId: number, projectId: string): Promise<Map<string, Set<string>>> {
  const ra = new Map<string, Set<string>>();
  if (!hopLeUser(userId) || !RE_DU_AN.test(projectId)) return ra;
  const db = await getDb();
  if (!db) return ra;
  try {
    const rows = await db
      .select({ ten: aiAgentDefTrust.agentName, bam: aiAgentDefTrust.contentHash })
      .from(aiAgentDefTrust)
      .where(and(eq(aiAgentDefTrust.userId, userId), eq(aiAgentDefTrust.projectId, projectId)));
    for (const r of rows) {
      const s = ra.get(r.ten) ?? new Set<string>();
      s.add(r.bam);
      ra.set(r.ten, s);
    }
  } catch (err) {
    canhBao("danhSachTinCay", err);
  }
  return ra;
}
