/**
 * Task 8 Khối C — MỘT hàm dùng chung để trả lời "bản vá này có CHẠM vào một
 * trường GIỚI HẠN không" (⇒ trên sản phẩm live+enforced phải đi qua hàng đợi
 * duyệt ngưỡng, xem `assertThresholdEditAllowed`).
 *
 * Trước bản vá này có HAI bản `touchesLimits` độc lập, không cổng nào canh
 * lệch nhau (Task 7 review, F2 — `khoic-task7-report.md`):
 *   - `server/routers/productRouters.ts` (`measurementPoint.update`) — chỉ
 *     chép tay 6 field (lowerLimit/upperLimit/nominalValue/toleranceMode/
 *     tolPlus/tolMinus).
 *   - `server/utils/measurementPointImport.ts` (bulk import) — chép tay 13
 *     field, THIẾU 9/18 cột của `POINT_LIMIT_SPEC`, và `unit` được gán VÔ
 *     ĐIỀU KIỆN (không qua gate nào) ⇒ một sheet nhập chỉ mang cột `unit` (hoặc
 *     `warpageMax`/`voidPctMax`/`offsetXMax`/`offsetYMax`/`tiltMax`/
 *     `thicknessMin`/`thicknessMax`) trên sản phẩm ĐANG CHẠY (live+enforced)
 *     ghi thẳng, lách hoàn toàn hàng đợi duyệt ngưỡng — không lưới nào bắt vì
 *     mỗi nơi tự đo theo tập field CỦA RIÊNG NÓ.
 * Đúng lớp lỗi Task 7 vừa dọn cho SELECT giới hạn cấp cây / kiểu
 * `PointLimitSource` — dọn tiếp cho `touchesLimits` bằng MỘT hàm SUY từ
 * `APPROVAL_LIMIT_FIELDS` (`shared/pointLimitSpec.ts`, không chép tay danh
 * sách cột lần thứ ba), cả hai nơi gọi CHUNG một hàm này.
 */
import { APPROVAL_LIMIT_FIELDS } from "@shared/pointLimitSpec";

/**
 * `true` nếu `fields` có ÍT NHẤT MỘT khoá thuộc `APPROVAL_LIMIT_FIELDS`
 * (18 cột giới hạn vật lý mà spec-gate chấm bằng + 4 field "giới hạn nghiệp
 * vụ" `nominalValue`/`toleranceMode`/`tolPlus`/`tolMinus`) được gán giá trị
 * (khác `undefined`). Chỉ đọc — không sửa `fields`.
 *
 * Nhận `Record<string, unknown>` bất kỳ: patch tRPC input (`rest` sau khi
 * destructure `id`/`changeReason`/…) hoặc một dòng bulk-import đã qua zod —
 * cả hai đều là object phẳng, đọc field bằng tên là đủ.
 */
export function touchesApprovalLimitFields(fields: Record<string, unknown>): boolean {
  return APPROVAL_LIMIT_FIELDS.some((f) => fields[f] !== undefined);
}
