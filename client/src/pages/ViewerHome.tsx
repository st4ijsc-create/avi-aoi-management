/**
 * ViewerHome — "/viewer-home" — a purposeful READ-ONLY front door for viewer/user
 * (doc 10 U3). Previously these roles landed on the marketing Home then fell back to a
 * generic dashboard with edit controls they couldn't use.
 *
 * Read-only by design: a prominent "View Only" badge + tiles that deep-link ONLY to
 * view surfaces (dashboards, reports, history). REUSES <TodayBriefing/>; no write actions.
 * Each underlying page still enforces its own RBAC.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import { PageHeader, PageContainer, MetricCard, ToolTile } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import {
  Eye, LayoutDashboard, FileText, History as HistoryIcon, Gauge, BarChart3, Factory,
  Boxes, CheckCircle2, XCircle, TrendingUp,
  type LucideIcon,
} from "lucide-react";

interface Tile { icon: LucideIcon; label: string; description: string; to: string }

export default function ViewerHome() {
  const { t } = useTranslation();

  // Read-only "today at a glance" — reuses the SAME dashboard.getStats query the
  // other role homes/dashboards use (role-scoped on the server). Never writes.
  const statsQuery = trpc.dashboard.getStats.useQuery(
    {},
    { refetchOnWindowFocus: false, retry: false, staleTime: 60_000 },
  );
  const stats = statsQuery.data as
    | { total?: number; ok?: number; ng?: number; ntf?: number; yieldRate?: number }
    | undefined;
  const loadingStats = statsQuery.isLoading;

  const tiles: Tile[] = [
    { icon: LayoutDashboard, label: t("viewer.tiles.dashboard", "Bảng điều khiển"), description: t("viewer.tiles.dashboardDesc", "Tổng quan KPI"), to: "/dashboard" },
    { icon: Gauge, label: t("viewer.tiles.oee", "OEE"), description: t("viewer.tiles.oeeDesc", "Năng suất thiết bị"), to: "/oee-dashboard" },
    { icon: Factory, label: t("viewer.tiles.production", "Sản xuất"), description: t("viewer.tiles.productionDesc", "Tiến độ dây chuyền"), to: "/production-dashboard" },
    { icon: BarChart3, label: t("viewer.tiles.analytics", "Phân tích"), description: t("viewer.tiles.analyticsDesc", "Xu hướng chất lượng"), to: "/pareto-analysis" },
    { icon: HistoryIcon, label: t("viewer.tiles.history", "Lịch sử"), description: t("viewer.tiles.historyDesc", "Tra cứu kiểm tra"), to: "/history" },
    { icon: FileText, label: t("viewer.tiles.reports", "Báo cáo"), description: t("viewer.tiles.reportsDesc", "Xem báo cáo"), to: "/reports" },
  ];

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Eye className="h-6 w-6" />}
          title={t("viewer.title", "Trang xem nhanh")}
          description={t("viewer.subtitle", "Truy cập nhanh các bảng & báo cáo (chỉ xem)")}
          actions={
            <Badge variant="secondary" className="gap-1"><Eye className="h-3 w-3" />{t("common.viewOnly", "Chỉ xem")}</Badge>
          }
        />

        {/* Read-only "today at a glance" strip (existing dashboard.getStats query) */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("viewer.glanceTitle", "Hôm nay")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <MetricCard
              icon={<TrendingUp className="h-5 w-5" />}
              label={t("viewer.glance.yield", "Tỷ lệ đạt")}
              value={loadingStats ? "…" : stats?.yieldRate != null ? `${stats.yieldRate.toFixed(1)}%` : "—"}
              tone="success"
            />
            <MetricCard
              icon={<Boxes className="h-5 w-5" />}
              label={t("viewer.glance.total", "Tổng sản phẩm")}
              value={loadingStats ? "…" : (stats?.total ?? 0).toLocaleString()}
              tone="info"
            />
            <MetricCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              label={t("viewer.glance.ok", "Đạt (OK)")}
              value={loadingStats ? "…" : (stats?.ok ?? 0).toLocaleString()}
              tone="success"
            />
            <MetricCard
              icon={<XCircle className="h-5 w-5" />}
              label={t("viewer.glance.ng", "Lỗi (NG)")}
              value={loadingStats ? "…" : (stats?.ng ?? 0).toLocaleString()}
              tone="error"
            />
          </div>
        </section>

        <TodayBriefing />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("viewer.viewsTitle", "Các bảng xem")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tiles.map((tile) => (
              <ToolTile key={tile.to} icon={tile.icon} label={tile.label} blurb={tile.description} href={tile.to} />
            ))}
          </div>
        </section>
      </PageContainer>
    </DashboardLayout>
  );
}
