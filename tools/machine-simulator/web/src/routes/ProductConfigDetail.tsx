import * as React from "react"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  Info,
  Loader2,
  RefreshCw,
  Save,
  ServerCrash,
  Target,
  Trash2,
} from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { toast } from "sonner"
import { Link, useLocation, useParams } from "wouter"

import { useT } from "@/i18n"
import { useFleet } from "@/lib/api"
import {
  EngineApiError,
  useDeleteProduct,
  useProduct,
  useProductPoints,
  useSaveProduct,
  useMachineConfigCheck,
  type MeasurementPoint,
  type ProductLifecycleStatus,
  type ProductModel,
} from "@/lib/configApi"
import { fadeSlideUp } from "@/theme/motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductFormFields, type ProductFormValues } from "@/components/ProductFormFields"
import { ProductImageThumb } from "@/components/ProductImageThumb"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>
type T = (key: string, vars?: Record<string, string | number>) => string

const LIFECYCLE_BADGE: Record<ProductLifecycleStatus, BadgeStatus> = {
  development: "info",
  active: "ok",
  eol: "warn",
  archived: "neutral",
}

const DRIFT_BADGE: Record<string, BadgeStatus> = {
  in_sync: "ok",
  drift: "warn",
  unknown: "neutral",
}

function toFormValues(product: ProductModel): ProductFormValues {
  return {
    name: product.name,
    lifecycleStatus: product.lifecycleStatus,
    coordinateMode: product.coordinateMode,
    imageWidth: product.imageWidth != null ? String(product.imageWidth) : "",
    imageHeight: product.imageHeight != null ? String(product.imageHeight) : "",
    referenceImageUrl: product.referenceImageUrl ?? "",
  }
}

function formsEqual(a: ProductFormValues, b: ProductFormValues): boolean {
  return (
    a.name === b.name &&
    a.lifecycleStatus === b.lifecycleStatus &&
    a.coordinateMode === b.coordinateMode &&
    a.imageWidth === b.imageWidth &&
    a.imageHeight === b.imageHeight &&
    a.referenceImageUrl === b.referenceImageUrl
  )
}

function BackLink() {
  const t = useT()
  return (
    <Link
      href="/products"
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-text-muted transition-colors hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {t("productConfigDetail.back")}
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3.5 w-48" />
          </div>
        </div>
        <Skeleton className="h-6 w-28 rounded-full" />
      </div>
      <Card className="p-1">
        <CardContent className="flex flex-col gap-4 pt-3">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}

function NotFoundState({ code }: { code: string }) {
  const t = useT()
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <BackLink />
      <div className="flex flex-1 items-center justify-center">
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-danger/10">
              <ServerCrash className="size-6 text-danger-text" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold text-text-strong">{t("productConfigDetail.notFoundState.title")}</h1>
            <p className="text-sm text-text-muted">{t("productConfigDetail.notFoundState.description", { code })}</p>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  )
}

