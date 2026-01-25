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
  Radio,
  AlertTriangle,
  Upload,
  Activity,
  Mail,
  Calendar,
  Server,
  UserCog,
  Boxes,
  LineChart,
  PieChart,
  Target,
  Cog,
  FileBarChart,
  MonitorCheck,
  Workflow,
  Brain,
  Wrench,
  LayoutTemplate,
  Archive,
  Store,
  Timer,
  Play,
  Heart,
  Tags
} from "lucide-react";
import { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
  description?: string;
  requiredRole?: 'admin' | 'user';
}

export interface NavGroup {
  id: string;
  label: string;
  icon?: ReactNode;
  items: NavItem[];
  defaultOpen?: boolean;
  description?: string;
  requiredRole?: 'admin' | 'user';
}

/**
 * Navigation structure organized by functional categories:
 * 
 * 1. Tổng quan (Overview) - Dashboard, real-time monitoring
 * 2. Giám sát (Monitoring) - Machine status, alerts, MQTT
 * 3. Sản xuất (Production) - Orders, inspection history, reports
 * 4. Quản lý dữ liệu (Data Management) - Products, mappings, layout
 * 5. Thống kê & Báo cáo (Analytics) - Statistics, scheduled reports
 * 6. Quản trị hệ thống (Administration) - Users, settings, API
 */
