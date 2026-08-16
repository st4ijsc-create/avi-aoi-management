/**
 * doc 47 Đợt 4 (tech-debt) — "Tạo dữ liệu mẫu" tab body extracted verbatim from
 * DataSettings.tsx. Fully self-contained: owns its three seed mutations, no shared
 * parent state / refetch. PURE RELOCATION — identical JSX + handlers, no behavior change.
 */
import { trpc } from "@/lib/trpc";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Loader2 } from "lucide-react";

export function SeedDataTab() {
  const { t } = useTranslation();
  // Seed Data Mutations
  const seedDataMutation = trpc.seedData.seed.useMutation({
    onSuccess: () => toast.success('Đã tạo dữ liệu cơ sở mẫu thành công!'),
    onError: (error) => toastTrpcError(error),
  });

  const seedInspectionsMutation = trpc.seedData.seedInspections.useMutation({
    onSuccess: () => toast.success('Đã tạo 100 bản ghi kiểm tra mẫu thành công!'),
    onError: (error) => toastTrpcError(error),
  });

  const seedWorkstationAnalyticsMutation = trpc.seedData.seedWorkstationAnalytics.useMutation({
    onSuccess: () => toast.success('Đã tạo dữ liệu phân tích trạm làm việc mẫu thành công!'),
    onError: (error) => toastTrpcError(error),
  });

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5 text-green-500" />
          Tạo dữ liệu mẫu
        </CardTitle>
        <CardDescription>
          Tạo dữ liệu mẫu để kiểm tra và demo hệ thống. Chỉ dùng trên môi trường phát triển.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("seedData.duLieuCoSo", "Dữ liệu cơ sở")}</CardTitle>
              <CardDescription className="text-xs">{t("seedData.taoNhaMayDayChuyen", "Tạo nhà máy, dây chuyền, máy móc và sản phẩm mẫu")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => seedDataMutation.mutate()}
                disabled={seedDataMutation.isPending}
                className="w-full"
                variant="outline"
              >
                {seedDataMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("seedData.dangTao", "Đang tạo...")}</> : 'Tạo dữ liệu cơ sở'}
              </Button>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("seedData.duLieuKiemTra", "Dữ liệu kiểm tra")}</CardTitle>
              <CardDescription className="text-xs">{t("seedData.tao100BanGhiKiem", "Tạo 100 bản ghi kiểm tra mẫu (OK/NG)")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => seedInspectionsMutation.mutate({ count: 100 })}
                disabled={seedInspectionsMutation.isPending}
                className="w-full"
                variant="outline"
              >
                {seedInspectionsMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("seedData.dangTao2", "Đang tạo...")}</> : 'Tạo 100 bản ghi kiểm tra'}
              </Button>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">{t("seedData.phanTichTramLamViec", "Phân tích trạm làm việc")}</CardTitle>
              <CardDescription className="text-xs">{t("seedData.tao500BanGhiPhan", "Tạo 500 bản ghi phân tích 7 ngày gần đây")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => seedWorkstationAnalyticsMutation.mutate({ inspectionCount: 500, daysBack: 7 })}
                disabled={seedWorkstationAnalyticsMutation.isPending}
                className="w-full"
                variant="outline"
              >
                {seedWorkstationAnalyticsMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("seedData.dangTao3", "Đang tạo...")}</> : 'Tạo dữ liệu phân tích'}
              </Button>
            </CardContent>
          </Card>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          ⚠️ Dữ liệu mẫu sẽ được thêm vào cơ sở dữ liệu hiện tại. Đảm bảo đã có cấu hình nhà máy và sản phẩm trước khi tạo dữ liệu kiểm tra.
        </p>
      </CardContent>
    </Card>
  );
}
