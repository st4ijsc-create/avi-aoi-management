/**
 * doc 44 W6-1 (G5.14) — e-SOP execution logic (PURE, unit-testable, NO db/schema).
 *
 * Tách khỏi sopService để test cổng-xác-nhận (confirm-gate) không cần DB:
 *   • validateStepConfirmation — một bước requires_confirm chỉ qua khi có xác nhận
 *     và (nếu có expected_input) input khớp (chuẩn hóa trim+UPPER như feeder scan).
 *   • computeExecutionProgress — bước hiện tại / bước còn phải xác nhận / hoàn tất.
 *   • canFinishExecution — chỉ finish khi MỌI bước requires_confirm đã thỏa.
 *
 * Nguồn sự thật spec §6.2: "một số bước phải xác nhận mới cho tiếp" — non-confirm
 * step luôn cho qua; confirm step là cổng.
 */

/** Bước SOP (lite — chỉ trường cần cho gate). */
export interface SopStepLite {
  stepNo: number;
  requiresConfirm: boolean;
  expectedInput?: string | null;
}

/** Một xác nhận bước (khớp drizzle SopStepConfirmation). */
export interface SopStepConfirmation {
  stepNo: number;
  confirmedBy?: number | null;
  confirmedAt: string;
  input?: string | null;
}

export type StepConfirmCode = "OK" | "INPUT_REQUIRED" | "INPUT_MISMATCH" | "NO_SUCH_STEP";

export interface StepConfirmResult {
  ok: boolean;
  code: StepConfirmCode;
}

/** Chuẩn hóa một giá trị scan/nhập: trim → tách token đầu → UPPER (mirror feederVerify). */
export function normalizeInput(raw: string | null | undefined): string {
  if (raw == null) return "";
  const first = String(raw).trim().split(/[|:;,\s]/)[0];
  return first.trim().toUpperCase();
}

/** Sắp bước theo step_no tăng dần (không mutate input). */
export function sortSteps<T extends { stepNo: number }>(steps: readonly T[]): T[] {
  return [...steps].sort((a, b) => a.stepNo - b.stepNo);
}

/**
 * Có thể xác nhận bước này với `input` không?
 *   • Bước không tồn tại → NO_SUCH_STEP.
 *   • requires_confirm=false → OK (xác nhận tùy chọn, luôn hợp lệ).
 *   • có expected_input: input rỗng → INPUT_REQUIRED; khác expected → INPUT_MISMATCH.
 */
export function validateStepConfirmation(
  steps: readonly SopStepLite[],
  stepNo: number,
  input?: string | null,
): StepConfirmResult {
  const step = steps.find((s) => s.stepNo === stepNo);
  if (!step) return { ok: false, code: "NO_SUCH_STEP" };
  if (!step.requiresConfirm) return { ok: true, code: "OK" };

  const expected = step.expectedInput != null ? normalizeInput(step.expectedInput) : "";
  if (expected !== "") {
    const got = normalizeInput(input);
    if (got === "") return { ok: false, code: "INPUT_REQUIRED" };
    if (got !== expected) return { ok: false, code: "INPUT_MISMATCH" };
  }
  return { ok: true, code: "OK" };
}

/** Bước đã được xác nhận HỢP LỆ chưa (xác nhận tồn tại + thỏa expected_input). */
export function isStepSatisfied(
  step: SopStepLite,
  confirmations: readonly SopStepConfirmation[],
): boolean {
  if (!step.requiresConfirm) return true;
  const c = confirmations.find((x) => x.stepNo === step.stepNo);
  if (!c) return false;
  const expected = step.expectedInput != null ? normalizeInput(step.expectedInput) : "";
  if (expected === "") return true;
  return normalizeInput(c.input) === expected;
}

export interface ExecutionProgress {
  totalSteps: number;
  requiredSteps: number;      // số bước requires_confirm
  satisfiedRequired: number;  // số bước requires_confirm đã thỏa
  confirmedSteps: number;     // tổng số bước có ít nhất 1 xác nhận
  complete: boolean;          // mọi bước requires_confirm đã thỏa
  nextRequiredStepNo: number | null; // bước requires_confirm CHƯA thỏa đầu tiên
  currentStepNo: number | null;      // bước đang đứng (đầu tiên chưa "đi qua")
}

/**
 * Tiến độ một phiên: bước còn phải xác nhận, đã hoàn tất chưa, bước "hiện tại".
 * currentStepNo = bước đầu tiên chưa đi qua — với bước requires_confirm là bước
 * chưa thỏa; bước thông tin coi như đi qua ngay (không chặn), nên current thực
 * chất trỏ tới cổng chưa thỏa đầu tiên (hoặc null khi hết cổng → cho finish).
 */
export function computeExecutionProgress(
  steps: readonly SopStepLite[],
  confirmations: readonly SopStepConfirmation[],
): ExecutionProgress {
  const ordered = sortSteps(steps);
  const required = ordered.filter((s) => s.requiresConfirm);
  const satisfiedRequired = required.filter((s) => isStepSatisfied(s, confirmations)).length;
  const confirmedSteps = new Set(confirmations.map((c) => c.stepNo)).size;
  const nextRequired = required.find((s) => !isStepSatisfied(s, confirmations)) ?? null;
  const complete = required.length === 0 ? confirmedSteps > 0 || ordered.length === 0
    : satisfiedRequired === required.length;

  // "Complete" khi KHÔNG có cổng chưa thỏa. Với SOP không có bước bắt buộc nào,
  // coi hoàn tất khi operator đã xác nhận ít nhất 1 bước (đã thao tác) hoặc SOP rỗng.
  return {
    totalSteps: ordered.length,
    requiredSteps: required.length,
    satisfiedRequired,
    confirmedSteps,
    complete: required.length === 0 ? true : complete,
    nextRequiredStepNo: nextRequired ? nextRequired.stepNo : null,
    currentStepNo: nextRequired ? nextRequired.stepNo : null,
  };
}

/** Chỉ finish được khi mọi bước requires_confirm đã thỏa (spec §6.2 cổng bắt buộc). */
export function canFinishExecution(
  steps: readonly SopStepLite[],
  confirmations: readonly SopStepConfirmation[],
): boolean {
  return computeExecutionProgress(steps, confirmations).complete;
}

/**
 * Chèn/cập nhật một xác nhận bước vào mảng hiện có (idempotent theo step_no —
 * xác nhận lại một bước ghi đè bản trước). Trả mảng MỚI (không mutate).
 */
export function upsertConfirmation(
  confirmations: readonly SopStepConfirmation[],
  entry: SopStepConfirmation,
): SopStepConfirmation[] {
  const next = confirmations.filter((c) => c.stepNo !== entry.stepNo);
  next.push(entry);
  return next.sort((a, b) => a.stepNo - b.stepNo);
}
