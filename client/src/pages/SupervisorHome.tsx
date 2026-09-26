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
import { PageHeader, PageContainer } from "@/components/patterns";
import { RoleTileGrid } from "@/components/RoleTileGrid";
import { trpc } from "@/lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Users, Building2, Gauge, Factory, BarChart3, FileText, MessageSquareText,
  AlertTriangle, ChevronRight, Cpu, type LucideIcon,
} from "lucide-react";

interface Tile { icon: LucideIcon; label: string; description: string; to: string }

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
    { icon: Building2, label: t("supervisor.tiles.corporate", "Tổng quan tập đoàn"), description: t("supervisor.tiles.corporateDesc", "Rollup theo nhà máy"), to: "/corporate-dashboard" },
    { icon: Gauge, label: t("supervisor.tiles.oee", "OEE & Sức khỏe"), description: t("supervisor.tiles.oeeDesc", "Năng suất & thiết bị"), to: "/oee-dashboard" },
    { icon: Factory, label: t("supervisor.tiles.production", "Sản xuất"), description: t("supervisor.tiles.productionDesc", "Tiến độ dây chuyền"), to: "/production-dashboard" },
    { icon: BarChart3, label: t("supervisor.tiles.analytics", "Phân tích"), description: t("supervisor.tiles.analyticsDesc", "Xu hướng & SPC"), to: "/quality-cockpit?tab=spc" },
    { icon: MessageSquareText, label: t("supervisor.tiles.insight", "Hỏi đáp điều hành"), description: t("supervisor.tiles.insightDesc", "NL Q&A + tóm tắt"), to: "/management-insight" },
    { icon: FileText, label: t("supervisor.tiles.reports", "Báo cáo"), description: t("supervisor.tiles.reportsDesc", "Xuất & lịch báo cáo"), to: "/reports" },
  ];

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Users className="h-6 w-6" />}
          title={t("supervisor.title", "Bảng điều hành giám sát")}
          description={t("supervisor.subtitle", "Tình hình ca & dây chuyền, một chạm tới rollup phù hợp")}
        />

        {/* Role-aware Today summary */}
        <TodayBriefing />

        {/* KPI rollup tiles — doc 60 role-home: shared RoleTileGrid */}
        <RoleTileGrid title={t("supervisor.rollupTitle", "Tổng quan nhanh")} tiles={tiles} />

        {/* Attention / escalation list (recent NG, best-effort) */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("supervisor.attentionTitle", "Cần chú ý")}</h2>
            {ngRows.length > 0 && <Badge variant="outline" className="font-normal">{ngRows.length}</Badge>}
          </div>
          {ngQuery.isLoading ? (
            <div className="space-y-1.5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : ngRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {/* ⚠ "Không có mục cần chú ý" là lời TRẤN AN. Tài khoản chưa gán nhà máy nhận 0
                  dòng vì phạm vi rỗng, không vì dây chuyền sạch — "inspection.search" khai lý
                  do ở "scopeEmptyReason". */}
              {ngQuery.data?.scopeEmptyReason === "no_factory_assignment"
                ? t("common.scopeEmpty.badge")
                : t("supervisor.attentionEmpty", "Không có mục cần chú ý")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {ngRows.map((row, i) => (
                <button
                  key={String(row?.id ?? i)}
                  type="button"
                  onClick={() => navigate(row?.id != null ? `/inspection/${row.id}` : "/history")}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-l-4 border-l-destructive bg-card/60 px-3 py-2 text-left transition-colors hover:bg-muted/50"
                >
                  <AlertTriangle className="size-4 shrink-0 text-destructive" />
                  <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"><Cpu className="size-3" />{row?.machineCode ?? "—"}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row?.serialNumber ?? "—"}{row?.productModel ? <span className="text-muted-foreground"> · {row.productModel}</span> : null}</span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}
        </section>
      </PageContainer>
    </DashboardLayout>
  );
}
