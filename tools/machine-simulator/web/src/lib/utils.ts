import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Scale-aware decimal formatting for a raw metric/measurement value — SPC/telemetry readings span
 * wildly different magnitudes (torque in N·m vs. a leak-test pressure in kPa), so a single fixed
 * `.toFixed(n)` either drowns small values in zeros or floods large ones with noise digits. */
export function formatMetric(value: number): string {
  const abs = Math.abs(value)
  if (abs === 0) return "0"
  if (abs < 1) return value.toFixed(4)
  if (abs < 10) return value.toFixed(3)
  if (abs < 100) return value.toFixed(2)
  return value.toFixed(1)
}

/** Truncates plain text to `maxChars`, ellipsis-suffixed — for contexts (SVG `<text>`, canvas) that
 * have no CSS `text-overflow` to lean on, so truncation has to happen in JS before it ever reaches
 * the DOM. Callers that DO have CSS available (an HTML element) should prefer `truncate` + a `title`
 * attribute over this — this is specifically for SVG schematic captions (H2b). */
export function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

/** Truncates a sha256 hex checksum (`ConfigChecksum.Compute`) to a short display form — Task C6's
 * recipe list/detail show this instead of the full 64-char hex string, matching how git/docker
 * shorten a hash for a UI chip. `null`/empty renders as an em dash (a brand-new draft recipe with no
 * saved payload yet has no checksum to show). */
export function shortChecksum(checksum: string | null | undefined): string {
  if (!checksum) return "—"
  return checksum.length <= 12 ? checksum : `${checksum.slice(0, 10)}…`
}
