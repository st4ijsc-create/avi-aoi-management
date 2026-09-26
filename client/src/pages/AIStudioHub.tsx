/**
 * doc 59 Cụm H — AI Studio: ONE admin hub for the ~17 AI control-plane surfaces
 * (models/versions, monitoring/perf, ops/jobs, vision-lab, settings). Hub-launcher on
 * HubLauncher (rail categories ⇄ ToolTile deep-links) — none of the 17 pages export a
 * *Content, so embedding would be an L-effort 17-page refactor; the launcher unifies the
 * ENTRY with zero refactor/redirect. Admin-gated at the route (critic): the read-open AI
 * Workspace (/ai-chat, /ai-hub, /management-insight) stays separate, and non-admins keep
 * the standalone /robot-model-health nav entry.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { HubLauncher, type HubCategory } from "@/components/workspace";
import {
  Boxes, GitBranch, FileStack, Brain, Activity, Gauge, LineChart, ScanText,
  GraduationCap, Layers, Clock, FileBarChart, ShieldCheck, ImageIcon, FlaskConical,
  Boxes as BoxesIcon, PenTool, Cpu, Settings, HeartPulse,
} from "lucide-react";

const CATEGORIES: readonly HubCategory[] = [
  {
    key: "models",
    label: "aiStudioHub.models",
    icon: <Boxes className="h-4 w-4" />,
    tools: [
      { icon: Boxes, label: "aiStudioHub.aiModels", blurb: "aiStudioHub.aiModelsBlurb", href: "/ai-models" },
      { icon: GitBranch, label: "aiStudioHub.modelVersions", blurb: "aiStudioHub.modelVersionsBlurb", href: "/model-versions" },
      { icon: FileStack, label: "aiStudioHub.aiGgufModels", blurb: "aiStudioHub.aiGgufModelsBlurb", href: "/ai-gguf-models" },
    ],
  },
  {
    key: "monitoring",
    label: "aiStudioHub.monitoring",
    icon: <Activity className="h-4 w-4" />,
    tools: [
      { icon: Brain, label: "AI Brain", blurb: "aiStudioHub.aiBrainBlurb", href: "/ai-brain" },
      { icon: Activity, label: "aiStudioHub.aiMonitoring", blurb: "aiStudioHub.aiMonitoringBlurb", href: "/ai-monitoring" },
      { icon: Gauge, label: "aiStudioHub.aiPerformance", blurb: "Latency · throughput · A/B", href: "/ai-performance" },
      { icon: LineChart, label: "aiStudioHub.aiInspectionAnalytics", blurb: "AI inspection analytics", href: "/ai-inspection-analytics" },
    ],
  },
  {
    key: "ops",
    label: "aiStudioHub.ops",
    icon: <Layers className="h-4 w-4" />,
    tools: [
      { icon: GraduationCap, label: "Active learning", blurb: "aiStudioHub.aiActiveLearningBlurb", href: "/ai-active-learning" },
      { icon: Layers, label: "aiStudioHub.aiBatchJobs", blurb: "Batch inference jobs", href: "/ai-batch-jobs" },
      { icon: ScanText, label: "aiStudioHub.aiDataProcessing", blurb: "Data processing pipeline", href: "/ai-data-processing" },
      { icon: Clock, label: "aiStudioHub.aiTimeSeries", blurb: "AI time-series", href: "/ai-time-series" },
      { icon: FileBarChart, label: "aiStudioHub.aiReports", blurb: "AI-generated reports", href: "/ai-reports" },
    ],
  },
  {
    key: "vision",
    label: "aiStudioHub.vision",
    icon: <FlaskConical className="h-4 w-4" />,
    tools: [
      { icon: ShieldCheck, label: "aiStudioHub.aiQualityGate", blurb: "AI quality gate", href: "/ai-quality-gate" },
      { icon: ImageIcon, label: "aiStudioHub.aiImageSearch", blurb: "AI image search", href: "/ai-image-search" },
      { icon: FlaskConical, label: "aiStudioHub.aiAdvancedVisionLab", blurb: "Advanced vision lab", href: "/ai-advanced-vision-lab" },
      { icon: BoxesIcon, label: "aiStudioHub.anomalyBanks", blurb: "Anomaly banks", href: "/anomaly-banks" },
      { icon: PenTool, label: "aiStudioHub.maskAnnotation", blurb: "Mask annotation", href: "/mask-annotation" },
      { icon: Cpu, label: "aiStudioHub.causalGraph", blurb: "Causal graph editor", href: "/causal-graph" },
    ],
  },
  {
    key: "settings",
    label: "aiStudioHub.settings",
    icon: <Settings className="h-4 w-4" />,
    tools: [
      { icon: Settings, label: "aiStudioHub.aiSettings", blurb: "aiStudioHub.aiSettingsBlurb", href: "/ai-settings" },
      { icon: HeartPulse, label: "aiStudioHub.robotModelHealth", blurb: "Anomaly + rollback audit", href: "/robot-model-health" },
    ],
  },
];

export default function AIStudioHub() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("aiStudio.title", "AI Studio")}>
      <HubLauncher categories={CATEGORIES} categoriesLabel={t("aiStudio.categories", "Nhóm AI")} />
    </DashboardLayout>
  );
}
