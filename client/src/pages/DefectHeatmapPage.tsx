import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '@/components/DashboardLayout';
import { PageHeader, PageContainer } from '@/components/patterns';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MapPin, TrendingUp, Grid3X3 } from 'lucide-react';

// Lazy load the components
const DefectHeatmap = lazy(() => import('@/components/DefectHeatmap').then(m => ({ default: m.DefectHeatmap })));
const TrendAnalysisChart = lazy(() => import('@/components/TrendAnalysisChart').then(m => ({ default: m.TrendAnalysisChart })));
// Doc 27 gap A5 (W5-A): REAL bbox-based board heatmap.
const BoardDefectHeatmap = lazy(() => import('@/components/BoardDefectHeatmap').then(m => ({ default: m.BoardDefectHeatmap })));

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

export default function DefectHeatmapPage() {
  const { t } = useTranslation();

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<MapPin className="h-6 w-6" />}
          title={t('defects.heatmap.pageTitle', 'Bản đồ nhiệt lỗi & Xu hướng')}
          description={t('defects.heatmap.pageSubtitle', 'Phân bố lỗi theo vị trí và phân tích xu hướng theo thời gian')}
        />
        <Tabs defaultValue="board" className="space-y-6">
          <TabsList>
            <TabsTrigger value="board" className="flex items-center gap-2">
              <Grid3X3 className="h-4 w-4" />
              {t('defects.heatmap.boardTab')}
            </TabsTrigger>
            <TabsTrigger value="heatmap" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              {t('defects.heatmap.title')}
            </TabsTrigger>
            <TabsTrigger value="trends" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              {t('reports.trendAnalysis')}
            </TabsTrigger>
          </TabsList>

          {/* Doc 27 A5 — REAL bbox board-space heatmap (default tab) */}
          <TabsContent value="board">
            <ErrorBoundary
              variant="default"
              title={t('defects.cannotLoadHeatmap')}
              description={t('common.errorLoadingData')}
              showDetails
            >
              <Suspense fallback={<LoadingSkeleton />}>
                <BoardDefectHeatmap />
              </Suspense>
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="heatmap">
            <ErrorBoundary
              variant="default"
              title={t('defects.cannotLoadHeatmap')}
              description={t('common.errorLoadingData')}
              showDetails
            >
              <Suspense fallback={<LoadingSkeleton />}>
                <DefectHeatmap />
              </Suspense>
            </ErrorBoundary>
          </TabsContent>

          <TabsContent value="trends">
            <ErrorBoundary
              variant="default"
              title={t('defects.cannotLoadTrendAnalysis')}
              description={t('common.errorLoadingData')}
              showDetails
            >
              <Suspense fallback={<LoadingSkeleton />}>
                <TrendAnalysisChart />
              </Suspense>
            </ErrorBoundary>
          </TabsContent>
        </Tabs>
      </PageContainer>
    </DashboardLayout>
  );
}
