import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
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
  GitCompareArrows,
  MonitorCheck,
  Sparkles,
  Database,
  Settings,
  Cpu,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Zap,
  Wifi,
} from "lucide-react";

const aiFeatures = [
  // Analysis
  { key: "timeSeries", icon: TrendingUp, href: "/ai-time-series", color: "text-cyan-500", bg: "bg-cyan-500/10", category: "analysis" },
  { key: "inspectionAnalytics", icon: Sparkles, href: "/ai-inspection-analytics", color: "text-cyan-600", bg: "bg-cyan-600/10", category: "analysis" },
  { key: "performance", icon: Activity, href: "/ai-performance", color: "text-red-500", bg: "bg-red-500/10", category: "analysis" },
  { key: "reports", icon: FileText, href: "/ai-reports", color: "text-yellow-500", bg: "bg-yellow-500/10", category: "analysis" },
  // Inspection AI
  { key: "chat", icon: MessageSquare, href: "/ai-chat", color: "text-blue-500", bg: "bg-blue-500/10", category: "inspection" },
  { key: "qualityGate", icon: ShieldCheck, href: "/ai-quality-gate", color: "text-green-500", bg: "bg-green-500/10", category: "inspection" },
  { key: "activeLearning", icon: GraduationCap, href: "/ai-active-learning", color: "text-purple-500", bg: "bg-purple-500/10", category: "inspection" },
  { key: "imageSearch", icon: Search, href: "/ai-image-search", color: "text-orange-500", bg: "bg-orange-500/10", category: "inspection" },
  // Models
  { key: "ggufModels", icon: Brain, href: "/ai-gguf-models", color: "text-amber-500", bg: "bg-amber-500/10", category: "models" },
  { key: "modelManagement", icon: Cpu, href: "/ai-models", color: "text-violet-500", bg: "bg-violet-500/10", category: "models" },
  { key: "batchInference", icon: Layers, href: "/ai-batch-jobs", color: "text-indigo-500", bg: "bg-indigo-500/10", category: "models" },
  { key: "abTesting", icon: GitCompareArrows, href: "/ai-ab-testing", color: "text-pink-500", bg: "bg-pink-500/10", category: "models" },
  // System
  { key: "monitoring", icon: MonitorCheck, href: "/ai-monitoring", color: "text-emerald-500", bg: "bg-emerald-500/10", category: "system" },
  { key: "dataProcessing", icon: Database, href: "/ai-data-processing", color: "text-teal-500", bg: "bg-teal-500/10", category: "system" },
  { key: "settings", icon: Settings, href: "/ai-settings", color: "text-slate-500", bg: "bg-slate-500/10", category: "system" },
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
  const providerLabel = ps?.activeProvider === "openai" ? "OpenAI" : ps?.activeProvider === "gguf" ? "GGUF Local" : "Offline";
  const providerColor = ps?.activeProvider === "openai" ? "text-green-500" : ps?.activeProvider === "gguf" ? "text-amber-500" : "text-slate-400";
  const providerBg = ps?.activeProvider === "openai" ? "bg-green-500/10" : ps?.activeProvider === "gguf" ? "bg-amber-500/10" : "bg-slate-500/10";

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("aiHub.title", "AI Hub")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("aiHub.subtitle", "Trung tâm quản lý các tính năng AI - Tất cả công cụ AI trong một nơi")}
            </p>
          </div>
          <Badge variant="secondary" className="ml-auto">
            <Sparkles className="h-3 w-3 mr-1" />
            {t("aiHub.featureCount", "{{count}} tính năng", { count: aiFeatures.length })}
          </Badge>
        </div>

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
              <div className="flex items-center gap-1.5">
                {ps?.openai.available
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <XCircle className="h-4 w-4 text-slate-300" />}
                <span className={ps?.openai.available ? "text-green-600" : "text-muted-foreground"}>
                  OpenAI {ps?.openai.available && ps.openai.model ? `(${ps.openai.model})` : ""}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {ps?.gguf.available
                  ? <CheckCircle2 className="h-4 w-4 text-amber-500" />
                  : <AlertCircle className="h-4 w-4 text-slate-300" />}
                <span className={ps?.gguf.available ? "text-amber-600" : "text-muted-foreground"}>
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
                {features.map(feature => {
                  const Icon = feature.icon;
                  return (
                    <Card
                      key={feature.key}
                      className="group cursor-pointer hover:shadow-md transition-all hover:border-primary/30"
                      onClick={() => setLocation(feature.href)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-lg ${feature.bg} flex items-center justify-center`}>
                            <Icon className={`h-5 w-5 ${feature.color}`} />
                          </div>
                          <CardTitle className="text-sm font-semibold group-hover:text-primary transition-colors">
                            {t(`aiHub.features.${feature.key}.title`, feature.key)}
                          </CardTitle>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <CardDescription className="text-xs line-clamp-2">
                          {t(`aiHub.features.${feature.key}.desc`, "")}
                        </CardDescription>
                      </CardContent>
                    </Card>
                  );
                })}
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
      </div>
    </DashboardLayout>
  );
}
