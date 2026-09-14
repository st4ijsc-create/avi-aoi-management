/**
 * onDinhTheoGiaTri.ts — GIỮ NGUYÊN THAM CHIẾU khi GIÁ TRỊ không đổi, để cảnh 3D không vẽ lại vì một đối tượng mới
 * mang y nguyên nội dung.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 38 (Pareto #1 QA Đợt 37, phần dư sau khi hết tween) — ĐO ĐƯỢC, KHÔNG PHỎNG ĐOÁN
 * ════════════════════════════════════════════════════════════════════════════
 * Sau khi khoá `khungNhin` theo giá trị, màn Máy đứng yên vẫn vẽ **16–18 khung/40 s** (`.qa-dot38/sau/p1-may-*`),
 * `/twin` 10–13, Line 15–17. Tách nguồn bằng harness QA (`.qa-dot38/ablation-may/`): chặn tRPC ⇒ 10, đối chứng ⇒ 16
 * ⇒ ~6 khung do **poll tRPC** dù dữ liệu y nguyên; phần còn lại do gói `twin:trangThai` 10 s — cũng y nguyên (nhịp
 * tim 54 ngày không đổi). Camera không đổi ⇒ không phải tween.
 *
 * Gốc rễ: cả ba trang khai `const bayGioThat = Date.now()` MỖI RENDER và đặt nó vào deps (`tsTheoMay`,
 * `trangThaiTheoMay`… qua `bayGio = dongHoHienThi(kho, bayGioThat)`) ⇒ mỗi re-render (mỗi phản hồi poll, mỗi gói
 * socket) dựng lại `mayTatCa` → `mayVe` → `LoBatchMay` cập nhật màu → `invalidate()` → một khung, dù không có byte
 * dữ liệu nào đổi. `frameloop="demand"` chỉ có nghĩa nếu "đổi tham chiếu" ⇔ "đổi giá trị" — đó là việc của tệp này.
 *
 * ★ Cùng cơ chế với `khoaKhungNhin` (Đợt 35/36/38): tính bản THÔ mỗi render (rẻ — vài chục máy), rút một KHOÁ chuỗi
 *   từ MỌI trường mà cảnh đọc, và chỉ đổi đối tượng khi khoá đổi. Khoá lấy TỪ TOÀN BỘ trường (không chọn lọc) để
 *   một trường mới được thêm vào `MayVanHanh` không lặng lẽ bị bỏ ngoài phép so (lớp lỗi "danh sách thay vì bất biến").
 * ★ Hàm khoá THUẦN — test trong node; hook chỉ là `useMemo` theo khoá.
 */
import { useMemo } from "react";
import type { MayVanHanh } from "./trungThucDuLieu";

/** Khoá giá trị của một danh sách máy đã hợp nhất — MỌI trường, theo thứ tự danh sách. */
export function khoaMayVanHanh(ds: readonly MayVanHanh[]): string {
  return JSON.stringify(ds);
}

/** Khoá giá trị của một bản đồ `machineId → chuỗi` (trạng thái hiển thị, mã…), theo thứ tự chèn. */
export function khoaBanDo(m: ReadonlyMap<number, string>): string {
  let s = "";
  for (const [id, v] of m) s += `${id}:${v};`;
  return s;
}

/**
 * Trả `giaTri` của lần render mà `khoa` đổi lần cuối; các render sau với cùng `khoa` nhận lại ĐÚNG tham chiếu ấy.
 * ⚠ Người gọi chịu trách nhiệm để `khoa` bao trọn mọi trường được dùng — thiếu một trường là cảnh không cập nhật câm.
 */
export function useOnDinhTheoGiaTri<T>(giaTri: T, khoa: string): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- cố ý: chỉ đổi tham chiếu khi GIÁ TRỊ (khoá) đổi
  return useMemo(() => giaTri, [khoa]);
}
