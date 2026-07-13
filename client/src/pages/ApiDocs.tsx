import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  Activity,
  Copy,
  Languages,
  RefreshCcw,
  Send,
  ShieldCheck,
  UploadCloud,
  Building2,
  Users2,
  ClipboardList,
  BarChart3,
  PanelsTopLeft,
  RadioTower,
  BellRing,
  CalendarClock,
  Camera,
  FileArchive,
  HardDrive,
  Wrench,
  Package,
  Crosshair,
  ListOrdered,
  LayoutDashboard,
  LayoutGrid,
  MapPin,
  UserCog,
  Bell,
  Shield,
  Lock,
  Cpu,
  Monitor,
  Gauge,
  FileText,
  Mail,
  Server,
  Wifi,
  Pencil,
  Brain,
  TrendingUp,
  ScrollText,
  Eye,
  Network,
  Plug2,
  ShoppingBag,
  Image,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { CodeBlock, glassCard } from "@/components/apiDocs/shared";
import { ThirdPartySection } from "@/components/apiDocs/ThirdPartySection";
import { MachineSection } from "@/components/apiDocs/MachineSection";
import { AoiPackageSection } from "@/components/apiDocs/AoiPackageSection";
import { MachineSyncSection } from "@/components/apiDocs/MachineSyncSection";
import { HierarchyTreeSection } from "@/components/apiDocs/HierarchyTreeSection";


type MenuItem = {
  id: string;
  label: string;
  icon: any;
  group?: string;
};

type MenuGroup = {
  label: string;
  items: MenuItem[];
};

