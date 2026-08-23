/**
 * ★★★ QUẢN LÝ DỰ ÁN — **TẦNG DỮ LIỆU của bảng `ai_repo_du_an`** (mig 0337).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ FILE NÀY **KHÔNG PHÁN QUYẾT** — nó chỉ chở hàng. MỌI xác thực (id đúng khuôn · tên sạch ·
 * đường tuyệt đối · realpath tồn tại · là thư mục · không lồng gốc đã có · không thư mục cấm ·
 * trần số mục · không trùng env) nằm ở `repoProjects.kiemTraDangKyDuAn` — chủ duy nhất của luật
 * danh sách trắng. Router gọi phán quyết TRƯỚC, rồi mới gọi xuống đây. Một cửa ghi thứ hai ngày
 * mai mà gọi thẳng `themDuAnDb` sẽ bị hai CHECK của 0337 đỡ phần hình dạng (id/tên), nhưng KHÔNG
 * được ai đỡ phần hệ-tệp — nên ĐỪNG mở cửa ghi thứ hai.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * ⚠ FAIL-SAFE như `aiCodingSessions.ts`: migration 0337 chưa chạy (`isMissingTable`) hoặc DB vắng
 *   ⇒ degrade về danh sách RỖNG / `{ ok:false }`, **không ném**. Hệ chỉ chạy `.env` vẫn phải boot
 *   được y như trước khi bảng này tồn tại.
 */
import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { aiRepoDuAn } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";

/** Một hàng dự án nguồn DB — hình dạng tối thiểu mà `repoProjects` cần để dựng bộ đệm. */
export interface HangDuAnDb {
  id: string;
  ten: string;
  goc: string;
}

function canhBao(cho: string, err: unknown): void {
  if (!isMissingTable(err)) {
    console.warn(`[aiRepoDuAn] ${cho} hỏng (degrade):`, err);
  }
}

/** Toàn bộ dự án nguồn DB, sắp theo lúc tạo (ổn định cho selectBox). Hỏng ⇒ RỖNG, không ném. */
export async function danhSachDuAnDb(): Promise<HangDuAnDb[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({ id: aiRepoDuAn.id, ten: aiRepoDuAn.ten, goc: aiRepoDuAn.goc })
      .from(aiRepoDuAn)
      .orderBy(asc(aiRepoDuAn.createdAt), asc(aiRepoDuAn.id));
    return rows.map((r) => ({ id: r.id, ten: r.ten, goc: r.goc }));
  } catch (err) {
    canhBao("danhSachDuAnDb", err);
    return [];
  }
}

/** Đếm số mục nguồn DB — cho phán quyết TRẦN (`kiemTraDangKyDuAn` hỏi qua router). */
export async function demDuAnDb(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const ra = await db.select({ n: sql<number>`count(*)::int` }).from(aiRepoDuAn);
    return Number(ra[0]?.n ?? 0);
  } catch (err) {
    canhBao("demDuAnDb", err);
    return 0;
  }
}

/**
 * Chèn MỘT dự án đã-qua-phán-quyết. `{ ok:false }` khi DB vắng / CHECK từ chối / trùng khoá —
 * người gọi coi mọi nhánh hỏng là "KHÔNG thêm được", không đoán lý do ở tầng này.
 */
export async function themDuAnDb(muc: {
  id: string;
  ten: string;
  goc: string;
  nguoiTao: number;
}): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    const ra = await db
      .insert(aiRepoDuAn)
      .values({ id: muc.id, ten: muc.ten, goc: muc.goc, nguoiTao: muc.nguoiTao })
      .returning({ id: aiRepoDuAn.id });
    return { ok: ra.length > 0 };
  } catch (err) {
    canhBao("themDuAnDb", err);
    return { ok: false };
  }
}

/** Xoá MỘT dự án nguồn DB theo id. `{ ok:false }` khi không tồn tại (mục env không nằm ở đây). */
export async function xoaDuAnDb(id: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    const ra = await db.delete(aiRepoDuAn).where(eq(aiRepoDuAn.id, id)).returning({ id: aiRepoDuAn.id });
    return { ok: ra.length > 0 };
  } catch (err) {
    canhBao("xoaDuAnDb", err);
    return { ok: false };
  }
}
