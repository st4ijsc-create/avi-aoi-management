import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

  return (
    <DashboardLayout>
      <div className="container py-6">
        <ErrorBoundary
          variant="default"
          title={t('defects.cannotLoadPrediction')}
          description={t('common.errorLoadingData')}
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
