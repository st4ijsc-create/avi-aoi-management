/**
 * doc 55 Item 3 / PV3-UI — PRODUCT VARIANT master-data admin (frontend).
 *
 * Rendered as the "Variants" (Biến thể) detail tab of ProductModels. Lets an engineer
 * author per-model variants and, for a NON-BASE variant, express how it diverges from the
 * base/common point set: EXCLUDE a base point or OVERRIDE its limits (QĐ#11). All writes go
 * through the tRPC `variant` router (productVariantRouter), which is master-data admin and
 * NOT gated behind PRODUCT_VARIANT_ENABLED — the flag only governs whether the fleet *sees*
 * variants, so authoring is always available (see router header).
 *
 * ── Scope / deferred ──────────────────────────────────────────────────────────
 * Adding a VARIANT-ONLY point (a brand-new measurement point that exists only for one
 * variant, QĐ#11 "điểm thêm = hàng variantId") is intentionally DEFERRED here: it needs a
 * variant-scoped measurementPoint.create mutation the PV3 router does not expose. This tab
 * covers create/edit/delete of variants + exclude/override of base points; variant-only
 * points already render read-only when present so the effective set is honest.
 *
 * ── Migration guard ───────────────────────────────────────────────────────────
 * The tables land in migration 0286; the router returns PRECONDITION_FAILED when it is not
 * yet applied. We surface that as a friendly notice instead of a raw error toast.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useCanWrite } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DataTable, type DataTableColumn } from "@/components/DataTable";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, Edit, Trash2, Layers, AlertTriangle, EyeOff, SlidersHorizontal, RotateCcw } from "lucide-react";

type LifecycleStatus = "active" | "eol" | "archived";

interface VariantRow {
  id: number;
  productModelId: number;
  code: string;
  name: string | null;
  isBase: boolean;
  pointsConfigVersion: number;
  referenceImageUrl: string | null;
  lifecycleStatus: string | null;
}

interface EffectivePoint {
  id: number;
  code: string;
  name: string;
  measurementType?: string | null;
  unit?: string | null;
  lowerLimit?: string | null;
  upperLimit?: string | null;
  nominalValue?: string | null;
  variantId?: number | null;
  origin: "base" | "variant" | "overridden";
}

interface OverrideRow {
  id: number;
  variantId: number;
  basePointDefId: number;
  action: "exclude" | "override";
  patchJson: Record<string, unknown> | null;
}

/** Detect the "migration 0286 not applied" precondition the router raises. */
function isMigrationNeeded(err: unknown): boolean {
  const e = err as { data?: { code?: string }; message?: string } | null;
  if (!e) return false;
  return e.data?.code === "PRECONDITION_FAILED" || /\b0286\b/.test(e.message ?? "");
}

/** Compact threshold summary for a point/patch (range → nominal → dash). */
function thresholdOf(lower?: string | null, upper?: string | null, nominal?: string | null, unit?: string | null): string {
  const u = unit ? ` ${unit}` : "";
  if (lower || upper) return `${lower ?? "−∞"} … ${upper ?? "+∞"}${u}`;
  if (nominal) return `${nominal}${u}`;
  return "—";
}

export interface ProductVariantsTabProps {
  productModelId: number;
  productName?: string;
}

