import DashboardLayout from '@/components/DashboardLayout';
import { ReportScheduler } from '@/components/ReportScheduler';
import { useTranslation } from 'react-i18next';

export default function ReportSchedulingPage() {
  const { t } = useTranslation();
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t('reports.autoReportSchedule')}</h1>
          <p className="text-muted-foreground">
            {t('reports.autoReportDescription')}
          </p>
        </div>
        
        <ReportScheduler />
      </div>
    </DashboardLayout>
  );
}
