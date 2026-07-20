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
      <div className="flex w-full flex-1 items-center justify-center">
        {deviceClass === "Automation" ? (
          <AutomationSchematic isRunning={isRunning} cycles={cycles} className="h-full max-h-[280px] w-full max-w-[560px]" />
        ) : deviceClass === "AoiAvi" ? (
          <AoiSchematic
            isRunning={isRunning}
            productName={aoiProductName}
            points={aoiPoints}
            className="h-full max-h-[280px] w-full max-w-[560px]"
          />
        ) : (
          <IotSchematic isRunning={isRunning} latestReading={iotLatestReading} className="h-full max-h-[280px] w-full max-w-[560px]" />
        )}
      </div>
    </Sheet>
  )
}
