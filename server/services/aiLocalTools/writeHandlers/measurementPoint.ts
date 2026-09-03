/**
 * AI Local Tools — Write Handlers: Measurement Points (GĐ3a, Nhóm B — medium)
 *
 * Reuses existing DB endpoints (no new business logic, no migration):
 *   create_measurement_point → db.createMeasurementPointDef (productRouters:527)
 *   update_measurement_point → db.updateMeasurementPointDef (productRouters:710,
 *                              snapshots a measurementPointVersions row)
 *
 * NOTE: set_spec_limits (writeHandlers.ts MẪU) covers USL/LSL/Target only;
 * update_measurement_point additionally covers name/unit and reuses the SAME db
 * fn + changedBy audit/versioning.
 *
 * Permission module (VERIFIED in permissionsRouter.ts):
 *   - settings_measurement_points/canCreate (create)
 *   - settings_measurement_points/canEdit   (update)
 */

import { z } from "zod";
import {
  getMeasurementPointDefById,
  getMeasurementPointDefByCode,
  createMeasurementPointDef,
  updateMeasurementPointDef,
} from "../../../db/product";
import { createAuditLog } from "../../../db/system";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";
// Task 8 Khối C — ĐÃ TÌM RA khi vá `touchesLimits`: tool này gọi thẳng
// `updateMeasurementPointDef` (KHÔNG qua `measurementPoint.update` tRPC), nên
// bản vá touchesLimits ở `productRouters.ts` KHÔNG chạm tới nó — trước bản vá
// dưới đây, AI Copilot ghi lowerLimit/upperLimit/nominalValue/unit lên một
// SẢN PHẨM LIVE mà KHÔNG hề qua `assertThresholdEditAllowed`/`resolveThresholdEditGate`
// (0 tham chiếu tới cửa duyệt trong toàn file, trước khi vá). Mirror MẪU
// `set_spec_limits` (`../../writeHandlers.ts`) — cùng gate, cùng khuôn
// "chặn = trả action_result note, KHÔNG throw" (tool HITL, không phải router).
import { resolveThresholdEditGate, type ThresholdGateResult } from "../../thresholdGovernanceService";
import { touchesApprovalLimitFields } from "../../../utils/measurementPointLimitGate";

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

function toStr(n: number | null | undefined): string | undefined {
  return n === null || n === undefined || Number.isNaN(n) ? undefined : String(n);
}

// Map a measurementTypeCode catalog category to the legacy enum value the
// measurement_point_defs.measurementType column requires. Mirrors
// productRouters.mapCatalogCategoryToLegacyType (kept minimal/self-contained).
function legacyTypeFromCode(code: string): "DIMENSION" | "VISUAL" | "ELECTRICAL" | "POSITION" | "COLOR" | "SURFACE" | "OTHER" {
  const c = code.toUpperCase();
  if (c.includes("DIM") || c.includes("GD") || c.includes("GEOM")) return "DIMENSION";
  if (c.includes("ELEC")) return "ELECTRICAL";
  if (c.includes("POS")) return "POSITION";
  if (c.includes("COLOR") || c.includes("COLOUR")) return "COLOR";
  if (c.includes("SURF")) return "SURFACE";
  if (c.includes("VIS")) return "VISUAL";
  return "OTHER";
}

// ── create_measurement_point ─────────────────────────────────────────────────

const createMpParams = z
  .object({
    productModelId: z.number().int().positive(),
    code: z.string().min(1).max(50).regex(/^[A-Za-z0-9_\-]+$/, "Mã chỉ gồm chữ, số, gạch dưới, gạch nối"),
    name: z.string().min(1).max(255),
    measurementTypeCode: z.string().min(3).max(100),
    nominalValue: z.number().nullable().optional(),
    usl: z.number().nullable().optional(),
    lsl: z.number().nullable().optional(),
    positionX: z.number().int().nonnegative().max(100000).optional(),
    positionY: z.number().int().nonnegative().max(100000).optional(),
    radius: z.number().int().nonnegative().max(100000).optional(),
  })
  .strict();

type CreateMpParams = z.infer<typeof createMpParams>;

