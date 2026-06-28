/**
 * QualityHome — "/quality-home" — the inspection WORKSPACE front door for the
 * quality_inspector role (P1, doc 07 §④).
 *
 * Goal: zero-click situational awareness for QC, then one click to the right
 * tool. Everything REUSES existing surfaces — nothing is rebuilt:
 *   - <TodayBriefing/>                role-aware glanceable summary (quality variant)
 *   - quick tiles → SPC / Pareto / defect-heatmap / quality-gates / AOI packages /
 *     history review / annotation
 *   - a "recent NG / review-needed" list backed by the existing
 *     trpc.inspection.search query (result = NG), each row deep-linking to the
 *     inspection detail.
 *
 * Rendered inside DashboardLayout like the other pages. Not role-locked: any
 * authenticated role can view it, but it is purpose-built for QC and is their
 * default landing (see roleLanding.ts). Each underlying page enforces its own RBAC.
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
  ClipboardCheck,
  Brain,
  BarChart3,
  Map,
  ShieldCheck,
  Camera,
  History as HistoryIcon,
  Brush,
  AlertTriangle,
  ChevronRight,
  Cpu,
  type LucideIcon,
} from "lucide-react";

// ─── A quick-access tool tile (icon + label + short description) ───────────────

interface ToolTileProps {
  icon: LucideIcon;
  label: string;
  description: string;
  accent: string;
  onClick: () => void;
}

function ToolTile({ icon: Icon, label, description, accent, onClick }: ToolTileProps) {
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
      <span className="text-base font-semibold leading-tight tracking-tight text-foreground">
        {label}
      </span>
      <span className="text-xs leading-snug text-muted-foreground">{description}</span>
    </button>
  );
}

// ─── A recent-NG row (deep-links to the inspection detail) ─────────────────────

interface NgRow {
  id?: string | number;
  serialNumber?: string;
  machineCode?: string;
  productModel?: string;
  result?: string;
  inspectedAt?: string | number | Date;
}

function NgItem({ row, onClick }: { row: NgRow; onClick: () => void }) {
  const when = row?.inspectedAt ? new Date(row.inspectedAt) : null;
  const whenStr = when && !isNaN(when.getTime()) ? when.toLocaleString() : "";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg border border-l-4 border-l-red-500 bg-card/60 px-3 py-2 text-left transition-colors hover:bg-muted/50",
      )}
    >
      <AlertTriangle className="size-4 shrink-0 text-red-600 dark:text-red-400" />
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
        <Cpu className="size-3" />
        {row?.machineCode ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">
        {row?.serialNumber ?? "—"}
        {row?.productModel ? (
          <span className="text-muted-foreground"> · {row.productModel}</span>
        ) : null}
      </span>
      {whenStr ? (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{whenStr}</span>
      ) : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export default function QualityHome() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  // Recent NG / review-needed — reuse the existing inspection.search query.
  // Best-effort: never blocks the page (own error/loading states).
  const ngQuery = trpc.inspection.search.useQuery(
    { result: "NG", limit: 8, offset: 0 } as any,
    { refetchOnWindowFocus: false, retry: false, staleTime: 60_000 },
  );
  const ngRows: NgRow[] = (ngQuery.data as any)?.data ?? [];

  const tools: ToolTileProps[] = [
    {
      icon: ShieldCheck,
      label: t("quality.tools.qualityGates"),
      description: t("quality.tools.qualityGatesDesc"),
      accent: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
      onClick: () => navigate("/quality-gates"),
    },
    {
      icon: Brain,
      label: t("quality.tools.spc"),
      description: t("quality.tools.spcDesc"),
      accent: "border-violet-500/30 text-violet-600 dark:text-violet-400",
      onClick: () => navigate("/spc-analysis"),
    },
    {
      icon: BarChart3,
      label: t("quality.tools.pareto"),
      description: t("quality.tools.paretoDesc"),
      accent: "border-sky-500/30 text-sky-600 dark:text-sky-400",
      onClick: () => navigate("/pareto-analysis"),
    },
    {
      icon: Map,
      label: t("quality.tools.defectHeatmap"),
      description: t("quality.tools.defectHeatmapDesc"),
      accent: "border-amber-500/30 text-amber-600 dark:text-amber-400",
      onClick: () => navigate("/defect-heatmap"),
    },
    {
      icon: Camera,
      label: t("quality.tools.aoiPackages"),
      description: t("quality.tools.aoiPackagesDesc"),
      accent: "border-cyan-500/30 text-cyan-600 dark:text-cyan-400",
      onClick: () => navigate("/aoi-packages"),
    },
    {
      icon: HistoryIcon,
      label: t("quality.tools.historyReview"),
      description: t("quality.tools.historyReviewDesc"),
      accent: "border-slate-500/30 text-slate-600 dark:text-slate-400",
      onClick: () => navigate("/history"),
    },
    {
      icon: Brush,
      label: t("quality.tools.annotation"),
      description: t("quality.tools.annotationDesc"),
      accent: "border-rose-500/30 text-rose-600 dark:text-rose-400",
      onClick: () => navigate("/mask-annotation"),
    },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <ClipboardCheck className="h-7 w-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {t("quality.title")}
            </h1>
            <p className="text-sm text-muted-foreground">{t("quality.subtitle")}</p>
          </div>
        </div>

        {/* Role-aware "Today" summary (quality variant, zero-click) */}
        <TodayBriefing />

        {/* Quick-access QC tools */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("quality.toolsTitle")}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tools.map((tool) => (
              <ToolTile key={tool.label} {...tool} />
            ))}
          </div>
        </section>

        {/* Recent NG / review-needed */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t("quality.recentNgTitle")}
            </h2>
            {ngRows.length > 0 && (
              <Badge variant="outline" className="font-normal">
                {ngRows.length}
              </Badge>
            )}
          </div>

          {ngQuery.isLoading ? (
            <div className="space-y-1.5">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : ngQuery.isError ? (
            <p className="text-sm text-muted-foreground">{t("quality.recentNgError")}</p>
          ) : ngRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("quality.recentNgEmpty")}</p>
          ) : (
            <div className="space-y-1.5">
              {ngRows.map((row, i) => (
                <NgItem
                  key={String(row?.id ?? i)}
                  row={row}
                  onClick={() =>
                    navigate(row?.id != null ? `/inspection/${row.id}` : "/history")
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
