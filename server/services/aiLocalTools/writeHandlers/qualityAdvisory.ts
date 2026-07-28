/**
 * AI Local Tools — Write Handler: QUALITY ADVISORY actions (doc 27 §9 V21 · Đợt 7.6).
 *
 * Two SAFE, bounded write-tools that give the auto-proposer's new triggers a real
 * HITL action to propose (yield-drop → run an RCA; false-call-spike → request a
 * threshold review). Both are ANALYSIS/REQUEST writes — they change NO machine
 * parameter and NO limit:
 *
 *   • run_rca_analysis        — runs the EXISTING RCA copilot pipeline
 *     (aiRcaCopilot.runRca) and persists the result as a root_cause_analysis
 *     record for the confirming user. Propose-only fixes inside the RCA stay
 *     behind their own HITL gate (proposeTopFix → confirmAction).
 *   • request_threshold_review — runs the EXISTING threshold advisor
 *     (aiThresholdAdvisor.recommendForMeasurementPoint) for the machine's
 *     noisiest measurement points and files threshold_approvals REQUESTS (status
 *     'requested'). A quality manager must STILL approve+apply in the approval
 *     queue — i.e. two human gates before any limit changes.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (HITL — mirrors engineering.ts / maintenance.ts):
 *   - kind:'write' → routed ONLY through proposeAction → confirmAction. The AI
 *     can only PROPOSE; a human must confirm. preview() READS ONLY.
 *   - zod .strict() schemas with tight bounds; requestedBy = ctx.user.id (the
 *     REAL confirming user — never a sentinel, never client-supplied).
 *   - Fail-safe execute: DB/advisor unavailability returns an honest note,
 *     never a fabricated success.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { z } from "zod";
import { getDb } from "../../../db/connection";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

// ════════════════════════════════════════════════════════════════════════════
// 1) run_rca_analysis
// ════════════════════════════════════════════════════════════════════════════

const runRcaAnalysisParams = z
  .object({
    machineId: z.number().int().positive(),
    /** Free-form defect/trigger context fed to the RCA evidence gatherers. */
    defectType: z.string().min(1).max(128).optional(),
  })
  .strict();

export type RunRcaAnalysisParams = z.infer<typeof runRcaAnalysisParams>;

function summarizeRunRca(p: RunRcaAnalysisParams, lang: ToolLang): string {
  return w(
    lang,
    `Chạy phân tích nguyên nhân gốc (RCA Copilot) cho máy #${p.machineId}${p.defectType ? ` — ngữ cảnh "${p.defectType}"` : ""}.`,
    `Run root-cause analysis (RCA Copilot) for machine #${p.machineId}${p.defectType ? ` — context "${p.defectType}"` : ""}.`,
    `为机器 #${p.machineId} 运行根因分析（RCA Copilot）${p.defectType ? `——上下文“${p.defectType}”` : ""}。`,
  );
}

async function previewRunRca(p: RunRcaAnalysisParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  try {
    const { isRcaCopilotEnabled } = await import("../../aiRcaCopilot");
    if (!isRcaCopilotEnabled()) {
      warnings.push(w(
        ctx.lang,
        "AI_RCA_COPILOT_ENABLED đang tắt — phân tích sẽ trả về kết quả rỗng.",
        "AI_RCA_COPILOT_ENABLED is off — the analysis will return an empty result.",
        "AI_RCA_COPILOT_ENABLED 已关闭——分析将返回空结果。",
      ));
    }
  } catch {
    /* preview must stay read-only + fail-safe */
  }
  return {
    entityType: "root_cause_analysis",
    entityName: `RCA machine #${p.machineId}`,
    changes: [
      { field: "machineId", oldValue: null, newValue: p.machineId, displayName: w(ctx.lang, "Máy", "Machine", "机器") },
      { field: "defectType", oldValue: null, newValue: p.defectType ?? null, displayName: w(ctx.lang, "Ngữ cảnh", "Context", "上下文") },
    ],
    warnings,
    humanSummary: summarizeRunRca(p, ctx.lang),
  };
}

