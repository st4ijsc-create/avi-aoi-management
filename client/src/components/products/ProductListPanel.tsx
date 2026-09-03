/**
 * Khối C Task 14 (QĐ-4, spec §"Tách shell") — "Product List Panel": cột trái của
 * `ProductModels.tsx` (Card `lg:col-span-1`) — ô tìm kiếm, lọc vòng đời, sắp xếp,
 * chip lọc đang bật, `ImportExportBar`, `DataTable<ProductModel>` danh sách sản
 * phẩm. PURE RELOCATION — cùng khuôn `PointDetailsForm.tsx`/`CreateProductDialog.tsx`:
 * trang vẫn giữ TOÀN BỘ state/query/mutation/handler, chỉ truyền xuống 1:1 qua
 * props (tên giữ nguyên); `t` tự lấy lại qua hook cục bộ. Không đổi hành vi.
 *
 * ⚠ `CreateProductDialog` (nút "Thêm sản phẩm") MOUNT Ở ĐÂY, không phải ở
 * `ProductDialogsHost` — nó tự mang `DialogTrigger` (nút bấm nằm NGAY TRONG
 * component đó, xem `CreateProductDialog.tsx`), khác với 13 dialog kia (chỉ
 * điều khiển qua `open`/`onOpenChange`, không tự vẽ nút trigger — Radix
 * Dialog/AlertDialog PORTAL nội dung ra `document.body` nên vị trí JSX của
 * CHÚNG không ảnh hưởng hiển thị). Nếu `CreateProductDialog` bị dời sang
 * `ProductDialogsHost`, nút "Thêm sản phẩm" sẽ BIẾN MẤT khỏi header danh sách
 * — đó mới là đổi hành vi, nên nó ở lại đây (đúng vị trí cũ trong header Card).
 */

import type { ComponentProps, Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ImportExportBar, type ImportResultSummary } from "@/components/patterns";
import { PermissionGate, ViewOnlyBadge } from "@/components/PermissionGate";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CreateProductDialog } from "@/components/productModels/CreateProductDialog";
import { ProductReadinessBadge, type ReadinessData } from "@/components/products/ProductReadinessPanel";
import { PRODUCT_COLUMN_SPEC } from "@shared/productColumnSpec";
import type { MasterDataFormat } from "@shared/masterDataIO";
import { Package, X, MoreVertical, Edit, Copy, Trash2, Sparkles } from "lucide-react";
import { type RouterOutputs, type ProductModel } from "@/components/productModels/types";
import { useLocation } from "wouter";

/** Kiểu chính xác của `setLocation` trả về từ `useLocation()` (wouter) — suy
 *  từ hook thật thay vì đoán chữ ký, tránh lệch nếu thư viện đổi. */
type SetLocationFn = ReturnType<typeof useLocation>[1];

interface ProductListPanelProps extends ComponentProps<typeof CreateProductDialog> {
  selectedProduct: ProductModel | null;
  setSelectedProduct: Dispatch<SetStateAction<ProductModel | null>>;
  setIsEditMode: Dispatch<SetStateAction<boolean>>;
  resetPointForm: () => void;
  onboardingSearch: string;
  setLocation: SetLocationFn;
  productSearchQuery: string;
  setProductSearchQuery: Dispatch<SetStateAction<string>>;
  productLifecycleFilter: "all" | "development" | "active" | "eol" | "archived";
  setProductLifecycleFilter: Dispatch<SetStateAction<"all" | "development" | "active" | "eol" | "archived">>;
  productSortBy: "code" | "name" | "createdAt" | "updatedAt";
  setProductSortBy: Dispatch<SetStateAction<"code" | "name" | "createdAt" | "updatedAt">>;
  productSortOrder: "asc" | "desc";
  setProductSortOrder: Dispatch<SetStateAction<"asc" | "desc">>;
  productModels: RouterOutputs["productModel"]["list"] | undefined;
  readinessById: Map<number, ReadinessData>;
  canImportProducts: boolean;
  handleExportProducts: (format: MasterDataFormat) => void | Promise<void>;
  handleImportProducts: (rows: Array<Record<string, unknown>>) => Promise<ImportResultSummary>;
  setIsDeleteProductDialogOpen: Dispatch<SetStateAction<boolean>>;
  openEditProductDialog: (product?: ProductModel) => void;
  openCloneProductDialog: (product: ProductModel) => void;
}

