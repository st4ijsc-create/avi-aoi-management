import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { PageHeader, PageContainer, ToolTile } from "@/components/patterns";
import {
  Brain,
  MessageSquare,
  ShieldCheck,
  Search,
  GraduationCap,
  TrendingUp,
  FileText,
  Activity,
  Layers,
  MonitorCheck,
  Sparkles,
  Database,
  Settings,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Zap,
  Wifi,
  Book,
  FlaskConical,
  Gauge,
  Lightbulb,
  Wrench,
} from "lucide-react";

const aiFeatures = [
  // Analysis
  { key: "timeSeries", icon: TrendingUp, href: "/ai-time-series", category: "analysis" },
  { key: "inspectionAnalytics", icon: Sparkles, href: "/ai-inspection-analytics", category: "analysis" },
  { key: "performance", icon: Activity, href: "/ai-performance", category: "analysis" },
  { key: "reports", icon: FileText, href: "/ai-reports", category: "analysis" },
  { key: "managementInsight", icon: Lightbulb, href: "/management-insight", category: "analysis" },
  { key: "technicianCopilot", icon: Wrench, href: "/technician-copilot", category: "analysis" },
  // Inspection AI
  { key: "chat", icon: MessageSquare, href: "/ai-chat", category: "inspection" },
  { key: "qualityGate", icon: ShieldCheck, href: "/ai-quality-gate", category: "inspection" },
  { key: "activeLearning", icon: GraduationCap, href: "/ai-active-learning", category: "inspection" },
  { key: "imageSearch", icon: Search, href: "/ai-image-search", category: "inspection" },
  { key: "advancedVisionLab", icon: FlaskConical, href: "/ai-advanced-vision-lab", category: "inspection" },
  { key: "localKb", icon: Book, href: "/ai-local-kb", category: "inspection" },
  // Models
  { key: "ggufModels", icon: Brain, href: "/ai-gguf-models", category: "models" },
  { key: "modelManagement", icon: Cpu, href: "/ai-models", category: "models" },
  { key: "batchInference", icon: Layers, href: "/ai-batch-jobs", category: "models" },
  // X3: "abTesting" tile removed — live A/B canary is a tab in the Performance dashboard (/ai-performance).
  // System
  { key: "aiBrain", icon: Gauge, href: "/ai-brain", category: "system" },
  { key: "monitoring", icon: MonitorCheck, href: "/ai-monitoring", category: "system" },
  { key: "dataProcessing", icon: Database, href: "/ai-data-processing", category: "system" },
  { key: "settings", icon: Settings, href: "/ai-settings", category: "system" },
];

const CATEGORIES = [
  { key: "analysis", labelKey: "aiHub.cat.analysis", labelDefault: "Phân tích" },
  { key: "inspection", labelKey: "aiHub.cat.inspection", labelDefault: "Kiểm tra AI" },
  { key: "models", labelKey: "aiHub.cat.models", labelDefault: "Mô hình" },
  { key: "system", labelKey: "aiHub.cat.system", labelDefault: "Hệ thống" },
];

export default function AIHub() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const providerStatus = trpc.aiGguf.providerStatus.useQuery(undefined, { refetchInterval: 30_000 });

  const ps = providerStatus.data;
  // X2 cleanup: system is 100% local — provider is GGUF or Offline.
  const providerAvailable = ps?.activeProvider === "gguf";
  const providerLabel = providerAvailable ? "GGUF Local" : "Offline";
  const providerColor = providerAvailable ? "text-warning" : "text-muted-foreground";
  const providerBg = providerAvailable ? "bg-warning/10" : "bg-muted";

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Brain className="h-6 w-6 text-primary" />}
          title={t("aiHub.title", "AI Hub")}
          description={t("aiHub.subtitle", "Trung tâm quản lý các tính năng AI - Tất cả công cụ AI trong một nơi")}
          actions={
            <Badge variant="secondary">
              <Sparkles className="h-3 w-3 mr-1" />
              {t("aiHub.featureCount", "{{count}} tính năng", { count: aiFeatures.length })}
            </Badge>
          }
        />

        {/* Live Provider Status Panel */}
        <Card className="border-primary/20">
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 font-medium">
                <Zap className="h-4 w-4 text-primary" />
                {t("aiHub.status.label", "Nhà cung cấp AI:")}
              </div>
              <Badge className={`${providerBg} ${providerColor} border-0`}>
                <Wifi className="h-3 w-3 mr-1" />
                {providerLabel}
              </Badge>
              {/* X2 cleanup: OpenAI status row removed — system is 100% local (GGUF > offline). */}
              <div className="flex items-center gap-1.5">
                {ps?.gguf.available
                  ? <CheckCircle2 className="h-4 w-4 text-warning" />
                  : <AlertCircle className="h-4 w-4 text-muted-foreground" />}
                <span className={ps?.gguf.available ? "text-warning" : "text-muted-foreground"}>
                  GGUF {ps?.gguf.available ? (ps.gguf.modelName ?? "") : t("aiHub.status.noModel", "Chưa tải model")}
                  {ps?.gguf.gpuEnabled && <Badge variant="outline" className="ml-1 text-[10px] py-0 h-4">GPU</Badge>}
                </span>
              </div>
              {providerStatus.isLoading && (
                <span className="text-xs text-muted-foreground">{t("common.loading", "Đang tải...")}</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Feature Grid — grouped by category */}
        {CATEGORIES.map(cat => {
          const features = aiFeatures.filter(f => f.category === cat.key);
          return (
            <div key={cat.key}>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {t(cat.labelKey, cat.labelDefault)}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {features.map(feature => (
                  <ToolTile
                    key={feature.key}
                    icon={feature.icon}
                    href={feature.href}
                    label={t(`aiHub.features.${feature.key}.title`, feature.key)}
                    blurb={t(`aiHub.features.${feature.key}.desc`, "")}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {t("aiHub.quickActions", "Hành động nhanh")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setLocation("/ai-chat")}>
              <MessageSquare className="h-4 w-4 mr-1.5" />
              {t("aiHub.startChat", "Bắt đầu hội thoại AI")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/ai-reports")}>
              <FileText className="h-4 w-4 mr-1.5" />
              {t("aiHub.genReport", "Tạo báo cáo AI")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/ai-quality-gate")}>
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              {t("aiHub.manageQG", "Quản lý Quality Gate")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/ai-active-learning")}>
              <GraduationCap className="h-4 w-4 mr-1.5" />
              {t("aiHub.reviewQueue", "Hàng đợi đánh giá")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/ai-data-processing")}>
              <Database className="h-4 w-4 mr-1.5" />
              {t("aiHub.processData", "Xử lý dữ liệu")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLocation("/ai-settings")}>
              <Settings className="h-4 w-4 mr-1.5" />
              {t("aiHub.manageSettings", "Cài đặt AI")}
            </Button>
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
