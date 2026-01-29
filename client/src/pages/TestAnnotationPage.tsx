import DashboardLayout from '@/components/DashboardLayout';
import { AnnotationComparison } from '@/components/AnnotationComparison';

export default function TestAnnotationPage() {
  return (
    <DashboardLayout>
      <div className="container py-6">
        <h1 className="text-2xl font-bold mb-4">Test Annotation Comparison</h1>
        <AnnotationComparison />
      </div>
    </DashboardLayout>
  );
}
