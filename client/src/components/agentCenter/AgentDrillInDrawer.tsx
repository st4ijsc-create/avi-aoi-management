/**
 * AgentDrillInDrawer — the Command Center's drill-in (doc69 GĐ4/E2-3), opened by
 * clicking an AgentCard. Renders inside the repo's shared `<ContextDrawer>` (the
 * SAME right-side panel primitive other workspaces use).
 *
 * ORCHESTRATOR persona → lists the ops-wide sessions already carried by the
 * read-model (`sessions`, no extra query) and, on picking one, fetches
 * `trpc.aiAgent.getSession` to REUSE `AgentPlanCard` verbatim for the full
 * plan/stepResults view. `getSession` is OWNER-ONLY (see server/routers/
 * aiAgentRouter.ts: "Fetch session state (owner only)") — for a session the
 * viewer does not own (the common case in an ops-wide roster) it returns null,
 * and this drawer HONESTLY falls back to the OpsSessionSummary fields the
 * read-model already carries, with a note explaining the limitation, and NO
 * approve/confirm/cancel controls (the backend would reject them anyway).
 *
 * HITL: this drawer NEVER auto-executes. The only mutations wired are the
 * EXISTING `approvePlan` / `confirmStep` / `cancelSession` — all owner-scoped
 * server-side, all human-triggered by a click here. The write-step confirm
 * affordance is a MINIMAL custom card (tool + step rationale, both already
 * present in `plan.steps`/`stepResults`) rather than the full `ConfirmActionCard`
 * diff preview: that richer preview (`preview.changes/warnings/humanSummary`) is
 * only ever emitted live over the chat SSE stream (AILocalChatBubble) and is not
 * persisted behind any query this polling-based page can call — reusing it here
 * would require new backend, which this task does not add. `confirmStep`'s
 * `token` parameter is passed as the `actionId` itself — this mirrors the
 * repo's OWN existing convention (server/services/aiActionInbox.ts's
 * `token: r.id`, validated by confirmAction's `token !== row.id` check: the
 * pending-action row's id doubles as its own confirm token by design).
 *
 * SPECIALIST / other kinds → a simple read-only step/summary renderer: the
 * roster entry's own fields + the task-feed items already tagged with this
 * agent's id (no extra query, no mutations — none exist at this scope).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { AlertCircle, CheckCircle2, Loader2, ChevronRight, User, Info } from "lucide-react";
import { ContextDrawer } from "@/components/workspace/ContextDrawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { usePollingInterval } from "@/hooks/usePollingInterval";
import { fmtIntCompact, relTimeShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AgentPlanCard } from "@/components/AgentPlanCard";
import { taskFeedStateTone, type AgentRosterEntry, type AgentSessionDetail, type OpsSessionSummary, type TaskFeedItem } from "./types";

export interface AgentDrillInDrawerProps {
  entry: AgentRosterEntry | null;
  onOpenChange: (open: boolean) => void;
  sessions: OpsSessionSummary[];
  taskFeed: TaskFeedItem[];
  currentUserId: number | undefined;
  /** Called after any steer mutation succeeds, so the parent can refetch the read-model. */
  onMutated: () => void;
}

function PendingWriteCard({ detail, busy, onConfirm }: { detail: AgentSessionDetail; busy: boolean; onConfirm: () => void }) {
  const { t } = useTranslation();
  const current = detail.stepResults[detail.stepResults.length - 1];
  const step = current && current.index >= 0 ? detail.plan.steps[current.index] : undefined;
  if (!current || current.status !== "awaiting_confirm" || !current.actionId) return null;
  return (
    <div className="rounded-lg border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-2.5 space-y-1.5 text-[12.5px]">
      <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
        <AlertCircle className="size-4 shrink-0" />
        {t("agentCenter.drawer.pendingWrite.title", "Thao tác ghi đang chờ bạn xác nhận")}
      </div>
      {step?.tool && <p className="font-mono text-[11px] text-muted-foreground">{step.tool}</p>}
      {step?.rationale && <p className="text-foreground/90 leading-snug">{step.rationale}</p>}
      <Button size="sm" className="h-8 px-3 text-[12.5px]" disabled={busy} onClick={onConfirm}>
        {busy ? <Loader2 className="size-3.5 animate-spin mr-1" /> : <CheckCircle2 className="size-3.5 mr-1" />}
        {t("agentCenter.drawer.pendingWrite.confirmButton", "Xác nhận thực hiện")}
      </Button>
    </div>
  );
}

