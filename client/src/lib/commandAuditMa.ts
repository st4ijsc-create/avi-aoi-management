/**
 * SCADA R1b-2b-2b A — C1 fix round 1 (M2) — KHOÁ CHỮ cho MÃ lỗi của một hàng sổ lệnh khi máy chủ che `errorText` (`commandLog.list/get.maLoi`).
 *   1. mã cổng / dispatch đã có chữ ở hộp thoại lệnh (`CONG_BIET` của `ketQuaLenh.ts`) ⇒ `scada.lenh.cong.<MÃ>` (cùng một câu ở mọi nơi);
 *   2. mã DỰ PHÒNG của máy chủ (`MA_LOI_DU_PHONG`, `server/routers/_chiTietKyThuat.ts`) ⇒ `commandAudit.maLoi.<MÃ>`;
 *   3. mã lạ ⇒ `null` (bên gọi hiện mã thô — không bao giờ trống).
 */
import { CONG_BIET } from "@/components/scada/ketQuaLenh";

const CONG_BIET_SET: ReadonlySet<string> = new Set(CONG_BIET);

/** Bản sao phía client của `MA_LOI_DU_PHONG` (máy chủ) — test so khớp hai danh sách. */
export const MA_LOI_DU_PHONG_CLIENT = ["TIMEOUT", "EDGE_REPORTED", "READBACK_UNAVAILABLE", "READBACK_MISMATCH", "DRIVER_WRITE_FAILED", "TECHNICAL_ERROR"] as const;

export function khoaMaLoi(ma: string, coKhoa: (khoa: string) => boolean): string | null {
  if (CONG_BIET_SET.has(ma)) return `scada.lenh.cong.${ma}`;
  const k = `commandAudit.maLoi.${ma}`;
  return coKhoa(k) ? k : null;
}