function summarizeCreateMp(p: CreateMpParams, lang: ToolLang): string {
  const limits = `USL=${p.usl ?? "—"}, LSL=${p.lsl ?? "—"}, Target=${p.nominalValue ?? "—"}`;
  switch (lang) {
    case "en":
      return `Create measurement point "${p.code}" (${p.name}) on product model #${p.productModelId} [${p.measurementTypeCode}; ${limits}].`;
    case "zh":
      return `在产品型号 #${p.productModelId} 上创建测量点 “${p.code}”（${p.name}）[${p.measurementTypeCode}; ${limits}]。`;
    case "vi":
    default:
      return `Tạo điểm đo "${p.code}" (${p.name}) cho mẫu sản phẩm #${p.productModelId} [${p.measurementTypeCode}; ${limits}].`;
  }
}

async function previewCreateMp(p: CreateMpParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  // Duplicate-code check within the same product model.
  const existing = await getMeasurementPointDefByCode(p.productModelId, p.code);
  if (existing) {
    warnings.push(`Mã điểm đo "${p.code}" đã tồn tại cho mẫu sản phẩm #${p.productModelId} (id #${existing.id}).`);
  }
  if (p.usl != null && p.lsl != null && p.usl < p.lsl) {
    warnings.push(`Cảnh báo: USL (${p.usl}) < LSL (${p.lsl}).`);
  }
  const changes: AuditChangeField[] = [
    { field: "code", oldValue: null, newValue: p.code, displayName: "Mã" },
    { field: "name", oldValue: null, newValue: p.name, displayName: "Tên" },
    { field: "measurementTypeCode", oldValue: null, newValue: p.measurementTypeCode, displayName: "Loại đo" },
  ];
  if (p.nominalValue != null) changes.push({ field: "nominalValue", oldValue: null, newValue: toStr(p.nominalValue) ?? null, displayName: "Target" });
  if (p.usl != null) changes.push({ field: "upperLimit", oldValue: null, newValue: toStr(p.usl) ?? null, displayName: "USL" });
  if (p.lsl != null) changes.push({ field: "lowerLimit", oldValue: null, newValue: toStr(p.lsl) ?? null, displayName: "LSL" });
  return {
    entityType: "measurement_point",
    entityName: `${p.code} — ${p.name}`,
    changes,
    warnings,
    humanSummary: summarizeCreateMp(p, ctx.lang),
  };
}

export const createMeasurementPointTool: Tool<CreateMpParams, { id: number }> = {
  name: "create_measurement_point",
  description:
    "Tạo một điểm đo (measurement point) mới cho một mẫu sản phẩm. " +
    "WRITE-ACTION: cần xác nhận của người dùng và quyền tạo điểm đo.",
  parameters: createMpParams,
  triggers: ["tạo điểm đo", "thêm điểm đo", "create measurement point", "add measurement point", "创建测量点"],
  kind: "write",
  requiredPermission: { module: "settings_measurement_points", action: "canCreate" },
  summarize: summarizeCreateMp,
  preview: previewCreateMp,
  execute: async (p, ctx) => {
    const id = await createMeasurementPointDef({
      productModelId: p.productModelId,
      code: p.code,
      name: p.name,
      measurementTypeCode: p.measurementTypeCode,
      measurementType: legacyTypeFromCode(p.measurementTypeCode),
      nominalValue: toStr(p.nominalValue),
      upperLimit: toStr(p.usl),
      lowerLimit: toStr(p.lsl),
      positionX: p.positionX ?? 0,
      positionY: p.positionY ?? 0,
      radius: p.radius,
    } as any);
    void ctx;
    return {
      type: "action_result",
      title: `Đã tạo điểm đo "${p.code}" (#${id})`,
      data: { id },
      textSummary: summarizeCreateMp(p, ctx.lang),
    };
  },
};

registerTool(createMeasurementPointTool);

// ── update_measurement_point ─────────────────────────────────────────────────

