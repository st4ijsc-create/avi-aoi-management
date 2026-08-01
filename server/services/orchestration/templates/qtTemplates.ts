/**
 * Doc 44 W3-B3 (G3.8) — BỐN WORKFLOW TEMPLATE NGHIỆP VỤ CHUẨN trên FOE.
 * SYNAPSE LDS-L3: Chương 10 (QT-1..QT-4) · Chương 17-18 (sequence + bù trừ Saga §18.2).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * THIẾT KẾ (đọc kỹ workflowModel + foeEngine trước khi chọn — ghi rõ):
 *
 *   Bộ step-type của FOE là MACHINE-CENTRIC (command/wait_state/wait_telemetry/
 *   hitl_gate/branch/sequence/parallel/delay — workflowModel.ts). Các bước NGHIỆP VỤ
 *   của QT-1..4 (allocate đơn hàng, phân phối recipe, chuyển trạng thái tuyến, tạo
 *   nhiệm vụ AMR…) KHÔNG phải lệnh thiết bị nên không thể là `command` step, và theo
 *   ràng buộc batch KHÔNG ĐƯỢC sửa foeEngine để thêm step-type mới.
 *
 *   ⇒ Mỗi bước nghiệp vụ được mô hình hóa là một `hitl_gate` — CƠ CHẾ WAIT/GATE SẴN
 *   CÓ của FOE (run pause 'awaiting_confirm', resume qua API công khai resumeRun).
 *   qtRunner.ts là "step-handler pump": khi run pause ở một gate NGHIỆP VỤ (mode
 *   "auto" trong registry qtStepHandlers), nó gọi handler thật (orderLifecycleService,
 *   lineControllerService, materialReplenishment…) rồi resumeRun(approved) — hoặc khi
 *   handler FAIL, chạy BÙ TRỪ NGHIỆP VỤ §18.2 cho các bước k-1..1 rồi resumeRun
 *   (rejected) → run 'aborted'. Gate mode "external" (monitor/chờ giao/chờ resolve)
 *   giữ nguyên ngữ nghĩa hitl_gate gốc: chờ tín hiệu ngoài (watcher/người/API).
 *
 *   Nhờ đó: trạng thái saga BỀN trong orchestration_runs/_run_steps (resume idempotent
 *   của engine được tái dùng nguyên vẹn — audit T3), mỗi bước có audit row, và KHÔNG
 *   một dòng nào của foeEngine bị sửa.
 *
 * COMPENSATION (§18.2): `BaseStep.compensation` của engine chỉ nhận WorkflowStep
 * (machine-step) — không diễn đạt được "cancel order / hủy AMR task / gỡ khóa recipe".
 * Bù trừ nghiệp vụ vì vậy được KHAI TƯỜNG MINH per-step trong qtStepHandlers.ts
 * (compensate fn hoặc lý do không-cần-bù có kiểm chứng bằng test).
 *
 * ĐĂNG KÝ: registerQtTemplates.ts (cờ QT_TEMPLATES_ENABLED, default OFF) deploy các
 * definition này vào kho workflow FOE hiện có (bảng orchestration_workflows) qua
 * deployWorkflow — idempotent theo hash nội dung (không bump version mỗi lần boot).
 *
 * FILE NÀY LÀ PURE DATA — không side-effect, không I/O.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { WorkflowDefinition, WorkflowStep } from "../foe/workflowModel";

export const QT1_REF = "qt-1-order-production";
export const QT2_REF = "qt-2-quality-closed-loop";
export const QT3_REF = "qt-3-material-replenishment";
export const QT4_REF = "qt-4-changeover-npi";

export const QT_TEMPLATE_REFS = [QT1_REF, QT2_REF, QT3_REF, QT4_REF] as const;
export type QtTemplateRef = (typeof QT_TEMPLATE_REFS)[number];

/** Gate nghiệp vụ do qtRunner tự resolve (registry mode "auto"). */
function autoGate(id: string, label: string, prompt: string): WorkflowStep {
  return {
    id,
    type: "hitl_gate",
    label,
    prompt: `[auto] ${prompt}`,
    // Advisory (RBAC thật ở API): gate này do orchestrator/system resolve.
    approverRoles: ["system", "orchestration"],
  };
}

/** Gate CHỜ TÍN HIỆU NGOÀI (watcher/người/API resolve — cơ chế wait/gate của FOE). */
function externalGate(id: string, label: string, prompt: string): WorkflowStep {
  return {
    id,
    type: "hitl_gate",
    label,
    prompt: `[external] ${prompt}`,
  };
}