export function ProductVariantsTab({ productModelId, productName }: ProductVariantsTabProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { canCreate, canEdit, canDelete } = useCanWrite("settings_products");
  // Point overrides edit what a variant *measures* ⇒ measurement-point permission (mirrors server).
  const { canEdit: canEditPoints } = useCanWrite("settings_measurement_points");

  const [selectedVariantId, setSelectedVariantId] = useState<number | null>(null);

  // ── variant list ──
  const variantsQuery = trpc.variant.listVariants.useQuery(
    { productModelId },
    { enabled: productModelId > 0, retry: false },
  );
  const variants = (variantsQuery.data ?? []) as VariantRow[];
  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? null;

  // ── selected variant detail (overrides + effective count) ──
  const variantDetailQuery = trpc.variant.getVariant.useQuery(
    { variantId: selectedVariantId ?? 0 },
    { enabled: !!selectedVariantId, retry: false },
  );
  const overrides = (variantDetailQuery.data?.overrides ?? []) as OverrideRow[];
  const overrideByBaseId = useMemo(() => {
    const m = new Map<number, OverrideRow>();
    for (const o of overrides) m.set(o.basePointDefId, o);
    return m;
  }, [overrides]);

  // Base/common point set (variantId null) — the rows an author can exclude/override.
  const basePointsQuery = trpc.variant.getEffectivePoints.useQuery(
    { productModelId, variantId: null },
    { enabled: !!selectedVariant && !selectedVariant.isBase, retry: false },
  );
  const basePoints = (basePointsQuery.data?.points ?? []) as EffectivePoint[];

  // Effective set for the selected variant (base-inherited + overridden + variant-only).
  const effectiveQuery = trpc.variant.getEffectivePoints.useQuery(
    { productModelId, variantId: selectedVariantId ?? 0 },
    { enabled: !!selectedVariantId, retry: false },
  );
  const effectivePoints = (effectiveQuery.data?.points ?? []) as EffectivePoint[];
  const variantOnlyPoints = effectivePoints.filter((p) => p.origin === "variant");

  // ── create / edit dialog ──
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<VariantRow | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formImageUrl, setFormImageUrl] = useState("");
  const [formLifecycle, setFormLifecycle] = useState<LifecycleStatus>("active");

  const openCreate = () => {
    setEditing(null);
    setFormCode("");
    setFormName("");
    setFormImageUrl("");
    setFormLifecycle("active");
    setFormOpen(true);
  };
  const openEdit = (v: VariantRow) => {
    setEditing(v);
    setFormCode(v.code);
    setFormName(v.name ?? "");
    setFormImageUrl(v.referenceImageUrl ?? "");
    setFormLifecycle((v.lifecycleStatus as LifecycleStatus) ?? "active");
    setFormOpen(true);
  };

  const invalidateAll = () => {
    utils.variant.listVariants.invalidate({ productModelId });
    if (selectedVariantId) {
      utils.variant.getVariant.invalidate({ variantId: selectedVariantId });
      utils.variant.getEffectivePoints.invalidate({ productModelId, variantId: selectedVariantId });
    }
    utils.variant.getEffectivePoints.invalidate({ productModelId, variantId: null });
  };

  const createMutation = trpc.variant.createVariant.useMutation({
    onSuccess: () => { toast.success(t("products.variants.createSuccess")); setFormOpen(false); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });
  const updateMutation = trpc.variant.updateVariant.useMutation({
    onSuccess: () => { toast.success(t("products.variants.updateSuccess")); setFormOpen(false); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });
  const deleteMutation = trpc.variant.deleteVariant.useMutation({
    onSuccess: () => {
      toast.success(t("products.variants.deleteSuccess"));
      if (pendingDelete && pendingDelete.id === selectedVariantId) setSelectedVariantId(null);
      setPendingDelete(null);
      invalidateAll();
    },
    onError: (e) => { toastTrpcError(e); setPendingDelete(null); },
  });

  const submitForm = () => {
    const code = formCode.trim();
    if (!editing && !code) { toast.error(t("products.variants.codeRequired")); return; }
    const name = formName.trim() || undefined;
    const referenceImageUrl = formImageUrl.trim() || undefined;
    if (editing) {
      updateMutation.mutate({
        variantId: editing.id,
        // The base variant's code is immutable server-side; only send code for non-base.
        ...(editing.isBase ? {} : { code }),
        name,
        referenceImageUrl,
        lifecycleStatus: formLifecycle,
      });
    } else {
      createMutation.mutate({ productModelId, code, name, referenceImageUrl, lifecycleStatus: formLifecycle });
    }
  };

  const [pendingDelete, setPendingDelete] = useState<VariantRow | null>(null);

  // ── override dialog ──
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<EffectivePoint | null>(null);
  const [ovLower, setOvLower] = useState("");
  const [ovUpper, setOvUpper] = useState("");
  const [ovNominal, setOvNominal] = useState("");

  const setOverrideMutation = trpc.variant.setOverride.useMutation({
    onSuccess: () => { toast.success(t("products.variants.overrideSuccess")); setOverrideOpen(false); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });
  const removeOverrideMutation = trpc.variant.removeOverride.useMutation({
    onSuccess: () => { toast.success(t("products.variants.removeOverrideSuccess")); invalidateAll(); },
    onError: (e) => toastTrpcError(e),
  });

  const openOverride = (bp: EffectivePoint) => {
    setOverrideTarget(bp);
    const existing = overrideByBaseId.get(bp.id);
    const patch = existing?.action === "override" ? (existing.patchJson ?? {}) : {};
    setOvLower(String((patch as any).lowerLimit ?? ""));
    setOvUpper(String((patch as any).upperLimit ?? ""));
    setOvNominal(String((patch as any).nominalValue ?? ""));
    setOverrideOpen(true);
  };
  const submitOverride = () => {
    if (!selectedVariantId || !overrideTarget) return;
    const patchJson: Record<string, unknown> = {};
    if (ovLower.trim()) patchJson.lowerLimit = ovLower.trim();
    if (ovUpper.trim()) patchJson.upperLimit = ovUpper.trim();
    if (ovNominal.trim()) patchJson.nominalValue = ovNominal.trim();
    if (Object.keys(patchJson).length === 0) { toast.error(t("products.variants.overrideEmpty")); return; }
    setOverrideMutation.mutate({
      variantId: selectedVariantId,
      basePointDefId: overrideTarget.id,
      action: "override",
      patchJson,
    });
  };
  const excludePoint = (bp: EffectivePoint) => {
    if (!selectedVariantId) return;
    setOverrideMutation.mutate({ variantId: selectedVariantId, basePointDefId: bp.id, action: "exclude" });
  };
  const restorePoint = (basePointDefId: number) => {
    if (!selectedVariantId) return;
    removeOverrideMutation.mutate({ variantId: selectedVariantId, basePointDefId });
  };

  // ── migration-not-applied guard ──
  if (variantsQuery.isError && isMigrationNeeded(variantsQuery.error)) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{t("products.variants.migrationNeededTitle")}</AlertTitle>
        <AlertDescription>{t("products.variants.migrationNeededDesc")}</AlertDescription>
      </Alert>
    );
  }

  // ── variant list columns ──
  const columns: DataTableColumn<VariantRow>[] = [
    {
      id: "code",
      header: t("products.variants.code"),
      cell: (v) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{v.code}</span>
          {v.isBase && <Badge variant="secondary">{t("products.variants.baseBadge")}</Badge>}
        </span>
      ),
      sortValue: (v) => v.code,
      filterValue: (v) => v.code,
      alwaysVisible: true,
    },
    {
      id: "name",
      header: t("products.variants.name"),
      cell: (v) => v.name || "—",
      sortValue: (v) => v.name ?? "",
      filterValue: (v) => v.name ?? "",
    },
    {
      id: "lifecycle",
      header: t("products.variants.lifecycle"),
      cell: (v) => t(`products.variants.lifecycle_${v.lifecycleStatus ?? "active"}`, v.lifecycleStatus ?? "active"),
      sortValue: (v) => v.lifecycleStatus ?? "",
    },
    {
      id: "version",
      header: t("products.variants.version"),
      cell: (v) => `v${v.pointsConfigVersion}`,
      sortValue: (v) => v.pointsConfigVersion,
      align: "right",
    },
    {
      id: "actions",
      header: t("products.variants.actions"),
      align: "right",
      cell: (v) => (
        <span className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <Button size="icon" variant="ghost" title={t("common.edit")} onClick={() => openEdit(v)}>
              <Edit className="h-4 w-4" />
            </Button>
          )}
          {canDelete && !v.isBase && (
            <Button
              size="icon"
              variant="ghost"
              title={t("common.delete")}
              onClick={() => setPendingDelete(v)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </span>
      ),
    },
  ];

  const originBadge = (origin: EffectivePoint["origin"]) => {
    switch (origin) {
      case "overridden":
        return <Badge variant="default">{t("products.variants.originOverridden")}</Badge>;
      case "variant":
        return <Badge variant="outline">{t("products.variants.originVariant")}</Badge>;
      default:
        return <Badge variant="secondary">{t("products.variants.originBase")}</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Layers className="h-4 w-4" />
            {t("products.variants.title")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("products.variants.desc")}</p>
        </div>
        {canCreate && (
          <Button size="sm" className="gap-1" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            {t("products.variants.addButton")}
          </Button>
        )}
      </div>

      <DataTable<VariantRow>
        data={variants}
        columns={columns}
        getRowId={(v) => v.id}
        loading={variantsQuery.isLoading}
        onRowClick={(v) => setSelectedVariantId(v.id)}
        paginated={false}
        emptyState={
          <div className="py-8 text-center text-sm text-muted-foreground">
            {t("products.variants.empty")}
          </div>
        }
      />

      {/* ── effective-points viewer for the selected variant ── */}
      {selectedVariant ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {t("products.variants.effectiveTitle", { code: selectedVariant.code })}
            </CardTitle>
            <CardDescription>
              {t("products.variants.effectiveCount", {
                count: variantDetailQuery.data?.effectivePointCount ?? effectivePoints.length,
              })}
              {selectedVariant.isBase && ` — ${t("products.variants.baseVariantHint")}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {variantDetailQuery.isLoading || effectiveQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : selectedVariant.isBase ? (
              // Base variant: its points ARE the common set — read-only.
              <PointTable
                points={effectivePoints}
                originBadge={originBadge}
                emptyLabel={t("products.variants.noBasePoints")}
                t={t}
              />
            ) : (
              <div className="space-y-4">
                {basePoints.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("products.variants.noBasePoints")}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("products.variants.pointColumn")}</TableHead>
                          <TableHead>{t("products.variants.typeColumn")}</TableHead>
                          <TableHead>{t("products.variants.thresholdColumn")}</TableHead>
                          <TableHead>{t("products.variants.originColumn")}</TableHead>
                          <TableHead className="text-right">{t("products.variants.actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {basePoints.map((bp) => {
                          const ov = overrideByBaseId.get(bp.id);
                          const excluded = ov?.action === "exclude";
                          const overridden = ov?.action === "override";
                          const patch = (overridden ? ov?.patchJson : null) as any;
                          const threshold = overridden
                            ? thresholdOf(
                                patch?.lowerLimit ?? bp.lowerLimit,
                                patch?.upperLimit ?? bp.upperLimit,
                                patch?.nominalValue ?? bp.nominalValue,
                                bp.unit,
                              )
                            : thresholdOf(bp.lowerLimit, bp.upperLimit, bp.nominalValue, bp.unit);
                          return (
                            <TableRow key={bp.id} className={excluded ? "opacity-50" : undefined}>
                              <TableCell>
                                <span className="font-medium">{bp.code}</span>
                                <span className="text-muted-foreground"> — {bp.name}</span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {bp.measurementType ?? "—"}
                              </TableCell>
                              <TableCell className="text-xs tabular-nums">{threshold}</TableCell>
                              <TableCell>
                                {excluded ? (
                                  <Badge variant="destructive">{t("products.variants.originExcluded")}</Badge>
                                ) : overridden ? (
                                  <Badge variant="default">{t("products.variants.originOverridden")}</Badge>
                                ) : (
                                  <Badge variant="secondary">{t("products.variants.originBase")}</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {canEditPoints ? (
                                  <span className="flex justify-end gap-1">
                                    {excluded || overridden ? (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title={t("products.variants.restoreAction")}
                                        onClick={() => restorePoint(bp.id)}
                                      >
                                        <RotateCcw className="h-4 w-4" />
                                      </Button>
                                    ) : null}
                                    {!excluded && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title={t("products.variants.overrideAction")}
                                        onClick={() => openOverride(bp)}
                                      >
                                        <SlidersHorizontal className="h-4 w-4" />
                                      </Button>
                                    )}
                                    {!excluded && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        title={t("products.variants.excludeAction")}
                                        onClick={() => excludePoint(bp)}
                                      >
                                        <EyeOff className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* variant-only points (read-only; adding them is deferred — see header) */}
                {variantOnlyPoints.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">
                      {t("products.variants.originVariant")}
                    </p>
                    <PointTable
                      points={variantOnlyPoints}
                      originBadge={originBadge}
                      emptyLabel=""
                      t={t}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {t("products.variants.addVariantPointDeferred")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">{t("products.variants.selectVariant")}</p>
      )}

      {/* ── create / edit dialog ── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? t("products.variants.editTitle") : t("products.variants.createTitle")}
              {productName ? ` — ${productName}` : ""}
            </DialogTitle>
            <DialogDescription>{t("products.variants.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="variant-code">{t("products.variants.code")}</Label>
              <Input
                id="variant-code"
                value={formCode}
                onChange={(e) => setFormCode(e.target.value)}
                placeholder={t("products.variants.codePlaceholder")}
                disabled={!!editing?.isBase}
              />
              <p className="text-xs text-muted-foreground">{t("products.variants.codeHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="variant-name">{t("products.variants.name")}</Label>
              <Input
                id="variant-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={t("products.variants.namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="variant-image">{t("products.variants.referenceImage")}</Label>
              <Input
                id="variant-image"
                value={formImageUrl}
                onChange={(e) => setFormImageUrl(e.target.value)}
                placeholder="https://…"
              />
              <p className="text-xs text-muted-foreground">{t("products.variants.referenceImageHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label>{t("products.variants.lifecycle")}</Label>
              <Select value={formLifecycle} onValueChange={(v) => setFormLifecycle(v as LifecycleStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t("products.variants.lifecycle_active")}</SelectItem>
                  <SelectItem value="eol">{t("products.variants.lifecycle_eol")}</SelectItem>
                  <SelectItem value="archived">{t("products.variants.lifecycle_archived")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitForm} disabled={createMutation.isPending || updateMutation.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── override dialog ── */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("products.variants.overrideTitle", { code: overrideTarget?.code ?? "" })}
            </DialogTitle>
            <DialogDescription>{t("products.variants.overrideDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ov-lower">{t("products.variants.lowerLimit")}</Label>
              <Input id="ov-lower" value={ovLower} onChange={(e) => setOvLower(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ov-nominal">{t("products.variants.nominalValue")}</Label>
              <Input id="ov-nominal" value={ovNominal} onChange={(e) => setOvNominal(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ov-upper">{t("products.variants.upperLimit")}</Label>
              <Input id="ov-upper" value={ovUpper} onChange={(e) => setOvUpper(e.target.value)} inputMode="decimal" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submitOverride} disabled={setOverrideMutation.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ── */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("products.variants.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("products.variants.deleteConfirmDesc", { code: pendingDelete?.code ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingDelete && deleteMutation.mutate({ variantId: pendingDelete.id })}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Read-only point table (base variant view + variant-only list). */
function PointTable({
  points,
  originBadge,
  emptyLabel,
  t,
}: {
  points: EffectivePoint[];
  originBadge: (o: EffectivePoint["origin"]) => ReactNode;
  emptyLabel: string;
  t: (k: string, opts?: any) => string;
}) {
  if (points.length === 0) {
    return emptyLabel ? <p className="text-sm text-muted-foreground">{emptyLabel}</p> : null;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("products.variants.pointColumn")}</TableHead>
            <TableHead>{t("products.variants.typeColumn")}</TableHead>
            <TableHead>{t("products.variants.thresholdColumn")}</TableHead>
            <TableHead>{t("products.variants.originColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((p) => (
            <TableRow key={p.id}>
              <TableCell>
                <span className="font-medium">{p.code}</span>
                <span className="text-muted-foreground"> — {p.name}</span>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">{p.measurementType ?? "—"}</TableCell>
              <TableCell className="text-xs tabular-nums">
                {thresholdOf(p.lowerLimit, p.upperLimit, p.nominalValue, p.unit)}
              </TableCell>
              <TableCell>{originBadge(p.origin)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default ProductVariantsTab;