const updateMpParams = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(255).optional(),
    unit: z.string().max(50).optional(),
    lowerLimit: z.number().nullable().optional(),
    upperLimit: z.number().nullable().optional(),
    nominalValue: z.number().nullable().optional(),
  })
  .strict()
  .refine(
    (p) => p.name !== undefined || p.unit !== undefined || p.lowerLimit !== undefined || p.upperLimit !== undefined || p.nominalValue !== undefined,
    { message: "Cần ít nhất một trường để cập nhật (name/unit/lowerLimit/upperLimit/nominalValue)." },
  );

type UpdateMpParams = z.infer<typeof updateMpParams>;

function numEq(a: string | null | undefined, b: number | null | undefined): boolean {
  if (b === undefined) return true; // field not being changed
  const an = a == null ? null : Number(a);
  return an === (b ?? null);
}

function summarizeUpdateMp(p: UpdateMpParams, lang: ToolLang): string {
  const parts: string[] = [];
  if (p.name !== undefined) parts.push(`name="${p.name}"`);
  if (p.unit !== undefined) parts.push(`unit="${p.unit}"`);
  if (p.upperLimit !== undefined) parts.push(`USL=${p.upperLimit ?? "—"}`);
  if (p.lowerLimit !== undefined) parts.push(`LSL=${p.lowerLimit ?? "—"}`);
  if (p.nominalValue !== undefined) parts.push(`Target=${p.nominalValue ?? "—"}`);
  const body = parts.join(", ");
  switch (lang) {
    case "en":
      return `Update measurement point #${p.id}: ${body}.`;
    case "zh":
      return `更新测量点 #${p.id}：${body}。`;
    case "vi":
    default:
      return `Cập nhật điểm đo #${p.id}: ${body}.`;
  }
}

async function previewUpdateMp(p: UpdateMpParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const current = await getMeasurementPointDefById(p.id);
  const warnings: string[] = [];
  if (!current) {
    warnings.push(`Không tìm thấy điểm đo #${p.id}.`);
    return { entityType: "measurement_point", entityId: p.id, changes: [], warnings, humanSummary: summarizeUpdateMp(p, ctx.lang) };
  }
  // Resolve effective USL/LSL after change for cross-field sanity.
  const effUsl = p.upperLimit !== undefined ? p.upperLimit : (current.upperLimit != null ? Number(current.upperLimit) : null);
  const effLsl = p.lowerLimit !== undefined ? p.lowerLimit : (current.lowerLimit != null ? Number(current.lowerLimit) : null);
  if (effUsl != null && effLsl != null && effUsl < effLsl) {
    warnings.push(`Cảnh báo: USL (${effUsl}) < LSL (${effLsl}).`);
  }

  const changes: AuditChangeField[] = [];
  if (p.name !== undefined && current.name !== p.name) {
    changes.push({ field: "name", oldValue: current.name ?? null, newValue: p.name, displayName: "Tên" });
  }
  if (p.unit !== undefined && (current as any).unit !== p.unit) {
    changes.push({ field: "unit", oldValue: (current as any).unit ?? null, newValue: p.unit, displayName: "Đơn vị" });
  }
  if (p.upperLimit !== undefined && !numEq(current.upperLimit as string | null, p.upperLimit)) {
    changes.push({ field: "upperLimit", oldValue: current.upperLimit ?? null, newValue: toStr(p.upperLimit) ?? null, displayName: "USL" });
  }
  if (p.lowerLimit !== undefined && !numEq(current.lowerLimit as string | null, p.lowerLimit)) {
    changes.push({ field: "lowerLimit", oldValue: current.lowerLimit ?? null, newValue: toStr(p.lowerLimit) ?? null, displayName: "LSL" });
  }
  if (p.nominalValue !== undefined && !numEq(current.nominalValue as string | null, p.nominalValue)) {
    changes.push({ field: "nominalValue", oldValue: current.nominalValue ?? null, newValue: toStr(p.nominalValue) ?? null, displayName: "Target" });
  }
  // Task 8 Khối C — surface the lifecycle gate in the dry-run (mirror set_spec_limits
  // ở writeHandlers.ts) khi bản vá này chạm giới hạn; execute() là cửa CỨNG.
  if (touchesApprovalLimitFields(p as Record<string, unknown>)) {
    try {
      const gate = await resolveThresholdEditGate(p.id);
      if (gateBlocked(gate)) warnings.push(gateBlockMessage(gate, ctx.lang));
    } catch {
      // gate resolution is best-effort in preview; execute() is the hard gate.
    }
  }
  return {
    entityType: "measurement_point",
    entityId: current.id,
    entityName: `${current.code} — ${current.name}`,
    changes,
    warnings,
    humanSummary: summarizeUpdateMp(p, ctx.lang),
  };
}

