/**
 * Sprint F5a — AI Local Tools: Interlock write-handler (ALERT-ONLY).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - The ONLY interlock tool the AI gets is propose_interlock_rule. There is
 *     NO tool to enable, approve, or trigger a rule — those are human-only
 *     router actions.
 *   - execute() inserts a rule that is ALWAYS enabled=false, approvedBy=null,
 *     requiresHumanConfirm=true. A proposed rule can therefore never auto-act.
 *   - This still goes through the HITL flow (kind:'write' → proposeAction →
 *     confirmAction, RBAC interlock/canCreate). The AI proposes the rule;
 *     a human confirms creating it (still disabled/unapproved).
 *   - preview() is READ-ONLY: it computes a dry-run diff, no DB write.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { getDb } from "../../../db/connection";
import { interlockRules } from "../../../../drizzle/schema";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";

const params = z
  .object({
    name: z.string().min(1).max(255),
    description: z.string().max(2000).optional(),
    scope: z.enum(["line", "station", "machine"]),
    lineId: z.number().int().positive().optional(),
    stationId: z.number().int().positive().optional(),
    machineId: z.number().int().positive().optional(),
    sourceType: z.enum(["spc_violation", "ng_rate", "process_result", "telemetry_tag", "cpk"]),
    sourceKey: z.string().max(128).optional(),
    comparisonOperator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
    threshold: z.number().nullable().optional(),
    windowSeconds: z.number().int().positive().optional(),
    consecutiveCount: z.number().int().positive().optional(),
    action: z.enum(["alert", "block_downstream", "stop_line", "reduce_speed"]),
    cooldownSeconds: z.number().int().min(0).max(86400).optional(),
  })
  .strict();

type Params = z.infer<typeof params>;

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

function summarize(p: Params, lang: ToolLang): string {
  const cond = `${p.sourceType} ${p.comparisonOperator} ${p.threshold ?? "?"}`;
  return w(
    lang,
    `Đề xuất interlock rule "${p.name}" (${p.scope}): khi ${cond} → ${p.action}. Rule sẽ được tạo ở trạng thái TẮT, CHƯA duyệt, cần người xác nhận — F5a KHÔNG ghi lệnh máy.`,
    `Propose interlock rule "${p.name}" (${p.scope}): when ${cond} → ${p.action}. The rule is created DISABLED, UNAPPROVED, human-confirm required — F5a writes NO machine command.`,
    `提议联锁规则 "${p.name}"（${p.scope}）：当 ${cond} → ${p.action}。规则将以禁用、未批准、需人工确认状态创建 — F5a 不向机器写命令。`,
  );
}

async function preview(p: Params, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  if (p.action !== "alert") {
    warnings.push(
      w(
        ctx.lang,
        "Hành động block/stop chỉ là ĐỀ XUẤT cấu hình. F5a KHÔNG ghi lệnh xuống máy; rule mặc định TẮT + CHƯA duyệt + cần xác nhận của con người.",
        "block/stop action is configuration-only. F5a writes NO command to a machine; the rule defaults to DISABLED + UNAPPROVED + human-confirm.",
        "block/stop 仅为配置建议。F5a 不向机器写命令；规则默认禁用、未批准、需人工确认。",
      ),
    );
  }
  return {
    entityType: "interlock_rule",
    entityName: p.name,
    changes: [
      { field: "name", oldValue: null, newValue: p.name, displayName: "Tên" },
      { field: "scope", oldValue: null, newValue: p.scope, displayName: "Phạm vi" },
      { field: "sourceType", oldValue: null, newValue: p.sourceType, displayName: "Nguồn" },
      { field: "comparisonOperator", oldValue: null, newValue: p.comparisonOperator, displayName: "Toán tử" },
      { field: "threshold", oldValue: null, newValue: p.threshold != null ? String(p.threshold) : null, displayName: "Ngưỡng" },
      { field: "action", oldValue: null, newValue: p.action, displayName: "Hành động" },
      { field: "enabled", oldValue: null, newValue: "false", displayName: "Bật" },
      { field: "approvedBy", oldValue: null, newValue: "null", displayName: "Người duyệt" },
      { field: "requiresHumanConfirm", oldValue: null, newValue: "true", displayName: "Cần xác nhận" },
    ],
    warnings,
    humanSummary: summarize(p, ctx.lang),
  };
}

registerTool<Params, { id: number }>({
  name: "propose_interlock_rule",
  description:
    "WRITE-ACTION (HITL): ĐỀ XUẤT tạo một interlock rule. Rule LUÔN được tạo ở trạng thái enabled=false, approvedBy=null, requiresHumanConfirm=true (AN TOÀN). " +
    "AI KHÔNG thể bật/duyệt/kích hoạt rule. F5a là ALERT-ONLY — KHÔNG có đường ghi lệnh xuống máy. Cần quyền interlock/canCreate + xác nhận của người dùng.",
  parameters: params,
  triggers: ["đề xuất interlock", "tạo interlock rule", "propose interlock", "create interlock rule", "联锁规则"],
  kind: "write",
  requiredPermission: { module: "interlock", action: "canCreate" },
  summarize,
  preview,
  execute: async (p, ctx) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    // SAFETY: forced-safe defaults — AI-proposed rules are always inert.
    const [row] = await db
      .insert(interlockRules)
      .values({
        name: p.name,
        description: p.description ?? null,
        scope: p.scope,
        lineId: p.lineId ?? null,
        stationId: p.stationId ?? null,
        machineId: p.machineId ?? null,
        sourceType: p.sourceType,
        sourceKey: p.sourceKey ?? null,
        comparisonOperator: p.comparisonOperator,
        threshold: p.threshold != null ? String(p.threshold) : null,
        windowSeconds: p.windowSeconds ?? null,
        consecutiveCount: p.consecutiveCount ?? null,
        action: p.action,
        cooldownSeconds: p.cooldownSeconds ?? 300,
        enabled: false,
        approvedBy: null,
        approvedAt: null,
        requiresHumanConfirm: true,
        createdBy: ctx.user.id,
      })
      .returning();
    return {
      type: "action_result",
      title: w(ctx.lang, `Đã đề xuất interlock rule "${p.name}" (#${row.id}) — TẮT, chưa duyệt`, `Proposed interlock rule "${p.name}" (#${row.id}) — disabled, unapproved`, `已提议联锁规则 "${p.name}" (#${row.id}) — 禁用、未批准`),
      data: { id: row.id },
      textSummary: summarize(p, ctx.lang),
    };
  },
});
