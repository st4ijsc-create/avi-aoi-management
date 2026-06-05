/**
 * AI Local Tools — Write Handlers: Alerts (GĐ3a, Nhóm A — low risk)
 *
 * Reuses existing DB endpoints (no new business logic, no migration):
 *   acknowledge_alert            → db.acknowledgeAlert (alert_history)
 *   acknowledge_predictive_alert → db.acknowledgePredictiveAlert (predictive_alerts)
 *   resolve_predictive_alert     → db.resolvePredictiveAlert (predictive_alerts)
 *
 * All go through the GĐ2 HITL flow (propose → confirm → execute) with RBAC +
 * audit. Preview is a dry-run that reads current state (NO mutation).
 *
 * Permission modules (VERIFIED in permissionsRouter.ts DEFAULT_ROLE_PERMISSIONS):
 *   - mqtt_alerts/canEdit            (acknowledge_alert; alert_history rows come
 *                                     from MQTT/yield alert evaluation)
 *   - analytics_predictive_alerts/canEdit (predictive ack + resolve)
 */

import { z } from "zod";
import { getAlertHistoryById, acknowledgeAlert } from "../../../db/alerts";
import {
  getPredictiveAlertById,
  acknowledgePredictiveAlert,
  resolvePredictiveAlert,
} from "../../../db/ai";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";

// ── acknowledge_alert ────────────────────────────────────────────────────────

