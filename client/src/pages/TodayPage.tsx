/**
 * P3-W2 — Today Briefing full-screen route (`/today`).
 *
 * Thin wrapper that renders the existing role-aware <TodayBriefing/> component
 * full-page inside the standard DashboardLayout. The component was previously
 * only embedded in the role-home shells; this gives it a dedicated, read-open
 * surface reachable from the ME nav group by every authenticated role.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer } from "@/components/patterns";
import { TodayBriefing } from "@/components/TodayBriefing";

export default function TodayPage() {
  const { t } = useTranslation();
  return (
    <DashboardLayout title={t("today.title", "Today")} currentPath="/today">
      <PageContainer className="max-w-5xl">
        <TodayBriefing />
      </PageContainer>
    </DashboardLayout>
  );
}
