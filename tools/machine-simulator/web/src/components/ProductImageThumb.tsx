import * as React from "react"
import { ImageOff } from "lucide-react"

import { resolveProductImageUrl } from "@/lib/configApi"
import { cn } from "@/lib/utils"

interface ProductImageThumbProps {
  url?: string | null
  alt: string
  className?: string
  fallbackIconClassName?: string
}

/**
 * `<img>` wrapper for a product/point reference image with a graceful fallback — the seeded demo
 * products (`ProductConfigStore.SeedProducts`) carry placeholder `assets/products/...` paths that
 * don't resolve to a real file on disk in this build, so a plain `<img>` would render the browser's
 * broken-image icon. Falls back to an `ImageOff` roundel instead, both when no URL is set at all and
 * when the resolved URL 404s/fails to load — shared by `ProductConfig.tsx` (list thumbnails) and
 * `ProductConfigDetail.tsx` (the larger edit-form preview) so both stay visually consistent.
 */
export function ProductImageThumb({ url, alt, className, fallbackIconClassName }: ProductImageThumbProps) {
  const resolved = resolveProductImageUrl(url)
  const [failed, setFailed] = React.useState(false)

  // Reset the failure flag whenever the URL itself changes (e.g. user picks a different upload) —
  // otherwise a previous image's load failure would permanently hide a later, valid one.
  React.useEffect(() => setFailed(false), [resolved])

  if (!resolved || failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn("flex shrink-0 items-center justify-center bg-surface-muted text-text-muted", className)}
      >
        <ImageOff className={cn("size-4", fallbackIconClassName)} aria-hidden="true" />
      </div>
    )
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={cn("shrink-0 object-cover", className)}
      onError={() => setFailed(true)}
    />
  )
}