// ── QT-1 · Sản xuất một đơn hàng (spec §10.1, sequence §14) ───────────────────
export const QT1_ORDER_PRODUCTION: WorkflowDefinition = {
  ref: QT1_REF,
  name: "QT-1 · Sản xuất một đơn hàng",
  version: 1,
  description:
    "Order → allocate+giữ chỗ (ALLOCATED) → distribute recipe → readiness → line start (RUNNING) → " +
    "monitor (chờ tín hiệu hoàn tất sản xuất) → complete (order done + hoàn công ERP). " +
    "Bù trừ §18.2: line về held an toàn · gỡ khóa recipe · cancel order (nhả giữ chỗ tuyến — derived occupancy).",
  params: [
    { name: "orderId", dataType: "int", required: true },
    { name: "lineId", dataType: "int", required: false },
    { name: "recipeSetRef", dataType: "string", required: false },
  ],
  steps: [
    autoGate(
      "qt1-allocate",
      "Phân bổ tuyến + giữ chỗ",
      "Phân bổ đơn hàng vào tuyến (orderLifecycleService.allocateOrder — FOR UPDATE race-safe, §9.1). Bù trừ: cancelOrder (nhả giữ chỗ).",
    ),
    autoGate(
      "qt1-distribute-recipe",
      "Phân phối recipe set",
      "Phân phối recipe set tới tuyến (service W3-B1 qua dynamic import; chưa có trong tree → honest skip, recipeSetRef vẫn được khóa ở bước line-start). Bù trừ: gỡ khóa recipe.",
    ),
    autoGate(
      "qt1-line-ready-check",
      "Kiểm sẵn sàng tuyến",
      "Checklist readiness của tuyến (lineReadiness.checkLineReadiness — read-only). Không đạt → saga fail + bù trừ.",
    ),
    autoGate(
      "qt1-line-start",
      "Khởi động tuyến (RUNNING)",
      "executeLineCommand('start') — qua policy seam + readiness gate của Line Controller; order → running. Bù trừ: line về held an toàn.",
    ),
    externalGate(
      "qt1-monitor",
      "Theo dõi sản xuất",
      "Chờ tín hiệu hoàn tất sản xuất (sản lượng đạt / tuyến drain xong). Resolve qua qtRunner.resolveQtGate hoặc API resume của FOE.",
    ),
    autoGate(
      "qt1-complete",
      "Hoàn tất + hoàn công",
      "Order → done (orderLifecycleService phát hoàn công qua ERP outbox, idempotent) + tuyến vào completing (drain, best-effort).",
    ),
  ],
};

// ── QT-2 · Vòng kín chất lượng (spec §10.2, sequence §17.1) ───────────────────
export const QT2_QUALITY_CLOSED_LOOP: WorkflowDefinition = {
  ref: QT2_REF,
  name: "QT-2 · Vòng kín chất lượng",
  version: 1,
  description:
    "Trigger từ quality-gate FAIL. FOE hiện chỉ start-by-API (không có event-binding trigger) — template nhận " +
    "input {failEventId} từ nơi phát hiện FAIL. Correlate (read-only) → quyết định: hold line (quality gate) " +
    "và/hoặc ĐỀ XUẤT hiệu chỉnh qua ai_pending_actions HITL (pattern qualityControlProposer — KHÔNG lệnh trực tiếp) " +
    "→ chờ người/AI-action resolve → resume tuyến.",
  params: [
    { name: "lineId", dataType: "int", required: true },
    { name: "failEventId", dataType: "string", required: false },
    { name: "machineId", dataType: "int", required: false },
    { name: "inspectionId", dataType: "int", required: false },
  ],
  steps: [
    autoGate(
      "qt2-correlate",
      "Tương quan nguyên nhân",
      "Đọc trạng thái trạm/máy của tuyến (blocked/starved/fault — read-only) để khoanh vùng nghi vấn công đoạn trước.",
    ),
    autoGate(
      "qt2-decide",
      "Quality gate / đề xuất hiệu chỉnh",
      "Tuyến đang producing → hold (heldReason=quality, qua policy seam). Có machineId → đề xuất hiệu chỉnh HITL " +
        "qua ai_pending_actions (VISION_CONTROL_ENABLED-gated, propose-only). Giữ tuyến ở held là trạng thái an toàn — không cần bù.",
    ),
    externalGate(
      "qt2-await-resolution",
      "Chờ xử lý",
      "Chờ người xử lý xong / đề xuất hiệu chỉnh được duyệt-thi hành. Resolve qua qtRunner.resolveQtGate.",
    ),
    autoGate(
      "qt2-resume",
      "Thả tuyến",
      "Tuyến đang held → producing (resume, qua policy seam). Không held → honest skip.",
    ),
  ],
};

