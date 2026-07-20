import * as React from "react"
import { motion } from "framer-motion"
import { Boxes, ChevronRight, Inbox, Plus, Search, SearchX, X } from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import {
  useProducts,
  useSaveProduct,
  type ProductLifecycleStatus,
  type ProductModel,
  type ProductSummary,
} from "@/lib/configApi"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { ConfigModeToggle } from "@/components/ConfigModeToggle"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormField } from "@/components/FormField"
import { ProductFormFields, type ProductFormValues } from "@/components/ProductFormFields"
import { ProductImageThumb } from "@/components/ProductImageThumb"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

// development = still being authored (info, neutral-attention); active = in production use (ok);
// eol = sunsetting, still valid but on the way out (warn); archived = retired, no color urgency.
const LIFECYCLE_BADGE: Record<ProductLifecycleStatus, BadgeStatus> = {
  development: "info",
  active: "ok",
  eol: "warn",
  archived: "neutral",
}

// Canonical display order for the lifecycle filter — deterministic, not alphabetical (mirrors
// Machines.tsx's own DEVICE_CLASS_ORDER/STATUS_ORDER idiom).
const LIFECYCLE_ORDER: ProductLifecycleStatus[] = ["development", "active", "eol", "archived"]

const ALL = "__all__"

interface FilterSelectProps {
  id: string
  label: string
  labelEn: string
  value: string
  options: string[]
  optionLabel: (value: string) => string
  onChange: (value: string) => void
  allLabel: string
}

/** Plain native `<select>`, not the Base UI Select primitive — same idiom as Machines.tsx's own
 * `FilterSelect` (duplicated locally rather than shared, matching this codebase's established
 * convention for small single-screen filter helpers). Stacked bilingual label (spec §3), `id`/
 * `htmlFor` explicit — see Machines.tsx's `FilterSelect` doc comment for why the gloss must be a
 * sibling OUTSIDE the `<label>` rather than a hidden descendant of it. */
function FilterSelect({ id, label, labelEn, value, options, optionLabel, onChange, allLabel }: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-col gap-0.5">
        <label htmlFor={id} className="truncate text-[13px] leading-tight font-medium text-text-body">
          {label}
        </label>
        <span className="hmi-micro truncate" aria-hidden="true">
          {labelEn}
        </span>
      </span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 border border-border-strong bg-surface-muted px-2 text-xs text-text-body outline-none transition-colors focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40"
      >
        <option value={ALL}>{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </div>
  )
}

function SearchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT()
  const gloss = useGloss()
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-col gap-0.5">
        <label htmlFor="product-search" className="truncate text-[13px] leading-tight font-medium text-text-body">
          {t("productConfig.search.label")}
        </label>
        <span className="hmi-micro truncate" aria-hidden="true">
          {gloss("productConfig.search.label")}
        </span>
      </span>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <Input
          id="product-search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("productConfig.search.placeholder")}
          className="h-8 w-56 pl-7"
        />
      </div>
    </div>
  )
}

function BilingualHead({ vi, en, className, align }: { vi: string; en: string; className?: string; align?: "right" }) {
  return (
    <TableHead className={className}>
      <span className={align === "right" ? "flex flex-col items-end" : "flex flex-col"}>
        <span>{vi}</span>
        <span className="hmi-micro font-normal tracking-[0.1em]" aria-hidden="true">
          {en}
        </span>
      </span>
    </TableHead>
  )
}

function ProductsTableHeaderRow() {
  const t = useT()
  const gloss = useGloss()
  return (
    <TableRow>
      <TableHead className="w-14">
        <span className="sr-only">{t("productConfig.table.image")}</span>
      </TableHead>
      <BilingualHead vi={t("productConfig.table.code")} en={gloss("productConfig.table.code")} />
      <BilingualHead vi={t("productConfig.table.name")} en={gloss("productConfig.table.name")} />
      <BilingualHead vi={t("productConfig.table.lifecycle")} en={gloss("productConfig.table.lifecycle")} />
      <BilingualHead
        vi={t("productConfig.table.points")}
        en={gloss("productConfig.table.points")}
        className="text-right"
        align="right"
      />
      <BilingualHead vi={t("productConfig.table.version")} en={gloss("productConfig.table.version")} />
      <TableHead className="w-8">
        <span className="sr-only">{t("productConfig.table.viewAction")}</span>
      </TableHead>
    </TableRow>
  )
}

function ProductRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="size-9" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-40" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-20" />
      </TableCell>
      <TableCell className="text-right">
        <Skeleton className="ml-auto h-4 w-8" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-8" />
      </TableCell>
      <TableCell>
        <Skeleton className="size-4" />
      </TableCell>
    </TableRow>
  )
}

interface ProductRowProps {
  product: ProductSummary
  onOpen: (code: string) => void
}

/** One catalog row. Whole-row click/keyboard target, same pattern as Machines.tsx's `MachineRow` —
 * see that component's own doc comment for why `tabIndex`+`onKeyDown` rather than `role="button"`. */
