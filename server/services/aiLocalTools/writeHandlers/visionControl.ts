/**
 * Doc 24 / Wave-4 — AOI-F: Vision → Control write-tools (OT, HITL-gated).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (identical posture to machineControl.ts — these ONLY add tools, never
 * a new device path):
 *   - Both tools are kind:'write' → the AI/quality-loop can ONLY propose; a human
 *     must confirm (proposeAction → confirmAction; RBAC #1 + #2 + audit).
 *   - preview() is READ-ONLY (adapter enabled? tag writable?) and NEVER calls the
 *     dispatcher or driver.writeTags.
 *   - execute() routes through the SINGLE hardened write path
 *     commandDispatcher.dispatch() with triggeredBy.kind='hitl'. It NEVER calls a
 *     driver directly. dispatch() applies — UNCHANGED — the mode gate
 *     (OT_CONTROL_ENABLED), the C2 commissioning gate (uncommissioned ⇒ simulated),
 *     the tag.writable allowlist, the confirm+owner re-check, idempotency, and the
 *     append-only command_log. This file adds NO gate and relaxes none.
 *   - requiredPermission reuses the EXISTING 'machine_control' RBAC surface:
 *       reject_divert       → canCreate (a physical divert command)
 *       spi_printer_offset  → canEdit   (a process parameter/offset)
 *
 * These are the emission TARGETS of qualityControlProposer (AOI-F): a gated NG /
 * anomaly verdict proposes one of these; nothing actuates until a human confirms,
 * and even then it stays simulated unless the adapter is commissioned AND
 * OT_CONTROL_ENABLED (composes with C2).
 * ════════════════════════════════════════════════════════════════════════════
 */

import { z } from "zod";
import { DbUnavailableError } from "../../../_core/dbErrors";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { deviceAdapters, deviceTags } from "../../../../drizzle/schema";
import { dispatch, type DispatchInput } from "../../ot/commandDispatcher";
import {
  registerTool,
  type ActionPreview,
  type ToolExecContext,
  type ToolExecuteResult,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

// ─── Provenance (carried into the ai_pending_actions row → honest audit) ───────
// Stored in argsJson; surfaced in the confirm preview. Does NOT drive the write —
// only machineId/tag/value do — it is metadata for the human + the audit trail.
const provenanceSchema = z
  .object({
    inspectionId: z.number().int().nullable().optional(),
    machineId: z.number().int().nullable().optional(),
    productModelId: z.number().int().nullable().optional(),
    modelId: z.number().int().nullable().optional(),
    modelVersion: z.string().max(64).nullable().optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    decision: z.string().max(32).nullable().optional(),
    topLabel: z.string().max(120).nullable().optional(),
    source: z.enum(["quality_gate", "anomaly"]).nullable().optional(),
  })
  .strip();
type Provenance = z.infer<typeof provenanceSchema>;

function provenanceWarnings(lang: ToolLang, p?: Provenance | null): string[] {
  if (!p) return [];
  const conf = p.confidence != null ? `${(p.confidence * 100).toFixed(1)}%` : "n/a";
  const src = p.source ?? "quality_gate";
  return [
    w(
      lang,
      `Nguồn: ${src} — quyết định ${p.decision ?? "?"}${p.topLabel ? ` (${p.topLabel})` : ""}, độ tin cậy ${conf}, inspection #${p.inspectionId ?? "?"}, model #${p.modelId ?? "?"}${p.modelVersion ? ` v${p.modelVersion}` : ""}.`,
      `Provenance: ${src} — decision ${p.decision ?? "?"}${p.topLabel ? ` (${p.topLabel})` : ""}, confidence ${conf}, inspection #${p.inspectionId ?? "?"}, model #${p.modelId ?? "?"}${p.modelVersion ? ` v${p.modelVersion}` : ""}.`,
      `来源：${src} — 判定 ${p.decision ?? "?"}${p.topLabel ? ` (${p.topLabel})` : ""}，置信度 ${conf}，检测 #${p.inspectionId ?? "?"}，模型 #${p.modelId ?? "?"}${p.modelVersion ? ` v${p.modelVersion}` : ""}。`,
    ),
  ];
}

// ─── Shared resolution helpers (READ-ONLY — safe for preview) ──────────────────

/** Resolve the adapter for a machine + check each tag is writable. READ-ONLY. */
async function resolveTarget(machineId: number, tagKeys: string[], lang: ToolLang): Promise<{ adapterId?: number; warnings: string[] }> {
  const warnings: string[] = [];
  const db = await getDb();
  if (!db) {
    warnings.push(w(lang, "DB không khả dụng.", "Database unavailable.", "数据库不可用。"));
    return { warnings };
  }
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.machineId, machineId)).limit(1);
  if (!adapter) {
    warnings.push(w(lang, `Không tìm thấy adapter OT cho máy #${machineId}.`, `No OT adapter found for machine #${machineId}.`, `未找到机器 #${machineId} 的 OT 适配器。`));
    return { warnings };
  }
  if (!adapter.isEnabled) {
    warnings.push(w(lang, `Adapter "${adapter.code}" đang TẮT.`, `Adapter "${adapter.code}" is DISABLED.`, `适配器 "${adapter.code}" 已禁用。`));
  }
  for (const tagKey of tagKeys) {
    const [tag] = await db
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, adapter.id), eq(deviceTags.tagKey, tagKey)))
      .limit(1);
    if (!tag) {
      warnings.push(w(lang, `Không tìm thấy tag "${tagKey}".`, `Tag "${tagKey}" not found.`, `未找到标签 "${tagKey}"。`));
    } else if (tag.writable !== true) {
      warnings.push(w(lang, `Tag "${tagKey}" KHÔNG ghi được — lệnh sẽ bị từ chối.`, `Tag "${tagKey}" is NOT writable — the command will be rejected.`, `标签 "${tagKey}" 不可写 — 命令将被拒绝。`));
    }
  }
  return { adapterId: adapter.id, warnings };
}

