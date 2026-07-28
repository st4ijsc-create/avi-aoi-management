/**
 * Final-fix round (khuyến nghị mạnh) — extracted from PointDetailsForm.tsx's
 * `handleSuggestionApplied` (the patch for the MOST severe bug of the whole wave: after a
 * threshold suggestion is approved+applied, the form's LSL/USL/nominal inputs kept their STALE
 * local-state values, so the very next click on "Save" silently overwrote the just-approved DB
 * row). That handler carried every risk decision inline in the component — the "point still
 * open" guard, the `wasDirty` comparison, the `!showToleranceSection` branch — with NO pure
 * function and NO test touching any of it. Wave-wide, every OTHER risky decision got this
 * treatment (`canDecide` in pendingSuggestionLogic.ts, `toBatchItem`, `runCancellableBatchSubmit`,
 * `isQueuedFileStillPending` in sourceTabLogic.ts) — this was the one exception, and it guards
 * the single most severe bug in the wave. A future reader who sees the "point still open" guard
 * as redundant and deletes it would silently reintroduce the overwrite-approved-values bug, with
 * NO test turning red.
 *
 * `resolveAppliedThreshold` is the pure decision PointDetailsForm.tsx's handler now calls: it
 * takes the same inputs the inline logic read and returns exactly what to do — the component's
 * job is reduced to `setState` + `toast` based on the result.
 */
export interface AppliedThreshold {
  pointDefId: number;
  lsl: string;
  usl: string;
  nominal: string | null;
}

/**
 * The subset of `measurementPoints[selectedPointIndex]` this decision actually reads.
 * `id` is OPTIONAL (not just `number | undefined`) to structurally match
 * `MeasurementPoint.id?: number` (types.ts) — TS treats an optional property as assignable only
 * to another optional property, not to a required `X | undefined` one, so `?:` here (not a
 * union) is required for `PointDetailsForm.tsx` to pass `measurementPoints[selectedPointIndex]`
 * straight through without a cast. A point row with no `id` yet (never persisted) can never
 * match a real `applied.pointDefId`, so it correctly falls into the "none" branch below either way.
 */
export interface CurrentPointSnapshot {
  id?: number;
  lowerLimit?: unknown;
  upperLimit?: unknown;
  nominalValue?: unknown;
}

export interface ResolveAppliedThresholdInput {
  applied: AppliedThreshold;
  /** `null` when no point row is currently selected/open in the form. */
  selectedPointIndex: number | null;
  /** `measurementPoints[selectedPointIndex]` — `undefined` if out of range/not loaded. */
  currentPoint: CurrentPointSnapshot | undefined;
  /** Current (possibly hand-edited, unsaved) form field values. */
  formLowerLimit: string;
  formUpperLimit: string;
  formNominalValue: string;
  /** Whether this point TYPE even renders the LSL/USL/nominal inputs. */
  showToleranceSection: boolean;
}

export type AppliedThresholdToast = "none" | "reloaded" | "overDirty" | "noInputs";

export interface ResolvedAppliedThreshold {
  toast: AppliedThresholdToast;
  /** Only present when `toast !== "none"` — the values the component should apply via setState. */
  lsl?: string;
  usl?: string;
  nominal?: string;
}

/**
 * Vòng sửa 2 (F1, nghiệm thu live — CRITICAL, gốc của bug này) — logic gốc, giữ nguyên hành vi
 * 1:1 (chỉ tách thành hàm thuần):
 *
 *  1. Điểm đang mở PHẢI khớp `applied.pointDefId` (người dùng có thể đã chuyển điểm khác trong
 *     lúc mutation còn chạy) — nếu không khớp (hoặc không có điểm nào đang mở), KHÔNG đổi gì cả
 *     ⇒ `toast: "none"`, không có lsl/usl/nominal để component áp dụng.
 *  2. `wasDirty` so giá trị hiện tại của form với snapshot điểm TRƯỚC-khi-duyệt
 *     (`currentPoint.lowerLimit/upperLimit/nominalValue`) — lệch nghĩa là người dùng đã gõ tay
 *     một bản nháp chưa lưu.
 *  3. State LUÔN được cập nhật (lsl/usl/nominal có mặt trong kết quả) bất kể loại điểm có ô
 *     ngưỡng hay không — đây là state chung `handleSavePoint` dùng để build payload Lưu; bỏ qua
 *     cho loại không hiện ô sẽ khiến "Lưu" gửi state CŨ (vòng sửa 3, F4).
 *  4. Loại điểm không có ô ngưỡng (`!showToleranceSection`) ⇒ `toast: "noInputs"` (nói "đã ghi
 *     vào điểm đo", KHÔNG nói "form" — không có ô nào để nạp vào).
 *  5. Có ô ngưỡng + đang dirty ⇒ `toast: "overDirty"` (nạp đè + cảnh báo rõ ràng — ưu tiên khớp
 *     DB hơn giữ bản nháp, vì rủi ro lớn hơn nằm ở form sai lệch với DB ngay sau một quyết định
 *     duyệt).
 *  6. Có ô ngưỡng + không dirty ⇒ `toast: "reloaded"` (thông báo nhẹ nhàng, không cảnh báo).
 */
export function resolveAppliedThreshold(input: ResolveAppliedThresholdInput): ResolvedAppliedThreshold {
  const { applied, selectedPointIndex, currentPoint, formLowerLimit, formUpperLimit, formNominalValue, showToleranceSection } = input;

  if (selectedPointIndex === null || !currentPoint || currentPoint.id !== applied.pointDefId) {
    return { toast: "none" };
  }

  const norm = (v: unknown) => (v == null ? "" : String(v));
  const wasDirty =
    norm(currentPoint.lowerLimit) !== norm(formLowerLimit) ||
    norm(currentPoint.upperLimit) !== norm(formUpperLimit) ||
    norm(currentPoint.nominalValue) !== norm(formNominalValue);

  const lsl = applied.lsl;
  const usl = applied.usl;
  const nominal = applied.nominal ?? "";

  if (!showToleranceSection) {
    return { toast: "noInputs", lsl, usl, nominal };
  }
  return { toast: wasDirty ? "overDirty" : "reloaded", lsl, usl, nominal };
}
