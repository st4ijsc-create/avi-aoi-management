/**
 * SCADA R1b-2b-2a T6d (AN TOÀN, dieu-phoi 2026-11-01) — HÀM ĐẶT MIỀN cho khoá idempotency do BÊN GỌI tự chọn trên đường lập trình / deploy.
 *
 * Vì sao: `programming.deployBuild` / `requestDeployApproval` → `approveDeployment` / `rollbackDeployment` / `deployToFleet` nhận khoá do client chọn,
 * KHÔNG tiền tố người dùng / nhà máy, và khoá đó (1) là khoá UNIQUE toàn cục của `program_deployments` — người khác dùng lại khoá thấy / nhận lại hàng
 * deploy của người kia; (2) đi thẳng vào `dispatch()` OT (`recipe_param_push`) — dùng chung không gian khoá `command_log` với HMI (`hmi:<uuid>`), interlock
 * (`il-…`), FOE (`run<N>-…`), AI (`<actionId>`) ⇒ khoá trùng trả kết quả của phạm vi khác thay vì ghi ("đã ghi" GIẢ).
 *
 * Luật: khoá LƯU = `pd:u<userId>:<khoá bên gọi>` (`boundedKey` ≤ 128). Hệ quả:
 *   • khoá của NGƯỜI DÙNG KHÁC (kể cả nhà máy khác) đơn giản là KHÔNG trùng ⇒ deploy mới chạy bình thường, không lộ sự tồn tại của khoá ở phạm vi khác
 *     (luật: ngoài phạm vi ≡ không thấy) — người dùng là miền MỊN hơn nhà máy (một người dùng thuộc đúng một phạm vi nhà máy);
 *   • `userId` chỉ gồm chữ số và kết thúc ở `:` đầu tiên sau `pd:u` ⇒ không cặp (người dùng, khoá) nào cho cùng chuỗi với cặp khác (trừ băm 64 bit của
 *     `boundedKey` khi > 128 ký tự);
 *   • tiền tố `pd:` không trùng khoá của hệ con khác; MỌI khoá lập trình tới `dispatch()` đi qua `khoaDispatchLapTrinh` (adapter Mitsubishi — điểm duy
 *     nhất của đường lập trình gọi `dispatch()`), kể cả hàng `program_deployments` ghi TRƯỚC T6d (khoá thô). Lớp hai: chốt phát lại của dispatcher.
 * Census `khoaMienLapTrinh.census.test.ts`: MỌI khoá từ input bên gọi tới các điểm dẫn vào `dispatch()` đi qua các hàm này.
 */
import { boundedKey } from "../ot/otActionBinding";

/** Khoá idempotency của MỘT lượt deploy / yêu cầu duyệt / rollback: miền của người gọi. */
export function khoaMienLapTrinh(userId: number, khoaBenGoi: string): string {
  return boundedKey(`pd:u${Math.trunc(userId)}:${khoaBenGoi}`);
}

/**
 * Tiền tố khoá của một rollout nhiều máy (`deployToFleet` nối `-dev<id>` / `-rollback-dev<id>`): cùng miền; ≤ 100 ký tự để khoá từng máy luôn ≤ 128
 * (100 + `-rollback-dev` 13 + id ≤ 15).
 */
export function tienToMienLapTrinh(userId: number, tienToBenGoi: string): string {
  return boundedKey(`pd:u${Math.trunc(userId)}:${tienToBenGoi}`, 100);
}

/** Khoá đã ở miền lập trình (`pd:u<số>:…`). */
export function laKhoaMienLapTrinh(khoa: string): boolean {
  return /^pd:u\d+:/.test(khoa);
}

/**
 * Khoá `dispatch()` của một lượt ghi thiết bị từ đường lập trình: khoá đã ở miền ⇒ giữ nguyên (hàng deploy từ T6d); khoá thô (hàng ghi TRƯỚC T6d, hoặc
 * bên gọi nội bộ quên đặt miền) ⇒ đặt vào miền của người yêu cầu. Khoá lập trình KHÔNG BAO GIỜ tới `dispatch()` ngoài miền `pd:`.
 */
export function khoaDispatchLapTrinh(khoa: string, nguoiYeuCau: number): string {
  return laKhoaMienLapTrinh(khoa) ? khoa : khoaMienLapTrinh(nguoiYeuCau, khoa);
}
