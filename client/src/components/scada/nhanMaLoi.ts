/**
 * Mã lỗi adapter đã làm sạch từ máy chủ (`maLoi` của scadaDiag.danhSach / deviceAdapter.*, hợp đồng C2) ⇒ câu hiển thị.
 * Tra theo thứ tự: `commandAudit.maLoi.<mã>` (OT_S7_*, OT_MC_*, TECHNICAL_ERROR…) → `scada.lenh.cong.<mã>` (ADAPTER_OFFLINE…)
 * → mã thô (mã lạ không được mất; người đọc vẫn tra được). Không bao giờ trả "null" / "undefined".
 */
import type { TFunction } from "i18next";

const SENTINEL = " __missing__";

export function nhanMaLoi(t: TFunction, ma: string): string {
  for (const goc of ["commandAudit.maLoi", "scada.lenh.cong"]) {
    const cau = t(`${goc}.${ma}`, { defaultValue: SENTINEL });
    if (cau !== SENTINEL) return cau;
  }
  return ma;
}
