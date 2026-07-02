/**
 * AdminHome — "/admin-home" — an admin briefing front door (doc 10 U5). Admins previously
 * landed on the generic ops /dashboard with no admin-specific summary. This surfaces the
 * governance/admin surfaces (users, roles, license, audit, system config, API keys, edge
 * nodes) as one-click tiles + a role-aware TodayBriefing. REUSES existing pages — nothing
 * rebuilt; each underlying page keeps its own RBAC (admin-gated).
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { TodayBriefing } from "@/components/TodayBriefing";
import { PageHeader, PageContainer, MetricCard, ToolTile, type MetricTone } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import {
  ShieldCheck, Users, KeyRound, FileClock, SlidersHorizontal, Cpu,
  LayoutDashboard, Activity, Archive, MonitorSmartphone, MonitorCheck,
  HeartPulse, type LucideIcon,
} from "lucide-react";

interface Tile { icon: LucideIcon; label: string; description: string; to: string }

export default function AdminHome() {
  const { t } = useTranslation();

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
    { icon: Users, label: t("adminHome.tiles.users", "Người dùng"), description: t("adminHome.tiles.usersDesc", "Tài khoản & vai trò"), to: "/users" },
    { icon: ShieldCheck, label: t("adminHome.tiles.roles", "Phân quyền"), description: t("adminHome.tiles.rolesDesc", "Role builder & module"), to: "/role-builder" },
    { icon: FileClock, label: t("adminHome.tiles.audit", "Nhật ký kiểm toán"), description: t("adminHome.tiles.auditDesc", "Hoạt động · Lệnh · Nâng cao"), to: "/audit-logs" },
    { icon: MonitorSmartphone, label: t("adminHome.tiles.sessions", "Phiên đăng nhập"), description: t("adminHome.tiles.sessionsDesc", "Thiết bị & phiên hoạt động"), to: "/sessions" },
    { icon: KeyRound, label: t("adminHome.tiles.apiKeys", "API Keys"), description: t("adminHome.tiles.apiKeysDesc", "Khóa truy cập có phạm vi"), to: "/api-keys" },
    { icon: SlidersHorizontal, label: t("adminHome.tiles.system", "Cấu hình hệ thống"), description: t("adminHome.tiles.systemDesc", "Tham số & tích hợp"), to: "/system-config" },
    { icon: Archive, label: t("adminHome.tiles.backup", "Sao lưu & phục hồi"), description: t("adminHome.tiles.backupDesc", "Backup / restore dữ liệu"), to: "/backup-restore" },
    { icon: ShieldCheck, label: t("adminHome.tiles.license", "Bản quyền"), description: t("adminHome.tiles.licenseDesc", "License & giới hạn"), to: "/license" },
    { icon: Cpu, label: t("adminHome.tiles.edge", "Edge nodes"), description: t("adminHome.tiles.edgeDesc", "Cổng biên & runtime"), to: "/edge-nodes" },
    { icon: LayoutDashboard, label: t("adminHome.tiles.opsDashboard", "Bảng vận hành"), description: t("adminHome.tiles.opsDashboardDesc", "Dashboard đầy đủ"), to: "/dashboard" },
  ];

  return (
    <DashboardLayout>
      <PageContainer>
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
            {tiles.map((tile) => (
              <ToolTile key={tile.to} icon={tile.icon} label={tile.label} blurb={tile.description} href={tile.to} />
            ))}
          </div>
        </section>
      </PageContainer>
    </DashboardLayout>
  );
}