function SessionRow({ session, selected, isOwn, onClick }: { session: OpsSessionSummary; selected: boolean; isOwn: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-[12px] transition-colors",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", selected && "rotate-90")} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground/90">{session.goal}</div>
        <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground">
          <span title={isOwn ? t("agentCenter.drawer.ownSession", "Phiên của bạn") : undefined}>
            <User className={cn("size-3", isOwn && "text-primary")} />
          </span>
          {session.username ?? `#${session.userId}`}
          <span>·</span>
          <span className="tabular-nums">
            {session.stepIndex}/{session.stepTotal}
          </span>
        </div>
      </div>
      <StatusBadge
        status={session.status}
        tone={taskFeedStateTone(session.status)}
        label={t(`aiBrain.agentOps.status.${session.status}`, session.status)}
        className="shrink-0 text-[10px] h-5 px-1.5"
      />
      <span className="shrink-0 w-8 text-right text-[10.5px] text-muted-foreground tabular-nums">{relTimeShort(session.updatedAt)}</span>
    </button>
  );
}

function OrchestratorDetail({ entry, sessions, currentUserId, onMutated }: { entry: AgentRosterEntry; sessions: OpsSessionSummary[]; currentUserId: number | undefined; onMutated: () => void }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => setSelectedId(null), [entry.id]);

  const polling = usePollingInterval(5000);
  const detailQuery = trpc.aiAgent.getSession.useQuery(
    { sessionId: selectedId ?? "" },
    { ...polling, enabled: !!selectedId },
  );

  const approveMut = trpc.aiAgent.approvePlan.useMutation({
    onSuccess: () => {
      detailQuery.refetch();
      onMutated();
    },
    onError: (err: any) => toast.error(err?.message ?? t("agentCenter.drawer.approveError", "Không thể duyệt kế hoạch.")),
  });
  const confirmMut = trpc.aiAgent.confirmStep.useMutation({
    onSuccess: () => {
      detailQuery.refetch();
      onMutated();
    },
    onError: (err: any) => toast.error(err?.message ?? t("agentCenter.drawer.pendingWrite.confirmError", "Không thể xác nhận thao tác.")),
  });
  const cancelMut = trpc.aiAgent.cancelSession.useMutation({
    onSuccess: () => {
      toast.success(t("aiBrain.agentOps.cancelSuccess", "Đã hủy phiên agent."));
      detailQuery.refetch();
      onMutated();
    },
    onError: (err: any) => toast.error(err?.message ?? t("aiBrain.agentOps.cancelError", "Không thể hủy phiên agent.")),
  });

  const busy = approveMut.isPending || confirmMut.isPending || cancelMut.isPending;
  const detail = detailQuery.data as AgentSessionDetail | null | undefined;
  const summaryFallback = sessions.find((s) => s.id === selectedId);

  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          {t("agentCenter.drawer.sessionsTitle", "Phiên gần đây")}
        </div>
        {sessions.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-2">{t("agentCenter.drawer.noSessions", "Không có phiên nào gần đây.")}</p>
        ) : (
          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {sessions.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                selected={s.id === selectedId}
                isOwn={s.userId === currentUserId}
                onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedId && (
        <div className="border-t pt-3">
          {detailQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : detail ? (
            <AgentPlanCard
              goal={detail.goal}
              plan={detail.plan}
              status={detail.status}
              cursor={detail.cursor}
              stepResults={detail.stepResults}
              busy={busy}
              onApprove={() => approveMut.mutate({ sessionId: selectedId })}
              onCancel={() => cancelMut.mutate({ sessionId: selectedId })}
              confirmCard={
                detail.status === "awaiting_confirm" ? (
                  <PendingWriteCard
                    detail={detail}
                    busy={confirmMut.isPending}
                    onConfirm={() => {
                      const current = detail.stepResults[detail.stepResults.length - 1];
                      if (!current?.actionId) return;
                      // token = actionId (repo convention — see file docblock).
                      confirmMut.mutate({ sessionId: selectedId, actionId: current.actionId, token: current.actionId });
                    }}
                  />
                ) : null
              }
            />
          ) : summaryFallback ? (
            <div className="space-y-2 rounded-lg border p-2.5 text-[12.5px]">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Info className="size-3.5 shrink-0" />
                {t("agentCenter.drawer.ownerOnlyNote", "Chi tiết đầy đủ (kế hoạch, các bước) chỉ hiển thị cho người tạo phiên. Đây là bản tóm tắt.")}
              </div>
              <p className="font-medium text-foreground/90">{summaryFallback.goal}</p>
              <div className="flex items-center gap-2">
                <StatusBadge
                  status={summaryFallback.status}
                  tone={taskFeedStateTone(summaryFallback.status)}
                  label={t(`aiBrain.agentOps.status.${summaryFallback.status}`, summaryFallback.status)}
                  className="text-[10.5px] h-5 px-1.5"
                />
                <span className="text-muted-foreground tabular-nums">
                  {summaryFallback.stepIndex}/{summaryFallback.stepTotal}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

const SPECIALIST_ROSTER_PREFIX = "specialist-";

/**
 * Wave 1 T5 — roster ids for the "specialist" kind are built by
 * `specialistRosterId()` (server/services/aiAgentCenterService.ts) as
 * `specialist-<agentId>` (e.g. `specialist-data-analyst`). The Studio's
 * `?agent=` query param expects the bare id (`data-analyst`) — strip the
 * roster prefix, not a generic "first dash" split.
 */
function specialistIdOf(rosterId: string): string {
  return rosterId.startsWith(SPECIALIST_ROSTER_PREFIX) ? rosterId.slice(SPECIALIST_ROSTER_PREFIX.length) : rosterId;
}

function SimpleAgentDetail({ entry, taskFeed }: { entry: AgentRosterEntry; taskFeed: TaskFeedItem[] }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const items = useMemo(() => taskFeed.filter((i) => i.agentId === entry.id), [taskFeed, entry.id]);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-2.5 space-y-1.5 text-[12.5px]">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t("agentCenter.drawer.currentTask", "Công việc hiện tại")}</span>
        </div>
        <p className="text-foreground/90">{entry.currentTask ?? t("agentCenter.standby", "Đang chờ — không có việc")}</p>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t">
          <span>
            {t("agentCenter.drawer.tokensToday", "Token hôm nay")}: {fmtIntCompact(entry.tokensToday)}
          </span>
          {entry.updatedAt && <span>{relTimeShort(entry.updatedAt)}</span>}
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
          {t("agentCenter.drawer.recentActivity", "Hoạt động gần đây")}
        </div>
        {items.length === 0 ? (
          <p className="text-[12px] text-muted-foreground py-2">{t("agentCenter.drawer.noActivity", "Chưa có hoạt động nào.")}</p>
        ) : (
          <div className="divide-y">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 py-1.5 text-[12px]">
                <StatusBadge
                  status={item.state}
                  tone={taskFeedStateTone(item.state)}
                  label={t(`aiBrain.agentOps.status.${item.state}`, t(`agentCenter.feed.state.${item.state}`, item.state))}
                  className="shrink-0 text-[10px] h-5 px-1.5"
                />
                <span className="min-w-0 flex-1 truncate" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{relTimeShort(item.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {entry.kind === "specialist" ? (
        <Button
          className="w-full"
          onClick={() => navigate(`/ai-specialist-studio?agent=${encodeURIComponent(specialistIdOf(entry.id))}`)}
        >
          {t("agentCenter.dispatchWork", "Giao việc →")}
        </Button>
      ) : (
        <p className="text-[11px] text-muted-foreground italic">{t("agentCenter.drawer.readOnlyNote", "Xem nhanh — chưa có hành động khả dụng ở đây.")}</p>
      )}
    </div>
  );
}

export function AgentDrillInDrawer({ entry, onOpenChange, sessions, taskFeed, currentUserId, onMutated }: AgentDrillInDrawerProps) {
  const { t } = useTranslation();
  const personaName = entry ? t(`agentCenter.persona.${entry.id}`, entry.persona) : "";
  const kindLabel = entry ? t(`agentCenter.kind.${entry.kind}`, entry.kind) : undefined;

  return (
    <ContextDrawer open={!!entry} onOpenChange={onOpenChange} title={personaName} description={kindLabel}>
      {entry ? (
        entry.kind === "orchestrator" ? (
          <OrchestratorDetail entry={entry} sessions={sessions} currentUserId={currentUserId} onMutated={onMutated} />
        ) : (
          <SimpleAgentDetail entry={entry} taskFeed={taskFeed} />
        )
      ) : null}
    </ContextDrawer>
  );
}

export default AgentDrillInDrawer;
