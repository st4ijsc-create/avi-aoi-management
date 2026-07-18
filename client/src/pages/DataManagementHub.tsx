/**
 * doc 59 Cụm D — Data Management Hub: ONE professional "data home" (master-detail on
 * WorkspaceShell) that gathers the scattered data-management surfaces under a category
 * rail. LEFT rail = category (Product & Program / Master Data / Factory & Governance);
 * MAIN = a launcher of that category's managers. The managers open as their own pages
 * (they lack extracted *Content, so this unifies the ENTRY without a fragile 13-page
 * embed) — deep-links preserved, routes untouched.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { WorkspaceShell } from "@/components/workspace";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Package, Sparkles, Link as LinkIcon, Cpu, Tags, Users, History, ShieldCheck, BookOpen,
  Database, LayoutTemplate, Building2, Workflow, ChevronRight,
} from "lucide-react";

interface Tool { href: string; label: string; desc: string; icon: React.ReactNode }
interface Category { key: string; label: string; icon: React.ReactNode; tools: Tool[] }

const CATEGORIES: Category[] = [
  {
    key: "productProgram",
    label: "Sản phẩm & Chương trình",
    icon: <Package className="h-4 w-4" />,
    tools: [
      { href: "/products", label: "Model sản phẩm", desc: "Model · biến thể · điểm đo · spec-limit", icon: <Package className="h-4 w-4" /> },
      { href: "/product-onboarding", label: "Wizard tạo sản phẩm", desc: "Thiết lập sản phẩm đầu-cuối có hướng dẫn", icon: <Sparkles className="h-4 w-4" /> },
      { href: "/product-mapping", label: "Gán sản phẩm ↔ máy", desc: "Ánh xạ model sản phẩm với máy/trạm", icon: <LinkIcon className="h-4 w-4" /> },
      { href: "/component-library", label: "Thư viện linh kiện", desc: "Package/footprint linh kiện", icon: <Cpu className="h-4 w-4" /> },
    ],
  },
  {
    key: "masterData",
    label: "Dữ liệu chủ",
    icon: <Tags className="h-4 w-4" />,
    tools: [
      { href: "/master-data", label: "Quản lý dữ liệu chủ", desc: "NCC · vật tư · KH · tay nghề · UoM · lịch…", icon: <Tags className="h-4 w-4" /> },
      { href: "/operator-badges", label: "Thẻ vận hành viên", desc: "badgeCode → người dùng", icon: <Users className="h-4 w-4" /> },
      { href: "/metric-catalog", label: "Danh mục chỉ số", desc: "Semantic layer: định nghĩa KPI có phiên bản + lineage", icon: <BookOpen className="h-4 w-4" /> },
      { href: "/master-data-audit", label: "Nhật ký thay đổi", desc: "Ai đổi gì, khi nào (chỉ đọc)", icon: <History className="h-4 w-4" /> },
      { href: "/data-quality", label: "Chất lượng dữ liệu", desc: "Thiếu trường / tham chiếu mồ côi", icon: <ShieldCheck className="h-4 w-4" /> },
    ],
  },
  {
    key: "factoryConfig",
    label: "Cấu hình nhà máy & Quản trị",
    icon: <Building2 className="h-4 w-4" />,
    tools: [
      { href: "/datasettings", label: "Cấu hình nhà máy", desc: "Nhà máy · xưởng · line · trạm · máy · ca · công đoạn", icon: <Database className="h-4 w-4" /> },
      { href: "/workstation-management", label: "Trạm làm việc", desc: "Quản lý trạm làm việc", icon: <LayoutTemplate className="h-4 w-4" /> },
      { href: "/process-management", label: "Quy trình", desc: "Quản lý quy trình sản xuất", icon: <Workflow className="h-4 w-4" /> },
      { href: "/layout", label: "Sơ đồ bố trí", desc: "Bố trí mặt bằng nhà máy", icon: <LayoutTemplate className="h-4 w-4" /> },
    ],
  },
];

export default function DataManagementHub() {
  const { t } = useTranslation();
  const [active, setActive] = useState(CATEGORIES[0].key);
  const cat = CATEGORIES.find((c) => c.key === active) ?? CATEGORIES[0];

  return (
    <DashboardLayout title={t("dataHub.title", "Quản lý dữ liệu")}>
      <WorkspaceShell
        railDefaultSize={22}
        rail={
          <nav className="p-2">
            <p className="px-2 pb-1 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t("dataHub.categories", "Nhóm dữ liệu")}
            </p>
            <ul className="space-y-0.5">
              {CATEGORIES.map((c) => (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => setActive(c.key)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent/60",
                      active === c.key && "bg-accent font-medium",
                    )}
                  >
                    {c.icon}
                    <span className="min-w-0 flex-1 truncate">{c.label}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{c.tools.length}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        }
        main={
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {cat.icon}
              <h2 className="text-base font-semibold">{cat.label}</h2>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {cat.tools.map((tool) => (
                <Link key={tool.href} href={tool.href}>
                  <Card className="group cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40">
                    <CardContent className="flex items-start gap-3 p-3">
                      <div className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary">{tool.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1 text-sm font-medium">
                          <span className="truncate">{tool.label}</span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">{tool.desc}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        }
      />
    </DashboardLayout>
  );
}
