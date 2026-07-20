import * as React from "react"
import { motion } from "framer-motion"
import {
  ArrowLeft,
  Info,
  Loader2,
  RefreshCw,
  Save,
  ServerCrash,
  Trash2,
  Wrench,
} from "lucide-react"
import type { VariantProps } from "class-variance-authority"
import { toast } from "sonner"
import { Link, useLocation, useParams } from "wouter"

import { useT } from "@/i18n"
import { useFleet } from "@/lib/api"
import {
  EngineApiError,
  useDeleteRecipe,
  useMachineConfigCheck,
  useRecipe,
  useSaveRecipe,
  type Recipe,
  type RecipeStatus,
} from "@/lib/configApi"
import { shortChecksum } from "@/lib/utils"
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
import { RecipeFormFields, type RecipeFormValues } from "@/components/RecipeFormFields"
import { payloadsEqual, RecipePayloadEditor } from "@/components/RecipePayloadEditor"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type statusBadgeVariants } from "@/components/ui/status-badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type BadgeStatus = NonNullable<VariantProps<typeof statusBadgeVariants>["status"]>

const STATUS_BADGE: Record<RecipeStatus, BadgeStatus> = {
  draft: "info",
  active: "ok",
  archived: "neutral",
}

const DRIFT_BADGE: Record<string, BadgeStatus> = {
  in_sync: "ok",
  drift: "warn",
  unknown: "neutral",
}

function toFormValues(recipe: Recipe): RecipeFormValues {
  return {
    name: recipe.name,
    machineType: recipe.machineType ?? "",
    status: recipe.status,
  }
}

function formsEqual(a: RecipeFormValues, b: RecipeFormValues): boolean {
  return a.name === b.name && a.machineType === b.machineType && a.status === b.status
}

