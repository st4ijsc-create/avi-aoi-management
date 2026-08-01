/**
 * doc 59 Cụm G — Reporting Studio: gom các bề mặt báo cáo/xuất rời rạc thành MỘT studio
 * 4 tab trên TabbedHub (Build · Schedule · Export · Compare), nhúng *Content sẵn có
 * (ReportBuilder/ScheduledReports/Pdf/PowerPoint/ComparisonStudio). Route MỚI
 * /reporting-studio (KHÔNG đụng Reports.tsx 1311 dòng — trang "Browse" saved-reports giữ ở
 * /reports, link từ nav). Additive: mọi trang con vẫn sống + deep-link. ?tab= sync.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { TabbedHub, type TabbedHubTab } from "@/components/workspace";
import { LayoutDashboard, PenSquare, CalendarClock, Download, GitCompare } from "lucide-react";
import { ReportsContent } from "./Reports";
import { ReportBuilderContent } from "./ReportBuilder";
import { ScheduledReportsContent } from "./ScheduledReports";
import { ComparisonStudioContent } from "./ComparisonStudio";
import { ExportTabGroup } from "./reportingStudio/ExportTabGroup";

const TABS: readonly TabbedHubTab[] = [
  // doc 60 G — quality-analytics dashboard (yield/trends/COPQ), KHÔNG phải saved-reports.
  { value: "overview", labelKey: "reportingStudio.tabs.overview", fallback: "Tổng quan", icon: <LayoutDashboard className="h-4 w-4" />, Content: ReportsContent },
  { value: "build", labelKey: "reportingStudio.tabs.build", fallback: "Tạo báo cáo", icon: <PenSquare className="h-4 w-4" />, Content: ReportBuilderContent },
  { value: "schedule", labelKey: "reportingStudio.tabs.schedule", fallback: "Lịch báo cáo", icon: <CalendarClock className="h-4 w-4" />, Content: ScheduledReportsContent },
  { value: "export", labelKey: "reportingStudio.tabs.export", fallback: "Xuất (PDF/PPTX)", icon: <Download className="h-4 w-4" />, Content: ExportTabGroup },
  // ComparisonStudio đã bao gồm data/product comparison (doc 39) → 1 tab Compare.
  { value: "compare", labelKey: "reportingStudio.tabs.compare", fallback: "So sánh", icon: <GitCompare className="h-4 w-4" />, Content: ComparisonStudioContent },
];

export default function ReportingStudio() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("reportingStudio.title", "Xưởng báo cáo")}>
      <TabbedHub tabs={TABS} basePath="/reporting-studio" defaultTab="overview" />
    </DashboardLayout>
  );
}
