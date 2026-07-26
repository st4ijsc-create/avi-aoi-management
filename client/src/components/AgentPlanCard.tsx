/**
 * AgentPlanCard (Sprint G2.3c) — FE render of a multi-step agentic plan.
 *
 * SAFETY (FE-only, mirrors the backend invariants):
 *  - This component ONLY drives the flow (approvePlan / confirmStep / cancelSession)
 *    and renders the plan + each step's outcome. It NEVER calls commandDispatcher,
 *    NEVER executes a tool, and NEVER auto-confirms.
 *  - Each write step is confirmed INDIVIDUALLY by the user through the existing
 *    confirm card (rendered by the parent via `confirmCard`). On user confirm the
 *    parent calls aiAgent.confirmStep — the orchestrator re-uses the CORE
 *    confirmAction (HITL) and only then advances the cursor.
 *  - navigate / prefill steps are client directives executed by the parent
 *    (setLocation / publishPrefill) — no DB write.
 *
 * The card is purely presentational + flow buttons; all mutations are passed in
 * from the parent (AILocalChatBubble) so the SSE/chat state stays in one place.
 */

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Play,
  ArrowRight,
  Square,
  BookOpen,
  PencilLine,
  Compass,
  FormInput,
  GitBranch,
  Lightbulb,
  CheckCircle2,
  XCircle,
  Loader2,
  CircleDashed,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// ─── Types (mirror server/services/aiAgentOrchestrator + drizzle/schema/ai) ────

export type AgentStepKind = "read" | "write" | "guidance" | "navigate" | "prefill" | "branch";

export type AgentSessionStatus =
  | "planning"
  | "awaiting_approval"
  | "running"
  | "awaiting_confirm"
  | "paused"
  | "done"
  | "aborted"
  | "failed";

export interface AgentPlanStepView {
  kind: AgentStepKind;
  tool?: string | null;
  args?: Record<string, unknown>;
  rationale?: string;
}

export interface AgentStepResultView {
  index: number;
  kind: AgentStepKind;
  tool?: string | null;
  status: "done" | "awaiting_confirm" | "skipped" | "failed";
  actionId?: string | null;
  message?: string;
}

export interface AgentPlanView {
  summary?: string;
  steps: AgentPlanStepView[];
}

interface AgentPlanCardProps {
  goal: string;
  plan: AgentPlanView;
  status: AgentSessionStatus;
  /** Cursor = index of the current/next step. */
  cursor: number;
  stepResults: AgentStepResultView[];
  /** Slot for the existing pending-action confirm card (write step at awaiting_confirm). */
  confirmCard?: ReactNode;
  /** Flow handlers (mutations live in the parent). */
  onApprove: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** Localized message surfaced by the backend (e.g. paused reason, empty plan). */
  message?: string | null;
}

// ─── Visual helpers ────────────────────────────────────────────────────────────

function kindIcon(kind: AgentStepKind) {
  switch (kind) {
    case "read":
      return <BookOpen className="size-3.5 text-blue-500" />;
    case "write":
      return <PencilLine className="size-3.5 text-amber-600" />;
    case "navigate":
      return <Compass className="size-3.5 text-violet-500" />;
    case "prefill":
      return <FormInput className="size-3.5 text-violet-500" />;
    case "branch":
      return <GitBranch className="size-3.5 text-slate-500" />;
    case "guidance":
    default:
      return <Lightbulb className="size-3.5 text-emerald-500" />;
  }
}

