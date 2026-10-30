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
 * Polish round 2 (điều phối: phương án A) — danh sách MÃ ĐÃ BIẾT. `maLoiCua` chỉ nhận tiền tố `MA:` (và `maLyDoThu` chỉ nhận mã thuần) khi mã nằm
 * ở đây — văn bản driver thô bắt đầu bằng nhãn kiểu tên máy ("PLC01_LINE3: connect …") KHÔNG được lộ nhãn ấy như "mã" cho người bị che.
 * Viết TƯỜNG MINH vì không có hằng runtime chung (mã dispatcher là literal ở điểm gọi; `MaTuChoiYeuCau` / `MaCongKenh` chỉ là KIỂU; tệp nguồn
 * thuộc 2a / client cấm sửa). `server/routers/maLoiDaBietCensus.test.ts` SUY tập nguồn bằng AST lúc test (reason dispatcher, union mã, hằng `MA_*`,
 * reasonCode của lenhHmi, status viết hoa, `CONG_BIET` client, `MA_LOI_DU_PHONG`) và ĐỎ (nêu tên) khi một mã nguồn chưa có ở đây.
 * Đo 2026-10-30: 76 mã.
 */
export const MA_LOI_DA_BIET: readonly string[] = Object.freeze([
  "ACKED", "ACKED_UNVERIFIED", "ACKED_VERIFIED", "ACTION_BINDING_MISMATCH", "ADAPTER_DISABLED", "ADAPTER_OFFLINE", "ADAPTER_OWNED_BY_EDGE", "BUSY",
  "CHANNEL_READ_ONLY", "CHUA_GHIM_STOP", "DANG_DUOC_CHON", "DA_XU_LY", "DB_UNAVAILABLE", "DIEU_TIET", "DISPATCH_LOI", "DRIVER_WRITE_FAILED",
  "DUPLICATE_IN_FLIGHT", "EDGE_CHUA_HO_TRO", "EDGE_REPORTED", "EDGE_STOP_NOT_PINNED", "FAILED", "FEATURE_DISABLED", "GHIM_LOI_DOC", "GHIM_MUC_CAO",
  "HET_HAN", "INTERLOCK_ACTION_NOT_ALLOWED", "INTERLOCK_AUTO_BLOCK_DISABLED", "INTERLOCK_BLOCKED", "INTERLOCK_COMMAND_MISMATCH",
  "INTERLOCK_EVENT_INVALID", "INTERLOCK_NOT_APPROVED", "INTERLOCK_REQUIRES_HUMAN_CONFIRM", "INTERLOCK_RULE_DISABLED", "INTERLOCK_RULE_NOT_FOUND",
  "INTERLOCK_TAG_MISMATCH", "INTERLOCK_TARGET_MISMATCH", "INTERLOCK_VALUE_MISMATCH", "INTERLOCK_WRITES_MISMATCH", "KHOA_CHON_LOI", "KHOA_MAT",
  "LEDGER_INTENT_FAILED", "MAY_DA_DOI", "MODE_LOCAL", "NOT_CONFIRMED", "NOT_FOUND", "OFF_STEP", "OUT_OF_RANGE", "PERMISSION_DENIED",
  "POLICY_APPROVAL_REQUIRED", "POLICY_DENIED", "PRECONDITION_FAILED", "QUEUE_EXPIRED", "READBACK_MISMATCH", "READBACK_UNAVAILABLE", "REJECTED",
  "ROLE_FLOOR", "SAFETY_BLOCKED", "SAFETY_SIM_ONLY", "SAFETY_UNKNOWN", "SENT", "SIMULATED", "STOPPED_BEFORE_WRITE", "STOP_QUA_HAN",
  "STOP_UNVERIFIED_QUEUE_FULL", "SUPERSEDED_BY_STOP", "TAG_NOT_FOUND", "TAG_NOT_WRITABLE", "TECHNICAL_ERROR", "THIEU_MIGRATION", "TIMEOUT",
  "TOTP_CAN", "TOTP_CHUA_DANG_KY", "TOTP_KHONG_KIEM_DUOC", "TOTP_SAI", "TOTP_TAM_KHOA", "TYPE_MISMATCH",
]);
const MA_LOI_DA_BIET_SET: ReadonlySet<string> = new Set(MA_LOI_DA_BIET);

/**
 * MÃ lý do của một `errorText` của `command_log`:
 *   1. tiền tố `MA:` ĐÃ BIẾT (`MA_LOI_DA_BIET`) mà dispatcher ghi cho từ chối (`${reason}: ${detail}`, commandDispatcher `writeAll`) — cùng biểu thức với
 *      `scadaCommands.trangThai`;
 *   2. không tiền tố (văn bản thô driver / edge) ⇒ mã DỰ PHÒNG theo `status` + hình văn bản (`MA_LOI_DU_PHONG`).
 * Không bao giờ trả phần chi tiết. `errorText` rỗng / null ⇒ `null`.
 */
export function maLoiCua(errorText: string | null | undefined, status?: string | null): string | null {
  const t = (errorText ?? "").trim();
  if (!t) return null;
  const tienTo = /^([A-Z][A-Z0-9_]*):/.exec(t)?.[1];
  // polish round 2 — CHỈ mã đã biết; tiền tố lạ (nhãn host / thiết bị viết HOA ở đầu văn bản driver) ⇒ rơi xuống mã dự phòng
  if (tienTo && MA_LOI_DA_BIET_SET.has(tienTo)) return tienTo;
  if (status === "timeout" || /outcome unknown|may have been applied/i.test(t)) return "TIMEOUT";
  if (/^edge reported status|^the edge reported/i.test(t)) return "EDGE_REPORTED";
  if (/^readback unavailable/i.test(t)) return "READBACK_UNAVAILABLE";
  if (/^readback (mismatch|not verified)/i.test(t)) return "READBACK_MISMATCH";
  if (status === "failed") return "DRIVER_WRITE_FAILED";
  return "TECHNICAL_ERROR";
}

/**
 * M1 (fix round 1) — `reasonCode` của lần thử: mã thuần (`^[A-Z][A-Z0-9_]*$`) ĐÃ BIẾT (`MA_LOI_DA_BIET`) giữ nguyên, lạ ⇒ `TECHNICAL_ERROR`; văn bản thô (đường thử lại idempotent của dispatcher
 * có thể đặt `kq.reason` = errorText đầy đủ — lenhHmi bước 9) ⇒ `maLoiCua` (tiền tố hoặc dự phòng). `null` ⇒ `null`.
 */
export function maLyDoThu(reasonCode: string | null | undefined): string | null {
  const t = (reasonCode ?? "").trim();
  if (!t) return null;
  if (/^[A-Z][A-Z0-9_]*$/.test(t)) return MA_LOI_DA_BIET_SET.has(t) ? t : "TECHNICAL_ERROR"; // polish round 2 — mã thuần lạ ⇒ dự phòng
  return maLoiCua(t, null);
}
