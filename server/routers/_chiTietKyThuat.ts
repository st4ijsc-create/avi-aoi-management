/**
 * SCADA R1b-2b-2b Phần A — C1 (Q2 ĐÃ DUYỆT; KD-2bA 1.1, điều phối 2026-10-27) — MỘT luật "chi tiết kỹ thuật" cho mọi bề mặt đọc.
 *
 * "Chi tiết kỹ thuật" = thứ chỉ kỹ sư cần để chẩn đoán và có thể mang đầu mối hạ tầng: endpoint, `lastError`, văn bản lỗi driver
 * (`command_log.errorText` — có thể chứa host:port), `command_log.ackValue` (ledger nội bộ intent / result, payload ack của thiết bị).
 * Được xem ⇔ vai `admin` | `engineer` VÀ `machine_control.canEdit` (cùng nguồn quyền với `requirePermission` — `checkPermission`).
 * Người khác nhận `null` + MÃ lý do (`maLoiCua`) để giao diện không bao giờ trống im lặng.
 *
 * Dùng: `commandLog.list|get|nhatKy` (C1); C2: `scadaDiag.danhSach` + `deviceAdapter.list|get|create|update` (`redactAdapterRow`) dùng lại
 *   `chiTietKyThuatCua` / `duocXemChiTietKyThuat` và `maLoiAdapterCua` (mã thay `lastError`).
 * C2 fix 3 (né đường vòng): REST `GET /api/v1/assets/:id/health` (khoá API ⇒ `redactAdapterRow` với `chiTietKyThuat: false` — khoá API không bao giờ
 *   là người xem) + `GET /api/observability/health` (cùng luật `systemHealth.connectionSupervisors`). MỌI bề mặt REST + tRPC chạm endpoint /
 *   activeEndpoint / connectionOptions / lastError được kiểm kê ở `server/routers/chiTietKyThuatBeMatCensus.test.ts`.
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
 * Đo 2026-10-30: 76 mã. + `OT_MC_TAM_KHOA` (R1b-2b-2a T3B-0: tiền tố errorText của driver MC khi ghi tạm khoá — hằng ở mitsubishiMcDriver.ts; từ fix round 1 của T3B-0 tệp driver MC NẰM trong nguồn suy của census).
 * + `OT_S7_BIT_NGOAI_DAI`, `OT_S7_DIA_CHI_THU_VIEN_BO` (R1b-2b-2a T3C: tiền tố errorText của driver S7 khi từ chối lô — địa chỉ bit ∉ 0..7 / địa chỉ nodes7 sẽ bỏ; hằng ở
 *   s7Address.ts, tệp nằm trong nguồn suy của census).
 * + `OT_S7_THU_VIEN_KHONG_KIEM_DUOC` (T3C fix 1, M1: bộ phân tích / nội tại nodes7 không dùng được ⇒ từ chối fail-closed; hằng ở s7Address.ts).
 * + C2 fix 4 (điều phối 2026-11-01) — tiền tố lỗi BƯỚC / RUN của orchestration: `FOE_OUTCOME_UNKNOWN`, `FOE_OUTCOME_PARTIAL`, `FOE_GATE_REQUIRED`
 *   (hằng ở foeEngine.ts / foeRunStore.ts, nằm trong nguồn suy của census) và `EDGE_OUTCOME_UNKNOWN` (literal ở foeRunStore.ts — trạng thái tiếp tục).
 * + `MOT_PHAN` (R1b-2b-2a T3E, backlog 90: lô ghi thiết bị áp MỘT PHẦN — `reason` của dispatch + tiền tố errorText của hàng KHÔNG áp; status vẫn `failed`;
 *   hằng `MA_MOT_PHAN` ở server/services/ot/motPhan.ts, tệp nằm trong nguồn suy của census). Danh sách item đi trong `ackValue.motPhan` (chi tiết kỹ thuật).
 */
