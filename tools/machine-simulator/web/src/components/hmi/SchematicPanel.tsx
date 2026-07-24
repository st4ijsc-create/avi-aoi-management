import type { CSSProperties } from "react"

import { Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { feederRemaining } from "@/components/hmi/derive"
import { AoiSchematic, type AoiSchematicPoint } from "@/components/hmi/schematics/AoiSchematic"
import { AutomationSchematic, FASTENING_STEPS_PER_CYCLE_FALLBACK, FEEDER_CAPACITY } from "@/components/hmi/schematics/AutomationSchematic"
import { IotSchematic } from "@/components/hmi/schematics/IotSchematic"
import { usePrefersReducedMotion } from "@/components/hmi/useCycleTwin"
import { useT } from "@/i18n"
import type { CyclePlan, DeviceClass } from "@/lib/api"
import { cn } from "@/lib/utils"

const FIG_KEY: Record<DeviceClass, string> = {
  Automation: "hmi.schematic.figAutomation",
  AoiAvi: "hmi.schematic.figAoi",
  Iot: "hmi.schematic.figIot",
}

interface SchematicPanelProps {
  deviceClass: DeviceClass
  isRunning: boolean
  cycles: number
  /** WS3-T2 (docs/PRODUCTION_UI_DESIGN.md §3.2–§3.4) — the machine's latest cycle plan
   * (`MachineDetailDto.Plan`), the living twin's single source of real per-step position/result/timing
   * data. Non-null implies the fleet is running (the engine's own idle gate) — `null` means "render the
   * static drawing" (no plan yet, or this device class doesn't wire one). */
  plan: CyclePlan | null | undefined
  aoiProductName?: string | null
  aoiPoints: AoiSchematicPoint[]
  /** I-1 — real per-cycle NG count from the engine's own board points, computed with NO product-point
   * involvement (see `Hmi.tsx`'s remarks) — the fallback caption when no live plan is in hand. */
  aoiUnlocatedDefects?: number
  iotLatestReading?: string | null
  className?: string
  /** H5 — the caller (`Hmi.tsx`) sets `flexGrow`/`flexBasis` here per `deviceClass` (layout spec §8's
   * "adapt proportions per machine class" note) rather than a fixed Tailwind flex utility. */
  style?: CSSProperties
}

/**
 * Picks the living schematic by `deviceClass` (spec §7) and frames it as a `<Sheet>` on the
 * graph-paper ground with its `FIG. NN` caption — the centrepiece panel of the HMI page.
 *
 * WS3-T2 — this is where `animate` (the ONE gate every schematic's motion respects: real plan in hand,
 * fleet actually running, and the operator hasn't asked for reduced motion) is computed ONCE and
 * handed to whichever `*Schematic` renders, rather than each one re-deriving it. `prefers-reduced-motion`
 * is read here (not deeper) because this is also where the caption strip needs to know it: a reduced-
 * motion panel still shows the SAME live numbers, just without the head/carriage/camera actually moving
 * (design-doc §3.3).
 */
export function SchematicPanel({
  deviceClass,
  isRunning,
  cycles,
  plan,
  aoiProductName,
  aoiPoints,
  aoiUnlocatedDefects,
  iotLatestReading,
  className,
  style,
}: SchematicPanelProps) {
  const t = useT()
  const gloss = useGloss()
  const reducedMotion = usePrefersReducedMotion()

  const hasPlanSteps = !!plan && plan.steps.length > 0
  const animate = isRunning && hasPlanSteps && !reducedMotion

  return (
    <Sheet
      className={cn(
        className,
        // WS1-T2 — "an active schematic element ... glow gently": the centrepiece drawing panel
        // itself is the one Sheet in the app that gets the combined elevation+glow treatment while
        // running, layering `--glow-run` on top of (not replacing) this theme's own `--elevation` —
        // a no-op on Glass/Warmth (`--glow-run: none` composites away to nothing). Idle machines
        // stay on the plain `.sheet` elevation only, same as every other panel.
        isRunning && "shadow-[var(--elevation),var(--glow-run)]"
      )}
      style={style}
      bodyClassName="flex flex-1 min-h-0 flex-col p-0"
      title={t(FIG_KEY[deviceClass])}
      titleEn={gloss(FIG_KEY[deviceClass])}
      headerRight={!isRunning ? <span className="hmi-micro">{t("hmi.schematic.idleNote")}</span> : null}
    >
      {/*
        H2b: the schematic used to be capped at max-h-[280px]/max-w-[560px] regardless of how large
        the Sheet around it actually was — on a full HMI panel that clamp left the drawing marooned
        in ~25% of the sheet, surrounded by empty graph paper (the single biggest flaw in the live
        review). Each schematic's own `viewBox` is now tightened to its artwork's real bounding box,
        so letting the SVG fill this flex box completely (`h-full w-full`) and scale via
        `preserveAspectRatio="xMidYMid meet"` (each schematic's own default) makes the drawing read
        as the centrepiece — filling ~85–90% of the sheet at any panel size instead of a small
        island in the middle of it.
      */}
      <div className="hmi-graph-paper flex min-h-0 flex-1 items-center justify-center p-3">
        {deviceClass === "Automation" ? (
          <AutomationSchematic plan={plan} animate={animate} className="h-full w-full" />
        ) : deviceClass === "AoiAvi" ? (
          <AoiSchematic plan={plan} animate={animate} points={aoiPoints} className="h-full w-full" />
        ) : (
          <IotSchematic plan={plan} animate={animate} className="h-full w-full" />
        )}
      </div>

      <SchematicCaptionStrip
        deviceClass={deviceClass}
        cycles={cycles}
        plan={plan}
        aoiProductName={aoiProductName}
        aoiPointsCount={aoiPoints.length}
        aoiUnlocatedDefects={aoiUnlocatedDefects ?? 0}
        iotLatestReading={iotLatestReading}
      />
    </Sheet>
  )
}

interface SchematicCaptionStripProps {
  deviceClass: DeviceClass
  cycles: number
  plan: CyclePlan | null | undefined
  aoiProductName?: string | null
  aoiPointsCount: number
  aoiUnlocatedDefects: number
  iotLatestReading?: string | null
}

/** The "caption + short readout strip attached directly to the visualization" (layout analysis §1.2)
 * — one fixed-height row (`h-9`, so its own bounding box never depends on live content, the same
 * "mask a stable box, not the live text's own shrink-to-content extent" discipline the removed
 * in-canvas mask hooks used) truncated with an accessible `title` per `Readout`'s own convention for
 * text that can run long. */
function SchematicCaptionStrip({
  deviceClass,
  cycles,
  plan,
  aoiProductName,
  aoiPointsCount,
  aoiUnlocatedDefects,
  iotLatestReading,
}: SchematicCaptionStripProps) {
  const t = useT()

  if (deviceClass === "Automation") {
    // WS3-T2 — "feeder counts down by real steps" (design-doc §3.3): a completed cycle consumes its
    // OWN real fastening-step count (`plan.steps.length`) rather than the pre-WS3-T2 flat 1-per-cycle
    // assumption. `plan` is only ever non-null while THIS cycle is running, so the fallback constant
    // (mirroring the engine's own fixed `FasteningPositionsPerCycle`) keeps the number continuous
    // across running/idle transitions instead of jumping when the plan disappears mid-poll.
    const stepsPerCycle = plan?.steps.length ?? FASTENING_STEPS_PER_CYCLE_FALLBACK
    const remaining = feederRemaining(cycles, FEEDER_CAPACITY, stepsPerCycle)
    return (
      <div className="hmi-schematic-caption hmi-feeder-live flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border px-3">
        <span className="hmi-micro truncate">{t("hmi.schematic.feeder")}</span>
        <span className="flex items-baseline gap-1.5 font-mono text-[13px] text-text-body" title={t("hmi.schematic.feederDisclosure")}>
          <span className="tabular-nums font-semibold text-text-strong">{remaining}</span>
          <span className="text-text-muted">/ {FEEDER_CAPACITY}</span>
          <span className="hmi-micro">{t("hmi.schematic.remaining")}</span>
        </span>
      </div>
    )
  }

  if (deviceClass === "AoiAvi") {
    const hasProduct = aoiPointsCount > 0
    // WS3-T2 — once a real plan is in hand, its own steps are a MORE honest source than the machine-
    // wide `aoiUnlocatedDefects` aggregate (I-1's old workaround): the caption now states the exact
    // per-point NG count/total the drawing itself is lighting, not a disclaimer that it can't say
    // which dot is which — because now it genuinely can.
    const hasLivePlan = !!plan && plan.steps.length > 0
    let primary: string
    let disclosureTitle: string | undefined
    if (hasLivePlan) {
      const ngCount = plan!.steps.filter((s) => s.result === "NG").length
      primary = `${aoiProductName ?? "—"} · ${t("hmi.schematic.livePointResults", { ng: ngCount, total: plan!.steps.length })}`
      disclosureTitle = t("hmi.schematic.livePointDisclosure")
    } else if (hasProduct) {
      primary = `${aoiProductName ?? "—"} · ${t("hmi.schematic.pointsSynced", { count: aoiPointsCount })} · ${t("hmi.schematic.aggregateDefects", { count: aoiUnlocatedDefects })}`
      disclosureTitle = t("hmi.schematic.aggregateDisclosure")
    } else {
      primary = t("hmi.schematic.noProduct")
    }
    return (
      <div className="hmi-schematic-caption hmi-aoi-caption flex h-9 shrink-0 items-center border-t border-border px-3">
        <span className="truncate font-mono text-[12px] text-text-body" title={disclosureTitle}>
          {primary}
        </span>
      </div>
    )
  }

  return (
    <div className="hmi-schematic-caption hmi-iot-reading flex h-9 shrink-0 items-center border-t border-border px-3">
      <span className="truncate font-mono text-[12px] text-text-body">{iotLatestReading ?? "—"}</span>
    </div>
  )
}