function statusBadgeVariant(status: AgentSessionStatus): {
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
} {
  switch (status) {
    case "done":
      return { variant: "default", className: "bg-green-600 hover:bg-green-600" };
    case "awaiting_approval":
      return { variant: "secondary" };
    case "running":
      return { variant: "secondary", className: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" };
    case "awaiting_confirm":
      return { variant: "secondary", className: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" };
    case "paused":
      return { variant: "outline" };
    case "aborted":
    case "failed":
      return { variant: "destructive" };
    case "planning":
    default:
      return { variant: "outline" };
  }
}

/** Per-step status glyph based on its position relative to the cursor + result. */
function stepGlyph(
  index: number,
  cursor: number,
  result: AgentStepResultView | undefined,
  sessionStatus: AgentSessionStatus,
) {
  if (result?.status === "done") return <CheckCircle2 className="size-4 text-green-600" />;
  if (result?.status === "failed") return <XCircle className="size-4 text-red-500" />;
  if (result?.status === "skipped") return <CircleDashed className="size-4 text-muted-foreground" />;
  if (result?.status === "awaiting_confirm")
    return <AlertCircle className="size-4 text-amber-600" />;
  // No result yet.
  if (index === cursor && sessionStatus === "running")
    return <Loader2 className="size-4 text-blue-500 animate-spin" />;
  return <CircleDashed className="size-4 text-muted-foreground/50" />;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function AgentPlanCard({
  goal,
  plan,
  status,
  cursor,
  stepResults,
  confirmCard,
  onApprove,
  onCancel,
  busy = false,
  message,
}: AgentPlanCardProps) {
  const { t } = useTranslation();

  const steps = plan.steps ?? [];
  const total = steps.length;
  // `index < 0` marks a SYNTHETIC audit-only entry (e.g. the observe→replan
  // "REPLANNED" note pushed by the orchestrator, sentinel `-1 - cursor`) —
  // never a real plan step. It MUST be excluded here: a replan can truncate
  // the tail (shrinking `total`) while a synthetic note's status is "done",
  // and counting it toward `completed` can make completed > total render as
  // an impossible >100% progress bar.
  const realStepResults = stepResults.filter((r) => r.index >= 0);
  // Completed = REAL step results that finished (done/skipped/failed).
  // awaiting_confirm is NOT counted as completed.
  const completed = realStepResults.filter(
    (r) => r.status === "done" || r.status === "skipped" || r.status === "failed",
  ).length;
  // Belt-and-suspenders clamp: even if some future source ever miscounts,
  // progress can never render past 100%.
  const progressPct = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  const resultByIndex = new Map<number, AgentStepResultView>();
  for (const r of realStepResults) resultByIndex.set(r.index, r);

  const badge = statusBadgeVariant(status);
  const isTerminal = status === "done" || status === "aborted" || status === "failed";
  const canApprove = status === "awaiting_approval" && total > 0;
  const canCancel = !isTerminal;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] dark:bg-primary/[0.06] p-2.5 space-y-2 text-[12.5px]">
      {/* Header: goal + status badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-foreground text-[13px]">
            <Compass className="size-4 text-primary shrink-0" />
            <span className="truncate">{plan.summary || goal}</span>
          </div>
          {plan.summary && goal && plan.summary !== goal && (
            <p className="text-[11.5px] text-muted-foreground mt-0.5 truncate">{goal}</p>
          )}
        </div>
        <Badge variant={badge.variant} className={cn("shrink-0 text-[11px] h-5 px-1.5", badge.className)}>
          {t(`agent.status.${status}`, status)}
        </Badge>
      </div>

      {/* Progress x/n */}
      {total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11.5px] text-muted-foreground">
            <span>
              {t("agent.step", "Bước")} {Math.min(completed, total)}/{total}
            </span>
            <span>{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>
      )}

      {/* Empty plan (planner degraded / no actionable steps) */}
      {total === 0 && (
        <p className="text-[11.5px] text-muted-foreground">
          {message || t("agent.emptyPlan", "Chưa lập được kế hoạch khả thi.")}
        </p>
      )}

      {/* Step list */}
      {total > 0 && (
        <ol className="space-y-1.5">
          {steps.map((step, i) => {
            const result = resultByIndex.get(i);
            const isCurrent = i === cursor && !isTerminal;
            const isDone = result?.status === "done";
            return (
              <li
                key={i}
                className={cn(
                  "flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors",
                  isCurrent
                    ? "bg-primary/10 ring-1 ring-primary/40 border-l-2 border-primary"
                    : isDone
                      ? "bg-green-50/60 dark:bg-green-950/20"
                      : "bg-background/40",
                )}
              >
                {/* Step number badge for clear ordering on a kiosk */}
                <span className="shrink-0 mt-0.5 flex items-center gap-1">
                  <span
                    className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                      isCurrent
                        ? "bg-primary text-primary-foreground"
                        : isDone
                          ? "bg-green-600 text-white"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  {stepGlyph(i, cursor, result, status)}
                </span>
                <span className="shrink-0 mt-0.5">{kindIcon(step.kind)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
                      {t(`agent.kind.${step.kind}`, step.kind)}
                    </span>
                    {step.tool && (
                      <span className="text-[10.5px] font-mono text-muted-foreground/80 truncate">
                        {step.tool}
                      </span>
                    )}
                  </div>
                  {step.rationale && (
                    <p
                      className={cn(
                        "leading-snug text-[12.5px]",
                        isCurrent ? "font-semibold text-foreground" : "text-foreground/85",
                      )}
                    >
                      {step.rationale}
                    </p>
                  )}
                  {result?.status === "failed" && result.message && (
                    <p className="text-red-600 dark:text-red-400 leading-snug text-[12px]">{result.message}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* Pending write confirm card (re-used from chat bubble) at the current step */}
      {status === "awaiting_confirm" && confirmCard && <div className="pt-0.5">{confirmCard}</div>}

      {/* Paused / terminal message */}
      {message && (status === "paused" || isTerminal) && total > 0 && (
        <p
          className={cn(
            "text-[11.5px] leading-snug",
            status === "failed" || status === "aborted"
              ? "text-red-600 dark:text-red-400"
              : "text-muted-foreground",
          )}
        >
          {message}
        </p>
      )}

      {/* Flow controls */}
      {!isTerminal && (
        <div className="flex items-center gap-1.5 pt-0.5">
          {canApprove && (
            <Button
              size="sm"
              className="h-8 px-3 text-[12.5px] font-semibold"
              disabled={busy}
              onClick={onApprove}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <Play className="size-3.5 mr-1" />}
              {t("agent.start", "Bắt đầu")}
            </Button>
          )}
          {status === "awaiting_confirm" && (
            <span className="flex items-center gap-1 text-[11.5px] text-amber-700 dark:text-amber-400">
              <ArrowRight className="size-3.5" />
              {t("agent.confirmHint", "Xác nhận thao tác ghi ở trên để tiếp tục.")}
            </span>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 px-3 text-[12.5px] ml-auto"
              disabled={busy}
              onClick={onCancel}
            >
              <Square className="size-3.5 mr-1" />
              {t("agent.stop", "Dừng")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