export const runRcaAnalysisTool: Tool<RunRcaAnalysisParams, { rcaId: number | null; hypotheses: number }> = {
  name: "run_rca_analysis",
  description:
    "Chạy RCA Copilot (gom bằng chứng Pareto/SPC/anomaly/vision/corrections + xếp hạng giả thuyết) " +
    "cho một máy và lưu kết quả. WRITE-ACTION (ghi bản ghi phân tích): cần quyền machine_monitoring/canView " +
    "+ xác nhận của người dùng. KHÔNG thay đổi tham số máy hay ngưỡng nào.",
  parameters: runRcaAnalysisParams,
  triggers: [
    "chạy rca", "phân tích nguyên nhân gốc", "chẩn đoán lỗi máy",
    "run rca", "root cause analysis", "diagnose machine", "运行根因分析",
  ],
  kind: "write",
  requiredPermission: { module: "machine_monitoring", action: "canView" },
  summarize: summarizeRunRca,
  preview: previewRunRca,
  execute: async (p, ctx) => {
    const { runRca, persistRca } = await import("../../aiRcaCopilot");
    // Final-fix round, Task 6 (SECURITY) — real RBAC role (ToolExecContext.user.role, the
    // authenticated session) for the Studio-corpus gate — see RunRcaInput.callerRole.
    const result = await runRca({ machineId: p.machineId, defectType: p.defectType, lang: ctx.lang, callerRole: ctx.user.role });
    const rcaId = result.ok
      ? await persistRca({ result, requestedBy: ctx.user.id, requestedByName: ctx.user.name ?? null })
      : null;
    const n = result.hypotheses.length;
    return {
      type: "action_result",
      title: w(
        ctx.lang,
        rcaId != null
          ? `Đã chạy RCA #${rcaId} cho máy #${p.machineId} — ${n} giả thuyết`
          : `RCA cho máy #${p.machineId} không tạo được bản ghi (${result.note ?? "degraded"})`,
        rcaId != null
          ? `Ran RCA #${rcaId} for machine #${p.machineId} — ${n} hypothesis(es)`
          : `RCA for machine #${p.machineId} produced no record (${result.note ?? "degraded"})`,
        rcaId != null
          ? `已为机器 #${p.machineId} 运行 RCA #${rcaId}——${n} 个假设`
          : `机器 #${p.machineId} 的 RCA 未生成记录（${result.note ?? "degraded"}）`,
      ),
      data: { rcaId, hypotheses: n },
      textSummary: summarizeRunRca(p, ctx.lang),
      ...(rcaId == null ? { note: result.note ?? "RCA_DEGRADED" } : {}),
    };
  },
};

registerTool(runRcaAnalysisTool);

// ════════════════════════════════════════════════════════════════════════════
// 2) request_threshold_review
// ════════════════════════════════════════════════════════════════════════════

