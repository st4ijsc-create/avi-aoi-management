import * as React from "react"
import { motion } from "framer-motion"
import { Download, Info, Loader2, Save } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import {
  buildOeeReportPdfUrl,
  OeeSettingsApiError,
  useFleet,
  useOee,
  useOeeSettings,
  useUpdateOeeSettings,
  type OeeFilter,
} from "@/lib/api"
import { fadeSlideUp, staggerContainer } from "@/theme/motion"
import { OeeLossChart } from "@/components/OeeLossChart"
import { KpiTile, KpiTileSkeleton } from "@/components/KpiTile"
import { Sheet } from "@/components/industrial"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectPortal,
  SelectPositioner,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/ui/status-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

/**
 * Task 13 (WS-A, docs/plans/2026-07-26-ws-a-historian-blueprint.md) — `/reports`: per-machine OEE
 * (Availability/Performance/Quality/OEE% tiles), an honestly-labeled THREE-bucket loss chart
 * (Downtime/Speed/Quality — see `OeeLossChart.tsx`'s own doc comment for why never a finer split),
 * an editable Targets panel (ideal cycle seconds + planned production ratio), and a PDF export link
 * — all over the same durable per-cycle result log Tasks 8/10 already wrote server-side. Same
 * page-header/filter-bar layout `Historian.tsx` (Task 12) established, mirrored here rather than a
 * shared extraction: this screen's filter has no "all machines" concept (OEE math is always
 * computed for exactly one machine at a time) and no verdict/serial filters, so a shared component
 * would need as many escape hatches as it saved.
 */

/**
 * 🔴 OWNER RULING ITEM 2 (2026-08-16), PAID ON THE SURFACE THAT ACTUALLY HOLDS THE NUMBER — BJ-1,
 * 2026-08-23, coordinator under delegation (`docs/owner-decisions.md` item 53).
 *
 * The ruling was "keep the behaviour, PUBLISH the definition, at the place the number is read".
 * AA-1 delivered three sites in `src/` — `OeeResultDto`, `GetOeeFleetAsync`, `BuildReportPdf` — and
 * AA-1's own review round retracted that ceiling as **stated too small**, naming a fourth place
 * closer to the number-holder than any of the three: this screen. It then stood for forty-two
 * tasks, because AA-1 was forbidden to touch `web/` and nobody read the retraction as an address.
 *
 * A supervisor reading `Quality 98.4 %` had no route to the fact that a `Warn` cycle was counted as
 * good, or that a `Skip` cycle is in neither count. That is exactly the person the ruling names.
 *
 * SHAPE, AND WHY THIS ONE. Not headline prose: the ruling asks for the definition to be REACHABLE
 * where the number is, not for the tile to become a paragraph. This is the affordance `/reports`'s
 * sibling screen already uses for an honest limitation — `Audit.tsx`'s `audit.limitation` — an
 * `Info` glyph whose ACCESSIBLE NAME is the whole sentence (so a screen reader gets it on focus,
 * not on hover) with the same text in the visual tooltip. Both halves of the ruling are carried:
 * what the number counts, AND that the formula has no version.
 *
 * 🔴 WHAT HOLDS THIS TEXT TRUE, STATED HONESTLY BECAUSE THE ANSWER IS "less than you would like".
 * The two locale strings are pinned to each other by the type system — `en.ts` is annotated
 * `Dictionary`, which is `typeof vi`, so a missing key is a `tsc -b` error and `npm run build` is
 * a real gate on parity. NOTHING pins them to the C# wording they mirror. There is no CI job for
 * this tree at all (measured: 0 of 7 workflows mention it), and `scripts/verify-suites.sh` compiles
 * no TypeScript. So this text can drift from `HistorianDtos.OeeResultDto` and no instrument in this
 * repository will say a word — the same species as item 36. The mitigation is a pointer, not a
 * witness: the dictionary comment beside each string names its source, and `OeeResultDto`'s doc now
 * names this screen back, so whoever edits either end can find the other.
 */
function OeeDefinitionNote() {
  const t = useT()
  const full = `${t("reports.oeeDefinition.body")} ${t("reports.oeeDefinition.noVersion")}`

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="hmi-micro inline-flex items-center gap-1 self-start text-text-muted outline-none hover:text-text-body focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              aria-label={full}
            />
          }
        >
          <Info className="size-3.5" aria-hidden="true" />
          {t("reports.oeeDefinition.label")}
        </TooltipTrigger>
        <TooltipContent side="bottom">{full}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function DateField({
  id,
  label,
  labelEn,
  value,
  onChange,
}: {
  id: string
  label: string
  labelEn: string
  value: string
  onChange: (v: string) => void
}) {
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
      <Input id={id} type="date" value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-36 text-xs" />
    </div>
  )
}

