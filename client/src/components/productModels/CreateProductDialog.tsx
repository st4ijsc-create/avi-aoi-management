/**
 * doc 48 R4 (tech-debt) — "Create Product Dialog" extracted VERBATIM from ProductModels.tsx.
 * PURE RELOCATION: the page still owns all state/queries/mutations/handlers and threads
 * them 1:1 as props (names unchanged); `t`/`user` are re-derived from hooks locally, as in
 * the sibling components/products/* dialogs. Identical JSX/handlers — no behavior change.
 */

import type { Dispatch, SetStateAction, ChangeEvent } from "react";
import { PermissionGate } from "@/components/PermissionGate";
import { ValidationMessage } from "@/components/ValidationMessage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useFormValidation } from "@/hooks/useFormValidation";
import { trpc } from "@/lib/trpc";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CreateProductDialogProps {
  createProductMutation: ReturnType<typeof trpc.productModel.create.useMutation>;
  handleCreateProduct: () => void;
  handleImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  isCreateDialogOpen: boolean;
  newProductCategory: string;
  newProductCode: string;
  newProductDescription: string;
  newProductDisplayMode: "contain" | "cover" | "stretch" | "none";
  newProductLifecycle: "development" | "active" | "eol" | "archived";
  newProductLine: string;
  newProductMinYield: string;
  newProductName: string;
  newProductRevision: string;
  newProductTargetYield: string;
  newProductVariant: string;
  productValidation: ReturnType<typeof useFormValidation<{ code: string; name: string; description: string }>>;
  setIsCreateDialogOpen: Dispatch<SetStateAction<boolean>>;
  setNewProductCategory: Dispatch<SetStateAction<string>>;
  setNewProductCode: Dispatch<SetStateAction<string>>;
  setNewProductDescription: Dispatch<SetStateAction<string>>;
  setNewProductDisplayMode: Dispatch<SetStateAction<"contain" | "cover" | "stretch" | "none">>;
  setNewProductLifecycle: Dispatch<SetStateAction<"development" | "active" | "eol" | "archived">>;
  setNewProductLine: Dispatch<SetStateAction<string>>;
  setNewProductMinYield: Dispatch<SetStateAction<string>>;
  setNewProductName: Dispatch<SetStateAction<string>>;
  setNewProductRevision: Dispatch<SetStateAction<string>>;
  setNewProductTargetYield: Dispatch<SetStateAction<string>>;
  setNewProductVariant: Dispatch<SetStateAction<string>>;
  uploadedImageUrl: string;
}

