import { PlugZap } from "lucide-react"

import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function Onboarding() {
  return (
    <PlaceholderScreen
      icon={PlugZap}
      title="Onboarding"
      description="Register, poll and enroll a new machine against the ST4I server (or the demo-only flow) — wired to POST /v1/onboarding/*."
      task="Coming in a later task"
    />
  )
}