function ProductRow({ product, onOpen }: ProductRowProps) {
  const t = useT()

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen(product.code)
    }
  }

  return (
    <TableRow
      onClick={() => onOpen(product.code)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={t("productConfig.table.rowAria", { code: product.code })}
      className="cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600/50"
    >
      <TableCell>
        <ProductImageThumb
          url={product.referenceImageUrl}
          alt={t("productConfig.table.rowAria", { code: product.code })}
          className="size-9 border border-border-strong"
        />
      </TableCell>
      <TableCell className="font-numeric font-medium text-text-strong">{product.code}</TableCell>
      <TableCell className="text-text-body">{product.name}</TableCell>
      <TableCell>
        <StatusBadge status={LIFECYCLE_BADGE[product.lifecycleStatus]}>
          {t(`lifecycleStatus.${product.lifecycleStatus}`)}
        </StatusBadge>
      </TableCell>
      <TableCell className="font-numeric text-right text-text-body">{product.pointCount}</TableCell>
      <TableCell className="font-numeric text-text-muted">
        {t("productConfig.versionShort", { version: product.pointsConfigVersion })}
      </TableCell>
      <TableCell className="text-text-muted">
        <ChevronRight className="size-4" aria-hidden="true" />
      </TableCell>
    </TableRow>
  )
}

interface EmptyStateProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  action?: React.ReactNode
}

/** Same visual shape as Machines.tsx's own `EmptyState` (blueprint sheet, square icon mark,
 * title+description, one action) — reused here for both "catalog is empty" and "filters matched
 * nothing". */
function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="min-h-0 flex-1">
      <Sheet className="h-full" bodyClassName="flex h-full flex-col items-center justify-center gap-4 px-8 py-16 text-center">
        <div className="flex size-14 items-center justify-center border border-border-strong bg-surface-card">
          <Icon className="size-7 text-primary-text" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-text-strong">{title}</p>
          <p className="max-w-sm text-sm text-text-muted">{description}</p>
        </div>
        {action}
      </Sheet>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Create dialog
// ─────────────────────────────────────────────────────────────────────────

const EMPTY_FORM: ProductFormValues = {
  name: "",
  lifecycleStatus: "development",
  coordinateMode: "pixel",
  imageWidth: "",
  imageHeight: "",
  referenceImageUrl: "",
}

interface CreateProductDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingCodes: Set<string>
}

