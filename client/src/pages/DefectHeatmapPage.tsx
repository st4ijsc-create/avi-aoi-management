import DashboardLayout from '@/components/DashboardLayout';
import { DefectHeatmap } from '@/components/DefectHeatmap';

export default function DefectHeatmapPage() {
  return (
    <DashboardLayout>
      <div className="container py-6">
        <DefectHeatmap />
      </div>
    </DashboardLayout>
  );
}
