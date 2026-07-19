import { Factory } from "lucide-react"

import { useT } from "@/i18n"
import { PlaceholderScreen } from "@/components/PlaceholderScreen"

export default function Machines() {
  const t = useT()
  return (
    <PlaceholderScreen
      icon={Factory}
      title={t("machines.title")}
      description={t("machines.description")}
      task={t("machines.comingSoon")}
    />
  )
}
