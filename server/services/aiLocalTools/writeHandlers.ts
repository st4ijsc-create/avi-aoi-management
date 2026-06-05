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
    await updateMeasurementPointDef(
      p.measurementPointDefId,
      {
        upperLimit: toStr(p.usl) ?? undefined,
        lowerLimit: toStr(p.lsl) ?? undefined,
        nominalValue: toStr(p.target) ?? undefined,
      } as any,
      { changedBy: ctx.user.id, changeReason: "AI Copilot" },
    );
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
