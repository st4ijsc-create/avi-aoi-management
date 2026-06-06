/**
 * AI Playbook Engine (Sprint G2.3b) — runs a STATIC playbook (SOP) on top of
 * the G2.3a orchestrator, WITHOUT modifying the orchestrator core.
 *
 * SAFETY (mirrors the orchestrator invariants):
 *  - A playbook is a deterministic, human-authored plan. The engine only MAPS
 *    PlaybookStep[] → AgentPlanStep[] and inserts an ai_agent_sessions row
 *    (status awaiting_approval, with playbookId set). It then hands control to
 *    the orchestrator's approvePlan/advance/confirmStep — every `tool` step is a
 *    write that flows through proposeAction → user HITL confirm → confirmAction.
 *  - The engine NEVER imports commandDispatcher, NEVER calls tool.execute(), and
 *    NEVER auto-confirms.
 *  - navigate/prefill steps map to client directives (no DB write, no HITL).
 *  - requiredPermission is gated (checkPermission) BEFORE a session is created;
 *    denied ⇒ no row, no run.
 *  - The agentic gate (canUseAgentic, SERVER role) is enforced by the router.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { aiAgentSessions } from "../../drizzle/schema";
import type { AgentPlan, AgentPlanStep } from "../../drizzle/schema";
import type { ToolExecContext, ToolLang } from "./aiLocalTools/toolRegistry";
import { checkPermission } from "../_core/accessControl";
import type { AgentUser, StartSessionResult } from "./aiAgentOrchestrator";
import {
  getPlaybooks,
  getPlaybookById,
  type Playbook,
  type PlaybookStep,
  type LocalizedText,
} from "./aiPlaybookLoader";

const SESSION_TTL_MS = 30 * 60 * 1000;

function pickText(t: LocalizedText, lang: ToolLang): string {
  return t[lang] ?? t.vi;
}

/**
 * Interpolate a template object against a flat context. A string value of the
 * form "{{key}}" is replaced by ctx[key] (preserving the value's type, so a
 * number stays a number). Non-template values pass through unchanged. Keys that
 * resolve to `undefined` are dropped (the tool's zod schema then decides).
 */
export function interpolateTemplate(
  template: Record<string, unknown> | undefined,
  context: Record<string, unknown>,
): Record<string, unknown> {
  if (!template) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(template)) {
    if (typeof v === "string") {
      const m = v.match(/^\{\{\s*([\w.]+)\s*\}\}$/);
      if (m) {
        const resolved = context[m[1]];
        if (resolved !== undefined) out[k] = resolved;
        continue; // unresolved → drop the key
      }
    }
    out[k] = v;
  }
  return out;
}

/**
 * Map a single PlaybookStep → AgentPlanStep (the orchestrator's step shape).
 *   tool     → kind "write"  (HITL via proposeAction)
 *   navigate → kind "navigate" (client directive, no DB)
 *   prefill  → kind "prefill"  (client directive, no DB)
 *   guidance → kind "guidance"
 *   confirm  → kind "guidance" (a deterministic pause/checkpoint, text-only)
 *   branch   → kind "branch"  (deterministic; options carried in rationale)
 */
function mapStep(step: PlaybookStep, lang: ToolLang, context: Record<string, unknown>): AgentPlanStep {
  const text = pickText(step.text, lang);

  switch (step.type) {
    case "tool":
      return {
        kind: "write",
        tool: step.tool ?? null,
        args: interpolateTemplate(step.argsTemplate, context),
        rationale: text,
      };
    case "navigate":
      return {
        kind: "navigate",
        tool: "navigate",
        args: { route: step.route },
        rationale: text,
      };
    case "prefill":
      return {
        kind: "prefill",
        tool: "prefill_form",
        args: { route: step.route, values: interpolateTemplate(step.valuesTemplate, context) },
        rationale: text,
      };
    case "branch":
      return {
        kind: "branch",
        tool: null,
        rationale: step.branch ? `${text} — ${step.branch.map((b) => pickText(b.text, lang)).join(" | ")}` : text,
      };
    case "confirm":
    case "guidance":
    default:
      return { kind: "guidance", tool: null, rationale: text };
  }
}

/** Build the orchestrator AgentPlan from a playbook + runtime context. */
export function buildPlanFromPlaybook(
  pb: Playbook,
  lang: ToolLang,
  context: Record<string, unknown>,
): AgentPlan {
  return {
    summary: pickText(pb.title, lang),
    steps: pb.steps.map((s) => mapStep(s, lang, context)),
  };
}

export interface ListPlaybooksItem {
  id: string;
  title: LocalizedText;
  category?: string;
  requiredPermission?: { module: string; action: string };
  stepCount: number;
}

/**
 * List playbooks available to a user. A playbook with a requiredPermission the
 * user lacks is filtered out (admin always passes via checkPermission).
 */
export async function listPlaybooks(user: AgentUser): Promise<ListPlaybooksItem[]> {
  const all = getPlaybooks();
  const out: ListPlaybooksItem[] = [];
  for (const pb of all) {
    if (pb.requiredPermission) {
      const ok = await checkPermission(user.id, user.role, pb.requiredPermission.module, pb.requiredPermission.action);
      if (!ok) continue;
    }
    out.push({
      id: pb.id,
      title: pb.title,
      category: pb.category,
      requiredPermission: pb.requiredPermission,
      stepCount: pb.steps.length,
    });
  }
  return out;
}

/**
 * Start a playbook session. Gates requiredPermission FIRST (denied ⇒ no row),
 * builds the static plan, and parks the session at awaiting_approval with
 * playbookId set. The caller then drives it via the orchestrator's
 * approvePlan / advance / confirmStep (re-used, core untouched).
 */
export async function startPlaybook(
  playbookId: string,
  ctx: { user: AgentUser; lang?: ToolLang; context?: Record<string, unknown>; req?: ToolExecContext["req"] },
): Promise<StartSessionResult> {
  const lang: ToolLang = ctx.lang ?? "vi";

  const pb = getPlaybookById(playbookId);
  if (!pb) {
    return { ok: false, enabled: true, message: `Playbook "${playbookId}" không tồn tại.` };
  }

  // RBAC gate BEFORE creating any session row.
  if (pb.requiredPermission) {
    const allowed = await checkPermission(
      ctx.user.id,
      ctx.user.role,
      pb.requiredPermission.module,
      pb.requiredPermission.action,
    );
    if (!allowed) {
      return {
        ok: false,
        enabled: true,
        message: `Bạn không có quyền chạy playbook này (${pb.requiredPermission.module}/${pb.requiredPermission.action}).`,
      };
    }
  }

  const db = await getDb();
  if (!db) return { ok: false, enabled: true, message: "DB_UNAVAILABLE" };

  const plan = buildPlanFromPlaybook(pb, lang, ctx.context ?? {});
  const sessionId = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(aiAgentSessions).values({
    id: sessionId,
    userId: ctx.user.id,
    userRole: ctx.user.role,
    goal: pickText(pb.title, lang),
    planJson: plan,
    cursor: 0,
    status: "awaiting_approval",
    stepResults: [],
    linkedActionIds: [],
    writeCount: 0,
    playbookId: pb.id,
    lang,
    expiresAt,
  });

  return {
    ok: true,
    enabled: true,
    sessionId,
    status: "awaiting_approval",
    plan,
  };
}
