import DashboardLayout from '@/components/DashboardLayout';
import { DefectTrendPrediction } from '@/components/DefectTrendPrediction';

export default function DefectPredictionPage() {
  return (
    <DashboardLayout>
      <div className="container py-6">
        <DefectTrendPrediction />
      </div>
    </DashboardLayout>
  );
}
