/**
 * AI Local Tools — Write Handlers: Yield Threshold (GĐ3a, Nhóm B — medium)
 *
 * Reuses existing DB endpoints (no new business logic, no migration):
 *   set_yield_threshold → db.updateYieldAlertThreshold (yieldThresholdRouter:179)
 *                         + db.createYieldThresholdHistory (history snapshot)
 *
 * The threshold row has three numeric targets (warning/critical/target). The
 * plan's `value` defaults to the WARNING threshold; an optional `field` selects
 * which one. The target row is resolved either by `thresholdId` OR by `scope`
 * (= metricType FPY/FY/NTF/UPH) via getYieldAlertThresholdByType.
 *
 * Permission module (VERIFIED in permissionsRouter.ts):
 *   - settings_yield_thresholds/canEdit
 */

import { z } from "zod";
import {
  getYieldAlertThresholdById,
  getYieldAlertThresholdByType,
  updateYieldAlertThreshold,
  createYieldThresholdHistory,
} from "../../../db/alerts";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";

const metricTypeSchema = z.enum(["FPY", "FY", "NTF", "UPH"]);
const fieldSchema = z.enum(["warning", "critical", "target"]).default("warning");

const setYieldParams = z
  .object({
    thresholdId: z.number().int().positive().optional(),
    scope: metricTypeSchema.optional(),
    field: fieldSchema,
    value: z.number(),
  })
  .strict()
  .refine((p) => p.thresholdId != null || p.scope != null, {
    message: "Cần thresholdId hoặc scope (metricType FPY/FY/NTF/UPH).",
  });

type SetYieldParams = z.infer<typeof setYieldParams>;

const COLUMN: Record<"warning" | "critical" | "target", "warningThreshold" | "criticalThreshold" | "targetValue"> = {
  warning: "warningThreshold",
  critical: "criticalThreshold",
  target: "targetValue",
};
const FIELD_LABEL: Record<"warning" | "critical" | "target", string> = {
  warning: "Ngưỡng cảnh báo",
  critical: "Ngưỡng nghiêm trọng",
  target: "Giá trị mục tiêu",
};

function summarizeSetYield(p: SetYieldParams, lang: ToolLang): string {
  const target = p.thresholdId != null ? `#${p.thresholdId}` : p.scope;
  switch (lang) {
    case "en":
      return `Set yield ${p.field} threshold for ${target} = ${p.value}.`;
    case "zh":
      return `将 ${target} 的良率${p.field}阈值设为 ${p.value}。`;
    case "vi":
    default:
      return `Đặt ${FIELD_LABEL[p.field].toLowerCase()} yield cho ${target} = ${p.value}.`;
  }
}

async function resolveThreshold(p: SetYieldParams) {
  if (p.thresholdId != null) return getYieldAlertThresholdById(p.thresholdId);
  if (p.scope != null) return getYieldAlertThresholdByType(p.scope);
  return null;
}

async function previewSetYield(p: SetYieldParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const current = await resolveThreshold(p);
  if (!current) {
    warnings.push(`Không tìm thấy ngưỡng yield (${p.thresholdId != null ? `#${p.thresholdId}` : p.scope}).`);
    return { entityType: "yield_threshold", entityId: p.thresholdId, changes: [], warnings, humanSummary: summarizeSetYield(p, ctx.lang) };
  }
  const col = COLUMN[p.field];
  const oldVal = (current as any)[col] as string | null;
  // Cross-field sanity: warning vs critical ordering (operator-aware would need
  // more context — keep a soft warning only).
  if (p.field === "warning" && current.criticalThreshold != null) {
    const crit = Number(current.criticalThreshold);
    if ((current.comparisonOperator?.startsWith("gt") && p.value > crit) ||
        (current.comparisonOperator?.startsWith("lt") && p.value < crit)) {
      warnings.push(`Cảnh báo: ngưỡng cảnh báo (${p.value}) có thể vượt qua ngưỡng nghiêm trọng (${crit}).`);
    }
  }
  const changes: AuditChangeField[] = [
    { field: col, oldValue: oldVal ?? null, newValue: String(p.value), displayName: FIELD_LABEL[p.field] },
  ];
  return {
    entityType: "yield_threshold",
    entityId: current.id,
    entityName: `${current.metricType} threshold`,
    changes,
    warnings,
    humanSummary: summarizeSetYield(p, ctx.lang),
  };
}

export const setYieldThresholdTool: Tool<SetYieldParams, { ok: boolean }> = {
  name: "set_yield_threshold",
  description:
    "Đặt/cập nhật ngưỡng yield (warning/critical/target) cho một loại chỉ số (FPY/FY/NTF/UPH) hoặc một bản ghi ngưỡng. " +
    "WRITE-ACTION: cần xác nhận của người dùng và quyền cấu hình ngưỡng yield.",
  parameters: setYieldParams,
  triggers: ["đặt ngưỡng yield", "ngưỡng yield", "set yield threshold", "yield threshold", "良率阈值"],
  kind: "write",
  requiredPermission: { module: "settings_yield_thresholds", action: "canEdit" },
  summarize: summarizeSetYield,
  preview: previewSetYield,
  execute: async (p, ctx) => {
    const current = await resolveThreshold(p);
    if (!current) {
      return {
        type: "action_result",
        title: `Không tìm thấy ngưỡng yield`,
        data: { ok: false },
        textSummary: summarizeSetYield(p, ctx.lang),
        note: "Threshold not found",
      };
    }
    const col = COLUMN[p.field];
    const oldVal = (current as any)[col] as string | null;
    await updateYieldAlertThreshold(current.id, { [col]: String(p.value) } as any);
    // Mirror yieldThresholdRouter.updateWithHistory: snapshot before/after using
    // the actual history columns (previous*/new* per field).
    const newWarning = p.field === "warning" ? String(p.value) : current.warningThreshold;
    const newCritical = p.field === "critical" ? String(p.value) : current.criticalThreshold;
    const newTarget = p.field === "target" ? String(p.value) : current.targetValue;
    try {
      await createYieldThresholdHistory({
        thresholdId: current.id,
        metricType: current.metricType,
        previousWarning: current.warningThreshold,
        newWarning,
        previousCritical: current.criticalThreshold,
        newCritical,
        previousTarget: current.targetValue,
        newTarget,
        changedBy: ctx.user.id,
        changedByName: ctx.user.name ?? undefined,
        changeReason: "AI Copilot",
      } as any);
    } catch {
      // history is best-effort; the threshold update already succeeded.
    }
    void oldVal;
    return {
      type: "action_result",
      title: `Đã cập nhật ${FIELD_LABEL[p.field].toLowerCase()} yield #${current.id}`,
      data: { ok: true },
      textSummary: summarizeSetYield(p, ctx.lang),
    };
  },
};

registerTool(setYieldThresholdTool);
