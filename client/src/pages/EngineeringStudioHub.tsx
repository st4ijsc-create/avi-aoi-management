/**
 * doc 59 (cụm phụ) — Engineering Studio: hub-launcher gom các cockpit/IDE kỹ thuật (soạn
 * thảo · điều phối · an toàn · chuẩn-hoá/tích-hợp). GIỮ /engineering-home (EngineeringHub
 * hub-and-spoke có golden-thread + PendingReviewStrip, được breadcrumb/BottomNav trỏ) —
 * tạo MỚI /engineering-studio làm launcher danh mục. Per-tile RBAC theo GATE ROUTE THẬT
 * (critic: /fleet-orchestration //control-plane //robot-control route=machine_control dù nav
 * khai machine_status; route là nguồn thật). Additive: route con giữ nguyên.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { HubLauncher, type HubCategory } from "@/components/workspace";
import {
  Code2, Workflow, PenTool, Bot, FileStack, GitPullRequest, Network, Boxes,
  Cpu, Terminal, ShieldAlert, HardHat, BookMarked, Plug,
} from "lucide-react";

const CATEGORIES: readonly HubCategory[] = [
  {
    key: "authoring",
    label: "engHub.authoring",
    icon: <Code2 className="h-4 w-4" />,
    tools: [
      { icon: Code2, label: "engHub.engineering", blurb: "engHub.engineeringBlurb", href: "/engineering", requiredPermission: "machine_control" },
      { icon: Workflow, label: "engHub.irEditor", blurb: "Visual IR editor", href: "/ir-editor", requiredPermission: "machine_control" },
      { icon: PenTool, label: "POU Studio", blurb: "engHub.pouStudioBlurb", href: "/pou-studio", requiredPermission: "machine_control" },
      { icon: Bot, label: "Programming Copilot", blurb: "engHub.programmingCopilotBlurb", href: "/programming-copilot", requiredPermission: "machine_status" },
      { icon: FileStack, label: "engHub.recipes", blurb: "engHub.recipesBlurb", href: "/recipes", requiredPermission: "machine_control" },
      { icon: GitPullRequest, label: "engHub.engineeringChanges", blurb: "Engineering change notice", href: "/engineering-changes", requiredPermission: "machine_control" },
    ],
  },
  {
    key: "orchestration",
    label: "engHub.orchestration",
    icon: <Network className="h-4 w-4" />,
    tools: [
      { icon: Network, label: "Orchestration Studio", blurb: "engHub.orchestrationStudioBlurb", href: "/orchestration-studio", requiredPermission: "machine_control" },
      { icon: Boxes, label: "engHub.fleetOrchestration", blurb: "engHub.fleetOrchestrationBlurb", href: "/fleet-orchestration", requiredPermission: "machine_control" },
      { icon: Cpu, label: "Control Plane", blurb: "Capability/PackML/FOE", href: "/control-plane", requiredPermission: "machine_control" },
      { icon: Bot, label: "engHub.robotControl", blurb: "Registry + telemetry robot/AGV", href: "/robot-control", requiredPermission: "machine_control" },
      { icon: Terminal, label: "Command Console", blurb: "engHub.commandConsoleBlurb", href: "/command-console", requiredPermission: "machine_control", note: "HITL" },
    ],
  },
  {
    key: "safety",
    label: "engHub.safety",
    icon: <ShieldAlert className="h-4 w-4" />,
    tools: [
      { icon: ShieldAlert, label: "engHub.interlockRules", blurb: "engHub.interlockRulesBlurb", href: "/interlock-rules", requiredPermission: "interlock" },
      { icon: HardHat, label: "engHub.safetyWorkforce", blurb: "engHub.safetyWorkforceBlurb", href: "/safety-workforce", requiredPermission: "machine_status" },
    ],
  },
  {
    key: "standards",
    label: "engHub.standards",
    icon: <BookMarked className="h-4 w-4" />,
    tools: [
      { icon: BookMarked, label: "engHub.equipmentStandards", blurb: "Device-type hierarchy + alarm taxonomy", href: "/equipment-standards", requiredPermission: "machine_status" },
      { icon: Plug, label: "engHub.equipmentIntegration", blurb: "FOCAS/Euromap + recipe genealogy", href: "/equipment-integration", requiredPermission: "machine_status" },
    ],
  },
];

export default function EngineeringStudioHub() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("engineeringStudio.title", "Xưởng kỹ thuật")}>
      <HubLauncher categories={CATEGORIES} categoriesLabel={t("engineeringStudio.categories", "Nhóm kỹ thuật")} />
    </DashboardLayout>
  );
}
