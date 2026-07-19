import { Compass } from "lucide-react"

import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function NotFound() {
  return (
    <PlaceholderScreen
      icon={Compass}
      title="Page not found"
      description="That route doesn't exist. Use the sidebar or press ⌘K to jump to a screen."
      task="404"
    />
  )
}
