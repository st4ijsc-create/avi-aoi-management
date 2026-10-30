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
 * MÃ lý do của một `errorText` của `command_log` — tiền tố `MA:` mà dispatcher ghi (`${reason}: ${detail}`, commandDispatcher `writeAll`).
 * Cùng biểu thức với `scadaCommands.trangThai` (`lenhHmi.trangThaiYeuCauGhi`). Không có tiền tố ⇒ `null` (không bao giờ trả phần chi tiết).
 */
export function maLoiCua(errorText: string | null | undefined): string | null {
  return /^([A-Z][A-Z0-9_]*):/.exec(errorText ?? "")?.[1] ?? null;
}
