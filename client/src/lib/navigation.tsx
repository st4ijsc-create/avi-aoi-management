import { BarChart3, History, LayoutGrid, Settings, FileText, Package, Building2, TrendingUp, Bell, Users, Link } from "lucide-react";

export const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" /> },
  { href: "/history", label: "Lịch sử", icon: <History className="h-4 w-4" /> },
  { href: "/products", label: "Sản phẩm", icon: <Package className="h-4 w-4" /> },
  { href: "/layout", label: "Layout", icon: <LayoutGrid className="h-4 w-4" /> },
  { href: "/corporate-layout", label: "Tập đoàn", icon: <Building2 className="h-4 w-4" /> },
  { href: "/reports", label: "Báo cáo", icon: <TrendingUp className="h-4 w-4" /> },
  { href: "/alerts", label: "Cảnh báo", icon: <Bell className="h-4 w-4" /> },
  { href: "/users", label: "Người dùng", icon: <Users className="h-4 w-4" /> },
  { href: "/product-mapping", label: "Gán sản phẩm", icon: <Link className="h-4 w-4" /> },
  { href: "/settings", label: "Cài đặt", icon: <Settings className="h-4 w-4" /> },
  { href: "/api-docs", label: "API Docs", icon: <FileText className="h-4 w-4" /> },
];
