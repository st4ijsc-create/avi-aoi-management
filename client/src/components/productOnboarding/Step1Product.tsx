// WD-1 (doc 31 Đợt D · UX1) — Step 1: create OR select the product to configure.
// REUSES the existing productModel.create mutation (dims auto-extracted +
// enforced server-side per WC-3/PM8) and productModel.list. This is the only
// step that mutates the product master directly; every later step orchestrates
// an existing surface.
import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Plus, Upload } from "lucide-react";

interface Props {
  productModelId: number | null;
  onProductChosen: (id: number, code: string) => void;
}

export function Step1Product({ productModelId, onProductChosen }: Props) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { data: products } = trpc.productModel.list.useQuery({});

  const [mode, setMode] = useState<"select" | "create">(productModelId ? "select" : "create");

  // ── Create form ───────────────────────────────────────────────────────────
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [targetYield, setTargetYield] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  const createMut = trpc.productModel.create.useMutation({
    onSuccess: async (res) => {
      toast.success(t("productOnboarding.step1.created", "Product created"));
      await utils.productModel.list.invalidate();
      onProductChosen(res.id, code.trim());
    },
    onError: (e) => toastTrpcError(e),
  });

  const onPickImage = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const submitCreate = () => {
    if (!code.trim() || !name.trim()) {
      toast.error(t("productOnboarding.step1.codeNameRequired", "Code and name are required"));
      return;
    }
    createMut.mutate({
      code: code.trim(),
      name: name.trim(),
      category: category.trim() || undefined,
      lifecycleStatus: "development", // new products start in development (PM12)
      targetYieldRate: targetYield.trim() || undefined,
      referenceImageUrl: imageDataUrl || undefined, // server extracts + enforces dims
    });
  };

  const selected = useMemo(
    () => (products ?? []).find((p: any) => p.id === productModelId),
    [products, productModelId],
  );

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === "select" ? "default" : "outline"}
          onClick={() => setMode("select")}
        >
          {t("productOnboarding.step1.chooseExisting", "Configure an existing product")}
        </Button>
        <Button
          size="sm"
          variant={mode === "create" ? "default" : "outline"}
          onClick={() => setMode("create")}
          className="gap-1"
        >
          <Plus className="h-4 w-4" />
          {t("productOnboarding.step1.createNew", "Create a new product")}
        </Button>
      </div>

      {mode === "select" ? (
        <div className="space-y-3">
          <Label>{t("productOnboarding.step1.selectLabel", "Product")}</Label>
          <Select
            value={productModelId ? String(productModelId) : undefined}
            onValueChange={(v) => {
              const p = (products ?? []).find((x: any) => String(x.id) === v);
              if (p) onProductChosen(p.id, p.code);
            }}
          >
            <SelectTrigger className="max-w-md">
              <SelectValue placeholder={t("productOnboarding.step1.selectPlaceholder", "Select a product to configure")} />
            </SelectTrigger>
            <SelectContent>
              {(products ?? []).map((p: any) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.code} — {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <div className="flex items-center gap-2 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" />
              {t("productOnboarding.step1.selectedProduct", "Configuring")}: <strong>{selected.code}</strong>
              <Badge variant="outline">{selected.lifecycleStatus ?? "—"}</Badge>
              {!(selected.imageWidth && selected.imageHeight) && (
                <Badge variant="destructive">
                  {t("productOnboarding.step1.noDims", "No image dimensions")}
                </Badge>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4 max-w-xl">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>{t("productOnboarding.step1.code", "Code")} *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="BOARD-A" />
            </div>
            <div className="space-y-1">
              <Label>{t("productOnboarding.step1.name", "Name")} *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("productOnboarding.step1.category", "Category")}</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t("productOnboarding.step1.targetYield", "Target yield %")}</Label>
              <Input value={targetYield} onChange={(e) => setTargetYield(e.target.value)} placeholder="99.0" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("productOnboarding.step1.image", "Reference image")}</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => onPickImage(e.target.files?.[0])}
            />
            <div className="flex items-center gap-3">
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1">
                <Upload className="h-4 w-4" />
                {t("productOnboarding.step1.uploadImage", "Upload image")}
              </Button>
              {imageDataUrl && (
                <img src={imageDataUrl} alt="preview" className="h-12 rounded border object-contain" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "productOnboarding.step1.dimsHint",
                "Image dimensions are auto-detected and enforced so point coordinates are portable between machines.",
              )}
            </p>
          </div>
          <div>
            <Button onClick={submitCreate} disabled={createMut.isPending} className="gap-1">
              <Plus className="h-4 w-4" />
              {createMut.isPending
                ? t("productOnboarding.step1.creating", "Creating…")
                : t("productOnboarding.step1.createProduct", "Create & continue")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default Step1Product;
