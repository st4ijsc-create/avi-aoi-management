import * as React from "react"
import { motion } from "framer-motion"
import {
  AlertTriangle,
  FolderInput,
  Gauge,
  Loader2,
  Radio,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { toast } from "sonner"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import {
  useApplyScenario,
  useApplyScenarioPreset,
  useBurstScenario,
  useScenario,
  type ScenarioInput,
} from "@/lib/api"
import { cn } from "@/lib/utils"
import { fadeSlideUp } from "@/theme/motion"
import { Sheet } from "@/components/industrial"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { StatusBadge } from "@/components/ui/status-badge"
import { Switch } from "@/components/ui/switch"

// How long after a local slider edit to ignore the ~1s poll's echoed values — long enough to cover
// the debounced mutation's own round trip, short enough that a server-side change (another client, or
// Burst's automatic revert ~4s later) still reaches this screen promptly.
const LOCAL_EDIT_COOLDOWN_MS = 1200
const APPLY_DEBOUNCE_MS = 200

/** Raw server preset name (kebab-case) → i18n dictionary key segment (camelCase, under
 * `scenario.presets.*`) + icon. Label/description are resolved through `t()` at render time so they
 * follow the active language; an unrecognized preset name (a future server addition this build
 * doesn't know about yet) falls back to the raw name + a generic "custom preset" description. */
const PRESET_META: Record<string, { i18nKey: string; icon: LucideIcon }> = {
  normal: { i18nKey: "normal", icon: Gauge },
  "high-defect": { i18nKey: "highDefect", icon: AlertTriangle },
  "sensor-drift": { i18nKey: "sensorDrift", icon: Radio },
  "network-outage": { i18nKey: "networkOutage", icon: WifiOff },
  "hotfolder-aoi": { i18nKey: "hotfolderAoi", icon: FolderInput },
}

function formatMultiplier(n: number): string {
  return `${n.toFixed(2)}x`
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`
}

interface SliderRowProps {
  label: string
  displayValue: string
  value: number
  min: number
  max: number
  step: number
  ariaLabel: string
  onValueChange: (value: number) => void
  onValueCommitted: (value: number) => void
}

function SliderRow({ label, displayValue, value, min, max, step, ariaLabel, onValueChange, onValueCommitted }: SliderRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-body">{label}</span>
        {/* `text-primary-text` (not `text-navy-700`) — navy-700 is a fixed brand-scale color with no
            dark override, so on a dark navy-800 card it measured 1.23:1 (axe `color-contrast`, nearly
            invisible). `--primary-text` is this design system's own token for brand-accent text that
            stays readable on both surfaces (index.css). */}
        <span className="font-heading font-numeric text-base font-semibold text-primary-text">{displayValue}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={ariaLabel}
        onValueChange={(next) => onValueChange(next as number)}
        onValueCommitted={(next) => onValueCommitted(next as number)}
      />
    </div>
  )
}

interface PresetCardProps {
  name: string
  active: boolean
  pending: boolean
  onApply: () => void
}

function PresetCard({ name, active, pending, onApply }: PresetCardProps) {
  const t = useT()
  const meta = PRESET_META[name]
  const Icon = meta?.icon ?? SlidersHorizontal
  const label = meta ? t(`scenario.presets.${meta.i18nKey}.label`) : name
  const description = meta ? t(`scenario.presets.${meta.i18nKey}.description`) : t("scenario.presetCustomDescription")
  return (
    <button
      type="button"
      onClick={onApply}
      disabled={pending}
      aria-pressed={active}
      className={cn(
        "flex flex-col items-start gap-2 border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50 disabled:cursor-not-allowed disabled:opacity-60",
        // `bg-navy-600/10` (not `bg-navy-50`) — a translucent tint over whatever surface it sits on,
        // so the "selected" card reads as a subtle brand tint in both themes instead of `navy-50`'s
        // flat near-white fill, which stayed near-white even under dark mode (no dark override on the
        // raw navy scale) — a jarring light card floating in the dark UI.
        active ? "border-navy-600 bg-navy-600/10" : "border-border-strong bg-surface-base hover:bg-surface-subtle"
      )}
    >
      <div className="flex w-full items-center justify-between">
        <Icon className={cn("size-4", active ? "text-primary-text" : "text-text-muted")} aria-hidden="true" />
        {pending ? <Loader2 className="size-3.5 animate-spin text-primary-text" aria-hidden="true" /> : null}
      </div>
      <span className={cn("font-heading text-sm font-semibold tracking-wide uppercase", active ? "text-primary-text" : "text-text-strong")}>
        {label}
      </span>
      {/* `text-primary-text` (not `text-text-muted`) when active — same fix/reasoning as this
          button's own className comment above and Settings.tsx's ModeSelector hint span: axe
          measured 4.4:1 for `text-text-muted` on the active `bg-navy-600/10` tint (Task 10). */}
      <span className={cn("text-xs", active ? "text-primary-text" : "text-text-muted")}>{description}</span>
    </button>
  )
}

function ScenarioSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6 lg:p-8">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  )
}

export default function Scenario() {
  const t = useT()
  const gloss = useGloss()
  const scenarioQuery = useScenario()
  const applyScenario = useApplyScenario()
  const applyPreset = useApplyScenarioPreset()
  const burst = useBurstScenario()

  const [cycleRate, setCycleRate] = React.useState(1)
  const [defectRate, setDefectRate] = React.useState(0)
  const [faultRate, setFaultRate] = React.useState(0)
  const [networkOutage, setNetworkOutage] = React.useState(false)
  const [hotFolderStatus, setHotFolderStatus] = React.useState<string | null>(null)
  const [pendingPreset, setPendingPreset] = React.useState<string | null>(null)

  const latestRef = React.useRef<ScenarioInput>({ cycleRate: 1, defectRate: 0, faultRate: 0, networkOutage: false })
  const lastEditAtRef = React.useRef(0)
  const debounceRef = React.useRef<number | null>(null)
  const syncedOnceRef = React.useRef(false)

  const applyAll = React.useCallback((next: Partial<ScenarioInput>) => {
    const merged = { ...latestRef.current, ...next }
    latestRef.current = merged
    lastEditAtRef.current = Date.now()
    return merged
  }, [])

  const applyDebounced = React.useCallback(
    (next: Partial<ScenarioInput>) => {
      const merged = applyAll(next)
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null
        applyScenario.mutate(merged)
      }, APPLY_DEBOUNCE_MS)
    },
    [applyAll, applyScenario]
  )

  const applyImmediate = React.useCallback(
    (next: Partial<ScenarioInput>) => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const merged = applyAll(next)
      applyScenario.mutate(merged)
    },
    [applyAll, applyScenario]
  )

  // Sync local slider state from the polled server snapshot — skipped for a short cooldown after any
  // local edit (see LOCAL_EDIT_COOLDOWN_MS) so a mid-drag poll tick can't yank the thumb back under the
  // user's pointer. TanStack Query's structural sharing already means `scenarioQuery.data` only gets a
  // new reference when something actually changed content-wise, so this effect is a no-op on most polls.
  React.useEffect(() => {
    const current = scenarioQuery.data?.current
    if (!current) return
    if (syncedOnceRef.current && Date.now() - lastEditAtRef.current < LOCAL_EDIT_COOLDOWN_MS) return

    syncedOnceRef.current = true
    setCycleRate(current.cycleRate)
    setDefectRate(current.defectRate)
    setFaultRate(current.faultRate)
    setNetworkOutage(current.networkOutage)
    latestRef.current = {
      cycleRate: current.cycleRate,
      defectRate: current.defectRate,
      faultRate: current.faultRate,
      networkOutage: current.networkOutage,
    }
  }, [scenarioQuery.data])

  React.useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    },
    []
  )

  const handlePreset = (name: string) => {
    setPendingPreset(name)
    const meta = PRESET_META[name]
    const presetLabel = meta ? t(`scenario.presets.${meta.i18nKey}.label`) : name
    applyPreset.mutate(name, {
      onSuccess: (data) => {
        lastEditAtRef.current = Date.now()
        setCycleRate(data.scenario.cycleRate)
        setDefectRate(data.scenario.defectRate)
        setFaultRate(data.scenario.faultRate)
        setNetworkOutage(data.scenario.networkOutage)
        latestRef.current = {
          cycleRate: data.scenario.cycleRate,
          defectRate: data.scenario.defectRate,
          faultRate: data.scenario.faultRate,
          networkOutage: data.scenario.networkOutage,
        }
        if (data.hotFolderStatus) setHotFolderStatus(data.hotFolderStatus)
        toast.success(t("toast.scenarioPresetApplied", { name: presetLabel }))
      },
      onSettled: () => setPendingPreset(null),
    })
  }

  const handleBurst = () => {
    burst.mutate(undefined, {
      onSuccess: (data) => {
        lastEditAtRef.current = Date.now()
        setCycleRate(data.cycleRate)
        setDefectRate(data.defectRate)
        setFaultRate(data.faultRate)
        setNetworkOutage(data.networkOutage)
        latestRef.current = {
          cycleRate: data.cycleRate,
          defectRate: data.defectRate,
          faultRate: data.faultRate,
          networkOutage: data.networkOutage,
        }
        toast.success(t("toast.scenarioBurstApplied"))
      },
    })
  }

  if (scenarioQuery.isPending) return <ScenarioSkeleton />

  if (scenarioQuery.isError) {
    return (
      <motion.div initial="hidden" animate="visible" variants={fadeSlideUp} className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
        <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">{t("scenario.title")}</h1>
        <p className="text-sm text-danger-text">{t("common.connectivityError")}</p>
      </motion.div>
    )
  }

  const current = scenarioQuery.data?.current
  const presets = scenarioQuery.data?.presets ?? []

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeSlideUp}
      className="flex h-full min-h-0 flex-col gap-4 p-4 lg:p-6"
    >
      <div className="flex shrink-0 flex-col gap-1">
        <h1 className="font-heading text-[26px] leading-none font-semibold tracking-tight text-text-strong">
          {t("scenario.title")}
        </h1>
        <p className="hmi-micro mt-1">{gloss("scenario.title")}</p>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">{t("scenario.subtitle")}</p>
      </div>

      {/* Everything below the header scrolls INSIDE this one wrapper (spec §8 — the page itself never
          scrolls); the shell's own `<main>` carries `overflow-y-auto` (Shell.tsx), so without an
          `h-full min-h-0` root constraining this route to the shell's available height, the route grows
          past the viewport and `<main>` scrolls the whole page instead — the H3c bug this fixes (the
          preset cards clipped at the bottom at 1280×800 with no way to reach them). Same pattern as
          `Dashboard.tsx`/`Machines.tsx`'s own `hmi-scroll min-h-0 flex-1 overflow-y-auto` body wrapper. */}
      <div className="hmi-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-4">
          {/* Live fleet state — the status ramp used here is a genuine state readout (the active
              preset's own consequence on the running fleet), not decoration (spec §2). */}
          <Sheet bodyClassName="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] leading-tight font-medium text-text-body">{t("scenario.currentState")}</span>
              <span className="hmi-micro">{gloss("scenario.currentState")}</span>
              <span className="font-numeric mt-1 text-sm text-text-body">{current?.statusLine ?? "—"}</span>
              {hotFolderStatus ? <span className="text-xs text-text-muted">{hotFolderStatus}</span> : null}
            </div>
            {current ? <StatusBadge status={current.activePreset === "burst" ? "warn" : "info"}>{current.activePreset}</StatusBadge> : null}
          </Sheet>

          <Sheet
            title={t("scenario.liveAdjust.title")}
            titleEn={gloss("scenario.liveAdjust.title")}
            headerRight={<span className="max-w-52 text-right text-xs text-text-muted">{t("scenario.liveAdjust.hint")}</span>}
            bodyClassName="flex flex-col gap-5"
          >
            <SliderRow
              label={t("scenario.cycleRate")}
              displayValue={formatMultiplier(cycleRate)}
              value={cycleRate}
              min={0.25}
              max={8}
              step={0.05}
              ariaLabel="Cycle rate multiplier"
              onValueChange={(v) => {
                setCycleRate(v)
                applyDebounced({ cycleRate: v })
              }}
              onValueCommitted={(v) => {
                setCycleRate(v)
                applyImmediate({ cycleRate: v })
              }}
            />

            <SliderRow
              label={t("scenario.defectRate")}
              displayValue={formatPercent(defectRate)}
              value={defectRate}
              min={0}
              max={1}
              step={0.01}
              ariaLabel="Extra defect rate"
              onValueChange={(v) => {
                setDefectRate(v)
                applyDebounced({ defectRate: v })
              }}
              onValueCommitted={(v) => {
                setDefectRate(v)
                applyImmediate({ defectRate: v })
              }}
            />

            <SliderRow
              label={t("scenario.faultRate")}
              displayValue={formatPercent(faultRate)}
              value={faultRate}
              min={0}
              max={1}
              step={0.01}
              ariaLabel="Fault rate"
              onValueChange={(v) => {
                setFaultRate(v)
                applyDebounced({ faultRate: v })
              }}
              onValueCommitted={(v) => {
                setFaultRate(v)
                applyImmediate({ faultRate: v })
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <label htmlFor="scenario-network-outage" className="flex items-center gap-2.5">
                {networkOutage ? (
                  <WifiOff className="size-4 text-danger-text" aria-hidden="true" />
                ) : (
                  <Wifi className="size-4 text-text-muted" aria-hidden="true" />
                )}
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-text-body">{t("scenario.networkOutage")}</span>
                  <span className="text-[11px] text-text-muted">{t("scenario.networkOutageHint")}</span>
                </span>
                <Switch
                  id="scenario-network-outage"
                  checked={networkOutage}
                  onCheckedChange={(checked) => {
                    setNetworkOutage(checked)
                    applyImmediate({ networkOutage: checked })
                  }}
                />
              </label>

              <Button type="button" variant="outline" onClick={handleBurst} disabled={burst.isPending}>
                {burst.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Zap className="size-3.5" aria-hidden="true" />}
                {t("scenario.burst")}
              </Button>
            </div>
          </Sheet>

          <Sheet
            title={t("scenario.presetsTitle")}
            titleEn={gloss("scenario.presetsTitle")}
            headerRight={<span className="max-w-64 text-right text-xs text-text-muted">{t("scenario.presetsHint")}</span>}
            bodyClassName="flex flex-col gap-4"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {presets.map((preset) => (
                <PresetCard
                  key={preset.name}
                  name={preset.name}
                  active={current?.activePreset === preset.name}
                  pending={pendingPreset === preset.name && applyPreset.isPending}
                  onApply={() => handlePreset(preset.name)}
                />
              ))}
            </div>
          </Sheet>
        </div>
      </div>
    </motion.div>
  )
}