/** Resolve the adapter id at execute time (defensive — preview already warned). */
async function adapterIdForMachine(machineId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.machineId, machineId)).limit(1);
  if (!adapter) throw new Error(`No OT adapter for machine #${machineId}`);
  return adapter.id;
}

/**
 * Build + run the dispatcher call from a CONFIRMED exec context. ALWAYS the HITL
 * path — there is NO code here that produces triggeredBy.kind='interlock'. The
 * dispatcher owns every gate (mode/commissioning/allowlist/confirm/idempotency).
 */
async function runDispatch(
  ctx: ToolExecContext,
  args: { machineId: number; adapterId: number; commandType: string; writes: Array<{ tagKey: string; value: unknown }> },
): Promise<ToolExecuteResult> {
  const idempotencyKey = ctx.actionId ?? `vc-${args.machineId}-${args.commandType}-${Date.now()}`;
  const input: DispatchInput = {
    adapterId: args.adapterId,
    machineId: args.machineId,
    commandType: args.commandType,
    writes: args.writes,
    triggeredBy: {
      kind: "hitl",
      actionId: ctx.actionId,
      confirmedBy: ctx.user.id,
      requestedBy: ctx.user.id,
    },
    lang: ctx.lang,
    idempotencyKey,
  };
  const result = await dispatch(input);
  const title = result.simulated
    ? w(ctx.lang, `[MÔ PHỎNG] ${args.commandType} cho máy #${args.machineId}`, `[SIMULATED] ${args.commandType} for machine #${args.machineId}`, `[模拟] 机器 #${args.machineId} 的 ${args.commandType}`)
    : w(ctx.lang, `${args.commandType} cho máy #${args.machineId}: ${result.status}`, `${args.commandType} for machine #${args.machineId}: ${result.status}`, `机器 #${args.machineId} 的 ${args.commandType}：${result.status}`);
  return {
    type: "action_result",
    title,
    data: result,
    textSummary: `${args.commandType} → ${result.status}${result.reason ? ` (${result.reason})` : ""}`,
    note: result.ok ? undefined : result.reason,
  };
}

// ─── reject_divert (canCreate) ─────────────────────────────────────────────────

const rejectDivertParams = z
  .object({
    machineId: z.number().int().positive(),
    /** Divert command tag (default cmd_reject_divert). */
    tagKey: z.string().min(1).max(128).optional(),
    /** Multi-lane diverter lane; omit → boolean pulse (value=true). */
    lane: z.number().int().min(0).max(64).optional(),
    /** Failed-unit id/serial for traceability (recorded, not written to the tag). */
    unitRef: z.string().max(128).optional(),
    provenance: provenanceSchema.optional(),
  })
  .strict();
type RejectDivertParams = z.infer<typeof rejectDivertParams>;

const REJECT_DIVERT_DEFAULT_TAG = "cmd_reject_divert";

function summarizeRejectDivert(p: RejectDivertParams, lang: ToolLang): string {
  const unit = p.unitRef ? ` (${p.unitRef})` : "";
  return w(
    lang,
    `Chuyển hướng (loại) đơn vị lỗi${unit} trên máy #${p.machineId}${p.lane != null ? `, làn ${p.lane}` : ""}.`,
    `Divert (reject) the failed unit${unit} on machine #${p.machineId}${p.lane != null ? `, lane ${p.lane}` : ""}.`,
    `将机器 #${p.machineId} 上的不良单元${unit} 分流（剔除）${p.lane != null ? `，通道 ${p.lane}` : ""}。`,
  );
}

