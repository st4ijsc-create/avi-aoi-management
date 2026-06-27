/**
 * AI Local Tools — Write Handlers: ENGINEERING / TECHNICIAN (Phase B1, §B8bis #7)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (B1 — SAFETY-CRITICAL):
 *   - Every tool here is kind:'write' → routed ONLY through the HITL lifecycle
 *     (aiCopilotActions.proposeAction → confirmAction). The AI can ONLY propose;
 *     a human must confirm. There is NO code path here that mutates without a
 *     prior confirmAction (the orchestrator never calls tool.execute directly).
 *   - preview() READS ONLY (loads the current row, computes before/after) and
 *     NEVER writes to the DB.
 *   - execute() mutates via Drizzle using ctx.user.id for attribution and reads
 *     its args from the DB row (threaded by confirmAction), never the client.
 *   - zod .strict() schemas carry realistic min/max BOUNDS so HITL + schema both
 *     constrain dangerous values (defense in depth).
 *
 * SCOPE (engineering verbs): cài đặt · điều chỉnh · cấu hình · thêm mới.
 *   adjust    → adjust_ng_threshold       (warning/critical NG-rate %, 0–100)
 *   configure → configure_inspection_param (minSampleSize / cooldownMinutes)
 *   setup     → create_ng_threshold       (add a new NG-rate threshold record)
 *   update    → update_product_quality_target (targetYieldRate / minYieldRate)
 *
 * REAL ENTITIES (verified in drizzle/schema):
 *   - mqttNgRateThresholds  (schema/mqtt.ts) — NG/AOI threshold config per
 *       station/machine/measurement-point. warningThreshold/criticalThreshold
 *       are decimal(5,2) percentages; minSampleSize/cooldownMinutes are ints.
 *   - productModels         (schema/product.ts) — targetYieldRate/minYieldRate
 *       are decimal(5,2) FPY percentages.
 *
 * RBAC (modules verified in permissionsRouter.ts; engineer/technician roles must
 * be granted them):
 *   - adjust_ng_threshold            → settings_alerts/canEdit
 *   - configure_inspection_param     → settings_alerts/canEdit
 *   - create_ng_threshold            → settings_alerts/canCreate
 *   - update_product_quality_target  → settings_products/canEdit
 * ════════════════════════════════════════════════════════════════════════════
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { mqttNgRateThresholds, productModels } from "../../../../drizzle/schema";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";

// ─── i18n helper (vi/en/zh) ───────────────────────────────────────────────────
function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

// decimal columns are stored/read as strings — normalize for diffing/format.
function decEq(a: string | null | undefined, b: number): boolean {
  if (a == null) return false;
  return Number(a) === b;
}
function fmt(v: number | null | undefined): string {
  return v == null ? "—" : String(v);
}

// ─── adjust_ng_threshold (settings_alerts/canEdit) ────────────────────────────
// VERB: adjust — điều chỉnh ngưỡng cảnh báo NG/AOI (warning/critical %) trên một
// bản ghi mqtt_ng_rate_thresholds đã tồn tại.

const adjustNgThresholdParams = z
  .object({
    thresholdId: z.number().int().positive(),
    // NG-rate is a percentage → hard 0–100 bound (schema + HITL).
    warningThreshold: z.number().min(0).max(100).optional(),
    criticalThreshold: z.number().min(0).max(100).optional(),
  })
  .strict()
  .refine((p) => p.warningThreshold !== undefined || p.criticalThreshold !== undefined, {
    message: "Cần ít nhất warningThreshold hoặc criticalThreshold.",
  });

type AdjustNgThresholdParams = z.infer<typeof adjustNgThresholdParams>;

function summarizeAdjustNg(p: AdjustNgThresholdParams, lang: ToolLang): string {
  const parts: string[] = [];
  if (p.warningThreshold !== undefined) parts.push(`warning=${p.warningThreshold}%`);
  if (p.criticalThreshold !== undefined) parts.push(`critical=${p.criticalThreshold}%`);
  const body = parts.join(", ");
  return w(
    lang,
    `Điều chỉnh ngưỡng NG #${p.thresholdId}: ${body}.`,
    `Adjust NG threshold #${p.thresholdId}: ${body}.`,
    `调整 NG 阈值 #${p.thresholdId}：${body}。`,
  );
}

async function getNgThreshold(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(mqttNgRateThresholds).where(eq(mqttNgRateThresholds.id, id)).limit(1);
  return row ?? null;
}

async function previewAdjustNg(p: AdjustNgThresholdParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const current = await getNgThreshold(p.thresholdId);
  if (!current) {
    warnings.push(w(ctx.lang, `Không tìm thấy ngưỡng NG #${p.thresholdId}.`, `NG threshold #${p.thresholdId} not found.`, `未找到 NG 阈值 #${p.thresholdId}。`));
    return { entityType: "ng_rate_threshold", entityId: p.thresholdId, changes: [], warnings, humanSummary: summarizeAdjustNg(p, ctx.lang) };
  }

  // Cross-field sanity: critical must be >= warning (mirrors ngRateThresholdRouter).
  const effWarning = p.warningThreshold !== undefined ? p.warningThreshold : Number(current.warningThreshold);
  const effCritical = p.criticalThreshold !== undefined ? p.criticalThreshold : Number(current.criticalThreshold);
  if (effCritical < effWarning) {
    warnings.push(w(
      ctx.lang,
      `Cảnh báo: ngưỡng nghiêm trọng (${effCritical}%) < ngưỡng cảnh báo (${effWarning}%).`,
      `Warning: critical threshold (${effCritical}%) < warning threshold (${effWarning}%).`,
      `警告：严重阈值 (${effCritical}%) < 警告阈值 (${effWarning}%)。`,
    ));
  }

  const changes: AuditChangeField[] = [];
  if (p.warningThreshold !== undefined && !decEq(current.warningThreshold, p.warningThreshold)) {
    changes.push({ field: "warningThreshold", oldValue: current.warningThreshold ?? null, newValue: String(p.warningThreshold), displayName: "Ngưỡng cảnh báo (%)" });
  }
  if (p.criticalThreshold !== undefined && !decEq(current.criticalThreshold, p.criticalThreshold)) {
    changes.push({ field: "criticalThreshold", oldValue: current.criticalThreshold ?? null, newValue: String(p.criticalThreshold), displayName: "Ngưỡng nghiêm trọng (%)" });
  }
  return {
    entityType: "ng_rate_threshold",
    entityId: current.id,
    entityName: current.name,
    changes,
    warnings,
    humanSummary: summarizeAdjustNg(p, ctx.lang),
  };
}

export const adjustNgThresholdTool: Tool<AdjustNgThresholdParams, { ok: boolean }> = {
  name: "adjust_ng_threshold",
  description:
    "Điều chỉnh ngưỡng cảnh báo NG/AOI (warning/critical %) cho một bản ghi cấu hình NG rate đã tồn tại. " +
    "WRITE-ACTION (kỹ thuật): cần quyền settings_alerts/canEdit + xác nhận của người dùng.",
  parameters: adjustNgThresholdParams,
  triggers: [
    "điều chỉnh ngưỡng ng", "chỉnh ngưỡng ng", "đặt ngưỡng ng", "ngưỡng aoi",
    "adjust ng threshold", "set ng threshold", "ng rate threshold", "调整ng阈值",
  ],
  kind: "write",
  requiredPermission: { module: "settings_alerts", action: "canEdit" },
  summarize: summarizeAdjustNg,
  preview: previewAdjustNg,
  execute: async (p, ctx) => {
    const db = await getDb();
    if (!db) {
      return { type: "action_result", title: "DB không khả dụng", data: { ok: false }, textSummary: summarizeAdjustNg(p, ctx.lang), note: "DB_UNAVAILABLE" };
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (p.warningThreshold !== undefined) patch.warningThreshold = String(p.warningThreshold);
    if (p.criticalThreshold !== undefined) patch.criticalThreshold = String(p.criticalThreshold);
    await db.update(mqttNgRateThresholds).set(patch as any).where(eq(mqttNgRateThresholds.id, p.thresholdId));
    return {
      type: "action_result",
      title: w(ctx.lang, `Đã điều chỉnh ngưỡng NG #${p.thresholdId}`, `Adjusted NG threshold #${p.thresholdId}`, `已调整 NG 阈值 #${p.thresholdId}`),
      data: { ok: true },
      textSummary: summarizeAdjustNg(p, ctx.lang),
    };
  },
};

registerTool(adjustNgThresholdTool);

// ─── configure_inspection_param (settings_alerts/canEdit) ─────────────────────
// VERB: configure — cấu hình tham số kiểm tra (minSampleSize / cooldownMinutes)
// của một bản ghi ngưỡng NG. Tác động tới cách hệ thống đánh giá NG-rate.

const configureInspectionParams = z
  .object({
    thresholdId: z.number().int().positive(),
    // Minimum sample size before NG-rate is evaluated (avoid false alarms).
    minSampleSize: z.number().int().min(1).max(100000).optional(),
    // Cooldown between alerts (minutes).
    cooldownMinutes: z.number().int().min(1).max(1440).optional(),
  })
  .strict()
  .refine((p) => p.minSampleSize !== undefined || p.cooldownMinutes !== undefined, {
    message: "Cần ít nhất minSampleSize hoặc cooldownMinutes.",
  });

type ConfigureInspectionParams = z.infer<typeof configureInspectionParams>;

function summarizeConfigureInspection(p: ConfigureInspectionParams, lang: ToolLang): string {
  const parts: string[] = [];
  if (p.minSampleSize !== undefined) parts.push(`minSampleSize=${p.minSampleSize}`);
  if (p.cooldownMinutes !== undefined) parts.push(`cooldown=${p.cooldownMinutes}'`);
  const body = parts.join(", ");
  return w(
    lang,
    `Cấu hình tham số kiểm tra ngưỡng NG #${p.thresholdId}: ${body}.`,
    `Configure inspection params for NG threshold #${p.thresholdId}: ${body}.`,
    `配置 NG 阈值 #${p.thresholdId} 的检测参数：${body}。`,
  );
}

async function previewConfigureInspection(p: ConfigureInspectionParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const current = await getNgThreshold(p.thresholdId);
  if (!current) {
    warnings.push(w(ctx.lang, `Không tìm thấy ngưỡng NG #${p.thresholdId}.`, `NG threshold #${p.thresholdId} not found.`, `未找到 NG 阈值 #${p.thresholdId}。`));
    return { entityType: "ng_rate_threshold", entityId: p.thresholdId, changes: [], warnings, humanSummary: summarizeConfigureInspection(p, ctx.lang) };
  }
  if (p.minSampleSize !== undefined && p.minSampleSize < 10) {
    warnings.push(w(
      ctx.lang,
      `Cảnh báo: minSampleSize=${p.minSampleSize} nhỏ — có thể gây cảnh báo sai khi ít mẫu.`,
      `Warning: minSampleSize=${p.minSampleSize} is low — may cause false alarms on small samples.`,
      `警告：minSampleSize=${p.minSampleSize} 偏小 — 样本少时可能误报。`,
    ));
  }
  const changes: AuditChangeField[] = [];
  if (p.minSampleSize !== undefined && current.minSampleSize !== p.minSampleSize) {
    changes.push({ field: "minSampleSize", oldValue: current.minSampleSize ?? null, newValue: p.minSampleSize, displayName: "Số mẫu tối thiểu" });
  }
  if (p.cooldownMinutes !== undefined && current.cooldownMinutes !== p.cooldownMinutes) {
    changes.push({ field: "cooldownMinutes", oldValue: current.cooldownMinutes ?? null, newValue: p.cooldownMinutes, displayName: "Cooldown (phút)" });
  }
  return {
    entityType: "ng_rate_threshold",
    entityId: current.id,
    entityName: current.name,
    changes,
    warnings,
    humanSummary: summarizeConfigureInspection(p, ctx.lang),
  };
}

export const configureInspectionParamTool: Tool<ConfigureInspectionParams, { ok: boolean }> = {
  name: "configure_inspection_param",
  description:
    "Cấu hình tham số kiểm tra (số mẫu tối thiểu / cooldown) cho một bản ghi ngưỡng NG. " +
    "WRITE-ACTION (kỹ thuật): cần quyền settings_alerts/canEdit + xác nhận của người dùng.",
  parameters: configureInspectionParams,
  triggers: [
    "cấu hình tham số kiểm tra", "đặt số mẫu", "đặt cooldown", "min sample",
    "configure inspection param", "set sample size", "set cooldown", "配置检测参数",
  ],
  kind: "write",
  requiredPermission: { module: "settings_alerts", action: "canEdit" },
  summarize: summarizeConfigureInspection,
  preview: previewConfigureInspection,
  execute: async (p, ctx) => {
    const db = await getDb();
    if (!db) {
      return { type: "action_result", title: "DB không khả dụng", data: { ok: false }, textSummary: summarizeConfigureInspection(p, ctx.lang), note: "DB_UNAVAILABLE" };
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (p.minSampleSize !== undefined) patch.minSampleSize = p.minSampleSize;
    if (p.cooldownMinutes !== undefined) patch.cooldownMinutes = p.cooldownMinutes;
    await db.update(mqttNgRateThresholds).set(patch as any).where(eq(mqttNgRateThresholds.id, p.thresholdId));
    return {
      type: "action_result",
      title: w(ctx.lang, `Đã cấu hình tham số kiểm tra ngưỡng NG #${p.thresholdId}`, `Configured inspection params for NG threshold #${p.thresholdId}`, `已配置 NG 阈值 #${p.thresholdId} 的检测参数`),
      data: { ok: true },
      textSummary: summarizeConfigureInspection(p, ctx.lang),
    };
  },
};

registerTool(configureInspectionParamTool);

// ─── create_ng_threshold (settings_alerts/canCreate) ──────────────────────────
// VERB: setup / add-new — tạo một bản ghi cấu hình ngưỡng NG mới cho một station
// (tuỳ chọn gắn machine / measurement point / product model).

const createNgThresholdParams = z
  .object({
    stationId: z.number().int().positive(),
    machineId: z.number().int().positive().nullable().optional(),
    measurementPointId: z.number().int().positive().nullable().optional(),
    productModelId: z.number().int().positive().nullable().optional(),
    name: z.string().min(1).max(255),
    description: z.string().max(1000).optional(),
    warningThreshold: z.number().min(0).max(100),
    criticalThreshold: z.number().min(0).max(100),
    minSampleSize: z.number().int().min(1).max(100000).default(10),
    cooldownMinutes: z.number().int().min(1).max(1440).default(30),
  })
  .strict();

type CreateNgThresholdParams = z.infer<typeof createNgThresholdParams>;

function summarizeCreateNg(p: CreateNgThresholdParams, lang: ToolLang): string {
  const body = `warning=${p.warningThreshold}%, critical=${p.criticalThreshold}%`;
  return w(
    lang,
    `Tạo ngưỡng NG "${p.name}" cho trạm #${p.stationId} [${body}].`,
    `Create NG threshold "${p.name}" for station #${p.stationId} [${body}].`,
    `为站点 #${p.stationId} 创建 NG 阈值 “${p.name}” [${body}]。`,
  );
}

async function previewCreateNg(p: CreateNgThresholdParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  if (p.criticalThreshold < p.warningThreshold) {
    warnings.push(w(
      ctx.lang,
      `Cảnh báo: ngưỡng nghiêm trọng (${p.criticalThreshold}%) < ngưỡng cảnh báo (${p.warningThreshold}%).`,
      `Warning: critical threshold (${p.criticalThreshold}%) < warning threshold (${p.warningThreshold}%).`,
      `警告：严重阈值 (${p.criticalThreshold}%) < 警告阈值 (${p.warningThreshold}%)。`,
    ));
  }
  const changes: AuditChangeField[] = [
    { field: "name", oldValue: null, newValue: p.name, displayName: "Tên" },
    { field: "stationId", oldValue: null, newValue: p.stationId, displayName: "Trạm" },
    { field: "warningThreshold", oldValue: null, newValue: String(p.warningThreshold), displayName: "Ngưỡng cảnh báo (%)" },
    { field: "criticalThreshold", oldValue: null, newValue: String(p.criticalThreshold), displayName: "Ngưỡng nghiêm trọng (%)" },
  ];
  return {
    entityType: "ng_rate_threshold",
    entityName: p.name,
    changes,
    warnings,
    humanSummary: summarizeCreateNg(p, ctx.lang),
  };
}

export const createNgThresholdTool: Tool<CreateNgThresholdParams, { id: number | null }> = {
  name: "create_ng_threshold",
  description:
    "Tạo (thêm mới) một bản ghi cấu hình ngưỡng NG rate cho một trạm. " +
    "WRITE-ACTION (kỹ thuật): cần quyền settings_alerts/canCreate + xác nhận của người dùng.",
  parameters: createNgThresholdParams,
  triggers: [
    "tạo ngưỡng ng", "thêm ngưỡng ng", "thêm mới ngưỡng", "tạo cấu hình ngưỡng",
    "create ng threshold", "add ng threshold", "new threshold", "创建ng阈值",
  ],
  kind: "write",
  requiredPermission: { module: "settings_alerts", action: "canCreate" },
  summarize: summarizeCreateNg,
  preview: previewCreateNg,
  execute: async (p, ctx) => {
    const db = await getDb();
    if (!db) {
      return { type: "action_result", title: "DB không khả dụng", data: { id: null }, textSummary: summarizeCreateNg(p, ctx.lang), note: "DB_UNAVAILABLE" };
    }
    const [row] = await db
      .insert(mqttNgRateThresholds)
      .values({
        stationId: p.stationId,
        machineId: p.machineId ?? null,
        measurementPointId: p.measurementPointId ?? null,
        productModelId: p.productModelId ?? null,
        name: p.name,
        description: p.description,
        warningThreshold: String(p.warningThreshold),
        criticalThreshold: String(p.criticalThreshold),
        minSampleSize: p.minSampleSize,
        cooldownMinutes: p.cooldownMinutes,
        createdBy: ctx.user.id,
      } as any)
      .returning({ id: mqttNgRateThresholds.id });
    const id = row?.id ?? null;
    return {
      type: "action_result",
      title: w(ctx.lang, `Đã tạo ngưỡng NG "${p.name}" (#${id})`, `Created NG threshold "${p.name}" (#${id})`, `已创建 NG 阈值 “${p.name}” (#${id})`),
      data: { id },
      textSummary: summarizeCreateNg(p, ctx.lang),
    };
  },
};

registerTool(createNgThresholdTool);

// ─── update_product_quality_target (settings_products/canEdit) ────────────────
// VERB: update — cập nhật mục tiêu chất lượng (FPY %) của một product model:
// targetYieldRate / minYieldRate.

const updateQualityTargetParams = z
  .object({
    productModelId: z.number().int().positive(),
    targetYieldRate: z.number().min(0).max(100).nullable().optional(),
    minYieldRate: z.number().min(0).max(100).nullable().optional(),
  })
  .strict()
  .refine((p) => p.targetYieldRate !== undefined || p.minYieldRate !== undefined, {
    message: "Cần ít nhất targetYieldRate hoặc minYieldRate.",
  });

type UpdateQualityTargetParams = z.infer<typeof updateQualityTargetParams>;

function summarizeUpdateQuality(p: UpdateQualityTargetParams, lang: ToolLang): string {
  const parts: string[] = [];
  if (p.targetYieldRate !== undefined) parts.push(`target FPY=${fmt(p.targetYieldRate)}%`);
  if (p.minYieldRate !== undefined) parts.push(`min FPY=${fmt(p.minYieldRate)}%`);
  const body = parts.join(", ");
  return w(
    lang,
    `Cập nhật mục tiêu chất lượng mẫu SP #${p.productModelId}: ${body}.`,
    `Update quality targets for product model #${p.productModelId}: ${body}.`,
    `更新产品型号 #${p.productModelId} 的质量目标：${body}。`,
  );
}

async function getProductModel(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(productModels).where(eq(productModels.id, id)).limit(1);
  return row ?? null;
}

async function previewUpdateQuality(p: UpdateQualityTargetParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const current = await getProductModel(p.productModelId);
  if (!current) {
    warnings.push(w(ctx.lang, `Không tìm thấy mẫu SP #${p.productModelId}.`, `Product model #${p.productModelId} not found.`, `未找到产品型号 #${p.productModelId}。`));
    return { entityType: "product_model", entityId: p.productModelId, changes: [], warnings, humanSummary: summarizeUpdateQuality(p, ctx.lang) };
  }
  // Cross-field sanity: min must be <= target when both end up set.
  const effTarget = p.targetYieldRate !== undefined ? p.targetYieldRate : (current.targetYieldRate != null ? Number(current.targetYieldRate) : null);
  const effMin = p.minYieldRate !== undefined ? p.minYieldRate : (current.minYieldRate != null ? Number(current.minYieldRate) : null);
  if (effTarget != null && effMin != null && effMin > effTarget) {
    warnings.push(w(
      ctx.lang,
      `Cảnh báo: min FPY (${effMin}%) > target FPY (${effTarget}%).`,
      `Warning: min FPY (${effMin}%) > target FPY (${effTarget}%).`,
      `警告：最低 FPY (${effMin}%) > 目标 FPY (${effTarget}%)。`,
    ));
  }
  const changes: AuditChangeField[] = [];
  if (p.targetYieldRate !== undefined && !decEq(current.targetYieldRate as string | null, p.targetYieldRate ?? NaN)) {
    changes.push({ field: "targetYieldRate", oldValue: current.targetYieldRate ?? null, newValue: p.targetYieldRate == null ? null : String(p.targetYieldRate), displayName: "Target FPY (%)" });
  }
  if (p.minYieldRate !== undefined && !decEq(current.minYieldRate as string | null, p.minYieldRate ?? NaN)) {
    changes.push({ field: "minYieldRate", oldValue: current.minYieldRate ?? null, newValue: p.minYieldRate == null ? null : String(p.minYieldRate), displayName: "Min FPY (%)" });
  }
  return {
    entityType: "product_model",
    entityId: current.id,
    entityName: `${current.code} — ${current.name}`,
    changes,
    warnings,
    humanSummary: summarizeUpdateQuality(p, ctx.lang),
  };
}

export const updateProductQualityTargetTool: Tool<UpdateQualityTargetParams, { ok: boolean }> = {
  name: "update_product_quality_target",
  description:
    "Cập nhật mục tiêu chất lượng (target/min FPY %) cho một mẫu sản phẩm (product model). " +
    "WRITE-ACTION (kỹ thuật): cần quyền settings_products/canEdit + xác nhận của người dùng.",
  parameters: updateQualityTargetParams,
  triggers: [
    "cập nhật mục tiêu chất lượng", "đặt target yield", "đặt min yield", "mục tiêu fpy",
    "update quality target", "set target yield", "set min yield", "更新质量目标",
  ],
  kind: "write",
  requiredPermission: { module: "settings_products", action: "canEdit" },
  summarize: summarizeUpdateQuality,
  preview: previewUpdateQuality,
  execute: async (p, ctx) => {
    const db = await getDb();
    if (!db) {
      return { type: "action_result", title: "DB không khả dụng", data: { ok: false }, textSummary: summarizeUpdateQuality(p, ctx.lang), note: "DB_UNAVAILABLE" };
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (p.targetYieldRate !== undefined) patch.targetYieldRate = p.targetYieldRate == null ? null : String(p.targetYieldRate);
    if (p.minYieldRate !== undefined) patch.minYieldRate = p.minYieldRate == null ? null : String(p.minYieldRate);
    await db.update(productModels).set(patch as any).where(eq(productModels.id, p.productModelId));
    return {
      type: "action_result",
      title: w(ctx.lang, `Đã cập nhật mục tiêu chất lượng mẫu SP #${p.productModelId}`, `Updated quality targets for product model #${p.productModelId}`, `已更新产品型号 #${p.productModelId} 的质量目标`),
      data: { ok: true },
      textSummary: summarizeUpdateQuality(p, ctx.lang),
    };
  },
};

registerTool(updateProductQualityTargetTool);
