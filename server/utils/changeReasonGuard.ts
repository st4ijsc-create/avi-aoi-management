/**
 * server/utils/changeReasonGuard.ts
 *
 * ★★★ BG-126 (Khối C, "nợ còn mở", 2026-09-05) — `changeReason` vừa là văn bản
 * NGƯỜI DÙNG gõ, vừa (sau NEW-3, `02676ea2`) là DẤU HIỆU CẤU TRÚC quyết định
 * việc chấm bo: `RE_TIEN_TO_VERSION_BIEN_THE = /^\[VARIANT:\d+\]/`
 * (`server/db/product.ts`) đánh dấu một hàng `measurement_point_versions` là
 * snapshot HIỆU LỰC CỦA BIẾN THỂ — `napLichSuGioiHanTheoDiem` (v2, `cayDay.ts`)
 * và `loadPointLimitSnapshots` (v1.x, `machineApiRouters.ts`) LỌC BỎ hàng mang
 * tiền tố đó khi tái dựng giới hạn cho một điểm BASE.
 *
 * Ba input router (`measurementPoint.update`/`setLimitsBatch`/
 * `revertPointsConfigToVersion` — `changeReason`/`reason`) và một input router
 * khác (`thresholdApprovalRouter.revert` — `comment`) ghi văn bản người dùng
 * NGUYÊN VĂN, 0 sanitize, vào CHÍNH `changeReason` mà các hàm DB
 * (`server/db/product.ts:~2002/2147/2396`) lưu xuống. Người dùng gõ lý do bắt
 * đầu đúng `[VARIANT:12] …` (vô tình hay cố ý) ⇒ snapshot BASE của họ trở nên
 * VÔ HÌNH với cổng snapshot-gate ⇒ khi `SPEC_GATE_SNAPSHOT_ENABLED` BẬT, sản
 * phẩm có thể được chấm bằng giới hạn CŨ hơn (hạ oan) mà không ai biết vì sao.
 *
 * ⚠ CHỈ chặn input NGƯỜI DÙNG — đường NỘI BỘ `recordVariantOverrideVersion` tự
 * ghi CHÍNH tiền tố này (đó LÀ cơ chế NEW-3 bảo vệ) và KHÔNG gọi hàm này.
 *
 * Import CHÍNH `RE_TIEN_TO_VERSION_BIEN_THE` (không chép tay regex — một
 * nguồn) TRỰC TIẾP từ `../db/product`, KHÔNG qua barrel `../db` — cùng GOTCHA
 * đã ghi ở `server/routers/machineApiRouters.ts`: một test mock nguyên module
 * `"../db"` mà không liệt kê lại export này sẽ làm nó `undefined`, khiến
 * `.test(...)` NÉM lỗi thay vì chạy đúng logic.
 */
import { appError } from "../_core/appError";
import { RE_TIEN_TO_VERSION_BIEN_THE } from "../db/product";

/**
 * Ném `BAD_REQUEST`/`CHANGE_REASON_RESERVED_PREFIX` nếu `value` (chuỗi người
 * dùng gõ cho changeReason/reason/comment) khớp CHÍNH tiền tố cấu trúc mà
 * `recordVariantOverrideVersion` dùng để đánh dấu hàng biến thể. Gọi Ở ĐẦU
 * mỗi mutation, TRƯỚC bất kỳ đọc/ghi DB nào — chặn ở input, không strip im
 * lặng. `null`/`undefined`/rỗng ⇒ qua (không có gì để chặn).
 */
export function assertChangeReasonKhongGiaTienToBienThe(
  value: string | null | undefined,
  fieldName: string,
): void {
  if (!value) return;
  if (RE_TIEN_TO_VERSION_BIEN_THE.test(value)) {
    throw appError(
      "BAD_REQUEST",
      "CHANGE_REASON_RESERVED_PREFIX",
      { field: fieldName },
      `${fieldName} không được bắt đầu bằng tiền tố hệ thống dành riêng (dạng "[VARIANT:<số>]"). Vui lòng đổi lại nội dung.`,
    );
  }
}
