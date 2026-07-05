// Doc 31 UX4 (WE-3) — extracted VERBATIM from ProductModels.tsx (the "Clone Product
// Dialog", PM1/PM2 · WC-2). Pure move: same JSX/bindings/i18n; state stays owned by
// the parent and is threaded through props (no behavior/styling change).
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface CloneProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceProduct: { code: string } | null;
  newCode: string;
  setNewCode: (v: string) => void;
  newName: string;
  setNewName: (v: string) => void;
  newRevision: string;
  setNewRevision: (v: string) => void;
  copyMappings: boolean;
  setCopyMappings: (v: boolean) => void;
  onClone: () => void;
  isCloning: boolean;
}

export function CloneProductDialog(props: CloneProductDialogProps) {
  const { t } = useTranslation();
  const {
    open, onOpenChange, sourceProduct,
    newCode, setNewCode, newName, setNewName,
    newRevision, setNewRevision, copyMappings, setCopyMappings,
    onClone, isCloning,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("products.cloneTitle")}</DialogTitle>
          <DialogDescription>
            {sourceProduct
              ? t("products.cloneDesc", { code: sourceProduct.code })
              : t("products.cloneDescGeneric")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="cloneNewCode">{t("products.productCodeLabel")}<span className="text-destructive">*</span></Label>
            <Input
              id="cloneNewCode"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder={t("products.codeExample")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cloneNewName">{t("products.productNameLabel")}</Label>
            <Input
              id="cloneNewName"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("products.nameExample")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cloneNewRevision">{t("products.revision")}</Label>
            <Input
              id="cloneNewRevision"
              value={newRevision}
              onChange={(e) => setNewRevision(e.target.value)}
              placeholder={t("products.revisionExample")}
              maxLength={32}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="cloneCopyMappings"
              checked={copyMappings}
              onCheckedChange={(v) => setCopyMappings(v === true)}
            />
            <div className="grid gap-0.5 leading-none">
              <Label htmlFor="cloneCopyMappings" className="cursor-pointer">{t("products.cloneCopyMappings")}</Label>
              <p className="text-xs text-muted-foreground">{t("products.cloneCopyMappingsHint")}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("products.cloneScopeNote")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={onClone} disabled={isCloning}>
            {isCloning ? t("products.cloning") : t("products.clone")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
