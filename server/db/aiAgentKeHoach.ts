/**
 * ★★★ Đợt 11.3-C (2026-10-31) — tầng dữ liệu CỔNG DUYỆT KẾ HOẠCH trên `ai_agent_runs` (mig 0444, cột `keHoach*`).
 *
 * ⚠⚠ PHẠM VI CHỦ LƯỢT CHẠY: `eq(userId)` nằm trong MỌI câu — runId của người khác ≡ không tồn tại (cùng kết quả, không kênh dò).
 * ⚠ Chuyển trạng thái là MỘT câu UPDATE có điều kiện (id · userId · trạng thái hiện tại · băm) ⇒ chỉ MỘT quyết định thắng, không có
 *   đọc-rồi-ghi. Lượt phải còn sống (`dang-chay`|`cho-duyet`) mới được nộp/duyệt.
 * ⚠ Hỏng CSDL KHÔNG BAO GIỜ thành "được duyệt": nộp lỗi ⇒ `false` (host coi là BÁC); duyệt lỗi ⇒ `loi-csdl`.
 * ⚠ Hàm KHÔNG tin băm do kẻ gọi tính: `nopKeHoach` làm sạch + tính băm LẠI bằng hàm dùng chung (`@shared/agentCore` keHoach).
 */
import { and, eq, inArray } from "drizzle-orm";
import { chuanHoaKeHoach, type ViecKeHoach } from "@shared/agentCore";
import { getDb } from "./connection";
import { aiAgentRuns } from "../../drizzle/schema";
import { RE_ID_LUOT_CHAY } from "./aiAgentRuns";

export type TrangThaiKeHoach = "cho" | "duyet" | "bac" | "het-gio";
const SONG = ["dang-chay", "cho-duyet"] as const;
const laUser = (u: number) => Number.isInteger(u) && u > 0;

export interface HangKeHoach {
  bam: string;
  viec: ViecKeHoach[];
  trangThai: TrangThaiKeHoach;
  nopLuc: Date | null;
  duyetLuc: Date | null;
  duyetBoi: number | null;
}

function canhBao(cho: string, err: unknown): void {
  console.warn(`[aiAgentKeHoach] ${cho} hỏng (fail-closed):`, err);
}

/** Nộp (hoặc nộp LẠI sau khi đổi bước) một kế hoạch chờ duyệt. Trả băm máy chủ tính; `null` = KHÔNG nộp được (host phải coi là bác). */
export async function nopKeHoach(userId: number, runId: string, viec: readonly { noiDung: unknown; trangThai?: unknown }[]): Promise<{ bam: string; viec: ViecKeHoach[] } | null> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return null;
  const ch = chuanHoaKeHoach(viec);
  if (!ch.ok) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const ra = await db
      .update(aiAgentRuns)
      .set({
        keHoachBam: ch.bam,
        keHoachViec: ch.viec,
        keHoachTrangThai: "cho",
        keHoachNopLuc: new Date(),
        keHoachDuyetLuc: null,
        keHoachDuyetBoi: null,
        updatedAt: new Date(),
      })
      .where(and(eq(aiAgentRuns.id, runId), eq(aiAgentRuns.userId, userId), inArray(aiAgentRuns.trangThai, [...SONG])))
      .returning({ id: aiAgentRuns.id });
    return ra.length > 0 ? { bam: ch.bam, viec: ch.viec } : null;
  } catch (err) {
    canhBao("nopKeHoach", err);
    return null;
  }
}

/** Đọc kế hoạch của lượt (của CHÍNH userId). `null` = không có lượt / chưa nộp kế hoạch nào / lỗi. */
export async function docKeHoach(userId: number, runId: string): Promise<HangKeHoach | null> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const [h] = await db
      .select({
        bam: aiAgentRuns.keHoachBam,
        viec: aiAgentRuns.keHoachViec,
        trangThai: aiAgentRuns.keHoachTrangThai,
        nopLuc: aiAgentRuns.keHoachNopLuc,
        duyetLuc: aiAgentRuns.keHoachDuyetLuc,
        duyetBoi: aiAgentRuns.keHoachDuyetBoi,
      })
      .from(aiAgentRuns)
      .where(and(eq(aiAgentRuns.id, runId), eq(aiAgentRuns.userId, userId)))
      .limit(1);
    if (!h || !h.bam || !h.trangThai) return null;
    return {
      bam: h.bam,
      viec: Array.isArray(h.viec) ? (h.viec as ViecKeHoach[]) : [],
      trangThai: h.trangThai as TrangThaiKeHoach,
      nopLuc: h.nopLuc,
      duyetLuc: h.duyetLuc,
      duyetBoi: h.duyetBoi,
    };
  } catch (err) {
    canhBao("docKeHoach", err);
    return null;
  }
}

