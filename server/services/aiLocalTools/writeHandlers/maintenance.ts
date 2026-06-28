/**
 * AI Local Tools — Write Handler: MAINTENANCE (RCA Copilot fix · LUỒNG ③ + E.0)
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (HITL — mirrors engineering.ts / machineControl.ts):
 *   - kind:'write' → routed ONLY through the HITL lifecycle
 *     (aiCopilotActions.proposeAction → confirmAction). The AI can ONLY propose;
 *     a human must confirm. No code path here mutates without a prior confirm.
 *   - preview() READS ONLY (resolves machineCode, shows the work-order that WILL
 *     be created) and NEVER writes to the DB.
 *   - execute() inserts via Drizzle using ctx.user.id (no createdBy column → the
 *     opener is the confirming user; assignedTo optional). Args come from the DB
 *     row (threaded by confirmAction), never the client.
 *   - zod .strict() schema with realistic bounds/enums (priority 1–5, type enum).
 *
 * REAL ENTITY (verified drizzle/schema/mes.ts:223):
 *   - maintenance_work_orders — workOrderNumber (unique, generated here),
 *       machineId (NOT NULL), machineCode (resolved), type (workOrderTypeEnum),
 *       status (default OPEN), trigger (default MANUAL → AI_AGENT not in enum so
 *       we use MANUAL), priority (int 1=highest), title (NOT NULL), description,
 *       assignedTo? (FK users.id). openedAt defaults now.
 *
 * RBAC (module verified in permissionsRouter.ts):
 *   - module 'machine_monitoring' / action 'canCreate' on the 'machine_downtime'
 *     surface. This is the closest existing module that covers creating a
 *     downtime/maintenance record for a machine. (No dedicated 'maintenance'
 *     module exists; machine_downtime/canCreate is the fitting grant.)
 * ════════════════════════════════════════════════════════════════════════════
 */

import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { maintenanceWorkOrders, machines } from "../../../../drizzle/schema";
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

// Work-order TYPE — subset of workOrderTypeEnum relevant to an RCA-driven fix.
const WORK_ORDER_TYPES = ["CORRECTIVE", "PREVENTIVE", "PREDICTIVE", "INSPECTION"] as const;

const createMaintenanceWorkOrderParams = z
  .object({
    machineId: z.number().int().positive(),
    title: z.string().min(3).max(256),
    description: z.string().max(4000).optional(),
    // 1 = highest priority … 5 = lowest (matches the int column; default 3).
    priority: z.number().int().min(1).max(5).default(3),
    type: z.enum(WORK_ORDER_TYPES).default("CORRECTIVE"),
    // Optional assignee (FK users.id) — left to the technician if omitted.
    assignedTo: z.number().int().positive().nullable().optional(),
  })
  .strict();

export type CreateMaintenanceWorkOrderParams = z.infer<typeof createMaintenanceWorkOrderParams>;

function summarizeCreateWorkOrder(p: CreateMaintenanceWorkOrderParams, lang: ToolLang): string {
  return w(
    lang,
    `Tạo lệnh bảo trì (${p.type}, ưu tiên ${p.priority}) cho máy #${p.machineId}: "${p.title}".`,
    `Create maintenance work-order (${p.type}, priority ${p.priority}) for machine #${p.machineId}: "${p.title}".`,
    `为机器 #${p.machineId} 创建维护工单（${p.type}，优先级 ${p.priority}）：“${p.title}”。`,
  );
}

/** READ-ONLY: resolve a machine row (code + existence). Safe for preview. */
async function getMachine(id: number) {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db.select().from(machines).where(eq(machines.id, id)).limit(1);
  return row ?? null;
}

