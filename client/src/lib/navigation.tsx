import { BarChart3, History, LayoutGrid, Settings, FileText, Package, Building2 } from "lucide-react";

export const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: <BarChart3 className="h-4 w-4" /> },
  { href: "/history", label: "Lịch sử", icon: <History className="h-4 w-4" /> },
  { href: "/products", label: "Sản phẩm", icon: <Package className="h-4 w-4" /> },
  { href: "/layout", label: "Layout", icon: <LayoutGrid className="h-4 w-4" /> },
  { href: "/corporate-layout", label: "Tập đoàn", icon: <Building2 className="h-4 w-4" /> },
  { href: "/settings", label: "Cài đặt", icon: <Settings className="h-4 w-4" /> },
  { href: "/api-docs", label: "API Docs", icon: <FileText className="h-4 w-4" /> },
];
