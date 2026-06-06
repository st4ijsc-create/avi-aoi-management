/**
 * Sprint F4a — AI Local Tools: Machine Control write-handlers (OT, HITL-gated).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (F4a — DRY-RUN):
 *   - Every tool here is kind:'write' → routed through the HITL flow
 *     (proposeAction → confirmAction; RBAC #1 + #2 + audit). The AI can ONLY
 *     propose; a human must confirm.
 *   - preview() READS ONLY (adapter active? tag writable? recipe exists?) and
 *     NEVER calls the dispatcher or driver.writeTags.
 *   - execute() calls commandDispatcher.dispatch(), which in F4a is DRY-RUN
 *     (OT_CONTROL_ENABLED=false → simulated, no device write).
 *   - requiredPermission maps to module 'machine_control':
 *       canCreate = high-risk command (start/stop/pause/reset/select_recipe/download_job)
 *       canEdit   = parameter / acknowledge (set_machine_param / acknowledge_machine_alarm)
 *     (Phương án A: execute→canCreate; lõi RBAC/checkPermission KHÔNG đổi.)
 * ════════════════════════════════════════════════════════════════════════════
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { deviceAdapters, deviceTags } from "../../../../drizzle/schema";
import { getActiveRecipe } from "../../../db/machineRecipe";
import { dispatch, type DispatchInput } from "../../ot/commandDispatcher";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolExecuteResult,
  type ToolLang,
} from "../toolRegistry";

// ─── Shared resolution helpers (READ-ONLY — safe for preview) ─────────────────

interface ResolvedTarget {
  adapterId?: number;
  adapterEnabled: boolean;
  warnings: string[];
}

/** Resolve the enabled adapter for a machine + check a tag is writable. READ-ONLY. */
async function resolveTarget(machineId: number, tagKey: string | null, lang: ToolLang): Promise<ResolvedTarget> {
  const warnings: string[] = [];
  const db = await getDb();
  if (!db) {
    warnings.push(w(lang, "DB không khả dụng.", "Database unavailable.", "数据库不可用。"));
    return { adapterEnabled: false, warnings };
  }
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.machineId, machineId)).limit(1);
  if (!adapter) {
    warnings.push(w(lang, `Không tìm thấy adapter OT cho máy #${machineId}.`, `No OT adapter found for machine #${machineId}.`, `未找到机器 #${machineId} 的 OT 适配器。`));
    return { adapterEnabled: false, warnings };
  }
  if (!adapter.isEnabled) {
    warnings.push(w(lang, `Adapter "${adapter.code}" đang TẮT.`, `Adapter "${adapter.code}" is DISABLED.`, `适配器 "${adapter.code}" 已禁用。`));
  }
  if (tagKey) {
    const [tag] = await db
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, adapter.id), eq(deviceTags.tagKey, tagKey)))
      .limit(1);
    if (!tag) {
      warnings.push(w(lang, `Không tìm thấy tag "${tagKey}".`, `Tag "${tagKey}" not found.`, `未找到标签 "${tagKey}"。`));
    } else if (tag.writable !== true) {
      warnings.push(w(lang, `Tag "${tagKey}" KHÔNG ghi được (writable=false) — lệnh sẽ bị từ chối.`, `Tag "${tagKey}" is NOT writable — the command will be rejected.`, `标签 "${tagKey}" 不可写 — 命令将被拒绝。`));
    }
  }
  return { adapterId: adapter.id, adapterEnabled: adapter.isEnabled, warnings };
}

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