export function CreateProductDialog(props: CreateProductDialogProps) {
  const { t } = useTranslation();
  const {
    createProductMutation, handleCreateProduct, handleImageUpload, isCreateDialogOpen,
    newProductCategory, newProductCode, newProductDescription, newProductDisplayMode,
    newProductLifecycle, newProductLine, newProductMinYield, newProductName,
    newProductRevision, newProductTargetYield, newProductVariant, productValidation,
    setIsCreateDialogOpen, setNewProductCategory, setNewProductCode, setNewProductDescription,
    setNewProductDisplayMode, setNewProductLifecycle, setNewProductLine, setNewProductMinYield,
    setNewProductName, setNewProductRevision, setNewProductTargetYield, setNewProductVariant,
    uploadedImageUrl,
  } = props;
  return (
    <>
            <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
              <DialogTrigger asChild>
                <PermissionGate module="settings_products" action="canCreate">
                  <Button size="sm" className="gap-1">
                    <Plus className="h-4 w-4" />
                    {t("common.add")}
                  </Button>
                </PermissionGate>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>{t("products.createNew")}</DialogTitle>
                  <DialogDescription>{t("products.createNewDesc")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="productCode">{t("products.productCodeLabel")}<span className="text-destructive">*</span></Label>
                    <Input
                      id="productCode"
                      value={newProductCode}
                      onChange={(e) => setNewProductCode(e.target.value)}
                      onBlur={() => productValidation.handleBlur("code", newProductCode)}
                      placeholder={t('products.codeExample')}
                      className={productValidation.hasError("code") ? "border-destructive" : ""}
                    />
                    <ValidationMessage error={productValidation.getFieldError("code")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productName">{t("products.productNameLabel")}<span className="text-destructive">*</span></Label>
                    <Input
                      id="productName"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      onBlur={() => productValidation.handleBlur("name", newProductName)}
                      placeholder={t('products.nameExample')}
                      className={productValidation.hasError("name") ? "border-destructive" : ""}
                    />
                    <ValidationMessage error={productValidation.getFieldError("name")} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productDescription">{t("products.descriptionLabel")}</Label>
                    <Textarea
                      id="productDescription"
                      value={newProductDescription}
                      onChange={(e) => setNewProductDescription(e.target.value)}
                      placeholder={t("products.descriptionPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productRevision">{t("products.revision")}</Label>
                    <Input
                      id="productRevision"
                      value={newProductRevision}
                      onChange={(e) => setNewProductRevision(e.target.value)}
                      placeholder={t("products.revisionExample")}
                      maxLength={32}
                    />
                  </div>
                  {/* Doc 43 Đợt 4 (C) — bổ sung control cho các trường mutation đã nhận:
                      danh mục / dòng sản phẩm / biến thể / vòng đời (mặc định 'development'
                      → không kích cổng duyệt ngay sau tạo) / FPY mục tiêu · tối thiểu. */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="newProductCategory">{t("common.category")}</Label>
                      <Input
                        id="newProductCategory"
                        value={newProductCategory}
                        onChange={(e) => setNewProductCategory(e.target.value)}
                        placeholder={t("products.categoryPlaceholder")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newProductLine">{t("products.productLine")}</Label>
                      <Input
                        id="newProductLine"
                        value={newProductLine}
                        onChange={(e) => setNewProductLine(e.target.value)}
                        placeholder={t("products.linePlaceholder")}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="newProductVariant">{t("products.variant")}</Label>
                      <Input
                        id="newProductVariant"
                        value={newProductVariant}
                        onChange={(e) => setNewProductVariant(e.target.value)}
                        placeholder={t('products.variantExample')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newProductLifecycle">{t("common.status")}</Label>
                      <Select value={newProductLifecycle} onValueChange={(value: any) => setNewProductLifecycle(value)}>
                        <SelectTrigger id="newProductLifecycle">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="development">{t("products.development")}</SelectItem>
                          <SelectItem value="active">{t("products.activeStatus")}</SelectItem>
                          <SelectItem value="eol">{t("products.endOfLife")}</SelectItem>
                          <SelectItem value="archived">{t("products.archived")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-2">
                      <Label htmlFor="newProductTargetYield">{t("products.targetYieldLabel")}</Label>
                      <Input
                        id="newProductTargetYield"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={newProductTargetYield}
                        onChange={(e) => setNewProductTargetYield(e.target.value)}
                        placeholder="95.5"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="newProductMinYield">{t("products.minYieldLabel")}</Label>
                      <Input
                        id="newProductMinYield"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={newProductMinYield}
                        onChange={(e) => setNewProductMinYield(e.target.value)}
                        placeholder="85.0"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("products.imageDisplayModeLabel")}</Label>
                    <Select value={newProductDisplayMode} onValueChange={(value: any) => setNewProductDisplayMode(value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contain">{t("products.displayContain")}</SelectItem>
                        <SelectItem value="cover">{t("products.displayCover")}</SelectItem>
                        <SelectItem value="stretch">{t("products.displayStretch")}</SelectItem>
                        <SelectItem value="none">{t("products.displayNone")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productImage">{t("products.referenceImageLabel")}</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="productImage"
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="flex-1"
                      />
                    </div>
                    {uploadedImageUrl && (
                      <img
                        src={uploadedImageUrl}
                        alt="Preview"
                        className="mt-2 max-h-32 rounded border"
                      />
                    )}
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>{t("common.cancel")}</Button>
                  <Button onClick={handleCreateProduct} disabled={createProductMutation.isPending}>
                    {createProductMutation.isPending ? t("products.creating") : t("products.createProduct")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
    </>
  );
}
