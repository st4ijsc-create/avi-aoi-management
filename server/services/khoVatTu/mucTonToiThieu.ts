/**
 * ★★★ Mức tồn tối thiểu phụ tùng THEO NHÀ MÁY — quyết định chủ dự án 2026-10-25 (câu hỏi W14-Q2), cách hiểu của dieu-phoi, ĐỌC LẠI BỞI CHỦ DỰ ÁN:
 *   • mức tối thiểu = 3 % số máy hiện có (của nhà máy đó, dùng loại vật tư đó), LÀM TRÒN LÊN, tối thiểu 1;
 *   • không xác định được số máy ⇒ mặc định 3 cho mỗi loại.
 * "Số máy dùng loại vật tư đó" = số máy KHÁC NHAU của nhà máy từng tiêu hao phụ tùng ấy (work_order_parts → phiếu bảo trì → máy).
 * Báo "cần nhập" khi tồn ≤ max(reorderLevel đã khai, mức tính ở đây) — mức tính là SÀN, không hạ mức người dùng đã đặt.
 *
 * Ví dụ (bất biến, có test): 0 máy / không rõ ⇒ 3 · 1 máy ⇒ 1 · 33 máy ⇒ 1 · 34 máy ⇒ 2 · 50 máy ⇒ 2 · 100 máy ⇒ 3 · 101 máy ⇒ 4.
 */
export const TY_LE_TON_TOI_THIEU_PHAN_TRAM = 3;
export const TON_TOI_THIEU_KHONG_XAC_DINH = 3;

/** Mức tồn tối thiểu theo số máy (số nguyên ⇒ phép chia làm tròn lên chính xác, không sai số dấu phẩy động). */
export function mucTonToiThieu(soMay: number | null | undefined): number {
  if (soMay == null || !Number.isFinite(soMay) || soMay <= 0) return TON_TOI_THIEU_KHONG_XAC_DINH;
  const n = Math.floor(soMay);
  return Math.max(Math.ceil((TY_LE_TON_TOI_THIEU_PHAN_TRAM * n) / 100), 1);
}

/** Ngưỡng cảnh báo cuối cùng: max(reorderLevel đã khai, mức tính theo nhà máy). */
export function nguongCanNhap(reorderLevel: number, soMay: number | null | undefined): number {
  return Math.max(reorderLevel, mucTonToiThieu(soMay));
}
