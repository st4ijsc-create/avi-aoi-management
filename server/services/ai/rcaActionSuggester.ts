/**
 * RCA / Report recommendation → 1-tap HITL action suggester (doc69 Wave2, AI#1 A3).
 *
 * `aiInsightsService.generateRCAInsights` (rootCauseRouter.analyze/get) and
 * `aiReportGenerator.generateRCAReport` (aiReportRouter.rcaReport) already return
 * free-text `recommendations` / `actionItems` — but they are DEAD-END TEXT: a user
 * reading "Implement preventive maintenance schedule for high-defect machines" has
 * no way to act on it except retyping the request into the AI chat by hand.
 *
 * This module closes the loop WITHOUT inventing a new write path: for each
 * recommendation it conservatively pattern-matches against a SMALL, EXPLICIT set of
 * KNOWN registered write-tools (server/services/aiLocalTools/writeHandlers/*), builds
 * args from context that is already trustworthy (the machineId the analysis/report
 * was scoped to — never client-supplied), and only emits a `SuggestedAction` when
 * ALL of the following hold:
 *
 *   1. a pattern matches a known, currently-registered write-tool;
 *   2. the built args pass the tool's OWN zod schema (`safeParse`) — never fabricated,
 *      never out of the tool's bounds;
 *   3. the referenced entity (machine) actually EXISTS in the DB;
 *   4. the CALLING user actually holds the tool's `requiredPermission` (RBAC gate
 *      #1 — checked here so a non-permitted user never even sees a button; RBAC
 *      gate #2 is the EXISTING re-check inside `aiCopilotActions.proposeAction`,
 *      and a 3rd re-check happens again inside `confirmAction`).
 *
 * Any recommendation that fails any of these stays advisory TEXT (no entry, no
 * button) — this module NEVER calls proposeAction/confirmAction itself; the caller
 * (a tRPC router) hands `{tool, args}` to the EXISTING HITL write path
 * (aiCopilotActions.proposeAction → confirmAction) only after the user taps the
 * 1-tap button. This module ONLY decides "is this recommendation actionable" — it
 * is intentionally read-only / side-effect-free (besides the entity-existence read).
 */

import type { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { checkPermission } from "../../_core/accessControl";
import { getTool, isWriteTool, type ToolLang, type ToolPermission } from "../aiLocalTools/toolRegistry";

// ─── The small, explicit allow-list this mapper is permitted to suggest ─────────
// (brief: "conservative + explicit... review/tune threshold → request_threshold_review,
// create maintenance → create_maintenance_workorder, run RCA → run_rca_analysis").
export const RCA_SUGGESTED_ACTION_TOOLS = [
  "run_rca_analysis",
  "request_threshold_review",
  "create_maintenance_workorder",
] as const;

export type RcaSuggestedActionTool = (typeof RCA_SUGGESTED_ACTION_TOOLS)[number];

export interface SuggestedAction {
  /** Index into the recommendations[] array this action was derived from. */
  recommendationIndex: number;
  tool: RcaSuggestedActionTool;
  args: Record<string, unknown>;
  summary: string;
  requiredPermission: ToolPermission;
}

/** Minimal shape shared by aiInsightsService.RCAInsight and a report's actionItems. */
export interface RCAInsightLike {
  rootCauses?: Array<{ cause?: string | null }> | null;
  recommendations: string[] | null | undefined;
}

export interface SuggestActionsContext {
  /** The machine the analysis/report was scoped to — the ONLY entity context we trust. */
  machineId?: number | null;
  user: { id: number; role: string; name?: string | null };
  lang?: ToolLang;
}

// ─── Ensure the candidate write-tools are registered (idempotent, side-effect) ───
// Mirrors the defensive re-import already used by aiAutoProposer/aiRcaCopilot: the
// tools are normally registered once at process boot (server/services/aiLocalTools/
// writeHandlers.ts, transitively imported by the KB service), but a caller that
// reaches this module in isolation (e.g. a unit test) must not silently see an
// empty registry.
let registrationPromise: Promise<void> | null = null;
export function ensureRcaToolsRegistered(): Promise<void> {
  if (!registrationPromise) {
    registrationPromise = Promise.all([
      import("../aiLocalTools/writeHandlers/qualityAdvisory").catch(() => undefined),
      import("../aiLocalTools/writeHandlers/maintenance").catch(() => undefined),
    ]).then(() => undefined);
  }
  return registrationPromise;
}

// ─── Pattern rules (small + explicit — NOT the tool's chat-command triggers, which
// are tuned for imperative phrasing like "chạy rca"; a recommendation is DESCRIPTIVE
// text like "Investigate root cause of X" or "Implement preventive maintenance
// schedule…", so this list is tuned for that register instead). ────────────────────

interface PatternRule {
  tool: RcaSuggestedActionTool;
  keywords: string[];
  buildArgs: (ctx: { machineId: number; defectTypeHint?: string }) => Record<string, unknown>;
}

const RULES: PatternRule[] = [
  {
    tool: "run_rca_analysis",
    keywords: [
      "root cause analysis", "root cause", "run rca", "rca copilot",
      "investigate the root cause", "investigate root cause", "diagnose",
      "phân tích nguyên nhân gốc", "phân tích nguyên nhân", "chẩn đoán", "điều tra nguyên nhân",
    ],
    buildArgs: (ctx) => ({
      machineId: ctx.machineId,
      ...(ctx.defectTypeHint ? { defectType: ctx.defectTypeHint } : {}),
    }),
  },
  {
    tool: "request_threshold_review",
    keywords: [
      "review the threshold", "review threshold", "review thresholds", "threshold review",
      "adjust the threshold", "adjust threshold", "tune the threshold", "review sensitivity",
      "xem lại ngưỡng", "duyệt lại ngưỡng", "điều chỉnh ngưỡng", "rà soát ngưỡng", "độ nhạy",
    ],
    buildArgs: (ctx) => ({ machineId: ctx.machineId, maxPoints: 3 }),
  },
  {
    tool: "create_maintenance_workorder",
    keywords: [
      "preventive maintenance", "schedule maintenance", "maintenance schedule", "maintenance work order",
      "create a maintenance", "create maintenance", "work order", "calibration",
      "bảo trì phòng ngừa", "lịch bảo trì", "lệnh bảo trì", "hiệu chuẩn", "bảo dưỡng",
    ],
    buildArgs: (ctx) => ({
      machineId: ctx.machineId,
      title: buildWorkOrderTitle(ctx.machineId),
      type: "PREVENTIVE",
      priority: 3,
    }),
  },
];

function buildWorkOrderTitle(machineId: number): string {
  return `Bảo trì phòng ngừa — đề xuất từ AI cho máy #${machineId}`;
}

function matchRule(text: string): PatternRule | null {
  const hay = text.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((k) => hay.includes(k.toLowerCase()))) return rule;
  }
  return null;
}

