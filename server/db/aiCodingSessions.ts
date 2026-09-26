/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — **TẦNG DỮ LIỆU, PHẠM VI CHỦ SỞ HỮU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LUẬT DUY NHẤT CỦA FILE NÀY: **MỌI câu truy vấn đều mang `eq(aiCodingSessions.userId, …)`.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Không có một hàm nào ở đây đọc/ghi/xoá được một hàng mà không nêu chủ sở hữu, và `userId` là
 * **tham số BẮT BUỘC đầu tiên** của mọi hàm — không `optional`, không giá trị mặc định. Một tham
 * số tuỳ chọn ở đây là một lời mời quên nó, và quên nó là *"kỹ sư A đọc phiên của kỹ sư B"*.
 *
 * ⚠ `userId` phải đến từ **`ctx.user.id` của phiên đăng nhập**, TUYỆT ĐỐI không từ `input`. Tuyến
 *   tRPC (`repoWorkspaceRouter`) là chỗ ràng buộc đó được giữ; `aiCodingSessionScope.test.ts` đo
 *   trên CSDL THẬT rằng nó đang được giữ (hai tài khoản, hai chiều, kèm đột biến).
 *
 * ⚠ Vì sao KHÔNG dựa vào RLS/tenant — xem docblock của `drizzle/schema/aiCodingSession.ts`. Tóm
 *   tắt: RLS của repo này **nằm im** (0 nơi gọi `runWithTenantScope`), và tenant là **sai trục**
 *   (A và B cùng nhà máy thì cùng tenant).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ PHÉP CHIẾU `locLuot()` CHẠY Ở **CẢ HAI** CỬA — GHI **VÀ** ĐỌC.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chỉ chiếu ở cửa GHI là đủ cho dữ liệu do chính đường này tạo ra, nhưng KHÔNG đủ cho một hàng
 * được ghi bằng cách khác (SQL thẳng, một cửa ghi thứ hai ngày mai, một bản khôi phục CSDL cũ).
 * Chiếu ở cửa ĐỌC làm bất biến *"phiên không mang thẻ duyệt HITL"* thành **thuộc tính của phép
 * đọc**, không phải thuộc tính của lịch sử ghi. Đây là chỗ ca *"nạp lại thẻ duyệt CŨ"* chết.
 *
 * ⚠ FAIL-SAFE: migration 0333 chưa chạy (`isMissingTable`) hoặc DB vắng ⇒ degrade về danh sách
 *   RỖNG / `{ ok: false }`, **không ném**. Trang không gian làm việc phải mở được ngay cả khi chưa
 *   ai chạy migration; danh sách phiên vắng là một suy giảm nhìn thấy được, một trang trắng thì không.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./connection";
import { aiCodingSessions } from "../../drizzle/schema";
import { isMissingTable } from "../_core/dbErrors";
import {
  GIOI_HAN_PHIEN,
  locLuot,
  nhanTuLuot,
  laIdDuAnHopLe,
  laIdPhienHopLe,
  type LuotPhien,
} from "@shared/aiCodingSession";

/** Một dòng trong danh sách bên trái — **KHÔNG** kèm nội dung hội thoại (danh sách không cần). */
export interface TomTatPhien {
  id: string;
  /** Nhãn tự sinh; `""` ⇒ giao diện hiện nhãn mặc định qua `t()`. */
  title: string;
  turnCount: number;
  updatedAt: string;
}

/** Một phiên đã mở — `turns` ĐÃ QUA `locLuot()` (xem khối phép chiếu ở đầu file). */
export interface PhienDayDu extends TomTatPhien {
  projectId: string;
  turns: LuotPhien[];
}

function canhBao(cho: string, err: unknown): void {
  if (!isMissingTable(err)) {
    console.warn(`[aiCodingSessions] ${cho} hỏng (degrade):`, err);
  }
}

/**
 * Danh sách phiên của **một người** trên **một dự án**, mới nhất trước.
 * `userId` bắt buộc ⇒ không có hình dạng gọi nào cho ra "phiên của mọi người".
 */
export async function danhSachPhien(
  userId: number,
  projectId: string,
): Promise<TomTatPhien[]> {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  if (!laIdDuAnHopLe(projectId)) return [];
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select({
        id: aiCodingSessions.id,
        title: aiCodingSessions.title,
        turnCount: aiCodingSessions.turnCount,
        updatedAt: aiCodingSessions.updatedAt,
      })
      .from(aiCodingSessions)
      .where(
        and(
          eq(aiCodingSessions.userId, userId),
          eq(aiCodingSessions.projectId, projectId),
        ),
      )
      .orderBy(desc(aiCodingSessions.updatedAt))
      .limit(GIOI_HAN_PHIEN.SO_PHIEN_LIET_KE);
    return rows.map((r) => ({
      id: String(r.id),
      title: r.title ?? "",
      turnCount: r.turnCount ?? 0,
      updatedAt: (r.updatedAt instanceof Date ? r.updatedAt : new Date(r.updatedAt)).toISOString(),
    }));
  } catch (err) {
    canhBao("danhSachPhien", err);
    return [];
  }
}

/**
 * Mở một phiên. **`null`** khi: id méo · không tồn tại · **thuộc người khác**.
 *
 * ⚠ Ba ca ấy trả CÙNG một giá trị có chủ ý: phân biệt *"không có"* với *"của người khác"* là một
 *   kênh phụ (oracle) cho phép đếm phiên của người khác. Người gọi hợp lệ không mất gì.
 */
