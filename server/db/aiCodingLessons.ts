/**
 * ★★★ doc 82 · BỘ NHỚ XUYÊN PHIÊN — **TẦNG DỮ LIỆU, PHẠM VI CHỦ SỞ HỮU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LUẬT DUY NHẤT CỦA FILE NÀY: **MỌI câu truy vấn đều mang `eq(aiCodingLessons.userId, …)`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không hàm nào ở đây đọc/ghi/xoá được một hàng mà không nêu chủ sở hữu, và `userId` là **tham số
 * BẮT BUỘC ĐẦU TIÊN** của mọi hàm — không `optional`, không mặc định. Một tham số tuỳ chọn ở đây
 * là một lời mời quên nó, và quên nó ở BẢNG NÀY nặng hơn ở bảng phiên: quên ở phiên là *"A đọc
 * được hội thoại của B"*; quên ở đây là *"chữ B gõ tự động chạy vào prompt của A, mọi lượt"*.
 *
 * ⚠ `userId` phải đến từ **phiên đăng nhập** (`execCtx.user.id`), TUYỆT ĐỐI không từ nội dung câu
 *   hỏi hay từ `input`. Không hàm nào ở đây nhận một ô danh tính do người gọi tự khai.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ PHÉP CHIẾU `locBaiHoc()` CHẠY Ở **CẢ HAI** CỬA — GHI **VÀ** ĐỌC (cùng khuôn `locLuot` doc 79).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chiếu ở cửa ĐỌC làm bất biến *"một bài học chỉ là bốn ô chữ"* thành **thuộc tính của phép đọc**,
 * không phải thuộc tính của lịch sử ghi. Một hàng bị đầu độc bằng SQL thẳng (nhét `tool`,
 * `actionId`, `chayNgay`) vẫn đọc ra đúng bốn ô. Việc LÀM SẠCH nội dung (quét tiêm + che bí mật)
 * nằm ở `server/services/ai/codingLessonContext.ts` — nó cần `aiSafety`, và file này phải mỏng.
 *
 * ⚠ FAIL-SAFE: migration 0336 chưa chạy (`isMissingTable`) hoặc DB vắng ⇒ degrade về danh sách
 *   RỖNG / `{ ok:false }`, **không ném**. Một phiên lập trình phải chạy được y như trước khi có
 *   bảng này; bài học vắng là một suy giảm, một lượt ném là một hồi quy.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { aiCodingLessons } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";
import {
  GIOI_HAN_BAI_HOC,
  chuanHoaNoiDung,
  khoaTrungBaiHoc,
  laIdDuAnHopLe,
  locBaiHoc,
  type BaiHoc,
} from "@shared/aiCodingLesson";

function canhBao(cho: string, err: unknown): void {
  if (!isMissingTable(err)) {
    console.warn(`[aiCodingLessons] ${cho} hỏng (degrade):`, err);
  }
}

/**
 * Bài học của **một người** trên **một dự án**, **mới nhất trước**.
 *
 * ⚠ Thứ tự ấy là một hợp đồng, không phải một chi tiết: `chonBaiHocChoPrompt` dựa vào nó để lấp
 *   các ô còn trống bằng bài MỚI NHẤT, và nó **không sắp lại** (một phép sắp thứ hai là một chỗ
 *   để hai bên lệch nhau).
 */
export async function danhSachBaiHoc(userId: number, projectId: string): Promise<BaiHoc[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  if (!laIdDuAnHopLe(projectId)) return [];
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({
        id: aiCodingLessons.id,
        noiDung: aiCodingLessons.noiDung,
        mucRuiRo: aiCodingLessons.mucRuiRo,
        updatedAt: aiCodingLessons.updatedAt,
      })
      .from(aiCodingLessons)
      .where(
        and(
          eq(aiCodingLessons.userId, userId),
          eq(aiCodingLessons.projectId, projectId),
        ),
      )
      .orderBy(desc(aiCodingLessons.updatedAt))
      .limit(GIOI_HAN_BAI_HOC.SO_BAI_LIET_KE);
    const ra: BaiHoc[] = [];
    for (const r of rows) {
      // ★★★ PHÉP CHIẾU Ở CỬA ĐỌC — xem khối đầu file.
      const b = locBaiHoc({
        id: String(r.id),
        noiDung: r.noiDung,
        mucRuiRo: r.mucRuiRo,
        updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt)).toISOString(),
      });
      if (b) ra.push(b);
    }
    return ra;
  } catch (err) {
    canhBao("danhSachBaiHoc", err);
    return [];
  }
}

export type MaLuuBaiHoc = "them" | "trung" | "day" | "hong";

export interface KetQuaLuuBaiHoc {
  ma: MaLuuBaiHoc;
  /** Nội dung đã chuẩn hoá thực sự nằm trong CSDL (rỗng khi `hong`). */
  noiDung: string;
  /** Tổng số bài học của (người × dự án) SAU lượt này. */
  tong: number;
}

