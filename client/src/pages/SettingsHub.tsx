/**
 * doc 59 (cụm phụ) — Settings Hub: MỘT cửa cho các trang cài đặt rải rác (hệ thống ·
 * bảo mật/người dùng · thiết bị · AI · mục tiêu). Hub-launcher (HubLauncher rail ⇄ ToolTile
 * + per-tile RBAC). Additive: route con giữ nguyên (deep-link + nav-entry cũ cho role
 * quyền-hẹp). Tile admin-only gate `requiredRole:'admin'` (HubLauncher ẩn cho non-admin ⇒
 * không dead-end vào RouteGuard requireRole admin — critic §2 risk#1).
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { HubLauncher, type HubCategory } from "@/components/workspace";
import {
  SlidersHorizontal, ServerCog, Wrench, DatabaseBackup, KeyRound, Building2,
  ShieldCheck, KeySquare, MonitorCog, Sparkles, Target,
} from "lucide-react";

const CATEGORIES: readonly HubCategory[] = [
  {
    key: "system",
    label: "settingsHub.system",
    icon: <ServerCog className="h-4 w-4" />,
    tools: [
      { icon: SlidersHorizontal, label: "settingsHub.settings", blurb: "settingsHub.settingsBlurb", href: "/settings", requiredPermission: "settings_view" },
      { icon: ServerCog, label: "settingsHub.systemConfig", blurb: "settingsHub.systemConfigBlurb", href: "/system-config", requiredRole: "admin", note: "Admin" },
      { icon: Wrench, label: "settingsHub.adminSetting", blurb: "settingsHub.adminSettingBlurb", href: "/admin-setting", requiredRole: "admin", note: "Admin" },
      { icon: DatabaseBackup, label: "settingsHub.backupRestore", blurb: "settingsHub.backupRestoreBlurb", href: "/backup-restore", requiredRole: "admin", note: "Admin" },
      { icon: KeyRound, label: "settingsHub.license", blurb: "settingsHub.licenseBlurb", href: "/license", requiredRole: "admin", note: "Admin" },
      { icon: Building2, label: "settingsHub.sites", blurb: "settingsHub.sitesBlurb", href: "/sites", requiredRole: "admin", note: "Admin" },
    ],
  },
  {
    key: "security",
    label: "settingsHub.security",
    icon: <ShieldCheck className="h-4 w-4" />,
    tools: [
      { icon: ShieldCheck, label: "settingsHub.roleBuilder", blurb: "settingsHub.roleBuilderBlurb", href: "/role-builder", requiredRole: "admin", note: "Admin" },
      { icon: KeySquare, label: "settingsHub.apiKeys", blurb: "settingsHub.apiKeysBlurb", href: "/api-keys", requiredRole: "admin", note: "Admin" },
    ],
  },
  {
    key: "devices",
    label: "settingsHub.devices",
    icon: <MonitorCog className="h-4 w-4" />,
    tools: [
      { icon: MonitorCog, label: "settingsHub.monitoringSetting", blurb: "settingsHub.monitoringSettingBlurb", href: "/monitoring-setting", requiredPermission: "machine_status" },
    ],
  },
  {
    key: "ai",
    label: "AI",
    icon: <Sparkles className="h-4 w-4" />,
    tools: [
      { icon: Sparkles, label: "settingsHub.aiSettings", blurb: "settingsHub.aiSettingsBlurb", href: "/ai-settings", requiredRole: "admin", note: "Admin" },
    ],
  },
  {
    key: "targets",
    label: "settingsHub.targets",
    icon: <Target className="h-4 w-4" />,
    tools: [
      { icon: Target, label: "settingsHub.oeeTargetSettings", blurb: "settingsHub.oeeTargetSettingsBlurb", href: "/oee-target-settings", requiredPermission: "analytics_oee_targets" },
    ],
  },
];

export default function SettingsHub() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("settingsHub.title", "Trung tâm cài đặt")}>
      <HubLauncher categories={CATEGORIES} categoriesLabel={t("settingsHub.categories", "Nhóm cài đặt")} />
    </DashboardLayout>
  );
}
