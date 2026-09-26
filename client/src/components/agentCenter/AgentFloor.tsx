/**
 * AgentFloor — responsive grid of AgentCard tiles (doc69 GĐ4/E2-3).
 */
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentCard } from "./AgentCard";
import type { AgentRosterEntry } from "./types";

export interface AgentFloorProps {
  roster: AgentRosterEntry[] | undefined;
  isLoading: boolean;
  onSelect: (entry: AgentRosterEntry) => void;
}

export function AgentFloor({ roster, isLoading, onSelect }: AgentFloorProps) {
  const { t } = useTranslation();

  if (isLoading && !roster) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[132px] w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!roster || roster.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center text-muted-foreground">
        <Users className="size-6" />
        <p className="text-sm">{t("agentCenter.floor.empty", "Chưa có agent nào trong đội hình.")}</p>
      </div>
    );
  }

  return (
    <div
      role="list"
      aria-label={t("agentCenter.floor.title", "Đội hình Agent")}
      className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3"
    >
      {roster.map((entry) => (
        <div role="listitem" key={entry.id}>
          <AgentCard entry={entry} onClick={() => onSelect(entry)} />
        </div>
      ))}
    </div>
  );
}

export default AgentFloor;
