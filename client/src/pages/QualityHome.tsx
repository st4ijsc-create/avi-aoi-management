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
import { PageHeader, PageContainer, ToolTile } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
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
  CheckCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

// ─── A quick-access tool tile definition (mapped onto the shared <ToolTile>) ───

interface ToolTileDef {
  icon: LucideIcon;
  label: string;
  description: string;
  to: string;
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

function NgItem({ row, onClick, onAck, ackDisabled }: { row: NgRow; onClick: () => void; onAck?: () => void; ackDisabled?: boolean }) {
  const when = row?.inspectedAt ? new Date(row.inspectedAt) : null;
  const whenStr = when && !isNaN(when.getTime()) ? when.toLocaleString() : "";
  return (
    <div className="flex w-full items-center gap-2.5 rounded-lg border border-l-4 border-l-destructive bg-card/60 px-3 py-2 transition-colors hover:bg-muted/50">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <AlertTriangle className="size-4 shrink-0 text-destructive" />
        <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          <Cpu className="size-3" />
          {row?.machineCode ?? "—"}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">
          {row?.serialNumber ?? "—"}
          {row?.productModel ? <span className="text-muted-foreground"> · {row.productModel}</span> : null}
        </span>
        {whenStr ? <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{whenStr}</span> : null}
      </button>
      {onAck && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          disabled={ackDisabled}
          onClick={onAck}
          title="Đã xem / Acknowledge"
        >
          <CheckCheck className="size-4 text-success" />
        </Button>
      )}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );
}

export default function QualityHome() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { hasPermission } = usePermissions();
  // U10 — QC can clear (acknowledge) a reviewed NG in one tap. Gated by write access.
  const canReview = hasPermission("history_view", "canEdit");

  // Recent NG / review-needed — reuse the existing inspection.search query.
  // Best-effort: never blocks the page (own error/loading states).
  const ngQuery = trpc.inspection.search.useQuery(
    { result: "NG", limit: 8, offset: 0 } as any,
    { refetchOnWindowFocus: false, retry: false, staleTime: 60_000 },
  );
  const ngRows: NgRow[] = (ngQuery.data as any)?.data ?? [];

  // W5-B (doc 27 F2) — open repair dispositions count (never blocks the page).
  const openDispQ = trpc.defectDisposition.countOpen.useQuery(undefined, {
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });

  const ackM = trpc.measurementResult.batchAcknowledge.useMutation({
    onSuccess: () => {
      toast.success(t("quality.ackDone", "Đã đánh dấu đã xem"));
      ngQuery.refetch();
    },
    onError: (e: { message: string }) => toast.error(e.message),
  });

  const tools: ToolTileDef[] = [
    {
      icon: ShieldCheck,
      label: t("quality.tools.qualityGates"),
      description: t("quality.tools.qualityGatesDesc"),
      to: "/quality-gates",
    },
    {
      icon: Brain,
      label: t("quality.tools.spc"),
      description: t("quality.tools.spcDesc"),
      to: "/spc-analysis",
    },
    {
      icon: BarChart3,
      label: t("quality.tools.pareto"),
      description: t("quality.tools.paretoDesc"),
      to: "/pareto-analysis",
    },
    {
      icon: Map,
      label: t("quality.tools.defectHeatmap"),
      description: t("quality.tools.defectHeatmapDesc"),
      to: "/defect-heatmap",
    },
    {
      icon: Camera,
      label: t("quality.tools.aoiPackages"),
      description: t("quality.tools.aoiPackagesDesc"),
      to: "/aoi-packages",
    },
    {
      icon: HistoryIcon,
      label: t("quality.tools.historyReview"),
      description: t("quality.tools.historyReviewDesc"),
      to: "/history",
    },
    {
      icon: Brush,
      label: t("quality.tools.annotation"),
      description: t("quality.tools.annotationDesc"),
      to: "/mask-annotation",
    },
    // Doc 10 U10 — surface the review/approval queue (auto-accept/reject thresholds) for QC.
    {
      icon: ClipboardCheck,
      label: t("quality.tools.approvals", "Duyệt ngưỡng"),
      description: t("quality.tools.approvalsDesc", "Hàng đợi phê duyệt ngưỡng NG"),
      to: "/threshold-approvals",
    },
  ];

  return (
    <DashboardLayout>
      <PageContainer>
        {/* Header */}
        <PageHeader
          icon={<ClipboardCheck className="h-6 w-6" />}
          title={t("quality.title")}
          description={t("quality.subtitle")}
        />

        {/* Role-aware "Today" summary (quality variant, zero-click) */}
        <TodayBriefing />

        {/* W5-B (doc 27 F2) — open repair dispositions at a glance. Dispositions
            live on each inspection detail page; /history (NG filter) is the way in. */}
        {openDispQ.isSuccess && (
          <button
            type="button"
            onClick={() => navigate("/history")}
            className="flex w-full items-center gap-3 rounded-lg border border-l-4 border-l-warning bg-card/60 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          >
            <Wrench className="size-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {t("disposition.openCount", "Disposition đang mở")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("disposition.openCountDesc", "Board NG đang chờ sửa / kiểm lại — mở từ trang chi tiết kiểm tra")}
              </p>
            </div>
            <Badge variant={openDispQ.data > 0 ? "destructive" : "outline"} className="shrink-0 text-sm">
              {openDispQ.data}
            </Badge>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </button>
        )}

        {/* Quick-access QC tools */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("quality.toolsTitle")}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tools.map((tool) => (
              <ToolTile
                key={tool.label}
                icon={tool.icon}
                label={tool.label}
                blurb={tool.description}
                href={tool.to}
              />
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
                  onAck={canReview && row?.id != null ? () => ackM.mutate({ ids: [String(row.id)] }) : undefined}
                  ackDisabled={ackM.isPending}
                />
              ))}
            </div>
          )}
        </section>
      </PageContainer>
    </DashboardLayout>
  );
}
