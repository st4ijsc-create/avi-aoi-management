/**
 * doc 59 Cụm I — Maintenance hub: ONE entry for bảo trì (work-orders · CMMS/độ-tin-cậy ·
 * technician RCA copilot). Blueprint đề xuất master-detail nhưng 0/4 surface có *Content
 * (phải tách 6 module stateful: MTTR/parts-ledger/HITL two-call) ⇒ L-effort/high-regression.
 * Chọn hub-launcher an toàn (như E/H): hợp nhất CỬA VÀO, giữ mọi route sống (kể cả
 * /technician-copilot?machineId= auto-run). Per-tile RBAC.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { HubLauncher, type HubCategory } from "@/components/workspace";
import { ClipboardList, Wrench, CalendarClock, Stethoscope } from "lucide-react";

const CATEGORIES: readonly HubCategory[] = [
  {
    key: "work",
    label: "Công việc & Độ tin cậy",
    icon: <Wrench className="h-4 w-4" />,
    tools: [
      { icon: ClipboardList, label: "Lệnh công việc", blurb: "Hàng đợi work-order + trạng thái", href: "/work-orders", requiredPermission: "machine_status" },
      { icon: CalendarClock, label: "CMMS (PM + độ tin cậy)", blurb: "Lịch bảo trì phòng ngừa · MTBF/MTTR", href: "/cmms", requiredPermission: "machine_control" },
    ],
  },
  {
    key: "diagnose",
    label: "Chẩn đoán & Hỗ trợ",
    icon: <Stethoscope className="h-4 w-4" />,
    tools: [
      { icon: Stethoscope, label: "Technician Copilot", blurb: "RCA + gợi ý sửa 1-chạm (HITL)", href: "/technician-copilot", requiredPermission: "machine_status" },
    ],
  },
];

export default function MaintenanceWorkspaceHub() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("maintenanceHub.title", "Bảo trì")}>
      <HubLauncher categories={CATEGORIES} categoriesLabel={t("maintenanceHub.categories", "Nhóm bảo trì")} />
    </DashboardLayout>
  );
}
