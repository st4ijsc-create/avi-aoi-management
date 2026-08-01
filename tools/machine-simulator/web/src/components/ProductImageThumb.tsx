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
 * `<img>` wrapper for a product/point reference image with a graceful fallback. Falls back to an
 * `ImageOff` roundel instead, both when no URL is set at all and when the resolved URL 404s/fails to
 * load — shared by `ProductConfig.tsx` (list thumbnails) and `ProductConfigDetail.tsx` (the larger
 * edit-form preview) so both stay visually consistent.
 *
 * M-9 (branch-review) — the seeded demo products' (`ProductConfigStore.SeedProducts`) PER-POINT and
 * fiducial images never had a real file behind them (`assets/products/model-X/points/....png`,
 * `assets/products/model-X/fidN.png`); the seed now sets those URLs to `null` rather than a path that 404s forever, so
 * this component hits the "no URL at all" branch below honestly instead of the "failed to load"
 * branch. The PRODUCT-level board images (`model-a-board.png`/`model-b-board.png`, used for the
 * product list/detail thumbnails this component actually renders) are real files and do resolve.
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
