/**
 * doc 44 W3-B4 / G5.10 — Bảng transition gần nhất (Line View):
 * trpc.lineController.transitions (sổ audit append-only, gồm cả attempt bị
 * POLICY_DENIED — reason tiền tố "POLICY_DENIED:") → DataTable (doc 39 W1).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import { StatusBadge } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";

/** Mirror LineStateTransitionRow (drizzle/schema/lineController.ts) — field UI dùng. */
export interface TransitionRowView {
  id: number;
  fromState: string;
  toState: string;
  reason: string | null;
  triggeredBy: string;
  policyRef: string | null;
  /** superjson giữ Date; phòng cả string cho an toàn. */
  ts: Date | string;
}

const DENIED_PREFIX = "POLICY_DENIED:";

export function TransitionsTable({
  rows,
  loading,
}: {
  rows: TransitionRowView[];
  loading: boolean;
}) {
  const { t } = useTranslation();

  const columns = React.useMemo<DataTableColumn<TransitionRowView>[]>(
    () => [
      {
        id: "ts",
        header: t("lineView.transitions.time", "Thời điểm"),
        cell: (r) => <span className="whitespace-nowrap text-xs">{new Date(r.ts).toLocaleString()}</span>,
        sortValue: (r) => new Date(r.ts),
        alwaysVisible: true,
      },
      {
        id: "change",
        header: t("lineView.transitions.change", "Chuyển"),
        cell: (r) => {
          const denied = (r.reason ?? "").startsWith(DENIED_PREFIX);
          return (
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <StatusBadge status={r.fromState} label={t(`lineView.state.${r.fromState}`, r.fromState)} />
              <span className="text-muted-foreground">→</span>
              <StatusBadge status={r.toState} label={t(`lineView.state.${r.toState}`, r.toState)} />
              {denied && (
                <Badge variant="destructive" className="text-[10px]">
                  {t("lineView.transitions.denied", "BỊ TỪ CHỐI")}
                </Badge>
              )}
            </span>
          );
        },
        filterValue: (r) => `${r.fromState} ${r.toState}`,
      },
      {
        id: "triggeredBy",
        header: t("lineView.transitions.by", "Bởi"),
        cell: (r) => <span className="text-xs">{r.triggeredBy}</span>,
        sortValue: (r) => r.triggeredBy,
        filterValue: (r) => r.triggeredBy,
      },
      {
        id: "reason",
        header: t("lineView.transitions.reason", "Lý do"),
        cell: (r) => {
          if (!r.reason) return <span className="text-muted-foreground">—</span>;
          const denied = r.reason.startsWith(DENIED_PREFIX);
          const text = denied ? r.reason.slice(DENIED_PREFIX.length).trim() : r.reason;
          return (
            <span
              className={
                denied ? "break-words text-xs text-destructive" : "break-words text-xs text-muted-foreground"
              }
              title={r.reason}
            >
              {text}
            </span>
          );
        },
        filterValue: (r) => r.reason ?? "",
      },
      {
        id: "policyRef",
        header: t("lineView.transitions.policyRef", "Policy"),
        cell: (r) =>
          r.policyRef ? (
            <span className="font-mono text-xs">{r.policyRef}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
        filterValue: (r) => r.policyRef ?? "",
      },
    ],
    [t],
  );

  return (
    <DataTable<TransitionRowView>
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      loading={loading}
      pageSize={10}
      initialSort={{ columnId: "ts", dir: "desc" }}
      tableId="line-view-transitions"
    />
  );
}

export default TransitionsTable;
