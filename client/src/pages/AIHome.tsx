/**
 * doc 69 Wave E1 (T6) — AI Home: single merged landing for the AI module.
 *
 * Replaces the two separate hub walls that duplicated the left-nav "ai" group's
 * ~20 pages a 3rd time (AIHub's read-open 20-tile wall + AIStudioHub's admin-only
 * 20-tool launcher — see doc 69 B1.1). AI Home presents the SAME single taxonomy
 * as the rail (nav.tsx "ai" group) as launch tiles via the shared HubLauncher
 * primitive (per-tile RBAC — a tile is hidden when the viewer lacks its
 * `requiredPermission`/`requiredRole`, admin sees all), plus a quick "open
 * Assistant chat" entry and a live local-AI provider status strip carried over
 * from AIHub.
 *
 * The route itself is READ-OPEN (no RouteGuard) — same as the old /ai-hub — so
 * every role can reach the Assistant quick-chat entry; the deeper admin/engineer
 * tiles self-hide via HubLauncher's per-tool gate exactly like the old
 * AIStudioHub did behind its (now-removed) whole-route admin gate. This mirrors
 * the rail's own per-item RBAC 1:1, so nothing is exposed here that the sidebar
 * wouldn't also show that role.
 *
 * "Agent activity" (doc69 Wave 0-C) is now a LIVE compact summary — roster/working
 * agent counts + this-month token savings — sourced from the SAME
 * trpc.aiAgentCenter.getReadModel/getSavingsSummary the Command Center page (Wave
 * E2) already renders, behind the SAME admin/engineer ops-role gate, with a link
 * into /ai-command-center for the full board.
 */
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, PageContainer } from "@/components/patterns";
import { HubLauncher, type HubCategory } from "@/components/workspace";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { fmtUsd } from "@/lib/format";
import {
  Sparkles,
  MessageSquare,
  Inbox,
  Lightbulb,
  Brain,
  MonitorCheck,
  GraduationCap,
  Layers,
  Database,
  TrendingUp,
  Activity,
  FileBarChart,
  ShieldCheck,
  Search,
  FlaskConical,
  Boxes,
  Brush,
  Workflow,
  Cpu,
  GitBranch,
  FileStack,
  HeartPulse,
  Cog,
  Wifi,
  CheckCircle2,
  AlertCircle,
  Zap,
  ArrowRight,
  Bot,
  Users,
  PiggyBank,
} from "lucide-react";