/**
 * Lưu MỘT bài học. `noiDung` phải **đã làm sạch** bởi `codingLessonContext.lamSachBaiHoc()` —
 * file này KHÔNG tự quét tiêm (nó không nhập `aiSafety`; một bản quét thứ hai ở đây là đúng cái
 * "hai bản sao một luật" mà repo đã trả giá 17 lần).
 *
 * ⚠ `mucRuiRo` chỉ nhận `'none'|'low'`; bất kỳ giá trị nào khác bị hạ về `'none'`… **KHÔNG**. Nó
 *   bị TỪ CHỐI (`hong`): hạ một `'high'` xuống `'none'` là ghi một lời khai SAI vào cột kiểm toán,
 *   và CHECK của CSDL sẽ ném ở lượt sau khi ai đó thêm mức mới. Từ chối là câu trả lời trung thực.
 *
 * ⚠ "TRÙNG ⇒ KHÔNG NHÂN BẢN" được cưỡng chế bởi UNIQUE `(userId, projectId, khoaTrung)` ở tầng
 *   CSDL, KHÔNG bởi một lượt `SELECT` trước. `onConflictDoUpdate` chỉ đẩy `updatedAt` (bài học
 *   được nhắc lại là bài học còn nóng ⇒ nó lên đầu danh sách), và trả `"trung"` để người dùng biết
 *   họ không vừa tạo ra bản thứ hai.
 */
export async function luuBaiHoc(
  userId: number,
  input: { projectId: string; noiDung: string; mucRuiRo: string },
): Promise<KetQuaLuuBaiHoc> {
  const HONG: KetQuaLuuBaiHoc = { ma: "hong", noiDung: "", tong: 0 };
  if (!Number.isInteger(userId) || userId <= 0) return HONG;
  if (!laIdDuAnHopLe(input.projectId)) return HONG;
  if (input.mucRuiRo !== "none" && input.mucRuiRo !== "low") return HONG;

  const noiDung = chuanHoaNoiDung(input.noiDung);
  if (noiDung === "") return HONG;
  const khoa = khoaTrungBaiHoc(noiDung);
  if (khoa === "") return HONG;

  const db = await getDb();
  if (!db) return HONG;

  try {
    const dangCo = await demBaiHoc(userId, input.projectId);
    /**
     * ⚠ Trần kiểm TRƯỚC, và một bài học TRÙNG vẫn đi tiếp khi đã đầy: nó không thêm hàng nào, nên
     *   chặn nó ở đây là từ chối một thao tác vô hại và làm người dùng tưởng dữ liệu đã mất.
     */
    const daCo = await db
      .select({ id: aiCodingLessons.id })
      .from(aiCodingLessons)
      .where(
        and(
          eq(aiCodingLessons.userId, userId),
          eq(aiCodingLessons.projectId, input.projectId),
          eq(aiCodingLessons.khoaTrung, khoa),
        ),
      )
      .limit(1);
    if (daCo.length === 0 && dangCo >= GIOI_HAN_BAI_HOC.SO_BAI_TOI_DA) {
      return { ma: "day", noiDung, tong: dangCo };
    }

    const ra = await db
      .insert(aiCodingLessons)
      .values({
        userId,
        projectId: input.projectId,
        noiDung,
        khoaTrung: khoa,
        mucRuiRo: input.mucRuiRo,
      })
      .onConflictDoUpdate({
        target: [aiCodingLessons.userId, aiCodingLessons.projectId, aiCodingLessons.khoaTrung],
        set: { noiDung, mucRuiRo: input.mucRuiRo, updatedAt: new Date() },
      })
      .returning({ id: aiCodingLessons.id });
    if (ra.length === 0) return HONG;
    return {
      ma: daCo.length > 0 ? "trung" : "them",
      noiDung,
      tong: daCo.length > 0 ? dangCo : dangCo + 1,
    };
  } catch (err) {
    canhBao("luuBaiHoc", err);
    return HONG;
  }
}

/**
 * Xoá bài học theo **số thứ tự trong danh sách người vừa nhìn thấy** (1-based, mới nhất = 1).
 *
 * ⚠ Vì sao theo thứ tự chứ không theo `id`: người dùng gõ vào một ô chat, họ không có `id`. Và vì
 *   sao điều đó AN TOÀN: thứ tự được tính lại từ **chính truy vấn có `eq(userId)`**, nên "số 2" của
 *   A không bao giờ trỏ được vào hàng của B — không có không gian id chung để đoán trúng.
 */
export async function xoaBaiHocTheoThuTu(
  userId: number,
  projectId: string,
  thuTu: number,
): Promise<{ ok: boolean; noiDung: string }> {
  const ds = await danhSachBaiHoc(userId, projectId);
  const muc = ds[thuTu - 1];
  if (!muc) return { ok: false, noiDung: "" };
  const db = await getDb();
  if (!db) return { ok: false, noiDung: "" };
  try {
    const ra = await db
      .delete(aiCodingLessons)
      .where(
        and(
          eq(aiCodingLessons.id, muc.id),
          eq(aiCodingLessons.userId, userId),
          eq(aiCodingLessons.projectId, projectId),
        ),
      )
      .returning({ id: aiCodingLessons.id });
    return { ok: ra.length > 0, noiDung: ra.length > 0 ? muc.noiDung : "" };
  } catch (err) {
    canhBao("xoaBaiHocTheoThuTu", err);
    return { ok: false, noiDung: "" };
  }
}

/** Đếm bài học của một người trên một dự án. */
export async function demBaiHoc(userId: number, projectId: string): Promise<number> {
  if (!Number.isInteger(userId) || userId <= 0) return 0;
  if (!laIdDuAnHopLe(projectId)) return 0;
  const db = await getDb();
  if (!db) return 0;
  try {
    const ra = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiCodingLessons)
      .where(
        and(
          eq(aiCodingLessons.userId, userId),
          eq(aiCodingLessons.projectId, projectId),
        ),
      );
    return Number(ra[0]?.n ?? 0);
  } catch (err) {
    canhBao("demBaiHoc", err);
    return 0;
  }
}
