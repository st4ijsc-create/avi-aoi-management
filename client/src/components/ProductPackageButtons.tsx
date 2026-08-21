import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { Download, Upload, Package, Loader2 } from "lucide-react";

/**
 * Doc 31 PM3 (C.4) — portable product package export / import (JSON).
 *
 * Export → downloads the selected product's full config as a JSON bundle.
 * Import → recreates a product from a bundle under a NEW code (backup / line
 * transfer). Self-contained so it can be dropped into the products page toolbar
 * without expanding the ProductModels monolith.
 */
export function ProductPackageButtons({
  selectedProduct,
  onImported,
}: {
  selectedProduct?: { id: number; code: string; name: string } | null;
  onImported?: (newProductId: number) => void;
}) {
  const { t } = useTranslation();
  const [importOpen, setImportOpen] = useState(false);
  const [pkg, setPkg] = useState<unknown | null>(null);
  const [pkgSummary, setPkgSummary] = useState<string>("");
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const exportMutation = trpc.productPackage.exportPackage.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const code = (data as any)?.model?.code ?? selectedProduct?.code ?? "product";
      a.download = `product-package_${code}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("products.package.exported"));
    },
    onError: (e) => toast.error(t("products.package.exportError", { message: mapTrpcError(e) })),
  });

  const importMutation = trpc.productPackage.importPackage.useMutation({
    onSuccess: (res) => {
      toast.success(
        t("products.package.imported", {
          code: res.code,
          points: res.counts.points,
          fiducials: res.counts.fiducials,
        }),
      );
      setImportOpen(false);
      setPkg(null);
      setPkgSummary("");
      setNewCode("");
      setNewName("");
      onImported?.(res.productModelId);
    },
    onError: (e) => toast.error(t("products.package.importError", { message: mapTrpcError(e) })),
  });

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      setPkg(parsed);
      const m = parsed?.model ?? {};
      const counts = {
        points: parsed?.points?.length ?? 0,
        fiducials: parsed?.fiducials?.length ?? 0,
        panels: parsed?.panelDefs?.length ?? 0,
        plans: parsed?.samplingPlans?.length ?? 0,
      };
      setPkgSummary(
        `${m.code ?? "?"} · ${counts.points} pts · ${counts.fiducials} fid · ${counts.panels} panel · ${counts.plans} plan`,
      );
      if (!newCode && typeof m.code === "string") setNewCode(`${m.code}_COPY`);
      if (!newName && typeof m.name === "string") setNewName(m.name);
    } catch (err: any) {
      toast.error(t("products.package.invalidFile", { message: mapTrpcError(err) }));
      setPkg(null);
      setPkgSummary("");
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1"
        disabled={!selectedProduct || exportMutation.isPending}
        onClick={() => selectedProduct && exportMutation.mutate({ productModelId: selectedProduct.id })}
        title={t("products.package.exportTooltip")}
      >
        {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t("products.package.export")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="gap-1"
        onClick={() => setImportOpen(true)}
        title={t("products.package.importTooltip")}
      >
        <Package className="h-4 w-4" />
        {t("products.package.import")}
      </Button>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t("products.package.importTitle")}
            </DialogTitle>
            <DialogDescription>{t("products.package.importDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>{t("products.package.file")}</Label>
              <Input ref={fileRef} type="file" accept="application/json,.json" onChange={handleFile} />
              {pkgSummary && <p className="text-xs text-muted-foreground font-mono">{pkgSummary}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkgNewCode">
                {t("products.package.newCode")}<span className="text-destructive">*</span>
              </Label>
              <Input
                id="pkgNewCode"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="PCB-XYZ-COPY"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkgNewName">{t("products.package.newName")}</Label>
              <Input id="pkgNewName" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!pkg || !newCode.trim() || importMutation.isPending}
              onClick={() =>
                importMutation.mutate({
                  package: pkg,
                  newCode: newCode.trim(),
                  newName: newName.trim() || undefined,
                })
              }
            >
              {importMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("products.package.importing")}</>
              ) : (
                <><Upload className="h-4 w-4 mr-2" />{t("products.package.import")}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