export function ApiDocsContent() {
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
  const endpointBase = `${baseUrl || ""}/api/trpc`;
  const [activeMenu, setActiveMenu] = useState("thirdParty");

  const menuGroups: MenuGroup[] = [
    {
      label: "Third-Party Integration",
      items: [
        { id: "thirdParty", label: "Product API (Public)", icon: ShoppingBag },
        { id: "machine", label: "Machine APIs", icon: Activity },
        { id: "aoiPackage", label: "AOI Image Upload", icon: Camera },
        { id: "machineSync", label: "Machine Sync", icon: HardDrive },
        { id: "hierarchyTree", label: "Hierarchy Tree & MQTT", icon: Network },
      ],
    },
    {
      label: "Internal APIs",
      items: [
        { id: "auth", label: "Authentication", icon: ShieldCheck },
        { id: "factory", label: "Factory & Assets", icon: Building2 },
        { id: "assignments", label: "User Assignments", icon: Users2 },
        { id: "inspection", label: "Inspection APIs", icon: ClipboardList },
        { id: "stats", label: "Statistics & OEE", icon: BarChart3 },
        { id: "import", label: "Import/Export", icon: PanelsTopLeft },
        { id: "mqtt", label: "MQTT", icon: RadioTower },
        { id: "alerts", label: "Alerts", icon: BellRing },
        { id: "reports", label: "Scheduled Reports", icon: CalendarClock },
        { id: "workshop", label: "Workshop/Line/Station", icon: Wrench },
        { id: "productModel", label: "Product Models", icon: Package },
        { id: "measurementPoint", label: "Measurement Points", icon: Crosshair },
        { id: "productionOrder", label: "Production Orders", icon: ListOrdered },
        { id: "dashboardAnalytics", label: "Dashboard Analytics", icon: LayoutDashboard },
        { id: "dashboardWidget", label: "Dashboard Widgets", icon: LayoutGrid },
        { id: "layout", label: "Layout Management", icon: MapPin },
        { id: "userManagement", label: "User Management", icon: UserCog },
        { id: "notification", label: "Notifications", icon: Bell },
        { id: "permissions", label: "Permissions & RBAC", icon: Shield },
        { id: "security", label: "Security (2FA)", icon: Lock },
        { id: "machineStatus", label: "Machine Status", icon: Cpu },
        { id: "workstation", label: "Workstation Analytics", icon: Monitor },
        { id: "processOee", label: "Process & OEE", icon: Gauge },
        { id: "templateBulk", label: "Templates & Bulk", icon: FileText },
        { id: "smtpEmail", label: "SMTP & Email", icon: Mail },
        { id: "systemConfig", label: "System & Config", icon: Server },
        { id: "mqttAdvanced", label: "MQTT Management", icon: Wifi },
        { id: "ngRateThreshold", label: "NG Rate Threshold", icon: Gauge },
        { id: "inspectionImages", label: "Inspection Images", icon: Eye },
        { id: "annotationAI", label: "Annotations & AI", icon: Pencil },
        { id: "spcHeatmap", label: "SPC & Heatmap", icon: TrendingUp },
        { id: "audit", label: "Audit Logs", icon: ScrollText },
      ],
    },
  ];

  // ============================================================
  // AOI Image Package examples
  // ============================================================

  return (
    <>
      <div className="flex gap-6">
        {/* Left Sidebar */}
        <aside className="hidden lg:block w-64">
          <div className="sticky top-24 space-y-1 max-h-[calc(100vh-7rem)] overflow-y-auto pr-1">
            {menuGroups.map((group) => (
              <div key={group.label} className="mb-3">
                <p className="mb-2 px-3 text-xs font-semibold uppercase text-muted-foreground flex items-center gap-2">
                  {group.label === "Third-Party Integration" && <Plug2 className="h-3 w-3" />}
                  {group.label}
                </p>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveMenu(item.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left text-sm transition",
                        activeMenu === item.id
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 space-y-6">
          {/* Header */}
          <section className="overflow-hidden rounded-3xl border bg-linear-to-r from-slate-900 via-indigo-900 to-slate-900 p-8 text-white shadow-2xl">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-sm font-medium">
                <Languages className="h-4 w-4" />
                API Documentation
              </div>
              <h1 className="text-3xl font-semibold leading-tight">
                API Reference cho Hệ thống MES
              </h1>
              <p className="max-w-3xl text-base text-white/80">
                Tài liệu đầy đủ các API endpoint cho tích hợp hệ thống SYNAPSE. Sử dụng endpoint tRPC với xác thực API Key hoặc JWT.
              </p>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <Card className="border-white/20 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wide text-white/70">Base URL</CardTitle>
                  <CardDescription className="text-white text-base">
                    {endpointBase}
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-white/20 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wide text-white/70">Authentication</CardTitle>
                  <CardDescription className="text-white text-base">
                    Header X-API-Key hoặc JWT Cookie
                  </CardDescription>
                </CardHeader>
              </Card>
              <Card className="border-white/20 bg-white/5 text-white">
                <CardHeader>
                  <CardTitle className="text-sm uppercase tracking-wide text-white/70">Content-Type</CardTitle>
                  <CardDescription className="text-white text-base">application/json</CardDescription>
                </CardHeader>
              </Card>
            </div>
          </section>

          {/* ============ PUBLIC PRODUCT API (Third-Party) ============ */}
          {activeMenu === "thirdParty" && <ThirdPartySection endpointBase={endpointBase} baseUrl={baseUrl} />}

          {/* Machine APIs */}
          {activeMenu === "machine" && <MachineSection endpointBase={endpointBase} baseUrl={baseUrl} />}

          {/* Auth */}
          {activeMenu === "auth" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5" />
                    Authentication & Authorization
                  </CardTitle>
                  <CardDescription>
                    Hệ thống sử dụng Manus OAuth cho authentication và RBAC cho authorization.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Roles</h4>
                    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      <li><strong>admin:</strong> Full access to all resources</li>
                      <li><strong>user:</strong> Limited access based on corporate/factory assignments</li>
                    </ul>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <h4 className="mb-2 font-semibold">auth.me - Get Current User</h4>
                      <CodeBlock code={`const { data: user } = trpc.auth.me.useQuery();
// Returns: { id, openId, email, name, role, createdAt }`} />
                    </div>

                    <div>
                      <h4 className="mb-2 font-semibold">auth.localLogin - Login với Username/Password</h4>
                      <CodeBlock code={`const loginMutation = trpc.auth.localLogin.useMutation();
await loginMutation.mutateAsync({
  username: "admin",
  password: "password",
  totpCode: "123456" // Optional 2FA
});`} />
                    </div>

                    <div>
                      <h4 className="mb-2 font-semibold">auth.logout - Đăng xuất</h4>
                      <CodeBlock code={`const logoutMutation = trpc.auth.logout.useMutation();
await logoutMutation.mutateAsync();`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Factory Management */}
          {activeMenu === "factory" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Factory & Asset Management
                  </CardTitle>
                  <CardDescription>
                    Quản lý factory/workshop/line/station/machine kèm API Key.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">factory.list - Danh sách nhà máy</h4>
                    <CodeBlock code={`const { data: factories } = trpc.factory.list.useQuery();`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">factory.create - Tạo nhà máy mới (Admin)</h4>
                    <CodeBlock code={`const createMutation = trpc.factory.create.useMutation();
await createMutation.mutateAsync({
  code: "FAC001",
  name: "Factory Bắc Ninh",
  address: "VSIP"
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">machine.regenerateApiKey - Tạo lại API Key (Admin)</h4>
                    <CodeBlock code={`const regenerateMutation = trpc.machine.regenerateApiKey.useMutation();
const { apiKey } = await regenerateMutation.mutateAsync({ id: 5 });
// Response: { apiKey: "MCH-API-..." }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* User Assignments */}
          {activeMenu === "assignments" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users2 className="h-5 w-5" />
                    User Assignments & Access Control
                  </CardTitle>
                  <CardDescription>
                    Giới hạn phạm vi nhìn thấy dữ liệu theo corporate/factory assignment.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">userAssignment.getMyAssignments</h4>
                    <CodeBlock code={`const { data } = trpc.userAssignment.getMyAssignments.useQuery();
// Returns: { corporateAssignments: [...], factoryAssignments: [...] }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">userAssignment.assignCorporate (Admin)</h4>
                    <CodeBlock code={`const assignMutation = trpc.userAssignment.assignCorporate.useMutation();
await assignMutation.mutateAsync({
  userId: 42,
  corporateCode: "CORP001"
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">userAssignment.assignFactory (Admin)</h4>
                    <CodeBlock code={`const assignMutation = trpc.userAssignment.assignFactory.useMutation();
await assignMutation.mutateAsync({
  userId: 42,
  factoryCode: "FAC001"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Inspection APIs */}
          {activeMenu === "inspection" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardList className="h-5 w-5" />
                    Inspection APIs
                  </CardTitle>
                  <CardDescription>
                    Tra cứu và thao tác inspection record, hỗ trợ filter đa chiều.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">inspection.list - Danh sách inspection</h4>
                    <CodeBlock code={`const { data } = trpc.inspection.list.useQuery({
  machineId: 5,
  result: "NG",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31'),
  limit: 50,
  offset: 0
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">inspection.getById - Chi tiết inspection</h4>
                    <CodeBlock code={`const { data } = trpc.inspection.getById.useQuery({ id: 123 });`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">inspection.search - Search nâng cao</h4>
                    <CodeBlock code={`const { data } = trpc.inspection.search.useQuery({
  factoryCode: "FAC001",
  serialNumber: "SN",
  productModel: "MODEL-A",
  result: "NG"
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">inspection.updateNTF - Đánh dấu NTF (false positive)</h4>
                    <CodeBlock code={`const updateMutation = trpc.inspection.updateNTF.useMutation();
await updateMutation.mutateAsync({
  id: 123,
  isNTF: true,
  ntfReason: "Defect không ảnh hưởng chức năng"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Statistics */}
          {activeMenu === "stats" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Statistics & OEE
                  </CardTitle>
                  <CardDescription>
                    Dashboard tổng quan, yield trend, throughput đa tầng.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">corporateFactoryStats.yieldRateByCorporate</h4>
                    <CodeBlock code={`const { data } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});
// Returns: Array<{ corporateCode, totalInspections, okCount, ngCount, yieldRate }>`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">corporateFactoryStats.yieldRateByFactory</h4>
                    <CodeBlock code={`const { data } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({
  corporateCode: "CORP001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.stats - Thống kê tổng quan</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.stats.useQuery({
  factoryId: 1,
  startDate: new Date('2026-02-01'),
  endDate: new Date('2026-02-05')
});
// Returns: { totalOutput, okCount, ngCount, fpy, yieldRate }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Import/Export */}
          {activeMenu === "import" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <PanelsTopLeft className="h-5 w-5" />
                    Import / Export Pipelines
                  </CardTitle>
                  <CardDescription>
                    Bulk onboarding dữ liệu nền tảng bằng Excel/CSV.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">import.importFactories (Admin)</h4>
                    <CodeBlock code={`const importMutation = trpc.import.importFactories.useMutation();
const result = await importMutation.mutateAsync({ data: excelData });
// Response: { success: number, failed: number, errors: string[] }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">export.exportInspections (Admin)</h4>
                    <CodeBlock code={`const exportMutation = trpc.export.exportInspections.useMutation();
const result = await exportMutation.mutateAsync({
  corporateCode: "CORP001",
  factoryCode: "FAC001",
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-01-31')
});
// Returns: { fileUrl: "https://s3.../inspections.xlsx", recordCount: 1240 }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* MQTT */}
          {activeMenu === "mqtt" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RadioTower className="h-5 w-5" />
                    MQTT Connectivity
                  </CardTitle>
                  <CardDescription>
                    Giám sát broker, approve client, realtime throughput.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClient.status - Trạng thái broker</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClient.status.useQuery();
// Returns: { connected, brokerUrl, clientsOnline, messagesPerMinute }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">mqttClient.dashboardStats</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClient.dashboardStats.useQuery();
// Returns: { totalMessages, messagesSent, messagesFailed, ngAlerts }`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">mqttClient.approve (Admin)</h4>
                    <CodeBlock code={`const approveMutation = trpc.mqttClient.approve.useMutation();
await approveMutation.mutateAsync({ id: 5 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Alerts */}
          {activeMenu === "alerts" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BellRing className="h-5 w-5" />
                    Alerts & Notifications
                  </CardTitle>
                  <CardDescription>
                    Pipeline cảnh báo yield/máy offline với acknowledge flow.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">alert.list - Danh sách alerts</h4>
                    <CodeBlock code={`const { data } = trpc.alert.list.useQuery({
  severity: "HIGH",
  acknowledged: false
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">alert.acknowledge - Đánh dấu đã đọc</h4>
                    <CodeBlock code={`const acknowledgeMutation = trpc.alert.acknowledge.useMutation();
await acknowledgeMutation.mutateAsync({ id: 123 });`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">alert.create (Admin)</h4>
                    <CodeBlock code={`const createMutation = trpc.alert.create.useMutation();
await createMutation.mutateAsync({
  name: "High NG Rate Alert",
  alertType: "ng_count",
  threshold: "10",
  comparisonOperator: "gt",
  machineId: 5,
  notifyEmail: true,
  cooldownMinutes: 60
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* AOI Image Upload */}
          {activeMenu === "aoiPackage" && <AoiPackageSection endpointBase={endpointBase} baseUrl={baseUrl} />}

          {/* Machine Sync / Registration */}
          {activeMenu === "machineSync" && <MachineSyncSection endpointBase={endpointBase} baseUrl={baseUrl} />}

          {/* Scheduled Reports */}
          {activeMenu === "reports" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarClock className="h-5 w-5" />
                    Scheduled Reports
                  </CardTitle>
                  <CardDescription>
                    Lập lịch gửi báo cáo PDF/Excel qua email tự động.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">scheduledReport.list</h4>
                    <CodeBlock code={`const { data } = trpc.scheduledReport.list.useQuery();`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">scheduledReport.create (Admin)</h4>
                    <CodeBlock code={`const createMutation = trpc.scheduledReport.create.useMutation();
await createMutation.mutateAsync({
  name: "Daily Yield Report",
  reportType: "yield",
  schedule: "DAILY",
  scheduleTime: "07:30",
  recipients: ["qa@corp.com", "manager@corp.com"]
});`} />
                  </div>

                  <div>
                    <h4 className="mb-2 font-semibold">scheduledReport.trigger (Admin) - Chạy ngay lập tức</h4>
                    <CodeBlock code={`const triggerMutation = trpc.scheduledReport.trigger.useMutation();
await triggerMutation.mutateAsync({ id: 5 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Workshop / Line / Station */}
          {/* ============================================================ */}
          {activeMenu === "workshop" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wrench className="h-5 w-5" />
                    Workshop / Line / Station APIs
                  </CardTitle>
                  <CardDescription>
                    CRUD quản lý cấu trúc nhà máy: Workshop → Line → Station. Mỗi Factory có nhiều Workshop, mỗi Workshop có nhiều Line, mỗi Line có nhiều Station.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Workshop</CardTitle>
                  <CardDescription>Quản lý phân xưởng trong nhà máy</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.list — Danh sách workshop</h4>
                    <CodeBlock code={`// Query - lọc theo factoryCode
const { data } = trpc.workshop.list.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.listByFactory — Workshop theo nhà máy</h4>
                    <CodeBlock code={`const { data } = trpc.workshop.listByFactory.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.create — Tạo workshop mới</h4>
                    <CodeBlock code={`const mutation = trpc.workshop.create.useMutation();
await mutation.mutateAsync({
  code: "WS-01",
  name: "Phân xưởng SMT",
  factoryCode: "FAC-001",
  description: "Phân xưởng gắn linh kiện bề mặt"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workshop.update / workshop.delete</h4>
                    <CodeBlock code={`// Update
await trpc.workshop.update.mutate({ id: 1, name: "Phân xưởng SMT-A" });
// Delete
await trpc.workshop.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Line</CardTitle>
                  <CardDescription>Quản lý dây chuyền sản xuất trong workshop</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">line.list / line.listByWorkshop</h4>
                    <CodeBlock code={`const { data } = trpc.line.list.useQuery({ workshopId: 1 });
const { data: byWorkshop } = trpc.line.listByWorkshop.useQuery({ workshopId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">line.create — Tạo dây chuyền</h4>
                    <CodeBlock code={`await trpc.line.create.mutate({
  code: "LINE-01",
  name: "Dây chuyền 1",
  workshopId: 1,
  description: "Dây chuyền lắp ráp chính"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">line.update / line.delete</h4>
                    <CodeBlock code={`await trpc.line.update.mutate({ id: 1, name: "Line A" });
await trpc.line.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Station</CardTitle>
                  <CardDescription>Quản lý trạm (station) trong dây chuyền</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">station.list / station.listByLine</h4>
                    <CodeBlock code={`const { data } = trpc.station.list.useQuery({ lineId: 1 });
const { data: byLine } = trpc.station.listByLine.useQuery({ lineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">station.create — Tạo station</h4>
                    <CodeBlock code={`await trpc.station.create.mutate({
  code: "ST-01",
  name: "Station AOI 1",
  lineId: 1,
  description: "Trạm kiểm tra AOI",
  orderIndex: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">station.update / station.delete</h4>
                    <CodeBlock code={`await trpc.station.update.mutate({ id: 1, name: "Station AOI-A", orderIndex: 2 });
await trpc.station.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Product Models */}
          {/* ============================================================ */}
          {activeMenu === "productModel" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" />
                    Product Model APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý mã sản phẩm (Product Model), danh mục sản phẩm (Product Category), và mapping sản phẩm-máy.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Product Model CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.list — Danh sách sản phẩm</h4>
                    <CodeBlock code={`const { data } = trpc.productModel.list.useQuery({
  factoryCode: "FAC-001",
  search: "PCB",
  categoryId: 3
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.getById / getByCode</h4>
                    <CodeBlock code={`const { data } = trpc.productModel.getById.useQuery({ id: 1 });
const { data: byCode } = trpc.productModel.getByCode.useQuery({ code: "PCB-A01" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.create — Tạo sản phẩm</h4>
                    <CodeBlock code={`await trpc.productModel.create.mutate({
  code: "PCB-A01",
  name: "Main Board A01",
  description: "Bo mạch chính phiên bản A01",
  factoryCode: "FAC-001",
  categoryId: 3,
  image: "data:image/png;base64,..." // Optional
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productModel.update / productModel.delete</h4>
                    <CodeBlock code={`await trpc.productModel.update.mutate({ id: 1, name: "Main Board A02" });
await trpc.productModel.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Product Category</CardTitle>
                  <CardDescription>Danh mục sản phẩm dạng cây (tree)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productCategory.list / getTree</h4>
                    <CodeBlock code={`const { data } = trpc.productCategory.list.useQuery({ parentId: null });
const { data: tree } = trpc.productCategory.getTree.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productCategory.create — Tạo danh mục</h4>
                    <CodeBlock code={`await trpc.productCategory.create.mutate({
  code: "CAT-PCB",
  name: "PCB Boards",
  parentId: null,
  description: "Các loại bo mạch",
  icon: "circuit-board",
  color: "#3b82f6"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productCategory.reorder — Sắp xếp lại</h4>
                    <CodeBlock code={`await trpc.productCategory.reorder.mutate({
  parentId: null,
  orderedIds: [3, 1, 2, 5, 4]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Product-Machine Mapping</CardTitle>
                  <CardDescription>Ánh xạ sản phẩm với máy kiểm tra</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productMachineMapping.list / byMachine / byProduct</h4>
                    <CodeBlock code={`const { data } = trpc.productMachineMapping.list.useQuery({ factoryCode: "FAC-001" });
const { data: byMachine } = trpc.productMachineMapping.byMachine.useQuery({ machineId: 1 });
const { data: byProduct } = trpc.productMachineMapping.byProduct.useQuery({ productModelId: 5 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productMachineMapping.create / delete</h4>
                    <CodeBlock code={`await trpc.productMachineMapping.create.mutate({ machineId: 1, productModelId: 5 });
await trpc.productMachineMapping.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Measurement Points */}
          {/* ============================================================ */}
          {activeMenu === "measurementPoint" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Crosshair className="h-5 w-5" />
                    Measurement Point & Result APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý điểm đo (Measurement Point) trên sản phẩm và kết quả đo (Measurement Result) từ máy AOI/AVI.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Measurement Point</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.listByProductModel — Điểm đo theo sản phẩm</h4>
                    <CodeBlock code={`const { data } = trpc.measurementPoint.listByProductModel.useQuery({ productModelId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.listByMachine — Điểm đo theo máy</h4>
                    <CodeBlock code={`const { data } = trpc.measurementPoint.listByMachine.useQuery({ machineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.create — Tạo điểm đo</h4>
                    <CodeBlock code={`await trpc.measurementPoint.create.mutate({
  name: "IC U1 Solder Joint",
  code: "MP-IC-U1",
  productModelId: 1,
  pointType: "COMPONENT",
  xCoordinate: 120.5,
  yCoordinate: 85.3,
  width: 10,
  height: 10,
  upperLimit: 1.2,
  lowerLimit: 0.8,
  nominalValue: 1.0,
  unit: "mm",
  description: "Mối hàn IC U1"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.uploadCroppedImage — Upload ảnh crop</h4>
                    <CodeBlock code={`await trpc.measurementPoint.uploadCroppedImage.mutate({
  id: 1,
  image: "data:image/png;base64,..."
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementPoint.update / delete</h4>
                    <CodeBlock code={`await trpc.measurementPoint.update.mutate({ id: 1, upperLimit: 1.5 });
await trpc.measurementPoint.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Measurement Result</CardTitle>
                  <CardDescription>Kết quả đo từ máy AOI/AVI</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.getByInspection — Kết quả theo lần kiểm</h4>
                    <CodeBlock code={`const { data } = trpc.measurementResult.getByInspection.useQuery({
  inspectionId: 100,
  page: 1,
  limit: 50
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.updateRemark — Cập nhật ghi chú</h4>
                    <CodeBlock code={`await trpc.measurementResult.updateRemark.mutate({ id: 1, remark: "Cần kiểm tra lại" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.analyzeWithAI — Phân tích bằng AI</h4>
                    <CodeBlock code={`await trpc.measurementResult.analyzeWithAI.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">measurementResult.correctResult — Sửa kết quả</h4>
                    <CodeBlock code={`await trpc.measurementResult.correctResult.mutate({
  id: 1,
  correctedResult: "OK",
  reason: "False positive - mối hàn đạt chuẩn"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Batch Operations — Xử lý hàng loạt</h4>
                    <CodeBlock code={`// Batch acknowledge
await trpc.measurementResult.batchAcknowledge.mutate({ ids: [1, 2, 3] });
// Batch add note
await trpc.measurementResult.batchAddNote.mutate({ ids: [1, 2], note: "Reviewed OK" });
// Batch add tag
await trpc.measurementResult.batchAddTag.mutate({ ids: [1, 2, 3], tag: "critical" });
// Batch archive
await trpc.measurementResult.batchArchive.mutate({ ids: [4, 5, 6] });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Production Orders */}
          {/* ============================================================ */}
          {activeMenu === "productionOrder" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ListOrdered className="h-5 w-5" />
                    Production Order APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý đơn sản xuất, lịch trình, WIP tracking, và tối ưu hóa lịch sản xuất.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Production Order CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.list — Danh sách đơn sản xuất</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.list.useQuery({
  factoryCode: "FAC-001",
  lineId: 1,
  status: "IN_PROGRESS",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  page: 1,
  limit: 20
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.create — Tạo đơn sản xuất</h4>
                    <CodeBlock code={`await trpc.productionOrder.create.mutate({
  code: "PO-2025-001",
  productModelId: 1,
  lineId: 1,
  quantity: 5000,
  startDate: "2025-02-01",
  endDate: "2025-02-15",
  priority: "HIGH",
  notes: "Đơn hàng khách VIP"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.reschedule — Dời lịch</h4>
                    <CodeBlock code={`await trpc.productionOrder.reschedule.mutate({
  id: 1,
  startDate: "2025-02-05",
  endDate: "2025-02-20"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.checkScheduleOverlap — Kiểm tra xung đột lịch</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.checkScheduleOverlap.useQuery({
  lineId: 1,
  startDate: "2025-02-01",
  endDate: "2025-02-15",
  excludeId: 5 // Optional: loại trừ PO đang edit
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">WIP & Schedule Optimization</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.getWIPStatus — Trạng thái WIP</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.getWIPStatus.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.getWIPByLine — WIP theo dây chuyền</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.getWIPByLine.useQuery({ lineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.optimizeSchedule — Tối ưu lịch (AI)</h4>
                    <CodeBlock code={`const result = await trpc.productionOrder.optimizeSchedule.mutate({
  lineId: 1,
  startDate: "2025-02-01",
  endDate: "2025-02-28"
});
// Trả về danh sách suggestions`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.applyScheduleSuggestion — Áp dụng gợi ý</h4>
                    <CodeBlock code={`await trpc.productionOrder.applyScheduleSuggestion.mutate({
  suggestions: [{ orderId: 1, newStartDate: "2025-02-05", newEndDate: "2025-02-18" }]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Production Order Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.listTemplates / createTemplate</h4>
                    <CodeBlock code={`const { data } = trpc.productionOrder.listTemplates.useQuery({ lineId: 1 });
await trpc.productionOrder.createTemplate.mutate({
  name: "Standard PCB Run",
  productModelId: 1,
  lineId: 1,
  quantity: 5000,
  priority: "MEDIUM"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">productionOrder.createFromTemplate — Tạo từ template</h4>
                    <CodeBlock code={`await trpc.productionOrder.createFromTemplate.mutate({
  templateId: 1,
  startDate: "2025-03-01",
  endDate: "2025-03-15",
  code: "PO-2025-010"
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Line Stage & Line-Product Assignment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">lineStage.list / create / reorder</h4>
                    <CodeBlock code={`const { data } = trpc.lineStage.list.useQuery({ lineId: 1 });
await trpc.lineStage.create.mutate({
  name: "AOI Inspection",
  lineId: 1,
  description: "Kiểm tra AOI",
  orderIndex: 3
});
await trpc.lineStage.reorder.mutate({ lineId: 1, orderedIds: [3, 1, 2] });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">lineProductAssignment.list / create / delete</h4>
                    <CodeBlock code={`const { data } = trpc.lineProductAssignment.list.useQuery({ lineId: 1 });
await trpc.lineProductAssignment.create.mutate({ lineId: 1, productModelId: 5 });
await trpc.lineProductAssignment.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Dashboard Analytics */}
          {/* ============================================================ */}
          {activeMenu === "dashboardAnalytics" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LayoutDashboard className="h-5 w-5" />
                    Dashboard Analytics APIs
                  </CardTitle>
                  <CardDescription>
                    API thống kê dashboard: tổng quan, xu hướng, so sánh ca, top/bottom máy, và drill-down analysis.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Dashboard Stats</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getStats — Thống kê tổng quan</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getStats.useQuery({
  factoryCode: "FAC-001",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getMachineStats — Thống kê theo máy</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getMachineStats.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getDailyStats — Thống kê theo ngày</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getDailyStats.useQuery({
  factoryCode: "FAC-001",
  days: 7
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getStatsWithComparison — So sánh kỳ</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getStatsWithComparison.useQuery({
  factoryCode: "FAC-001",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getShiftStats — Thống kê theo ca</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getShiftStats.useQuery({
  factoryCode: "FAC-001",
  date: "2025-01-15"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getTopBottomMachines — Top/Bottom máy</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getTopBottomMachines.useQuery({
  factoryCode: "FAC-001",
  limit: 5,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getHourlyStats — Thống kê theo giờ</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getHourlyStats.useQuery({
  factoryCode: "FAC-001",
  date: "2025-01-15"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.getActiveAlertsCount — Số cảnh báo active</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.getActiveAlertsCount.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Dashboard Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.listTemplates / getTemplate</h4>
                    <CodeBlock code={`const { data } = trpc.dashboard.listTemplates.useQuery({ category: "quality" });
const { data: tpl } = trpc.dashboard.getTemplate.useQuery({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboard.createTemplate / applyTemplate</h4>
                    <CodeBlock code={`await trpc.dashboard.createTemplate.mutate({
  name: "Quality Overview",
  category: "quality",
  description: "Template tổng quan chất lượng",
  config: { widgets: [...], layout: {...} }
});
await trpc.dashboard.applyTemplate.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Drill-Down Analysis</CardTitle>
                  <CardDescription>Phân tích chi tiết từ Corporate → Factory → Line → Machine</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">drillDown.corporateStats — Tổng quan corporate</h4>
                    <CodeBlock code={`const { data } = trpc.drillDown.corporateStats.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">drillDown.factoriesByCorporate → linesByFactory → machinesByLine</h4>
                    <CodeBlock code={`// Level 1: Factories
const { data: factories } = trpc.drillDown.factoriesByCorporate.useQuery({ startDate, endDate });
// Level 2: Lines by factory
const { data: lines } = trpc.drillDown.linesByFactory.useQuery({ factoryCode: "FAC-001", startDate, endDate });
// Level 3: Machines by line
const { data: machines } = trpc.drillDown.machinesByLine.useQuery({ lineId: 1, startDate, endDate });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Dashboard Widgets */}
          {/* ============================================================ */}
          {activeMenu === "dashboardWidget" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <LayoutGrid className="h-5 w-5" />
                    Dashboard Widget APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý layout widget dashboard, shared templates, style presets, và custom dashboards.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Widget Layout</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.getLayout — Lấy layout hiện tại</h4>
                    <CodeBlock code={`const { data } = trpc.dashboardWidget.getLayout.useQuery({ dashboardId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.saveLayout — Lưu layout</h4>
                    <CodeBlock code={`await trpc.dashboardWidget.saveLayout.mutate({
  dashboardId: 1,
  widgets: [
    { id: "w1", type: "yield-chart", x: 0, y: 0, w: 6, h: 4, config: {} },
    { id: "w2", type: "machine-status", x: 6, y: 0, w: 6, h: 4, config: {} }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.resetLayout — Reset về mặc định</h4>
                    <CodeBlock code={`await trpc.dashboardWidget.resetLayout.mutate({ dashboardId: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Shared Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.getSharedTemplates — Danh sách template chia sẻ</h4>
                    <CodeBlock code={`const { data } = trpc.dashboardWidget.getSharedTemplates.useQuery({
  category: "quality",
  search: "yield"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">dashboardWidget.createSharedTemplate / applySharedTemplate</h4>
                    <CodeBlock code={`// Create template từ config hiện tại
await trpc.dashboardWidget.createSharedTemplate.mutate({
  name: "Quality Dashboard v2",
  category: "quality",
  description: "Template chất lượng phiên bản 2",
  config: { widgets: [...] }
});
// Apply template
await trpc.dashboardWidget.applySharedTemplate.mutate({ id: 1, dashboardId: 2 });
// Save current layout as shared template
await trpc.dashboardWidget.saveAsSharedTemplate.mutate({
  name: "My Layout",
  category: "custom",
  dashboardId: 1
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Layout Management */}
          {/* ============================================================ */}
          {activeMenu === "layout" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
                    Layout Management APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý layout mặt bằng nhà máy, vị trí máy trên layout (dùng cho Factory Map view).
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">layout.listByWorkshop — Layout theo workshop</h4>
                    <CodeBlock code={`const { data } = trpc.layout.listByWorkshop.useQuery({ workshopId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">layout.create — Tạo layout</h4>
                    <CodeBlock code={`await trpc.layout.create.mutate({
  name: "Workshop A Floor Plan",
  workshopId: 1,
  width: 1200,
  height: 800,
  backgroundImage: "data:image/png;base64,..." // Optional floor plan image
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">layout.addMachinePosition — Đặt vị trí máy</h4>
                    <CodeBlock code={`await trpc.layout.addMachinePosition.mutate({
  layoutId: 1,
  machineId: 5,
  x: 150,
  y: 200,
  width: 60,
  height: 40,
  rotation: 0
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">layout.updateMachinePosition / removeMachinePosition</h4>
                    <CodeBlock code={`await trpc.layout.updateMachinePosition.mutate({ id: 1, x: 180, y: 220, rotation: 90 });
await trpc.layout.removeMachinePosition.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* User Management */}
          {/* ============================================================ */}
          {activeMenu === "userManagement" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserCog className="h-5 w-5" />
                    User Management APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý người dùng: CRUD, phân quyền, đổi mật khẩu, profile, và cài đặt cá nhân.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">User CRUD (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">user.list — Danh sách user</h4>
                    <CodeBlock code={`const { data } = trpc.user.list.useQuery({
  search: "nguyen",
  role: "OPERATOR",
  factoryCode: "FAC-001"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">user.create — Tạo user mới (Admin)</h4>
                    <CodeBlock code={`await trpc.user.create.mutate({
  username: "operator01",
  password: "SecurePass@123",
  fullName: "Nguyễn Văn A",
  email: "a@factory.com",
  role: "OPERATOR",
  factoryCode: "FAC-001"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">user.update / updateRole / updatePassword / delete</h4>
                    <CodeBlock code={`await trpc.user.update.mutate({ id: 1, fullName: "Nguyễn Văn B" });
await trpc.user.updateRole.mutate({ id: 1, role: "QC_MANAGER" });
await trpc.user.updatePassword.mutate({ id: 1, password: "NewPass@456" });
await trpc.user.delete.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Profile & Settings (Self)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">user.updateProfile — Cập nhật profile cá nhân</h4>
                    <CodeBlock code={`await trpc.user.updateProfile.mutate({
  fullName: "Nguyễn Văn C",
  email: "c@factory.com",
  avatar: "data:image/png;base64,..."
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">user.changePassword — Đổi mật khẩu</h4>
                    <CodeBlock code={`await trpc.user.changePassword.mutate({
  currentPassword: "OldPass@123",
  newPassword: "NewPass@789"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">userSettings.get / update — Cài đặt cá nhân</h4>
                    <CodeBlock code={`const { data } = trpc.userSettings.get.useQuery();
await trpc.userSettings.update.mutate({
  language: "vi",
  theme: "dark",
  timezone: "Asia/Ho_Chi_Minh",
  dateFormat: "DD/MM/YYYY",
  notifications: { email: true, push: false, inApp: true }
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Notifications */}
          {/* ============================================================ */}
          {activeMenu === "notification" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Notification APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý thông báo: danh sách, đánh dấu đã đọc, cài đặt preferences, gửi thông báo.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">notification.list — Danh sách thông báo</h4>
                    <CodeBlock code={`const { data } = trpc.notification.list.useQuery({
  page: 1,
  limit: 20,
  unreadOnly: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.unreadCount — Số thông báo chưa đọc</h4>
                    <CodeBlock code={`const { data } = trpc.notification.unreadCount.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.markAsRead / markAllAsRead</h4>
                    <CodeBlock code={`await trpc.notification.markAsRead.mutate({ id: 1 });
await trpc.notification.markAllAsRead.mutate();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.delete / deleteOld</h4>
                    <CodeBlock code={`await trpc.notification.delete.mutate({ id: 1 });
await trpc.notification.deleteOld.mutate({ days: 30 }); // Xóa thông báo > 30 ngày`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.getPreferences / updatePreferences</h4>
                    <CodeBlock code={`const { data } = trpc.notification.getPreferences.useQuery();
await trpc.notification.updatePreferences.mutate({
  email: true,
  push: true,
  inApp: true,
  types: ["alert", "report", "system"]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">notification.sendToUser / broadcast (Admin)</h4>
                    <CodeBlock code={`// Send to specific user
await trpc.notification.sendToUser.mutate({
  userId: 5,
  title: "Cập nhật hệ thống",
  content: "Hệ thống sẽ bảo trì lúc 22:00",
  type: "system"
});
// Broadcast to all users (or by factory)
await trpc.notification.broadcast.mutate({
  title: "Thông báo chung",
  content: "Phiên bản mới đã được cập nhật",
  type: "system",
  factoryCode: "FAC-001" // Optional: chỉ gửi cho factory cụ thể
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Permissions & RBAC */}
          {/* ============================================================ */}
          {activeMenu === "permissions" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Permissions & RBAC APIs
                  </CardTitle>
                  <CardDescription>
                    Hệ thống phân quyền chi tiết: Role-Based Access Control, module-level permissions, custom roles.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Role Management (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.listRoles / listRoleTypes</h4>
                    <CodeBlock code={`const { data: roles } = trpc.permissions.listRoles.useQuery();
const { data: roleTypes } = trpc.permissions.listRoleTypes.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.createRole — Tạo custom role</h4>
                    <CodeBlock code={`await trpc.permissions.createRole.mutate({
  name: "QC_SUPERVISOR",
  description: "Quản lý QC cấp trung",
  permissions: [
    { category: "quality", moduleName: "inspection", canView: true, canEdit: true },
    { category: "quality", moduleName: "annotation", canView: true, canCreate: true }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.updateRole / deleteRole</h4>
                    <CodeBlock code={`await trpc.permissions.updateRole.mutate({ id: 1, name: "QC_LEAD", permissions: [...] });
await trpc.permissions.deleteRole.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getRoleStatistics — Thống kê role</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getRoleStatistics.useQuery();`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">User Permissions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getMyPermissions — Quyền của mình</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getMyPermissions.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getUserPermissions — Quyền user cụ thể</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getUserPermissions.useQuery({ userId: 5 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.upsertPermission — Set quyền chi tiết (Admin)</h4>
                    <CodeBlock code={`await trpc.permissions.upsertPermission.mutate({
  userId: 5,
  category: "production",
  moduleName: "productionOrder",
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: false,
  canExport: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.batchUpdateUserPermissions — Cập nhật hàng loạt (Admin)</h4>
                    <CodeBlock code={`await trpc.permissions.batchUpdateUserPermissions.mutate({
  userId: 5,
  permissions: [
    { category: "quality", moduleName: "inspection", canView: true, canCreate: false, canEdit: false, canDelete: false, canExport: true },
    { category: "quality", moduleName: "annotation", canView: true, canCreate: true, canEdit: true, canDelete: false, canExport: false }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.applyRolePermissions — Áp dụng quyền mặc định từ role</h4>
                    <CodeBlock code={`await trpc.permissions.applyRolePermissions.mutate({ userId: 5, role: "QC_MANAGER" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">permissions.getAvailableModules — Danh sách modules</h4>
                    <CodeBlock code={`const { data } = trpc.permissions.getAvailableModules.useQuery();`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Security (2FA / Sessions) */}
          {/* ============================================================ */}
          {activeMenu === "security" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="h-5 w-5" />
                    Security APIs (2FA & Sessions)
                  </CardTitle>
                  <CardDescription>
                    Xác thực 2 yếu tố (TOTP), quản lý phiên đăng nhập, backup codes.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Two-Factor Authentication (TOTP)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.getStatus — Kiểm tra trạng thái 2FA</h4>
                    <CodeBlock code={`const { data } = trpc.twoFactor.getStatus.useQuery();
// { enabled: false, hasBackupCodes: false }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.generateSecret — Tạo secret key (QR code)</h4>
                    <CodeBlock code={`const result = await trpc.twoFactor.generateSecret.mutate();
// { secret: "JBSWY3DPEHPK3PXP", otpauthUrl: "otpauth://totp/...", qrCode: "data:image/png;base64,..." }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.enable — Bật 2FA (xác nhận bằng mã TOTP)</h4>
                    <CodeBlock code={`await trpc.twoFactor.enable.mutate({ code: "123456" }); // Mã 6 số từ authenticator app`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.verify — Xác thực mã TOTP khi đăng nhập</h4>
                    <CodeBlock code={`await trpc.twoFactor.verify.mutate({ code: "654321" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.disable — Tắt 2FA</h4>
                    <CodeBlock code={`await trpc.twoFactor.disable.mutate({ code: "123456" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">twoFactor.regenerateBackupCodes — Tạo lại backup codes</h4>
                    <CodeBlock code={`const result = await trpc.twoFactor.regenerateBackupCodes.mutate({ code: "123456" });
// { backupCodes: ["abc12345", "def67890", ...] }`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Session Management</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">session.list — Danh sách phiên đăng nhập</h4>
                    <CodeBlock code={`const { data } = trpc.session.list.useQuery();
// [{ id, deviceInfo, ipAddress, lastActive, isCurrent }]`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">session.count — Số phiên active</h4>
                    <CodeBlock code={`const { data } = trpc.session.count.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">session.revoke / revokeAll — Thu hồi phiên</h4>
                    <CodeBlock code={`await trpc.session.revoke.mutate({ sessionId: "sess_abc123" });
await trpc.session.revokeAll.mutate(); // Đăng xuất tất cả thiết bị`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Machine Status */}
          {/* ============================================================ */}
          {activeMenu === "machineStatus" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Cpu className="h-5 w-5" />
                    Machine Status APIs
                  </CardTitle>
                  <CardDescription>
                    Giám sát trạng thái máy real-time, lịch sử uptime, cấu hình cảnh báo offline, và manual mapping.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Machine Status & Uptime</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.listWithStatus — DS máy kèm trạng thái</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.listWithStatus.useQuery({ factoryCode: "FAC-001" });
// [{ id, name, status: "online"|"offline", lastHeartbeat, uptimePercent }]`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getLogs / getHeartbeats — Lịch sử</h4>
                    <CodeBlock code={`const { data: logs } = trpc.machineStatus.getLogs.useQuery({ machineId: 1, limit: 50 });
const { data: heartbeats } = trpc.machineStatus.getHeartbeats.useQuery({ machineId: 1, limit: 100 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getUptimeStats — Thống kê uptime</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getUptimeStats.useQuery({ machineId: 1, days: 30 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getUptimeTimeline — Timeline uptime</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getUptimeTimeline.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getReport — Báo cáo trạng thái</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getReport.useQuery({
  factoryCode: "FAC-001",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Alert Config & Offline Detection</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">machineStatus.getAlertConfig / updateAlertConfig</h4>
                    <CodeBlock code={`const { data } = trpc.machineStatus.getAlertConfig.useQuery({ machineId: 1 });
await trpc.machineStatus.updateAlertConfig.mutate({
  machineId: 1,
  offlineThresholdMinutes: 15,
  notifyEmail: true,
  notifyPush: true
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Manual Mapping</CardTitle>
                  <CardDescription>Cấu hình kết nối thủ công cho máy (FTP, SMB, HTTP)</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">manualMapping.create — Tạo mapping thủ công</h4>
                    <CodeBlock code={`await trpc.manualMapping.create.mutate({
  machineId: 1,
  connectionType: "FTP",
  host: "192.168.1.100",
  port: 21,
  path: "/aoi/results",
  description: "AOI-01 FTP Export"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">manualMapping.testConnection — Test kết nối</h4>
                    <CodeBlock code={`const result = await trpc.manualMapping.testConnection.mutate({ id: 1 });
// { success: true, latencyMs: 45 }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">manualMapping.updateStatus — Cập nhật trạng thái</h4>
                    <CodeBlock code={`await trpc.manualMapping.updateStatus.mutate({ id: 1, status: "active" });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Workstation Analytics */}
          {/* ============================================================ */}
          {activeMenu === "workstation" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Monitor className="h-5 w-5" />
                    Workstation Analytics APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý workstation, phân tích lỗi, xu hướng NG, top measurement points lỗi cao.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.list — Danh sách workstation</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.list.useQuery({ machineId: 1, lineId: 2 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.create — Tạo workstation</h4>
                    <CodeBlock code={`await trpc.workstation.create.mutate({
  name: "Workstation A1",
  code: "WS-A1",
  machineId: 1,
  lineId: 2,
  description: "Trạm kiểm tra component bên trái"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.summary — Tổng hợp phân tích</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.summary.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.defectsByWorkstation — Lỗi theo workstation</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.defectsByWorkstation.useQuery({
  workstationId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.topNGMeasurementPoints — Top điểm lỗi</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.topNGMeasurementPoints.useQuery({
  workstationId: 1,
  limit: 10
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.ngTrend — Xu hướng NG theo ngày</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.ngTrend.useQuery({ workstationId: 1, days: 14 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">workstation.ngComparison — So sánh NG giữa workstations</h4>
                    <CodeBlock code={`const { data } = trpc.workstation.ngComparison.useQuery({
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Process & OEE */}
          {/* ============================================================ */}
          {activeMenu === "processOee" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="h-5 w-5" />
                    Process, OEE & Shift Config APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý quy trình sản xuất, OEE targets, cấu hình ca làm việc, và ngưỡng yield.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Process Management</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">process.list — Danh sách quy trình</h4>
                    <CodeBlock code={`const { data } = trpc.process.list.useQuery({
  processType: "SMT", // SMT | DIP | ASSEMBLY | TESTING | PACKAGING | INSPECTION | OTHER
  isActive: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.create — Tạo quy trình (Admin)</h4>
                    <CodeBlock code={`await trpc.process.create.mutate({
  code: "PROC-SMT-01",
  name: "SMT Placement",
  description: "Gắn linh kiện bề mặt",
  processType: "SMT",
  cycleTimeTarget: 30,
  orderIndex: 1,
  color: "#3b82f6",
  icon: "cpu"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.reorder — Sắp xếp lại thứ tự</h4>
                    <CodeBlock code={`await trpc.process.reorder.mutate({ orderedIds: [3, 1, 2, 4] });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Line-Process Assignment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">process.getLineAssignments — Quy trình gán cho line</h4>
                    <CodeBlock code={`const { data } = trpc.process.getLineAssignments.useQuery({ lineId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.createLineAssignment — Gán quy trình cho line</h4>
                    <CodeBlock code={`await trpc.process.createLineAssignment.mutate({
  lineId: 1,
  processId: 3,
  orderIndex: 2,
  cycleTimeTarget: 45,
  stationId: 5
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">process.reorderLineAssignments</h4>
                    <CodeBlock code={`await trpc.process.reorderLineAssignments.mutate({ lineId: 1, orderedIds: [2, 3, 1] });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">OEE Targets</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">oee.listTargets — DS mục tiêu OEE</h4>
                    <CodeBlock code={`const { data } = trpc.oee.listTargets.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">oee.createTarget — Set mục tiêu OEE cho máy</h4>
                    <CodeBlock code={`await trpc.oee.createTarget.mutate({
  machineId: 1,
  availability: 95,  // %
  performance: 90,   // %
  quality: 99        // %
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">oee.updateTarget / deleteTarget</h4>
                    <CodeBlock code={`await trpc.oee.updateTarget.mutate({ id: 1, quality: 99.5 });
await trpc.oee.deleteTarget.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Yield Threshold</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">yieldThreshold.list / getEnabled — DS ngưỡng yield</h4>
                    <CodeBlock code={`const { data } = trpc.yieldThreshold.list.useQuery({ type: "FACTORY" });
const { data: enabled } = trpc.yieldThreshold.getEnabled.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">yieldThreshold.updateWithHistory — Cập nhật có lịch sử</h4>
                    <CodeBlock code={`await trpc.yieldThreshold.updateWithHistory.mutate({
  id: 1,
  warningThreshold: 95,
  criticalThreshold: 90,
  isEnabled: true,
  reason: "Nâng ngưỡng theo KPI Q1 2025"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">yieldThreshold.getHistory — Lịch sử thay đổi</h4>
                    <CodeBlock code={`const { data } = trpc.yieldThreshold.getHistory.useQuery({ limit: 20, offset: 0 });
const { data: byType } = trpc.yieldThreshold.getHistoryByType.useQuery({ type: "MACHINE", limit: 10 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Shift Config</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">shiftConfig.list / defaults</h4>
                    <CodeBlock code={`const { data } = trpc.shiftConfig.list.useQuery({ factoryCode: "FAC-001" });
const { data: defaults } = trpc.shiftConfig.defaults.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">shiftConfig.create — Tạo ca làm việc</h4>
                    <CodeBlock code={`await trpc.shiftConfig.create.mutate({
  name: "Ca sáng",
  startTime: "06:00",
  endTime: "14:00",
  factoryCode: "FAC-001",
  isDefault: false
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Templates & Bulk Import */}
          {/* ============================================================ */}
          {activeMenu === "templateBulk" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Templates, Bulk Import & Export APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý template cấu hình, import/export dữ liệu hàng loạt.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Template CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">template.list / getById / getByCategory</h4>
                    <CodeBlock code={`const { data } = trpc.template.list.useQuery({ category: "dashboard" });
const { data: tpl } = trpc.template.getById.useQuery({ id: 1 });
const { data: byCategory } = trpc.template.getByCategory.useQuery({ category: "report" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">template.create — Tạo template</h4>
                    <CodeBlock code={`await trpc.template.create.mutate({
  name: "Default Dashboard",
  category: "dashboard",
  description: "Template dashboard mặc định",
  config: { widgets: [...], layout: {...} }
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">template.clone — Nhân bản template</h4>
                    <CodeBlock code={`await trpc.template.clone.mutate({ id: 1, newName: "Dashboard v2" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Bulk Import</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">bulkImport.measurementPoints — Import điểm đo hàng loạt</h4>
                    <CodeBlock code={`await trpc.bulkImport.measurementPoints.mutate({
  productModelId: 1,
  points: [
    { name: "IC U1", code: "MP-01", pointType: "COMPONENT", xCoordinate: 100, yCoordinate: 50 },
    { name: "IC U2", code: "MP-02", pointType: "COMPONENT", xCoordinate: 200, yCoordinate: 80 },
    // ... more points
  ]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Export APIs</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">export.exportInspections — Xuất dữ liệu inspection</h4>
                    <CodeBlock code={`await trpc.export.exportInspections.mutate({
  factoryCode: "FAC-001",
  machineId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  format: "xlsx" // csv | xlsx | json
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">export.exportStatistics / exportDashboardStats</h4>
                    <CodeBlock code={`await trpc.export.exportStatistics.mutate({ factoryCode: "FAC-001", format: "xlsx" });
await trpc.export.exportDashboardStats.mutate({ factoryCode: "FAC-001", format: "csv" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Các export khác</h4>
                    <CodeBlock code={`await trpc.export.exportProducts.mutate({ factoryCode: "FAC-001", format: "json" });
await trpc.export.exportMachines.mutate({ factoryCode: "FAC-001", format: "xlsx" });
await trpc.export.exportMeasurementPoints.mutate({ productModelId: 1, format: "csv" });
await trpc.export.exportFactories.mutate({ format: "xlsx" });
await trpc.export.exportWorkshops.mutate({ factoryCode: "FAC-001", format: "json" });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* SMTP & Email */}
          {/* ============================================================ */}
          {activeMenu === "smtpEmail" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Mail className="h-5 w-5" />
                    SMTP & Email APIs
                  </CardTitle>
                  <CardDescription>
                    Cấu hình SMTP server, quản lý email templates, test gửi mail.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">SMTP Configuration</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.getConfig — Lấy cấu hình SMTP</h4>
                    <CodeBlock code={`const { data } = trpc.smtp.getConfig.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.updateConfig — Cập nhật cấu hình SMTP</h4>
                    <CodeBlock code={`await trpc.smtp.updateConfig.mutate({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  user: "noreply@company.com",
  password: "app-password",
  fromEmail: "noreply@company.com",
  fromName: "SYNAPSE"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.testConnection — Test gửi mail</h4>
                    <CodeBlock code={`await trpc.smtp.testConnection.mutate({ toEmail: "test@company.com" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Email Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.getEmailTemplates — DS template email</h4>
                    <CodeBlock code={`const { data } = trpc.smtp.getEmailTemplates.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.createEmailTemplate — Tạo template</h4>
                    <CodeBlock code={`await trpc.smtp.createEmailTemplate.mutate({
  name: "Alert Notification",
  type: "alert",
  subject: "[ALERT] {{machineName}} - {{alertType}}",
  body: "<h1>Cảnh báo từ máy {{machineName}}</h1><p>{{alertContent}}</p>",
  isDefault: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.setDefaultEmailTemplate — Set template mặc định</h4>
                    <CodeBlock code={`await trpc.smtp.setDefaultEmailTemplate.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">smtp.getDefaultEmailTemplate — Lấy template mặc định theo loại</h4>
                    <CodeBlock code={`const { data } = trpc.smtp.getDefaultEmailTemplate.useQuery({ type: "alert" });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* System & Config */}
          {/* ============================================================ */}
          {activeMenu === "systemConfig" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="h-5 w-5" />
                    System & Configuration APIs
                  </CardTitle>
                  <CardDescription>
                    Health check, query monitoring, backup/restore, scheduled backups, marketplace, và system config.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">System Health & Config</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.health — Health check (Public)</h4>
                    <CodeBlock code={`const { data } = trpc.system.health.useQuery({ timestamp: Date.now() });
// { status: "ok", uptime, database: "connected", version }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">systemConfig.list / getByKey — Cấu hình hệ thống</h4>
                    <CodeBlock code={`const { data } = trpc.systemConfig.list.useQuery({ category: "general" });
const { data: val } = trpc.systemConfig.getByKey.useQuery({ key: "maintenance_mode" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">systemConfig.create / update — CRUD config</h4>
                    <CodeBlock code={`await trpc.systemConfig.create.mutate({
  key: "max_upload_size_mb",
  value: "100",
  category: "upload",
  description: "Max upload file size in MB"
});
await trpc.systemConfig.update.mutate({ key: "max_upload_size_mb", value: "200" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Backup & Restore (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.exportConfig — Export cấu hình</h4>
                    <CodeBlock code={`const { data } = trpc.system.exportConfig.useQuery({
  categories: ["factories", "machines", "users", "templates"]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.importConfig — Import cấu hình</h4>
                    <CodeBlock code={`await trpc.system.importConfig.mutate({
  data: exportedData,
  categories: ["factories", "machines"],
  overwrite: false
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.backupLogs.list — Lịch sử backup</h4>
                    <CodeBlock code={`const { data } = trpc.system.backupLogs.list.useQuery({
  action: "export",
  status: "success",
  limit: 50
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Scheduled Backups (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.scheduledBackups.list / create</h4>
                    <CodeBlock code={`const { data } = trpc.system.scheduledBackups.list.useQuery({ enabledOnly: true });
await trpc.system.scheduledBackups.create.mutate({
  name: "Daily Full Backup",
  description: "Backup toàn bộ dữ liệu hàng ngày",
  categories: ["factories", "machines", "inspections", "templates"],
  schedule: "daily",
  scheduleTime: "02:00",
  retentionCount: 7,
  storageType: "s3",
  createdBy: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.scheduledBackups.toggle — Bật/tắt lịch backup</h4>
                    <CodeBlock code={`await trpc.system.scheduledBackups.toggle.mutate({ id: 1, isEnabled: true });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Query Monitoring (Admin)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.queryMonitoring.getSlowQueries — Queries chậm</h4>
                    <CodeBlock code={`const { data } = trpc.system.queryMonitoring.getSlowQueries.useQuery({ limit: 50 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.queryMonitoring.getStats / analyzePatterns</h4>
                    <CodeBlock code={`const { data: stats } = trpc.system.queryMonitoring.getStats.useQuery();
const { data: patterns } = trpc.system.queryMonitoring.analyzePatterns.useQuery({ limit: 20 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Marketplace</CardTitle>
                  <CardDescription>Template marketplace cho chia sẻ cộng đồng</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.list — Duyệt marketplace</h4>
                    <CodeBlock code={`const { data } = trpc.system.marketplace.list.useQuery({
  category: "dashboard",
  search: "quality",
  sortBy: "rating", // rating | downloads | newest
  limit: 20
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.publish — Publish template (Admin)</h4>
                    <CodeBlock code={`await trpc.system.marketplace.publish.mutate({
  templateId: 1,
  publisherId: "company-name",
  title: "Quality Dashboard Pro",
  description: "Professional quality monitoring dashboard",
  category: "dashboard",
  tags: ["quality", "monitoring", "yield"]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.download — Tải template</h4>
                    <CodeBlock code={`await trpc.system.marketplace.download.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">system.marketplace.reviews.list / create — Đánh giá</h4>
                    <CodeBlock code={`const { data } = trpc.system.marketplace.reviews.list.useQuery({ marketplaceId: 1 });
await trpc.system.marketplace.reviews.create.mutate({
  marketplaceId: 1,
  userId: 5,
  rating: 5,
  comment: "Excellent template!"
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* MQTT Advanced Management */}
          {/* ============================================================ */}
          {activeMenu === "mqttAdvanced" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Wifi className="h-5 w-5" />
                    MQTT Management APIs
                  </CardTitle>
                  <CardDescription>
                    Quản lý MQTT client nâng cao: profiles, assignments, connection monitoring, alerts, bulletin scheduling, và reconnect analytics.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Client Profiles</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.listProfiles — DS profiles</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.listProfiles.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.createProfile — Tạo profile (Admin)</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.createProfile.mutate({
  name: "Production MQTT",
  brokerUrl: "mqtt://broker.local:1883",
  username: "prod-user",
  password: "secret",
  keepAlive: 60,
  cleanSession: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.duplicateProfile — Nhân bản</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.duplicateProfile.mutate({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Profile Assignments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.assignProfile — Gán profile cho target</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.assignProfile.mutate({
  profileId: 1,
  targetType: "MACHINE",
  targetId: 5
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.bulkAssignProfile — Gán hàng loạt</h4>
                    <CodeBlock code={`await trpc.mqttClientManagement.bulkAssignProfile.mutate({
  profileId: 1,
  targets: [
    { targetType: "MACHINE", targetId: 1 },
    { targetType: "MACHINE", targetId: 2 },
    { targetType: "LINE", targetId: 3 }
  ]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getAvailableTargets — DS targets Available</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getAvailableTargets.useQuery({ targetType: "MACHINE" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Connection Monitoring</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getConnectionStatus — Trạng thái kết nối</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getConnectionStatus.useQuery({
  targetType: "MACHINE",
  targetId: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getConnectionHealth — Sức khỏe kết nối</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getConnectionHealth.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getConnectionStatusSummary — Tổng hợp</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getConnectionStatusSummary.useQuery();`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Reconnect Analytics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getReconnectStats — Thống kê reconnect</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getReconnectStats.useQuery({ profileId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getReconnectHeatmap — Heatmap reconnect</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getReconnectHeatmap.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getReconnectTrend / getTopReconnectProfiles</h4>
                    <CodeBlock code={`const { data: trend } = trpc.mqttClientManagement.getReconnectTrend.useQuery({ days: 30 });
const { data: top } = trpc.mqttClientManagement.getTopReconnectProfiles.useQuery({ limit: 10 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Alerts</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttAlert.list / create — Cảnh báo MQTT</h4>
                    <CodeBlock code={`const { data } = trpc.mqttAlert.list.useQuery({ factoryCode: "FAC-001" });
await trpc.mqttAlert.create.mutate({
  name: "Machine Offline Alert",
  type: "offline",
  condition: "GREATER_THAN",
  threshold: 5,
  machineId: 1,
  actions: [{ type: "email", target: "admin@company.com" }]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttAlert.toggle / resolve — Bật/tắt & giải quyết</h4>
                    <CodeBlock code={`await trpc.mqttAlert.toggle.mutate({ id: 1, enabled: false });
await trpc.mqttAlert.resolve.mutate({ id: 5, resolution: "Fixed network issue" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttAlert.history / unresolved</h4>
                    <CodeBlock code={`const { data: history } = trpc.mqttAlert.history.useQuery({ alertId: 1, limit: 50 });
const { data: unresolved } = trpc.mqttAlert.unresolved.useQuery({ factoryCode: "FAC-001" });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Bulletin</CardTitle>
                  <CardDescription>Lập lịch gửi bulletin tự động qua MQTT cho từng station</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.listSettings / upsertSetting</h4>
                    <CodeBlock code={`const { data } = trpc.mqttBulletin.listSettings.useQuery({ enabledOnly: true });
await trpc.mqttBulletin.upsertSetting.mutate({
  stationId: 1,
  enabled: true,
  intervalMinutes: 60,
  scheduleType: "INTERVAL",
  startHour: 6,
  endHour: 22,
  includeImages: true,
  maxFailPoints: 10,
  sendToExternal: true,
  sendFcm: false
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.triggerNow — Gửi bulletin ngay lập tức</h4>
                    <CodeBlock code={`await trpc.mqttBulletin.triggerNow.mutate({ stationId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.quickSetup — Setup nhanh nhiều station</h4>
                    <CodeBlock code={`await trpc.mqttBulletin.quickSetup.mutate({
  stationIds: [1, 2, 3],
  intervalMinutes: 30,
  scheduleType: "INTERVAL"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.getHistory / getDashboardStats / getSchedulerStatus</h4>
                    <CodeBlock code={`const { data: history } = trpc.mqttBulletin.getHistory.useQuery({ stationId: 1, limit: 50 });
const { data: stats } = trpc.mqttBulletin.getDashboardStats.useQuery({ days: 7 });
const { data: scheduler } = trpc.mqttBulletin.getSchedulerStatus.useQuery();`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttBulletin.sendTestBulletin — Gửi test</h4>
                    <CodeBlock code={`await trpc.mqttBulletin.sendTestBulletin.mutate({
  stationId: 1,
  sendToExternal: true,
  sendFcm: false
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Import/Export & Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.exportProfiles / importProfiles</h4>
                    <CodeBlock code={`const { data: exported } = trpc.mqttClientManagement.exportProfiles.useQuery({ profileIds: [1, 2] });
await trpc.mqttClientManagement.importProfiles.mutate({ data: exported });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">mqttClientManagement.getDashboardStats — Dashboard MQTT</h4>
                    <CodeBlock code={`const { data } = trpc.mqttClientManagement.getDashboardStats.useQuery();`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* NG Rate Threshold */}
          {/* ============================================================ */}
          {activeMenu === "ngRateThreshold" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="h-5 w-5" />
                    NG Rate Threshold APIs
                  </CardTitle>
                  <CardDescription>
                    Cấu hình ngưỡng tỉ lệ NG theo điểm đo. Khi NG rate trong ngày vượt ngưỡng → tự động gửi MQTT alert.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Threshold CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.list — Danh sách ngưỡng (filter by station/machine)</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.list.useQuery({
  stationId: 1,      // optional
  machineId: 5,      // optional
  isEnabled: true,   // optional
});
// Returns: [{ id, stationId, stationName, machineId, machineName,
//   measurementPointId, pointCode, pointName, productModelId, productModelName,
//   name, description, warningThreshold, criticalThreshold,
//   minSampleSize, cooldownMinutes, sendMqttLocal, sendMqttExternal,
//   sendFcm, isEnabled, createdAt, updatedAt }]`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.getById — Chi tiết 1 ngưỡng</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.getById.useQuery({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.create — Tạo ngưỡng mới</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.create.mutate({
  stationId: 1,                       // required
  machineId: 5,                       // optional (null = tất cả máy)
  measurementPointId: 12,             // optional (null = tổng thể)
  productModelId: 3,                  // optional (null = tất cả model)
  name: "NG rate MP001 > 5%",         // required
  description: "Cảnh báo khi...",     // optional
  warningThreshold: 5.0,              // % NG rate → warning
  criticalThreshold: 10.0,            // % NG rate → critical
  minSampleSize: 10,                  // tránh false alarm khi ít mẫu
  cooldownMinutes: 30,                // chờ giữa 2 lần alert
  sendMqttLocal: true,                // gửi qua broker nội bộ
  sendMqttExternal: true,             // gửi qua broker bên ngoài
  sendFcm: true,                      // push notification
  isEnabled: true,
});
// Returns: { success: true, id: 1 }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.update — Cập nhật ngưỡng</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.update.mutate({
  id: 1,
  warningThreshold: 3.0,
  criticalThreshold: 8.0,
  cooldownMinutes: 15,
  isEnabled: true,
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.delete / toggle</h4>
                    <CodeBlock code={`// Xóa ngưỡng
await trpc.ngRateThreshold.delete.mutate({ id: 1 });

// Bật/tắt ngưỡng
await trpc.ngRateThreshold.toggle.mutate({ id: 1, isEnabled: false });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Alert History & Resolution</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.alertHistory — Lịch sử cảnh báo</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.alertHistory.useQuery({
  stationId: 1,          // optional
  thresholdId: 5,        // optional
  severity: "critical",  // optional: "warning" | "critical"
  isResolved: false,     // optional
  limit: 50,
  offset: 0,
});
// Returns: { data: [...alerts], total: 123 }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.resolveAlert — Đánh dấu đã xử lý</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.resolveAlert.mutate({
  id: 42,
  resolutionNote: "Đã điều chỉnh máy, NG rate giảm về bình thường",
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Realtime & Testing</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.currentNgRates — NG rate hiện tại (hôm nay)</h4>
                    <CodeBlock code={`const { data } = trpc.ngRateThreshold.currentNgRates.useQuery({ stationId: 1 });
// Returns: { stationId, stationName, totalInspections, ngCount, ngRate,
//   byPoint: [{ pointDefId, pointCode, pointName, total, ng, rate }] }`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">ngRateThreshold.testCheck — Test kiểm tra NG rate (Admin)</h4>
                    <CodeBlock code={`await trpc.ngRateThreshold.testCheck.mutate({
  stationId: 1,
  machineId: 5,
  inspectionId: 0,        // default 0
  productModelId: 3,       // optional
});
// Triggers NG rate check manually for debugging`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT NG Rate Alert Payload</CardTitle>
                  <CardDescription>Bản tin tự động gửi khi NG rate vượt ngưỡng</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Topic</h4>
                    <CodeBlock code={`avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/ng-rate-alert`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Payload</h4>
                    <CodeBlock code={`{
  "type": "NG_RATE_ALERT",
  "severity": "warning",          // "warning" | "critical"
  "thresholdId": 1,
  "thresholdName": "NG rate MP001 > 5%",
  "stationId": 1,
  "stationName": "Station AOI-01",
  "machineId": 5,
  "machineName": "AOI Machine #5",
  "measurementPointId": 12,       // null nếu check tổng thể
  "pointCode": "MP001",           // null nếu check tổng thể
  "pointName": "Solder Joint 1",
  "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png",  // ảnh mẫu (nếu có)
  "productModelId": 3,            // null nếu tất cả model
  "currentNgRate": 7.5,
  "threshold": 5.0,
  "totalInspections": 200,
  "ngCount": 15,
  "message": "NG rate 7.50% vượt ngưỡng cảnh báo 5.00% ...",
  "timestamp": "2025-01-15T10:30:00Z"
}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Subscribe</h4>
                    <CodeBlock code={`// Nhận NG rate alert cho 1 station cụ thể:
avi/factory/1/workshop/2/station/3/ng-rate-alert

// Nhận NG rate alert cho tất cả station trong 1 workshop:
avi/factory/1/workshop/2/station/+/ng-rate-alert

// Nhận NG rate alert toàn bộ nhà máy:
avi/factory/1/workshop/+/station/+/ng-rate-alert`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Inspection Images On-Demand */}
          {/* ============================================================ */}
          {activeMenu === "inspectionImages" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Inspection Images API
                  </CardTitle>
                  <CardDescription>
                    REST API lấy ảnh kiểm tra on-demand. Thay vì gửi ảnh trực tiếp qua MQTT (quá nặng),
                    client nhận inspectionId rồi gọi API này khi cần xem ảnh.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">GET /api/inspection/:id/images</CardTitle>
                  <CardDescription>Lấy danh sách ảnh của 1 lần kiểm tra theo inspectionId</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`GET /api/inspection/1234/images

// Không cần authentication header
// inspectionId lấy từ MQTT payload (ngAlert hoặc bulletin)`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response (200 OK)</h4>
                    <CodeBlock code={`{
  "success": true,
  "inspectionId": 1234,
  "serialNumber": "SN-2025-001",
  "overallResult": "NG",
  "inspectionTime": "2025-01-15T10:30:00Z",
  "totalPoints": 12,
  "pointsWithImages": [
    {
      "pointDefId": 5,
      "pointCode": "MP001",
      "pointName": "Solder Joint 1",
      "result": "NG",
      "measuredValue": "0.85",
      "imageUrl": "/uploads/inspections/1234/MP001-abc123.jpg",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png"
    },
    {
      "pointDefId": 8,
      "pointCode": "MP004",
      "pointName": "Component Alignment",
      "result": "NG",
      "measuredValue": "1.20",
      "imageUrl": "/uploads/inspections/1234/MP004-def456.jpg",
      "referenceImageUrl": null
    }
  ]
}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Error Responses</h4>
                    <CodeBlock code={`// 400 - Invalid ID
{ "success": false, "message": "Invalid inspection ID" }

// 404 - Not found
{ "success": false, "message": "Inspection not found" }

// 500 - Server error
{ "success": false, "message": "Failed to get images" }`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT NG Alert Payload (Updated)</CardTitle>
                  <CardDescription>
                    Bản tin NG alert đã tối ưu — không gửi ảnh trực tiếp, chỉ gửi URL + inspectionId
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Topic</h4>
                    <CodeBlock code={`avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Payload</h4>
                    <CodeBlock code={`{
  "type": "ngAlert",
  "inspectionId": 1234,
  "serialNumber": "SN-2025-001",
  "productModel": "Model-A",
  "machineName": "AOI Machine #5",
  "stationName": "Station AOI-01",
  "timestamp": "2025-01-15T10:30:00Z",
  "overallResult": "NG",
  "totalPoints": 12,
  "ngPoints": [
    {
      "code": "MP001",
      "name": "Solder Joint 1",
      "result": "NG",
      "measuredValue": "0.85",
      "imageUrl": "/uploads/inspections/1234/MP001-abc123.jpg",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png"
    }
  ],
  "summary": "NG: 2/12 points failed"
}

// ⚠ imageUrl là đường dẫn tương đối trên server
// Client xem ảnh: GET {serverUrl}{imageUrl}
// Hoặc dùng API: GET {serverUrl}/api/inspection/1234/images`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">MQTT Bulletin Payload (Updated)</CardTitle>
                  <CardDescription>
                    Bulletin định kỳ — imageUrl bây giờ là URL thật thay vì base64 bị cắt
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Topic</h4>
                    <CodeBlock code={`avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/bulletin/periodic`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Payload (trích)</h4>
                    <CodeBlock code={`{
  "type": "periodic_bulletin",
  "stationId": 1,
  "stationName": "Station AOI-01",
  "period": { "from": "...", "to": "..." },
  "summary": {
    "totalInspections": 150,
    "passCount": 140,
    "ngCount": 10,
    "passRate": "93.33%"
  },
  "topFailPoints": [
    {
      "code": "MP001",
      "name": "Solder Joint 1",
      "ngCount": 5,
      "ngRate": "3.33%",
      "latestImageUrl": "/uploads/inspections/1234/MP001-abc123.jpg",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png"
    }
  ]
}

// ✅ latestImageUrl giờ là URL thật → client có thể tải ảnh khi cần
// Trước đây: "data:image/jpeg;base64,/9j/4AAQ..." (bị cắt 100 ký tự)`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Subscribe Topics Reference</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Tổng hợp MQTT Topics</h4>
                    <CodeBlock code={`// 1. NG Alert (lỗi từng lần kiểm tra)
avi/factory/{fId}/workshop/{wId}/station/{sId}/errors

// 2. NG Rate Threshold Alert (tỉ lệ NG vượt ngưỡng)
avi/factory/{fId}/workshop/{wId}/station/{sId}/ng-rate-alert

// 3. Bulletin (báo cáo định kỳ)
avi/factory/{fId}/workshop/{wId}/station/{sId}/bulletin/periodic

// Wildcards:
// + = 1 level    → station/+/errors   (tất cả station)
// # = multi level → avi/factory/1/#   (mọi topic của factory 1)`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Flow: On-Demand Image Loading</h4>
                    <CodeBlock code={`// 1. Machine gửi kết quả kiểm tra (có ảnh base64)
POST /api/trpc/machineApi.submitInspection
→ Server tự upload ảnh → lưu URL vào DB

// 2. Server gửi MQTT alert (chỉ gửi URL, không gửi ảnh)
Topic: .../errors
Payload: { inspectionId: 1234, ngPoints: [{ imageUrl: "..." }] }

// 3. Android app nhận alert, hiển thị thông tin cơ bản

// 4. User tap "Xem ảnh" → App gọi REST API
GET /api/inspection/1234/images
→ Trả về danh sách ảnh có URL đầy đủ

// 5. App hiển thị ảnh từ URL
Image source: {serverUrl}/uploads/inspections/1234/MP001-abc123.jpg

// 6. So sánh với ảnh mẫu (Reference Image Comparison)
// referenceImageUrl có trong cả 3 loại payload MQTT
// Android app hiển thị side-by-side: ảnh mẫu (trái) vs ảnh thực tế (phải)
// Fullscreen mode: toggle swap giữa ảnh mẫu ↔ ảnh thực tế`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">GET /api/measurement-point/:id/reference-image</CardTitle>
                  <CardDescription>
                    Lấy ảnh mẫu (reference image) của 1 điểm đo cụ thể, bao gồm vị trí crop trên ảnh product model
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`GET /api/measurement-point/5/reference-image`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response (200 OK)</h4>
                    <CodeBlock code={`{
  "success": true,
  "pointId": 5,
  "pointCode": "MP001",
  "pointName": "Solder Joint 1",
  "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png",
  "position": {
    "x": 150,
    "y": 200,
    "radius": 20,
    "cropWidth": 100,
    "cropHeight": 100
  },
  "productModel": {
    "id": 3,
    "name": "PCBA-REV3",
    "referenceImageUrl": "/uploads/ref/PCBA-REV3/full-board.png"
  }
}`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Error Responses</h4>
                    <CodeBlock code={`// 404 - Point not found or no reference image
{ "success": false, "message": "Measurement point not found" }
{ "success": false, "message": "No reference image for this point" }`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">GET /api/product-model/:id/reference-images</CardTitle>
                  <CardDescription>
                    Lấy tất cả ảnh mẫu (reference images) của các điểm đo trong 1 product model
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">Request</h4>
                    <CodeBlock code={`GET /api/product-model/3/reference-images`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Response (200 OK)</h4>
                    <CodeBlock code={`{
  "success": true,
  "productModelId": 3,
  "productModelName": "PCBA-REV3",
  "productReferenceImage": "/uploads/ref/PCBA-REV3/full-board.png",
  "totalPoints": 12,
  "pointsWithRefImage": 8,
  "points": [
    {
      "id": 5,
      "code": "MP001",
      "name": "Solder Joint 1",
      "referenceImageUrl": "/uploads/measurement-points/3/MP001-crop-abc123.png",
      "position": { "x": 150, "y": 200, "radius": 20 }
    },
    {
      "id": 8,
      "code": "MP004",
      "name": "Component Alignment",
      "referenceImageUrl": null,
      "position": { "x": 300, "y": 100, "radius": 25 }
    }
  ]
}`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Annotations & AI */}
          {/* ============================================================ */}
          {activeMenu === "annotationAI" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Pencil className="h-5 w-5" />
                    Annotations & AI APIs
                  </CardTitle>
                  <CardDescription>
                    Ghi chú/đánh dấu trên ảnh inspection, AI analysis, template annotation, so sánh, và AI feedback/training.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation CRUD</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.save — Lưu annotations lên ảnh</h4>
                    <CodeBlock code={`await trpc.annotation.save.mutate({
  imageUrl: "/uploads/inspection/img001.jpg",
  inspectionId: 100,
  annotations: [
    { type: "rect", x: 100, y: 50, width: 30, height: 20, label: "Solder defect", color: "#ff0000" },
    { type: "circle", cx: 200, cy: 100, radius: 15, label: "Missing component", color: "#ff8800" }
  ],
  metadata: { reviewer: "QC-01", notes: "Need rework" }
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.getByImage / getByInspection</h4>
                    <CodeBlock code={`const { data } = trpc.annotation.getByImage.useQuery({ imageUrl: "/uploads/inspection/img001.jpg" });
const { data: byInspection } = trpc.annotation.getByInspection.useQuery({ inspectionId: 100 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.search — Tìm kiếm annotation</h4>
                    <CodeBlock code={`const { data } = trpc.annotation.search.useQuery({
  type: "rect",
  label: "solder",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  page: 1,
  limit: 20
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.statistics — Thống kê annotation</h4>
                    <CodeBlock code={`const { data } = trpc.annotation.statistics.useQuery({ startDate: "2025-01-01", endDate: "2025-01-31" });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.analyzeImage — AI phân tích ảnh</h4>
                    <CodeBlock code={`const result = await trpc.annotation.analyzeImage.mutate({ imageUrl: "/uploads/inspection/img001.jpg" });
// AI suggest annotations tự động`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.copyAnnotations — Copy annotations giữa ảnh</h4>
                    <CodeBlock code={`await trpc.annotation.copyAnnotations.mutate({
  sourceImageUrl: "/uploads/inspection/img001.jpg",
  targetImageUrl: "/uploads/inspection/img002.jpg"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.export / import — Xuất/nhập annotations</h4>
                    <CodeBlock code={`await trpc.annotation.export.mutate({ inspectionId: 100, format: "json" });
await trpc.annotation.import.mutate({ data: importedAnnotations });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation Templates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotationTemplate.list / create / delete</h4>
                    <CodeBlock code={`const { data } = trpc.annotationTemplate.list.useQuery();
await trpc.annotationTemplate.create.mutate({
  name: "Common PCB Defects",
  annotations: [
    { type: "rect", label: "Solder bridge", color: "#ff0000" },
    { type: "circle", label: "Missing component", color: "#ff8800" }
  ]
});
await trpc.annotationTemplate.delete.mutate({ id: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotation.bulkApplyTemplate — Áp dụng template hàng loạt</h4>
                    <CodeBlock code={`await trpc.annotation.bulkApplyTemplate.mutate({
  templateId: 1,
  imageUrls: ["/uploads/img001.jpg", "/uploads/img002.jpg", "/uploads/img003.jpg"]
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation History & Root Cause</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotationHistory.list — Lịch sử chỉnh sửa</h4>
                    <CodeBlock code={`const { data } = trpc.annotationHistory.list.useQuery({ annotationId: 1, limit: 20 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationHistory.compare — So sánh 2 phiên bản</h4>
                    <CodeBlock code={`const { data } = trpc.annotationHistory.compare.useQuery({ historyId1: 1, historyId2: 5 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationHistory.rollback — Rollback về phiên bản cũ</h4>
                    <CodeBlock code={`await trpc.annotationHistory.rollback.mutate({ historyId: 3 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">rootCause.analyze — Phân tích nguyên nhân gốc</h4>
                    <CodeBlock code={`const result = await trpc.rootCause.analyze.mutate({
  measurementPointId: 1,
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">rootCause.list / get</h4>
                    <CodeBlock code={`const { data } = trpc.rootCause.list.useQuery({ measurementPointId: 1, status: "OPEN" });
const { data: detail } = trpc.rootCause.get.useQuery({ id: 1 });`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">
                    <div className="flex items-center gap-2">
                      <Brain className="h-5 w-5" />
                      AI Feedback & Training
                    </div>
                  </CardTitle>
                  <CardDescription>Thu thập feedback từ người dùng để cải thiện model AI</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.createSuggestion — AI đề xuất</h4>
                    <CodeBlock code={`await trpc.aiFeedback.createSuggestion.mutate({
  inspectionId: 100,
  measurementResultId: 50,
  suggestionType: "DEFECT_CLASSIFICATION",
  suggestion: "Solder bridge detected",
  confidence: 0.92,
  reasoning: "Pattern matches known solder bridge defect",
  modelVersion: "v2.1",
  modelName: "defect-classifier"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.submitFeedback — Phản hồi từ QC</h4>
                    <CodeBlock code={`await trpc.aiFeedback.submitFeedback.mutate({
  suggestionId: 1,
  feedbackType: "CORRECT", // CORRECT | INCORRECT | PARTIAL | UNSURE
  accuracy: 95,
  correctedValue: null,
  correctionNotes: "Đúng, là solder bridge"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.getModelMetrics — Metrics model AI</h4>
                    <CodeBlock code={`const { data } = trpc.aiFeedback.getModelMetrics.useQuery({
  modelName: "defect-classifier",
  modelVersion: "v2.1",
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.createTrainingBatch — Tạo batch training data</h4>
                    <CodeBlock code={`await trpc.aiFeedback.createTrainingBatch.mutate({
  name: "Training Batch Q1-2025",
  description: "Data from January feedback",
  feedbackType: "CORRECT",
  exportFormat: "JSONL",
  targetModelName: "defect-classifier",
  targetModelVersion: "v3.0"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.exportTrainingBatch — Xuất training data</h4>
                    <CodeBlock code={`await trpc.aiFeedback.exportTrainingBatch.mutate({ batchId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">aiFeedback.getDashboardStats — Dashboard AI</h4>
                    <CodeBlock code={`const { data } = trpc.aiFeedback.getDashboardStats.useQuery();`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Training Batch Comments & Tags</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">trainingBatchComments.addComment — Thêm comment</h4>
                    <CodeBlock code={`await trpc.trainingBatchComments.addComment.mutate({
  batchId: 1,
  content: "This batch needs more negative samples",
  parentId: null // reply to another comment
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">trainingBatchComments.listComments</h4>
                    <CodeBlock code={`const { data } = trpc.trainingBatchComments.listComments.useQuery({ batchId: 1, limit: 50 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">trainingBatchComments.createTag / assignTag / getBatchTags</h4>
                    <CodeBlock code={`// Create tag
await trpc.trainingBatchComments.createTag.mutate({
  name: "high-priority",
  color: "#ef4444",
  description: "Ưu tiên xử lý trước"
});
// Assign tag to batch
await trpc.trainingBatchComments.assignTag.mutate({ batchId: 1, tagId: 3 });
// Get batch tags
const { data } = trpc.trainingBatchComments.getBatchTags.useQuery({ batchId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">Predictive Alerts</h4>
                    <CodeBlock code={`// List predictive alerts
const { data } = trpc.predictiveAlert.list.useQuery({
  machineId: 1,
  status: "ACTIVE",
  severity: "HIGH",
  page: 1,
  limit: 20
});
// Generate predictions for machine
await trpc.predictiveAlert.generatePredictions.mutate({ machineId: 1 });
// Acknowledge / Resolve / Dismiss
await trpc.predictiveAlert.acknowledge.mutate({ id: 1 });
await trpc.predictiveAlert.resolve.mutate({ id: 1, resolution: "Replaced worn component" });
await trpc.predictiveAlert.dismiss.mutate({ id: 1, reason: "False positive" });
// Stats
const { data: stats } = trpc.predictiveAlert.stats.useQuery({ machineId: 1 });`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* SPC & Heatmap */}
          {/* ============================================================ */}
          {activeMenu === "spcHeatmap" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    SPC Analysis & Defect Heatmap APIs
                  </CardTitle>
                  <CardDescription>
                    Statistical Process Control (SPC), phát hiện bất thường, heatmap lỗi, so sánh inspection, và phân tích xu hướng.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">SPC Analysis</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.topNGPoints — Top điểm NG</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.topNGPoints.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1,
  factoryCode: "FAC-001",
  productModelId: 5,
  limit: 10
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.yieldTrend — Xu hướng yield</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.yieldTrend.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1,
  interval: "day", // hour | day | week | month
  predictDays: 7
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.detectAnomalies — Phát hiện bất thường</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.detectAnomalies.useQuery({
  machineId: 1,
  factoryCode: "FAC-001",
  days: 30,
  zScoreThreshold: 2
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.rootCauseSuggestions — Gợi ý nguyên nhân</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.rootCauseSuggestions.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">spcAnalysis.workstationAnalysis / ngByWorkstation</h4>
                    <CodeBlock code={`const { data } = trpc.spcAnalysis.workstationAnalysis.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  machineId: 1
});
const { data: ngByWS } = trpc.spcAnalysis.ngByWorkstation.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  limit: 20
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Defect Heatmap</CardTitle>
                  <CardDescription>Bản đồ nhiệt phân bố lỗi trên board/panel</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.generate — Tạo heatmap</h4>
                    <CodeBlock code={`await trpc.defectHeatmap.generate.mutate({
  machineId: 1,
  productModelId: 5,
  periodType: "DAILY", // HOURLY | DAILY | WEEKLY | MONTHLY
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  gridWidth: 100,
  gridHeight: 100
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.list / getLatest</h4>
                    <CodeBlock code={`const { data } = trpc.defectHeatmap.list.useQuery({
  machineId: 1,
  productModelId: 5,
  periodType: "DAILY",
  limit: 10
});
const { data: latest } = trpc.defectHeatmap.getLatest.useQuery({
  machineId: 1,
  periodType: "DAILY"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.getMachineOverlay — Overlay lên layout máy</h4>
                    <CodeBlock code={`const { data } = trpc.defectHeatmap.getMachineOverlay.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">defectHeatmap.getRealTimeHotspots — Hotspot real-time</h4>
                    <CodeBlock code={`const { data } = trpc.defectHeatmap.getRealTimeHotspots.useQuery({
  machineId: 1,
  hours: 1 // 1-24 hours
});`} />
                  </div>
                </CardContent>
              </Card>

              <Card className={glassCard}>
                <CardHeader>
                  <CardTitle className="text-white">Annotation Comparison</CardTitle>
                  <CardDescription>So sánh annotations giữa các lần inspection</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.createSession — Tạo phiên so sánh</h4>
                    <CodeBlock code={`await trpc.annotationComparison.createSession.mutate({
  name: "Weekly Review W4",
  description: "So sánh inspection tuần 4",
  productModelId: 5,
  machineId: 1,
  inspectionIds: [100, 101, 102, 103]
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.compareTwo — So sánh 2 inspection</h4>
                    <CodeBlock code={`const { data } = trpc.annotationComparison.compareTwo.useQuery({
  inspectionId1: 100,
  inspectionId2: 101
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.detectPatterns — Phát hiện patterns</h4>
                    <CodeBlock code={`await trpc.annotationComparison.detectPatterns.mutate({ sessionId: 1 });`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.generatePdfReport — Xuất báo cáo PDF</h4>
                    <CodeBlock code={`await trpc.annotationComparison.generatePdfReport.mutate({
  inspectionId1: 100,
  inspectionId2: 101,
  includeImages: true,
  includePatterns: true
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">annotationComparison.getTrendData — Xu hướng</h4>
                    <CodeBlock code={`const { data } = trpc.annotationComparison.getTrendData.useQuery({
  machineId: 1,
  productModelId: 5,
  dateFrom: "2025-01-01",
  dateTo: "2025-01-31",
  groupBy: "day" // day | week | month
});`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ============================================================ */}
          {/* Audit Logs */}
          {/* ============================================================ */}
          {activeMenu === "audit" && (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ScrollText className="h-5 w-5" />
                    Audit Log APIs
                  </CardTitle>
                  <CardDescription>
                    Theo dõi lịch sử thao tác của người dùng trong hệ thống.
                  </CardDescription>
                </CardHeader>
              </Card>

              <Card className={glassCard}>
                <CardContent className="space-y-4 pt-6">
                  <div>
                    <h4 className="mb-2 font-semibold">audit.list — Danh sách audit logs</h4>
                    <CodeBlock code={`const { data } = trpc.audit.list.useQuery({
  userId: 5,
  action: "CREATE",
  resourceType: "inspection",
  startDate: "2025-01-01",
  endDate: "2025-01-31",
  page: 1,
  limit: 50
});`} />
                  </div>
                  <div>
                    <h4 className="mb-2 font-semibold">audit.stats — Thống kê audit</h4>
                    <CodeBlock code={`const { data } = trpc.audit.stats.useQuery({
  startDate: "2025-01-01",
  endDate: "2025-01-31"
});
// { totalActions, byUser, byAction, byResource, dailyBreakdown }`} />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          {/* ============================================================ */}
          {/* Hierarchy Tree & MQTT Subscription */}
          {/* ============================================================ */}
          {activeMenu === "hierarchyTree" && <HierarchyTreeSection endpointBase={endpointBase} baseUrl={baseUrl} />}

        </div>
      </div>
    </>
  );
}

export default function ApiDocs() {
  return (
    <DashboardLayout>
      <ApiDocsContent />
    </DashboardLayout>
  );
}