export default function AIHome() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const providerStatus = trpc.aiGguf.providerStatus.useQuery(undefined, { refetchInterval: 30_000 });

  // doc69 Wave 0-C — agent-activity card goes live. SAME ops-role gate as
  // AIAgentCommandCenter.tsx (the backend's opsAgentCenterProcedure restricts both
  // queries to admin/engineer) — a non-ops viewer must never see a spinner/crash
  // here, mirroring that page's own guard.
  const isOpsRole = user?.role === "admin" || user?.role === "engineer";
  const agentReadModel = trpc.aiAgentCenter.getReadModel.useQuery({ limit: 50 }, { enabled: isOpsRole });
  const agentSavings = trpc.aiAgentCenter.getSavingsSummary.useQuery(undefined, { enabled: isOpsRole });
  const agentRoster = agentReadModel.data?.roster;
  const workingAgentCount = agentRoster?.filter((r) => r.status === "working").length ?? 0;

  const ps = providerStatus.data;
  // X2 cleanup precedent (carried from AIHub): system is 100% local — provider is GGUF or Offline.
  const providerAvailable = ps?.activeProvider === "gguf";
  const providerLabel = providerAvailable ? "GGUF Local" : "Offline";
  const providerColor = providerAvailable ? "text-warning" : "text-muted-foreground";
  const providerBg = providerAvailable ? "bg-warning/10" : "bg-muted";

  // Taxonomy — 1:1 with the left-nav "ai" group (client/src/lib/navigation.tsx). Keep
  // href + requiredPermission/requiredRole IN SYNC with that group so this hub never
  // shows a tile the sidebar would hide (or vice-versa).
  const CATEGORIES: readonly HubCategory[] = [
    {
      key: "assistant",
      label: "nav.section.aiAssistant",
      icon: <MessageSquare className="h-4 w-4" />,
      tools: [
        {
          icon: MessageSquare,
          label: "aiHub.features.chat.title",
          blurb: "aiHub.features.chat.desc",
          href: "/ai-chat",
        },
        {
          icon: Inbox,
          label: "nav.inbox",
          blurb: "nav.inboxDesc",
          href: "/inbox",
        },
        {
          icon: Lightbulb,
          label: "aiHub.features.managementInsight.title",
          blurb: "aiHub.features.managementInsight.desc",
          href: "/management-insight",
        },
      ],
    },
    {
      key: "agentOps",
      label: "nav.section.aiAgentOps",
      icon: <Brain className="h-4 w-4" />,
      tools: [
        {
          icon: Brain,
          label: "aiHub.features.aiBrain.title",
          blurb: "aiHub.features.aiBrain.desc",
          href: "/ai-brain",
          requiredRole: "admin",
        },
        {
          icon: MonitorCheck,
          label: "aiHub.features.monitoring.title",
          blurb: "aiHub.features.monitoring.desc",
          href: "/ai-monitoring",
          requiredRole: "admin",
        },
        {
          icon: GraduationCap,
          label: "aiHub.features.activeLearning.title",
          blurb: "aiHub.features.activeLearning.desc",
          href: "/ai-active-learning",
          requiredRole: "admin",
        },
        {
          icon: Layers,
          label: "aiHub.features.batchInference.title",
          blurb: "aiHub.features.batchInference.desc",
          href: "/ai-batch-jobs",
          requiredRole: "admin",
        },
        {
          icon: Database,
          label: "aiHub.features.dataProcessing.title",
          blurb: "aiHub.features.dataProcessing.desc",
          href: "/ai-data-processing",
          requiredRole: "admin",
        },
      ],
    },
    {
      key: "analyticsReports",
      label: "nav.section.aiAnalyticsReports",
      icon: <TrendingUp className="h-4 w-4" />,
      tools: [
        {
          icon: Sparkles,
          label: "aiHub.features.inspectionAnalytics.title",
          blurb: "aiHub.features.inspectionAnalytics.desc",
          href: "/ai-inspection-analytics",
          requiredPermission: "analytics_ai_performance",
        },
        {
          icon: Activity,
          label: "aiHub.features.performance.title",
          blurb: "aiHub.features.performance.desc",
          href: "/ai-performance",
          requiredRole: "admin",
        },
        {
          icon: TrendingUp,
          label: "aiHub.features.timeSeries.title",
          blurb: "aiHub.features.timeSeries.desc",
          href: "/ai-time-series",
          requiredRole: "admin",
        },
        {
          icon: FileBarChart,
          label: "aiHub.features.reports.title",
          blurb: "aiHub.features.reports.desc",
          href: "/ai-reports",
          requiredRole: "admin",
        },
      ],
    },
    {
      key: "visionLab",
      label: "nav.section.aiVisionLab",
      icon: <FlaskConical className="h-4 w-4" />,
      tools: [
        {
          icon: ShieldCheck,
          label: "aiHub.features.qualityGate.title",
          blurb: "aiHub.features.qualityGate.desc",
          href: "/ai-quality-gate",
          requiredRole: "admin",
        },
        {
          icon: Search,
          label: "aiHub.features.imageSearch.title",
          blurb: "aiHub.features.imageSearch.desc",
          href: "/ai-image-search",
          requiredRole: "admin",
        },
        {
          icon: FlaskConical,
          label: "nav.advancedVisionLab",
          blurb: "nav.advancedVisionLabDesc",
          href: "/ai-advanced-vision-lab",
          requiredRole: "admin",
        },
        {
          icon: Boxes,
          label: "nav.anomalyBanks",
          blurb: "nav.anomalyBanksDesc",
          href: "/anomaly-banks",
          requiredRole: "admin",
        },
        {
          icon: Brush,
          label: "nav.maskAnnotation",
          blurb: "nav.maskAnnotationDesc",
          href: "/mask-annotation",
          requiredRole: "admin",
        },
        {
          icon: Workflow,
          label: "nav.causalGraph",
          blurb: "nav.causalGraphDesc",
          href: "/causal-graph",
          requiredPermission: "analytics_root_cause",
        },
      ],
    },
    {
      key: "models",
      label: "nav.section.aiModels",
      icon: <Cpu className="h-4 w-4" />,
      tools: [
        {
          icon: Cpu,
          label: "aiHub.features.modelManagement.title",
          blurb: "aiHub.features.modelManagement.desc",
          href: "/ai-models",
          requiredRole: "admin",
        },
        {
          icon: GitBranch,
          label: "nav.modelVersions",
          blurb: "nav.modelVersionsDesc",
          href: "/model-versions",
          requiredRole: "admin",
        },
        {
          icon: FileStack,
          label: "aiHub.features.ggufModels.title",
          blurb: "aiHub.features.ggufModels.desc",
          href: "/ai-gguf-models",
          requiredRole: "admin",
        },
        {
          icon: HeartPulse,
          label: "nav.robotModelHealth",
          blurb: "nav.robotModelHealthDesc",
          href: "/robot-model-health",
          requiredPermission: "machine_status",
        },
      ],
    },
    {
      key: "settings",
      label: "nav.section.aiSettings",
      icon: <Cog className="h-4 w-4" />,
      tools: [
        {
          icon: Cog,
          label: "aiHub.features.settings.title",
          blurb: "aiHub.features.settings.desc",
          href: "/ai-settings",
          requiredRole: "admin",
        },
      ],
    },
  ];

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Sparkles className="h-6 w-6 text-primary" />}
          title={t("aiHome.title", "AI Home")}
          description={t(
            "aiHome.subtitle",
            "Điểm khởi đầu AI — trò chuyện nhanh, mọi công cụ AI theo một danh mục duy nhất",
          )}
          actions={
            <Button onClick={() => setLocation("/ai-chat")}>
              <MessageSquare className="h-4 w-4 mr-1.5" />
              {t("aiHome.openChat", "Mở trò chuyện AI")}
            </Button>
          }
        />

        {/* Live Provider Status Panel — carried over from AIHub */}
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
                {ps?.gguf.available ? (
                  <CheckCircle2 className="h-4 w-4 text-warning" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-muted-foreground" />
                )}
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

        {/* Agent activity — LIVE (doc69 Wave 0-C). Reuses the SAME
            trpc.aiAgentCenter.getReadModel + getSavingsSummary the Command Center
            page (Wave E2) already renders, gated by the SAME admin/engineer
            isOpsRole check. Honest degradation, never a fake "coming soon": loading
            → skeleton; role-ineligible or query error → a neutral, truthful line;
            data present → real roster/working counts + real savings, never
            fabricated numbers. */}
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4 text-primary" />
                {t("aiHome.agentActivity.title", "Hoạt động Agent")}
              </CardTitle>
              <CardDescription>
                {t("aiHome.agentActivity.desc", "Đội hình AI agent trực tiếp — trạng thái và token tiết kiệm.")}
              </CardDescription>
            </div>
            {isOpsRole && (
              <Button variant="outline" size="sm" onClick={() => setLocation("/ai-command-center")}>
                {t("aiHome.agentActivity.cta", "Mở Trung tâm điều hành AI")}
                <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!isOpsRole ? (
              <p className="text-sm text-muted-foreground">
                {t(
                  "aiHome.agentActivity.opsOnly",
                  "Bảng hoạt động agent dành cho vai trò kỹ thuật hoặc quản trị.",
                )}
              </p>
            ) : agentReadModel.isLoading || agentSavings.isLoading ? (
              <div className="flex flex-wrap items-center gap-3">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-36" />
              </div>
            ) : agentReadModel.isError || agentSavings.isError ? (
              <p className="text-sm text-muted-foreground">
                {t("aiHome.agentActivity.loadError", "Không thể tải dữ liệu hoạt động agent lúc này.")}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-5 text-sm">
                <div className="flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold tabular-nums">{agentRoster?.length ?? 0}</span>
                  <span className="text-muted-foreground">{t("aiHome.agentActivity.rosterLabel", "agent")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Activity className="h-4 w-4 text-success" />
                  <span className="font-semibold tabular-nums">{workingAgentCount}</span>
                  <span className="text-muted-foreground">{t("aiHome.agentActivity.workingLabel", "đang hoạt động")}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <PiggyBank className="h-4 w-4 text-primary" />
                  {agentSavings.data?.dataAvailable ? (
                    <>
                      <span className="font-semibold tabular-nums">{fmtUsd(agentSavings.data.month.cloudEquivalentUsd)}</span>
                      <span className="text-muted-foreground">{t("aiHome.agentActivity.savingsMonthLabel", "tiết kiệm tháng này")}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t("aiHome.agentActivity.savingsEmpty", "Chưa đủ dữ liệu tiết kiệm")}</span>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Taxonomy launcher — same single taxonomy as the left nav "ai" group. */}
        <HubLauncher categories={CATEGORIES} categoriesLabel={t("aiHome.categoriesLabel", "Nhóm AI")} />
      </PageContainer>
    </DashboardLayout>
  );
}