function CreateProductDialog({ open, onOpenChange, existingCodes }: CreateProductDialogProps) {
  const t = useT()
  const saveProduct = useSaveProduct()
  const [code, setCode] = React.useState("")
  const [form, setForm] = React.useState<ProductFormValues>(EMPTY_FORM)
  const [error, setError] = React.useState<string | null>(null)

  // Reset to a blank form every time the dialog re-opens — a half-filled leftover from a cancelled
  // attempt would be confusing to find still sitting there next time.
  React.useEffect(() => {
    if (open) {
      setCode("")
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [open])

  function updateForm<K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedCode = code.trim()
    const trimmedName = form.name.trim()

    if (!trimmedCode) {
      setError(t("productConfig.createDialog.codeRequired"))
      return
    }
    if (existingCodes.has(trimmedCode.toLowerCase())) {
      setError(t("productConfig.createDialog.codeDuplicate", { code: trimmedCode }))
      return
    }
    if (!trimmedName) {
      setError(t("productConfig.createDialog.nameRequired"))
      return
    }
    setError(null)

    const body: ProductModel = {
      code: trimmedCode,
      name: trimmedName,
      lifecycleStatus: form.lifecycleStatus,
      coordinateMode: form.coordinateMode,
      imageWidth: form.imageWidth.trim() ? Number(form.imageWidth) : null,
      imageHeight: form.imageHeight.trim() ? Number(form.imageHeight) : null,
      imageHash: null,
      referenceImageUrl: form.referenceImageUrl.trim() || null,
      pointsConfigVersion: 1,
      fiducials: [],
      variants: [],
      points: [],
    }

    saveProduct.mutate(
      { code: trimmedCode, product: body },
      {
        onSuccess: (data) => {
          toast.success(t("toast.productCreated", { code: data.code }))
          onOpenChange(false)
        },
        onError: () => toast.error(t("productConfig.createDialog.createFailed")),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("productConfig.createDialog.title")}</DialogTitle>
            <DialogDescription>{t("productConfig.createDialog.description")}</DialogDescription>
          </DialogHeader>

          <div
            tabIndex={0}
            className="hmi-scroll max-h-[60vh] overflow-y-auto pr-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
          >
            <div className="flex flex-col gap-4">
              <FormField
                label={t("productConfig.createDialog.codeLabel")}
                htmlFor="create-product-code"
                hint={t("productConfig.createDialog.codeHint")}
              >
                <Input
                  id="create-product-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder={t("productConfig.createDialog.codePlaceholder")}
                  maxLength={40}
                  autoFocus
                />
              </FormField>

              <ProductFormFields values={form} onChange={updateForm} idPrefix="create-product" />
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("productConfig.createDialog.cancel")}
            </Button>
            <Button type="submit" disabled={saveProduct.isPending}>
              {saveProduct.isPending
                ? t("productConfig.createDialog.submitting")
                : t("productConfig.createDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

export default function ProductConfig() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useProducts()
  const [, navigate] = useLocation()

  const [search, setSearch] = React.useState("")
  const [lifecycleFilter, setLifecycleFilter] = React.useState(ALL)
  const [createOpen, setCreateOpen] = React.useState(false)

  const products = React.useMemo(() => data ?? [], [data])
  const existingCodes = React.useMemo(
    () => new Set(products.map((p) => p.code.toLowerCase())),
    [products]
  )
  const openProduct = React.useCallback((code: string) => navigate(`/products/${code}`), [navigate])

  const lifecycleOptions = React.useMemo(
    () => LIFECYCLE_ORDER.filter((s) => products.some((p) => p.lifecycleStatus === s)),
    [products]
  )

  // Same self-correcting idiom as Machines.tsx's statusFilter effect — a selected lifecycle filter can
  // fall out of the option set if every product carrying it gets edited/deleted out from under it.
  React.useEffect(() => {
    if (lifecycleFilter !== ALL && !lifecycleOptions.includes(lifecycleFilter as ProductLifecycleStatus)) {
      setLifecycleFilter(ALL)
    }
  }, [lifecycleFilter, lifecycleOptions])

  const filtersActive = search.trim() !== "" || lifecycleFilter !== ALL

  const filteredProducts = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return products.filter((p) => {
      if (query && !p.code.toLowerCase().includes(query) && !p.name.toLowerCase().includes(query)) return false
      if (lifecycleFilter !== ALL && p.lifecycleStatus !== lifecycleFilter) return false
      return true
    })
  }, [products, search, lifecycleFilter])

  const clearFilters = React.useCallback(() => {
    setSearch("")
    setLifecycleFilter(ALL)
  }, [])

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <ConfigModeToggle current="products" className="mb-1" />
          <div className="flex items-center gap-2">
            <Boxes className="size-5 text-primary-text" aria-hidden="true" />
            <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
              {t("productConfig.title")}
            </h1>
          </div>
          <p className="hmi-micro mt-1">{gloss("productConfig.title")}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("productConfig.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          {!isPending && !isError ? (
            <StatusBadge status="neutral">{t("productConfig.countLabel", { count: products.length })}</StatusBadge>
          ) : null}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("productConfig.createBtn")}
          </Button>
        </div>
      </div>

      {isPending ? (
        <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-1 min-h-0 flex-col p-0">
          <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
            <Table>
              <TableHeader>
                <ProductsTableHeaderRow />
              </TableHeader>
              <TableBody>
                {Array.from({ length: 4 }, (_, i) => (
                  <ProductRowSkeleton key={i} />
                ))}
              </TableBody>
            </Table>
          </div>
        </Sheet>
      ) : isError ? (
        <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
      ) : products.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t("productConfig.empty.noProductsTitle")}
          description={t("productConfig.empty.noProductsDescription")}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              {t("productConfig.createBtn")}
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border border-border bg-surface-card p-3">
            <div className="flex flex-wrap items-end gap-3">
              <SearchField value={search} onChange={setSearch} />
              <FilterSelect
                id="product-filter-lifecycle"
                label={t("productConfig.filters.lifecycle")}
                labelEn={gloss("productConfig.filters.lifecycle")}
                value={lifecycleFilter}
                options={lifecycleOptions}
                optionLabel={(value) => t(`lifecycleStatus.${value}`)}
                onChange={setLifecycleFilter}
                allLabel={t("productConfig.filters.all")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <span className="font-numeric font-semibold text-text-strong">
                  {filteredProducts.length.toLocaleString()}
                </span>
                <span className="text-text-muted"> {t("productConfig.shownLabel")}</span>
                {filtersActive ? (
                  <span className="font-numeric text-text-muted">
                    {" "}
                    {t("productConfig.ofTotal", { count: products.length })}
                  </span>
                ) : null}
              </div>
              {filtersActive ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  <X className="size-3.5" aria-hidden="true" />
                  {t("productConfig.filters.clear")}
                </Button>
              ) : null}
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title={t("productConfig.empty.noMatchTitle")}
              description={t("productConfig.empty.noMatchDescription")}
            />
          ) : (
            <Sheet
              className="min-h-0 flex-1"
              title={t("productConfig.title")}
              titleEn={gloss("productConfig.title")}
              bodyClassName="flex flex-1 min-h-0 flex-col p-0"
            >
              <div
                tabIndex={0}
                className="hmi-scroll min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent)]"
              >
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-surface-card">
                    <ProductsTableHeaderRow />
                  </TableHeader>
                  <TableBody>
                    {filteredProducts.map((product) => (
                      <ProductRow key={product.code} product={product} onOpen={openProduct} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Sheet>
          )}
        </>
      )}

      <CreateProductDialog open={createOpen} onOpenChange={setCreateOpen} existingCodes={existingCodes} />
    </motion.div>
  )
}
