import { Sheet } from "@/components/industrial"
import { useGloss } from "@/components/hmi/bilingual"
import { MachineSettingsPanel } from "@/components/MachineSettingsPanel"
import { useT } from "@/i18n"
import type { DeviceClass } from "@/lib/api"

interface SettingsTabProps {
  machineCode: string
  deviceClass: DeviceClass
  machineType?: string | null
  className?: string
}

/**
 * Task 4 — the CÀI ĐẶT/SETTINGS tab body on the HMI operator panel (`/hmi/:code`). Thin kiosk-chrome
 * wrapper (`<Sheet>`, matching every other panel on this screen) around the SHARED
 * `<MachineSettingsPanel>` (Task 5 reuses the same component from `routes/MachineDetail.tsx`) — same
 * data source, same vocabulary, per design doc §5.
 *
 * Occupies the SAME region the schematic + readout columns fill on the OPERATION tab (`Hmi.tsx`
 * renders one or the other, never both) — the physical control rail (Output card + Start/Pause/
 * HALT/RESET) stays mounted UNCHANGED regardless of which tab is active, so the position-stability
 * rule (spec §8.3: HALT never moves/disappears — a reliability requirement, not a safety-circuit one,
 * see `ControlButton.tsx`'s own remarks) holds on this tab exactly as it does on Operation.
 */
export function SettingsTab({ machineCode, deviceClass, machineType, className }: SettingsTabProps) {
  const t = useT()
  const gloss = useGloss()

  return (
    <Sheet
      id="hmi-tabpanel-settings"
      role="tabpanel"
      aria-labelledby="hmi-tab-settings"
      tabIndex={0}
      className={className}
      title={t("machineSettings.title")}
      titleEn={gloss("machineSettings.title")}
      bodyClassName="flex flex-1 min-h-0 flex-col p-0"
    >
      <MachineSettingsPanel
        machineCode={machineCode}
        deviceClass={deviceClass}
        machineType={machineType}
        attributedAs="hmi"
        showHeader={false}
        className="min-h-0 flex-1"
      />
    </Sheet>
  )
}