/** Generate a unique-enough work-order number (WO-<machineId>-<ts>-<rand>). */
function buildWorkOrderNumber(machineId: number): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WO-${machineId}-${Date.now()}-${rand}`;
}

async function previewCreateWorkOrder(
  p: CreateMaintenanceWorkOrderParams,
  ctx: ToolExecContext,
): Promise<ActionPreview> {
  const warnings: string[] = [];
  const machine = await getMachine(p.machineId);
  if (!machine) {
    warnings.push(w(ctx.lang, `Không tìm thấy máy #${p.machineId}.`, `Machine #${p.machineId} not found.`, `未找到机器 #${p.machineId}。`));
  }
  if (p.priority <= 2) {
    warnings.push(w(
      ctx.lang,
      `Ưu tiên cao (${p.priority}) — lệnh bảo trì sẽ được xếp trước.`,
      `High priority (${p.priority}) — this work-order will be prioritized.`,
      `高优先级 (${p.priority}) — 此工单将被优先处理。`,
    ));
  }

  const changes: AuditChangeField[] = [
    { field: "title", oldValue: null, newValue: p.title, displayName: w(ctx.lang, "Tiêu đề", "Title", "标题") },
    { field: "machineId", oldValue: null, newValue: p.machineId, displayName: w(ctx.lang, "Máy", "Machine", "机器") },
    { field: "type", oldValue: null, newValue: p.type, displayName: w(ctx.lang, "Loại", "Type", "类型") },
    { field: "priority", oldValue: null, newValue: p.priority, displayName: w(ctx.lang, "Ưu tiên", "Priority", "优先级") },
  ];
  if (p.description) {
    changes.push({ field: "description", oldValue: null, newValue: p.description, displayName: w(ctx.lang, "Mô tả", "Description", "描述") });
  }
  if (p.assignedTo != null) {
    changes.push({ field: "assignedTo", oldValue: null, newValue: p.assignedTo, displayName: w(ctx.lang, "Giao cho", "Assigned to", "指派给") });
  }

  return {
    entityType: "maintenance_work_order",
    entityName: machine ? `${machine.code} — ${p.title}` : p.title,
    changes,
    warnings,
    humanSummary: summarizeCreateWorkOrder(p, ctx.lang),
  };
}

export const createMaintenanceWorkOrderTool: Tool<CreateMaintenanceWorkOrderParams, { id: number | null }> = {
  name: "create_maintenance_workorder",
  description:
    "Tạo một lệnh công việc bảo trì (maintenance work-order) cho một máy. " +
    "WRITE-ACTION: cần quyền machine_monitoring/canCreate (machine_downtime) + xác nhận của người dùng.",
  parameters: createMaintenanceWorkOrderParams,
  triggers: [
    "tạo lệnh bảo trì", "lệnh công việc bảo trì", "tạo work order", "mở work order",
    "create maintenance work order", "create work order", "maintenance workorder", "创建维护工单",
  ],
  kind: "write",
  requiredPermission: { module: "machine_monitoring", action: "canCreate" },
  summarize: summarizeCreateWorkOrder,
  preview: previewCreateWorkOrder,
  execute: async (p, ctx) => {
    const db = await getDb();
    if (!db) {
      return { type: "action_result", title: "DB không khả dụng", data: { id: null }, textSummary: summarizeCreateWorkOrder(p, ctx.lang), note: "DB_UNAVAILABLE" };
    }
    const machine = await getMachine(p.machineId);
    const [row] = await db
      .insert(maintenanceWorkOrders)
      .values({
        workOrderNumber: buildWorkOrderNumber(p.machineId),
        machineId: p.machineId,
        machineCode: machine?.code ?? null,
        type: p.type,
        status: "OPEN",
        trigger: "MANUAL",
        priority: p.priority,
        title: p.title,
        description: p.description ?? null,
        assignedTo: p.assignedTo ?? null,
      } as any)
      .returning({ id: maintenanceWorkOrders.id });
    const id = row?.id ?? null;
    return {
      type: "action_result",
      title: w(ctx.lang, `Đã tạo lệnh bảo trì #${id} cho máy #${p.machineId}`, `Created maintenance work-order #${id} for machine #${p.machineId}`, `已为机器 #${p.machineId} 创建维护工单 #${id}`),
      data: { id },
      textSummary: summarizeCreateWorkOrder(p, ctx.lang),
    };
  },
};

registerTool(createMaintenanceWorkOrderTool);