export type KetQuaQuyetKeHoach =
  | { ok: true; trangThai: "duyet" | "bac"; luc: Date }
  | { ok: false; ma: "NOT_FOUND" | "CONFLICT" | "DA_QUYET" | "LOI_CSDL" };

/**
 * Người quyết định (duyệt/bác) MỘT kế hoạch đang chờ. Một câu UPDATE: chỉ thắng khi lượt còn sống, trạng thái đang `cho` VÀ băm khớp
 * băm máy chủ lưu (băm client gửi chỉ để so — không bao giờ ghi). Thua ⇒ đọc lại để phân biệt mã (chỉ trả mã, không lộ gì khác).
 */
export async function quyetKeHoach(userId: number, runId: string, bamDaXem: string, quyet: "duyet" | "bac"): Promise<KetQuaQuyetKeHoach> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return { ok: false, ma: "NOT_FOUND" };
  const db = await getDb();
  if (!db) return { ok: false, ma: "LOI_CSDL" };
  try {
    const bay = new Date();
    const ra = await db
      .update(aiAgentRuns)
      .set({ keHoachTrangThai: quyet, keHoachDuyetLuc: bay, keHoachDuyetBoi: userId, updatedAt: bay })
      .where(
        and(
          eq(aiAgentRuns.id, runId),
          eq(aiAgentRuns.userId, userId),
          inArray(aiAgentRuns.trangThai, [...SONG]),
          eq(aiAgentRuns.keHoachTrangThai, "cho"),
          eq(aiAgentRuns.keHoachBam, bamDaXem),
        ),
      )
      .returning({ id: aiAgentRuns.id });
    if (ra.length > 0) return { ok: true, trangThai: quyet, luc: bay };
    const h = await docKeHoach(userId, runId);
    if (!h) return { ok: false, ma: "NOT_FOUND" };
    if (h.trangThai !== "cho") return { ok: false, ma: "DA_QUYET" };
    return { ok: false, ma: h.bam !== bamDaXem ? "CONFLICT" : "DA_QUYET" };
  } catch (err) {
    canhBao("quyetKeHoach", err);
    return { ok: false, ma: "LOI_CSDL" };
  }
}

/** Host chốt một kế hoạch còn `cho` (huỷ lượt / hết giờ). Có điều kiện `cho` + băm ⇒ không đè quyết định của người. Trả có chốt được không. */
export async function chotKeHoachDangCho(userId: number, runId: string, bam: string, thanh: "bac" | "het-gio"): Promise<boolean> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const ra = await db
      .update(aiAgentRuns)
      .set({ keHoachTrangThai: thanh, updatedAt: new Date() })
      .where(and(eq(aiAgentRuns.id, runId), eq(aiAgentRuns.userId, userId), eq(aiAgentRuns.keHoachTrangThai, "cho"), eq(aiAgentRuns.keHoachBam, bam)))
      .returning({ id: aiAgentRuns.id });
    return ra.length > 0;
  } catch (err) {
    canhBao("chotKeHoachDangCho", err);
    return false;
  }
}

/** Dọn khi lượt kết thúc: mọi kế hoạch còn `cho` của lượt ⇒ `bac` (không để treo `cho` trên lượt đã chết). */
export async function chotMoiKeHoachDangCho(userId: number, runId: string): Promise<void> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(runId)) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .update(aiAgentRuns)
      .set({ keHoachTrangThai: "bac", updatedAt: new Date() })
      .where(and(eq(aiAgentRuns.id, runId), eq(aiAgentRuns.userId, userId), eq(aiAgentRuns.keHoachTrangThai, "cho")));
  } catch (err) {
    canhBao("chotMoiKeHoachDangCho", err);
  }
}

