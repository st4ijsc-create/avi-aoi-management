// Doc 31 UX4 (WE-3) — extracted VERBATIM from ProductModels.tsx (the "Edit Product
// Dialog"). Pure move: same JSX/bindings/i18n; state stays owned by the parent and
// is threaded through props (no behavior/styling change).
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Lifecycle = "development" | "active" | "eol" | "archived";
type DisplayMode = "contain" | "cover" | "stretch" | "none";

interface EditProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  code: string;
  setCode: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  line: string;
  setLine: (v: string) => void;
  variant: string;
  setVariant: (v: string) => void;
  lifecycle: Lifecycle;
  setLifecycle: (v: Lifecycle) => void;
  revision: string;
  setRevision: (v: string) => void;
  targetYield: string;
  setTargetYield: (v: string) => void;
  minYield: string;
  setMinYield: (v: string) => void;
  displayMode: DisplayMode;
  setDisplayMode: (v: DisplayMode) => void;
  imageUrl: string;
  currentImageUrl?: string | null;
  onImageUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  onSave: () => void;
  isSaving: boolean;
}

export function EditProductDialog(props: EditProductDialogProps) {
  const { t } = useTranslation();
  const {
    open, onOpenChange,
    code, setCode, name, setName, description, setDescription,
    category, setCategory, line, setLine, variant, setVariant,
    lifecycle, setLifecycle, revision, setRevision,
    targetYield, setTargetYield, minYield, setMinYield,
    displayMode, setDisplayMode, imageUrl, currentImageUrl,
    onImageUpload, onSave, isSaving,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("products.editTitle")}</DialogTitle>
          <DialogDescription>{t("products.editDesc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="editProductCode">{t("products.productCodeLabel")}</Label>
            <Input
              id="editProductCode"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editProductName">{t("products.productNameLabel")}</Label>
            <Input
              id="editProductName"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="editProductDescription">{t("products.descriptionLabel")}</Label>
            <Textarea
              id="editProductDescription"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="editProductCategory">{t("common.category")}</Label>
              <Input
                id="editProductCategory"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t("products.categoryPlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductLine">{t("products.productLine")}</Label>
              <Input
                id="editProductLine"
                value={line}
                onChange={(e) => setLine(e.target.value)}
                placeholder={t("products.linePlaceholder")}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="editProductVariant">{t("products.variant")}</Label>
              <Input
                id="editProductVariant"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                placeholder={t('products.variantExample')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductLifecycle">{t("common.status")}</Label>
              <Select value={lifecycle} onValueChange={(value: any) => setLifecycle(value)}>
                <SelectTrigger id="editProductLifecycle">
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
          <div className="space-y-2">
            <Label htmlFor="editProductRevision">{t("products.revision")}</Label>
            <Input
              id="editProductRevision"
              value={revision}
              onChange={(e) => setRevision(e.target.value)}
              placeholder={t("products.revisionExample")}
              maxLength={32}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label htmlFor="editProductTargetYield">{t("products.targetYieldLabel")}</Label>
              <Input
                id="editProductTargetYield"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={targetYield}
                onChange={(e) => setTargetYield(e.target.value)}
                placeholder="95.5"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editProductMinYield">{t("products.minYieldLabel")}</Label>
              <Input
                id="editProductMinYield"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={minYield}
                onChange={(e) => setMinYield(e.target.value)}
                placeholder="85.0"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("products.imageDisplayModeLabel")}</Label>
            <Select value={displayMode} onValueChange={(value: any) => setDisplayMode(value)}>
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
            <Label htmlFor="editProductImage">{t("products.newReferenceImage")}</Label>
            <Input
              id="editProductImage"
              type="file"
              accept="image/*"
              onChange={onImageUpload}
            />
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Preview"
                className="mt-2 max-h-32 rounded border"
              />
            )}
            {!imageUrl && currentImageUrl && (
              <div className="mt-2">
                <p className="text-sm text-muted-foreground mb-1">{t("products.currentImage")}:</p>
                <img
                  src={currentImageUrl}
                  alt="Current"
                  className="max-h-32 rounded border"
                />
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={onSave} disabled={isSaving}>
            {isSaving ? t("products.saving") : t("products.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
