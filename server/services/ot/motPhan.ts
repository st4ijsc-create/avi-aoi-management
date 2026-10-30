/**
 * SCADA R1b-2b-2a T3E (backlog 90, AN TOÀN) — lô ghi thiết bị áp MỘT PHẦN.
 *
 * Một lô nhiều write mà thiết bị đã TRẢ LỜI theo từng item: ≥ 1 item áp (`ok`), ≥ 1 item KHÔNG áp (`ok:false`, status `failed` — thiết bị nói
 * "không áp", hoặc write không rời máy). Trạng thái DB không đổi (`failed`, không giá trị enum mới, không migration — dieu-phoi phương án (B));
 * kết cục riêng được nói bằng:
 *   • `reason` = `MOT_PHAN` (DispatchResult / EdgeOtDispatchResult) và tiền tố `MOT_PHAN: ` của `errorText` trên hàng KHÔNG áp của command_log;
 *   • `motPhan = { daAp, khongAp }` (danh sách tagKey) — trên DispatchResult, và LƯU BỀN trong `command_log.ackValue.motPhan` của MỌI hàng kết quả
 *     của lô (đường thử lại idempotent `cachedResult` đọc lại được dù nó đọc hàng nào).
 * Luật T2 THẮNG: ≥ 1 write không rõ kết cục (`timeout`) ⇒ cả lô `timeout` "outcome unknown", KHÔNG BAO GIỜ một phần.
 * Không gửi lại tự động (FOE: bước không phải STOP ⇒ FOE_OUTCOME_PARTIAL); STOP vẫn được gửi lại (dừng là idempotent).
 *
 * Module THUẦN (không phụ thuộc) — FOE, dispatcher, edge, sổ edge của trung tâm và census đều dùng cùng hai hàm này.
 * Task 6 (mất liên kết GIỮA lô ⇒ nhãn theo TỪNG write) đọc cùng kết quả theo item: điểm nối là `motPhanTuKetQua` (một nơi suy).
 */

/** Mã máy đọc được (MA_LOI_DA_BIET, i18n `commandAudit.maLoi.MOT_PHAN`). */
export const MA_MOT_PHAN = "MOT_PHAN";

/** Danh sách tagKey của lô áp một phần (cả hai KHÔNG rỗng). */
export interface MotPhan {
  daAp: string[];
  khongAp: string[];
}

/** Status của một write ĐÃ ÁP (thiết bị nhận; đọc lại chỉ tinh chỉnh). */
const DA_AP = new Set(["acked", "acked_verified", "acked_unverified", "sent"]);

/**
 * Suy "một phần" từ kết quả theo write của MỘT lô (dispatcher / edge / hàng sổ edge cũ). `null` khi:
 *   • có write `timeout` (không rõ — luật T2 thắng), hoặc status lạ (không phải đã áp / `failed`);
 *   • không có write nào áp, hoặc không có write nào không áp.
 */
export function motPhanTuKetQua(ds: ReadonlyArray<{ tagKey: string; ok: boolean; status?: string | null }> | null | undefined): MotPhan | null {
  if (!Array.isArray(ds) || ds.length < 2) return null;
  const daAp: string[] = [];
  const khongAp: string[] = [];
  for (const w of ds) {
    if (!w || typeof w.tagKey !== "string") return null;
    const st = typeof w.status === "string" ? w.status : null;
    if (st === "timeout") return null; // T2 — không rõ thắng một phần
    if (w.ok === true && (st === null || DA_AP.has(st))) daAp.push(w.tagKey);
    else if (w.ok !== true && st === "failed") khongAp.push(w.tagKey);
    else return null; // simulated / rejected / lạ ⇒ không phải lô thiết bị đã trả lời
  }
  return daAp.length > 0 && khongAp.length > 0 ? { daAp, khongAp } : null;
}

/**
 * Kết cục CHUNG của một lô từ kết quả theo write (MỘT luật cho dispatcher trung tâm và edge — trước đây hai bản chép):
 *   • không phải mọi write đều ok: lô (`timedOut`) hoặc ≥ 1 write `timeout` ⇒ `timeout` (T2: không rõ thắng thất bại); còn lại ⇒ `failed`,
 *     kèm `motPhan` khi lô áp MỘT PHẦN (`motPhanTuKetQua`);
 *   • mọi write ok: tất cả `acked_verified` ⇒ `acked_verified`; ≥ 1 `acked_unverified` ⇒ `acked_unverified`; còn lại ⇒ `acked`.
 */
export function ketCucLo<S extends string>(
  outcomes: ReadonlyArray<{ tagKey: string; ok: boolean; status: S }>,
  timedOut: boolean,
): { ok: boolean; status: S | "timeout" | "failed" | "acked" | "acked_verified" | "acked_unverified"; motPhan: MotPhan | null } {
  const allOk = outcomes.length > 0 && outcomes.every((o) => o.ok);
  if (!allOk) {
    if (timedOut || outcomes.some((o) => o.status === "timeout")) return { ok: false, status: "timeout", motPhan: null };
    return { ok: false, status: "failed", motPhan: motPhanTuKetQua(outcomes) };
  }
  if (outcomes.every((o) => o.status === "acked_verified")) return { ok: true, status: "acked_verified", motPhan: null };
  if (outcomes.some((o) => o.status === "acked_unverified")) return { ok: true, status: "acked_unverified", motPhan: null };
  return { ok: true, status: "acked", motPhan: null };
}

/** Đọc lại `motPhan` đã LƯU / truyền (ackValue, detail, báo cáo edge): đúng hình (hai mảng chuỗi không rỗng) ⇒ bản sao; khác ⇒ `null`. */
export function motPhanCua(v: unknown): MotPhan | null {
  if (!v || typeof v !== "object") return null;
  const { daAp, khongAp } = v as { daAp?: unknown; khongAp?: unknown };
  const laDs = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string");
  return laDs(daAp) && laDs(khongAp) ? { daAp: [...daAp], khongAp: [...khongAp] } : null;
}

/** Câu tiếng Anh cố định (log / API / errorText), không mang host / cổng. */
export function moTaMotPhan(m: MotPhan): string {
  return `the batch was applied only partly (applied: ${m.daAp.join(", ")}; not applied: ${m.khongAp.join(", ")}) — it is NOT sent again automatically; check the device`;
}
