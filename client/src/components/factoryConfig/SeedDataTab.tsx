/**
 * doc 47 Đợt 4 (tech-debt) — "Tạo dữ liệu mẫu" tab body extracted verbatim from
 * DataSettings.tsx. PURE RELOCATION — identical JSX + handlers, no behavior change.
 *
 * 2026-08-25 — GỠ hai thẻ/mutation "Dữ liệu kiểm tra" và "Phân tích trạm làm việc":
 * chúng gọi `seedData.seedInspections`/`seedData.seedWorkstationAnalytics`, bơm bản ghi
 * `Math.random()` thẳng vào `product_inspections`/`measurement_results` — hai bảng WORM
 * mà `avi_app` không có quyền DELETE (xoá phải dùng vai owner). Một cú bấm nhầm trên môi
 * trường thật để lại hàng trăm/nghìn bo bịa VĨNH VIỄN, lẫn vào dữ liệu sản xuất thật.
 * Chỉ giữ "Dữ liệu cơ sở" (→ `seedData.seed` → `seedSampleData`, chỉ `insert(factories)`,
 * dữ liệu CHỦ hợp lệ cho dev).
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
  // Seed Data Mutation
  const seedDataMutation = trpc.seedData.seed.useMutation({
    onSuccess: () => toast.success(t("seedDataTab.daTaoDuLieuCo", "Đã tạo dữ liệu cơ sở mẫu thành công!")),
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
        <div className="max-w-sm">
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
                {seedDataMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("seedData.dangTao", "Đang tạo...")}</> : t("seedData.taoDuLieuCoSo", "Tạo dữ liệu cơ sở")}
              </Button>
            </CardContent>
          </Card>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          ⚠️ Dữ liệu mẫu sẽ được thêm vào cơ sở dữ liệu hiện tại. Đảm bảo đã có cấu hình nhà máy trước khi tạo.
        </p>
      </CardContent>
    </Card>
  );
}
