/**
 * AdminHome — "/admin-home" — an admin briefing front door (doc 10 U5). Admins previously
 * landed on the generic ops /dashboard with no admin-specific summary. This surfaces the
 * governance/admin surfaces (users, roles, license, audit, system config, API keys, edge
 * nodes) as one-click tiles + a role-aware TodayBriefing. REUSES existing pages — nothing
 * rebuilt; each underlying page keeps its own RBAC (admin-gated).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import { PageHeader, MetricCard, type MetricTone } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  ShieldCheck, Users, KeyRound, FileClock, SlidersHorizontal, Cpu,
  LayoutDashboard, Activity, Archive, MonitorSmartphone, MonitorCheck,
  HeartPulse, type LucideIcon,
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

export default function AdminHome() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  // ── Live admin KPIs — all from EXISTING tRPC procedures (read-only) ──
  const usersQuery = trpc.user.list.useQuery(undefined, {
    refetchOnWindowFocus: false, retry: false, staleTime: 60_000,
  });
  const sessionsQuery = trpc.session.count.useQuery(undefined, {
    refetchOnWindowFocus: false, retry: false, staleTime: 60_000,
  });
  const licenseState = trpc.license.systemState.useQuery(undefined, {
    refetchOnWindowFocus: false, retry: false, staleTime: 60_000,
  });
  const licenseStats = trpc.license.admin.stats.useQuery(undefined, {
    refetchOnWindowFocus: false, retry: false, staleTime: 60_000,
  });

  const userKpis = useMemo(() => {
    const all = usersQuery.data ?? [];
    const active = all.filter((u: any) => u?.isActive !== false).length;
    return { total: all.length, active };
  }, [usersQuery.data]);

  // Map license enforcement state → label + tone (state values from licenseRouter.systemState)
  const licenseView = useMemo(() => {
    const state = licenseState.data?.state;
    const map: Record<string, { labelKey: string; labelDefault: string; tone: MetricTone }> = {
      normal:      { labelKey: "adminHome.kpi.licenseNormal",   labelDefault: "Hợp lệ",        tone: "success" },
      warning:     { labelKey: "adminHome.kpi.licenseWarning",  labelDefault: "Sắp hết hạn",   tone: "warning" },
      readonly:    { labelKey: "adminHome.kpi.licenseReadonly", labelDefault: "Chỉ đọc",       tone: "warning" },
      locked:      { labelKey: "adminHome.kpi.licenseLocked",   labelDefault: "Đã khóa",       tone: "error" },
      no_license:  { labelKey: "adminHome.kpi.licenseNone",     labelDefault: "Chưa kích hoạt", tone: "error" },
    };
    const entry = (state && map[state]) || { labelKey: "common.noData", labelDefault: "—", tone: "default" as MetricTone };
    return { value: t(entry.labelKey, entry.labelDefault), tone: entry.tone, days: licenseState.data?.daysUntilExpiry ?? null };
  }, [licenseState.data, t]);

  const tiles: Tile[] = [
    { icon: Users, label: t("adminHome.tiles.users", "Người dùng"), description: t("adminHome.tiles.usersDesc", "Tài khoản & vai trò"), accent: "border-indigo-500/30 text-indigo-600 dark:text-indigo-400", to: "/users" },
    { icon: ShieldCheck, label: t("adminHome.tiles.roles", "Phân quyền"), description: t("adminHome.tiles.rolesDesc", "Role builder & module"), accent: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400", to: "/role-builder" },
    { icon: FileClock, label: t("adminHome.tiles.audit", "Nhật ký kiểm toán"), description: t("adminHome.tiles.auditDesc", "Hoạt động · Lệnh · Nâng cao"), accent: "border-amber-500/30 text-amber-600 dark:text-amber-400", to: "/audit-logs" },
    { icon: MonitorSmartphone, label: t("adminHome.tiles.sessions", "Phiên đăng nhập"), description: t("adminHome.tiles.sessionsDesc", "Thiết bị & phiên hoạt động"), accent: "border-teal-500/30 text-teal-600 dark:text-teal-400", to: "/sessions" },
    { icon: KeyRound, label: t("adminHome.tiles.apiKeys", "API Keys"), description: t("adminHome.tiles.apiKeysDesc", "Khóa truy cập có phạm vi"), accent: "border-rose-500/30 text-rose-600 dark:text-rose-400", to: "/api-keys" },
    { icon: SlidersHorizontal, label: t("adminHome.tiles.system", "Cấu hình hệ thống"), description: t("adminHome.tiles.systemDesc", "Tham số & tích hợp"), accent: "border-slate-500/30 text-slate-600 dark:text-slate-400", to: "/system-config" },
    { icon: Archive, label: t("adminHome.tiles.backup", "Sao lưu & phục hồi"), description: t("adminHome.tiles.backupDesc", "Backup / restore dữ liệu"), accent: "border-orange-500/30 text-orange-600 dark:text-orange-400", to: "/backup-restore" },
    { icon: ShieldCheck, label: t("adminHome.tiles.license", "Bản quyền"), description: t("adminHome.tiles.licenseDesc", "License & giới hạn"), accent: "border-violet-500/30 text-violet-600 dark:text-violet-400", to: "/license" },
    { icon: Cpu, label: t("adminHome.tiles.edge", "Edge nodes"), description: t("adminHome.tiles.edgeDesc", "Cổng biên & runtime"), accent: "border-cyan-500/30 text-cyan-600 dark:text-cyan-400", to: "/edge-nodes" },
    { icon: LayoutDashboard, label: t("adminHome.tiles.opsDashboard", "Bảng vận hành"), description: t("adminHome.tiles.opsDashboardDesc", "Dashboard đầy đủ"), accent: "border-sky-500/30 text-sky-600 dark:text-sky-400", to: "/dashboard" },
  ];

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6 p-2 sm:p-4">
        <PageHeader
          icon={<Activity className="h-6 w-6" />}
          title={t("adminHome.title", "Bảng quản trị")}
          description={t("adminHome.subtitle", "Quản trị người dùng, phân quyền, audit và hệ thống")}
        />

        {/* Live admin KPIs (read-only, existing tRPC) */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <MetricCard
            icon={<Users className="h-5 w-5" />}
            label={t("adminHome.kpi.activeUsers", "Người dùng hoạt động")}
            value={usersQuery.isLoading ? "…" : userKpis.active}
            tone="info"
            delta={usersQuery.isLoading ? undefined : t("adminHome.kpi.totalUsers", { count: userKpis.total, defaultValue: "{{count}} tổng" })}
          />
          <MetricCard
            icon={<MonitorCheck className="h-5 w-5" />}
            label={t("adminHome.kpi.mySessions", "Phiên của tôi")}
            value={sessionsQuery.isLoading ? "…" : (sessionsQuery.data?.count ?? 0)}
          />
          <MetricCard
            icon={<ShieldCheck className="h-5 w-5" />}
            label={t("adminHome.kpi.license", "Bản quyền")}
            value={licenseState.isLoading ? "…" : licenseView.value}
            tone={licenseView.tone}
            delta={licenseView.days != null ? t("adminHome.kpi.daysLeft", { count: licenseView.days, defaultValue: "còn {{count}} ngày" }) : undefined}
          />
          <MetricCard
            icon={<HeartPulse className="h-5 w-5" />}
            label={t("adminHome.kpi.activeLicenses", "License đang hoạt động")}
            value={licenseStats.isLoading ? "…" : (licenseStats.data?.activeLicenses ?? 0)}
            tone="success"
            delta={licenseStats.data ? t("adminHome.kpi.activations", { count: licenseStats.data.totalActiveActivations, defaultValue: "{{count}} kích hoạt" }) : undefined}
          />
        </div>

        <TodayBriefing />

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{t("adminHome.govTitle", "Quản trị & vận hành")}</h2>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {tiles.map((tile) => <ToolTile key={tile.to} {...tile} onClick={() => navigate(tile.to)} />)}
          </div>
        </section>
      </div>
    </DashboardLayout>
  );
}
