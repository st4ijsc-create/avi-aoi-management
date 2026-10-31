/**
 * ★★★ Đợt 12 · H5.4 (2026-10-31) — tầng dữ liệu LỊCH SỬ MODEL của lượt agent (`ai_agent_run_lich_su`, mig 0450) để TIẾP TỤC lượt gián đoạn.
 *
 * ⚠⚠ PHẠM VI CHỦ LƯỢT CHẠY: `eq(userId)` nằm trong MỌI câu — runId của người khác ≡ không tồn tại. FK kép ở CSDL giữ bản lưu cùng chủ với lượt.
 * ⚠ Bản lưu do MÁY CHỦ dựng (che bí mật + trần ở `khoLichSuLuot.ts`); tầng này không tin và không nhận gì từ client.
 * ⚠ Hỏng CSDL không bao giờ làm hỏng lượt: ghi lỗi ⇒ `false`; đọc lỗi ⇒ `null`. "Tiếp tục" đánh dấu bằng MỘT câu UPDATE có điều kiện ⇒ chỉ MỘT lần/nguồn.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import type { TinNhan } from "@shared/agentCore";
import { getDb } from "./connection";
import { aiAgentRunLichSu } from "../../drizzle/schema";
import { RE_ID_LUOT_CHAY } from "./aiAgentRuns";

const laUser = (u: number) => Number.isInteger(u) && u > 0;
const canhBao = (cho: string, err: unknown) => console.warn(`[aiAgentLichSu] ${cho} hỏng:`, err);

/** Ghi / thay bản lưu của lượt (UPSERT theo runId). Không đụng `daTiepTucBoi` của hàng đã có. */
export async function luuLichSu(userId: number, runId: string, tinNhan: readonly TinNhan[], buoc: number): Promise<boolean> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const ra = await db
      .insert(aiAgentRunLichSu)
      .values({ runId, userId, tinNhan: tinNhan as unknown as object, soTin: tinNhan.length, buoc: Math.max(0, Math.floor(buoc)) })
      .onConflictDoUpdate({
        target: aiAgentRunLichSu.runId,
        set: { tinNhan: tinNhan as unknown as object, soTin: tinNhan.length, buoc: Math.max(0, Math.floor(buoc)), capNhatLuc: new Date() },
        setWhere: eq(aiAgentRunLichSu.userId, userId),
      })
      .returning({ runId: aiAgentRunLichSu.runId });
    // ON CONFLICT ... WHERE userId: hàng của NGƯỜI KHÁC ⇒ không cập nhật, không lỗi, không RETURNING ⇒ coi là KHÔNG ghi được
    return ra.length === 1;
  } catch (err) {
    canhBao("luuLichSu", err);
    return false;
  }
}

export async function xoaLichSu(userId: number, runId: string): Promise<boolean> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    await db.delete(aiAgentRunLichSu).where(and(eq(aiAgentRunLichSu.runId, runId), eq(aiAgentRunLichSu.userId, userId)));
    return true;
  } catch (err) {
    canhBao("xoaLichSu", err);
    return false;
  }
}

export interface BanLuu {
  tinNhan: TinNhan[];
  buoc: number;
  daTiepTucBoi: string | null;
}

/** Đọc bản lưu của lượt CỦA MÌNH; id méo / người khác / không có / lỗi ⇒ `null` (cùng giá trị). */
export async function docLichSu(userId: number, runId: string): Promise<BanLuu | null> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const [h] = await db
      .select({ tinNhan: aiAgentRunLichSu.tinNhan, buoc: aiAgentRunLichSu.buoc, daTiepTucBoi: aiAgentRunLichSu.daTiepTucBoi })
      .from(aiAgentRunLichSu)
      .where(and(eq(aiAgentRunLichSu.runId, runId), eq(aiAgentRunLichSu.userId, userId)))
      .limit(1);
    if (!h || !Array.isArray(h.tinNhan)) return null;
    return { tinNhan: h.tinNhan as TinNhan[], buoc: h.buoc, daTiepTucBoi: h.daTiepTucBoi };
  } catch (err) {
    canhBao("docLichSu", err);
    return null;
  }
}

/** Đánh dấu nguồn đã được tiếp tục bởi `runIdMoi` — MỘT câu UPDATE có điều kiện: chỉ lần ĐẦU thắng (`true`). Lỗi ⇒ `false` (không tiếp tục). */
export async function danhDauTiepTuc(userId: number, runId: string, runIdMoi: string): Promise<boolean> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId) || !RE_ID_LUOT_CHAY.test(runIdMoi) || runId === runIdMoi) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const ra = await db
      .update(aiAgentRunLichSu)
      .set({ daTiepTucBoi: runIdMoi })
      .where(and(eq(aiAgentRunLichSu.runId, runId), eq(aiAgentRunLichSu.userId, userId), sql`${aiAgentRunLichSu.daTiepTucBoi} IS NULL`))
      .returning({ runId: aiAgentRunLichSu.runId });
    return ra.length === 1;
  } catch (err) {
    canhBao("danhDauTiepTuc", err);
    return false;
  }
}

/** Gỡ dấu khi lượt MỚI không tạo được (chỉ gỡ đúng dấu của `runIdMoi`). */
export async function goDauTiepTuc(userId: number, runId: string, runIdMoi: string): Promise<void> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId) || !RE_ID_LUOT_CHAY.test(runIdMoi)) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(aiAgentRunLichSu)
      .set({ daTiepTucBoi: null })
      .where(and(eq(aiAgentRunLichSu.runId, runId), eq(aiAgentRunLichSu.userId, userId), eq(aiAgentRunLichSu.daTiepTucBoi, runIdMoi)));
  } catch (err) {
    canhBao("goDauTiepTuc", err);
  }
}

/** Dọn bản lưu cũ hơn `ngay` ngày (mọi người — việc bảo trì, không phải đường người dùng). Trả số hàng xoá, −1 khi lỗi. */
export async function donLichSuCu(ngay: number): Promise<number> {
  const db = await getDb();
  if (!db) return -1;
  try {
    const han = new Date(Date.now() - Math.max(1, ngay) * 24 * 60 * 60_000);
    const ra = await db.delete(aiAgentRunLichSu).where(lt(aiAgentRunLichSu.capNhatLuc, han)).returning({ runId: aiAgentRunLichSu.runId });
    return ra.length;
  } catch (err) {
    canhBao("donLichSuCu", err);
    return -1;
  }
}
