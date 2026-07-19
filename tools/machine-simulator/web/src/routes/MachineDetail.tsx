import { Cpu } from "lucide-react"
import { useParams } from "wouter"

import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function MachineDetail() {
  const { code } = useParams<{ code: string }>()

  return (
    <PlaceholderScreen
      icon={Cpu}
      title={code ?? "Machine detail"}
      description="SPC chart, telemetry, board points and cycle log for this machine."
      task="Coming in Task 6"
    />
  )
}
