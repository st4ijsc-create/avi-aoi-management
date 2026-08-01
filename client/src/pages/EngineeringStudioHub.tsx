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
    label: "Soạn thảo & IDE",
    icon: <Code2 className="h-4 w-4" />,
    tools: [
      { icon: Code2, label: "Xưởng lập trình thiết bị", blurb: "Viết & biên dịch chương trình thiết bị", href: "/engineering", requiredPermission: "machine_control" },
      { icon: Workflow, label: "Trình soạn IR", blurb: "Visual IR editor", href: "/ir-editor", requiredPermission: "machine_control" },
      { icon: PenTool, label: "POU Studio", blurb: "Soạn POU/IEC 61131", href: "/pou-studio", requiredPermission: "machine_control" },
      { icon: Bot, label: "Programming Copilot", blurb: "AI hỗ trợ lập trình PLC/robot", href: "/programming-copilot", requiredPermission: "machine_status" },
      { icon: FileStack, label: "Recipe máy", blurb: "Công thức chạy máy", href: "/recipes", requiredPermission: "machine_control" },
      { icon: GitPullRequest, label: "Thay đổi kỹ thuật (ECN)", blurb: "Engineering change notice", href: "/engineering-changes", requiredPermission: "machine_control" },
    ],
  },
  {
    key: "orchestration",
    label: "Điều phối & Điều khiển",
    icon: <Network className="h-4 w-4" />,
    tools: [
      { icon: Network, label: "Orchestration Studio", blurb: "Soạn/mô phỏng/triển khai điều phối", href: "/orchestration-studio", requiredPermission: "machine_control" },
      { icon: Boxes, label: "Điều phối fleet", blurb: "Phân bổ tác vụ + vùng cho fleet", href: "/fleet-orchestration", requiredPermission: "machine_control" },
      { icon: Cpu, label: "Control Plane", blurb: "Capability/PackML/FOE", href: "/control-plane", requiredPermission: "machine_control" },
      { icon: Bot, label: "Điều khiển robot", blurb: "Registry + telemetry robot/AGV", href: "/robot-control", requiredPermission: "machine_control" },
      { icon: Terminal, label: "Command Console", blurb: "Lệnh robot đơn qua HITL", href: "/command-console", requiredPermission: "machine_control", note: "HITL" },
    ],
  },
  {
    key: "safety",
    label: "An toàn",
    icon: <ShieldAlert className="h-4 w-4" />,
    tools: [
      { icon: ShieldAlert, label: "Luật interlock", blurb: "Quản lý luật khóa liên động", href: "/interlock-rules", requiredPermission: "interlock" },
      { icon: HardHat, label: "An toàn & Nhân lực", blurb: "Bảng an toàn + mixed-workforce", href: "/safety-workforce", requiredPermission: "machine_status" },
    ],
  },
  {
    key: "standards",
    label: "Chuẩn hoá & Tích hợp",
    icon: <BookMarked className="h-4 w-4" />,
    tools: [
      { icon: BookMarked, label: "Chuẩn thiết bị", blurb: "Device-type hierarchy + alarm taxonomy", href: "/equipment-standards", requiredPermission: "machine_status" },
      { icon: Plug, label: "Tích hợp thiết bị", blurb: "FOCAS/Euromap + recipe genealogy", href: "/equipment-integration", requiredPermission: "machine_status" },
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
