import { SlidersHorizontal } from "lucide-react"

import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function Scenario() {
  return (
    <PlaceholderScreen
      icon={SlidersHorizontal}
      title="Scenario"
      description="Cycle-rate, defect-rate and fault-rate sliders plus presets and burst mode — wired to /v1/scenario/*."
      task="Coming in a later task"
    />
  )
}
