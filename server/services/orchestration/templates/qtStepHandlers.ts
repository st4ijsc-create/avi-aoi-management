/**
 * Doc 44 W3-B3 (G3.8) — STEP HANDLERS + COMPENSATION NGHIỆP VỤ cho 4 template QT.
 * SYNAPSE LDS-L3 §10 (QT-1..4) · §18.2 (bù trừ Saga = "lùi an toàn" nghiệp vụ).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Mỗi bước nghiệp vụ của template (qtTemplates.ts — mô hình hóa là hitl_gate, xem
 * header ở đó) có MỘT entry ở đây:
 *   • mode "auto"     — qtRunner gọi run() khi FOE run pause ở gate này rồi
 *                       resumeRun(approved) / resumeRun(rejected) theo kết quả.
 *   • mode "external" — KHÔNG có run(): gate chờ tín hiệu ngoài (watcher QT-3,
 *                       người vận hành, API) — đúng ngữ nghĩa wait/gate của FOE.
 *
 * COMPENSATION (§18.2) khai TƯỜNG MINH per-step:
 *   • "handler"          — có compensate() nghiệp vụ thật (nhả giữ chỗ qua cancel
 *                          order, hủy AMR task, gỡ khóa recipe, line về held an toàn).
 *   • "none-readonly"    — bước chỉ đọc, không có gì để lùi.
 *   • "none-safe-state"  — bước đưa hệ VÀO trạng thái an toàn (held/changeover) —
 *                          giữ nguyên chính là bù trừ đúng (§18.2: lùi AN TOÀN,
 *                          không phải rollback).
 *   • "none-terminal"    — bước cuối (hoàn công) — sau nó không còn bước để fail.
 *   • "none-external-wait" — gate chờ, chưa thực hiện hành động nào.
 * Test qtTemplates.test.ts kiểm chứng: mọi step của mọi template có entry, entry
 * "handler" phải có compensate() thật.
 *
 * AN TOÀN: KHÔNG handler nào mở đường thiết bị. Mọi tác động đi qua service công
 * khai đã có cổng riêng: orderLifecycleService (policy seam order.command.*),
 * lineControllerService (FSM + readiness + policy seam line.command.*),
 * materialReplenishment→taskAllocator (chỉ ghi task-state, không lệnh AMR),
 * qualityControlProposer (ai_pending_actions HITL propose-only).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { QT1_REF, QT2_REF, QT3_REF, QT4_REF } from "./qtTemplates";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QtStepContext {
  runId: number;
  params: Record<string, unknown>;
}

export interface QtStepResult {
  ok: boolean;
  /** Ghi vào note của gate (persist trong _run_steps qua resumeRun). */
  note?: string;
  /** Bước tự nhận là honest-skip (vẫn ok — đi tiếp). */
  skipped?: boolean;
}

export type QtCompensationDecl =
  | "handler"
  | "none-readonly"
  | "none-safe-state"
  | "none-terminal"
  | "none-external-wait";

export interface QtBusinessStep {
  stepId: string;
  mode: "auto" | "external";
  compensation: QtCompensationDecl;
  run?: (ctx: QtStepContext) => Promise<QtStepResult>;
  compensate?: (ctx: QtStepContext) => Promise<QtStepResult>;
}

// ── Param helpers (defensive — params đến từ JSON) ────────────────────────────

