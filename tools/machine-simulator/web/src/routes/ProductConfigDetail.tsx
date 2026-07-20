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
  type ProductLifecycleStatus,
  type ProductModel,
} from "@/lib/configApi"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ProductFormFields, type ProductFormValues } from "@/components/ProductFormFields"
import { ProductImageThumb } from "@/components/ProductImageThumb"
import { PointsEditor } from "@/components/PointsEditor"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

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
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-11 shrink-0" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3.5 w-48" />
          </div>
        </div>
        <Skeleton className="h-6 w-28" />
      </div>
      <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </Sheet>
    </div>
  )
}

function NotFoundState({ code }: { code: string }) {
  const t = useT()
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
      <BackLink />
      <div className="flex flex-1 items-center justify-center">
        <Sheet className="max-w-md" bodyClassName="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-12 items-center justify-center border border-danger/40 bg-danger/10">
            <ServerCrash className="size-6 text-danger-text" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-semibold text-text-strong">{t("productConfigDetail.notFoundState.title")}</h1>
          <p className="text-sm text-text-muted">{t("productConfigDetail.notFoundState.description", { code })}</p>
        </Sheet>
      </div>
    </motion.div>
  )
}

function ConnectivityErrorState() {
  const t = useT()
  return (
    <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
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
    <div className="flex flex-col gap-4">
      {/* Title-less Sheet — kept as a literal `<h2>` below (not `<Sheet title>`'s own `<h3>`) so this
          tab's heading hierarchy stays h1 (page) → h2 (this section), same pattern as
          PointsEditor.tsx's own fix. */}
      <Sheet bodyClassName="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <Info className="size-4 text-primary-text" aria-hidden="true" />
          <h2 className="font-heading text-[15px] font-semibold tracking-tight text-text-strong">
            {t("productConfigDetail.info.title")}
          </h2>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-body">{t("productConfigDetail.info.codeLabel")}</span>
          <span className="font-numeric w-fit border border-border-strong bg-surface-muted px-2.5 py-1 text-sm text-text-strong">
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
      </Sheet>

      <Sheet bodyClassName="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Trash2 className="size-4 text-danger-text" aria-hidden="true" />
          <h2 className="font-heading text-[15px] font-semibold tracking-tight text-text-strong">
            {t("productConfigDetail.info.dangerZoneTitle")}
          </h2>
        </div>
        <p className="text-sm text-text-muted">{t("productConfigDetail.info.dangerZoneHint")}</p>
        <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)} className="w-fit">
          <Trash2 className="size-3.5" aria-hidden="true" />
          {t("productConfigDetail.info.deleteBtn")}
        </Button>
      </Sheet>

      <DeleteProductDialog open={deleteOpen} onOpenChange={setDeleteOpen} product={product} pointCount={pointCount} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// "Điểm đo" tab — Task C5's PointsEditor (board image-overlay canvas + points list + full-spec
// point form + fiducials/variants) is wired directly into `TabsContent value="points"` below; see
// `components/PointsEditor.tsx`.
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
    <Sheet bodyClassName="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <RefreshCw className="size-4 text-primary-text" aria-hidden="true" />
        <h2 className="font-heading text-[15px] font-semibold tracking-tight text-text-strong">
          {t("productConfigDetail.sync.title")}
        </h2>
      </div>
      <p className="text-sm text-text-muted">{t("productConfigDetail.sync.description")}</p>

      {!fleetPending && aoiMachines.length === 0 ? (
        <p className="text-sm text-text-muted">{t("productConfigDetail.sync.noMachines")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="hmi-micro">{t("productConfigDetail.sync.machineLabel")}</span>
              <select
                value={selectedMachine}
                onChange={(event) => handleMachineChange(event.target.value)}
                className="h-8 w-48 border border-border-strong bg-surface-muted px-2 text-sm text-text-body outline-none transition-colors focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
              >
                <option value="">{t("productConfigDetail.sync.machinePlaceholder")}</option>
                {aoiMachines.map((machine) => (
                  <option key={machine.code} value={machine.code}>
                    {machine.code}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="outline" onClick={handleCheckClick} disabled={!selectedMachine || check.isFetching}>
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
            <div className="flex flex-col gap-3 border border-border p-3" role="status">
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
    </Sheet>
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
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <BackLink />

      <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <ProductImageThumb
            url={product.referenceImageUrl}
            alt={product.name}
            className="size-11 shrink-0 border border-border-strong"
            fallbackIconClassName="size-5"
          />
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-[28px] leading-none font-semibold tracking-tight text-text-strong">
                {product.code}
              </h1>
              <StatusBadge status={LIFECYCLE_BADGE[product.lifecycleStatus]}>
                {t(`lifecycleStatus.${product.lifecycleStatus}`)}
              </StatusBadge>
            </div>
            <p className="hmi-micro mt-1">
              {product.name} · {t(`coordinateMode.${product.coordinateMode}`)}
            </p>
          </div>
        </div>

        <StatusBadge status="neutral">
          {t("productConfigDetail.versionBadge", { version: product.pointsConfigVersion })}
        </StatusBadge>
      </div>

      <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-1 min-h-0 flex-col p-3">
        <Tabs defaultValue="info" className="min-h-0 flex-1">
          <TabsList className="shrink-0">
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

          <TabsContent value="info" className="min-h-0 flex-1 pt-4">
            <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="h-full min-h-0">
              <div
                tabIndex={0}
                className="hmi-scroll h-full overflow-x-hidden overflow-y-auto pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
              >
                <ProductInfoTab product={product} pointCount={pointCount} />
              </div>
            </motion.div>
          </TabsContent>

          <TabsContent value="points" className="min-h-0 flex-1 pt-4">
            <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="h-full min-h-0">
              <div
                tabIndex={0}
                className="hmi-scroll h-full overflow-x-hidden overflow-y-auto pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
              >
                <PointsEditor product={product} />
              </div>
            </motion.div>
          </TabsContent>

          <TabsContent value="sync" className="min-h-0 flex-1 pt-4">
            <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="h-full min-h-0">
              <div
                tabIndex={0}
                className="hmi-scroll h-full overflow-x-hidden overflow-y-auto pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
              >
                <ProductSyncTab code={product.code} />
              </div>
            </motion.div>
          </TabsContent>
        </Tabs>
      </Sheet>
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