// ── QT-3 · Cấp liệu tự động theo tiêu hao (spec §10.3, sequence §17.2) ────────
export const QT3_MATERIAL_REPLENISHMENT: WorkflowDefinition = {
  ref: QT3_REF,
  name: "QT-3 · Cấp liệu tự động theo tiêu hao",
  version: 1,
  description:
    "Low-material → tạo NHIỆM VỤ vận chuyển mức task (fleet taskAllocator — KHÔNG lái AMR trực tiếp, §9.2) → " +
    "chờ giao (watcher materialReplenishment resolve khi task done) → xác nhận dock + thông báo tuyến (tuyến KHÔNG dừng chờ). " +
    "Phát hiện low-material end-to-end nằm ở watcher materialReplenishment.ts (G3.9); template này là phần orchestrate.",
  params: [
    { name: "machineId", dataType: "int", required: true },
    { name: "componentCode", dataType: "string", required: true },
    { name: "feederId", dataType: "int", required: false },
    { name: "lineId", dataType: "int", required: false },
  ],
  steps: [
    autoGate(
      "qt3-create-transport-task",
      "Tạo nhiệm vụ vận chuyển",
      "ensureTransportTask (idempotent theo cặp material+station) → fleet taskAllocator chọn AMR; không có AMR → task pending + Andon thủ công (honest). Bù trừ: hủy nhiệm vụ AMR đang mở.",
    ),
    externalGate(
      "qt3-await-delivery",
      "Chờ giao liệu",
      "Chờ task vận chuyển done — watcher materialReplenishment resolve gate này khi phát hiện task completed (hoặc operator resolve).",
    ),
    autoGate(
      "qt3-confirm-dock",
      "Xác nhận dock + thông báo tuyến",
      "Phát sự kiện material.replenish.delivered + thông báo tuyến (Andon info). KHÔNG transition tuyến — tuyến không dừng chờ.",
    ),
  ],
};

// ── QT-4 · Đổi sản phẩm / NPI (spec §10.4, sequence §18.1) ────────────────────
export const QT4_CHANGEOVER_NPI: WorkflowDefinition = {
  ref: QT4_REF,
  name: "QT-4 · Đổi sản phẩm (changeover/NPI)",
  version: 1,
  description:
    "Line → changeover (khóa recipeSetRef mới) → distribute recipe (W3-B1 qua dynamic import, fallback honest skip) → " +
    "sim-gate NPI (yêu cầu sim-token của FOE — simulation pass là precondition, fail-closed) → readiness (read-only) → ready. " +
    "Bù trừ §18.2: gỡ khóa recipe; tuyến giữ ở changeover (trạng thái không-sản-xuất an toàn — held không hợp lệ từ changeover theo FSM).",
  params: [
    { name: "lineId", dataType: "int", required: true },
    { name: "recipeSetRef", dataType: "string", required: true },
    { name: "npi", dataType: "bool", required: false },
    { name: "simWorkflowRef", dataType: "string", required: false },
    { name: "simToken", dataType: "string", required: false },
  ],
  steps: [
    autoGate(
      "qt4-changeover",
      "Vào changeover + khóa recipe",
      "transitionLine('changeover', recipeSetRef) — qua policy seam; recipe_set_ref khóa trên line_states. Bù trừ: gỡ khóa recipe + tuyến giữ ở changeover (an toàn).",
    ),
    autoGate(
      "qt4-distribute-recipe",
      "Phân phối recipe mới",
      "Phân phối recipe set tới các trạm (service W3-B1 qua dynamic import; chưa có → honest skip). Bù trừ: gỡ khóa recipe.",
    ),
    autoGate(
      "qt4-sim-gate",
      "Sim-gate NPI",
      "npi=true → BẮT BUỘC sim-token hợp lệ (issueSimToken của FOE trên definition simWorkflowRef — fail-closed khi thiếu/sai). npi=false → skip (không phải NPI).",
    ),
    autoGate(
      "qt4-readiness",
      "Kiểm sẵn sàng (preview)",
      "checkLineReadiness(requireRecipe=true) — read-only preview trước khi vào ready.",
    ),
    autoGate(
      "qt4-ready",
      "Tuyến READY",
      "transitionLine('ready', requireRecipe=true) — readiness checklist chạy BẮT BUỘC bên trong transition (§6.2).",
    ),
  ],
};

/** Cả 4 template QT (thứ tự spec Chương 10). */
export function listQtTemplates(): WorkflowDefinition[] {
  return [QT1_ORDER_PRODUCTION, QT2_QUALITY_CLOSED_LOOP, QT3_MATERIAL_REPLENISHMENT, QT4_CHANGEOVER_NPI];
}

/** Tra template theo ref (null khi không phải template QT). */
export function getQtTemplate(ref: string): WorkflowDefinition | null {
  return listQtTemplates().find((t) => t.ref === ref) ?? null;
}
