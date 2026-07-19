import { Terminal } from "lucide-react"

import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function ApiInspector() {
  return (
    <PlaceholderScreen
      icon={Terminal}
      title="API Inspector"
      description="Live envelope-by-envelope feed off the ws://.../v1/inspector/stream WebSocket."
      task="Coming in Task 5"
    />
  )
}