function ConnectivityErrorState() {
  const t = useT()
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <BackLink />
      <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// "Thông tin sản phẩm" tab — product-level fields, save (whole-aggregate PUT, see configApi.ts's
// header comment), and the delete danger zone.
// ─────────────────────────────────────────────────────────────────────────

function DeleteProductDialog({
  open,
  onOpenChange,
  product,
  pointCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: ProductModel
  pointCount: number
}) {
  const t = useT()
  const [, navigate] = useLocation()
  const deleteProduct = useDeleteProduct()

  function handleDelete() {
    deleteProduct.mutate(product.code, {
      onSuccess: () => {
        toast.success(t("toast.productDeleted", { code: product.code }))
        navigate("/products")
      },
      onError: () => toast.error(t("productConfigDetail.info.deleteFailed")),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("productConfigDetail.info.deleteConfirmTitle", { code: product.code })}</DialogTitle>
          <DialogDescription>
            {t("productConfigDetail.info.deleteConfirmDescription", { name: product.name, pointCount })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("productConfigDetail.info.deleteConfirmCancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteProduct.isPending}>
            {deleteProduct.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-3.5" aria-hidden="true" />
            )}
            {deleteProduct.isPending ? t("productConfigDetail.info.deleting") : t("productConfigDetail.info.deleteConfirmSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProductInfoTab({ product, pointCount }: { product: ProductModel; pointCount: number }) {
  const t = useT()
  const saveProduct = useSaveProduct()
  const [form, setForm] = React.useState<ProductFormValues>(() => toFormValues(product))
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const serverValues = toFormValues(product)
  const dirty = !formsEqual(form, serverValues)

  function updateForm<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setNameError(t("productConfigDetail.info.nameRequired"))
      return
    }
    setNameError(null)

    // Spread the FULL loaded product first — `PUT /v1/products/{code}` overwrites the whole stored
    // aggregate (fiducials/variants/points included), so anything not explicitly carried through here
    // would be silently wiped. See configApi.ts's header comment for the live-verified failure mode.
    const body: ProductModel = {
      ...product,
      name: trimmedName,
      lifecycleStatus: form.lifecycleStatus,
      coordinateMode: form.coordinateMode,
      imageWidth: form.imageWidth.trim() ? Number(form.imageWidth) : null,
      imageHeight: form.imageHeight.trim() ? Number(form.imageHeight) : null,
      referenceImageUrl: form.referenceImageUrl.trim() || null,
    }

    saveProduct.mutate(
      { code: product.code, product: body },
      {
        onSuccess: () => toast.success(t("toast.productSaved")),
        onError: () => toast.error(t("productConfigDetail.info.saveFailed")),
      }
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Info className="size-4 text-navy-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("productConfigDetail.info.title")}</h2>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-body">{t("productConfigDetail.info.codeLabel")}</span>
            <span className="font-numeric w-fit rounded-md bg-surface-subtle px-2.5 py-1 text-sm text-text-strong">
              {product.code}
            </span>
          </div>

          <ProductFormFields values={form} onChange={updateForm} idPrefix="edit-product" />
          {nameError ? (
            <p role="alert" className="text-sm text-danger-text">
              {nameError}
            </p>
          ) : null}

          <div className="flex items-center gap-3 pt-1">
            <Button type="button" onClick={handleSave} disabled={!dirty || saveProduct.isPending}>
              {saveProduct.isPending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-3.5" aria-hidden="true" />
              )}
              {saveProduct.isPending ? t("productConfigDetail.info.saving") : t("productConfigDetail.info.save")}
            </Button>
            <span className="text-xs text-text-muted">
              {dirty ? t("productConfigDetail.info.dirty") : t("productConfigDetail.info.clean")}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-danger-text" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("productConfigDetail.info.dangerZoneTitle")}</h2>
          </div>
          <p className="text-sm text-text-muted">{t("productConfigDetail.info.dangerZoneHint")}</p>
          <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)} className="w-fit">
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("productConfigDetail.info.deleteBtn")}
          </Button>
        </CardContent>
      </Card>

      <DeleteProductDialog open={deleteOpen} onOpenChange={setDeleteOpen} product={product} pointCount={pointCount} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// "Điểm đo" tab — SEAM FOR TASK C5. This is a real, functional read-only summary (GET
// /v1/products/{code}/points, live data — not a placeholder), giving today's build genuine value:
// seeing what's configured. Task C5 replaces/extends this component's body with the full
// PointsEditor + BoardCanvas (image-overlay canvas, add/edit/soft-delete, spec form) — the
// `TabsContent value="points"` slot in `ProductConfigDetailBody` below is the exact seam it fills.
// ─────────────────────────────────────────────────────────────────────────

function formatLimits(point: MeasurementPoint, t: T): string {
  const unit = point.unit ? ` ${point.unit}` : ""
  if (point.lowerLimit != null && point.upperLimit != null) return `${point.lowerLimit} – ${point.upperLimit}${unit}`
  if (point.lowerLimit != null) return `≥ ${point.lowerLimit}${unit}`
  if (point.upperLimit != null) return `≤ ${point.upperLimit}${unit}`
  if (point.nominalValue != null) return `${point.nominalValue}${unit}`
  return t("productConfigDetail.points.noLimits")
}

function ProductPointsTab({ code }: { code: string }) {
  const t = useT()
  const { data: points, isPending, isError } = useProductPoints(code)

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-navy-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("productConfigDetail.points.title")}</h2>
          </div>
          {!isPending && !isError ? (
            <StatusBadge status="neutral">{t("productConfigDetail.points.countLabel", { count: points?.length ?? 0 })}</StatusBadge>
          ) : null}
        </div>

        {isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
        ) : points && points.length > 0 ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("productConfigDetail.points.table.code")}</TableHead>
                  <TableHead>{t("productConfigDetail.points.table.name")}</TableHead>
                  <TableHead>{t("productConfigDetail.points.table.type")}</TableHead>
                  <TableHead className="text-right">{t("productConfigDetail.points.table.limits")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {points.map((point) => (
                  <TableRow key={point.code}>
                    <TableCell className="font-medium text-text-strong">{point.code}</TableCell>
                    <TableCell className="text-text-body">{point.name}</TableCell>
                    <TableCell className="text-text-body">{point.measurementType}</TableCell>
                    <TableCell className="font-numeric text-right text-text-muted">{formatLimits(point, t)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border py-10 text-center">
            <p className="text-sm font-medium text-text-strong">{t("productConfigDetail.points.empty.title")}</p>
            <p className="text-sm text-text-muted">{t("productConfigDetail.points.empty.description")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// "Đồng bộ" tab — SEAM FOR TASK C7. Real functionality already, against the live C2/C3 sync engine
// (`GET /v1/machines/{code}/config/check`): pick an AOI/AVI machine, see this product's version drift
// against that machine's local copy. Task C7 rewrites `components/ConfigSyncPanel.tsx` (wired into
// `MachineDetail.tsx`'s own "Cấu hình" tab) with the full pull/push/diff/history UI — this tab's
// `viewMachineLink` is the deliberate hop to that seam rather than duplicating it here.
// ─────────────────────────────────────────────────────────────────────────

function ProductSyncTab({ code }: { code: string }) {
  const t = useT()
  const { data: fleet, isPending: fleetPending } = useFleet()
  const [selectedMachine, setSelectedMachine] = React.useState("")
  const [hasChecked, setHasChecked] = React.useState(false)

  const aoiMachines = React.useMemo(
    () => (fleet?.machines ?? []).filter((m) => m.deviceClass === "AoiAvi"),
    [fleet]
  )

  const check = useMachineConfigCheck(hasChecked ? selectedMachine : undefined, code)
  const drift = check.data?.products.find((p) => p.productModelCode.toLowerCase() === code.toLowerCase())

  function handleMachineChange(value: string) {
    setSelectedMachine(value)
    setHasChecked(false)
  }

  function handleCheckClick() {
    if (!selectedMachine) return
    if (hasChecked) {
      void check.refetch()
    } else {
      setHasChecked(true)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <RefreshCw className="size-4 text-navy-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-text-strong">{t("productConfigDetail.sync.title")}</h2>
        </div>
        <p className="text-sm text-text-muted">{t("productConfigDetail.sync.description")}</p>

        {!fleetPending && aoiMachines.length === 0 ? (
          <p className="text-sm text-text-muted">{t("productConfigDetail.sync.noMachines")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("productConfigDetail.sync.machineLabel")}
                </span>
                <select
                  value={selectedMachine}
                  onChange={(event) => handleMachineChange(event.target.value)}
                  className="h-8 w-48 rounded-lg border border-input bg-transparent px-2 text-sm text-text-body outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">{t("productConfigDetail.sync.machinePlaceholder")}</option>
                  {aoiMachines.map((machine) => (
                    <option key={machine.code} value={machine.code}>
                      {machine.code}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={handleCheckClick}
                disabled={!selectedMachine || check.isFetching}
              >
                {check.isFetching ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                {check.isFetching ? t("productConfigDetail.sync.checking") : t("productConfigDetail.sync.checkBtn")}
              </Button>
            </div>

            {check.isError ? (
              <p role="alert" className="text-sm text-danger-text">
                {t("productConfigDetail.sync.checkFailed")}
              </p>
            ) : null}

            {hasChecked && drift ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border p-3" role="status">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-text-muted">{t("productConfigDetail.sync.resultState")}</span>
                  <StatusBadge status={DRIFT_BADGE[drift.driftState] ?? "neutral"}>
                    {t(`productConfigDetail.sync.driftState.${drift.driftState}`)}
                  </StatusBadge>
                </div>
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-text-muted">{t("productConfigDetail.sync.resultLocalVersion")}</dt>
                    <dd className="font-numeric font-medium text-text-strong">{drift.localVersion ?? "—"}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-text-muted">{t("productConfigDetail.sync.resultEcosystemVersion")}</dt>
                    <dd className="font-numeric font-medium text-text-strong">{drift.ecosystemVersion}</dd>
                  </div>
                </dl>
                <Link
                  href={`/machines/${selectedMachine}`}
                  className="text-sm text-primary-text underline-offset-4 hover:underline"
                >
                  {t("productConfigDetail.sync.viewMachineLink", { code: selectedMachine })}
                </Link>
              </div>
            ) : null}

            <p className="text-[11px] text-text-muted">{t("productConfigDetail.sync.seamNote")}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Body / route
// ─────────────────────────────────────────────────────────────────────────

function ProductConfigDetailBody({ product }: { product: ProductModel }) {
  const t = useT()
  const { data: points } = useProductPoints(product.code)
  const pointCount = points?.length ?? product.points.filter((p) => !p.deletedAt).length

  return (
    <motion.div
      key={product.code}
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 flex-col gap-6 p-6 lg:p-8"
    >
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ProductImageThumb
            url={product.referenceImageUrl}
            alt={product.name}
            className="size-11 shrink-0 rounded-full border border-border"
            fallbackIconClassName="size-5"
          />
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-text-strong">{product.code}</h1>
              <StatusBadge status={LIFECYCLE_BADGE[product.lifecycleStatus]}>
                {t(`lifecycleStatus.${product.lifecycleStatus}`)}
              </StatusBadge>
            </div>
            <p className="text-sm text-text-muted">
              {product.name} · {t(`coordinateMode.${product.coordinateMode}`)}
            </p>
          </div>
        </div>

        <StatusBadge status="neutral">
          {t("productConfigDetail.versionBadge", { version: product.pointsConfigVersion })}
        </StatusBadge>
      </div>

      <Card className="p-1">
        <CardContent className="pt-3">
          <Tabs defaultValue="info">
            <TabsList>
              <TabsTrigger value="info">
                <Info className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("productConfigDetail.tabs.info")}
              </TabsTrigger>
              <TabsTrigger value="points">
                <Target className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("productConfigDetail.tabs.points")}
              </TabsTrigger>
              <TabsTrigger value="sync">
                <RefreshCw className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("productConfigDetail.tabs.sync")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="info" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <ProductInfoTab product={product} pointCount={pointCount} />
              </motion.div>
            </TabsContent>

            <TabsContent value="points" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                {/* SEAM: Task C5 fills this slot with <PointsEditor/> + <BoardCanvas/>. */}
                <ProductPointsTab code={product.code} />
              </motion.div>
            </TabsContent>

            <TabsContent value="sync" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <ProductSyncTab code={product.code} />
              </motion.div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default function ProductConfigDetail() {
  const { code } = useParams<{ code: string }>()
  const { data, isPending, isError, error } = useProduct(code)

  if (!code) return <ConnectivityErrorState />
  if (isPending) return <DetailSkeleton />

  if (isError) {
    const notFound = error instanceof EngineApiError && error.status === 404
    return notFound ? <NotFoundState code={code} /> : <ConnectivityErrorState />
  }

  if (!data) return <DetailSkeleton />

  return <ProductConfigDetailBody product={data} />
}