export const navGroups: NavGroup[] = [
  // ============================================
  // 1. TỔNG QUAN - Dashboard chính và tổng quan
  // ============================================
  {
    id: "overview",
    label: "Tổng quan",
    icon: <Gauge className="h-4 w-4" />,
    description: "Dashboard và tổng quan hệ thống",
    defaultOpen: true,
    items: [
      { 
        href: "/dashboard", 
        label: "Dashboard", 
        icon: <BarChart3 className="h-4 w-4" />,
        description: "Tổng quan số liệu và biểu đồ"
      },
      { 
        href: "/drill-down", 
        label: "Drill-Down", 
        icon: <TrendingUp className="h-4 w-4" />,
        description: "Phân tích chi tiết từ Corporate đến Machine"
      },
      { 
        href: "/dashboard-templates", 
        label: "Dashboard Templates", 
        icon: <LayoutTemplate className="h-4 w-4" />,
        description: "Quản lý và áp dụng templates dashboard"
      },
      { 
        href: "/backup-restore", 
        label: "Backup & Restore", 
        icon: <Archive className="h-4 w-4" />,
        description: "Sao lưu và khôi phục cấu hình hệ thống",
        requiredRole: "admin"
      },
      { 
        href: "/template-marketplace", 
        label: "Template Marketplace", 
        icon: <Store className="h-4 w-4" />,
        description: "Chia sẻ và tải templates từ cộng đồng"
      },
    ],
  },

  // ============================================
  // 2. GIÁM SÁT - Theo dõi real-time
  // ============================================
  {
    id: "monitoring",
    label: "Giám sát",
    icon: <Activity className="h-4 w-4" />,
    description: "Theo dõi trạng thái máy và cảnh báo",
    defaultOpen: true,
    items: [
      { 
        href: "/machine-status", 
        label: "Trạng thái máy", 
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "Theo dõi trạng thái hoạt động của máy"
      },
      { 
        href: "/alerts", 
        label: "Cảnh báo", 
        icon: <Bell className="h-4 w-4" />,
        description: "Xem và quản lý cảnh báo hệ thống"
      },
      { 
        href: "/mqtt-dashboard", 
        label: "MQTT Monitor", 
        icon: <Radio className="h-4 w-4" />,
        description: "Giám sát kết nối MQTT real-time"
      },
      { 
        href: "/mqtt-alerts", 
        label: "Quy tắc cảnh báo", 
        icon: <AlertTriangle className="h-4 w-4" />,
        description: "Cấu hình quy tắc cảnh báo tự động"
      },
      { 
        href: "/oee-dashboard", 
        label: "OEE Dashboard", 
        icon: <Timer className="h-4 w-4" />,
        description: "Theo dõi hiệu suất thiết bị tổng thể"
      },
      { 
        href: "/oee-target-settings", 
        label: "OEE Target Settings", 
        icon: <Target className="h-4 w-4" />,
        description: "Cài đặt mục tiêu OEE cho máy và dây chuyền"
      },
      { 
        href: "/mqtt-replay", 
        label: "MQTT Replay", 
        icon: <Play className="h-4 w-4" />,
        description: "Phát lại và debug tin nhắn MQTT"
      },
      { 
        href: "/machine-health", 
        label: "Machine Health", 
        icon: <Heart className="h-4 w-4" />,
        description: "Theo dõi sức khỏe máy và dự đoán bảo trì"
      },
    ],
  },

  // ============================================
  // 3. SẢN XUẤT - Quản lý quy trình sản xuất
  // ============================================
  {
    id: "production",
    label: "Sản xuất",
    icon: <Factory className="h-4 w-4" />,
    description: "Quản lý lệnh sản xuất và kiểm tra",
    defaultOpen: true,
    items: [
      { 
        href: "/production-orders", 
        label: "Lệnh sản xuất", 
        icon: <ClipboardList className="h-4 w-4" />,
        description: "Quản lý lệnh sản xuất"
      },
      { 
        href: "/history", 
        label: "Lịch sử kiểm tra", 
        icon: <History className="h-4 w-4" />,
        description: "Xem lịch sử kết quả kiểm tra"
      },
    ],
  },

  // ============================================
  // 4. QUẢN LÝ DỮ LIỆU - Master data
  // ============================================
  {
    id: "data-management",
    label: "Dữ liệu",
    icon: <Database className="h-4 w-4" />,
    description: "Quản lý dữ liệu chủ",
    defaultOpen: false,
    items: [
      { 
        href: "/products", 
        label: "Sản phẩm", 
        icon: <Package className="h-4 w-4" />,
        description: "Quản lý danh mục sản phẩm"
      },
      { 
        href: "/product-mapping", 
        label: "Gán sản phẩm", 
        icon: <Link className="h-4 w-4" />,
        description: "Gán sản phẩm cho máy kiểm tra"
      },
      { 
        href: "/layout", 
        label: "Layout nhà máy", 
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "Cấu hình layout nhà máy"
      },
      { 
        href: "/corporate-layout", 
        label: "Tập đoàn", 
        icon: <Building2 className="h-4 w-4" />,
        description: "Quản lý cấu trúc tập đoàn"
      },
    ],
  },

  // ============================================
  // 5. THỐNG KÊ & BÁO CÁO - Analytics
  // ============================================
  {
    id: "analytics",
    label: "Thống kê",
    icon: <LineChart className="h-4 w-4" />,
    description: "Báo cáo và phân tích dữ liệu",
    defaultOpen: false,
    items: [
      { 
        href: "/reports", 
        label: "Báo cáo", 
        icon: <FileBarChart className="h-4 w-4" />,
        description: "Xem và xuất báo cáo"
      },
      { 
        href: "/category-analytics", 
        label: "Phân tích Category", 
        icon: <PieChart className="h-4 w-4" />,
        description: "Phân tích sản lượng/yield theo category"
      },
      { 
        href: "/scheduled-reports", 
        label: "Báo cáo định kỳ", 
        icon: <Calendar className="h-4 w-4" />,
        description: "Cấu hình báo cáo tự động"
      },
      { 
        href: "/spc-analysis", 
        label: "SPC / AI Analysis", 
        icon: <Brain className="h-4 w-4" />,
        description: "Phân tích SPC và AI dự đoán"
      },
      { 
        href: "/annotation-statistics", 
        label: "Thống kê Annotation", 
        icon: <Tags className="h-4 w-4" />,
        description: "Phân tích xu hướng annotation theo máy, sản phẩm"
      },
    ],
  },

  // ============================================
  // 5.5. QUẢN LÝ QUY TRÌNH - Process Management
  // ============================================
  {
    id: "process-management",
    label: "Quy trình",
    icon: <Workflow className="h-4 w-4" />,
    description: "Quản lý quy trình sản xuất",
    defaultOpen: false,
    requiredRole: 'admin',
    items: [
      { 
        href: "/process-management", 
        label: "Công đoạn", 
        icon: <Workflow className="h-4 w-4" />,
        description: "Quản lý công đoạn sản xuất",
        requiredRole: 'admin'
      },
      { 
        href: "/workstation-management", 
        label: "Công trạm", 
        icon: <Wrench className="h-4 w-4" />,
        description: "Quản lý công trạm sản xuất",
        requiredRole: 'admin'
      },
    ],
  },

  // ============================================
  // 6. QUẢN TRỊ HỆ THỐNG - Admin only
  // ============================================
  {
    id: "admin",
    label: "Quản trị",
    icon: <Shield className="h-4 w-4" />,
    description: "Quản trị hệ thống (Admin only)",
    defaultOpen: false,
    requiredRole: 'admin',
    items: [
      { 
        href: "/users", 
        label: "Người dùng", 
        icon: <Users className="h-4 w-4" />,
        description: "Quản lý tài khoản người dùng",
        requiredRole: 'admin'
      },
      { 
        href: "/user-assignments", 
        label: "Phân quyền", 
        icon: <UserCog className="h-4 w-4" />,
        description: "Gán quyền truy cập nhà máy",
        requiredRole: 'admin'
      },
      { 
        href: "/import-export", 
        label: "Import/Export", 
        icon: <Upload className="h-4 w-4" />,
        description: "Nhập/xuất dữ liệu hàng loạt",
        requiredRole: 'admin'
      },
      { 
        href: "/system-config", 
        label: "Cấu hình hệ thống", 
        icon: <Cog className="h-4 w-4" />,
        description: "Cấu hình tham số hệ thống",
        requiredRole: 'admin'
      },
      { 
        href: "/settings", 
        label: "Cài đặt", 
        icon: <Settings className="h-4 w-4" />,
        description: "Cài đặt SMTP, cache, template",
        requiredRole: 'admin'
      },
      { 
        href: "/api-docs", 
        label: "API Docs", 
        icon: <FileText className="h-4 w-4" />,
        description: "Tài liệu API tích hợp",
        requiredRole: 'admin'
      },
      { 
        href: "/user-guide", 
        label: "Hướng dẫn", 
        icon: <BookOpen className="h-4 w-4" />,
        description: "Tài liệu hướng dẫn sử dụng"
      },
    ],
  },
];

