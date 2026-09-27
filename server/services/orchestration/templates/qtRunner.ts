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
 *              fail → resumeRun(rejected, note, { compensate }) — engine GIÀNH quyền từ chối
 *                     (CAS → 'compensating', ghim bước) RỒI mới gọi compensate(): BÙ TRỪ §18.2
 *                     cho các business-step ĐÃ completed (đảo thứ tự k-1..1, theo compensate()
 *                     khai trong qtStepHandlers) → run 'aborted' + gate ghi lý do.
 *                     (doc 80 Đợt 1 Task 9: thua CAS ⇒ KHÔNG bù trừ.)
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
import { startRun, resumeRun, getRun, foeEnabled, type FoeUser, type GateDecision, type ResumeHooks } from "../foe/foeEngine";
import { getQtBusinessSteps, findQtBusinessStep, type QtStepContext } from "./qtStepHandlers";

/**
 * Final review fix #6 — resumeRun (doc 80 ORC-02/03) may THROW: CONFLICT when another approver /
 * resume claimed the paused run first, FORBIDDEN when this actor is not allowed at the gate.
 * CONFLICT means the gate was already decided elsewhere ⇒ NOT an error for the pump: return null
 * and let the caller re-read the run's real state. Everything else (FORBIDDEN included) surfaces.
 */
async function resumeUnlessClaimed(
  runId: number,
  decision: GateDecision,
  user: FoeUser,
  hooks?: ResumeHooks,
): Promise<Awaited<ReturnType<typeof resumeRun>> | null> {
  try {
    return await resumeRun(runId, decision, user, hooks);
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code === "CONFLICT") {
      console.log(`[QtRunner] run ${runId}: gate đã được lượt khác quyết định (CONFLICT) — đọc lại trạng thái`);
      return null;
    }
    throw err;
  }
}

/** Trạng thái THẬT hiện tại của run (sau khi thua CAS) — không đoán. */
async function currentStatus(runId: number): Promise<string> {
  const view = await getRun(runId);
  return view ? String(view.run.status) : "not_found";
}

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
 * doc 80 Đợt 1 Task 9 — hook bù trừ cho nhánh TỪ CHỐI: engine CHỈ gọi nó sau khi đã giành quyền
 * từ chối (CAS 'awaiting_confirm|held' → 'compensating', ghim đúng gate). Ghi chú bù trừ được đẩy
 * vào `notes` (kết quả pump) và trả về làm lý do cuối của run (persist ở run.error + bước gate).
 */
function compensationHook(
  workflowRef: string,
  runId: number,
  params: Record<string, unknown>,
  failedStepId: string,
  headline: string,
  notes: string[],
): ResumeHooks {
  return {
    compensate: async () => {
      const compNotes = await runQtCompensations(workflowRef, runId, params, failedStepId);
      for (const c of compNotes) note(notes, `bù trừ: ${c}`);
      return [
        headline,
        compNotes.length > 0 ? `Bù trừ §18.2: ${compNotes.join("; ")}` : "Bù trừ §18.2: không có bước cần bù",
      ]
        .join(" · ")
        .slice(0, 1900);
    },
  };
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
      // Task 9 — ghim ĐÚNG gate mà handler vừa chạy: nếu trong lúc handler chạy, lượt khác đã duyệt
      // gate này và run đã dừng ở gate kế, lượt duyệt này KHÔNG được rơi vào gate kế (handler của
      // gate kế chưa từng chạy) ⇒ CONFLICT ⇒ null ⇒ vòng sau đọc lại và chạy đúng handler kế.
      const resumed = await resumeUnlessClaimed(
        runId,
        { approved: true, note: result.note ?? (result.skipped ? "honest skip" : "ok"), expectedStepId: stepId },
        user,
      );
      // null = CONFLICT: gate đã được lượt khác duyệt/từ chối ⇒ vòng sau đọc lại trạng thái thật.
      if (resumed && !resumed.enabled) return { ok: false, runId, status: "disabled", notes, message: "FOE tắt giữa chừng" };
      continue; // engine đã drive tới gate kế / terminal — vòng sau đọc lại.
    }

    // Handler FAIL → reject gate: engine giành quyền từ chối (CAS, ghim bước) RỒI mới chạy bù trừ
    // §18.2 (k-1..1) → run 'aborted'. Thua CAS ⇒ không bù trừ (doc 80 Đợt 1 Task 9).
    note(notes, `${stepId}: FAIL — ${result.note ?? "(không rõ)"}`);
    const headline = `QT saga fail tại '${stepId}': ${result.note ?? "(không rõ)"}`;
    const rejected = await resumeUnlessClaimed(
      runId,
      { approved: false, note: headline.slice(0, 1900), expectedStepId: stepId },
      user,
      compensationHook(view.run.workflowRef ?? "", runId, params, stepId, headline, notes),
    );
    if (!rejected) {
      const status = await currentStatus(runId);
      return { ok: false, runId, status, pausedStepId: stepId, notes, message: "gate đã được lượt khác quyết định (CONFLICT)" };
    }
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
 *   • approved=false → resumeRun(rejected, { compensate }): GIÀNH quyền từ chối (CAS) trước, RỒI
 *                      mới bù trừ §18.2 (quyết định hủy saga từ bên ngoài) → run 'aborted'. Thua
 *                      CAS ⇒ không bù trừ, trả trạng thái thật (doc 80 Đợt 1 Task 9).
 * Chỉ tác động khi run đang pause đúng ở một gate của template QT. Quyết định GHIM gate đọc được
 * ở đây (hoặc `decision.expectedStepId` khi caller biết gate mình nhắm tới) — run đã sang gate
 * khác ⇒ không quyết định gì (CONFLICT được nuốt thành kết quả trung thực, không ném).
 */
export async function resolveQtGate(
  runId: number,
  decision: { approved: boolean; note?: string; expectedStepId?: string },
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
  // Task 9 — gate mà quyết định này nhắm tới: của caller (nếu biết) hoặc gate vừa đọc.
  const expectedStepId = decision.expectedStepId ?? view.run.currentStepId ?? null;
  if (decision.expectedStepId !== undefined && decision.expectedStepId !== view.run.currentStepId) {
    return { ok: false, runId, status, pausedStepId: stepId, notes, message: `run đang chờ ở '${stepId}', không phải '${decision.expectedStepId}' — không quyết định` };
  }

  if (!decision.approved) {
    const headline = decision.note ?? `gate '${stepId}' bị từ chối`;
    const rejected = await resumeUnlessClaimed(
      runId,
      { approved: false, note: headline.slice(0, 1900), expectedStepId },
      user,
      compensationHook(view.run.workflowRef ?? "", runId, params, stepId, headline, notes),
    );
    if (!rejected) {
      const current = await currentStatus(runId);
      return { ok: false, runId, status: current, pausedStepId: stepId, notes, message: "gate đã được lượt khác quyết định (CONFLICT)" };
    }
    return { ok: false, runId, status: "aborted", pausedStepId: stepId, notes };
  }

  const resumed = await resumeUnlessClaimed(runId, { approved: true, note: decision.note ?? "external signal resolved", expectedStepId }, user);
  // null = CONFLICT: lượt khác đã nhận gate ⇒ pump đọc lại trạng thái thật (không ném).
  if (resumed && !resumed.ok && resumed.status !== "awaiting_confirm") {
    return { ok: false, runId, status: String(resumed.status ?? "failed"), notes, message: resumed.message };
  }
  return pumpQtRun(runId, user);
}
