import * as React from "react"
import { motion } from "framer-motion"
import { ChevronRight, Inbox, Plus, Search, SearchX, Wrench, X } from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { toast } from "sonner"
import { useLocation } from "wouter"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { useRecipes, useSaveRecipe, type Recipe, type RecipeStatus, type RecipeSummary } from "@/lib/configApi"
import { DEFAULT_RECIPE_MACHINE_TYPE } from "@/lib/machineTypes"
import { shortChecksum } from "@/lib/utils"
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
import { RecipeFormFields, type RecipeFormValues } from "@/components/RecipeFormFields"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

// draft = still being authored (info, neutral-attention); active = the version machines resolve to
// (ok); archived = retired, no color urgency — mirrors ProductConfig.tsx's LIFECYCLE_BADGE idiom.
const STATUS_BADGE: Record<RecipeStatus, BadgeStatus> = {
  draft: "info",
  active: "ok",
  archived: "neutral",
}

const STATUS_ORDER: RecipeStatus[] = ["draft", "active", "archived"]

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

/** Plain native `<select>` — same locally-duplicated filter idiom as `ProductConfig.tsx`'s own
 * `FilterSelect` (that component's doc comment explains why this isn't shared). Stacked bilingual
 * label, explicit `id`/`htmlFor` — see `Machines.tsx`'s `FilterSelect` doc comment for why the gloss
 * must sit OUTSIDE the `<label>` element rather than a hidden descendant of it. */
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
        className="h-8 rounded-[var(--radius)] border border-border-strong bg-surface-muted px-2 text-xs text-text-body outline-none transition-colors focus-visible:border-[var(--focus)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]/40"
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
        <label htmlFor="recipe-search" className="truncate text-[13px] leading-tight font-medium text-text-body">
          {t("recipeConfig.search.label")}
        </label>
        <span className="hmi-micro truncate" aria-hidden="true">
          {gloss("recipeConfig.search.label")}
        </span>
      </span>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <Input
          id="recipe-search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={t("recipeConfig.search.placeholder")}
          className="h-8 w-56 pl-7"
        />
      </div>
    </div>
  )
}

function BilingualHead({ vi, en, className }: { vi: string; en: string; className?: string }) {
  return (
    <TableHead className={className}>
      <span className="flex flex-col">
        <span>{vi}</span>
        <span className="hmi-micro font-normal tracking-[0.1em]" aria-hidden="true">
          {en}
        </span>
      </span>
    </TableHead>
  )
}

function RecipesTableHeaderRow() {
  const t = useT()
  const gloss = useGloss()
  return (
    <TableRow>
      <BilingualHead vi={t("recipeConfig.table.code")} en={gloss("recipeConfig.table.code")} />
      <BilingualHead vi={t("recipeConfig.table.name")} en={gloss("recipeConfig.table.name")} />
      <BilingualHead vi={t("recipeConfig.table.machineType")} en={gloss("recipeConfig.table.machineType")} />
      <BilingualHead vi={t("recipeConfig.table.status")} en={gloss("recipeConfig.table.status")} />
      <BilingualHead vi={t("recipeConfig.table.version")} en={gloss("recipeConfig.table.version")} />
      <BilingualHead vi={t("recipeConfig.table.checksum")} en={gloss("recipeConfig.table.checksum")} />
      <TableHead className="w-8">
        <span className="sr-only">{t("recipeConfig.table.viewAction")}</span>
      </TableHead>
    </TableRow>
  )
}

function RecipeRowSkeleton() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-40" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-24" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-16" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-8" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-4 w-20" />
      </TableCell>
      <TableCell>
        <Skeleton className="size-4" />
      </TableCell>
    </TableRow>
  )
}

interface RecipeRowProps {
  recipe: RecipeSummary
  onOpen: (code: string) => void
}

/** One catalog row — whole-row click/keyboard target, same pattern as `ProductConfig.tsx`'s `ProductRow`. */
function RecipeRow({ recipe, onOpen }: RecipeRowProps) {
  const t = useT()

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableRowElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen(recipe.code)
    }
  }

  return (
    <TableRow
      onClick={() => onOpen(recipe.code)}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={t("recipeConfig.table.rowAria", { code: recipe.code })}
      className="cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600/50"
    >
      <TableCell className="font-numeric font-medium text-text-strong">{recipe.code}</TableCell>
      <TableCell className="text-text-body">{recipe.name}</TableCell>
      <TableCell className="text-text-body">{recipe.machineType ?? "—"}</TableCell>
      <TableCell>
        <StatusBadge status={STATUS_BADGE[recipe.status]}>{t(`recipeStatus.${recipe.status}`)}</StatusBadge>
      </TableCell>
      <TableCell className="font-numeric text-text-muted">{t("recipeConfig.versionShort", { version: recipe.version })}</TableCell>
      <TableCell className="font-mono text-xs text-text-muted">{shortChecksum(recipe.checksum)}</TableCell>
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

/** Same visual shape as `ProductConfig.tsx`'s own `EmptyState`. */
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

const EMPTY_FORM: RecipeFormValues = {
  name: "",
  machineType: DEFAULT_RECIPE_MACHINE_TYPE,
  status: "draft",
}

interface CreateRecipeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingCodes: Set<string>
}