function BackLink() {
  const t = useT()
  return (
    <Link
      href="/recipes"
      className="inline-flex w-fit items-center gap-1.5 rounded-md text-sm text-text-muted transition-colors hover:text-navy-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-600"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      {t("recipeConfigDetail.back")}
    </Link>
  )
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3.5 w-48" />
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
            <h1 className="text-lg font-semibold text-text-strong">{t("recipeConfigDetail.notFoundState.title")}</h1>
            <p className="text-sm text-text-muted">{t("recipeConfigDetail.notFoundState.description", { code })}</p>
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
// "Recipe" tab — info fields + payload editor, one whole-aggregate PUT (see UpsertRecipe's own doc
// comment in ProductConfigStore.cs: like UpsertProduct, this REPLACES the stored record and leaves
// `version` fully to the caller — it's never auto-bumped server-side the way a point edit bumps a
// product's pointsConfigVersion). This form bumps `version` by 1 on every save that actually changed
// something, so a machine's later drift-check has something real to notice; `checksum` is left for the
// server to recompute (`Recipe.RecomputeChecksum`, called unconditionally inside `UpsertRecipe`) —
// whatever this form sends for `checksum` is ignored, only the server's returned value is ever shown.
// ─────────────────────────────────────────────────────────────────────────

function DeleteRecipeDialog({
  open,
  onOpenChange,
  recipe,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipe: Recipe
}) {
  const t = useT()
  const [, navigate] = useLocation()
  const deleteRecipe = useDeleteRecipe()

  function handleDelete() {
    deleteRecipe.mutate(recipe.code, {
      onSuccess: () => {
        toast.success(t("toast.recipeDeleted", { code: recipe.code }))
        navigate("/recipes")
      },
      onError: () => toast.error(t("recipeConfigDetail.info.deleteFailed")),
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("recipeConfigDetail.info.deleteConfirmTitle", { code: recipe.code })}</DialogTitle>
          <DialogDescription>{t("recipeConfigDetail.info.deleteConfirmDescription", { name: recipe.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("recipeConfigDetail.info.deleteConfirmCancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteRecipe.isPending}>
            {deleteRecipe.isPending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-3.5" aria-hidden="true" />
            )}
            {deleteRecipe.isPending ? t("recipeConfigDetail.info.deleting") : t("recipeConfigDetail.info.deleteConfirmSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecipeEditorTab({ recipe }: { recipe: Recipe }) {
  const t = useT()
  const saveRecipe = useSaveRecipe()
  const [form, setForm] = React.useState<RecipeFormValues>(() => toFormValues(recipe))
  const [workingPayload, setWorkingPayload] = React.useState<Record<string, unknown>>(recipe.payload)
  const [nameError, setNameError] = React.useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = React.useState(false)

  const serverValues = toFormValues(recipe)
  const dirty = !formsEqual(form, serverValues) || !payloadsEqual(workingPayload, recipe.payload)

  function updateForm<K extends keyof RecipeFormValues>(key: K, value: RecipeFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleSave() {
    const trimmedName = form.name.trim()
    if (!trimmedName) {
      setNameError(t("recipeConfigDetail.info.nameRequired"))
      return
    }
    setNameError(null)

    const body: Recipe = {
      ...recipe,
      name: trimmedName,
      machineType: form.machineType || null,
      status: form.status,
      payload: workingPayload,
      version: recipe.version + 1,
    }

    saveRecipe.mutate(
      { code: recipe.code, recipe: body },
      {
        onSuccess: () => toast.success(t("toast.recipeSaved")),
        onError: () => toast.error(t("recipeConfigDetail.info.saveFailed")),
      }
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg border border-info/20 bg-info/10 px-3 py-2 text-xs text-info-text">
        {t("recipeConfigDetail.demoOnlyNote")}
      </p>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Info className="size-4 text-navy-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("recipeConfigDetail.info.title")}</h2>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-text-body">{t("recipeConfigDetail.info.codeLabel")}</span>
            <span className="font-numeric w-fit rounded-md bg-surface-subtle px-2.5 py-1 text-sm text-text-strong">
              {recipe.code}
            </span>
          </div>

          <RecipeFormFields values={form} onChange={updateForm} idPrefix="edit-recipe" />
          {nameError ? (
            <p role="alert" className="text-sm text-danger-text">
              {nameError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-navy-600" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("recipeConfigDetail.payload.title")}</h2>
          </div>
          <p className="text-sm text-text-muted">{t("recipeConfigDetail.payload.description")}</p>

          <RecipePayloadEditor
            machineType={form.machineType || null}
            initialPayload={recipe.payload}
            onChange={setWorkingPayload}
            idPrefix="edit-recipe"
          />
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={handleSave} disabled={!dirty || saveRecipe.isPending}>
          {saveRecipe.isPending ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-3.5" aria-hidden="true" />
          )}
          {saveRecipe.isPending ? t("recipeConfigDetail.info.saving") : t("recipeConfigDetail.info.save")}
        </Button>
        <span className="text-xs text-text-muted">
          {dirty ? t("recipeConfigDetail.info.dirty") : t("recipeConfigDetail.info.clean")}
        </span>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-danger-text" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-text-strong">{t("recipeConfigDetail.info.dangerZoneTitle")}</h2>
          </div>
          <p className="text-sm text-text-muted">{t("recipeConfigDetail.info.dangerZoneHint")}</p>
          <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)} className="w-fit">
            <Trash2 className="size-3.5" aria-hidden="true" />
            {t("recipeConfigDetail.info.deleteBtn")}
          </Button>
        </CardContent>
      </Card>

      <DeleteRecipeDialog open={deleteOpen} onOpenChange={setDeleteOpen} recipe={recipe} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// "Đồng bộ" tab — recipe drift check against the Demo simulated ecosystem, same
// `GET /v1/machines/{code}/config/check` seam `ProductConfigDetail.tsx`'s own sync tab uses for
// points. For an Automation/IoT machine the engine resolves this by MACHINE TYPE
// (`ConfigSyncEngine.CheckAsync`'s `CheckRecipeAsync(null, machine.MachineType, ct)`), not by this
// specific recipe code — so the result can legitimately name a DIFFERENT recipe than the one open here
// (whichever recipe currently resolves for that machine's type). Task C7 owns the full pull/push/diff
// UI on `MachineDetail.tsx`'s "Cấu hình" tab; this stays a read-only check, matching the honesty note
// above (a Live push from here is Demo-only — Live pull happens at the machine, not here).
// ─────────────────────────────────────────────────────────────────────────

function RecipeSyncTab({ code }: { code: string }) {
  const t = useT()
  const { data: fleet, isPending: fleetPending } = useFleet()
  const [selectedMachine, setSelectedMachine] = React.useState("")
  const [hasChecked, setHasChecked] = React.useState(false)

  const recipeMachines = React.useMemo(
    () => (fleet?.machines ?? []).filter((m) => m.deviceClass === "Automation" || m.deviceClass === "Iot"),
    [fleet]
  )

  const check = useMachineConfigCheck(hasChecked ? selectedMachine : undefined)
  const recipeDrift = check.data?.recipe ?? null

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
          <h2 className="text-sm font-semibold text-text-strong">{t("recipeConfigDetail.sync.title")}</h2>
        </div>
        <p className="text-sm text-text-muted">{t("recipeConfigDetail.sync.description")}</p>

        {!fleetPending && recipeMachines.length === 0 ? (
          <p className="text-sm text-text-muted">{t("recipeConfigDetail.sync.noMachines")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold tracking-wide text-text-muted uppercase">
                  {t("recipeConfigDetail.sync.machineLabel")}
                </span>
                <select
                  value={selectedMachine}
                  onChange={(event) => handleMachineChange(event.target.value)}
                  className="h-8 w-48 rounded-lg border border-input bg-transparent px-2 text-sm text-text-body outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="">{t("recipeConfigDetail.sync.machinePlaceholder")}</option>
                  {recipeMachines.map((machine) => (
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
                {check.isFetching ? t("recipeConfigDetail.sync.checking") : t("recipeConfigDetail.sync.checkBtn")}
              </Button>
            </div>

            {check.isError ? (
              <p role="alert" className="text-sm text-danger-text">
                {t("recipeConfigDetail.sync.checkFailed")}
              </p>
            ) : null}

            {hasChecked && !check.isFetching && !check.isError ? (
              recipeDrift ? (
                <div className="flex flex-col gap-3 rounded-lg border border-border p-3" role="status">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-muted">{t("recipeConfigDetail.sync.resultState")}</span>
                    <StatusBadge status={DRIFT_BADGE[recipeDrift.driftState] ?? "neutral"}>
                      {t(`productConfigDetail.sync.driftState.${recipeDrift.driftState}`)}
                    </StatusBadge>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-xs">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-text-muted">{t("recipeConfigDetail.sync.resultResolvedCode")}</dt>
                      <dd className="font-numeric font-medium text-text-strong">{recipeDrift.code}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-text-muted">{t("recipeConfigDetail.sync.resultResolvedBy")}</dt>
                      <dd className="font-numeric font-medium text-text-strong">
                        {t(`recipeConfigDetail.sync.resolvedBy.${recipeDrift.resolvedBy}`)}
                      </dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-text-muted">{t("recipeConfigDetail.sync.resultLocalVersion")}</dt>
                      <dd className="font-numeric font-medium text-text-strong">{recipeDrift.localVersion ?? "—"}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-text-muted">{t("recipeConfigDetail.sync.resultEcosystemVersion")}</dt>
                      <dd className="font-numeric font-medium text-text-strong">{recipeDrift.ecosystemVersion}</dd>
                    </div>
                  </dl>
                  {recipeDrift.code.toLowerCase() !== code.toLowerCase() ? (
                    <p className="text-[11px] text-text-muted">
                      {t("recipeConfigDetail.sync.differentCodeNote", { machineCode: selectedMachine, resolvedCode: recipeDrift.code })}
                    </p>
                  ) : null}
                  <Link href={`/machines/${selectedMachine}`} className="text-sm text-primary-text underline-offset-4 hover:underline">
                    {t("recipeConfigDetail.sync.viewMachineLink", { code: selectedMachine })}
                  </Link>
                </div>
              ) : (
                <p className="text-sm text-text-muted">{t("recipeConfigDetail.sync.noRecipeResolved")}</p>
              )
            ) : null}

            <p className="text-[11px] text-text-muted">{t("recipeConfigDetail.sync.seamNote")}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Body / route
// ─────────────────────────────────────────────────────────────────────────

function RecipeConfigDetailBody({ recipe }: { recipe: Recipe }) {
  const t = useT()

  return (
    <motion.div
      key={recipe.code}
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex flex-1 flex-col gap-6 p-6 lg:p-8"
    >
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-navy-600/10">
            <Wrench className="size-5 text-navy-600" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-text-strong">{recipe.code}</h1>
              <StatusBadge status={STATUS_BADGE[recipe.status]}>{t(`recipeStatus.${recipe.status}`)}</StatusBadge>
            </div>
            <p className="text-sm text-text-muted">
              {recipe.name} {recipe.machineType ? `· ${recipe.machineType}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <StatusBadge status="neutral">{t("recipeConfigDetail.versionBadge", { version: recipe.version })}</StatusBadge>
          <span
            className="font-mono text-[11px] text-text-muted"
            title={recipe.checksum ?? t("recipeConfigDetail.noChecksum")}
          >
            {t("recipeConfigDetail.checksumLabel")} {shortChecksum(recipe.checksum)}
          </span>
        </div>
      </div>

      <Card className="p-1">
        <CardContent className="pt-3">
          <Tabs defaultValue="recipe">
            <TabsList>
              <TabsTrigger value="recipe">
                <Wrench className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("recipeConfigDetail.tabs.recipe")}
              </TabsTrigger>
              <TabsTrigger value="sync">
                <RefreshCw className="size-3.5" aria-hidden="true" data-icon="inline-start" />
                {t("recipeConfigDetail.tabs.sync")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="recipe" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <RecipeEditorTab recipe={recipe} />
              </motion.div>
            </TabsContent>

            <TabsContent value="sync" className="pt-4">
              <motion.div initial="hidden" animate="visible" variants={fadeSlideUp}>
                <RecipeSyncTab code={recipe.code} />
              </motion.div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default function RecipeConfigDetail() {
  const { code } = useParams<{ code: string }>()
  const { data, isPending, isError, error } = useRecipe(code)

  if (!code) return <ConnectivityErrorState />
  if (isPending) return <DetailSkeleton />

  if (isError) {
    const notFound = error instanceof EngineApiError && error.status === 404
    return notFound ? <NotFoundState code={code} /> : <ConnectivityErrorState />
  }

  if (!data) return <DetailSkeleton />

  // `key={data.code}` forces `RecipeConfigDetailBody` (and, inside it, `RecipePayloadEditor`'s own
  // seed-once row state) to remount when the route param changes to a DIFFERENT recipe — same idiom
  // `ProductConfigDetail.tsx` uses for `ProductConfigDetailBody`.
  return <RecipeConfigDetailBody key={data.code} recipe={data} />
}
