import { getDb } from "../db/connection";
import { predictiveAlerts, predictiveAlertOccurrences } from "../../drizzle/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { isMissingColumn, isMissingTable } from "../_core/dbErrors";
import { soDuongTuEnv, inCauHinhHieuLuc } from "../_core/envNumber";

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

/**
 * Wave 4 §3c — hạn lưu nhật ký lần-tái-diễn (predictive_alert_occurrences).
 * Đây là SỐ LIỆU ĐO (một máy có thể tái diễn ~22 dòng/ngày), KHÔNG phải cảnh
 * báo — nên khác luật "gộp, không xoá" của Wave 3 (luật đó dành cho cảnh báo,
 * thứ người ta cần truy vết ngược). Giữ mãi nhật ký lần-tái-diễn thì chính nó
 * thành rác, nên xoá theo hạn lưu ở đây là đúng, không mâu thuẫn.
 */
function occurrenceRetentionMs(): number {
  return soDuongTuEnv("ALERT_OCCURRENCE_RETENTION_DAYS", 90) * 86_400_000;
}

export async function pruneOldOccurrences(): Promise<{ deleted: number }> {
  try {
    const db = await getDb();
    if (!db) return { deleted: 0 };
    const cutoff = new Date(Date.now() - occurrenceRetentionMs());
    const rows: any = await db
      .delete(predictiveAlertOccurrences)
      .where(lt(predictiveAlertOccurrences.occurredAt, cutoff))
      // Bài học Wave 3 (xem sweepExpiredAlerts ở trên): postgres.js `Result` kế
      // thừa Array NHƯNG chỉ có DataRow khi có RETURNING — thiếu .returning()
      // thì .length luôn = 0 dù có xoá thật. Dùng .returning() để đếm ĐÚNG.
      .returning({ id: predictiveAlertOccurrences.id });
    const deleted = Array.isArray(rows) ? rows.length : 0;
    if (deleted > 0) console.log(`[alertExpiry] đã dọn ${deleted} dòng nhật ký lần-tái-diễn cũ hơn hạn lưu.`);
    return { deleted };
  } catch (err) {
    if (isMissingTable(err) || isMissingColumn(err)) {
      console.warn("[alertExpiry] bảng nhật ký chưa có (migration 0309 chưa chạy?) — bỏ qua lượt dọn.");
    } else {
      console.error("[alertExpiry] dọn nhật ký THẤT BẠI:", err);
    }
    return { deleted: 0 };
  }
}

let timer: NodeJS.Timeout | null = null;

/** Đăng ký quét định kỳ. Không bao giờ ném. Tắt bằng ALERT_EXPIRY_SWEEP_ENABLED=false. */
export function initAlertExpirySweeper(): void {
  if (process.env.ALERT_EXPIRY_SWEEP_ENABLED === "false") return;
  if (timer) return;
  const minutes = soDuongTuEnv("ALERT_EXPIRY_SWEEP_MINUTES", 30);

  // E4 — in MỘT LƯỢT các giá trị ĐANG CÓ HIỆU LỰC của **ba biến thuộc bộ quét này**.
  //
  // ⚠ DANH SÁCH NÀY TỪNG CÓ SÁU BIẾN, VÀ ĐÓ LÀ MỘT LỖI CỦA TÔI (2026-08-22).
  // `aiSmartAlertRouter.logEffectiveAlertRoutingEnvOnce()` (commit `bd895e92`) ĐÃ in ba
  // biến `ALERT_RENOTIFY_COOLDOWN_*` + `ROUTE_ALERT_MAX_PER_WINDOW` từ trước — kèm cả xử
  // lý ca "060"/"1e3" mà bản của tôi không có. Tôi không thấy nó vì đã đo bằng cách tìm
  // TÊN BIẾN đứng cạnh `console.log`, trong khi hàm đó nhận tên biến làm THAM SỐ
  // (`describeOne(envName, …)`).
  //   ⇒ Bài học: **grep theo mặt chữ không tìm được thứ được truyền vào như dữ liệu.**
  //     Cùng họ với bài học "phép đếm thô ≠ kiểm kê" đã trả giá ở doc 78.
  //   ⇒ Và hậu quả nếu để nguyên đúng là thứ tôi cảnh báo cả đợt này: HAI bộ in chồng
  //     nhau, sẽ lệch nhau ở lần sửa kế tiếp. Nay mỗi module chỉ in biến của CHÍNH NÓ.
  //
  // Phần KHÔNG trùng và vẫn giữ: `soDuongTuEnv` cảnh báo ngay TẠI ĐIỂM ĐỌC khi một biến
  // được đặt mà vô nghĩa — bộ in kia chỉ chạy một lần lúc khởi động module của nó.
  inCauHinhHieuLuc("vòng đời cảnh báo (bộ quét)", [
    ["ALERT_EXPIRY_SWEEP_MINUTES", 30],
    ["ALERT_OCCURRENCE_RETENTION_DAYS", 90],
    ["ALERT_TTL_HOURS", 72],
  ]);
  timer = setInterval(() => {
    // Task 3 — gọi ĐỘC LẬP: đóng cảnh báo và dọn nhật ký là hai việc khác
    // nhau (cảnh báo "gộp, không xoá" vs. nhật ký là số liệu đo được phép
    // xoá). Mỗi hàm tự try/catch nội bộ và không ném ra ngoài, nhưng gọi
    // rời (không await nối tiếp / không .then() dây chuyền) vẫn là điều
    // chốt chặn cuối: một bên treo hoặc bị sửa hỏng sau này cũng không thể
    // ngăn lệnh gọi bên kia được phát ra trong cùng lượt.
    void sweepExpiredAlerts();
    void pruneOldOccurrences();
  }, minutes * 60_000);
  timer.unref?.();
}
