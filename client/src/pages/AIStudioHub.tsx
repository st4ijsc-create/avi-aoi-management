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
    label: "Mô hình & Phiên bản",
    icon: <Boxes className="h-4 w-4" />,
    tools: [
      { icon: Boxes, label: "Quản lý mô hình AI", blurb: "Đăng ký · triển khai · rollback model", href: "/ai-models" },
      { icon: GitBranch, label: "Phiên bản mô hình", blurb: "Lịch sử phiên bản + so sánh", href: "/model-versions" },
      { icon: FileStack, label: "Mô hình GGUF", blurb: "LLM cục bộ (llama.cpp)", href: "/ai-gguf-models" },
    ],
  },
  {
    key: "monitoring",
    label: "Giám sát & Hiệu năng",
    icon: <Activity className="h-4 w-4" />,
    tools: [
      { icon: Brain, label: "AI Brain", blurb: "Trung tâm điều phối AI", href: "/ai-brain" },
      { icon: Activity, label: "Giám sát mô hình", blurb: "Drift · độ chính xác thời gian thực", href: "/ai-monitoring" },
      { icon: Gauge, label: "Hiệu năng AI", blurb: "Latency · throughput · A/B", href: "/ai-performance" },
      { icon: LineChart, label: "Phân tích kiểm tra AI", blurb: "AI inspection analytics", href: "/ai-inspection-analytics" },
    ],
  },
  {
    key: "ops",
    label: "Vận hành & Tác vụ",
    icon: <Layers className="h-4 w-4" />,
    tools: [
      { icon: GraduationCap, label: "Active learning", blurb: "Vòng lặp gán nhãn chủ động", href: "/ai-active-learning" },
      { icon: Layers, label: "Suy luận theo lô", blurb: "Batch inference jobs", href: "/ai-batch-jobs" },
      { icon: ScanText, label: "Xử lý dữ liệu", blurb: "Data processing pipeline", href: "/ai-data-processing" },
      { icon: Clock, label: "Chuỗi thời gian", blurb: "AI time-series", href: "/ai-time-series" },
      { icon: FileBarChart, label: "Báo cáo AI", blurb: "AI-generated reports", href: "/ai-reports" },
    ],
  },
  {
    key: "vision",
    label: "Phòng thí nghiệm thị giác",
    icon: <FlaskConical className="h-4 w-4" />,
    tools: [
      { icon: ShieldCheck, label: "Cổng chất lượng AI", blurb: "AI quality gate", href: "/ai-quality-gate" },
      { icon: ImageIcon, label: "Tìm ảnh tương tự", blurb: "AI image search", href: "/ai-image-search" },
      { icon: FlaskConical, label: "Vision Lab nâng cao", blurb: "Advanced vision lab", href: "/ai-advanced-vision-lab" },
      { icon: BoxesIcon, label: "Ngân hàng bất thường", blurb: "Anomaly banks", href: "/anomaly-banks" },
      { icon: PenTool, label: "Gán nhãn mask", blurb: "Mask annotation", href: "/mask-annotation" },
      { icon: Cpu, label: "Đồ thị nhân quả", blurb: "Causal graph editor", href: "/causal-graph" },
    ],
  },
  {
    key: "settings",
    label: "Cấu hình & Sức khỏe",
    icon: <Settings className="h-4 w-4" />,
    tools: [
      { icon: Settings, label: "Cài đặt AI", blurb: "Cấu hình model server + gateway", href: "/ai-settings" },
      { icon: HeartPulse, label: "Sức khỏe mô hình robot", blurb: "Anomaly + rollback audit", href: "/robot-model-health" },
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
