import DashboardLayout from '@/components/DashboardLayout';
import { ReportScheduler } from '@/components/ReportScheduler';

export default function ReportSchedulingPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Lịch báo cáo tự động</h1>
          <p className="text-muted-foreground">
            Cấu hình và quản lý các báo cáo được gửi tự động qua email
          </p>
        </div>
        
        <ReportScheduler />
      </div>
    </DashboardLayout>
  );
}
