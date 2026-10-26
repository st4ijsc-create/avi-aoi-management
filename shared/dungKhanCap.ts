/**
 * SCADA R1b-2b-1 Task 1 (mục 59) fix round 1 (review M3 / M4, điều phối 2026-10-26) — CHỦ DUY NHẤT của hằng và từ vựng dùng chung giữa máy
 * chủ (`server/services/scada/mayDungKhanCap.ts`) và client (`client/src/components/scada/KhoiDungKhanCap.tsx`) cho khối "DỪNG MÁY khẩn cấp"
 * trên trang buộc đổi mật khẩu. Khuôn `shared/buocDoiMatKhau.ts`: một chủ, hai người gọi.
 */

/** Số máy tối đa hiện trong khối; máy chủ đọc TRẦN + 1 hàng để biết danh sách bị cắt (`biCat`, điều kiện 6). */
export const TRAN_MAY_DUNG_KHAN_CAP = 200;

/**
 * Gợi ý cấp máy (điều phối M4 phương án b): STOP HMI tới được thiết bị THẬT của máy tới đâu — CHỈ là gợi ý, KHÔNG BAO GIỜ ẩn / khoá nút DỪNG.
 *   · "du"        — mọi adapter bật của máy tới được thiết bị thật;
 *   · "mot_phan"  — một số adapter tới được, một số không;
 *   · "khong_toi" — không adapter nào tới được thiết bị thật (qua edge / mất kết nối / mô phỏng / ghim cũ / chưa ghim / không có adapter bật);
 *   · "khong_ro"  — không kiểm được (khảo sát quá hạn / lỗi). KHÔNG BAO GIỜ được suy thành "du".
 */
export const TONG_HOP_DUNG_KHAN_CAP = ["du", "mot_phan", "khong_toi", "khong_ro"] as const;
export type TongHopDungKhanCap = (typeof TONG_HOP_DUNG_KHAN_CAP)[number];
