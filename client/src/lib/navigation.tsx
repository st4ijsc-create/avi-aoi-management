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
 * 1. Dashboard - Bảng điều khiển chính và tùy chỉnh
 * 2. Giám sát - Theo dõi máy, MQTT, OEE
 * 3. Cảnh báo - Quản lý cảnh báo và quy tắc
 * 4. Sản xuất - Lệnh sản xuất, lịch sử kiểm tra
 * 5. Phân tích - Thống kê, báo cáo, AI
 * 6. Dữ liệu - Quản lý master data
 * 7. Quy trình - Công đoạn, công trạm
 * 8. Cài đặt - Cấu hình hệ thống
 * 9. Quản trị - Admin only
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
        description: "Dashboard chính với KPI và biểu đồ"
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
        description: "Tạo dashboard với widgets tùy chọn"
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
        description: "Tải và chia sẻ templates"
      },
    ],
  },

  // ============================================
  // 2. QUẢN LÝ TẬP ĐOÀN - Dành cho quản lý cấp cao
  // ============================================
  {
    id: "corporate",
    label: "Quản lý Tập đoàn",
    icon: <Building2 className="h-4 w-4" />,
    description: "Dashboard và quản lý cấp tập đoàn",
    defaultOpen: false,
    requiredRole: 'admin',
    items: [
      { 
        href: "/corporate-dashboard", 
        label: "Dashboard Tập đoàn", 
        icon: <Building2 className="h-4 w-4" />,
        description: "Tổng quan hiệu suất toàn tập đoàn",
        requiredRole: 'admin'
      },
      { 
        href: "/corporations", 
        label: "Quản lý Tập đoàn", 
        icon: <Building2 className="h-4 w-4" />,
        description: "Quản lý thông tin các tập đoàn",
        requiredRole: 'admin'
      },
      { 
        href: "/companies", 
        label: "Quản lý Công ty", 
        icon: <Factory className="h-4 w-4" />,
        description: "Quản lý thông tin các công ty",
        requiredRole: 'admin'
      },
      { 
        href: "/factories", 
        label: "Quản lý Nhà máy", 
        icon: <Factory className="h-4 w-4" />,
        description: "Quản lý thông tin các nhà máy",
        requiredRole: 'admin'
      },
    ],
  },

  // ============================================
  // 3. GIÁM SÁT - Theo dõi real-time
  // ============================================
  {
    id: "monitoring",
    label: "Giám sát",
    icon: <Activity className="h-4 w-4" />,
    description: "Theo dõi trạng thái máy và MQTT",
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
        label: "MQTT Monitor", 
        icon: <Radio className="h-4 w-4" />,
        description: "Giám sát kết nối MQTT real-time"
      },
      { 
        href: "/mqtt-clients", 
        label: "MQTT Clients", 
        icon: <Wifi className="h-4 w-4" />,
        description: "Quản lý MQTT clients"
      },
      { 
        href: "/mqtt-topics", 
        label: "Topics & Messages", 
        icon: <MessageSquare className="h-4 w-4" />,
        description: "Quản lý topics và xem messages"
      },
      { 
        href: "/mqtt-replay", 
        label: "MQTT Replay", 
        icon: <Play className="h-4 w-4" />,
        description: "Phát lại và debug tin nhắn MQTT"
      },
      { 
        href: "/mqtt-profiles", 
        label: "MQTT Profiles", 
        icon: <Server className="h-4 w-4" />,
        description: "Quản lý tập trung cấu hình MQTT"
      },
      { 
        href: "/oee-dashboard", 
        label: "OEE Dashboard", 
        icon: <Timer className="h-4 w-4" />,
        description: "Hiệu suất thiết bị tổng thể"
      },
      { 
        href: "/machine-health", 
        label: "Machine Health", 
        icon: <Heart className="h-4 w-4" />,
        description: "Theo dõi sức khỏe máy"
      },
    ],
  },

  // ============================================
  // 3. CẢNH BÁO - Quản lý cảnh báo
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
        description: "Cài đặt mục tiêu OEE"
      },
    ],
  },

  // ============================================
  // 4. SẢN XUẤT - Quản lý quy trình sản xuất
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
      { 
        href: "/history-export-scheduling", 
        label: "Lịch xuất báo cáo", 
        icon: <Calendar className="h-4 w-4" />,
        description: "Tự động xuất báo cáo theo lịch"
      },
    ],
  },

  // ============================================
  // 5. PHÂN TÍCH - Thống kê và báo cáo
  // ============================================
  {
    id: "analytics",
    label: "Phân tích",
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
        href: "/scheduled-reports", 
        label: "Báo cáo định kỳ", 
        icon: <Calendar className="h-4 w-4" />,
        description: "Cấu hình báo cáo tự động"
      },
      { 
        href: "/category-analytics", 
        label: "Phân tích Category", 
        icon: <PieChart className="h-4 w-4" />,
        description: "Phân tích sản lượng/yield theo category"
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
  // 6. DỮ LIỆU - Quản lý master data
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
  // 7. QUY TRÌNH - Process Management
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
  // 8. CÀI ĐẶT - Cấu hình hệ thống
  // ============================================
  {
    id: "settings",
    label: "Cài đặt",
    icon: <Settings className="h-4 w-4" />,
    description: "Cấu hình hệ thống",
    defaultOpen: false,
    items: [
      { 
        href: "/settings", 
        label: "Cài đặt chung", 
        icon: <Cog className="h-4 w-4" />,
        description: "Cài đặt SMTP, cache, template"
      },
      { 
        href: "/settings?tab=notification-sounds", 
        label: "Âm thanh thông báo", 
        icon: <Bell className="h-4 w-4" />,
        description: "Tùy chỉnh âm thanh cho từng loại cảnh báo"
      },
      { 
        href: "/system-config", 
        label: "Cấu hình hệ thống", 
        icon: <Server className="h-4 w-4" />,
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
        href: "/import-export", 
        label: "Import/Export", 
        icon: <Upload className="h-4 w-4" />,
        description: "Nhập/xuất dữ liệu hàng loạt",
        requiredRole: 'admin'
      },
    ],
  },

  // ============================================
  // 9. QUẢN TRỊ - Admin only
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
    .filter(group => {
      // Filter out groups that require admin role if user is not admin
      if (group.requiredRole === 'admin' && userRole !== 'admin') {
        return false;
      }
      return true;
    })
    .map(group => ({
      ...group,
      items: group.items.filter(item => {
        // Filter out items that require admin role if user is not admin
        if (item.requiredRole === 'admin' && userRole !== 'admin') {
          return false;
        }
        return true;
      }),
    }))
    .filter(group => group.items.length > 0); // Remove empty groups
}
