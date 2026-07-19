/**
 * doc 59 P1 — Machine Workspace fleet rail: a compact, filterable machine list for the
 * master-detail left pane. Selecting a row drives `?machine=:id` in the workspace (the
 * list context the standalone /machine/:id cockpit lacked).
 */
import { useMemo, useState } from "react";
// doc 64 IA-10 S3 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Cpu, Search } from "lucide-react";

interface MachineRow {
  id: number;
  name?: string | null;
  code?: string | null;
  machineType?: string | null;
}

export interface MachineRailProps {
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function MachineRail({ selectedId, onSelect }: MachineRailProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  // doc 64 IA-10 S3-C — rail đổi nguồn sang machineStatus.listWithStatus (đã nhận
  // trục ở DEP-S2): chọn Xưởng/Chuyền/Máy ở header là rail lọc server-side theo,
  // thay vì machine.list toàn-cục (row thiếu parent nên không client-filter được).
  const { scope: assetScope } = useScope(["factory", "line", "machine"]);
  useScopeWired();
  const machinesQ = trpc.machineStatus.listWithStatus.useQuery({
    factoryId: assetScope.factoryId,
    lineId: assetScope.lineId,
    machineId: assetScope.machineId,
  });

  const machines = useMemo(() => {
    const rows = (machinesQ.data ?? []) as MachineRow[];
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((m) => `${m.name ?? ""} ${m.code ?? ""} ${m.machineType ?? ""}`.toLowerCase().includes(needle))
      : rows;
    return [...filtered].sort((a, b) => (a.name ?? a.code ?? "").localeCompare(b.name ?? b.code ?? ""));
  }, [machinesQ.data, q]);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 border-b bg-background/95 p-2 backdrop-blur">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("machineWorkspace.filter", "Lọc thiết bị…")}
            className="h-8 pl-7 text-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {machinesQ.isLoading ? (
          <p className="p-3 text-xs text-muted-foreground">{t("common.loading", "Đang tải…")}</p>
        ) : machines.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">{t("machineWorkspace.noMachines", "Không có thiết bị.")}</p>
        ) : (
          <ul className="divide-y">
            {machines.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelect(m.id)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent/60",
                    selectedId === m.id && "bg-accent font-medium",
                  )}
                >
                  <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{m.name ?? m.code ?? `#${m.id}`}</span>
                  {m.machineType && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{m.machineType}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default MachineRail;
