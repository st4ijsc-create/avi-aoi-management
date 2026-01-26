import DashboardLayout from '@/components/DashboardLayout';
import { AnnotationComparison } from '@/components/AnnotationComparison';

export default function AnnotationComparisonPage() {
  return (
    <DashboardLayout>
      <div className="container py-6">
        <AnnotationComparison />
      </div>
    </DashboardLayout>
  );
}
