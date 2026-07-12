/**
 * Doc 44 W3-B3 (G3.8) — QT RUNNER: "step-handler pump" cho 4 template QT trên FOE.
 * SYNAPSE LDS-L3 §10 (QT-1..4) · §18.2 (bù trừ Saga k-1..1).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CHỈ dùng API CÔNG KHAI của foeEngine (startRun / getRun / resumeRun) — KHÔNG sửa
 * engine. Cách hoạt động (xem thiết kế đầy đủ ở header qtTemplates.ts):
 *
 *   startQtRun(ref, params)
 *     → foeEngine.startRun (sync — engine tự drive tới gate đầu tiên rồi pause)
 *     → pumpQtRun: lặp {getRun → gate hiện tại → handler registry}:
 *         • mode "auto"     → chạy handler nghiệp vụ:
 *              ok   → resumeRun(approved, note)  → engine đi tiếp (resume idempotent)
 *              fail → chạy BÙ TRỪ §18.2 cho các business-step ĐÃ completed (đảo thứ
 *                     tự k-1..1, theo compensate() khai trong qtStepHandlers) rồi
 *                     resumeRun(rejected, note)  → run 'aborted' + gate ghi lý do.
 *         • mode "external" → DỪNG pump: run đứng ở 'awaiting_confirm' (bền trong
 *              orchestration_runs) chờ tín hiệu ngoài — resolveQtGate() (watcher
 *              QT-3 / API / người) resume rồi pump tiếp.
 *
 * Mọi note của handler được persist qua resumeRun vào _run_steps.resultJson —
 * truy vết saga đầy đủ trong bảng run-steps sẵn có (không bảng mới, không migration).
 *
 * FAIL-SAFE: không hàm nào throw ra ngoài; lỗi → kết quả phân loại + run 'aborted'
 * ở phía engine (đường resumeRun(rejected) đã có sẵn).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { startRun, resumeRun, getRun, foeEnabled, type FoeUser } from "../foe/foeEngine";
import { getQtBusinessSteps, findQtBusinessStep, type QtStepContext } from "./qtStepHandlers";

/** Actor hệ thống của pump (không phải người thật — audit ghi rõ). */
export const QT_SYSTEM_USER: FoeUser = { id: 0, role: "system", name: "qt-orchestrator" };

const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "aborted"]);
/** Trần lặp pump — nhiều hơn tổng số bước của template dài nhất (an toàn vòng lặp). */
const MAX_PUMP_ITERATIONS = 32;

export interface QtPumpResult {
  ok: boolean;
  runId: number;
  /** Trạng thái run của engine, hoặc "waiting_external" khi đứng ở gate chờ ngoài. */
  status: string;
  /** Gate đang chờ (khi waiting_external / awaiting_confirm). */
  pausedStepId?: string;
  /** Ghi chú tuần tự các bước đã pump (đã persist từng phần vào _run_steps). */
  notes: string[];
  message?: string;
}

function note(notes: string[], s: string): void {
  notes.push(s);
  console.log(`[QtRunner] ${s}`);
}

/**
 * BÙ TRỪ §18.2: chạy compensate() của các business-step ĐÃ completed (nguồn chân lý
 * = _run_steps qua getRun), theo THỨ TỰ ĐẢO của template (k-1..1), bỏ qua chính bước
 * fail. Best-effort per-step: một compensate lỗi không chặn các compensate còn lại
 * (ghi chú honest) — đúng tinh thần "lùi an toàn", không rollback nguyên tử.
 */
