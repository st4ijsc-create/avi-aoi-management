import * as React from "react"
import { Loader2, Plus, Target, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useDeletePoint, useProductPoints, type MeasurementPoint, type ProductModel } from "@/lib/configApi"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { BoardCanvas } from "@/components/BoardCanvas"
import { PointForm, type NewPointSeed } from "@/components/PointForm"
import { ProductFiducialsPanel } from "@/components/ProductFiducialsPanel"
import { ProductVariantsPanel } from "@/components/ProductVariantsPanel"
import { cn } from "@/lib/utils"

type T = (key: string, vars?: Record<string, string | number>) => string

function formatLimits(point: MeasurementPoint, t: T): string {
  const unit = point.unit ? ` ${point.unit}` : ""
  if (point.lowerLimit != null && point.upperLimit != null) return `${point.lowerLimit} – ${point.upperLimit}${unit}`
  if (point.lowerLimit != null) return `≥ ${point.lowerLimit}${unit}`
  if (point.upperLimit != null) return `≤ ${point.upperLimit}${unit}`
  if (point.nominalValue != null) return `${point.nominalValue}${unit}`
  return t("productConfigDetail.points.noLimits")
}

// ─────────────────────────────────────────────────────────────────────────
// Points list — compact table beside the canvas; row click selects (mirrors ProductConfig.tsx's own
// whole-row ProductRow pattern), a trailing trash icon soft-deletes. Tombstoned rows (shown only when
// "hiện điểm đã xoá" is on) are display-only, not selectable — editing a soft-deleted point isn't a
// supported flow (see PointForm.tsx's payload builder, which always carries `deletedAt` through
// unchanged).
// ─────────────────────────────────────────────────────────────────────────

