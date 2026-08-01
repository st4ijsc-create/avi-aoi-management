import { Compass } from "lucide-react"

import { useT } from "@/i18n"
import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function NotFound() {
  const t = useT()
  return (
    <PlaceholderScreen
      icon={Compass}
      title={t("notFound.title")}
      description={t("notFound.description")}
      task="404"
    />
  )
}