export const updateMeasurementPointTool: Tool<UpdateMpParams, { ok: boolean }> = {
  name: "update_measurement_point",
  description:
    "Cập nhật thuộc tính của một điểm đo (tên, đơn vị, USL/LSL/Target). " +
    "WRITE-ACTION: cần xác nhận của người dùng và quyền chỉnh sửa điểm đo.",
  parameters: updateMpParams,
  triggers: ["cập nhật điểm đo", "sửa điểm đo", "update measurement point", "edit measurement point", "更新测量点"],
  kind: "write",
  requiredPermission: { module: "settings_measurement_points", action: "canEdit" },
  summarize: summarizeUpdateMp,
  preview: previewUpdateMp,
  execute: async (p, ctx) => {
    const patch: Record<string, unknown> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.unit !== undefined) patch.unit = p.unit;
    if (p.upperLimit !== undefined) patch.upperLimit = toStr(p.upperLimit);
    if (p.lowerLimit !== undefined) patch.lowerLimit = toStr(p.lowerLimit);
    if (p.nominalValue !== undefined) patch.nominalValue = toStr(p.nominalValue);

    // Task 8 Khối C — HARD gate (mirror set_spec_limits): một sản phẩm live +
    // enforced chặn thay-đổi-giới-hạn trực tiếp, kể cả khi AI Copilot gọi.
    // Trước bản vá: KHÔNG có gate nào ở đây — ghi thẳng luôn.
    const touchesLimits = touchesApprovalLimitFields(patch);
    let gate: ThresholdGateResult | null = null;
    let before: Awaited<ReturnType<typeof getMeasurementPointDefById>> | null = null;
    if (touchesLimits) {
      before = (await getMeasurementPointDefById(p.id)) ?? null;
      gate = await resolveThresholdEditGate(p.id);
      if (gateBlocked(gate)) {
        const msg = gateBlockMessage(gate, ctx.lang);
        return {
          type: "action_result",
          title:
            ctx.lang === "en" ? `Measurement point update blocked (needs approval)`
            : ctx.lang === "zh" ? `测量点更新已阻止（需审批）`
            : `Cập nhật điểm đo bị chặn (cần duyệt)`,
          data: { ok: false },
          textSummary: msg,
          note: msg,
        };
      }
    }

    await updateMeasurementPointDef(p.id, patch as any, { changedBy: ctx.user.id, changeReason: "AI Copilot" });

    // Doc 31 OP2 — mirror set_spec_limits: mọi lần sửa giới hạn trực tiếp (kể
    // cả từ AI Copilot) để lại một hàng audit mang gate decision.
    if (touchesLimits && gate) {
      try {
        await createAuditLog({
          userId: ctx.user.id,
          userName: ctx.user.name ?? undefined,
          action: "threshold.directEdit",
          entityType: "measurement_point_def",
          entityId: p.id,
          entityName: before?.code ?? undefined,
          details: {
            source: "aiCopilot.update_measurement_point",
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
            after: {
              lowerLimit: patch.lowerLimit ?? null,
              upperLimit: patch.upperLimit ?? null,
              nominalValue: patch.nominalValue ?? null,
            },
            changeReason: "AI Copilot",
          },
          status: "success",
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("audit log failed (aiCopilot threshold.directEdit — update_measurement_point)", err);
      }
    }

    return {
      type: "action_result",
      title: `Đã cập nhật điểm đo #${p.id}`,
      data: { ok: true },
      textSummary: summarizeUpdateMp(p, ctx.lang),
    };
  },
};

registerTool(updateMeasurementPointTool);
