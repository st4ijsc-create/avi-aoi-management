import { getDb } from "../db/connection";
import { predictiveAlerts } from "../../drizzle/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { isMissingColumn, isMissingTable } from "../_core/dbErrors";

/**
 * Wave 3 §4.2 — cảnh báo được GIA HẠN mỗi lần tái diễn (Task 3). Nên hết hạn
 * KHÔNG có nghĩa "đã quá N ngày" mà là "tình trạng đã THÔI tái diễn".
 * Không bao giờ để cảnh báo biến mất im lặng: mỗi dòng đóng đều ghi lý do.
 */
export async function sweepExpiredAlerts(): Promise<{ expired: number }> {
  try {
    const db = await getDb();
    if (!db) return { expired: 0 };
    const rows: any = await db
      .update(predictiveAlerts)
      .set({
        status: "EXPIRED" as any,
        // Chuỗi THUẦN, không phải sql`` — để test khẳng định được nội dung.
        // Dòng bị đóng ở đây luôn là ACTIVE + chưa ghi nhận, nên resolutionNotes
        // gần như chắc chắn đang rỗng; không cần nối thêm.
        resolutionNotes: "Tự đóng: tình trạng đã thôi tái diễn trước khi hết hạn cảnh báo.",
        updatedAt: new Date(),
      } as any)
      .where(and(
        eq(predictiveAlerts.status, "ACTIVE" as any),
        isNull(predictiveAlerts.acknowledgedAt),
        lt(predictiveAlerts.expiresAt, new Date()),
      ))
      // Vòng sửa 1 (code review): KHÔNG có .returning(), drizzle đi thẳng
      // client.unsafe(...) và postgres.js trả về `Result` — kế thừa Array (nên
      // Array.isArray luôn true) NHƯNG không có DataRow nào được đẩy vào khi
      // không RETURNING ⇒ .length luôn = 0. `Result` cũng KHÔNG có .rowCount
      // (tên đúng là .count) nên nhánh dự phòng cũ không bao giờ chạm tới.
      // .returning() buộc drizzle map đúng những hàng bị UPDATE thành mảng
      // thật — đếm .length lúc này ĐÚNG THEO ĐỊNH NGHĨA, không phụ thuộc chi
      // tiết nội bộ driver.
      .returning({ id: predictiveAlerts.id });
    const expired = Array.isArray(rows) ? rows.length : 0;
    if (expired > 0) console.log(`[alertExpiry] đã đóng ${expired} cảnh báo hết hạn (kèm lý do).`);
    return { expired };
  } catch (err) {
    if (isMissingTable(err) || isMissingColumn(err)) {
      console.warn("[alertExpiry] bảng/cột chưa có (migration 0308 chưa chạy?) — bỏ qua lượt quét.");
    } else {
      console.error("[alertExpiry] lượt quét THẤT BẠI:", err);
    }
    return { expired: 0 };
  }
}

let timer: NodeJS.Timeout | null = null;

/** Đăng ký quét định kỳ. Không bao giờ ném. Tắt bằng ALERT_EXPIRY_SWEEP_ENABLED=false. */
export function initAlertExpirySweeper(): void {
  if (process.env.ALERT_EXPIRY_SWEEP_ENABLED === "false") return;
  if (timer) return;
  const raw = Number(process.env.ALERT_EXPIRY_SWEEP_MINUTES);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 30;
  timer = setInterval(() => { void sweepExpiredAlerts(); }, minutes * 60_000);
  timer.unref?.();
}
