/**
 * LiveTaskFeed — bottom feed of `taskFeed` items from `getReadModel` (doc69 GĐ4/E2-3).
 * Newest first (server already sorts); honest empty state when nothing is running.
 */
import { useTranslation } from "react-i18next";
import { Activity, Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/patterns";
import { fmtIntCompact, relTimeShort } from "@/lib/format";
import { taskFeedStateTone, type TaskFeedItem } from "./types";

export interface LiveTaskFeedProps {
  items: TaskFeedItem[] | undefined;
  isLoading: boolean;
}

export function LiveTaskFeed({ items, isLoading }: LiveTaskFeedProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          {t("agentCenter.feed.title", "Luồng hoạt động")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && !items ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !items || items.length === 0 ? (
          <div className="py-8 text-center text-[12.5px] text-muted-foreground">
            {t("agentCenter.feed.empty", "Không có hoạt động nào đang chạy.")}
          </div>
        ) : (
          <div className="divide-y">
            {items.map((item) => {
              const stateLabel = t(`aiBrain.agentOps.status.${item.state}`, t(`agentCenter.feed.state.${item.state}`, item.state));
              const personaLabel = t(`agentCenter.persona.${item.agentId}`, item.agentId);
              return (
                <div key={item.id} className="flex items-center gap-3 py-2 text-[12.5px]">
                  <StatusBadge status={item.state} tone={taskFeedStateTone(item.state)} label={stateLabel} className="shrink-0 text-[10.5px] h-5 px-1.5" />
                  <span className="shrink-0 w-32 truncate text-muted-foreground" title={personaLabel}>
                    {personaLabel}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-foreground/90" title={item.label}>
                    {item.label}
                  </span>
                  {item.tokens != null && (
                    <span className="shrink-0 flex items-center gap-1 text-muted-foreground tabular-nums">
                      <Coins className="size-3" />
                      {fmtIntCompact(item.tokens)}
                    </span>
                  )}
                  <span className="shrink-0 w-10 text-right text-muted-foreground tabular-nums">{relTimeShort(item.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default LiveTaskFeed;
