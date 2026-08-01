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
    label: "Hệ thống",
    icon: <ServerCog className="h-4 w-4" />,
    tools: [
      { icon: SlidersHorizontal, label: "Cài đặt chung", blurb: "Giao diện · ngôn ngữ · tuỳ chọn ứng dụng", href: "/settings", requiredPermission: "settings_view" },
      { icon: ServerCog, label: "Cấu hình hệ thống", blurb: "Tham số hệ thống cấp cao", href: "/system-config", requiredRole: "admin", note: "Admin" },
      { icon: Wrench, label: "Cài đặt quản trị", blurb: "Tham số quản trị hệ thống", href: "/admin-setting", requiredRole: "admin", note: "Admin" },
      { icon: DatabaseBackup, label: "Sao lưu & Phục hồi", blurb: "Backup/restore dữ liệu hệ thống", href: "/backup-restore", requiredRole: "admin", note: "Admin" },
      { icon: KeyRound, label: "Bản quyền (License)", blurb: "Quản lý giấy phép", href: "/license", requiredRole: "admin", note: "Admin" },
      { icon: Building2, label: "Đa cơ sở (Sites)", blurb: "Đăng ký & quản lý các cơ sở", href: "/sites", requiredRole: "admin", note: "Admin" },
    ],
  },
  {
    key: "security",
    label: "Bảo mật & Người dùng",
    icon: <ShieldCheck className="h-4 w-4" />,
    tools: [
      { icon: ShieldCheck, label: "Trình tạo vai trò", blurb: "Định nghĩa vai trò & ma trận quyền", href: "/role-builder", requiredRole: "admin", note: "Admin" },
      { icon: KeySquare, label: "Khóa API", blurb: "Cấp & thu hồi khóa API có phạm vi", href: "/api-keys", requiredRole: "admin", note: "Admin" },
    ],
  },
  {
    key: "devices",
    label: "Thiết bị & Kết nối",
    icon: <MonitorCog className="h-4 w-4" />,
    tools: [
      { icon: MonitorCog, label: "Cài đặt giám sát thiết bị", blurb: "Cấu hình giám sát & ánh xạ/đăng ký thiết bị", href: "/monitoring-setting", requiredPermission: "machine_status" },
    ],
  },
  {
    key: "ai",
    label: "AI",
    icon: <Sparkles className="h-4 w-4" />,
    tools: [
      { icon: Sparkles, label: "Cài đặt AI", blurb: "Cấu hình model server + AI gateway", href: "/ai-settings", requiredRole: "admin", note: "Admin" },
    ],
  },
  {
    key: "targets",
    label: "Dữ liệu & Mục tiêu",
    icon: <Target className="h-4 w-4" />,
    tools: [
      { icon: Target, label: "Mục tiêu OEE", blurb: "Thiết lập mục tiêu OEE theo dây chuyền/máy", href: "/oee-target-settings", requiredPermission: "analytics_oee_targets" },
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
