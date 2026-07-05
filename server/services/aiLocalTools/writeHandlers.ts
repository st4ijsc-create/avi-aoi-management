/**
 * AI Local Tools — Write Handlers (GĐ2)
 *
 * Write-action tools that go through the HITL confirm flow. They never run
 * tool.handler (read path); instead the registry/index routes them through
 * propose → confirm → execute (see aiCopilotActions.ts).
 *
 * MẪU (sample) write tool: set_spec_limits → update USL/LSL/Target on a
 * measurement point definition. Reuses db.updateMeasurementPointDef (which
 * snapshots a measurementPointVersions row for audit/versioning).
 */

import { z } from "zod";
import { getMeasurementPointDefById, updateMeasurementPointDef } from "../../db/product";
import { createAuditLog } from "../../db/system";
import { resolveThresholdEditGate, type ThresholdGateResult } from "../thresholdGovernanceService";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "./toolRegistry";
import type { AuditChangeField } from "../auditTrailService";

// ── set_spec_limits ──────────────────────────────────────────────────────────

const setSpecLimitsParams = z
  .object({
    measurementPointDefId: z.number().int().positive(),
    usl: z.number().nullable(),
    lsl: z.number().nullable(),
    target: z.number().nullable(),
  })
  .strict();

type SetSpecLimitsParams = z.infer<typeof setSpecLimitsParams>;

// decimal columns are stored/read as strings — normalize for diffing.
function toStr(n: number | null): string | null {
  return n === null || Number.isNaN(n) ? null : String(n);
}
function numEq(a: string | null | undefined, b: string | null): boolean {
  const an = a == null ? null : Number(a);
  const bn = b == null ? null : Number(b);
  if (an === null || bn === null) return an === bn;
  return an === bn;
}

// Doc 31 B.6 — set_spec_limits is a limit-write path, so the same lifecycle gate
// (decision #4) that guards measurementPoint.update / spcAnalysisRouter must apply
// here. This is a HITL copilot tool: on a BLOCK we route an honest message into the
// tool's result (never an uncaught throw), so the copilot tells the user to use the
// approval queue instead of crashing the turn.
function gateBlocked(gate: ThresholdGateResult): boolean {
  return gate.decision === "requires_approval" && gate.enforced;
}

function gateBlockMessage(gate: ThresholdGateResult, lang: ToolLang): string {
  const why = gate.hasReleasedProgram ? "has a released inspection program" : `is '${gate.lifecycleStatus}'`;
  switch (lang) {
    case "en":
      return `Blocked: the product ${why} — threshold changes require approval. Submit the new limits via the Threshold Approvals queue.`;
    case "zh":
      return `已阻止：该产品${gate.hasReleasedProgram ? "已发布检测程序" : `处于 '${gate.lifecycleStatus}' 状态`}——修改规格限需审批。请通过阈值审批队列提交。`;
    case "vi":
    default:
      return `Đã chặn: sản phẩm ${gate.hasReleasedProgram ? "đã có chương trình phát hành" : `đang ở trạng thái '${gate.lifecycleStatus}'`} — thay đổi ngưỡng phải qua duyệt. Gửi giới hạn mới qua hàng đợi Duyệt ngưỡng.`;
  }
}

function summarizeSpec(p: SetSpecLimitsParams, lang: ToolLang): string {
  const fmt = (v: number | null) => (v === null ? "—" : String(v));
  const parts = `USL=${fmt(p.usl)}, LSL=${fmt(p.lsl)}, Target=${fmt(p.target)}`;
  switch (lang) {
    case "en":
      return `Set spec limits for measurement point #${p.measurementPointDefId}: ${parts}.`;
    case "zh":
      return `为测量点 #${p.measurementPointDefId} 设置规格限：${parts}。`;
    case "vi":
    default:
      return `Đặt giới hạn spec cho điểm đo #${p.measurementPointDefId}: ${parts}.`;
  }
}

async function previewSpec(p: SetSpecLimitsParams, _ctx: ToolExecContext): Promise<ActionPreview> {
  const current = await getMeasurementPointDefById(p.measurementPointDefId);
  const warnings: string[] = [];

  // Cross-field sanity: USL must be >= LSL when both provided.
  if (p.usl !== null && p.lsl !== null && p.usl < p.lsl) {
    warnings.push(`Cảnh báo: USL (${p.usl}) < LSL (${p.lsl}) — giới hạn trên nhỏ hơn giới hạn dưới.`);
  }

  if (!current) {
    warnings.push(`Không tìm thấy điểm đo #${p.measurementPointDefId}.`);
    return {
      entityType: "measurement_point",
      entityId: p.measurementPointDefId,
      changes: [],
      warnings,
      humanSummary: summarizeSpec(p, _ctx.lang),
    };
  }

  const nextUsl = toStr(p.usl);
  const nextLsl = toStr(p.lsl);
  const nextTarget = toStr(p.target);

  const changes: AuditChangeField[] = [];
  if (!numEq(current.upperLimit as string | null | undefined, nextUsl)) {
    changes.push({ field: "upperLimit", oldValue: current.upperLimit ?? null, newValue: nextUsl, displayName: "USL" });
  }
  if (!numEq(current.lowerLimit as string | null | undefined, nextLsl)) {
    changes.push({ field: "lowerLimit", oldValue: current.lowerLimit ?? null, newValue: nextLsl, displayName: "LSL" });
  }
  if (!numEq(current.nominalValue as string | null | undefined, nextTarget)) {
    changes.push({ field: "nominalValue", oldValue: current.nominalValue ?? null, newValue: nextTarget, displayName: "Target" });
  }

  // Doc 31 B.6 — surface the lifecycle gate in the dry-run so the user sees, BEFORE
  // confirming, that a live product will reject this direct edit (execute enforces).
  try {
    const gate = await resolveThresholdEditGate(p.measurementPointDefId);
    if (gateBlocked(gate)) warnings.push(gateBlockMessage(gate, _ctx.lang));
  } catch {
    // gate resolution is best-effort in preview; execute() is the hard gate.
  }

  return {
    entityType: "measurement_point",
    entityId: current.id,
    entityName: `${current.code} — ${current.name}`,
    changes,
    warnings,
    humanSummary: summarizeSpec(p, _ctx.lang),
  };
}