const ackAlertParams = z
  .object({
    // Plan: {alertSettingId|id:int, note?}. The actual ack target is an
    // alert_history row id; accept either key and coerce to a single id.
    id: z.number().int().positive().optional(),
    alertSettingId: z.number().int().positive().optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((p) => p.id != null || p.alertSettingId != null, {
    message: "Cần id hoặc alertSettingId của bản ghi cảnh báo.",
  });

type AckAlertParams = z.infer<typeof ackAlertParams>;

function ackAlertTargetId(p: AckAlertParams): number {
  return (p.id ?? p.alertSettingId)!;
}

function summarizeAckAlert(p: AckAlertParams, lang: ToolLang): string {
  const id = ackAlertTargetId(p);
  switch (lang) {
    case "en":
      return `Acknowledge alert #${id}.`;
    case "zh":
      return `确认告警 #${id}。`;
    case "vi":
    default:
      return `Xác nhận (acknowledge) cảnh báo #${id}.`;
  }
}

async function previewAckAlert(p: AckAlertParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const id = ackAlertTargetId(p);
  const current = await getAlertHistoryById(id);
  const warnings: string[] = [];
  if (!current) {
    warnings.push(`Không tìm thấy bản ghi cảnh báo #${id}.`);
    return { entityType: "alert_history", entityId: id, changes: [], warnings, humanSummary: summarizeAckAlert(p, ctx.lang) };
  }
  if (current.acknowledgedAt) {
    warnings.push(`Cảnh báo #${id} đã được xác nhận trước đó (lúc ${new Date(current.acknowledgedAt).toLocaleString()}).`);
  }
  return {
    entityType: "alert_history",
    entityId: id,
    entityName: current.message ?? `Alert #${id}`,
    changes: [
      { field: "acknowledgedBy", oldValue: current.acknowledgedBy ?? null, newValue: ctx.user.id, displayName: "Người xác nhận" },
    ],
    warnings,
    humanSummary: summarizeAckAlert(p, ctx.lang),
  };
}

export const acknowledgeAlertTool: Tool<AckAlertParams, { ok: boolean }> = {
  name: "acknowledge_alert",
  description:
    "Xác nhận (acknowledge) một cảnh báo trong lịch sử cảnh báo (alert history). " +
    "WRITE-ACTION: cần xác nhận của người dùng và quyền chỉnh sửa cảnh báo.",
  parameters: ackAlertParams,
  triggers: ["acknowledge alert", "xác nhận cảnh báo", "ack cảnh báo", "đã xem cảnh báo", "确认告警"],
  kind: "write",
  requiredPermission: { module: "mqtt_alerts", action: "canEdit" },
  summarize: summarizeAckAlert,
  preview: previewAckAlert,
  execute: async (p, ctx) => {
    const id = ackAlertTargetId(p);
    await acknowledgeAlert(id, ctx.user.id);
    return {
      type: "action_result",
      title: `Đã xác nhận cảnh báo #${id}`,
      data: { ok: true },
      textSummary: summarizeAckAlert(p, ctx.lang),
    };
  },
};

registerTool(acknowledgeAlertTool);

// ── acknowledge_predictive_alert ─────────────────────────────────────────────

const ackPredictiveParams = z
  .object({
    predictiveAlertId: z.number().int().positive(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

type AckPredictiveParams = z.infer<typeof ackPredictiveParams>;

function summarizeAckPredictive(p: AckPredictiveParams, lang: ToolLang): string {
  switch (lang) {
    case "en":
      return `Acknowledge predictive alert #${p.predictiveAlertId}.`;
    case "zh":
      return `确认预测性告警 #${p.predictiveAlertId}。`;
    case "vi":
    default:
      return `Xác nhận cảnh báo dự đoán #${p.predictiveAlertId}.`;
  }
}

async function previewAckPredictive(p: AckPredictiveParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const current = await getPredictiveAlertById(p.predictiveAlertId);
  const warnings: string[] = [];
  if (!current) {
    warnings.push(`Không tìm thấy cảnh báo dự đoán #${p.predictiveAlertId}.`);
    return { entityType: "predictive_alert", entityId: p.predictiveAlertId, changes: [], warnings, humanSummary: summarizeAckPredictive(p, ctx.lang) };
  }
  if (current.status !== "ACTIVE") {
    warnings.push(`Cảnh báo #${p.predictiveAlertId} đang ở trạng thái "${current.status}" (không phải ACTIVE).`);
  }
  return {
    entityType: "predictive_alert",
    entityId: p.predictiveAlertId,
    entityName: current.title ?? `Predictive #${p.predictiveAlertId}`,
    changes: [
      { field: "status", oldValue: current.status, newValue: "ACKNOWLEDGED", displayName: "Trạng thái" },
      { field: "acknowledgedBy", oldValue: current.acknowledgedBy ?? null, newValue: ctx.user.id, displayName: "Người xác nhận" },
    ],
    warnings,
    humanSummary: summarizeAckPredictive(p, ctx.lang),
  };
}

export const acknowledgePredictiveAlertTool: Tool<AckPredictiveParams, { ok: boolean }> = {
  name: "acknowledge_predictive_alert",
  description:
    "Xác nhận (acknowledge) một cảnh báo dự đoán (predictive alert). " +
    "WRITE-ACTION: cần xác nhận của người dùng và quyền quản lý cảnh báo dự đoán.",
  parameters: ackPredictiveParams,
  triggers: ["acknowledge predictive", "xác nhận cảnh báo dự đoán", "ack predictive alert", "确认预测性告警"],
  kind: "write",
  requiredPermission: { module: "analytics_predictive_alerts", action: "canEdit" },
  summarize: summarizeAckPredictive,
  preview: previewAckPredictive,
  execute: async (p, ctx) => {
    await acknowledgePredictiveAlert(p.predictiveAlertId, ctx.user.id);
    return {
      type: "action_result",
      title: `Đã xác nhận cảnh báo dự đoán #${p.predictiveAlertId}`,
      data: { ok: true },
      textSummary: summarizeAckPredictive(p, ctx.lang),
    };
  },
};

registerTool(acknowledgePredictiveAlertTool);

// ── resolve_predictive_alert ─────────────────────────────────────────────────

const resolvePredictiveParams = z
  .object({
    predictiveAlertId: z.number().int().positive(),
    resolutionNotes: z.string().min(1).max(2000),
  })
  .strict();

type ResolvePredictiveParams = z.infer<typeof resolvePredictiveParams>;

function summarizeResolvePredictive(p: ResolvePredictiveParams, lang: ToolLang): string {
  switch (lang) {
    case "en":
      return `Resolve predictive alert #${p.predictiveAlertId}: "${p.resolutionNotes}".`;
    case "zh":
      return `解决预测性告警 #${p.predictiveAlertId}：“${p.resolutionNotes}”。`;
    case "vi":
    default:
      return `Đóng (resolve) cảnh báo dự đoán #${p.predictiveAlertId}: "${p.resolutionNotes}".`;
  }
}

async function previewResolvePredictive(p: ResolvePredictiveParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const current = await getPredictiveAlertById(p.predictiveAlertId);
  const warnings: string[] = [];
  if (!current) {
    warnings.push(`Không tìm thấy cảnh báo dự đoán #${p.predictiveAlertId}.`);
    return { entityType: "predictive_alert", entityId: p.predictiveAlertId, changes: [], warnings, humanSummary: summarizeResolvePredictive(p, ctx.lang) };
  }
  if (current.status === "RESOLVED") {
    warnings.push(`Cảnh báo #${p.predictiveAlertId} đã được đóng trước đó.`);
  }
  return {
    entityType: "predictive_alert",
    entityId: p.predictiveAlertId,
    entityName: current.title ?? `Predictive #${p.predictiveAlertId}`,
    changes: [
      { field: "status", oldValue: current.status, newValue: "RESOLVED", displayName: "Trạng thái" },
      { field: "resolvedBy", oldValue: current.resolvedBy ?? null, newValue: ctx.user.id, displayName: "Người đóng" },
      { field: "resolutionNotes", oldValue: current.resolutionNotes ?? null, newValue: p.resolutionNotes, displayName: "Ghi chú xử lý" },
    ],
    warnings,
    humanSummary: summarizeResolvePredictive(p, ctx.lang),
  };
}

export const resolvePredictiveAlertTool: Tool<ResolvePredictiveParams, { ok: boolean }> = {
  name: "resolve_predictive_alert",
  description:
    "Đóng/giải quyết (resolve) một cảnh báo dự đoán kèm ghi chú xử lý. " +
    "WRITE-ACTION: cần xác nhận của người dùng và quyền quản lý cảnh báo dự đoán.",
  parameters: resolvePredictiveParams,
  triggers: ["resolve predictive", "đóng cảnh báo dự đoán", "giải quyết cảnh báo dự đoán", "解决预测性告警"],
  kind: "write",
  requiredPermission: { module: "analytics_predictive_alerts", action: "canEdit" },
  summarize: summarizeResolvePredictive,
  preview: previewResolvePredictive,
  execute: async (p, ctx) => {
    await resolvePredictiveAlert(p.predictiveAlertId, ctx.user.id, p.resolutionNotes);
    return {
      type: "action_result",
      title: `Đã đóng cảnh báo dự đoán #${p.predictiveAlertId}`,
      data: { ok: true },
      textSummary: summarizeResolvePredictive(p, ctx.lang),
    };
  },
};

registerTool(resolvePredictiveAlertTool);
