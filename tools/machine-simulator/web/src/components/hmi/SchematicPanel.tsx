import type { CSSProperties } from "react"

import { Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { feederRemaining } from "@/components/hmi/derive"
import { AoiSchematic, type AoiSchematicPoint } from "@/components/hmi/schematics/AoiSchematic"
import { AutomationSchematic, FEEDER_CAPACITY } from "@/components/hmi/schematics/AutomationSchematic"
import { IotSchematic } from "@/components/hmi/schematics/IotSchematic"
import { useT } from "@/i18n"
import type { DeviceClass } from "@/lib/api"
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
  aoiProductName?: string | null
  aoiPoints: AoiSchematicPoint[]
  /** I-1 — real per-cycle NG count from the engine's own board points, computed with NO product-point
   * involvement (see `Hmi.tsx`'s remarks) — an honest aggregate the caption strip shows instead of
   * colouring an individual, unverifiably-matched dot. */
  aoiUnlocatedDefects?: number
  iotLatestReading?: string | null
  className?: string
  /** H5 — the caller (`Hmi.tsx`) sets `flexGrow`/`flexBasis` here per `deviceClass` (layout spec §8's
   * "adapt proportions per machine class" note) rather than a fixed Tailwind flex utility. */
  style?: CSSProperties
}

/**
 * Picks the living schematic by `deviceClass` (spec §7) and frames it as a `<Sheet>` on the
 * graph-paper ground with its `FIG. NN` caption — the centrepiece panel of the HMI page (spec §8,
 * layout gap 1: this now sits BESIDE `ReadoutGrid` as a sibling column, not stacked above it).
 *
 * H5 — layout gap 4: every live numeric callout that used to be drawn INSIDE the schematic's own SVG
 * canvas (feeder remaining-count, the AOI product/points/defects caption, the IoT latest reading) now
 * lives in a thin caption/readout strip directly BELOW the drawing instead — the reference's own
 * pattern ("a caption block plus a short readout strip pinned directly under the drawing", not labels
 * drawn inside the technical drawing itself). Each schematic component (`AutomationSchematic` /
 * `AoiSchematic` / `IotSchematic`) is now purely the wireframe; this component owns the strip.
 */
export function SchematicPanel({
  deviceClass,
  isRunning,
  cycles,
  aoiProductName,
  aoiPoints,
  aoiUnlocatedDefects,
  iotLatestReading,
  className,
  style,
}: SchematicPanelProps) {
  const t = useT()
  const gloss = useGloss()

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
          <AutomationSchematic isRunning={isRunning} className="h-full w-full" />
        ) : deviceClass === "AoiAvi" ? (
          <AoiSchematic isRunning={isRunning} points={aoiPoints} className="h-full w-full" />
        ) : (
          <IotSchematic isRunning={isRunning} className="h-full w-full" />
        )}
      </div>

      <SchematicCaptionStrip
        deviceClass={deviceClass}
        cycles={cycles}
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
  aoiProductName,
  aoiPointsCount,
  aoiUnlocatedDefects,
  iotLatestReading,
}: SchematicCaptionStripProps) {
  const t = useT()

  if (deviceClass === "Automation") {
    const remaining = feederRemaining(cycles, FEEDER_CAPACITY)
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
    const primary = hasProduct
      ? `${aoiProductName ?? "—"} · ${t("hmi.schematic.pointsSynced", { count: aoiPointsCount })} · ${t("hmi.schematic.aggregateDefects", { count: aoiUnlocatedDefects })}`
      : t("hmi.schematic.noProduct")
    return (
      <div className="hmi-schematic-caption hmi-aoi-caption flex h-9 shrink-0 items-center border-t border-border px-3">
        <span className="truncate font-mono text-[12px] text-text-body" title={hasProduct ? t("hmi.schematic.aggregateDisclosure") : undefined}>
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
