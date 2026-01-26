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
  Tags,
  GitCompare,
  Map,
  Sparkles,
  Search,
  MessageSquare,
  LayoutDashboard,
  Eye,
  Layers,
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
 * 1. Dashboard - Bảng điều khiển chính
 * 2. Giám sát Real-time - MQTT, trạng thái máy, OEE
 * 3. Lịch sử & Báo cáo - Inspection history, reports
 * 4. Phân tích & Dự đoán - AI, SPC, Annotations
 * 5. Quản lý dữ liệu - Products, Layout, Mapping
 * 6. Cài đặt & Quản trị - Settings, Users, System
 */
export const navGroups: NavGroup[] = [
  // ============================================
  // 1. DASHBOARD - Bảng điều khiển chính
  // ============================================
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <Gauge className="h-4 w-4" />,
    description: "Bảng điều khiển và tổng quan",
    defaultOpen: true,
    items: [
      { 
        href: "/dashboard", 
        label: "Tổng quan", 
        icon: <BarChart3 className="h-4 w-4" />,
        description: "Dashboard chính với KPIs và biểu đồ"
      },
      { 
        href: "/drill-down", 
        label: "Drill-Down", 
        icon: <TrendingUp className="h-4 w-4" />,
        description: "Phân tích chi tiết từ Corporate đến Machine"
      },
      { 
        href: "/custom-dashboard", 
        label: "Dashboard Tùy chỉnh", 
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "Tạo dashboard cá nhân với widgets"
      },
      { 
        href: "/dashboard-templates", 
        label: "Mẫu Dashboard", 
        icon: <LayoutDashboard className="h-4 w-4" />,
        description: "Quản lý các mẫu dashboard"
      },
      { 
        href: "/dashboard-marketplace", 
        label: "Marketplace", 
        icon: <Store className="h-4 w-4" />,
        description: "Chia sẻ và tải templates từ cộng đồng"
      },
    ],
  },

  // ============================================
  // 2. GIÁM SÁT REAL-TIME - Monitoring
  // ============================================
  {
    id: "monitoring",
    label: "Giám sát",
    icon: <Activity className="h-4 w-4" />,
    description: "Theo dõi trạng thái máy và MQTT real-time",
    defaultOpen: true,
    items: [
      { 
        href: "/machine-status", 
        label: "Trạng thái máy", 
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "Theo dõi trạng thái hoạt động của máy"
      },
      { 
        href: "/mqtt-dashboard", 
        label: "MQTT Dashboard", 
        icon: <Radio className="h-4 w-4" />,
        description: "Giám sát kết nối MQTT real-time"
      },
      { 
        href: "/mqtt-clients", 
        label: "MQTT Clients", 
        icon: <Wifi className="h-4 w-4" />,
        description: "Quản lý MQTT clients và kết nối"
      },
      { 
        href: "/mqtt-topics", 
        label: "Topics & Messages", 
        icon: <MessageSquare className="h-4 w-4" />,
        description: "Quản lý topics và xem lịch sử messages"
      },
      { 
        href: "/mqtt-replay", 
        label: "MQTT Replay", 
        icon: <Play className="h-4 w-4" />,
        description: "Phát lại và debug tin nhắn MQTT"
      },
      { 
        href: "/oee-dashboard", 
        label: "OEE Dashboard", 
        icon: <Timer className="h-4 w-4" />,
        description: "Theo dõi hiệu suất thiết bị tổng thể"
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
  // 3. CẢNH BÁO - Alerts Management
  // ============================================
  {
    id: "alerts",
    label: "Cảnh báo",
    icon: <Bell className="h-4 w-4" />,
    description: "Quản lý cảnh báo và quy tắc",
    defaultOpen: false,
    items: [
      { 
        href: "/alerts", 
        label: "Danh sách cảnh báo", 
        icon: <Bell className="h-4 w-4" />,
        description: "Xem và quản lý cảnh báo hệ thống"
      },
      { 
        href: "/mqtt-alerts", 
        label: "Quy tắc cảnh báo", 
        icon: <AlertTriangle className="h-4 w-4" />,
        description: "Cấu hình quy tắc cảnh báo tự động"
      },
      { 
        href: "/predictive-alerts", 
        label: "Cảnh báo Dự đoán", 
        icon: <Sparkles className="h-4 w-4" />,
        description: "AI tự động cảnh báo vấn đề tiềm ẩn"
      },
      { 
        href: "/oee-target-settings", 
        label: "Mục tiêu OEE", 
        icon: <Target className="h-4 w-4" />,
        description: "Cài đặt mục tiêu OEE cho máy và dây chuyền"
      },
    ],
  },

  // ============================================
  // 4. SẢN XUẤT & LỊCH SỬ - Production & History
  // ============================================
  {
    id: "production",
    label: "Sản xuất",
    icon: <Factory className="h-4 w-4" />,
    description: "Quản lý sản xuất và lịch sử kiểm tra",
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
      { 
        href: "/reports", 
        label: "Báo cáo", 
        icon: <FileBarChart className="h-4 w-4" />,
        description: "Xem và xuất báo cáo"
      },
      { 
        href: "/scheduled-reports", 
        label: "Báo cáo định kỳ", 
        icon: <Calendar className="h-4 w-4" />,
        description: "Cấu hình báo cáo tự động"
      },
      { 
        href: "/history-export-scheduling", 
        label: "Lịch xuất dữ liệu", 
        icon: <Mail className="h-4 w-4" />,
        description: "Tự động xuất và gửi email báo cáo"
      },
    ],
  },

  // ============================================
  // 5. PHÂN TÍCH & DỰ ĐOÁN - Analytics & AI
  // ============================================
  {
    id: "analytics",
    label: "Phân tích",
    icon: <Brain className="h-4 w-4" />,
    description: "Phân tích dữ liệu và AI dự đoán",
    defaultOpen: false,
    items: [
      { 
        href: "/spc-analysis", 
        label: "SPC / AI Analysis", 
        icon: <Brain className="h-4 w-4" />,
        description: "Phân tích SPC và AI dự đoán"
      },
      { 
        href: "/category-analytics", 
        label: "Phân tích Category", 
        icon: <PieChart className="h-4 w-4" />,
        description: "Phân tích sản lượng/yield theo category"
      },
      { 
        href: "/annotation-statistics", 
        label: "Thống kê Annotation", 
        icon: <Tags className="h-4 w-4" />,
        description: "Phân tích xu hướng annotation"
      },
      { 
        href: "/annotation-comparison", 
        label: "So sánh Annotation", 
        icon: <GitCompare className="h-4 w-4" />,
        description: "So sánh annotations giữa các lần kiểm tra"
      },
      { 
        href: "/defect-heatmap", 
        label: "Bản đồ nhiệt Defects", 
        icon: <Map className="h-4 w-4" />,
        description: "Hiển thị mật độ defects trên layout"
      },
      { 
        href: "/defect-prediction", 
        label: "Dự đoán Defects", 
        icon: <Sparkles className="h-4 w-4" />,
        description: "AI dự đoán xu hướng defects"
      },
      { 
        href: "/root-cause-analysis", 
        label: "Phân tích Nguyên nhân", 
        icon: <Search className="h-4 w-4" />,
        description: "AI phân tích nguyên nhân gốc rễ"
      },
    ],
  },

  // ============================================
  // 6. QUẢN LÝ DỮ LIỆU - Data Management
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
      { 
        href: "/import-export", 
        label: "Import/Export", 
        icon: <Upload className="h-4 w-4" />,
        description: "Nhập/xuất dữ liệu hàng loạt"
      },
    ],
  },

  // ============================================
  // 7. QUY TRÌNH SẢN XUẤT - Process Management
  // ============================================
  {
    id: "process-management",
    label: "Quy trình",
    icon: <Workflow className="h-4 w-4" />,
    description: "Quản lý quy trình sản xuất",
    defaultOpen: false,
    items: [
      { 
        href: "/process-management", 
        label: "Công đoạn", 
        icon: <Layers className="h-4 w-4" />,
        description: "Quản lý công đoạn sản xuất"
      },
      { 
        href: "/workstation-management", 
        label: "Công trạm", 
        icon: <Wrench className="h-4 w-4" />,
        description: "Quản lý công trạm sản xuất"
      },
    ],
  },

  // ============================================
  // 8. CÀI ĐẶT & QUẢN TRỊ - Settings & Admin
  // ============================================
  {
    id: "settings",
    label: "Cài đặt",
    icon: <Settings className="h-4 w-4" />,
    description: "Cài đặt hệ thống",
    defaultOpen: false,
    items: [
      { 
        href: "/settings", 
        label: "Cài đặt chung", 
        icon: <Settings className="h-4 w-4" />,
        description: "Cài đặt SMTP, cache, template"
      },
      { 
        href: "/system-config", 
        label: "Cấu hình hệ thống", 
        icon: <Cog className="h-4 w-4" />,
        description: "Cấu hình tham số hệ thống",
        requiredRole: 'admin'
      },
      { 
        href: "/backup-restore", 
        label: "Backup & Restore", 
        icon: <Archive className="h-4 w-4" />,
        description: "Sao lưu và khôi phục cấu hình",
        requiredRole: "admin"
      },
      { 
        href: "/template-marketplace", 
        label: "Template Marketplace", 
        icon: <Store className="h-4 w-4" />,
        description: "Chia sẻ và tải templates"
      },
      { 
        href: "/api-docs", 
        label: "API Docs", 
        icon: <FileText className="h-4 w-4" />,
        description: "Tài liệu API tích hợp"
      },
      { 
        href: "/user-guide", 
        label: "Hướng dẫn", 
        icon: <BookOpen className="h-4 w-4" />,
        description: "Tài liệu hướng dẫn sử dụng"
      },
    ],
  },

  // ============================================
  // 9. QUẢN TRỊ HỆ THỐNG - Admin only
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
