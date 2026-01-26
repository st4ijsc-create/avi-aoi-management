import { Suspense, lazy } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';

// Lazy load the DefectTrendPrediction component
const DefectTrendPrediction = lazy(() => import('@/components/DefectTrendPrediction').then(m => ({ default: m.DefectTrendPrediction })));

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-64" />
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-[400px]" />
    </div>
  );
}

export default function DefectPredictionPage() {
  return (
    <DashboardLayout>
      <div className="container py-6">
        <ErrorBoundary
          variant="default"
          title="Không thể tải Dự đoán Defects"
          description="Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại sau."
          showDetails
        >
          <Suspense fallback={<LoadingSkeleton />}>
            <DefectTrendPrediction />
          </Suspense>
        </ErrorBoundary>
      </div>
    </DashboardLayout>
  );
}
