import { 
  BarChart3, 
  History, 
  LayoutGrid, 
  Settings, 
  FileText, 
  Package, 
  Building2, 
  TrendingUp, 
  Bell, 
  Users, 
  Link, 
  ClipboardList, 
  Wifi,
  Gauge,
  Factory,
  Database,
  Shield,
  BookOpen,
  Radio
} from "lucide-react";
import { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
}

export interface NavGroup {
  id: string;
  label: string;
  icon?: ReactNode;
  items: NavItem[];
  defaultOpen?: boolean;
}

// Grouped navigation structure
export const navGroups: NavGroup[] = [
  {
    id: "overview",
    label: "Tổng quan",
    icon: <Gauge className="h-4 w-4" />,
    defaultOpen: true,
    items: [
      { href: "/dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" /> },
      { href: "/machine-status", label: "Trạng thái máy", icon: <Wifi className="h-4 w-4" /> },
      { href: "/alerts", label: "Cảnh báo", icon: <Bell className="h-4 w-4" /> },
    ],
  },
  {
    id: "production",
    label: "Sản xuất",
    icon: <Factory className="h-4 w-4" />,
    defaultOpen: true,
    items: [
      { href: "/production-orders", label: "Lệnh sản xuất", icon: <ClipboardList className="h-4 w-4" /> },
      { href: "/history", label: "Lịch sử kiểm tra", icon: <History className="h-4 w-4" /> },
      { href: "/reports", label: "Báo cáo", icon: <TrendingUp className="h-4 w-4" /> },
    ],
  },
  {
    id: "management",
    label: "Quản lý",
    icon: <Database className="h-4 w-4" />,
    defaultOpen: false,
    items: [
      { href: "/products", label: "Sản phẩm", icon: <Package className="h-4 w-4" /> },
      { href: "/product-mapping", label: "Gán sản phẩm", icon: <Link className="h-4 w-4" /> },
      { href: "/layout", label: "Layout nhà máy", icon: <LayoutGrid className="h-4 w-4" /> },
      { href: "/corporate-layout", label: "Tập đoàn", icon: <Building2 className="h-4 w-4" /> },
    ],
  },
  {
    id: "admin",
    label: "Hệ thống",
    icon: <Shield className="h-4 w-4" />,
    defaultOpen: false,
    items: [
      { href: "/users", label: "Người dùng", icon: <Users className="h-4 w-4" /> },
      { href: "/mqtt-dashboard", label: "MQTT Dashboard", icon: <Radio className="h-4 w-4" /> },
      { href: "/settings", label: "Cài đặt", icon: <Settings className="h-4 w-4" /> },
      { href: "/api-docs", label: "API Docs", icon: <FileText className="h-4 w-4" /> },
    ],
  },
];

// Flat navigation items for backward compatibility
export const navItems: NavItem[] = navGroups.flatMap(group => group.items);

// Helper to get group by item href
export function getGroupByHref(href: string): NavGroup | undefined {
  return navGroups.find(group => group.items.some(item => item.href === href));
}

// Helper to check if user has access to a group (for future role-based access)
export function hasAccessToGroup(groupId: string, userRole?: string): boolean {
  if (groupId === "admin" && userRole !== "admin") {
    return false;
  }
  return true;
}