const requestThresholdReviewParams = z
  .object({
    /** Review the noisiest points of this machine… */
    machineId: z.number().int().positive().optional(),
    /** …or one specific measurement point. */
    pointDefId: z.number().int().positive().optional(),
    /** Cap of points reviewed per run (bounded churn). */
    maxPoints: z.number().int().min(1).max(5).default(3),
    /** Context note stored on the approval request (e.g. "false-call spike"). */
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((p) => p.machineId != null || p.pointDefId != null, {
    message: "machineId or pointDefId is required",
  });

export type RequestThresholdReviewParams = z.infer<typeof requestThresholdReviewParams>;

function summarizeReview(p: RequestThresholdReviewParams, lang: ToolLang): string {
  const scope = p.pointDefId != null ? `MP-${p.pointDefId}` : w(lang, `máy #${p.machineId}`, `machine #${p.machineId}`, `机器 #${p.machineId}`);
  return w(
    lang,
    `Chạy Threshold Advisor và tạo yêu cầu duyệt ngưỡng cho ${scope} (tối đa ${p.maxPoints} điểm; quản lý chất lượng vẫn phải duyệt).`,
    `Run the Threshold Advisor and file threshold-approval request(s) for ${scope} (max ${p.maxPoints} points; a quality manager must still approve).`,
    `为 ${scope} 运行阈值顾问并创建阈值审批请求（最多 ${p.maxPoints} 个点；仍需质量经理审批）。`,
  );
}

async function previewReview(p: RequestThresholdReviewParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [
    w(
      ctx.lang,
      "Chỉ tạo YÊU CẦU duyệt — không ngưỡng nào thay đổi cho đến khi được duyệt + áp dụng trong hàng đợi duyệt.",
      "Creates approval REQUESTS only — no limit changes until approved + applied in the approval queue.",
      "仅创建审批请求——在审批队列中批准并应用之前不会更改任何阈值。",
    ),
  ];
  return {
    entityType: "threshold_approvals",
    entityName: p.pointDefId != null ? `MP-${p.pointDefId}` : `machine #${p.machineId}`,
    changes: [
      { field: "scope", oldValue: null, newValue: p.pointDefId ?? `machine:${p.machineId}`, displayName: w(ctx.lang, "Phạm vi", "Scope", "范围") },
      { field: "maxPoints", oldValue: null, newValue: p.maxPoints, displayName: w(ctx.lang, "Số điểm tối đa", "Max points", "最多点数") },
    ],
    warnings,
    humanSummary: summarizeReview(p, ctx.lang),
  };
}

export const requestThresholdReviewTool: Tool<
  RequestThresholdReviewParams,
  { requested: number; considered: number; skipped: string[] }
> = {
  name: "request_threshold_review",
  description:
    "Chạy Threshold Advisor cho các điểm đo của một máy (hoặc một điểm cụ thể) và tạo yêu cầu " +
    "duyệt ngưỡng trong hàng đợi threshold_approvals. WRITE-ACTION (tạo yêu cầu, không áp ngưỡng): " +
    "cần quyền settings_alerts/canView + xác nhận; ngưỡng chỉ đổi khi quản lý duyệt + áp dụng.",
  parameters: requestThresholdReviewParams,
  triggers: [
    "xem lại ngưỡng", "duyệt lại ngưỡng đo", "kiểm tra độ nhạy",
    "review thresholds", "threshold review", "review sensitivity", "阈值复查",
  ],
  kind: "write",
  requiredPermission: { module: "settings_alerts", action: "canView" },
  summarize: summarizeReview,
  preview: previewReview,
  execute: async (p, ctx) => {
    const skipped: string[] = [];
    let considered = 0;
    let requested = 0;

    const db = await getDb();
    if (!db) {
      return {
        type: "action_result",
        title: w(ctx.lang, "DB không khả dụng", "DB unavailable", "数据库不可用"),
        data: { requested: 0, considered: 0, skipped: ["DB_UNAVAILABLE"] },
        textSummary: summarizeReview(p, ctx.lang),
        note: "DB_UNAVAILABLE",
      };
    }

    // Resolve the point scopes to review.
    let pointIds: number[] = [];
    if (p.pointDefId != null) {
      pointIds = [p.pointDefId];
    } else {
      const { enumeratePointTuneScopes } = await import("../../../db/aiThresholdTune");
      const scopes = await enumeratePointTuneScopes({ minSamples: 30, days: 30 });
      pointIds = scopes
        .filter((s) => s.machineId == null || s.machineId === p.machineId)
        .slice(0, p.maxPoints)
        .map((s) => s.pointDefId);
      if (pointIds.length === 0) skipped.push("NO_CANDIDATE_POINTS");
    }

    const { recommendForMeasurementPoint } = await import("../../aiThresholdAdvisor");
    const { thresholdApprovals } = await import("../../../../drizzle/schema/product");

    for (const pointDefId of pointIds.slice(0, p.maxPoints)) {
      considered++;
      try {
        const rec = await recommendForMeasurementPoint({ measurementPointId: pointDefId, machineId: p.machineId });
        if (!rec.ok || rec.disabled || rec.degraded) {
          skipped.push(`point#${pointDefId}:advisor_degraded`);
          continue;
        }
        if (!(rec.recommended.lsl < rec.recommended.usl)) {
          skipped.push(`point#${pointDefId}:invalid_limits`);
          continue;
        }
        await db.insert(thresholdApprovals).values({
          pointDefId,
          // The REAL confirming user is the requester (provenance, V25-consistent).
          requestedBy: ctx.user.id,
          suggestion: {
            source: "ai_false_call_review",
            proposedBy: "ai_auto_proposer",
            currentCpk: rec.current.cpk,
            projectedCpk: rec.recommended.projectedCpk,
            sampleSize: rec.sampleSize,
            basis: rec.basis,
            note: p.note ?? null,
          } as any,
          currentLsl: rec.current.lsl != null ? (String(rec.current.lsl) as any) : undefined,
          currentUsl: rec.current.usl != null ? (String(rec.current.usl) as any) : undefined,
          currentNominal: rec.current.target != null ? (String(rec.current.target) as any) : undefined,
          proposedLsl: String(rec.recommended.lsl) as any,
          proposedUsl: String(rec.recommended.usl) as any,
          proposedNominal: String(rec.recommended.target) as any,
          comment:
            (p.note ? `${p.note} — ` : "") +
            `Threshold review: Cpk ${rec.current.cpk ?? "?"} → ${rec.recommended.projectedCpk} (${rec.sampleSize} mẫu).`,
          status: "requested",
        });
        requested++;
      } catch (err) {
        skipped.push(`point#${pointDefId}:${(err as Error)?.message?.slice(0, 80) ?? "error"}`);
      }
    }

    return {
      type: "action_result",
      title: w(
        ctx.lang,
        `Đã tạo ${requested}/${considered} yêu cầu duyệt ngưỡng`,
        `Filed ${requested}/${considered} threshold-approval request(s)`,
        `已创建 ${requested}/${considered} 个阈值审批请求`,
      ),
      data: { requested, considered, skipped },
      textSummary: summarizeReview(p, ctx.lang),
      ...(requested === 0 ? { note: skipped.join("; ") || "NO_REQUESTS_CREATED" } : {}),
    };
  },
};

registerTool(requestThresholdReviewTool);
