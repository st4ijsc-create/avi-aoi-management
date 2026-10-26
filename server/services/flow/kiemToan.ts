/**
 * ★★★ Lô kiểm toán Luồng AI (2026-10-26; dieu-phoi duyệt A) — spec §4.6 luật 5: MỌI hành động đáng ghi của Luồng vào `audit_logs` (WORM) qua ĐÚNG helper hiện có `createAuditLog`.
 *
 * Trước lô này `audit_logs` chỉ có lần TỪ CHỐI duyệt do thiếu quyền; bằng chứng "ai đã duyệt / điền" chỉ nằm trong `ai_flow_steps.output.duyet` — cắt tỉa lượt cũ sẽ xoá nó. Giờ:
 *   FLOW_LUU            lưu phiên bản (kể cả nhập gói; `nguon`)           FLOW_KICH_HOAT / FLOW_TAT   bật / tắt phiên bản        FLOW_BAT_OT   bật hạng ot (2FA)
 *   FLOW_CHAY_TAY       chạy tay luồng hạng ngoai-ghi / ot                FLOW_DUYET                  duyệt / điền THÀNH CÔNG (CÙNG giao dịch với việc trả lời hàng chờ)
 *   FLOW_BUOC_NGOAI_GHI MỘT dòng mỗi bước node tác dụng phụ (ngoai-ghi / ot) kết thúc — xong hoặc lỗi (CÙNG giao dịch với việc đóng bước)
 *   FLOW_BI_MAT_TAO / FLOW_BI_MAT_XOA / FLOW_BI_MAT_HOST   bí mật (CHỈ id + tên; KHÔNG BAO GIỜ giá trị)
 *   FLOW_CAT_TIA        một dòng mỗi lượt quét cắt tỉa lượt cũ có xoá / sẽ xoá (số lượt + cửa sổ; userId null — bộ quét nền)
 * `details` không chứa dữ liệu item / giá trị biểu mẫu / giá trị bí mật — chỉ định danh và số đếm (giá trị biểu mẫu vẫn nằm ở bước của lượt, chịu cắt tỉa).
 */
import { createAuditLog } from "../../db/system";

export const HANH_DONG_KIEM_TOAN = [
  "FLOW_LUU",
  "FLOW_KICH_HOAT",
  "FLOW_TAT",
  "FLOW_BAT_OT",
  "FLOW_CHAY_TAY",
  "FLOW_DUYET",
  "FLOW_BUOC_NGOAI_GHI",
  "FLOW_BI_MAT_TAO",
  "FLOW_BI_MAT_XOA",
  "FLOW_BI_MAT_HOST",
  "FLOW_CAT_TIA",
] as const;
export type HanhDongKiemToan = (typeof HANH_DONG_KIEM_TOAN)[number];
export type BanGhiKiemToan = Parameters<typeof createAuditLog>[0];

/** Dựng bản ghi kiểm toán (THUẦN). `thucThe`: id luồng / lượt / bí mật (chuỗi, vào `entityName`). */
export function banGhiKiemToan(y: {
  nguoi?: number | null;
  hanhDong: HanhDongKiemToan;
  loaiThucThe: "ai_flow" | "ai_flow_run" | "ai_flow_credential";
  thucThe: string;
  chiTiet: Record<string, unknown>;
  thatBai?: boolean;
}): BanGhiKiemToan {
  return {
    userId: y.nguoi ?? null,
    action: y.hanhDong,
    entityType: y.loaiThucThe,
    entityName: y.thucThe.slice(0, 200),
    details: y.chiTiet,
    status: y.thatBai ? "failure" : "success",
  };
}

/**
 * Ghi MỘT bản kiểm toán SAU một thao tác của người dùng (đường router). Lỗi ghi KHÔNG làm hỏng thao tác đã xong (cùng khuôn `FLOW_DUYET_TU_CHOI`) nhưng được log; chỗ cần nguyên tử
 * (duyệt, kết thúc bước) dùng `createAuditLog(..., tx)` trực tiếp trong giao dịch.
 */
export async function ghiKiemToanLuong(y: Parameters<typeof banGhiKiemToan>[0]): Promise<void> {
  try {
    await createAuditLog(banGhiKiemToan(y));
  } catch (e) {
    console.error(`[luong-ai] không ghi được kiểm toán ${y.hanhDong}:`, (e as Error)?.message ?? e);
  }
}
