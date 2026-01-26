import { lazy, Suspense } from 'react';
import DashboardLayout from '@/components/DashboardLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MapPin, TrendingUp } from 'lucide-react';

// Lazy load the components
const DefectHeatmap = lazy(() => import('@/components/DefectHeatmap').then(m => ({ default: m.DefectHeatmap })));
const TrendAnalysisChart = lazy(() => import('@/components/TrendAnalysisChart').then(m => ({ default: m.TrendAnalysisChart })));

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
  return (
    <DashboardLayout>
      <div className="container py-6">
        <Tabs defaultValue="heatmap" className="space-y-6">
          <TabsList>
            <TabsTrigger value="heatmap" className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Bản đồ nhiệt
            </TabsTrigger>
            <TabsTrigger value="trends" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Phân tích xu hướng
            </TabsTrigger>
          </TabsList>

          <TabsContent value="heatmap">
            <ErrorBoundary
              variant="default"
              title="Không thể tải Bản đồ nhiệt Defects"
              description="Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại sau."
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
              title="Không thể tải Phân tích xu hướng"
              description="Đã xảy ra lỗi khi tải dữ liệu. Vui lòng thử lại sau."
              showDetails
            >
              <Suspense fallback={<LoadingSkeleton />}>
                <TrendAnalysisChart />
              </Suspense>
            </ErrorBoundary>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
