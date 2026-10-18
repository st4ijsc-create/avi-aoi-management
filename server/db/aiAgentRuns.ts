/**
 * ★★★ Đợt 1 · T4 (2026-10-17) — tầng dữ liệu của bảng `ai_agent_runs` (mig 0390): sổ lượt chạy vòng agent máy chủ.
 *
 * ⚠⚠ PHẠM VI CHỦ LƯỢT CHẠY — `eq(userId)` nằm trong MỌI mệnh đề WHERE đọc/ghi theo id (khuôn `aiCodingSessions.ts`):
 *   một `runId` đoán trúng của người khác cho ra CÙNG kết quả với "không tồn tại" (không có kênh đếm lượt chạy).
 *   Ngoại lệ DUY NHẤT: `danhDauGianDoanKhiBoot` — việc của tiến trình lúc khởi động, không nhận đầu vào người dùng.
 * ⚠ Hỏng CSDL ⇒ suy giảm (trả rỗng/false + cảnh báo), KHÔNG ném: lượt chạy sống trong bộ nhớ và không được chết vì sổ.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "./connection";
import { aiAgentRuns, type AiAgentRun } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";

export const RE_ID_LUOT_CHAY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_ID_DU_AN = /^[A-Za-z0-9_-]{1,64}$/;
export const TRAN_DANH_SACH_LUOT_CHAY = 50;

export type TrangThaiLuotChay = "dang-chay" | "cho-duyet" | "xong" | "huy" | "loi" | "gian-doan";

function canhBao(cho: string, err: unknown): void {
  if (!isMissingTable(err)) console.warn(`[aiAgentRuns] ${cho} hỏng (degrade):`, err);
}

const laUser = (u: number) => Number.isInteger(u) && u > 0;

export async function taoHangLuotChay(h: {
  id: string;
  userId: number;
  projectId: string;
  cheDo: string;
  cauHoi: string;
  sessionId?: string | null;
}): Promise<boolean> {
  if (!laUser(h.userId) || !RE_ID_LUOT_CHAY.test(h.id) || !RE_ID_DU_AN.test(h.projectId)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    await db.insert(aiAgentRuns).values({
      id: h.id,
      userId: h.userId,
      projectId: h.projectId,
      cheDo: h.cheDo,
      cauHoi: h.cauHoi,
      sessionId: h.sessionId && RE_ID_LUOT_CHAY.test(h.sessionId) ? h.sessionId : null,
    });
    return true;
  } catch (err) {
    canhBao("taoHangLuotChay", err);
    return false;
  }
}

export interface CapNhatLuotChay {
  trangThai?: TrangThaiLuotChay;
  lyDoDung?: string | null;
  soLuot?: number;
  tokenVao?: number;
  tokenRa?: number;
  tokenNghi?: number;
  suKien?: unknown[];
  checkpointIds?: string[];
  tomTat?: string | null;
}

export async function capNhatHangLuotChay(userId: number, id: string, c: CapNhatLuotChay): Promise<boolean> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(id)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const ra = await db
      .update(aiAgentRuns)
      .set({ ...c, updatedAt: new Date() })
      .where(and(eq(aiAgentRuns.id, id), eq(aiAgentRuns.userId, userId)))
      .returning({ id: aiAgentRuns.id });
    return ra.length > 0;
  } catch (err) {
    canhBao("capNhatHangLuotChay", err);
    return false;
  }
}

/** Một hàng — `null` khi id méo / không tồn tại / CỦA NGƯỜI KHÁC (cùng giá trị, có chủ ý). */
export async function docHangLuotChay(userId: number, id: string): Promise<AiAgentRun | null> {
  if (!laUser(userId) || !RE_ID_LUOT_CHAY.test(id)) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const [h] = await db
      .select()
      .from(aiAgentRuns)
      .where(and(eq(aiAgentRuns.id, id), eq(aiAgentRuns.userId, userId)))
      .limit(1);
    return h ?? null;
  } catch (err) {
    canhBao("docHangLuotChay", err);
    return null;
  }
}

export interface TomTatLuotChay {
  id: string;
  projectId: string;
  cheDo: string;
  cauHoi: string;
  trangThai: string;
  lyDoDung: string | null;
  soLuot: number;
  tokenVao: number;
  tokenRa: number;
  tokenNghi: number;
  soCheckpoint: number;
  tomTat: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: unknown) => (d instanceof Date ? d : new Date(String(d))).toISOString();

export function tomTatTuHang(h: AiAgentRun): TomTatLuotChay {
  return {
    id: String(h.id),
    projectId: h.projectId,
    cheDo: h.cheDo,
    cauHoi: h.cauHoi.length > 300 ? `${h.cauHoi.slice(0, 299)}…` : h.cauHoi,
    trangThai: h.trangThai,
    lyDoDung: h.lyDoDung ?? null,
    soLuot: h.soLuot,
    tokenVao: h.tokenVao,
    tokenRa: h.tokenRa,
    tokenNghi: h.tokenNghi,
    soCheckpoint: Array.isArray(h.checkpointIds) ? h.checkpointIds.length : 0,
    tomTat: h.tomTat ?? null,
    createdAt: iso(h.createdAt),
    updatedAt: iso(h.updatedAt),
  };
}

/** Danh sách lượt chạy của MỘT người (tuỳ chọn lọc dự án), mới nhất trước. */
export async function danhSachHangLuotChay(userId: number, projectId?: string | null, gioiHan = 20): Promise<TomTatLuotChay[]> {
  if (!laUser(userId)) return [];
  if (projectId != null && !RE_ID_DU_AN.test(projectId)) return [];
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select()
      .from(aiAgentRuns)
      .where(projectId != null ? and(eq(aiAgentRuns.userId, userId), eq(aiAgentRuns.projectId, projectId)) : eq(aiAgentRuns.userId, userId))
      .orderBy(desc(aiAgentRuns.createdAt))
      .limit(Math.max(1, Math.min(gioiHan, TRAN_DANH_SACH_LUOT_CHAY)));
    return rows.map(tomTatTuHang);
  } catch (err) {
    canhBao("danhSachHangLuotChay", err);
    return [];
  }
}

/**
 * Boot: lượt chạy sống trong bộ nhớ tiến trình ⇒ sau restart mọi hàng còn `dang-chay`/`cho-duyet` là
 * lượt đã CHẾT giữa chừng ⇒ `gian-doan`. Trả số hàng đổi (−1 khi không làm được).
 * ⚠ Gọi MỘT lần lúc khởi động, TRƯỚC khi nhận lượt chạy mới (nếu không sẽ đánh dấu nhầm lượt vừa tạo).
 */
export async function danhDauGianDoanKhiBoot(chiNguoiDung?: number): Promise<number> {
  const db = await getDb();
  if (!db) return -1;
  try {
    const song = inArray(aiAgentRuns.trangThai, ["dang-chay", "cho-duyet"]);
    // `chiNguoiDung` CHỈ cho lưới (CSDL `_test` dùng chung giữa các tệp lưới chạy song song).
    const ra = await db
      .update(aiAgentRuns)
      .set({ trangThai: "gian-doan", updatedAt: new Date() })
      .where(chiNguoiDung !== undefined ? and(song, eq(aiAgentRuns.userId, chiNguoiDung)) : song)
      .returning({ id: aiAgentRuns.id });
    return ra.length;
  } catch (err) {
    canhBao("danhDauGianDoanKhiBoot", err);
    return -1;
  }
}