export async function moPhien(userId: number, sessionId: string): Promise<PhienDayDu | null> {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!laIdPhienHopLe(sessionId)) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(aiCodingSessions)
      .where(
        and(
          eq(aiCodingSessions.id, sessionId),
          eq(aiCodingSessions.userId, userId),
        ),
      )
      .limit(1);
    if (!row) return null;
    // ★★★ PHÉP CHIẾU Ở CỬA ĐỌC — xem khối đầu file. Đây là chỗ một hàng bị đầu độc mất răng.
    const turns = locLuot(row.turns);
    return {
      id: String(row.id),
      projectId: row.projectId,
      title: row.title ?? "",
      turnCount: turns.length,
      turns,
      updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
    };
  } catch (err) {
    canhBao("moPhien", err);
    return null;
  }
}

export interface KetQuaLuu {
  ok: boolean;
  id: string | null;
  title: string;
  turnCount: number;
}

const LUU_HONG: KetQuaLuu = { ok: false, id: null, title: "", turnCount: 0 };

/**
 * Lưu **toàn bộ** mạch hội thoại (upsert). `sessionId` vắng ⇒ TẠO phiên mới.
 *
 * ⚠ Vì sao ghi CẢ mạch thay vì thêm-từng-lượt: mạch trên màn hình là nguồn sự thật của người dùng
 *   (họ thấy nó), và một cửa "thêm một lượt" đòi client và server phải đồng ý về **số thứ tự** —
 *   một biến trạng thái nữa để lệch. Lượt ghi này **luỹ đẳng theo nội dung**: gửi lại đúng mạch cũ
 *   cho ra đúng hàng cũ. Kích thước bị chặn cứng bởi `locLuot()`.
 *
 * ⚠ Lượt UPDATE cũng mang `eq(userId)` — nó KHÔNG chỉ là bộ lọc mà là **phép cưỡng chế**: ghi đè
 *   phiên của người khác bằng một `sessionId` đoán trúng sẽ khớp 0 hàng ⇒ `{ ok:false }`.
 */
export async function luuPhien(
  userId: number,
  input: { projectId: string; sessionId?: string | null; turns: unknown },
): Promise<KetQuaLuu> {
  if (!Number.isInteger(userId) || userId <= 0) return LUU_HONG;
  if (!laIdDuAnHopLe(input.projectId)) return LUU_HONG;

  // ★★★ PHÉP CHIẾU Ở CỬA GHI — mọi ô lạ (`actionId`/`token`/`args`…) biến mất TRƯỚC khi chạm CSDL.
  const turns = locLuot(input.turns);
  if (turns.length === 0) return LUU_HONG; // không lưu một phiên rỗng (nút "phiên mới" không đẻ hàng)
  const title = nhanTuLuot(turns);

  const db = await getDb();
  if (!db) return LUU_HONG;

  try {
    if (input.sessionId != null && input.sessionId !== "") {
      if (!laIdPhienHopLe(input.sessionId)) return LUU_HONG;
      const ra = await db
        .update(aiCodingSessions)
        .set({ turns, turnCount: turns.length, title, updatedAt: new Date() })
        .where(
          and(
            eq(aiCodingSessions.id, input.sessionId),
            eq(aiCodingSessions.userId, userId),
            // Phiên bám MỘT dự án suốt đời: một lượt lưu mang projectId khác là một lỗi lập trình
            // ở client (đổi dự án phải MỞ phiên khác), không phải một lượt "di chuyển phiên".
            eq(aiCodingSessions.projectId, input.projectId),
          ),
        )
        .returning({ id: aiCodingSessions.id });
      const hang = ra[0];
      if (!hang) return LUU_HONG; // không tồn tại / của người khác / khác dự án — cả ba đều là hỏng
      return { ok: true, id: String(hang.id), title, turnCount: turns.length };
    }

    const ra = await db
      .insert(aiCodingSessions)
      .values({
        userId,
        projectId: input.projectId,
        title,
        turns,
        turnCount: turns.length,
      })
      .returning({ id: aiCodingSessions.id });
    const hang = ra[0];
    if (!hang) return LUU_HONG;
    return { ok: true, id: String(hang.id), title, turnCount: turns.length };
  } catch (err) {
    canhBao("luuPhien", err);
    return LUU_HONG;
  }
}

/** Xoá một phiên **của chính mình**. `{ ok:false }` khi không tồn tại hoặc thuộc người khác. */
export async function xoaPhien(userId: number, sessionId: string): Promise<{ ok: boolean }> {
  if (!Number.isInteger(userId) || userId <= 0) return { ok: false };
  if (!laIdPhienHopLe(sessionId)) return { ok: false };
  const db = await getDb();
  if (!db) return { ok: false };
  try {
    const ra = await db
      .delete(aiCodingSessions)
      .where(
        and(
          eq(aiCodingSessions.id, sessionId),
          eq(aiCodingSessions.userId, userId),
        ),
      )
      .returning({ id: aiCodingSessions.id });
    return { ok: ra.length > 0 };
  } catch (err) {
    canhBao("xoaPhien", err);
    return { ok: false };
  }
}

/**
 * Đếm phiên của một người trên một dự án — chỉ dùng cho LƯỚI (đo đột biến "bỏ eq(userId)").
 * Cố ý KHÔNG lộ qua tRPC: nó không phục vụ một màn hình nào.
 */
export async function demPhienCuaToi(userId: number, projectId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  try {
    const ra = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiCodingSessions)
      .where(
        and(
          eq(aiCodingSessions.userId, userId),
          eq(aiCodingSessions.projectId, projectId),
        ),
      );
    return Number(ra[0]?.n ?? 0);
  } catch (err) {
    canhBao("demPhienCuaToi", err);
    return 0;
  }
}
