/**
 * doc 48 R4 (tech-debt) — "Product Release tab body" extracted VERBATIM from ProductModels.tsx.
 * PURE RELOCATION: the page still owns all state/queries/mutations/handlers and threads
 * them 1:1 as props (names unchanged); `t`/`user` are re-derived from hooks locally, as in
 * the sibling components/products/* dialogs. Identical JSX/handlers — no behavior change.
 */

import type { Dispatch, SetStateAction } from "react";
import { type RouterOutputs, type ProductModel } from "./types";
import { ProductPackageButtons } from "@/components/ProductPackageButtons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Crosshair, Grid3X3, Layers, Package, Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";

interface ProductReleaseTabProps {
  refetchProducts: () => void;
  selectedProduct: ProductModel | null;
  setIsFiducialsOpen: Dispatch<SetStateAction<boolean>>;
  setIsPanelDefOpen: Dispatch<SetStateAction<boolean>>;
  setIsProgramReleaseOpen: Dispatch<SetStateAction<boolean>>;
  setIsTemplateDialogOpen: Dispatch<SetStateAction<boolean>>;
  templates: RouterOutputs["template"]["list"] | undefined;
}

export function ProductReleaseTab(props: ProductReleaseTabProps) {
  const { t } = useTranslation();
  const {
    refetchProducts, selectedProduct, setIsFiducialsOpen, setIsPanelDefOpen,
    setIsProgramReleaseOpen, setIsTemplateDialogOpen, templates,
  } = props;
  return (
    <>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {/* Phát hành chương trình */}
                  <div className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Rocket className="h-5 w-5 text-primary" />
                      <h4 className="font-medium text-sm">{t("programRelease.button")}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("products.releaseProgramHint", "Đóng gói & phát hành chương trình kiểm tra cho sản phẩm này.")}
                    </p>
                    <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => setIsProgramReleaseOpen(true)}>
                      <Rocket className="h-4 w-4" />
                      {t("products.openRelease", "Mở phát hành")}
                    </Button>
                  </div>

                  {/* Panel N-up */}
                  <div className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Grid3X3 className="h-5 w-5 text-primary" />
                      <h4 className="font-medium text-sm">{t("panelDef.button")}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("products.panelDefHint", "Định nghĩa panel nhiều board (N-up) và bố cục ghép.")}
                    </p>
                    <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => setIsPanelDefOpen(true)}>
                      <Grid3X3 className="h-4 w-4" />
                      {t("products.openPanelDef", "Mở panel N-up")}
                    </Button>
                  </div>

                  {/* Fiducials */}
                  <div className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Crosshair className="h-5 w-5 text-primary" />
                      <h4 className="font-medium text-sm">{t("products.fiducialsButton", "Fiducials")}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("products.fiducialsDesc", "Alignment fiducial marks used to register the board before inspection.")}
                    </p>
                    <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => setIsFiducialsOpen(true)}>
                      <Crosshair className="h-4 w-4" />
                      {t("products.openFiducials", "Mở fiducials")}
                    </Button>
                  </div>

                  {/* Mẫu điểm đo (Templates) */}
                  <div className="border rounded-lg p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Layers className="h-5 w-5 text-primary" />
                      <h4 className="font-medium text-sm">{t("products.templates")}</h4>
                      <Badge variant="secondary" className="ml-auto">{templates?.length || 0}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("products.templatesHint", "Lưu bộ điểm đo hiện tại thành mẫu, hoặc áp mẫu có sẵn.")}
                    </p>
                    <Button size="sm" variant="outline" className="w-full gap-1" onClick={() => setIsTemplateDialogOpen(true)}>
                      <Layers className="h-4 w-4" />
                      {t("products.openTemplates", "Mở mẫu điểm đo")}
                    </Button>
                  </div>

                  {/* Gói sản phẩm — xuất/nhập (JSON) */}
                  <div className="border rounded-lg p-4 space-y-2 md:col-span-2 xl:col-span-1">
                    <div className="flex items-center gap-2">
                      <Package className="h-5 w-5 text-primary" />
                      <h4 className="font-medium text-sm">{t("products.advGroupExchange", "Trao đổi dữ liệu")}</h4>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("products.packageHint", "Xuất/nhập gói sản phẩm (JSON) để chuyển giữa các hệ thống.")}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <ProductPackageButtons selectedProduct={selectedProduct} onImported={() => refetchProducts()} />
                    </div>
                  </div>
                </div>
    </>
  );
}
