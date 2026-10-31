/**
 * Mã lỗi đã làm sạch từ máy chủ (`maLoi` của scadaDiag.danhSach / deviceAdapter.*; `error` của bước orchestration — hợp đồng C2) ⇒ câu hiển thị.
 * Tra theo thứ tự: `commandAudit.maLoi.<mã>` (OT_S7_*, OT_MC_*, TIMEOUT, TECHNICAL_ERROR…) → `scada.lenh.cong.<mã>` (ADAPTER_OFFLINE…)
 * → `scada.orchestration.maLoi.<mã>` (FOE_OUTCOME_*, EDGE_OUTCOME_UNKNOWN, REJECTED, PRECONDITION_FAILED). Mã lạ không có câu ⇒ `nhanMaLoi`
 * trả mã thô (người đọc vẫn tra được), `cauMaLoi` trả null. Không bao giờ trả "null" / "undefined".
 */
import type { TFunction } from "i18next";

const SENTINEL = " __missing__";
const GOC_KHOA = ["commandAudit.maLoi", "scada.lenh.cong", "scada.orchestration.maLoi"] as const;

/** Câu dịch của mã; không có khoá ⇒ null. */
export function cauMaLoi(t: TFunction, ma: string): string | null {
  for (const goc of GOC_KHOA) {
    const cau = t(`${goc}.${ma}`, { defaultValue: SENTINEL });
    if (cau !== SENTINEL) return cau;
  }
  return null;
}

export function nhanMaLoi(t: TFunction, ma: string): string {
  return cauMaLoi(t, ma) ?? ma;
}

/** Mã đứng ĐẦU chuỗi lỗi của bước: dạng chỉ-mã `FOE_OUTCOME_UNKNOWN`, kèm tham số `EDGE_OUTCOME_UNKNOWN(a,b)` hoặc `MÃ: chi tiết` (kỹ sư). */
export function maDauChuoiLoi(error: unknown): string | null {
  if (typeof error !== "string") return null;
  return /^([A-Z][A-Z0-9_]*)(?:\([^)]*\))?(?=:|\s|$)/.exec(error)?.[1] ?? null;
}