export const MA_LOI_DA_BIET: readonly string[] = Object.freeze([
  "ACKED", "ACKED_UNVERIFIED", "ACKED_VERIFIED", "ACTION_BINDING_MISMATCH", "ADAPTER_DISABLED", "ADAPTER_OFFLINE", "ADAPTER_OWNED_BY_EDGE", "BUSY",
  "CHANNEL_READ_ONLY", "CHUA_GHIM_STOP", "DANG_DUOC_CHON", "DA_XU_LY", "DB_UNAVAILABLE", "DIEU_TIET", "DISPATCH_LOI", "DRIVER_WRITE_FAILED",
  "DUPLICATE_IN_FLIGHT", "EDGE_CHUA_HO_TRO", "EDGE_OUTCOME_UNKNOWN", "EDGE_REPORTED", "EDGE_STOP_NOT_PINNED", "FAILED", "FEATURE_DISABLED",
  "FOE_GATE_REQUIRED", "FOE_OUTCOME_PARTIAL", "FOE_OUTCOME_UNKNOWN", "GHIM_LOI_DOC", "GHIM_MUC_CAO",
  "HET_HAN", "INTERLOCK_ACTION_NOT_ALLOWED", "INTERLOCK_AUTO_BLOCK_DISABLED", "INTERLOCK_BLOCKED", "INTERLOCK_COMMAND_MISMATCH",
  "INTERLOCK_EVENT_INVALID", "INTERLOCK_NOT_APPROVED", "INTERLOCK_REQUIRES_HUMAN_CONFIRM", "INTERLOCK_RULE_DISABLED", "INTERLOCK_RULE_NOT_FOUND",
  "INTERLOCK_TAG_MISMATCH", "INTERLOCK_TARGET_MISMATCH", "INTERLOCK_VALUE_MISMATCH", "INTERLOCK_WRITES_MISMATCH", "KHOA_CHON_LOI", "KHOA_MAT",
  "LEDGER_INTENT_FAILED", "MAY_DA_DOI", "MODE_LOCAL", "MOT_PHAN", "NOT_CONFIRMED", "NOT_FOUND", "OFF_STEP", "OT_MC_TAM_KHOA", "OT_S7_BIT_NGOAI_DAI",
  "OT_S7_DIA_CHI_THU_VIEN_BO", "OT_S7_THU_VIEN_KHONG_KIEM_DUOC", "OUT_OF_RANGE", "PERMISSION_DENIED",
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

/**
 * SCADA R1b-2b-2b Phần A — C2 (KD-2bA 2.1, điều phối 2026-10-27) — MÃ / nhóm lỗi đã làm sạch của lỗi KẾT NỐI adapter (`device_adapters.lastError`,
 * `loi` RAM của M10, lý do cấu hình S7 ghép đầu). Cùng cơ chế với `maLoiCua` (một danh sách `MA_LOI_DA_BIET`), khác phần dự phòng: lỗi adapter
 * không phải kết cục lệnh nên KHÔNG dùng `DRIVER_WRITE_FAILED` / `TIMEOUT`…:
 *   1. tiền tố `MA:` ĐÃ BIẾT (vd `OT_S7_BIT_NGOAI_DAI`, `OT_MC_TAM_KHOA`) ⇒ chính mã đó;
 *   2. văn bản thô của driver (có thể mang host:port, vd `connect ECONNREFUSED 10.0.0.5:502`) ⇒ `ADAPTER_OFFLINE` khi adapter đang mất kết nối
 *      (`matKetNoi` — M10 `lost` / DB `status='error'`), còn lại `TECHNICAL_ERROR`.
 * Không bao giờ trả phần chi tiết. Rỗng / null ⇒ `null`. Người vận hành nhờ mã này vẫn biết "mất kết nối / sai cấu hình" khi `endpoint` / `lastError`
 * bị che (giao diện dịch qua khoá i18n của mã — `scada.lenh.cong.ADAPTER_OFFLINE`, `commandAudit.maLoi.*` đã có).
 */
export function maLoiAdapterCua(loi: string | null | undefined, matKetNoi: boolean): string | null {
  const t = (loi ?? "").trim();
  if (!t) return null;
  const tienTo = /^([A-Z][A-Z0-9_]*):/.exec(t)?.[1];
  if (tienTo && MA_LOI_DA_BIET_SET.has(tienTo)) return tienTo;
  return matKetNoi ? "ADAPTER_OFFLINE" : "TECHNICAL_ERROR";
}

/**
 * SCADA R1b-2b-2b A — C2 fix 4 (điều phối 2026-11-01, KD-2bA 1.1 / 2.1) — lỗi BƯỚC / RUN của orchestration (`orchestration_run_steps.error`,
 * `orchestration_runs.error`, lỗi trong trạng thái tiếp tục `contextJson.foeResumeState[*].error`) cùng họ với `command_log.errorText`: bước lệnh OT
 * mang `EquipmentCommandResult.error` = thông điệp dispatcher / driver (có thể có host:port). Người KHÔNG được xem chi tiết kỹ thuật (`chiTietKyThuatCua`
 * false; khoá API luôn false) nhận MÃ qua CHÍNH `maLoiCua` (tiền tố đã biết — `FOE_OUTCOME_UNKNOWN`, `FOE_OUTCOME_PARTIAL`, `DUPLICATE_IN_FLIGHT`,
 * `MOT_PHAN`… — hoặc mã dự phòng theo status); kỹ sư giữ nguyên văn.
 *
 * `result` của bước lệnh (`{ routedTo, status, accepted, simulated, detail }`, cả hàng abort-STOP): `detail` là `EquipmentCommandResult.detail` —
 * `reason` có thể là văn bản driver (đường thử lại idempotent của dispatcher), `results` / `refusal` của edge mang văn bản thiết bị, `motPhan` liệt kê
 * tag (chi tiết kỹ thuật, như C1 `ackValue.motPhan`). Bị che ⇒ `detail` chỉ giữ DANH SÁCH TRẮNG an toàn (`simulated`, `commandLogIds`, `appError`
 * {appCode, appParams}, `edge`, `stop`, `pinnedStop`) + `reason` qua `maLyDoThu` (mã) + `motPhan` chỉ còn số đếm; khoá khác bị bỏ.
 * Các trường khác của `result` (nhánh, prompt / approverRoles / note của cổng, reachedState…) không phải chi tiết kỹ thuật ⇒ giữ.
 */
const DETAIL_AN_TOAN = ["simulated", "commandLogIds", "appError", "edge", "stop", "pinnedStop"] as const;

function cheDetailLenh(detail: unknown): unknown {
  if (detail === null || typeof detail !== "object" || Array.isArray(detail)) return detail === undefined ? undefined : null;
  const d = detail as Record<string, unknown>;
  const ra: Record<string, unknown> = {};
  for (const k of DETAIL_AN_TOAN) if (k in d) ra[k] = d[k];
  if ("reason" in d) ra.reason = typeof d.reason === "string" ? maLyDoThu(d.reason) : null;
  if (d.motPhan && typeof d.motPhan === "object") {
    const mp = d.motPhan as { daAp?: unknown; khongAp?: unknown };
    ra.motPhan = { soDaAp: Array.isArray(mp.daAp) ? mp.daAp.length : null, soKhongAp: Array.isArray(mp.khongAp) ? mp.khongAp.length : null };
  }
  return ra;
}

/** `result` của một bước, bị che (chỉ đụng `detail`). */
export function cheKetQuaBuoc(result: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || !("detail" in result)) return result;
  return { ...result, detail: cheDetailLenh(result.detail) };
}

/** `contextJson` của run, bị che: `foeResumeState[*].error` ⇒ mã (phần còn lại là sổ con trỏ / quyết định cổng / telemetry — không phải chi tiết kỹ thuật). */
function cheNguCanhRun(ctx: unknown): unknown {
  if (ctx === null || typeof ctx !== "object" || Array.isArray(ctx)) return ctx;
  const c = ctx as Record<string, unknown>;
  const rs = c.foeResumeState;
  if (!rs || typeof rs !== "object" || Array.isArray(rs)) return ctx;
  const ra: Record<string, unknown> = {};
  for (const [id, v] of Object.entries(rs as Record<string, unknown>)) {
    ra[id] = v && typeof v === "object" && !Array.isArray(v) ? { ...(v as object), error: maLoiCua((v as { error?: string | null }).error, "failed") } : v;
  }
  return { ...c, foeResumeState: ra };
}

/** Hàng run (`orchestration_runs`) theo người xem: bị che ⇒ `error` = mã, `contextJson` che lỗi trạng thái tiếp tục. */
export function cheHangRun<R extends { error: string | null; status: string; contextJson?: unknown }>(run: R, chiTietKyThuat: boolean): R {
  if (chiTietKyThuat) return run;
  return { ...run, error: maLoiCua(run.error, run.status), ...("contextJson" in run ? { contextJson: cheNguCanhRun(run.contextJson) } : {}) };
}

/**
 * MÃ của lỗi một BƯỚC orchestration: `FOE_GATE_REQUIRED(<lý do>): …` (văn bản do máy chủ soạn, `gateRequiredError` — không mang chi tiết kỹ thuật)
 * giữ nguyên DẠNG MÃ `FOE_GATE_REQUIRED(<lý do>)` để Studio vẫn hiện câu dịch đúng lý do (`gateRequiredReasonOf`, OrchestrationStudio.tsx); mọi
 * trường hợp khác ⇒ `maLoiCua` (tiền tố đã biết hoặc mã dự phòng theo status bước).
 */
export function maLoiBuocFoe(error: string | null | undefined, status?: string | null): string | null {
  const m = /^(FOE_GATE_REQUIRED)\(([a-zA-Z]{1,40})\)(?=:|\s|$)/.exec((error ?? "").trim());
  if (m) return `${m[1]}(${m[2]})`;
  return maLoiCua(error, status);
}

/** Một bước của run theo người xem: bị che ⇒ `error` = mã (`maLoiBuocFoe`), `result.detail` theo danh sách trắng. */
export function cheBuocRun<S extends { error: string | null; status: string; result: Record<string, unknown> | null }>(s: S, chiTietKyThuat: boolean): S {
  if (chiTietKyThuat) return s;
  return { ...s, error: maLoiBuocFoe(s.error, s.status), result: cheKetQuaBuoc(s.result) };
}

/**
 * MỘT bộ che cho view của run (tRPC `orchestration.getRun`, REST `GET /api/v1/orchestration/runs/:id`). REST truyền `false` TƯỜNG MINH (khoá API không
 * bao giờ là người xem chi tiết kỹ thuật); tRPC truyền `await chiTietKyThuatCua(ctx)`.
 */
export function cheRunView<V extends { run: { error: string | null; status: string; contextJson?: unknown }; steps: Array<{ error: string | null; status: string; result: Record<string, unknown> | null }> }>(
  view: V,
  chiTietKyThuat: boolean,
): V {
  if (chiTietKyThuat) return view;
  return { ...view, run: cheHangRun(view.run, false), steps: view.steps.map((s) => cheBuocRun(s, false)) };
}
