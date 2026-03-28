import DashboardLayout from '@/components/DashboardLayout';
import { AnnotationComparison } from '@/components/AnnotationComparison';

export function AnnotationComparisonPageContent() {
  return (
    <>
      <div className="container py-6">
        <AnnotationComparison />
      </div>
    </>
  );
}

export default function AnnotationComparisonPage() {
  return (
    <DashboardLayout>
      <AnnotationComparisonPageContent />
    </DashboardLayout>
  );
}
