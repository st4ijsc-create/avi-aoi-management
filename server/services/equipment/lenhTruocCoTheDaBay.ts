/**
 * SCADA R1b-2b-2a T3F (backlog 91, AN TOÀN) — "LỆNH TRƯỚC CÓ THỂ ĐANG BAY HOẶC ĐÃ BAY": các lý do một bên gửi lệnh (dispatcher OT trung tâm / robot
 * trung tâm / edge) trả về mà NGHĨA là kết cục của một lần gửi TRƯỚC với CÙNG khoá / CÙNG uỷ quyền KHÔNG RÕ (có thể đang trên đường, có thể đã áp).
 * Gặp một lý do ở đây, bước FOE không phải STOP KHÔNG được thử lại với attempt key MỚI (lần thử mới sẽ gửi lại THẬT một lệnh có thể đã áp) — cùng bất
 * biến T2B (`timeout`). MỘT nơi suy (FOE `ketCucLenhFoe` + census `guiLaiXetMotPhanCensus`). Bảng lý do → thuộc lớp? (bằng chứng file:dòng) ở báo cáo T3F.
 *
 * Lý do CHẮC CHẮN chưa gửi gì (PRECONDITION_FAILED, TAG_NOT_WRITABLE, BUSY, SAFETY_*, NOT_CONFIRMED …) KHÔNG ở đây: hành vi cũ (thử lại).
 */
import type { EquipmentCommandResult } from "./equipmentAdapter";

/** Mã (đúng như bên gửi trả) → nghĩa. Thuộc lớp "có thể đã bay" bất kể status (`rejected` / `failed`). */
const LY_DO_CO_THE_DA_BAY: ReadonlyMap<string, string> = new Map([
  // ot/commandDispatcher.ts reserveRealWrite — khoá có hàng ý định (write-ahead intent, ghi TRƯỚC thiết bị) mà KHÔNG có hàng kết quả: một lần gọi khác
  // đang giữ nó, hoặc tiến trình chết giữa "đã ghi thiết bị" và "ghi hàng kết quả".
  ["DUPLICATE_IN_FLIGHT", "an earlier attempt with the same key has a write-ahead intent but no result — it may be in flight or already applied"],
  // robot/robotCommandDispatcher.ts idempotentReplay — job cùng khoá còn ở trạng thái chưa kết thúc (running …).
  ["IDEMPOTENT_JOB_IN_PROGRESS", "an earlier robot job with the same key has not finished — it may be in flight or already done"],
  // robot/robotCommandDispatcher.ts reconcileOrphanedRobotJobs + idempotentReplay — job cùng khoá còn `running` khi tiến trình khởi động lại (robot có thể
  // đã chạy hoặc chưa). Chuỗi = PROCESS_RESTART_OUTCOME_UNKNOWN (ghim bằng test; không nhập mô-đun dispatcher robot nặng vào đây).
  ["process_restart_outcome_unknown", "an earlier robot job with the same key was still running when the process restarted — robot outcome unknown"],
  // R1b-2b-2a T6d fix 1 (bộ điều khiển, phòng thủ chiều sâu) — ot/commandDispatcher.ts `tuChoiKhoaDungLai` + robot/robotCommandDispatcher.ts (cùng mã):
  // khoá đã mang một lệnh TRƯỚC khác (thiết bị / tag / giá trị / người yêu cầu khác). Lệnh NÀY không gửi, nhưng lệnh trước cùng khoá CÓ THỂ đã áp vào
  // thiết bị ⇒ FOE KHÔNG BAO GIỜ thử lại với attempt key mới (STOP vẫn gửi lại). Câu cho người vận hành nói THẬT: không rõ lệnh trước đã áp chưa —
  // kiểm thiết bị (không phải "khoá trùng" khó hiểu).
  ["IDEMPOTENCY_KEY_REUSED", "an earlier, different command already used the same key — it is unknown whether that earlier command was applied to the device; check the device before continuing"],
]);

/** Edge: uỷ quyền của lần gửi này ĐÃ bị tiêu thụ (`jti_consumed`) — một lệnh mang nó có thể đã đi (consume được fsync TRƯỚC lời gọi driver). */
const MA_EDGE_UY_QUYEN = new Set(["AUTHORIZATION_INVALID", "JOURNAL_CONSUME_FAILED"]);
const JTI_DA_TIEU_THU = "jti_consumed";

const maCua = (x: unknown): string | null => {
  if (typeof x !== "string" || !x) return null;
  if (LY_DO_CO_THE_DA_BAY.has(x)) return x;
  const i = x.indexOf(":"); // dạng "MÃ: chi tiết"
  return i > 0 && LY_DO_CO_THE_DA_BAY.has(x.slice(0, i)) ? x.slice(0, i) : null;
};

/**
 * Mã "có thể đã bay" của kết quả một lệnh (mặt tiền thiết bị — đúng thứ FOE nhận), hoặc null. Đọc `detail.reason` (OT trung tâm / edge), `error`
 * (robot trung tâm), và cặp `detail.reason` ∈ {AUTHORIZATION_INVALID, JOURNAL_CONSUME_FAILED} + `detail.refusal === "jti_consumed"` (edge OT / robot).
 * Kết quả ok ⇒ null. Thuần.
 */
export function coTheDaBayCua(result: Pick<EquipmentCommandResult, "ok" | "detail" | "error">): string | null {
  if (result.ok) return null;
  const d = result.detail ?? {};
  const ma = maCua(d.reason) ?? maCua(result.error);
  if (ma) return ma;
  if (typeof d.reason === "string" && MA_EDGE_UY_QUYEN.has(d.reason) && d.refusal === JTI_DA_TIEU_THU) return `${d.reason}(${JTI_DA_TIEU_THU})`;
  return null;
}

/** Câu tiếng Anh cho lỗi bước (người vận hành / Studio) — kèm mã. */
export function moTaCoTheDaBay(ma: string, command: string): string {
  const goc = ma.replace(/\(.*\)$/, "");
  const nghia = LY_DO_CO_THE_DA_BAY.get(goc) ?? "the authorisation of this attempt was already used — a command carrying it may be in flight or already applied";
  return `${ma}: command "${command}" — ${nghia}; outcome unknown`;
}

/** Danh sách mã (cho test ghim / báo cáo). */
export const CAC_MA_CO_THE_DA_BAY: readonly string[] = Object.freeze([...LY_DO_CO_THE_DA_BAY.keys()]);