function intParam(params: Record<string, unknown>, key: string): number | null {
  const v = params?.[key];
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function strParam(params: Record<string, unknown>, key: string): string | null {
  const v = params?.[key];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function boolParam(params: Record<string, unknown>, key: string): boolean {
  const v = params?.[key];
  return v === true || v === "true" || v === 1 || v === "1";
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ACTOR = "qt-orchestrator";

/**
 * Resolve lineId cho các bước cấp tuyến: ưu tiên params.lineId; không có → đọc từ
 * ĐƠN HÀNG (sau allocate, productionOrders.lineId đã được orderLifecycleService set).
 */
async function resolveLineId(params: Record<string, unknown>): Promise<number | null> {
  const explicit = intParam(params, "lineId");
  if (explicit != null) return explicit;
  const orderId = intParam(params, "orderId");
  if (orderId == null) return null;
  try {
    const { getOrderDetail } = await import("../../orders/orderLifecycleService");
    const detail = await getOrderDetail(orderId);
    const lineId = detail?.order.allocation.lineId;
    return typeof lineId === "number" && lineId > 0 ? lineId : null;
  } catch {
    return null;
  }
}

// ── W3-B1 recipe-distribution seam (dynamic import + honest fallback) ─────────
//
// Batch W3-B1 (distribute recipe per-station) có thể CHƯA có trong tree lúc batch
// này chạy. Specifier để NON-LITERAL (biến) nên tsc/bundler không fail khi module
// chưa tồn tại; runtime import lỗi → honest skip (KHÔNG bịa kết quả).

const RECIPE_DISTRIBUTION_CANDIDATES = [
  "../../lineController/recipeDistributionService",
  "../../recipes/recipeDistributionService",
  "../recipeDistribution",
];

async function tryImportAny(specs: string[]): Promise<Record<string, unknown> | null> {
  for (const spec of specs) {
    try {
      const dynamicSpec: string = spec; // non-literal — tsc không resolve tĩnh
      const mod = (await import(/* @vite-ignore */ dynamicSpec)) as Record<string, unknown>;
      if (mod) return mod;
    } catch {
      /* candidate absent — thử candidate kế */
    }
  }
  return null;
}

async function callRecipeService(
  fnNames: string[],
  lineId: number,
  recipeSetRef: string | null,
  runId: number,
): Promise<QtStepResult | null> {
  const mod = await tryImportAny(RECIPE_DISTRIBUTION_CANDIDATES);
  if (!mod) return null;
  for (const fn of fnNames) {
    const f = mod[fn];
    if (typeof f === "function") {
      try {
        const res = await (f as (...args: unknown[]) => Promise<unknown>)(lineId, recipeSetRef, {
          actor: ACTOR,
          reason: `QT run ${runId}`,
        });
        const ok = !(res && typeof res === "object" && (res as { ok?: unknown }).ok === false);
        return { ok, note: `${fn}(${lineId}, ${recipeSetRef ?? "∅"}) → ${ok ? "ok" : "fail"}` };
      } catch (err) {
        return { ok: false, note: `${fn} threw: ${errMsg(err)}` };
      }
    }
  }
  return null;
}

async function distributeRecipeStep(ctx: QtStepContext): Promise<QtStepResult> {
  const lineId = await resolveLineId(ctx.params);
  const recipeSetRef = strParam(ctx.params, "recipeSetRef");
  if (lineId == null) return { ok: false, note: "không resolve được lineId (params.lineId / order.allocation)" };
  const viaService = await callRecipeService(
    ["distributeRecipeSet", "distributeRecipe", "distributeToLine"],
    lineId,
    recipeSetRef,
    ctx.runId,
  );
  if (viaService) return viaService;
  return {
    ok: true,
    skipped: true,
    note:
      "recipe distribution service (W3-B1) chưa có trong tree — honest skip; " +
      "recipeSetRef được khóa trên line_states ở bước transition (line-start/changeover)",
  };
}

async function unlockRecipeCompensation(ctx: QtStepContext): Promise<QtStepResult> {
  const lineId = await resolveLineId(ctx.params);
  if (lineId != null) {
    const viaService = await callRecipeService(
      ["unlockRecipeSet", "releaseRecipeLock", "unlockRecipe"],
      lineId,
      strParam(ctx.params, "recipeSetRef"),
      ctx.runId,
    );
    if (viaService) return viaService;
  }
  return {
    ok: true,
    skipped: true,
    note: "gỡ khóa recipe: service W3-B1 chưa có — không có khóa phân phối nào đã tạo để gỡ (honest)",
  };
}

// ── QT-1 handlers ─────────────────────────────────────────────────────────────

const qt1Allocate: QtBusinessStep = {
  stepId: "qt1-allocate",
  mode: "auto",
  compensation: "handler",
  async run(ctx) {
    const orderId = intParam(ctx.params, "orderId");
    if (orderId == null) return { ok: false, note: "thiếu params.orderId" };
    try {
      const { allocateOrder } = await import("../../orders/orderLifecycleService");
      const res = await allocateOrder(orderId, {
        ...(intParam(ctx.params, "lineId") != null ? { lineId: intParam(ctx.params, "lineId")! } : {}),
        actor: ACTOR,
        reason: `QT-1 run ${ctx.runId}: allocate`,
      });
      return res.allocated
        ? { ok: true, note: `allocated → line ${res.lineId} (${res.strategy})` }
        : { ok: false, note: `allocation rejected: ${res.reason ?? "no_capacity"}` };
    } catch (err) {
      return { ok: false, note: `allocateOrder failed: ${errMsg(err)}` };
    }
  },
  /** §18.2: nhả giữ chỗ tuyến qua cancelOrder (created/allocated→rejected; running/held→compensating→failed). */
  async compensate(ctx) {
    const orderId = intParam(ctx.params, "orderId");
    if (orderId == null) return { ok: true, skipped: true, note: "không có orderId — bỏ qua" };
    try {
      const { cancelOrder } = await import("../../orders/orderLifecycleService");
      const res = await cancelOrder(orderId, `QT-1 run ${ctx.runId}: compensation §18.2 (nhả giữ chỗ)`, {
        actor: ACTOR,
      });
      return { ok: true, note: `cancelOrder → ${res.state} (via ${res.via})` };
    } catch (err) {
      return { ok: false, note: `cancelOrder failed: ${errMsg(err)}` };
    }
  },
};

const qt1DistributeRecipe: QtBusinessStep = {
  stepId: "qt1-distribute-recipe",
  mode: "auto",
  compensation: "handler",
  run: distributeRecipeStep,
  compensate: unlockRecipeCompensation,
};

const qt1LineReadyCheck: QtBusinessStep = {
  stepId: "qt1-line-ready-check",
  mode: "auto",
  compensation: "none-readonly",
  async run(ctx) {
    const lineId = await resolveLineId(ctx.params);
    if (lineId == null) return { ok: false, note: "không resolve được lineId" };
    try {
      const { checkLineReadiness } = await import("../../lineController/lineReadiness");
      const r = await checkLineReadiness(lineId, { requireRecipe: false });
      if (r.ready) return { ok: true, note: `line ${lineId} ready (${r.checks.length} checks)` };
      const failed = r.checks.filter((c) => !c.passed).map((c) => c.name);
      return { ok: false, note: `line ${lineId} NOT ready: [${failed.join(", ")}]` };
    } catch (err) {
      return { ok: false, note: `checkLineReadiness failed: ${errMsg(err)}` };
    }
  },
};

const qt1LineStart: QtBusinessStep = {
  stepId: "qt1-line-start",
  mode: "auto",
  compensation: "handler",
  async run(ctx) {
    const orderId = intParam(ctx.params, "orderId");
    const lineId = await resolveLineId(ctx.params);
    if (orderId == null || lineId == null) return { ok: false, note: "thiếu orderId/lineId" };
    try {
      const { executeLineCommand, transitionLine } = await import("../../lineController/lineControllerService");
      const lineRes = await executeLineCommand(lineId, "start", {
        actor: ACTOR,
        reason: `QT-1 run ${ctx.runId}: line start`,
        activeOrderId: orderId,
        ...(strParam(ctx.params, "recipeSetRef") ? { recipeSetRef: strParam(ctx.params, "recipeSetRef")! } : {}),
      });
      if (!lineRes.ok) return { ok: false, note: `line start bị chặn (${lineRes.code}): ${lineRes.message}` };

      try {
        const { transitionOrder } = await import("../../orders/orderLifecycleService");
        await transitionOrder(orderId, "running", { actor: ACTOR, reason: `QT-1 run ${ctx.runId}: producing` });
      } catch (err) {
        // Bước tự dọn phần đã làm (line đã start nhưng order không sang running):
        // đưa tuyến về held AN TOÀN rồi fail — runner sẽ bù các bước k-1..1.
        const hold = await transitionLine(lineId, "held", {
          actor: ACTOR,
          heldReason: "qt1 rollback: order transition failed",
          reason: `QT-1 run ${ctx.runId}: self-cleanup`,
        });
        return {
          ok: false,
          note: `order→running failed (${errMsg(err)}); line ${lineId} held=${hold.ok} (self-cleanup)`,
        };
      }
      return { ok: true, note: `line ${lineId} producing · order ${orderId} running` };
    } catch (err) {
      return { ok: false, note: `line start failed: ${errMsg(err)}` };
    }
  },
  /** §18.2: line về held an toàn (dừng có kiểm soát — không phải e-stop). */
  async compensate(ctx) {
    const lineId = await resolveLineId(ctx.params);
    if (lineId == null) return { ok: true, skipped: true, note: "không có lineId — bỏ qua" };
    try {
      const { transitionLine } = await import("../../lineController/lineControllerService");
      const res = await transitionLine(lineId, "held", {
        actor: ACTOR,
        heldReason: "qt1 compensation",
        reason: `QT-1 run ${ctx.runId}: compensation §18.2 (line về held an toàn)`,
      });
      return res.ok
        ? { ok: true, note: `line ${lineId} → held` }
        : { ok: true, skipped: true, note: `line ${lineId} không hold được (${res.code}) — trạng thái hiện tại giữ nguyên` };
    } catch (err) {
      return { ok: false, note: `hold line failed: ${errMsg(err)}` };
    }
  },
};

const qt1Monitor: QtBusinessStep = {
  stepId: "qt1-monitor",
  mode: "external",
  compensation: "none-external-wait",
};

const qt1Complete: QtBusinessStep = {
  stepId: "qt1-complete",
  mode: "auto",
  compensation: "none-terminal",
  async run(ctx) {
    const orderId = intParam(ctx.params, "orderId");
    if (orderId == null) return { ok: false, note: "thiếu params.orderId" };
    try {
      const { transitionOrder } = await import("../../orders/orderLifecycleService");
      await transitionOrder(orderId, "done", {
        actor: ACTOR,
        reason: `QT-1 run ${ctx.runId}: hoàn tất (hoàn công phát qua ERP outbox trong orderLifecycleService)`,
      });
    } catch (err) {
      return { ok: false, note: `order→done failed: ${errMsg(err)}` };
    }
    // Drain tuyến (producing→completing) — best-effort, không fail hoàn công vì tuyến.
    let lineNote = "line drain: skipped (không resolve được lineId)";
    const lineId = await resolveLineId(ctx.params);
    if (lineId != null) {
      try {
        const { executeLineCommand } = await import("../../lineController/lineControllerService");
        const res = await executeLineCommand(lineId, "complete", {
          actor: ACTOR,
          reason: `QT-1 run ${ctx.runId}: drain sau hoàn tất đơn`,
        });
        lineNote = res.ok ? `line ${lineId} → ${res.to}` : `line drain best-effort (${res.code})`;
      } catch (err) {
        lineNote = `line drain best-effort threw: ${errMsg(err)}`;
      }
    }
    return { ok: true, note: `order ${orderId} done + hoàn công · ${lineNote}` };
  },
};

// ── QT-2 handlers ─────────────────────────────────────────────────────────────

const qt2Correlate: QtBusinessStep = {
  stepId: "qt2-correlate",
  mode: "auto",
  compensation: "none-readonly",
  async run(ctx) {
    const lineId = intParam(ctx.params, "lineId");
    if (lineId == null) return { ok: false, note: "thiếu params.lineId" };
    try {
      const { getLineStages } = await import("../../lineController/lineControllerService");
      const stages = await getLineStages(lineId);
      if (!stages) return { ok: false, note: `line ${lineId} không tồn tại` };
      const suspects: string[] = [];
      for (const s of stages.stages) {
        if (s.blocked) suspects.push(`station ${s.code}: blocked`);
        if (s.starved) suspects.push(`station ${s.code}: starved`);
        for (const m of s.machines) {
          if (m.operationStatus === "error") suspects.push(`machine ${m.code}: error`);
        }
      }
      const failEventId = strParam(ctx.params, "failEventId");
      return {
        ok: true,
        note:
          `correlate (read-only)${failEventId ? ` event=${failEventId}` : ""}: ` +
          (suspects.length > 0 ? suspects.join("; ") : "không thấy trạm/máy bất thường trong cửa sổ dwell"),
      };
    } catch (err) {
      return { ok: false, note: `correlate failed: ${errMsg(err)}` };
    }
  },
};

const qt2Decide: QtBusinessStep = {
  stepId: "qt2-decide",
  mode: "auto",
  // Hold (held) là trạng thái AN TOÀN — giữ nguyên chính là "lùi an toàn" §18.2.
  compensation: "none-safe-state",
  async run(ctx) {
    const lineId = intParam(ctx.params, "lineId");
    if (lineId == null) return { ok: false, note: "thiếu params.lineId" };
    const notes: string[] = [];
    try {
      const { getLineStateDetail, transitionLine } = await import("../../lineController/lineControllerService");
      const detail = await getLineStateDetail(lineId);
      if (!detail) return { ok: false, note: `line ${lineId} không tồn tại` };
      if (detail.state === "producing") {
        const failEventId = strParam(ctx.params, "failEventId");
        const hold = await transitionLine(lineId, "held", {
          actor: ACTOR,
          heldReason: "quality",
          reason: `QT-2 run ${ctx.runId}: quality gate${failEventId ? ` (event ${failEventId})` : ""}`,
        });
        if (!hold.ok) return { ok: false, note: `quality-gate hold bị chặn (${hold.code}): ${hold.message}` };
        notes.push(`line ${lineId} → held (quality)`);
      } else {
        notes.push(`line ${lineId} đang '${detail.state}' — không cần hold (honest)`);
      }
    } catch (err) {
      return { ok: false, note: `quality-gate decide failed: ${errMsg(err)}` };
    }

    // Đề xuất hiệu chỉnh HITL (propose-only, VISION_CONTROL_ENABLED-gated) — best-effort.
    const machineId = intParam(ctx.params, "machineId");
    if (machineId != null) {
      try {
        const { proposeControlFromVerdict } = await import("../../qualityControlProposer");
        const res = await proposeControlFromVerdict({
          verdict: { decision: "NG", confidence: null, source: "quality_gate" },
          inspectionId: intParam(ctx.params, "inspectionId"),
          machineId,
        });
        notes.push(
          res.proposed > 0
            ? `đề xuất hiệu chỉnh HITL: ${res.proposed} ai_pending_action(s)`
            : `đề xuất hiệu chỉnh: skip (${res.skippedReason ?? "n/a"})`,
        );
      } catch (err) {
        notes.push(`đề xuất hiệu chỉnh best-effort threw: ${errMsg(err)}`);
      }
    } else {
      notes.push("không có machineId — không đề xuất hiệu chỉnh");
    }
    return { ok: true, note: notes.join(" · ") };
  },
};

const qt2AwaitResolution: QtBusinessStep = {
  stepId: "qt2-await-resolution",
  mode: "external",
  compensation: "none-external-wait",
};

const qt2Resume: QtBusinessStep = {
  stepId: "qt2-resume",
  mode: "auto",
  compensation: "none-safe-state",
  async run(ctx) {
    const lineId = intParam(ctx.params, "lineId");
    if (lineId == null) return { ok: false, note: "thiếu params.lineId" };
    try {
      const { getLineStateDetail, transitionLine } = await import("../../lineController/lineControllerService");
      const detail = await getLineStateDetail(lineId);
      if (!detail) return { ok: false, note: `line ${lineId} không tồn tại` };
      if (detail.state !== "held") {
        return { ok: true, skipped: true, note: `line ${lineId} đang '${detail.state}' (không held) — honest skip` };
      }
      const res = await transitionLine(lineId, "producing", {
        actor: ACTOR,
        reason: `QT-2 run ${ctx.runId}: resolved — thả tuyến`,
      });
      return res.ok
        ? { ok: true, note: `line ${lineId} → producing` }
        : { ok: false, note: `resume bị chặn (${res.code}): ${res.message}` };
    } catch (err) {
      return { ok: false, note: `resume failed: ${errMsg(err)}` };
    }
  },
};

// ── QT-3 handlers ─────────────────────────────────────────────────────────────

const qt3CreateTransportTask: QtBusinessStep = {
  stepId: "qt3-create-transport-task",
  mode: "auto",
  compensation: "handler",
  async run(ctx) {
    const machineId = intParam(ctx.params, "machineId");
    const componentCode = strParam(ctx.params, "componentCode");
    if (machineId == null || componentCode == null) return { ok: false, note: "thiếu machineId/componentCode" };
    try {
      const { ensureTransportTask } = await import("../materialReplenishment");
      const res = await ensureTransportTask({
        machineId,
        componentCode,
        feederId: intParam(ctx.params, "feederId"),
        lineId: intParam(ctx.params, "lineId"),
        qtRunId: ctx.runId,
      });
      if (!res.ok) return { ok: false, note: res.message ?? "ensureTransportTask failed" };
      return {
        ok: true,
        note:
          `task ${res.taskId} ${res.created ? "created" : "reused (idempotent)"} · ` +
          (res.allocated ? `AMR ${res.assignedDeviceId} nhận` : "pending — chưa có AMR (Andon thủ công đã phát)"),
      };
    } catch (err) {
      return { ok: false, note: `ensureTransportTask failed: ${errMsg(err)}` };
    }
  },
  /** §18.2: hủy nhiệm vụ AMR đang mở cho cặp material+station. */
  async compensate(ctx) {
    const machineId = intParam(ctx.params, "machineId");
    const componentCode = strParam(ctx.params, "componentCode");
    if (machineId == null || componentCode == null) return { ok: true, skipped: true, note: "thiếu key — bỏ qua" };
    try {
      const { cancelOpenTransportTask } = await import("../materialReplenishment");
      const res = await cancelOpenTransportTask(machineId, componentCode, `QT-3 run ${ctx.runId}: compensation §18.2`);
      return { ok: true, note: `hủy nhiệm vụ AMR: ${res.cancelled} task(s) cancelled` };
    } catch (err) {
      return { ok: false, note: `cancel transport task failed: ${errMsg(err)}` };
    }
  },
};

const qt3AwaitDelivery: QtBusinessStep = {
  stepId: "qt3-await-delivery",
  mode: "external",
  compensation: "none-external-wait",
};

const qt3ConfirmDock: QtBusinessStep = {
  stepId: "qt3-confirm-dock",
  mode: "auto",
  compensation: "none-readonly",
  async run(ctx) {
    const machineId = intParam(ctx.params, "machineId");
    const componentCode = strParam(ctx.params, "componentCode");
    const lineId = intParam(ctx.params, "lineId");
    try {
      const { eventBus } = await import("../../../_core/eventBus");
      eventBus.publish(
        "material.replenish.dock_confirmed",
        { runId: ctx.runId, machineId, componentCode, lineId },
        "qt3-workflow",
      );
    } catch (err) {
      return { ok: false, note: `dock-confirm publish failed: ${errMsg(err)}` };
    }
    // Thông báo tuyến (Andon info) — best-effort; tuyến KHÔNG dừng, không transition.
    try {
      const { routeAlert } = await import("../../aiSmartAlertRouter");
      await routeAlert({
        type: "PATTERN_ANOMALY",
        severity: "LOW",
        message: `[QT-3 Cấp liệu] Đã giao liệu ${componentCode ?? "?"} tới máy ${machineId ?? "?"} — xác nhận dock, tuyến tiếp tục không dừng.`,
        data: { source: "qt3-workflow", runId: ctx.runId, machineId, componentCode, lineId },
      });
    } catch {
      /* Andon best-effort */
    }
    return { ok: true, note: `dock confirmed · line notified (không dừng tuyến)` };
  },
};

// ── QT-4 handlers ─────────────────────────────────────────────────────────────

const qt4Changeover: QtBusinessStep = {
  stepId: "qt4-changeover",
  mode: "auto",
  compensation: "handler",
  async run(ctx) {
    const lineId = intParam(ctx.params, "lineId");
    const recipeSetRef = strParam(ctx.params, "recipeSetRef");
    if (lineId == null || recipeSetRef == null) return { ok: false, note: "thiếu lineId/recipeSetRef" };
    try {
      const { transitionLine } = await import("../../lineController/lineControllerService");
      const res = await transitionLine(lineId, "changeover", {
        actor: ACTOR,
        recipeSetRef,
        reason: `QT-4 run ${ctx.runId}: changeover${boolParam(ctx.params, "npi") ? " (NPI)" : ""}`,
      });
      return res.ok
        ? { ok: true, note: `line ${lineId} → changeover · recipe ${recipeSetRef} khóa trên line_states` }
        : { ok: false, note: `changeover bị chặn (${res.code}): ${res.message}` };
    } catch (err) {
      return { ok: false, note: `changeover failed: ${errMsg(err)}` };
    }
  },
  /**
   * §18.2: gỡ khóa recipe (W3-B1 seam). FSM không cho changeover→held — tuyến giữ ở
   * changeover là trạng thái KHÔNG-SẢN-XUẤT an toàn (honest, không ép transition sai).
   */
  async compensate(ctx) {
    const unlock = await unlockRecipeCompensation(ctx);
    return {
      ok: unlock.ok,
      note: `${unlock.note ?? ""} · tuyến giữ ở changeover (non-producing, an toàn — FSM không có changeover→held)`,
    };
  },
};

const qt4DistributeRecipe: QtBusinessStep = {
  stepId: "qt4-distribute-recipe",
  mode: "auto",
  compensation: "handler",
  run: distributeRecipeStep,
  compensate: unlockRecipeCompensation,
};

const qt4SimGate: QtBusinessStep = {
  stepId: "qt4-sim-gate",
  mode: "auto",
  compensation: "none-readonly",
  async run(ctx) {
    if (!boolParam(ctx.params, "npi")) {
      return { ok: true, skipped: true, note: "npi=false — sim-gate chỉ bắt buộc cho NPI (honest skip)" };
    }
    const simToken = strParam(ctx.params, "simToken");
    const simWorkflowRef = strParam(ctx.params, "simWorkflowRef");
    if (!simToken || !simWorkflowRef) {
      return { ok: false, note: "NPI yêu cầu simulation pass: thiếu simToken/simWorkflowRef (fail-closed)" };
    }
    try {
      const { getDb } = await import("../../../db/connection");
      const db = await getDb();
      if (!db) return { ok: false, note: "DB unavailable — sim-gate fail-closed" };
      const { eq } = await import("drizzle-orm");
      const { orchestrationWorkflows } = await import("../../../../drizzle/schema");
      const [wf] = await db
        .select()
        .from(orchestrationWorkflows)
        .where(eq(orchestrationWorkflows.ref, simWorkflowRef))
        .limit(1);
      if (!wf) return { ok: false, note: `workflow '${simWorkflowRef}' không tồn tại — sim-gate fail-closed` };
      const { issueSimToken } = await import("../foe/foeEngine");
      const expected = issueSimToken(wf.definitionJson as never);
      const { timingSafeEqual } = await import("node:crypto");
      const a = Buffer.from(expected, "utf8");
      const b = Buffer.from(simToken, "utf8");
      const valid = a.length === b.length && timingSafeEqual(a, b);
      return valid
        ? { ok: true, note: `sim-gate PASS: sim-token hợp lệ cho '${simWorkflowRef}'` }
        : { ok: false, note: "sim-token KHÔNG khớp definition đã deploy — mô phỏng lại (fail-closed)" };
    } catch (err) {
      return { ok: false, note: `sim-gate check failed (fail-closed): ${errMsg(err)}` };
    }
  },
};

const qt4Readiness: QtBusinessStep = {
  stepId: "qt4-readiness",
  mode: "auto",
  compensation: "none-readonly",
  async run(ctx) {
    const lineId = intParam(ctx.params, "lineId");
    if (lineId == null) return { ok: false, note: "thiếu params.lineId" };
    try {
      const { checkLineReadiness } = await import("../../lineController/lineReadiness");
      const r = await checkLineReadiness(lineId, { requireRecipe: true });
      if (r.ready) return { ok: true, note: `line ${lineId} readiness PASS (requireRecipe)` };
      const failed = r.checks.filter((c) => !c.passed).map((c) => c.name);
      return { ok: false, note: `line ${lineId} NOT ready: [${failed.join(", ")}]` };
    } catch (err) {
      return { ok: false, note: `readiness failed: ${errMsg(err)}` };
    }
  },
};

const qt4Ready: QtBusinessStep = {
  stepId: "qt4-ready",
  mode: "auto",
  compensation: "none-safe-state",
  async run(ctx) {
    const lineId = intParam(ctx.params, "lineId");
    if (lineId == null) return { ok: false, note: "thiếu params.lineId" };
    try {
      const { transitionLine } = await import("../../lineController/lineControllerService");
      const res = await transitionLine(lineId, "ready", {
        actor: ACTOR,
        requireRecipe: true,
        reason: `QT-4 run ${ctx.runId}: changeover hoàn tất → ready`,
      });
      return res.ok
        ? { ok: true, note: `line ${lineId} → ready (readiness checklist enforced trong transition)` }
        : { ok: false, note: `vào ready bị chặn (${res.code}): ${res.message}` };
    } catch (err) {
      return { ok: false, note: `ready transition failed: ${errMsg(err)}` };
    }
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

const QT_BUSINESS_STEPS: Record<string, QtBusinessStep[]> = {
  [QT1_REF]: [qt1Allocate, qt1DistributeRecipe, qt1LineReadyCheck, qt1LineStart, qt1Monitor, qt1Complete],
  [QT2_REF]: [qt2Correlate, qt2Decide, qt2AwaitResolution, qt2Resume],
  [QT3_REF]: [qt3CreateTransportTask, qt3AwaitDelivery, qt3ConfirmDock],
  [QT4_REF]: [qt4Changeover, qt4DistributeRecipe, qt4SimGate, qt4Readiness, qt4Ready],
};

/** Danh sách business-step (thứ tự template) của một template QT — [] khi không phải QT. */
export function getQtBusinessSteps(ref: string): QtBusinessStep[] {
  return QT_BUSINESS_STEPS[ref] ?? [];
}

/** Tra handler theo (templateRef, stepId) — null khi không có. */
export function findQtBusinessStep(ref: string, stepId: string): QtBusinessStep | null {
  return getQtBusinessSteps(ref).find((s) => s.stepId === stepId) ?? null;
}
