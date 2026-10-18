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
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { aiRepoDuAn } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";

/** Một hàng dự án nguồn DB — hình dạng tối thiểu mà `repoProjects` cần để dựng bộ đệm. */
export interface HangDuAnDb {
  id: string;
  ten: string;
  goc: string;
  /** ★ Đợt 3a (mig 0393) — chủ của dự án CÁ NHÂN; `null` ⇔ mục admin/dùng chung. Vắng (CSDL chưa 0393) ⇒ `null`. */
  chuSoHuu?: number | null;
  /** ★ Đợt 3a — rong · khuon · zip · git (chỉ dự án cá nhân). */
  cachTao?: string | null;
}

/**
 * ★ Đợt 3a — CSDL CHƯA áp 0393 (cột `chuSoHuu` vắng ⇒ SQLSTATE 42703) phải degrade về đúng hành vi 0337, KHÔNG về
 * danh sách rỗng: máy chủ chạy mã mới trước khi người vận hành kịp áp migration mà làm BIẾN MẤT mọi dự án admin đã
 * đăng ký là một sự cố thật (selectBox rỗng, phiên chat mồ côi). Đọc mã ở cả `err` lẫn `err.cause` (drizzle bọc lỗi).
 */
function laThieuCot(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  return e?.code === "42703" || e?.cause?.code === "42703";
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
      .select({
        id: aiRepoDuAn.id,
        ten: aiRepoDuAn.ten,
        goc: aiRepoDuAn.goc,
        chuSoHuu: aiRepoDuAn.chuSoHuu,
        cachTao: aiRepoDuAn.cachTao,
      })
      .from(aiRepoDuAn)
      .orderBy(asc(aiRepoDuAn.createdAt), asc(aiRepoDuAn.id));
    return rows.map((r) => ({ id: r.id, ten: r.ten, goc: r.goc, chuSoHuu: r.chuSoHuu ?? null, cachTao: r.cachTao ?? null }));
  } catch (err) {
    if (laThieuCot(err)) {
      // CSDL chưa 0393 ⇒ đọc đúng ba cột 0337; KHÔNG hàng nào là cá nhân (cột chưa tồn tại thì chưa ai tạo được).
      try {
        const rows = await db
          .select({ id: aiRepoDuAn.id, ten: aiRepoDuAn.ten, goc: aiRepoDuAn.goc })
          .from(aiRepoDuAn)
          .orderBy(asc(aiRepoDuAn.createdAt), asc(aiRepoDuAn.id));
        return rows.map((r) => ({ id: r.id, ten: r.ten, goc: r.goc, chuSoHuu: null, cachTao: null }));
      } catch (err2) {
        canhBao("danhSachDuAnDb (0337)", err2);
        return [];
      }
    }
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
  /** ★ Đợt 3a — có ⇔ dự án CÁ NHÂN (kèm `cachTao`; CHECK 0393 bắt cặp). */
  chuSoHuu?: number | null;
  cachTao?: "rong" | "khuon" | "zip" | "git" | null;
}): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    // ⚠ SQL viết tay với DANH SÁCH CỘT TƯỜNG MINH (không `db.insert().values()`): drizzle liệt kê MỌI cột của bảng
    //   (cột thiếu giá trị ⇒ `default`), nên một CSDL chưa áp 0393 sẽ từ chối CẢ lượt đăng ký admin vì cột
    //   `chuSoHuu` chưa có. Mục admin chỉ chạm bốn cột 0337; mục cá nhân thêm hai cột 0393.
    const ra =
      muc.chuSoHuu != null
        ? await db.execute(sql`
            INSERT INTO ai_repo_du_an (id, ten, goc, "nguoiTao", "chuSoHuu", "cachTao")
            VALUES (${muc.id}, ${muc.ten}, ${muc.goc}, ${muc.nguoiTao}, ${muc.chuSoHuu}, ${muc.cachTao ?? null})
            RETURNING id`)
        : await db.execute(sql`
            INSERT INTO ai_repo_du_an (id, ten, goc, "nguoiTao")
            VALUES (${muc.id}, ${muc.ten}, ${muc.goc}, ${muc.nguoiTao})
            RETURNING id`);
    return { ok: soHang(ra) > 0 };
  } catch (err) {
    canhBao("themDuAnDb", err);
    return { ok: false };
  }
}

/** Số hàng của một kết quả `db.execute` (postgres-js trả mảng; node-postgres trả `{rows}`). */
function soHang(ra: unknown): number {
  if (Array.isArray(ra)) return ra.length;
  const rows = (ra as { rows?: unknown[] } | null | undefined)?.rows;
  return Array.isArray(rows) ? rows.length : 0;
}

/** Một hàng theo id (kể cả hai cột 0393). Không có / DB vắng ⇒ `null`. */
export async function docDuAnDb(id: string): Promise<HangDuAnDb | null> {
  const ds = await danhSachDuAnDb();
  return ds.find((r) => r.id === id) ?? null;
}

/**
 * ★ Đợt 3a — đếm dự án CÁ NHÂN của một người (trần số dự án / người). Hỏng ⇒ `null` (người gọi FAIL-CLOSED: không
 * đếm được thì không cho tạo — trần là hàng rào chống lấp đĩa, không phải tiện ích).
 */
export async function demDuAnCaNhanDb(chuSoHuu: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  try {
    const ra = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiRepoDuAn)
      .where(eq(aiRepoDuAn.chuSoHuu, chuSoHuu));
    return Number(ra[0]?.n ?? 0);
  } catch (err) {
    canhBao("demDuAnCaNhanDb", err);
    return null;
  }
}

/**
 * ★ Đợt 3a — đổi TÊN một dự án cá nhân. Điều kiện `chuSoHuu` nằm TRONG câu UPDATE (không đọc-rồi-ghi): không có
 * cửa sổ nào giữa "kiểm chủ" và "ghi" cho một lượt chuyển chủ chen vào. UPDATE chỉ chạm cột `ten` — đúng quyền cột
 * mà 0393 cấp. `{ok:false}` ⇔ không có hàng nào khớp (không tồn tại / không phải của người này / DB vắng).
 */
export async function doiTenDuAnCaNhanDb(id: string, chuSoHuu: number, ten: string): Promise<{ ok: boolean }> {
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    const ra = await db
      .update(aiRepoDuAn)
      .set({ ten })
      .where(and(eq(aiRepoDuAn.id, id), eq(aiRepoDuAn.chuSoHuu, chuSoHuu)))
      .returning({ id: aiRepoDuAn.id });
    return { ok: ra.length > 0 };
  } catch (err) {
    canhBao("doiTenDuAnCaNhanDb", err);
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
