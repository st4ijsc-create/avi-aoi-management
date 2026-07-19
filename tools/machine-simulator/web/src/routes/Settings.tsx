import { Settings as SettingsIcon } from "lucide-react"

import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function Settings() {
  return (
    <PlaceholderScreen
      icon={SettingsIcon}
      title="Settings"
      description="Server URL, TLS verification, language and machine code — wired to GET/PUT /v1/settings."
      task="Coming in a later task"
    />
  )
}
