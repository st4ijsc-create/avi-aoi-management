/**
 * SCADA R1b-2b-2b Phần A — C1 (Q2 ĐÃ DUYỆT; KD-2bA 1.1, điều phối 2026-10-27) — MỘT luật "chi tiết kỹ thuật" cho mọi bề mặt đọc.
 *
 * "Chi tiết kỹ thuật" = thứ chỉ kỹ sư cần để chẩn đoán và có thể mang đầu mối hạ tầng: endpoint, `lastError`, văn bản lỗi driver
 * (`command_log.errorText` — có thể chứa host:port), `command_log.ackValue` (ledger nội bộ intent / result, payload ack của thiết bị).
 * Được xem ⇔ vai `admin` | `engineer` VÀ `machine_control.canEdit` (cùng nguồn quyền với `requirePermission` — `checkPermission`).
 * Người khác nhận `null` + MÃ lý do (`maLoiCua`) để giao diện không bao giờ trống im lặng.
 *
 * Dùng: `commandLog.list|get|nhatKy` (C1). C2 (`scadaDiag.danhSach`, `redactAdapterRow`) dùng lại `duocXemChiTietKyThuat`.
 */
import { checkPermission } from "../_core/accessControl";

/** Vai được xem chi tiết kỹ thuật (điều kiện cần; còn phải có `machine_control.canEdit`). */
export const VAI_XEM_CHI_TIET_KY_THUAT: ReadonlySet<string> = new Set(["admin", "engineer"]);

/**
 * HỢP ĐỒNG (Phần B dựa vào): `role ∈ {admin, engineer}` VÀ `coQuyen("machine_control", "canEdit")`.
 * `coQuyen` là bộ kiểm quyền của bên gọi (đã tính từ `checkPermission` — cùng nguồn `requirePermission`); hàm này không chạm DB.
 */
export function duocXemChiTietKyThuat(ctx: { user: { role: string } }, coQuyen: (module: string, action: string) => boolean): boolean {
  return VAI_XEM_CHI_TIET_KY_THUAT.has(ctx.user.role) && coQuyen("machine_control", "canEdit");
}

/**
 * Bản async cho thủ tục tRPC: vai ngoài tập ⇒ `false` không chạm DB; còn lại hỏi `checkPermission(machine_control, canEdit)` rồi đưa vào
 * `duocXemChiTietKyThuat` (một luật, một chỗ). Không phân giải được quyền (ném) ⇒ ném lên (thủ tục đọc thất bại, không đoán "được xem").
 */
export async function chiTietKyThuatCua(ctx: { user: { id: number; role: string } }): Promise<boolean> {
  if (!VAI_XEM_CHI_TIET_KY_THUAT.has(ctx.user.role)) return false;
  const coSua = await checkPermission(ctx.user.id, ctx.user.role, "machine_control", "canEdit");
  return duocXemChiTietKyThuat(ctx, (m, a) => m === "machine_control" && a === "canEdit" && coSua);
}

/**
 * Mã DỰ PHÒNG khi `errorText` không có tiền tố `MA:` (fix round 1, review I1) — đó chính là các hàng mang VĂN BẢN THÔ của driver / edge:
 *   • `TIMEOUT`              — status `timeout`, hoặc văn bản "outcome unknown … may have been applied" (`otDeviceWrite.ts` timeout / mất liên
 *                              kết lúc đang bay). Gợi ý an toàn "không rõ máy đã nhận — đọc lại trước khi gửi lần nữa" sống qua lớp che (client
 *                              đã có chữ `scada.lenh.cong.TIMEOUT`).
 *   • `EDGE_REPORTED`        — `edge reported status "…"` / "the edge reported …" (`edgeReportsCentral.ts` hàng do edge báo).
 *   • `READBACK_UNAVAILABLE` — `readback unavailable` (status acked_unverified: ghi xong, không đọc lại được).
 *   • `READBACK_MISMATCH`    — `readback mismatch: …` / `readback not verified: …` (acked_unverified: đọc lại lệch / mẫu không good).
 *   • `DRIVER_WRITE_FAILED`  — status `failed` với văn bản thô (vd `connect ECONNREFUSED 127.0.0.1:502`, `no result`, `write failed`).
 *   • `TECHNICAL_ERROR`      — mọi văn bản thô khác.
 * Đây là CHUỖI lý do (cùng họ `reason` của dispatch), không phải mã `appErrorCodes`.
 */
export const MA_LOI_DU_PHONG = ["TIMEOUT", "EDGE_REPORTED", "READBACK_UNAVAILABLE", "READBACK_MISMATCH", "DRIVER_WRITE_FAILED", "TECHNICAL_ERROR"] as const;

/**
 * MÃ lý do của một `errorText` của `command_log`:
 *   1. tiền tố `MA:` mà dispatcher ghi cho từ chối (`${reason}: ${detail}`, commandDispatcher `writeAll`) — cùng biểu thức với
 *      `scadaCommands.trangThai`;
 *   2. không tiền tố (văn bản thô driver / edge) ⇒ mã DỰ PHÒNG theo `status` + hình văn bản (`MA_LOI_DU_PHONG`).
 * Không bao giờ trả phần chi tiết. `errorText` rỗng / null ⇒ `null`.
 */
export function maLoiCua(errorText: string | null | undefined, status?: string | null): string | null {
  const t = (errorText ?? "").trim();
  if (!t) return null;
  const tienTo = /^([A-Z][A-Z0-9_]*):/.exec(t)?.[1];
  if (tienTo) return tienTo;
  if (status === "timeout" || /outcome unknown|may have been applied/i.test(t)) return "TIMEOUT";
  if (/^edge reported status|^the edge reported/i.test(t)) return "EDGE_REPORTED";
  if (/^readback unavailable/i.test(t)) return "READBACK_UNAVAILABLE";
  if (/^readback (mismatch|not verified)/i.test(t)) return "READBACK_MISMATCH";
  if (status === "failed") return "DRIVER_WRITE_FAILED";
  return "TECHNICAL_ERROR";
}

/**
 * M1 (fix round 1) — `reasonCode` của lần thử: mã thuần (`^[A-Z][A-Z0-9_]*$`) giữ nguyên; văn bản thô (đường thử lại idempotent của dispatcher
 * có thể đặt `kq.reason` = errorText đầy đủ — lenhHmi bước 9) ⇒ `maLoiCua` (tiền tố hoặc dự phòng). `null` ⇒ `null`.
 */
export function maLyDoThu(reasonCode: string | null | undefined): string | null {
  const t = (reasonCode ?? "").trim();
  if (!t) return null;
  if (/^[A-Z][A-Z0-9_]*$/.test(t)) return t;
  return maLoiCua(t, null);
}
