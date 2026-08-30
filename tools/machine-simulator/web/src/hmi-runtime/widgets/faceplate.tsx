import { Sheet } from "@/components/industrial"
import type { WidgetProps } from "../widgetRegistry.ts"
import { asRecord } from "./shared.ts"

/**
 * `kind: "faceplate"` — THE SEAM this workstream's Task 5 plugs into. The three existing SVG schematic
 * drawings (`components/hmi/schematics/AutomationSchematic`, `AoiSchematic`, `IotSchematic`) become the
 * real implementations of this kind, selected by `props.faceplate` (see
 * `contracts/fixtures/valid/screen-screwdrive-full.json`'s "spindle-fp" widget:
 * `"props": { "faceplate": "fp.motor.spindle" }`).
 *
 * None are wired here on purpose: those three components take specialized, per-machine-class live
 * props (`plan: CyclePlan | null`, `animate: boolean`, ...) that this generic `WidgetProps` shape does
 * not carry, and deciding how a JSON screen document supplies THOSE is explicitly Task 5's job — the
 * task that deletes `Hmi.tsx`'s hand-written layout and proves these three drawings still work as
 * widgets, not this one's. This file renders an honest "not wired yet" placeholder instead of a blank
 * tile or a crash, per plan §5-bis.
 */
export function FaceplateWidget(props: WidgetProps) {
  const p = asRecord(props.widget.props)
  const faceplateId = typeof p.faceplate === "string" ? p.faceplate : undefined

  return (
    <Sheet className="h-full" bodyClassName="flex h-full flex-1 items-center justify-center text-center">
      <p className="hmi-micro normal-case">
        faceplate: {faceplateId ?? "(unset)"}
        <br />
        not wired yet — see Task 5
      </p>
    </Sheet>
  )
}