registerTool<RejectDivertParams, unknown>({
  name: "reject_divert",
  description:
    "WRITE-ACTION (OT, HITL): chuyển hướng/loại đơn vị lỗi khỏi line qua command dispatcher " +
    "(mặc định DRY-RUN; ghi thật chỉ khi adapter đã nghiệm thu + OT_CONTROL_ENABLED). " +
    "Cần machine_control/canCreate + xác nhận của người dùng.",
  parameters: rejectDivertParams,
  triggers: ["reject divert", "chuyển hướng lỗi", "loại đơn vị lỗi", "divert reject", "分流剔除"],
  kind: "write",
  requiredPermission: { module: "machine_control", action: "canCreate" },
  summarize: summarizeRejectDivert,
  preview: async (p, ctx): Promise<ActionPreview> => {
    const tagKey = p.tagKey ?? REJECT_DIVERT_DEFAULT_TAG;
    const r = await resolveTarget(p.machineId, [tagKey], ctx.lang);
    const changes: AuditChangeField[] = [
      { field: "reject_divert", oldValue: null, newValue: p.lane ?? true, displayName: "Divert" },
    ];
    return {
      entityType: "machine",
      entityId: p.machineId,
      changes,
      warnings: [...r.warnings, ...provenanceWarnings(ctx.lang, p.provenance)],
      humanSummary: summarizeRejectDivert(p, ctx.lang),
    };
  },
  execute: async (p, ctx) => {
    const tagKey = p.tagKey ?? REJECT_DIVERT_DEFAULT_TAG;
    const adapterId = await adapterIdForMachine(p.machineId);
    return runDispatch(ctx, {
      machineId: p.machineId,
      adapterId,
      commandType: "reject_divert",
      writes: [{ tagKey, value: p.lane ?? true }],
    });
  },
});

// ─── spi_printer_offset (canEdit) ──────────────────────────────────────────────

const spiPrinterOffsetParams = z
  .object({
    machineId: z.number().int().positive(),
    /** Stencil-printer X correction (µm) — computed deterministically upstream. */
    offsetXUm: z.number(),
    /** Stencil-printer Y correction (µm). */
    offsetYUm: z.number(),
    tagKeyX: z.string().min(1).max(128).optional(), // default printer_offset_x
    tagKeyY: z.string().min(1).max(128).optional(), // default printer_offset_y
    provenance: provenanceSchema.optional(),
  })
  .strict();
type SpiPrinterOffsetParams = z.infer<typeof spiPrinterOffsetParams>;

const SPI_OFFSET_X_TAG = "printer_offset_x";
const SPI_OFFSET_Y_TAG = "printer_offset_y";

function summarizeSpiOffset(p: SpiPrinterOffsetParams, lang: ToolLang): string {
  return w(
    lang,
    `Áp offset máy in kem (SPI) X=${p.offsetXUm}µm, Y=${p.offsetYUm}µm cho máy #${p.machineId}.`,
    `Apply SPI stencil-printer offset X=${p.offsetXUm}µm, Y=${p.offsetYUm}µm on machine #${p.machineId}.`,
    `为机器 #${p.machineId} 应用 SPI 印刷机偏移 X=${p.offsetXUm}µm，Y=${p.offsetYUm}µm。`,
  );
}

registerTool<SpiPrinterOffsetParams, unknown>({
  name: "spi_printer_offset",
  description:
    "WRITE-ACTION (OT, HITL): áp offset X/Y cho máy in kem (stencil printer) tính từ xu hướng " +
    "thể tích/vị trí SPI qua command dispatcher (mặc định DRY-RUN; ghi thật chỉ khi adapter " +
    "đã nghiệm thu + OT_CONTROL_ENABLED). Cần machine_control/canEdit + xác nhận.",
  parameters: spiPrinterOffsetParams,
  triggers: ["spi offset", "printer offset", "offset máy in kem", "hiệu chỉnh in kem", "印刷偏移"],
  kind: "write",
  requiredPermission: { module: "machine_control", action: "canEdit" },
  summarize: summarizeSpiOffset,
  preview: async (p, ctx): Promise<ActionPreview> => {
    const tagKeyX = p.tagKeyX ?? SPI_OFFSET_X_TAG;
    const tagKeyY = p.tagKeyY ?? SPI_OFFSET_Y_TAG;
    const r = await resolveTarget(p.machineId, [tagKeyX, tagKeyY], ctx.lang);
    const changes: AuditChangeField[] = [
      { field: tagKeyX, oldValue: null, newValue: p.offsetXUm, displayName: "Printer offset X (µm)" },
      { field: tagKeyY, oldValue: null, newValue: p.offsetYUm, displayName: "Printer offset Y (µm)" },
    ];
    return {
      entityType: "machine",
      entityId: p.machineId,
      changes,
      warnings: [...r.warnings, ...provenanceWarnings(ctx.lang, p.provenance)],
      humanSummary: summarizeSpiOffset(p, ctx.lang),
    };
  },
  execute: async (p, ctx) => {
    const tagKeyX = p.tagKeyX ?? SPI_OFFSET_X_TAG;
    const tagKeyY = p.tagKeyY ?? SPI_OFFSET_Y_TAG;
    const adapterId = await adapterIdForMachine(p.machineId);
    return runDispatch(ctx, {
      machineId: p.machineId,
      adapterId,
      commandType: "spi_printer_offset",
      writes: [
        { tagKey: tagKeyX, value: p.offsetXUm },
        { tagKey: tagKeyY, value: p.offsetYUm },
      ],
    });
  },
});
