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
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Eye, LayoutDashboard, FileText, History as HistoryIcon, Gauge, BarChart3, Factory,
  type LucideIcon,
} from "lucide-react";

interface Tile { icon: LucideIcon; label: string; description: string; accent: string; to: string }

function ToolTile({ icon: Icon, label, description, accent, onClick }: Tile & { onClick: () => void }) {
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

export default function ViewerHome() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  const tiles: Tile[] = [
    { icon: LayoutDashboard, label: t("viewer.tiles.dashboard", "Bảng điều khiển"), description: t("viewer.tiles.dashboardDesc", "Tổng quan KPI"), accent: "border-sky-500/30 text-sky-600 dark:text-sky-400", to: "/dashboard" },
    { icon: Gauge, label: t("viewer.tiles.oee", "OEE"), description: t("viewer.tiles.oeeDesc", "Năng suất thiết bị"), accent: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400", to: "/oee-dashboard" },
    { icon: Factory, label: t("viewer.tiles.production", "Sản xuất"), description: t("viewer.tiles.productionDesc", "Tiến độ dây chuyền"), accent: "border-indigo-500/30 text-indigo-600 dark:text-indigo-400", to: "/production-dashboard" },
    { icon: BarChart3, label: t("viewer.tiles.analytics", "Phân tích"), description: t("viewer.tiles.analyticsDesc", "Xu hướng chất lượng"), accent: "border-violet-500/30 text-violet-600 dark:text-violet-400", to: "/pareto-analysis" },
    { icon: HistoryIcon, label: t("viewer.tiles.history", "Lịch sử"), description: t("viewer.tiles.historyDesc", "Tra cứu kiểm tra"), accent: "border-slate-500/30 text-slate-600 dark:text-slate-400", to: "/history" },
    { icon: FileText, label: t("viewer.tiles.reports", "Báo cáo"), description: t("viewer.tiles.reportsDesc", "Xem báo cáo"), accent: "border-amber-500/30 text-amber-600 dark:text-amber-400", to: "/reports" },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Eye className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
              {t("viewer.title", "Trang xem nhanh")}
              <Badge variant="secondary" className="gap-1"><Eye className="h-3 w-3" />{t("common.viewOnly", "Chỉ xem")}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">{t("viewer.subtitle", "Truy cập nhanh các bảng & báo cáo (chỉ xem)")}</p>
          </div>
        </div>

        <TodayBriefing />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("viewer.viewsTitle", "Các bảng xem")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tiles.map((tile) => <ToolTile key={tile.to} {...tile} onClick={() => navigate(tile.to)} />)}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