export function ProductListPanel(props: ProductListPanelProps) {
  const { t } = useTranslation();
  const {
    selectedProduct, setSelectedProduct, setIsEditMode, resetPointForm,
    onboardingSearch, setLocation, productSearchQuery, setProductSearchQuery,
    productLifecycleFilter, setProductLifecycleFilter, productSortBy, setProductSortBy,
    productSortOrder, setProductSortOrder, productModels, readinessById,
    canImportProducts, handleExportProducts, handleImportProducts, setIsDeleteProductDialogOpen,
    openEditProductDialog, openCloneProductDialog,
    createProductMutation, handleCreateProduct, handleImageUpload,
    isCreateDialogOpen, newProductCategory, newProductCode,
    newProductDescription, newProductDisplayMode, newProductLifecycle,
    newProductLine, newProductMinYield, newProductName,
    newProductRevision, newProductTargetYield, newProductVariant,
    productValidation, setIsCreateDialogOpen, setNewProductCategory,
    setNewProductCode, setNewProductDescription, setNewProductDisplayMode,
    setNewProductLifecycle, setNewProductLine, setNewProductMinYield,
    setNewProductName, setNewProductRevision, setNewProductTargetYield,
    setNewProductVariant, uploadedImageUrl,
  } = props;

  return (
        <Card className="lg:col-span-1">
          {/* doc 46 B3 — flex-wrap + min-w-0 so the action buttons wrap below the
              title instead of overflowing this narrow (lg:col-span-1) column at
              ≤1600px; previously the "Add" CTA spilled past the card edge and was
              painted over by the adjacent col-span-3 detail card (unclickable). */}
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{t("products.productList")}</CardTitle>
                <ViewOnlyBadge module="settings_products" />
              </div>
              <CardDescription>{t("products.selectToManage")}</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            {/* Doc 31 UX1 (WD-1) — start the guided product setup wizard (the route
                is itself permission-guarded, so no extra write-action gate here). */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => setLocation("/product-onboarding")}
            >
              <Sparkles className="h-4 w-4" />
              {t("products.startGuidedSetup", "Guided setup")}
            </Button>
            <CreateProductDialog
              createProductMutation={createProductMutation} handleCreateProduct={handleCreateProduct} handleImageUpload={handleImageUpload}
              isCreateDialogOpen={isCreateDialogOpen} newProductCategory={newProductCategory} newProductCode={newProductCode}
              newProductDescription={newProductDescription} newProductDisplayMode={newProductDisplayMode} newProductLifecycle={newProductLifecycle}
              newProductLine={newProductLine} newProductMinYield={newProductMinYield} newProductName={newProductName}
              newProductRevision={newProductRevision} newProductTargetYield={newProductTargetYield} newProductVariant={newProductVariant}
              productValidation={productValidation} setIsCreateDialogOpen={setIsCreateDialogOpen} setNewProductCategory={setNewProductCategory}
              setNewProductCode={setNewProductCode} setNewProductDescription={setNewProductDescription} setNewProductDisplayMode={setNewProductDisplayMode}
              setNewProductLifecycle={setNewProductLifecycle} setNewProductLine={setNewProductLine} setNewProductMinYield={setNewProductMinYield}
              setNewProductName={setNewProductName} setNewProductRevision={setNewProductRevision} setNewProductTargetYield={setNewProductTargetYield}
              setNewProductVariant={setNewProductVariant} uploadedImageUrl={uploadedImageUrl}
            />
            </div>
          </CardHeader>
          <CardContent>
            {/* Search and Filter Controls */}
            <div className="space-y-3 mb-4">
              {/* Search Bar */}
              <div className="relative">
                <Input
                  placeholder={t("products.searchByCodeOrName")}
                  value={productSearchQuery}
                  onChange={(e) => setProductSearchQuery(e.target.value)}
                  className="pr-8"
                />
                {productSearchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setProductSearchQuery("")}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Filter and Sort Row */}
              <div className="flex gap-2">
                {/* Lifecycle Filter */}
                <Select value={productLifecycleFilter} onValueChange={(val: any) => setProductLifecycleFilter(val)}>
                  <SelectTrigger className="w-35">
                    <SelectValue placeholder={t("common.status")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("common.all")}</SelectItem>
                    <SelectItem value="development">{t("products.development")}</SelectItem>
                    <SelectItem value="active">{t("products.active")}</SelectItem>
                    <SelectItem value="eol">EOL</SelectItem>
                    <SelectItem value="archived">{t("products.archived")}</SelectItem>
                  </SelectContent>
                </Select>

                {/* Sort Dropdown */}
                <Select value={`${productSortBy}-${productSortOrder}`} onValueChange={(val) => {
                  const [sortBy, sortOrder] = val.split("-") as [typeof productSortBy, typeof productSortOrder];
                  setProductSortBy(sortBy);
                  setProductSortOrder(sortOrder);
                }}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("products.sortPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="createdAt-desc">{t("products.newestFirst")}</SelectItem>
                    <SelectItem value="createdAt-asc">{t("products.oldestFirst")}</SelectItem>
                    <SelectItem value="name-asc">{t("products.nameAZ")}</SelectItem>
                    <SelectItem value="name-desc">{t("products.nameZA")}</SelectItem>
                    <SelectItem value="code-asc">{t("products.codeAZ")}</SelectItem>
                    <SelectItem value="code-desc">{t("products.codeZA")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Active Filters Badge */}
              {(productSearchQuery || productLifecycleFilter !== "all") && (
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary" className="gap-1">
                    {t("common.filtered")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      setProductSearchQuery("");
                      setProductLifecycleFilter("all");
                    }}
                  >
                    {t("history.clearFilters")}
                  </Button>
                </div>
              )}
            </div>

            {/* Doc 42 Đợt 4A (APPLY-B) — nhập/xuất danh sách sản phẩm. Xuất/Tải mẫu cho
                mọi người; "Nhập" chỉ hiện khi có quyền tạo (onImport = undefined nếu không). */}
            <div className="mb-4">
              <ImportExportBar
                entityLabel={t("products.entityLabel", "sản phẩm")}
                fileBaseName="san_pham"
                columns={[...PRODUCT_COLUMN_SPEC]}
                onExport={handleExportProducts}
                onImport={canImportProducts ? handleImportProducts : undefined}
              />
            </div>

            {/* Doc 42 Đợt 2 (D2) — danh sách sản phẩm dùng DataTable: skeleton khi tải,
                phân trang, empty-state có CTA. Search/lọc/sắp xếp vẫn do controls phía
                trên điều khiển server-side (query productModel.list). */}
            <DataTable<ProductModel>
              data={(productModels ?? []) as unknown as ProductModel[]}
              getRowId={(p) => p.id}
              loading={productModels === undefined}
              paginated
              pageSize={8}
              onRowClick={(product) => {
                setSelectedProduct(product);
                setIsEditMode(false);
                resetPointForm();
                // Doc 43 Đợt 3 — ghi ?product= (giữ tab hiện tại) để reload giữ nguyên
                // sản phẩm + tab. Preselect chỉ auto-chọn 1 lần nên không gây vòng lặp.
                const params = new URLSearchParams(onboardingSearch);
                params.set("product", String(product.id));
                setLocation(`/products?${params.toString()}`, { replace: true });
              }}
              emptyState={
                productSearchQuery || productLifecycleFilter !== "all" ? (
                  <EmptyState
                    variant="no-results"
                    compact
                    title={t("products.noMatchingProducts", "Không có sản phẩm khớp")}
                    description={t("products.tryDifferentSearch", "Thử đổi từ khoá hoặc bộ lọc.")}
                  />
                ) : (
                  <EmptyState
                    variant="no-data"
                    compact
                    title={t("products.noProductsYet")}
                    description={t("products.clickAddToCreate")}
                    actionLabel={t("common.add")}
                    onAction={() => setIsCreateDialogOpen(true)}
                  />
                )
              }
              columns={[
                {
                  id: "product",
                  header: t("products.product", "Sản phẩm"),
                  cell: (product) => {
                    const isSelected = selectedProduct?.id === product.id;
                    const updatedAt = (product as { updatedAt?: string | Date | null }).updatedAt;
                    return (
                      <div
                        className={`flex items-start gap-3 -mx-1 rounded-md px-2 py-1 ${
                          isSelected ? "bg-primary/5" : ""
                        }`}
                      >
                        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                          <Package className="h-5 w-5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{product.name}</p>
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm text-muted-foreground truncate">{product.code}</p>
                            {product.revision && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                                {t("products.revShort")} {product.revision}
                              </Badge>
                            )}
                          </div>
                          {/* Doc 31 UX2/PM9 — config-completeness badge (batched, no N+1) */}
                          <div className="mt-1">
                            <ProductReadinessBadge readiness={readinessById.get(product.id)} />
                          </div>
                          {updatedAt && (
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {t("common.updated", "Cập nhật")}: {new Date(updatedAt).toLocaleDateString("vi-VN")}
                            </p>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={(e) => {
                              e.stopPropagation();
                              setSelectedProduct(product);
                              openEditProductDialog(product as unknown as ProductModel);
                            }}>
                              <Edit className="h-4 w-4 mr-2" />
                              {t("common.edit")}
                            </DropdownMenuItem>
                            <PermissionGate module="settings_products" action="canCreate">
                              <DropdownMenuItem onClick={(e) => {
                                e.stopPropagation();
                                openCloneProductDialog(product as unknown as ProductModel);
                              }}>
                                <Copy className="h-4 w-4 mr-2" />
                                {t("products.clone")}
                              </DropdownMenuItem>
                            </PermissionGate>
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedProduct(product);
                                setIsDeleteProductDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {t("common.delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  },
                },
              ]}
            />
          </CardContent>
        </Card>
  );
}
