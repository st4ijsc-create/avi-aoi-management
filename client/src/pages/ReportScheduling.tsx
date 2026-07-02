import DashboardLayout from '@/components/DashboardLayout';
import { PageContainer, PageHeader } from '@/components/patterns';
import { ReportScheduler } from '@/components/ReportScheduler';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function ReportSchedulingPage() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<CalendarClock className="h-6 w-6" />}
          title={t('reports.autoReportSchedule')}
          description={t('reports.autoReportDescription')}
        />

        <ReportScheduler />
      </PageContainer>
    </DashboardLayout>
  );
}