function PointsListTable({
  points,
  selectedCode,
  onSelect,
  onDelete,
}: {
  points: MeasurementPoint[]
  selectedCode: string | null
  onSelect: (code: string) => void
  onDelete: (point: MeasurementPoint) => void
}) {
  const t = useT()

  if (points.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 border border-dashed border-border py-8 text-center">
        <p className="text-sm font-medium text-text-strong">{t("productConfigDetail.points.empty.title")}</p>
        <p className="text-sm text-text-muted">{t("productConfigDetail.points.empty.description")}</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden border border-border-strong">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("productConfigDetail.points.table.code")}</TableHead>
            <TableHead>{t("productConfigDetail.points.table.name")}</TableHead>
            <TableHead>{t("productConfigDetail.points.table.type")}</TableHead>
            <TableHead className="text-right">{t("productConfigDetail.points.table.limits")}</TableHead>
            <TableHead className="w-8">
              <span className="sr-only">{t("pointsEditor.list.actionsHeader")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((point) => {
            const deleted = !!point.deletedAt
            const selected = point.code === selectedCode
            return (
              <TableRow
                key={point.code}
                onClick={deleted ? undefined : () => onSelect(point.code)}
                onKeyDown={
                  deleted
                    ? undefined
                    : (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          onSelect(point.code)
                        }
                      }
                }
                tabIndex={deleted ? undefined : 0}
                aria-current={selected ? "true" : undefined}
                className={cn(
                  deleted
                    ? "opacity-60"
                    : "cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600/50",
                  selected && "bg-navy-50 dark:bg-navy-800/40"
                )}
              >
                <TableCell className="font-numeric font-medium text-text-strong">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {point.code}
                    {!point.isActive && !deleted ? <StatusBadge status="neutral">{t("pointsEditor.list.inactiveTag")}</StatusBadge> : null}
                    {deleted ? <StatusBadge status="neutral">{t("pointsEditor.list.deletedTag")}</StatusBadge> : null}
                  </span>
                </TableCell>
                <TableCell className="text-text-body">{point.name}</TableCell>
                <TableCell className="text-text-body">{t(`measurementType.${point.measurementType}`)}</TableCell>
                <TableCell className="font-numeric text-right text-text-muted">{formatLimits(point, t)}</TableCell>
                <TableCell>
                  {!deleted ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDelete(point)
                      }}
                      aria-label={t("pointsEditor.list.deleteAria", { code: point.code })}
                    >
                      <Trash2 className="size-3.5 text-danger-text" aria-hidden="true" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function DeletePointDialog({
  open,
  onOpenChange,
  productCode,
  point,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  productCode: string
  point: MeasurementPoint
}) {
  const t = useT()
  const deletePoint = useDeletePoint()

  function handleDelete() {
    deletePoint.mutate(
      { code: productCode, pointCode: point.code },
      {
        onSuccess: () => {
          toast.success(t("toast.pointDeleted", { code: point.code }))
          onOpenChange(false)
        },
        onError: () => toast.error(t("toast.pointDeleteFailed")),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("pointsEditor.form.deleteConfirmTitle", { code: point.code })}</DialogTitle>
          <DialogDescription>{t("pointsEditor.form.deleteConfirmDescription", { name: point.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("pointsEditor.form.deleteConfirmCancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={deletePoint.isPending}>
            {deletePoint.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="size-3.5" aria-hidden="true" />}
            {deletePoint.isPending ? t("pointsEditor.form.deleting") : t("pointsEditor.form.deleteConfirmSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// PointsEditor — Task C5's seam fill. Two-pane layout: canvas + points list on the left, the full-spec
// point form on the right. `PointForm` is remounted (via `key`) whenever the selection changes — see
// its own doc comment for why that's what gives the dirty-check and per-selection reset their
// correctness for free.
// ─────────────────────────────────────────────────────────────────────────

export function PointsEditor({ product }: { product: ProductModel }) {
  const t = useT()
  const gloss = useGloss()
  const [includeDeleted, setIncludeDeleted] = React.useState(false)
  const { data: points, isPending, isFetching, isError } = useProductPoints(product.code, includeDeleted)
  const [selectedCode, setSelectedCode] = React.useState<string | null>(null)
  const [newSeed, setNewSeed] = React.useState<NewPointSeed | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<MeasurementPoint | null>(null)

  const activeCount = React.useMemo(() => (points ?? []).filter((p) => p.isActive && !p.deletedAt).length, [points])
  const existingCodes = React.useMemo(() => new Set((points ?? []).map((p) => p.code.toLowerCase())), [points])
  const selectedPoint = React.useMemo(() => (points ?? []).find((p) => p.code === selectedCode) ?? null, [points, selectedCode])

  // The selected point can disappear out from under the selection (deleted elsewhere, or a stale code
  // left over after the "includeDeleted" toggle narrows the list) — fall back to the empty state
  // instead of silently rendering a form for a point that no longer resolves. Gated on `!isFetching`
  // (not just `!isPending`) — found live: right after creating a new point, `handleSaved` selects its
  // code while the invalidation-triggered background refetch is still in flight (react-query keeps
  // serving the STALE, pre-create list during that refetch, so `isPending` is already false but the
  // new code genuinely isn't in `points` yet). Without the `isFetching` guard this effect fired on
  // that stale snapshot and cleared the just-created point's selection before the fresh list — which
  // DOES contain it — ever landed.
  React.useEffect(() => {
    if (selectedCode && !isPending && !isFetching && !selectedPoint) setSelectedCode(null)
  }, [selectedCode, isPending, isFetching, selectedPoint])

  function handleSelectPoint(code: string) {
    setNewSeed(null)
    setSelectedCode(code)
  }

  function handleAddAt(nx: number, ny: number) {
    setSelectedCode(null)
    setNewSeed({ normalizedX: nx, normalizedY: ny, orderIndex: points?.length ?? 0 })
  }

  function handleAddCenter() {
    setSelectedCode(null)
    setNewSeed({ normalizedX: 0.5, normalizedY: 0.5, orderIndex: points?.length ?? 0 })
  }

  function handleSaved(code: string) {
    setNewSeed(null)
    setSelectedCode(code)
  }

  function handleCancelNew() {
    setNewSeed(null)
  }

  const formKey = newSeed ? "new" : (selectedCode ?? "none")

  return (
    <div className="flex flex-col gap-4">
      {/* Title-less Sheet (registration-corner frame only) — the section heading below stays a
          literal `<h2>` (NOT `<Sheet title>`'s own `<h3>`) so the page's heading hierarchy holds
          h1 (product code) → h2 (this section) → h3 (fiducials/variants panels below), matching
          what `09-points-editor.spec.ts` asserts (`level: 2`). */}
      <Sheet bodyClassName="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="size-4 text-primary-text" aria-hidden="true" />
            <h2 className="font-heading text-[15px] font-semibold tracking-tight text-text-strong">{t("pointsEditor.title")}</h2>
            <span className="hmi-micro" aria-hidden="true">
              {gloss("pointsEditor.title")}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status="neutral">{t("productConfigDetail.points.countLabel", { count: activeCount })}</StatusBadge>
            <StatusBadge status="neutral">{t("productConfigDetail.versionBadge", { version: product.pointsConfigVersion })}</StatusBadge>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* No `aria-label` on the Switch — the wrapping <label>'s own visible text already
              gives it an accessible name via implicit association; adding one too doubled the
              computed name ("Hiện điểm đã xóa Hiện điểm đã xóa"), caught live via Playwright's
              `getByRole("switch", { name })` resolving an unexpectedly long accessible name. */}
          <label className="flex items-center gap-2 text-xs text-text-muted">
            <Switch checked={includeDeleted} onCheckedChange={setIncludeDeleted} />
            {t("pointsEditor.includeDeletedLabel")}
          </label>
          <Button type="button" size="sm" onClick={handleAddCenter}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("pointsEditor.addBtn")}
          </Button>
        </div>

        {isPending ? (
          <Skeleton className="aspect-[4/3] w-full" />
        ) : isError ? (
          <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-4">
              <BoardCanvas
                referenceImageUrl={product.referenceImageUrl}
                imageWidth={product.imageWidth}
                imageHeight={product.imageHeight}
                points={points ?? []}
                fiducials={product.fiducials}
                selectedCode={selectedCode}
                onSelectPoint={handleSelectPoint}
                onAddPointAt={handleAddAt}
                productName={product.name}
              />
              <PointsListTable points={points ?? []} selectedCode={selectedCode} onSelect={handleSelectPoint} onDelete={setDeleteTarget} />
            </div>

            <div className="min-w-0">
              <PointForm
                key={formKey}
                product={product}
                point={selectedPoint}
                newSeed={newSeed}
                existingCodes={existingCodes}
                onSaved={handleSaved}
                onCancelNew={handleCancelNew}
                onRequestDelete={setDeleteTarget}
              />
            </div>
          </div>
        )}
      </Sheet>

      <ProductFiducialsPanel product={product} />
      <ProductVariantsPanel product={product} />

      {deleteTarget ? (
        <DeletePointDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          productCode={product.code}
          point={deleteTarget}
        />
      ) : null}
    </div>
  )
}
