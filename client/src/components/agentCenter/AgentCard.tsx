/**
 * AgentCard — one roster persona tile on the Agent Floor (doc69 GĐ4/E2-3).
 *
 * Status pill uses the EXPLICIT `AGENT_STATUS_TONE` table (types.ts) fed into the
 * repo's shared `<StatusBadge tone=…>` tint system — never a hardcoded hex, and
 * never StatusBadge's own built-in keyword heuristic (which would mis-color
 * "idle" as a warning — see types.ts's docblock). WORKING is visually prominent
 * (accent ring); IDLE/DISABLED are dimmed to a calm standby affordance; tokens
 * stay "—" (not 0) when not attributable — honest, never fabricated.
 */
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  Compass,
  Bot,
  Eye,
  Send,
  GitBranch,
  MessageSquare,
  Clock,
  Moon,
  Coins,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/patterns";
import type { Tone } from "@/components/patterns/tokens";
import { cn } from "@/lib/utils";
import { fmtIntCompact, relTimeShort } from "@/lib/format";
import { AGENT_STATUS_TONE, type AgentKind, type AgentRosterEntry } from "./types";

const KIND_ICON: Record<AgentKind, ComponentType<{ className?: string }>> = {
  orchestrator: Compass,
  specialist: Bot,
  watcher: Eye,
  proactive: Send,
  advisor: GitBranch,
  copilot: MessageSquare,
  scheduled: Clock,
};

const TONE_RING_CLASS: Record<Exclude<Tone, "accent">, string> = {
  default: "border-border",
  success: "border-success/50 ring-1 ring-success/20",
  warning: "border-warning/50 ring-1 ring-warning/20",
  error: "border-destructive/50 ring-1 ring-destructive/20",
  info: "border-info/50 ring-1 ring-info/20",
};

export interface AgentCardProps {
  entry: AgentRosterEntry;
  onClick: () => void;
}

export function AgentCard({ entry, onClick }: AgentCardProps) {
  const { t } = useTranslation();
  const Icon = KIND_ICON[entry.kind] ?? Bot;
  const tone = AGENT_STATUS_TONE[entry.status];
  const isStandby = entry.status === "idle" || entry.status === "disabled";
  const isWorking = entry.status === "working";
  const personaName = t(`agentCenter.persona.${entry.id}`, entry.persona);
  const kindLabel = t(`agentCenter.kind.${entry.kind}`, entry.kind);
  const statusLabel = t(`agentCenter.status.${entry.status}`, entry.status);
  const progressPct =
    entry.progress && entry.progress.total > 0
      ? Math.min(100, Math.round((entry.progress.done / entry.progress.total) * 100))
      : null;

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={t("agentCenter.card.openAria", "Mở chi tiết {{persona}}", { persona: personaName })}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        TONE_RING_CLASS[tone],
        isStandby && "opacity-70 bg-muted/20",
        isWorking && "shadow-sm",
      )}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0 flex items-center gap-1.5">
            <Icon className={cn("size-4 shrink-0", isStandby ? "text-muted-foreground" : "text-primary")} />
            <div className="min-w-0">
              <div className="line-clamp-2 break-words text-[13px] font-semibold leading-tight text-foreground">{personaName}</div>
              <div className="truncate text-[10.5px] uppercase tracking-wide text-muted-foreground">{kindLabel}</div>
            </div>
          </div>
          <StatusBadge status={statusLabel} tone={tone} label={statusLabel} className="shrink-0 text-[10.5px] h-5 px-1.5" />
        </div>

        <div className="min-h-[2.25rem]">
          {entry.currentTask ? (
            <p className="text-[12px] leading-snug text-foreground/90 line-clamp-2">{entry.currentTask}</p>
          ) : (
            <p className="flex items-center gap-1 text-[12px] italic text-muted-foreground">
              <Moon className="size-3" />
              {t("agentCenter.standby", "Đang chờ — không có việc")}
            </p>
          )}
        </div>

        {progressPct !== null && entry.progress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10.5px] text-muted-foreground tabular-nums">
              <span>
                {t("agentCenter.card.progress", "Tiến độ")} {entry.progress.done}/{entry.progress.total}
              </span>
              <span>{progressPct}%</span>
            </div>
            <Progress
              value={progressPct}
              className="h-1.5"
              aria-label={t("agentCenter.card.progressAria", "Tiến độ {{done}} trên {{total}} bước", {
                done: entry.progress.done,
                total: entry.progress.total,
              })}
            />
          </div>
        )}

        <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5 border-t">
          <span className="flex items-center gap-1" title={t("agentCenter.card.tokensToday", "Token hôm nay")}>
            <Coins className="size-3" />
            {fmtIntCompact(entry.tokensToday)}
          </span>
          {entry.updatedAt && <span className="tabular-nums">{relTimeShort(entry.updatedAt)}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export default AgentCard;
