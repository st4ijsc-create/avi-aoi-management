import { Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { AoiSchematic, type AoiSchematicPoint } from "@/components/hmi/schematics/AoiSchematic"
import { AutomationSchematic } from "@/components/hmi/schematics/AutomationSchematic"
import { IotSchematic } from "@/components/hmi/schematics/IotSchematic"
import { useT } from "@/i18n"
import type { DeviceClass } from "@/lib/api"

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
   * involvement (see `Hmi.tsx`'s remarks) — an honest aggregate the AOI schematic shows instead of
   * colouring an individual, unverifiably-matched dot. */
  aoiUnlocatedDefects?: number
  iotLatestReading?: string | null
  className?: string
}

/** Picks the living schematic by `deviceClass` (spec §7) and frames it as a `<Sheet>` on the
 * graph-paper ground with its `FIG. NN` caption — the centrepiece panel of the HMI page. */
export function SchematicPanel({
  deviceClass,
  isRunning,
  cycles,
  aoiProductName,
  aoiPoints,
  aoiUnlocatedDefects,
  iotLatestReading,
  className,
}: SchematicPanelProps) {
  const t = useT()
  const gloss = useGloss()

  return (
    <Sheet
      className={className}
      graphPaper
      bodyClassName="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 p-3"
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
      <div className="flex h-full w-full flex-1 items-center justify-center">
        {deviceClass === "Automation" ? (
          <AutomationSchematic isRunning={isRunning} cycles={cycles} className="h-full w-full" />
        ) : deviceClass === "AoiAvi" ? (
          <AoiSchematic
            isRunning={isRunning}
            productName={aoiProductName}
            points={aoiPoints}
            unlocatedDefects={aoiUnlocatedDefects ?? 0}
            className="h-full w-full"
          />
        ) : (
          <IotSchematic isRunning={isRunning} latestReading={iotLatestReading} className="h-full w-full" />
        )}
      </div>
    </Sheet>
  )
}