/** Entity existence — never suggest an action that references a machine that isn't real. */
async function machineExists(machineId: number): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) return false;
    const { machines } = await import("../../../drizzle/schema");
    const [row] = await db.select({ id: machines.id }).from(machines).where(eq(machines.id, machineId)).limit(1);
    return !!row;
  } catch {
    return false;
  }
}

/**
 * Map an RCA insight / report's recommendations to proposable HITL actions.
 * Read-only + fail-safe: NEVER throws, NEVER calls proposeAction/confirmAction,
 * NEVER mutates. See module doc for the exact acceptance gates.
 */
export async function suggestActionsForRecommendations(
  insight: RCAInsightLike,
  ctx: SuggestActionsContext,
): Promise<SuggestedAction[]> {
  const recommendations = insight?.recommendations;
  if (!Array.isArray(recommendations) || recommendations.length === 0) return [];

  const machineId = ctx.machineId;
  if (machineId == null || !Number.isFinite(machineId) || machineId <= 0) return [];

  try {
    await ensureRcaToolsRegistered();

    // Resolved ONCE — all 3 candidate tools key off the same machine context.
    const exists = await machineExists(machineId);
    if (!exists) return [];

    const topCause = insight.rootCauses?.find((c) => typeof c?.cause === "string" && c.cause.trim())?.cause ?? null;
    const defectTypeHint = topCause ? topCause.trim().slice(0, 128) : undefined;

    const out: SuggestedAction[] = [];
    for (let i = 0; i < recommendations.length; i++) {
      const text = recommendations[i];
      if (typeof text !== "string" || !text.trim()) continue;

      const rule = matchRule(text);
      if (!rule) continue; // no known tool maps to this recommendation → advisory text only

      const tool = getTool(rule.tool);
      if (!tool || !isWriteTool(tool) || !tool.requiredPermission) continue; // tool not available

      const rawArgs = rule.buildArgs({ machineId, defectTypeHint });
      const parsed = (tool.parameters as z.ZodType<any>).safeParse(rawArgs);
      if (!parsed.success) continue; // never fabricate out-of-bounds args

      const perm = tool.requiredPermission;
      const allowed = await checkPermission(ctx.user.id, ctx.user.role, perm.module, perm.action);
      if (!allowed) continue; // RBAC gate #1 — non-permitted user sees advisory text only

      const validatedArgs = parsed.data as Record<string, unknown>;
      const summary = tool.summarize ? tool.summarize(validatedArgs, ctx.lang ?? "vi") : tool.name;

      out.push({
        recommendationIndex: i,
        tool: rule.tool,
        args: validatedArgs,
        summary,
        requiredPermission: perm,
      });
    }
    return out;
  } catch (err) {
    console.warn("[rcaActionSuggester] suggestActionsForRecommendations failed:", (err as Error)?.message ?? err);
    return []; // fail-safe: advisory-only, never throw into the RCA/report response
  }
}