function CreateRecipeDialog({ open, onOpenChange, existingCodes }: CreateRecipeDialogProps) {
  const t = useT()
  const saveRecipe = useSaveRecipe()
  const [code, setCode] = React.useState("")
  const [form, setForm] = React.useState<RecipeFormValues>(EMPTY_FORM)
  const [error, setError] = React.useState<string | null>(null)

  // Reset to a blank form every time the dialog re-opens — same idiom as ProductConfig.tsx's
  // CreateProductDialog, so a half-filled leftover from a cancelled attempt never lingers.
  React.useEffect(() => {
    if (open) {
      setCode("")
      setForm(EMPTY_FORM)
      setError(null)
    }
  }, [open])

  function updateForm<K extends keyof RecipeFormValues>(key: K, value: RecipeFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmedCode = code.trim()
    const trimmedName = form.name.trim()

    if (!trimmedCode) {
      setError(t("recipeConfig.createDialog.codeRequired"))
      return
    }
    if (existingCodes.has(trimmedCode.toLowerCase())) {
      setError(t("recipeConfig.createDialog.codeDuplicate", { code: trimmedCode }))
      return
    }
    if (!trimmedName) {
      setError(t("recipeConfig.createDialog.nameRequired"))
      return
    }
    setError(null)

    const body: Recipe = {
      code: trimmedCode,
      name: trimmedName,
      machineType: form.machineType || null,
      version: 1,
      payload: {},
      checksum: null,
      status: form.status,
    }

    saveRecipe.mutate(
      { code: trimmedCode, recipe: body },
      {
        onSuccess: (data) => {
          toast.success(t("toast.recipeCreated", { code: data.code }))
          onOpenChange(false)
        },
        onError: () => toast.error(t("recipeConfig.createDialog.createFailed")),
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("recipeConfig.createDialog.title")}</DialogTitle>
            <DialogDescription>{t("recipeConfig.createDialog.description")}</DialogDescription>
          </DialogHeader>

          <div
            tabIndex={0}
            className="hmi-scroll max-h-[60vh] overflow-y-auto pr-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
          >
            <div className="flex flex-col gap-4">
              <FormFieldCode value={code} onChange={setCode} />
              <RecipeFormFields values={form} onChange={updateForm} idPrefix="create-recipe" />
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-danger-text">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("recipeConfig.createDialog.cancel")}
            </Button>
            <Button type="submit" disabled={saveRecipe.isPending}>
              {saveRecipe.isPending ? t("recipeConfig.createDialog.submitting") : t("recipeConfig.createDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Small standalone wrapper (not `FormField` re-imported at call site just for one field) for the
 * create dialog's `code` input — kept local since only this dialog needs it, same as
 * `ProductConfig.tsx`'s `CreateProductDialog` inlines its own code field rather than folding it into
 * `RecipeFormFields` (code is immutable-after-create, so it doesn't belong in the shared edit form). */
function FormFieldCode({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT()
  return (
    <label className="flex flex-col gap-1.5" htmlFor="create-recipe-code">
      <span className="text-xs font-medium text-text-body">{t("recipeConfig.createDialog.codeLabel")}</span>
      <Input
        id="create-recipe-code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("recipeConfig.createDialog.codePlaceholder")}
        maxLength={40}
        autoFocus
      />
      <span className="text-[11px] text-text-muted">{t("recipeConfig.createDialog.codeHint")}</span>
    </label>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

export default function RecipeConfig() {
  const t = useT()
  const gloss = useGloss()
  const { data, isPending, isError } = useRecipes()
  const [, navigate] = useLocation()

  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState(ALL)
  const [createOpen, setCreateOpen] = React.useState(false)

  const recipes = React.useMemo(() => data ?? [], [data])
  const existingCodes = React.useMemo(() => new Set(recipes.map((r) => r.code.toLowerCase())), [recipes])
  const openRecipe = React.useCallback((code: string) => navigate(`/recipes/${code}`), [navigate])

  const statusOptions = React.useMemo(
    () => STATUS_ORDER.filter((s) => recipes.some((r) => r.status === s)),
    [recipes]
  )

  // Self-correcting idiom mirroring ProductConfig.tsx's lifecycleFilter effect — a selected status can
  // fall out of the option set if every recipe carrying it gets edited/deleted out from under it.
  React.useEffect(() => {
    if (statusFilter !== ALL && !statusOptions.includes(statusFilter as RecipeStatus)) {
      setStatusFilter(ALL)
    }
  }, [statusFilter, statusOptions])

  const filtersActive = search.trim() !== "" || statusFilter !== ALL

  const filteredRecipes = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return recipes.filter((r) => {
      if (
        query &&
        !r.code.toLowerCase().includes(query) &&
        !r.name.toLowerCase().includes(query) &&
        !(r.machineType ?? "").toLowerCase().includes(query)
      )
        return false
      if (statusFilter !== ALL && r.status !== statusFilter) return false
      return true
    })
  }, [recipes, search, statusFilter])

  const clearFilters = React.useCallback(() => {
    setSearch("")
    setStatusFilter(ALL)
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
          <ConfigModeToggle current="recipes" className="mb-1" />
          <div className="flex items-center gap-2">
            <Wrench className="size-5 text-primary-text" aria-hidden="true" />
            <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
              {t("recipeConfig.title")}
            </h1>
          </div>
          <p className="hmi-micro mt-1">{gloss("recipeConfig.title")}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("recipeConfig.description")}</p>
        </div>
        <div className="flex items-center gap-3">
          {!isPending && !isError ? (
            <StatusBadge status="neutral">{t("recipeConfig.countLabel", { count: recipes.length })}</StatusBadge>
          ) : null}
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            {t("recipeConfig.createBtn")}
          </Button>
        </div>
      </div>

      <p className="shrink-0 border border-info/20 bg-info/10 px-3 py-2 text-xs text-info-text">
        {t("recipeConfig.demoOnlyNote")}
      </p>

      {isPending ? (
        <Sheet className="min-h-0 flex-1" bodyClassName="flex flex-1 min-h-0 flex-col p-0">
          <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
            <Table>
              <TableHeader>
                <RecipesTableHeaderRow />
              </TableHeader>
              <TableBody>
                {Array.from({ length: 3 }, (_, i) => (
                  <RecipeRowSkeleton key={i} />
                ))}
              </TableBody>
            </Table>
          </div>
        </Sheet>
      ) : isError ? (
        <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
      ) : recipes.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={t("recipeConfig.empty.noRecipesTitle")}
          description={t("recipeConfig.empty.noRecipesDescription")}
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-3.5" aria-hidden="true" />
              {t("recipeConfig.createBtn")}
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-3 border border-border bg-surface-card p-3">
            <div className="flex flex-wrap items-end gap-3">
              <SearchField value={search} onChange={setSearch} />
              <FilterSelect
                id="recipe-filter-status"
                label={t("recipeConfig.filters.status")}
                labelEn={gloss("recipeConfig.filters.status")}
                value={statusFilter}
                options={statusOptions}
                optionLabel={(value) => t(`recipeStatus.${value}`)}
                onChange={setStatusFilter}
                allLabel={t("recipeConfig.filters.all")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="text-sm">
                <span className="font-numeric font-semibold text-text-strong">{filteredRecipes.length.toLocaleString()}</span>
                <span className="text-text-muted"> {t("recipeConfig.shownLabel")}</span>
                {filtersActive ? (
                  <span className="font-numeric text-text-muted"> {t("recipeConfig.ofTotal", { count: recipes.length })}</span>
                ) : null}
              </div>
              {filtersActive ? (
                <Button size="sm" variant="outline" onClick={clearFilters}>
                  <X className="size-3.5" aria-hidden="true" />
                  {t("recipeConfig.filters.clear")}
                </Button>
              ) : null}
            </div>
          </div>

          {filteredRecipes.length === 0 ? (
            <EmptyState icon={SearchX} title={t("recipeConfig.empty.noMatchTitle")} description={t("recipeConfig.empty.noMatchDescription")} />
          ) : (
            <Sheet
              className="min-h-0 flex-1"
              title={t("recipeConfig.title")}
              titleEn={gloss("recipeConfig.title")}
              bodyClassName="flex flex-1 min-h-0 flex-col p-0"
            >
              <div
                tabIndex={0}
                className="hmi-scroll min-h-0 flex-1 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
              >
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-surface-card">
                    <RecipesTableHeaderRow />
                  </TableHeader>
                  <TableBody>
                    {filteredRecipes.map((recipe) => (
                      <RecipeRow key={recipe.code} recipe={recipe} onOpen={openRecipe} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Sheet>
          )}
        </>
      )}

      <CreateRecipeDialog open={createOpen} onOpenChange={setCreateOpen} existingCodes={existingCodes} />
    </motion.div>
  )
}