/** Build the dispatcher call from a confirmed exec context + resolved writes. */
async function runDispatch(
  ctx: ToolExecContext,
  args: { machineId: number; adapterId: number; commandType: string; writes: Array<{ tagKey: string; value: unknown }> },
): Promise<ToolExecuteResult> {
  const idempotencyKey = ctx.actionId ?? `mc-${args.machineId}-${args.commandType}-${Date.now()}`;
  const input: DispatchInput = {
    actionId: ctx.actionId,
    adapterId: args.adapterId,
    machineId: args.machineId,
    commandType: args.commandType,
    writes: args.writes,
    confirmedBy: ctx.user.id,
    requestedBy: ctx.user.id,
    lang: ctx.lang,
    idempotencyKey,
  };
  const result = await dispatch(input);
  const title = result.simulated
    ? w(ctx.lang, `[DRY-RUN] Đã mô phỏng lệnh ${args.commandType} cho máy #${args.machineId}`, `[DRY-RUN] Simulated command ${args.commandType} for machine #${args.machineId}`, `[DRY-RUN] 已模拟机器 #${args.machineId} 的命令 ${args.commandType}`)
    : w(ctx.lang, `Lệnh ${args.commandType} cho máy #${args.machineId}: ${result.status}`, `Command ${args.commandType} for machine #${args.machineId}: ${result.status}`, `机器 #${args.machineId} 的命令 ${args.commandType}：${result.status}`);
  return {
    type: "action_result",
    title,
    data: result,
    textSummary: `${args.commandType} → ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
    note: result.ok ? undefined : result.reason,
  };
}

/** Resolve the adapter at execute time (defensive — preview already warned). */
async function adapterIdForMachine(machineId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.machineId, machineId)).limit(1);
  if (!adapter) throw new Error(`No OT adapter for machine #${machineId}`);
  return adapter.id;
}

// ─── Simple lifecycle commands: start / stop / pause / reset ──────────────────
// Each writes a single control tag (default tagKey 'cmd_<verb>'; overridable).

interface LifecycleCfg {
  name: string;
  verb: string;
  defaultTag: string;
  triggers: string[];
  descVi: string;
}

const lifecycle: LifecycleCfg[] = [
  { name: "machine_start", verb: "start", defaultTag: "cmd_start", triggers: ["khởi động máy", "chạy máy", "start machine", "启动机器"], descVi: "khởi động" },
  { name: "machine_stop", verb: "stop", defaultTag: "cmd_stop", triggers: ["dừng máy", "stop machine", "停止机器"], descVi: "dừng" },
  { name: "machine_pause", verb: "pause", defaultTag: "cmd_pause", triggers: ["tạm dừng máy", "pause machine", "暂停机器"], descVi: "tạm dừng" },
  { name: "machine_reset", verb: "reset", defaultTag: "cmd_reset", triggers: ["reset máy", "đặt lại máy", "reset machine", "重置机器"], descVi: "đặt lại (reset)" },
];

for (const cfg of lifecycle) {
  const params = z
    .object({
      machineId: z.number().int().positive(),
      tagKey: z.string().min(1).max(128).optional(),
    })
    .strict();
  type P = z.infer<typeof params>;

  const summarize = (p: P, lang: ToolLang) =>
    w(lang, `Gửi lệnh ${cfg.descVi} máy #${p.machineId}.`, `Send ${cfg.verb} command to machine #${p.machineId}.`, `向机器 #${p.machineId} 发送 ${cfg.verb} 命令。`);

  const tool: Tool<P, unknown> = {
    name: cfg.name,
    description: `WRITE-ACTION (OT, HITL): gửi lệnh ${cfg.descVi} tới máy qua command dispatcher (F4a: DRY-RUN). Cần quyền machine_control/canCreate + xác nhận của người dùng.`,
    parameters: params,
    triggers: cfg.triggers,
    kind: "write",
    requiredPermission: { module: "machine_control", action: "canCreate" },
    summarize,
    preview: async (p, ctx): Promise<ActionPreview> => {
      const tagKey = p.tagKey ?? cfg.defaultTag;
      const r = await resolveTarget(p.machineId, tagKey, ctx.lang);
      return {
        entityType: "machine",
        entityId: p.machineId,
        changes: [{ field: cfg.verb, oldValue: null, newValue: tagKey, displayName: cfg.verb }],
        warnings: r.warnings,
        humanSummary: summarize(p, ctx.lang),
      };
    },
    execute: async (p, ctx) => {
      const tagKey = p.tagKey ?? cfg.defaultTag;
      const adapterId = await adapterIdForMachine(p.machineId);
      return runDispatch(ctx, { machineId: p.machineId, adapterId, commandType: cfg.verb, writes: [{ tagKey, value: true }] });
    },
  };
  registerTool(tool);
}

// ─── select_recipe (canCreate) ───────────────────────────────────────────────

const selectRecipeParams = z
  .object({
    machineId: z.number().int().positive(),
    recipeCode: z.string().min(1).max(64),
    tagKey: z.string().min(1).max(128).optional(),
  })
  .strict();
type SelectRecipeParams = z.infer<typeof selectRecipeParams>;

const summarizeSelectRecipe = (p: SelectRecipeParams, lang: ToolLang) =>
  w(lang, `Chọn recipe "${p.recipeCode}" cho máy #${p.machineId}.`, `Select recipe "${p.recipeCode}" for machine #${p.machineId}.`, `为机器 #${p.machineId} 选择配方 "${p.recipeCode}"。`);

registerTool<SelectRecipeParams, unknown>({
  name: "select_recipe",
  description: "WRITE-ACTION (OT, HITL): chọn/nạp recipe đang active cho máy (F4a: DRY-RUN). Cần machine_control/canCreate + xác nhận.",
  parameters: selectRecipeParams,
  triggers: ["chọn recipe", "nạp recipe", "select recipe", "load recipe", "选择配方"],
  kind: "write",
  requiredPermission: { module: "machine_control", action: "canCreate" },
  summarize: summarizeSelectRecipe,
  preview: async (p, ctx): Promise<ActionPreview> => {
    const tagKey = p.tagKey ?? "recipe_select";
    const r = await resolveTarget(p.machineId, tagKey, ctx.lang);
    const recipe = await getActiveRecipe({ code: p.recipeCode });
    if (!recipe) {
      r.warnings.push(w(ctx.lang, `Không tìm thấy recipe active "${p.recipeCode}".`, `No active recipe "${p.recipeCode}".`, `未找到激活配方 "${p.recipeCode}"。`));
    }
    return {
      entityType: "machine",
      entityId: p.machineId,
      changes: [{ field: "recipe", oldValue: null, newValue: p.recipeCode, displayName: "Recipe" }],
      warnings: r.warnings,
      humanSummary: summarizeSelectRecipe(p, ctx.lang),
    };
  },
  execute: async (p, ctx) => {
    const tagKey = p.tagKey ?? "recipe_select";
    const adapterId = await adapterIdForMachine(p.machineId);
    const recipe = await getActiveRecipe({ code: p.recipeCode });
    return runDispatch(ctx, {
      machineId: p.machineId,
      adapterId,
      commandType: "select_recipe",
      writes: [{ tagKey, value: recipe?.version ?? p.recipeCode }],
    });
  },
});

// ─── download_job (canCreate) ────────────────────────────────────────────────

const downloadJobParams = z
  .object({
    machineId: z.number().int().positive(),
    jobId: z.string().min(1).max(128),
    tagKey: z.string().min(1).max(128).optional(),
  })
  .strict();
type DownloadJobParams = z.infer<typeof downloadJobParams>;

const summarizeDownloadJob = (p: DownloadJobParams, lang: ToolLang) =>
  w(lang, `Tải job "${p.jobId}" xuống máy #${p.machineId}.`, `Download job "${p.jobId}" to machine #${p.machineId}.`, `将作业 "${p.jobId}" 下载到机器 #${p.machineId}。`);

registerTool<DownloadJobParams, unknown>({
  name: "download_job",
  description: "WRITE-ACTION (OT, HITL): tải job/chương trình xuống máy (F4a: DRY-RUN). Cần machine_control/canCreate + xác nhận.",
  parameters: downloadJobParams,
  triggers: ["tải job", "download job", "nạp chương trình", "下载作业"],
  kind: "write",
  requiredPermission: { module: "machine_control", action: "canCreate" },
  summarize: summarizeDownloadJob,
  preview: async (p, ctx): Promise<ActionPreview> => {
    const tagKey = p.tagKey ?? "job_download";
    const r = await resolveTarget(p.machineId, tagKey, ctx.lang);
    return {
      entityType: "machine",
      entityId: p.machineId,
      changes: [{ field: "job", oldValue: null, newValue: p.jobId, displayName: "Job" }],
      warnings: r.warnings,
      humanSummary: summarizeDownloadJob(p, ctx.lang),
    };
  },
  execute: async (p, ctx) => {
    const tagKey = p.tagKey ?? "job_download";
    const adapterId = await adapterIdForMachine(p.machineId);
    return runDispatch(ctx, { machineId: p.machineId, adapterId, commandType: "download_job", writes: [{ tagKey, value: p.jobId }] });
  },
});

// ─── set_machine_param (canEdit) ─────────────────────────────────────────────

const setParamParams = z
  .object({
    machineId: z.number().int().positive(),
    tagKey: z.string().min(1).max(128),
    value: z.union([z.number(), z.string(), z.boolean()]),
  })
  .strict();
type SetParamParams = z.infer<typeof setParamParams>;

const summarizeSetParam = (p: SetParamParams, lang: ToolLang) =>
  w(lang, `Đặt tham số "${p.tagKey}"=${String(p.value)} cho máy #${p.machineId}.`, `Set parameter "${p.tagKey}"=${String(p.value)} on machine #${p.machineId}.`, `将机器 #${p.machineId} 的参数 "${p.tagKey}" 设为 ${String(p.value)}。`);

registerTool<SetParamParams, unknown>({
  name: "set_machine_param",
  description: "WRITE-ACTION (OT, HITL): đặt một tham số (tag ghi được) trên máy (F4a: DRY-RUN). Cần machine_control/canEdit + xác nhận.",
  parameters: setParamParams,
  triggers: ["đặt tham số máy", "set machine param", "set parameter", "设置机器参数"],
  kind: "write",
  requiredPermission: { module: "machine_control", action: "canEdit" },
  summarize: summarizeSetParam,
  preview: async (p, ctx): Promise<ActionPreview> => {
    const r = await resolveTarget(p.machineId, p.tagKey, ctx.lang);
    return {
      entityType: "machine",
      entityId: p.machineId,
      changes: [{ field: p.tagKey, oldValue: null, newValue: String(p.value), displayName: p.tagKey }],
      warnings: r.warnings,
      humanSummary: summarizeSetParam(p, ctx.lang),
    };
  },
  execute: async (p, ctx) => {
    const adapterId = await adapterIdForMachine(p.machineId);
    return runDispatch(ctx, { machineId: p.machineId, adapterId, commandType: "set_param", writes: [{ tagKey: p.tagKey, value: p.value }] });
  },
});

// ─── acknowledge_machine_alarm (canEdit) ─────────────────────────────────────

const ackAlarmParams = z
  .object({
    machineId: z.number().int().positive(),
    tagKey: z.string().min(1).max(128).optional(),
  })
  .strict();
type AckAlarmParams = z.infer<typeof ackAlarmParams>;

const summarizeAckAlarm = (p: AckAlarmParams, lang: ToolLang) =>
  w(lang, `Xác nhận (ack) cảnh báo máy #${p.machineId}.`, `Acknowledge alarm on machine #${p.machineId}.`, `确认机器 #${p.machineId} 的报警。`);

registerTool<AckAlarmParams, unknown>({
  name: "acknowledge_machine_alarm",
  description: "WRITE-ACTION (OT, HITL): xác nhận (ack) cảnh báo trên máy (F4a: DRY-RUN). Cần machine_control/canEdit + xác nhận.",
  parameters: ackAlarmParams,
  triggers: ["ack cảnh báo máy", "xác nhận cảnh báo máy", "acknowledge alarm", "确认机器报警"],
  kind: "write",
  requiredPermission: { module: "machine_control", action: "canEdit" },
  summarize: summarizeAckAlarm,
  preview: async (p, ctx): Promise<ActionPreview> => {
    const tagKey = p.tagKey ?? "alarm_ack";
    const r = await resolveTarget(p.machineId, tagKey, ctx.lang);
    return {
      entityType: "machine",
      entityId: p.machineId,
      changes: [{ field: "alarm_ack", oldValue: null, newValue: tagKey, displayName: "Ack" }],
      warnings: r.warnings,
      humanSummary: summarizeAckAlarm(p, ctx.lang),
    };
  },
  execute: async (p, ctx) => {
    const tagKey = p.tagKey ?? "alarm_ack";
    const adapterId = await adapterIdForMachine(p.machineId);
    return runDispatch(ctx, { machineId: p.machineId, adapterId, commandType: "ack_alarm", writes: [{ tagKey, value: true }] });
  },
});
