/**
 * Doc 31 PM5 / UX8 (WB-3) — Golden-samples panel for the product page.
 *
 * SURFACING the golden references of the SELECTED product right on /products,
 * keyed by productModelId (survives a product-code rename via the 0195 FK). Shows
 * each golden's thumbnail + status + version + key (roiKey/recipe/station) so an
 * engineer can see "what known-good images does this product have?" without
 * leaving the page.
 *
 * This does NOT reimplement the golden capture/approve flow — it DEEP-LINKS to
 * /golden-samples with the product scope prefilled (UX8): the capture dialog opens
 * there with this product's code filled in. Read-only surface here.
 */
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Star, Camera, ExternalLink, Loader2, ImageIcon } from "lucide-react";

type GoldenRow = {
  id: number;
  productCode: string | null;
  productModelId: number | null;
  recipeCode: string | null;
  stationCode: string | null;
  roiKey: string | null;
  version: number;
  active: boolean;
  status: string;
  thumbnailDataUrl: string | null;
};

export default function ProductGoldenSamplesPanel({
  productModelId,
  productCode,
}: {
  productModelId: number;
  productCode: string;
}) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  const listQuery = trpc.goldenSample.listByProduct.useQuery(
    { productModelId, withThumbnails: true, limit: 50 },
    { enabled: productModelId > 0 },
  );
  const rows = (listQuery.data ?? []) as GoldenRow[];
  const approvedActive = rows.filter((r) => r.status === "approved" && r.active).length;

  // UX8 — deep-link to the golden page with this product's scope prefilled +
  // the capture dialog auto-opened.
  const goCapture = () =>
    setLocation(`/golden-samples?product=${encodeURIComponent(productCode)}&capture=1`);
  const goManage = () =>
    setLocation(`/golden-samples?product=${encodeURIComponent(productCode)}`);

  const statusBadge = (r: GoldenRow) => {
    if (r.status === "approved") {
      return (
        <span className="flex items-center gap-1">
          <Badge className="bg-success/20 text-success border-success/30 text-[10px]">
            {t("goldenSamples.status.approved", "Đã duyệt")}
          </Badge>
          {r.active && (
            <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">ACTIVE</Badge>
          )}
        </span>
      );
    }
    if (r.status === "draft") {
      return (
        <Badge className="bg-warning/20 text-warning border-warning/30 text-[10px]">
          {t("goldenSamples.status.draft", "Nháp — chờ duyệt")}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="text-[10px]">
        {t("goldenSamples.status.retired", "Đã thu hồi")}
      </Badge>
    );
  };

  const keyLabel = (r: GoldenRow) =>
    [r.recipeCode && `recipe:${r.recipeCode}`, r.stationCode && `station:${r.stationCode}`, r.roiKey && `ROI:${r.roiKey}`]
      .filter(Boolean)
      .join(" · ") || t("goldenSamples.productLevel", "Cấp sản phẩm");

  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Star className="h-4 w-4 text-warning" />
          {t("products.goldenPanel.title", "Golden samples (mẫu chuẩn)")}
          <Badge variant="secondary" className="ml-1">
            {t("products.goldenPanel.count", "{{approved}} duyệt / {{total}} tổng", {
              approved: approvedActive,
              total: rows.length,
            })}
          </Badge>
        </CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="gap-1" onClick={goManage}>
            <ExternalLink className="h-3.5 w-3.5" />
            {t("products.goldenPanel.manage", "Quản lý")}
          </Button>
          <Button size="sm" className="gap-1" onClick={goCapture}>
            <Camera className="h-3.5 w-3.5" />
            {t("products.goldenPanel.capture", "Chụp golden")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p>
              {t(
                "products.goldenPanel.empty",
                "Sản phẩm này chưa có golden nào. Nhấn \"Chụp golden\" để tạo mẫu chuẩn known-good (dùng cho golden-diff).",
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={goManage}
                className="text-left rounded-lg border border-border/60 bg-muted/20 p-2 hover:border-primary/50 transition-colors"
                title={t("products.goldenPanel.openManage", "Mở trang quản lý golden")}
              >
                <div className="aspect-square w-full rounded-md overflow-hidden bg-background/60 flex items-center justify-center mb-2">
                  {r.thumbnailDataUrl ? (
                    <img src={r.thumbnailDataUrl} alt={keyLabel(r)} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <ImageIcon className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <span className="text-[11px] font-medium text-muted-foreground">v{r.version}</span>
                  {statusBadge(r)}
                </div>
                <p className="text-[11px] text-muted-foreground truncate" title={keyLabel(r)}>
                  {keyLabel(r)}
                </p>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