export const setSpecLimitsTool: Tool<SetSpecLimitsParams, { ok: boolean }> = {
  name: "set_spec_limits",
  description:
    "Đặt/cập nhật giới hạn spec (USL/LSL/Target) cho một điểm đo (measurement point). " +
    "Đây là WRITE-ACTION: cần xác nhận của người dùng và quyền chỉnh sửa điểm đo.",
  parameters: setSpecLimitsParams,
  triggers: [
    "đặt spec", "cập nhật spec", "đặt usl", "đặt lsl", "đặt target",
    "set spec", "set usl", "set lsl", "spec limit", "giới hạn spec",
  ],
  kind: "write",
  requiredPermission: { module: "settings_measurement_points", action: "canEdit" },
  summarize: summarizeSpec,
  preview: previewSpec,
  execute: async (p, ctx) => {
    // Doc 31 B.6 — hard lifecycle gate. On a live product (active/eol/archived or a
    // dev product that already has a released program) block the direct edit and
    // route an honest message back into the copilot turn — NEVER an uncaught throw.
    const before = await getMeasurementPointDefById(p.measurementPointDefId);
    const gate = await resolveThresholdEditGate(p.measurementPointDefId);
    if (gateBlocked(gate)) {
      const msg = gateBlockMessage(gate, ctx.lang);
      return {
        type: "action_result",
        title:
          ctx.lang === "en" ? `Spec limit change blocked (needs approval)`
          : ctx.lang === "zh" ? `规格限修改已阻止（需审批）`
          : `Thay đổi giới hạn spec bị chặn (cần duyệt)`,
        data: { ok: false },
        textSummary: msg,
        note: msg,
      };
    }

    await updateMeasurementPointDef(
      p.measurementPointDefId,
      {
        upperLimit: toStr(p.usl) ?? undefined,
        lowerLimit: toStr(p.lsl) ?? undefined,
        nominalValue: toStr(p.target) ?? undefined,
      } as any,
      { changedBy: ctx.user.id, changeReason: "AI Copilot" },
    );
    // Doc 31 B.6 — audit the direct (allowed) limit edit with the gate decision.
    try {
      await createAuditLog({
        userId: ctx.user.id,
        userName: ctx.user.name ?? undefined,
        action: "threshold.directEdit",
        entityType: "measurement_point_def",
        entityId: p.measurementPointDefId,
        entityName: before?.code ?? undefined,
        details: {
          source: "aiCopilot.set_spec_limits",
          productModelId: before?.productModelId ?? null,
          lifecycleStatus: gate.lifecycleStatus,
          gateDecision: gate.decision,
          gateEnforced: gate.enforced,
          hasReleasedProgram: gate.hasReleasedProgram,
          before: {
            lowerLimit: before?.lowerLimit ?? null,
            upperLimit: before?.upperLimit ?? null,
            nominalValue: before?.nominalValue ?? null,
          },
          after: { upperLimit: toStr(p.usl), lowerLimit: toStr(p.lsl), nominalValue: toStr(p.target) },
        },
        status: "success",
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("audit log failed (aiCopilot threshold.directEdit)", err);
    }
    return {
      type: "action_result",
      title: `Đã cập nhật spec điểm đo #${p.measurementPointDefId}`,
      data: { ok: true },
      textSummary: summarizeSpec(p, ctx.lang),
    };
  },
};

registerTool(setSpecLimitsTool);

// ── GĐ3a: additional write-tools + client-action tools (side-effect imports) ──
// Each module self-registers via registerTool().
import "./writeHandlers/alerts";          // acknowledge_alert, ack/resolve predictive
import "./writeHandlers/measurementPoint"; // create_/update_measurement_point
import "./writeHandlers/yield";            // set_yield_threshold
import "./writeHandlers/client";           // navigate, prefill_form (client_action)
import "./writeHandlers/machineControl";   // F4a: machine_start/stop/pause/reset/select_recipe/download_job/set_machine_param/acknowledge_machine_alarm (OT HITL, DRY-RUN)
import "./writeHandlers/visionControl";     // AOI-F (doc 24 Wave-4): reject_divert / spi_printer_offset (quality→control, OT HITL, DRY-RUN; composes with C2)
import "./writeHandlers/interlock";        // F5a: propose_interlock_rule (HITL; rule always disabled/unapproved; ALERT-ONLY)
import "./writeHandlers/engineering";      // B1: ENGINEERING write-tools — adjust_ng_threshold / configure_inspection_param / create_ng_threshold / update_product_quality_target (HITL propose→confirm)
import "./writeHandlers/maintenance";      // RCA Copilot: create_maintenance_workorder (HITL propose→confirm) — maintenance_work_orders
import "./writeHandlers/qualityAdvisory";  // W7-E (doc 27 V21): run_rca_analysis / request_threshold_review (HITL; analysis/request-only writes)
