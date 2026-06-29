/**
 * SupervisorHome — "/supervisor-home" — the briefing front door for supervisor/manager
 * (doc 10 U1). Previously these roles fell back to /management-insight or the generic
 * dashboard with no tailored landing.
 *
 * Zero-click situational awareness then one click to the right rollup. REUSES existing
 * surfaces — nothing rebuilt: <TodayBriefing/> (role-aware), KPI rollup tiles deep-linking
 * to corporate / OEE / production / analytics / reports / NL Q&A, and an "attention" list
 * (recent NG, best-effort via the existing inspection.search) for the escalation queue.
 * Rendered in DashboardLayout; each underlying page enforces its own RBAC.
 */
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Users, Building2, Gauge, Factory, BarChart3, FileText, MessageSquareText,
  AlertTriangle, ChevronRight, Cpu, type LucideIcon,
} from "lucide-react";

interface Tile { icon: LucideIcon; label: string; description: string; accent: string; to: string }

function ToolTile({ icon: Icon, label, description, accent, onClick }: Tile & { onClick: () => void } & { to?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[88px] flex-col items-start gap-1.5 rounded-xl border p-4 text-left",
        "transition-colors active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        "bg-card hover:bg-muted/60 shadow-sm",
        accent,
      )}
    >
      <Icon className="h-6 w-6 shrink-0" strokeWidth={2.1} />
      <span className="text-base font-semibold leading-tight tracking-tight text-foreground">{label}</span>
      <span className="text-xs leading-snug text-muted-foreground">{description}</span>
    </button>
  );
}

interface NgRow { id?: string | number; serialNumber?: string; machineCode?: string; productModel?: string; inspectedAt?: string | number | Date }

export default function SupervisorHome() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  const ngQuery = trpc.inspection.search.useQuery(
    { result: "NG", limit: 8, offset: 0 } as any,
    { refetchOnWindowFocus: false, retry: false, staleTime: 60_000 },
  );
  const ngRows: NgRow[] = (ngQuery.data as any)?.data ?? [];

  const tiles: Tile[] = [
    { icon: Building2, label: t("supervisor.tiles.corporate", "Tổng quan tập đoàn"), description: t("supervisor.tiles.corporateDesc", "Rollup theo nhà máy"), accent: "border-indigo-500/30 text-indigo-600 dark:text-indigo-400", to: "/corporate-dashboard" },
    { icon: Gauge, label: t("supervisor.tiles.oee", "OEE & Sức khỏe"), description: t("supervisor.tiles.oeeDesc", "Năng suất & thiết bị"), accent: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400", to: "/oee-dashboard" },
    { icon: Factory, label: t("supervisor.tiles.production", "Sản xuất"), description: t("supervisor.tiles.productionDesc", "Tiến độ dây chuyền"), accent: "border-sky-500/30 text-sky-600 dark:text-sky-400", to: "/production-dashboard" },
    { icon: BarChart3, label: t("supervisor.tiles.analytics", "Phân tích"), description: t("supervisor.tiles.analyticsDesc", "Xu hướng & SPC"), accent: "border-violet-500/30 text-violet-600 dark:text-violet-400", to: "/spc-analysis" },
    { icon: MessageSquareText, label: t("supervisor.tiles.insight", "Hỏi đáp điều hành"), description: t("supervisor.tiles.insightDesc", "NL Q&A + tóm tắt"), accent: "border-amber-500/30 text-amber-600 dark:text-amber-400", to: "/management-insight" },
    { icon: FileText, label: t("supervisor.tiles.reports", "Báo cáo"), description: t("supervisor.tiles.reportsDesc", "Xuất & lịch báo cáo"), accent: "border-slate-500/30 text-slate-600 dark:text-slate-400", to: "/reports" },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Users className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("supervisor.title", "Bảng điều hành giám sát")}</h1>
            <p className="text-sm text-muted-foreground">{t("supervisor.subtitle", "Tình hình ca & dây chuyền, một chạm tới rollup phù hợp")}</p>
          </div>
        </div>

        {/* Role-aware Today summary */}
        <TodayBriefing />

        {/* KPI rollup tiles */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("supervisor.rollupTitle", "Tổng quan nhanh")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tiles.map((tile) => <ToolTile key={tile.to} {...tile} onClick={() => navigate(tile.to)} />)}
          </div>
        </section>

        {/* Attention / escalation list (recent NG, best-effort) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("supervisor.attentionTitle", "Cần chú ý")}</h2>
            {ngRows.length > 0 && <Badge variant="outline" className="font-normal">{ngRows.length}</Badge>}
          </div>
          {ngQuery.isLoading ? (
            <div className="space-y-1.5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : ngRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("supervisor.attentionEmpty", "Không có mục cần chú ý")}</p>
          ) : (
            <div className="space-y-1.5">
              {ngRows.map((row, i) => (
                <button
                  key={String(row?.id ?? i)}
                  type="button"
                  onClick={() => navigate(row?.id != null ? `/inspection/${row.id}` : "/history")}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-l-4 border-l-red-500 bg-card/60 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <AlertTriangle className="size-4 shrink-0 text-red-600 dark:text-red-400" />
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"><Cpu className="size-3" />{row?.machineCode ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row?.serialNumber ?? "—"}{row?.productModel ? <span className="text-muted-foreground"> · {row.productModel}</span> : null}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