function MachineSelect({
  value,
  onChange,
  options,
  label,
  labelEn,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
  labelEn: string
}) {
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-col gap-0.5">
        <span className="truncate text-[13px] leading-tight font-medium text-text-body">{label}</span>
        <span className="hmi-micro truncate" aria-hidden="true">
          {labelEn}
        </span>
      </span>
      <Select value={value} onValueChange={(next) => next && onChange(next)}>
        <SelectTrigger aria-label={label} className="h-8 w-44 text-xs">
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectPortal>
          <SelectPositioner>
            <SelectPopup>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </SelectPositioner>
        </SelectPortal>
      </Select>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Targets panel — editable Ideal Cycle Seconds + Planned Production Ratio, saved via
// `useUpdateOeeSettings`. Deliberately only guards against an unparseable NUMBER client-side (never a
// range clamp) — the brief's actual contract is that the SERVER rejects an out-of-range value (400,
// `{ error: "…" }`) and this panel's job is to surface that exact wording inline, not to silently
// pre-empt it the way `MachineSettingsPanel`'s dialog does for its own (differently-scoped) parameter
// edits.
// ─────────────────────────────────────────────────────────────────────────

function TargetsPanel({ machine }: { machine: string }) {
  const t = useT()
  const gloss = useGloss()
  const settings = useOeeSettings(machine)
  const update = useUpdateOeeSettings(machine)

  const [idealCycle, setIdealCycle] = React.useState("")
  const [ratio, setRatio] = React.useState("")
  const [initialized, setInitialized] = React.useState(false)

  // A machine switch invalidates whatever local draft was seeded for the PREVIOUS machine — re-seed
  // from the newly-selected machine's own settings once they resolve.
  React.useEffect(() => {
    setInitialized(false)
    update.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine])

  React.useEffect(() => {
    if (!initialized && settings.data) {
      setIdealCycle(String(settings.data.idealCycleSeconds))
      setRatio(String(settings.data.plannedProductionRatio))
      setInitialized(true)
    }
  }, [initialized, settings.data])

  const parsedIdeal = Number(idealCycle)
  const parsedRatio = Number(ratio)
  const isValidIdeal = idealCycle.trim().length > 0 && Number.isFinite(parsedIdeal)
  const isValidRatio = ratio.trim().length > 0 && Number.isFinite(parsedRatio)

  const serverError =
    update.error instanceof OeeSettingsApiError
      ? (update.error.serverMessage ?? t("reports.targets.saveFailedFallback"))
      : update.isError
        ? t("reports.targets.saveFailedFallback")
        : null

  function handleSave() {
    if (!isValidIdeal || !isValidRatio) return
    update.mutate(
      { idealCycleSecondsOverride: parsedIdeal, plannedProductionRatio: parsedRatio },
      {
        onSuccess: () => toast.success(t("toast.oeeTargetsSaved")),
        onError: () => toast.error(t("toast.oeeTargetsSaveFailed")),
      }
    )
  }

  return (
    <Sheet title={t("reports.targets.title")} titleEn={gloss("reports.targets.title")} bodyClassName="flex flex-col gap-4">
      {settings.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : settings.isError ? (
        <p role="alert" className="text-sm text-danger-text">
          {t("reports.targets.loadFailed")}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="flex flex-col gap-0.5">
                <label htmlFor="reports-ideal-cycle" className="text-xs font-medium text-text-body">
                  {t("reports.targets.idealCycleLabel")}
                </label>
                <span className="hmi-micro" aria-hidden="true">
                  {gloss("reports.targets.idealCycleLabel")}
                </span>
              </span>
              <Input
                id="reports-ideal-cycle"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={idealCycle}
                onChange={(event) => setIdealCycle(event.target.value)}
                aria-invalid={!isValidIdeal ? true : undefined}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex flex-col gap-0.5">
                <label htmlFor="reports-ratio" className="text-xs font-medium text-text-body">
                  {t("reports.targets.ratioLabel")}
                </label>
                <span className="hmi-micro" aria-hidden="true">
                  {gloss("reports.targets.ratioLabel")}
                </span>
              </span>
              <Input
                id="reports-ratio"
                type="number"
                inputMode="decimal"
                step="0.01"
                value={ratio}
                onChange={(event) => setRatio(event.target.value)}
                aria-invalid={!isValidRatio ? true : undefined}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={settings.data?.isOverridden ? "info" : "neutral"}>
              {settings.data?.isOverridden ? t("reports.targets.overridden") : t("reports.targets.baseline")}
            </StatusBadge>
            <Button
              type="button"
              onClick={handleSave}
              disabled={!isValidIdeal || !isValidRatio || update.isPending}
            >
              {update.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Save className="size-3.5" aria-hidden="true" />}
              {update.isPending ? t("reports.targets.saving") : t("reports.targets.save")}
            </Button>
          </div>

          {!isValidIdeal || !isValidRatio ? (
            <p role="alert" className="text-xs font-medium text-danger-text">
              {t("reports.targets.invalidNumber")}
            </p>
          ) : serverError ? (
            <p role="alert" className="border border-danger/30 bg-danger/10 px-2.5 py-2 text-xs font-medium text-danger-text">
              {serverError}
            </p>
          ) : null}
        </>
      )}
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────

export default function Reports() {
  const t = useT()
  const gloss = useGloss()
  const fleet = useFleet()

  const [machine, setMachine] = React.useState("")
  const [machineInitialized, setMachineInitialized] = React.useState(false)
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")

  const machineOptions = React.useMemo(
    () => (fleet.data?.machines ?? []).map((m) => ({ value: m.code, label: m.code })),
    [fleet.data]
  )

  // Defaults to the fleet roster's first machine once it resolves — this screen has no "all
  // machines" concept (OEE is always computed for exactly one), unlike Historian's ALL-default
  // filter. Never fights a later, deliberate user selection (`machineInitialized` latches once).
  React.useEffect(() => {
    if (!machineInitialized && machineOptions.length > 0) {
      setMachine(machineOptions[0].value)
      setMachineInitialized(true)
    }
  }, [machineInitialized, machineOptions])

  const filter: OeeFilter = React.useMemo(
    () => ({ machine: machine || undefined, from: from || undefined, to: to || undefined }),
    [machine, from, to]
  )

  const oee = useOee(machine || undefined, filter.from, filter.to)
  const pdfUrl = buildOeeReportPdfUrl(filter)

  const noMachines = !fleet.isPending && !fleet.isError && machineOptions.length === 0

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
            {t("reports.title")}
          </h1>
          <p className="hmi-micro mt-1">{gloss("reports.title")}</p>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("reports.description")}</p>
        </div>
        {/* Brief: a plain `<a download>` — no fetch/blob code, same idiom `Historian.tsx`'s CSV export
            uses. Disabled (via `aria-disabled` + pointer-events-none, no real `disabled` attribute on
            an anchor) until a machine is selected — `report.pdf` 404s without one. */}
        <a
          href={pdfUrl}
          download
          aria-disabled={!machine ? true : undefined}
          className={buttonVariants({ variant: "outline", className: !machine ? "pointer-events-none opacity-50" : undefined })}
        >
          <Download className="size-3.5" aria-hidden="true" />
          {t("reports.export.pdf")}
        </a>
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-3 border border-border bg-surface-card p-3">
        <MachineSelect
          value={machine}
          onChange={setMachine}
          options={machineOptions}
          label={t("reports.filters.machine")}
          labelEn={gloss("reports.filters.machine")}
        />
        <DateField id="reports-from" label={t("reports.filters.from")} labelEn={gloss("reports.filters.from")} value={from} onChange={setFrom} />
        <DateField id="reports-to" label={t("reports.filters.to")} labelEn={gloss("reports.filters.to")} value={to} onChange={setTo} />
      </div>

      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4">
          {fleet.isPending ? (
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            >
              <KpiTileSkeleton />
              <KpiTileSkeleton />
              <KpiTileSkeleton />
              <KpiTileSkeleton />
            </motion.div>
          ) : noMachines ? (
            <Sheet bodyClassName="flex flex-col items-center justify-center gap-2 px-8 py-16 text-center">
              <p className="text-sm font-medium text-text-strong">{t("reports.empty.noMachines")}</p>
            </Sheet>
          ) : !machine ? null : (
            <>
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
              >
                {oee.isPending ? (
                  <>
                    <KpiTileSkeleton />
                    <KpiTileSkeleton />
                    <KpiTileSkeleton />
                    <KpiTileSkeleton />
                  </>
                ) : oee.data ? (
                  <>
                    <KpiTile
                      label={t("reports.kpi.availability")}
                      labelEn={gloss("reports.kpi.availability")}
                      value={(oee.data.availability * 100).toFixed(1)}
                      unit="%"
                    />
                    <KpiTile
                      label={t("reports.kpi.performance")}
                      labelEn={gloss("reports.kpi.performance")}
                      value={(oee.data.performance * 100).toFixed(1)}
                      unit="%"
                    />
                    <KpiTile
                      label={t("reports.kpi.quality")}
                      labelEn={gloss("reports.kpi.quality")}
                      value={(oee.data.quality * 100).toFixed(1)}
                      unit="%"
                    >
                      <OeeDefinitionNote />
                    </KpiTile>
                    <KpiTile
                      label={t("reports.kpi.oee")}
                      labelEn={gloss("reports.kpi.oee")}
                      value={(oee.data.oee * 100).toFixed(1)}
                      unit="%"
                      gaugePct={oee.data.oee * 100}
                    />
                  </>
                ) : null}
              </motion.div>

              {oee.isError ? <p className="text-sm text-danger-text">{t("reports.loadFailed")}</p> : null}

              {oee.data ? (
                <Sheet title={t("reports.lossChart.title")} titleEn={gloss("reports.lossChart.title")}>
                  <OeeLossChart
                    downtimeLossSeconds={oee.data.downtimeLossSeconds}
                    speedLossSeconds={oee.data.speedLossSeconds}
                    qualityLossSeconds={oee.data.qualityLossSeconds}
                  />
                </Sheet>
              ) : null}

              <TargetsPanel machine={machine} />
            </>
          )}
        </div>
      </div>
    </motion.div>
  )
}