export async function runQtCompensations(
  workflowRef: string,
  runId: number,
  params: Record<string, unknown>,
  failedStepId: string,
): Promise<string[]> {
  const notes: string[] = [];
  try {
    const view = await getRun(runId);
    if (!view) return [`không đọc được run ${runId} — bỏ qua bù trừ`];
    const completed = new Set(view.steps.filter((s) => s.status === "completed").map((s) => s.stepId));
    const ordered = getQtBusinessSteps(workflowRef);
    const ctx: QtStepContext = { runId, params };
    for (const step of [...ordered].reverse()) {
      if (step.stepId === failedStepId) continue;
      if (!completed.has(step.stepId)) continue;
      if (!step.compensate) {
        if (step.compensation !== "none-readonly" && step.compensation !== "none-external-wait") {
          notes.push(`${step.stepId}: không cần bù (${step.compensation})`);
        }
        continue;
      }
      try {
        const res = await step.compensate(ctx);
        notes.push(`${step.stepId}: ${res.ok ? "bù OK" : "bù FAIL"}${res.note ? ` — ${res.note}` : ""}`);
      } catch (err) {
        notes.push(`${step.stepId}: bù threw — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err) {
    notes.push(`compensation sweep lỗi: ${err instanceof Error ? err.message : String(err)}`);
  }
  return notes;
}

/**
 * Pump một run QT: tự resolve các gate nghiệp vụ (mode "auto") cho tới khi run
 * đạt terminal hoặc đứng ở gate chờ ngoài. Idempotent: gọi lại trên run đang chờ
 * ngoài chỉ trả về trạng thái hiện tại (không side-effect).
 */
export async function pumpQtRun(runId: number, user: FoeUser = QT_SYSTEM_USER): Promise<QtPumpResult> {
  const notes: string[] = [];
  if (!foeEnabled()) {
    return { ok: false, runId, status: "disabled", notes, message: "FOE_ENABLED off" };
  }
  for (let i = 0; i < MAX_PUMP_ITERATIONS; i++) {
    const view = await getRun(runId);
    if (!view) return { ok: false, runId, status: "not_found", notes, message: `run ${runId} không tồn tại` };

    const status = String(view.run.status);
    if (TERMINAL_RUN_STATUSES.has(status)) {
      return { ok: status === "completed", runId, status, notes };
    }
    if (status !== "awaiting_confirm" && status !== "held") {
      // queued/running/compensating — engine đang drive ở nơi khác; không chen.
      return { ok: false, runId, status, notes, message: `run đang '${status}' — không pump được` };
    }

    const stepId = view.run.currentStepId ?? null;
    if (!stepId) return { ok: false, runId, status, notes, message: "run pause nhưng không có currentStepId" };

    const handler = findQtBusinessStep(view.run.workflowRef ?? "", stepId);
    if (!handler || handler.mode === "external" || !handler.run) {
      // Gate chờ ngoài (hoặc gate không thuộc registry — để cho người xử lý).
      return { ok: true, runId, status: "waiting_external", pausedStepId: stepId, notes };
    }

    const params = (view.run.paramsJson as Record<string, unknown>) ?? {};
    let result: { ok: boolean; note?: string; skipped?: boolean };
    try {
      result = await handler.run({ runId, params });
    } catch (err) {
      result = { ok: false, note: `handler threw: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (result.ok) {
      note(notes, `${stepId}: ${result.skipped ? "SKIP" : "OK"}${result.note ? ` — ${result.note}` : ""}`);
      const resumed = await resumeRun(runId, { approved: true, note: result.note ?? (result.skipped ? "honest skip" : "ok") }, user);
      if (!resumed.enabled) return { ok: false, runId, status: "disabled", notes, message: "FOE tắt giữa chừng" };
      continue; // engine đã drive tới gate kế / terminal — vòng sau đọc lại.
    }

    // Handler FAIL → bù trừ §18.2 (k-1..1) rồi reject gate → run 'aborted'.
    note(notes, `${stepId}: FAIL — ${result.note ?? "(không rõ)"}`);
    const compNotes = await runQtCompensations(view.run.workflowRef ?? "", runId, params, stepId);
    for (const c of compNotes) note(notes, `bù trừ: ${c}`);
    const rejectNote = [
      `QT saga fail tại '${stepId}': ${result.note ?? "(không rõ)"}`,
      compNotes.length > 0 ? `Bù trừ §18.2: ${compNotes.join("; ")}` : "Bù trừ §18.2: không có bước cần bù",
    ]
      .join(" · ")
      .slice(0, 1900);
    await resumeRun(runId, { approved: false, note: rejectNote }, user);
    return { ok: false, runId, status: "aborted", pausedStepId: stepId, notes };
  }
  return { ok: false, runId, status: "pump_limit", notes, message: `vượt trần ${MAX_PUMP_ITERATIONS} lượt pump` };
}

export interface StartQtRunResult extends QtPumpResult {
  started: boolean;
}

/**
 * Khởi động một run template QT (đã đăng ký qua registerQtTemplates) rồi pump tới
 * gate chờ ngoài / terminal. Flag-gated bởi FOE_ENABLED (đường startRun sẵn có).
 */
export async function startQtRun(
  workflowRef: string,
  params: Record<string, unknown>,
  user: FoeUser = QT_SYSTEM_USER,
): Promise<StartQtRunResult> {
  const res = await startRun(workflowRef, params, user);
  if (!res.enabled) {
    return { started: false, ok: false, runId: 0, status: "disabled", notes: [], message: res.message ?? "FOE off" };
  }
  if (res.runId == null) {
    return { started: false, ok: false, runId: 0, status: String(res.status ?? "failed"), notes: [], message: res.message };
  }
  const pumped = await pumpQtRun(res.runId, user);
  return { started: true, ...pumped };
}

/**
 * Resolve một gate CHỜ NGOÀI (monitor / await-delivery / await-resolution):
 *   • approved=true  → resumeRun rồi pump tiếp các bước auto còn lại.
 *   • approved=false → chạy bù trừ §18.2 trước (quyết định hủy saga từ bên ngoài)
 *                      rồi resumeRun(rejected) → run 'aborted'.
 * Chỉ tác động khi run đang pause đúng ở một gate của template QT.
 */
export async function resolveQtGate(
  runId: number,
  decision: { approved: boolean; note?: string },
  user: FoeUser = QT_SYSTEM_USER,
): Promise<QtPumpResult> {
  const notes: string[] = [];
  if (!foeEnabled()) return { ok: false, runId, status: "disabled", notes, message: "FOE_ENABLED off" };
  const view = await getRun(runId);
  if (!view) return { ok: false, runId, status: "not_found", notes, message: `run ${runId} không tồn tại` };
  const status = String(view.run.status);
  if (status !== "awaiting_confirm" && status !== "held") {
    return { ok: false, runId, status, notes, message: `run đang '${status}' — không có gate để resolve` };
  }
  const stepId = view.run.currentStepId ?? "?";
  const params = (view.run.paramsJson as Record<string, unknown>) ?? {};

  if (!decision.approved) {
    const compNotes = await runQtCompensations(view.run.workflowRef ?? "", runId, params, stepId);
    for (const c of compNotes) note(notes, `bù trừ: ${c}`);
    const rejectNote = [
      decision.note ?? `gate '${stepId}' bị từ chối`,
      compNotes.length > 0 ? `Bù trừ §18.2: ${compNotes.join("; ")}` : "Bù trừ §18.2: không có bước cần bù",
    ]
      .join(" · ")
      .slice(0, 1900);
    await resumeRun(runId, { approved: false, note: rejectNote }, user);
    return { ok: false, runId, status: "aborted", pausedStepId: stepId, notes };
  }

  const resumed = await resumeRun(runId, { approved: true, note: decision.note ?? "external signal resolved" }, user);
  if (!resumed.ok && resumed.status !== "awaiting_confirm") {
    return { ok: false, runId, status: String(resumed.status ?? "failed"), notes, message: resumed.message };
  }
  return pumpQtRun(runId, user);
}