// Flat navigation items for backward compatibility
export const navItems: NavItem[] = navGroups.flatMap(group => group.items);

// Helper to get group by item href
export function getGroupByHref(href: string): NavGroup | undefined {
  return navGroups.find(group => group.items.some(item => item.href === href));
}

/**
 * Check if user has access to a navigation group
 * @param groupId - The group ID to check
 * @param userRole - The user's role ('admin' or 'user')
 * @returns true if user has access
 */
export function hasAccessToGroup(groupId: string, userRole?: string): boolean {
  const group = navGroups.find(g => g.id === groupId);
  if (!group) return false;
  
  // If group requires admin role, check user role
  if (group.requiredRole === 'admin' && userRole !== 'admin') {
    return false;
  }
  
  return true;
}

/**
 * Check if user has access to a specific navigation item
 * @param href - The item href to check
 * @param userRole - The user's role ('admin' or 'user')
 * @returns true if user has access
 */
export function hasAccessToItem(href: string, userRole?: string): boolean {
  for (const group of navGroups) {
    const item = group.items.find(i => i.href === href);
    if (item) {
      // Check item-level role requirement
      if (item.requiredRole === 'admin' && userRole !== 'admin') {
        return false;
      }
      // Check group-level role requirement
      if (group.requiredRole === 'admin' && userRole !== 'admin') {
        return false;
      }
      return true;
    }
  }
  return false;
}

/**
 * Get filtered navigation groups based on user role
 * @param userRole - The user's role ('admin' or 'user')
 * @returns Filtered navigation groups
 */
export function getFilteredNavGroups(userRole?: string): NavGroup[] {
  return navGroups
    .filter(group => hasAccessToGroup(group.id, userRole))
    .map(group => ({
      ...group,
      items: group.items.filter(item => 
        !item.requiredRole || item.requiredRole === userRole || userRole === 'admin'
      )
    }))
    .filter(group => group.items.length > 0);
}

/**
 * Get navigation groups for a specific module/system
 * This supports the two-tiered navigation structure
 * @param moduleId - The module ID (e.g., 'spc', 'aoi', 'admin')
 * @param userRole - The user's role
 * @returns Navigation groups for the module
 */
export function getModuleNavGroups(moduleId: string, userRole?: string): NavGroup[] {
  // For now, return all groups filtered by role
  // In future, can filter by module
  return getFilteredNavGroups(userRole);
}
