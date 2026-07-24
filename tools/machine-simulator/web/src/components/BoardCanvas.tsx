import * as React from "react"
import { ImageOff } from "lucide-react"

import { useGloss } from "@/components/hmi/bilingual"
import { useT } from "@/i18n"
import { resolveProductImageUrl, type Fiducial, type MeasurementPoint, type MeasurementType } from "@/lib/configApi"
import { cn } from "@/lib/utils"
import { useChartTokens, type ChartTokens } from "@/theme/chartTokens"

// A point's `normalizedRadius` reflects its real (often tiny) measurement ROI — good for the
// engine, illegible as a clickable/labeled marker. MIN_MARKER_PX floors the on-screen size well
// above the true ROI so a 3-char code (e.g. "P01") at the marker's font size stays readable and the
// marker stays a comfortable tap target, independent of the underlying measurement geometry.
const MIN_MARKER_PX = 30
const MAX_MARKER_PX = 56
const DEFAULT_MARKER_PX = 30
const DEFAULT_ASPECT = 4 / 3

const MEASUREMENT_TYPE_ORDER: MeasurementType[] = [
  "DIMENSION",
  "VISUAL",
  "ELECTRICAL",
  "POSITION",
  "COLOR",
  "SURFACE",
  "OTHER",
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Categorical color per `measurementType` — deliberately reuses the chart palette (meant for
 * distinguishing series, not conveying pass/fail) rather than the `ok`/`warn`/`danger` status tokens,
 * since a marker's color here means "what kind of check" not "did it pass" (unlike `BoardView.tsx`'s
 * NG/NTF/OK coloring, which this component is NOT a variant of despite the visual similarity). */
function colorForType(type: MeasurementType, tokens: ChartTokens): string {
  const idx = MEASUREMENT_TYPE_ORDER.indexOf(type)
  return tokens.chartSeries[(idx < 0 ? 0 : idx) % tokens.chartSeries.length]
}

/** Rotation/border-style/fill variety per `shape` so two overlapping points of the same
 * measurementType (same color) are still visually distinguishable at a glance — combined with
 * `colorForType` this gives a two-axis (color × shape) encoding instead of relying on color alone.
 *
 * I-13 (branch-review) — this used to also carry `rounded-full`/`rounded-[5px]`/`rounded-[3px]`/
 * `rounded-[4px]` per shape, which broke spec §1's non-negotiable "radius 0 everywhere" ground rule on
 * the one canvas in the app that had quietly grown rounded corners. Every marker is now a plain square
 * (or a square rotated 45° for `polygon`, which was already how that shape read a diamond — rotation
 * needs no radius). The one real loss: `circle` and `rect` are now visually identical (both a plain
 * square outline) where they used to differ by roundness — spec compliance wins over that nicety;
 * `colorForType`'s measurementType color still carries the primary distinguishing signal. */
function shapeClassName(shape: MeasurementPoint["shape"]): string {
  switch (shape) {
    case "rect":
      return ""
    case "polygon":
      return "rotate-45"
    case "ring":
      return "border-[3px] bg-surface-card/40"
    case "mask":
      return "border-dashed"
    case "array":
      return "border-dotted"
    case "line":
      return "h-2.5! w-9!"
    case "circle":
    default:
      return ""
  }
}

interface PlacedPoint {
  point: MeasurementPoint
  nx: number
  ny: number
}

/** Prefers the portable `normalizedX/Y` (0..1, resolution-independent — CONTRACT.md's own framing);
 * falls back to `positionX/Y` divided by the reference image's pixel dimensions when normalized
 * coordinates aren't set yet (only meaningful when the product's `coordinateMode` is `pixel` — a `mm`
 * product without normalized coords has no reliable image-relative ratio, so it's left unplaced rather
 * than guessed at). Returns null when neither is resolvable. */
function placePoint(point: MeasurementPoint, imageWidth?: number | null, imageHeight?: number | null): PlacedPoint | null {
  if (point.normalizedX != null && point.normalizedY != null) {
    return { point, nx: clamp(point.normalizedX, 0, 1), ny: clamp(point.normalizedY, 0, 1) }
  }
  if (imageWidth && imageHeight) {
    return { point, nx: clamp(point.positionX / imageWidth, 0, 1), ny: clamp(point.positionY / imageHeight, 0, 1) }
  }
  return null
}

interface BoardCanvasProps {
  referenceImageUrl?: string | null
  imageWidth?: number | null
  imageHeight?: number | null
  /** Full point list (any activation/deletion state) — filtered down to active, non-deleted points
   * internally, so callers can pass the same list they use for the points table unchanged. */
  points: MeasurementPoint[]
  fiducials?: Fiducial[]
  selectedCode?: string | null
  onSelectPoint: (code: string) => void
  onAddPointAt: (normalizedX: number, normalizedY: number) => void
  /** Product name, for the technical caption strip beneath the drawing (spec §7 — same "FIG. NN —
   * caption + dimension callouts" register the living schematics use, so this reads as the SAME
   * drawing family as the HMI's AOI cell rather than a plain image widget). */
  productName?: string | null
  className?: string
}

/**
 * Product reference-image canvas with each active measurement point drawn as a positioned marker —
 * the visual centerpiece of Task C5, reusing `MachineDetail`'s `BoardView.tsx` bbox-overlay idea
 * (an SVG/DOM layer positioned over a fixed coordinate frame, `role="group"` around focusable
 * per-point controls) but for AUTHORING rather than live-result display: markers are clickable to
 * select a point for editing, and clicking empty canvas space adds a new point at that position
 * (`onAddPointAt`, prefilled with the click's normalized coordinates by the caller).
 *
 * Sizes its container to the product's real `imageWidth`/`imageHeight` aspect ratio (falling back to
 * a plausible 4:3 when unset) via CSS `aspect-ratio` + `object-contain` on the `<img>` — since both
 * share the SAME ratio, the image fills the container edge-to-edge with no letterboxing, which is
 * what makes percentage-based marker positioning line up with the actual pixels of the image
 * underneath. When the reference image is missing or fails to load, falls back to the shared
 * `hmi-graph-paper` ground so markers still have a legible surface to sit on instead of a
 * broken-image icon. M-9 (branch-review) — the seeded demo products' PRODUCT-level board images
 * (`model-a-board.png`/`model-b-board.png`) DO resolve; it's the per-point/fiducial images this
 * component doesn't render (see `ProductImageThumb.tsx`'s own doc comment) that never had a real file
 * behind them — `ProductConfigStore.SeedProducts` now seeds those as `null` rather than a 404-forever
 * URL, so this fallback path is reached honestly (no URL at all) rather than via a failed fetch.
 *
 * H3d — restyled as the engineering-drawing sibling of the HMI AOI schematic (`AoiSchematic.tsx`,
 * spec §7 "make this the strongest one"): framed on the graph-paper ground with a technical caption
 * (`FIG. 02 — …`) and dimension callouts beneath, same drawing family/register. The interactive
 * marker/click-to-add LOGIC below (positioning math, ResizeObserver, event handlers) is untouched —
 * only the frame, ground, and marker rendering changed.
 */
export function BoardCanvas({
  referenceImageUrl,
  imageWidth,
  imageHeight,
  points,
  fiducials = [],
  selectedCode,
  onSelectPoint,
  onAddPointAt,
  productName,
  className,
}: BoardCanvasProps) {
  const t = useT()
  const gloss = useGloss()
  const chartTokens = useChartTokens()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(0)
  const [imgFailed, setImgFailed] = React.useState(false)

  const resolvedUrl = resolveProductImageUrl(referenceImageUrl)

  // Reset the failure flag whenever the URL itself changes — mirrors ProductImageThumb.tsx's own
  // effect, for the same reason (a previous image's load failure shouldn't permanently hide a later,
  // valid one).
  React.useEffect(() => setImgFailed(false), [resolvedUrl])

  React.useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setContainerWidth(entry.contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const activePoints = React.useMemo(() => points.filter((p) => p.isActive && !p.deletedAt), [points])
  const placed = React.useMemo(
    () =>
      activePoints
        .map((p) => placePoint(p, imageWidth, imageHeight))
        .filter((p): p is PlacedPoint => p !== null),
    [activePoints, imageWidth, imageHeight]
  )
  const unplacedCount = activePoints.length - placed.length

  const placedFiducials = React.useMemo(
    () =>
      fiducials
        .map((f) =>
          f.normalizedX != null && f.normalizedY != null
            ? { fiducial: f, nx: clamp(f.normalizedX, 0, 1), ny: clamp(f.normalizedY, 0, 1) }
            : null
        )
        .filter((f): f is { fiducial: Fiducial; nx: number; ny: number } => f !== null),
    [fiducials]
  )

  function handleBackgroundClick(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const nx = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const ny = clamp((event.clientY - rect.top) / rect.height, 0, 1)
    onAddPointAt(nx, ny)
  }

  const aspect = imageWidth && imageHeight ? imageWidth / imageHeight : DEFAULT_ASPECT

  function markerSize(point: MeasurementPoint): number {
    if (containerWidth <= 0) return DEFAULT_MARKER_PX
    if (point.normalizedRadius != null) {
      return clamp(containerWidth * point.normalizedRadius * 2, MIN_MARKER_PX, MAX_MARKER_PX)
    }
    if (point.cropWidth != null && imageWidth) {
      return clamp(containerWidth * (point.cropWidth / imageWidth), MIN_MARKER_PX, MAX_MARKER_PX)
    }
    return DEFAULT_MARKER_PX
  }

  const dimensionLabel =
    imageWidth && imageHeight
      ? `${Math.round(imageWidth)} × ${Math.round(imageHeight)} ${t("pointsEditor.canvas.dimensionUnit")}`
      : null

  return (
    <div className={cn("flex flex-col gap-0", className)}>
      {/* Blueprint frame — hairline border around the graph-paper ground (spec §7/§5); the drawing
          family AoiSchematic.tsx already establishes for the HMI's own AOI cell. Padding keeps a
          visible grid margin around the reference image itself, same as a real drawing sheet. */}
      <div className="hmi-graph-paper border border-border-strong p-2.5">
        <div
          ref={containerRef}
          role="group"
          aria-label={t("pointsEditor.canvas.ariaLabel", { count: placed.length })}
          onClick={handleBackgroundClick}
          className="relative w-full max-w-full cursor-crosshair overflow-hidden border border-border-strong bg-surface-card"
          style={{ aspectRatio: `${aspect}` }}
        >
          {resolvedUrl && !imgFailed ? (
            <img
              src={resolvedUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              onError={() => setImgFailed(true)}
            />
          ) : (
            <>
              <div className="hmi-graph-paper pointer-events-none absolute inset-0" aria-hidden="true" />
              <div className="pointer-events-none absolute top-2 left-2 flex items-center gap-1.5 border border-border-strong bg-surface-card px-2 py-1 text-[11px] text-text-muted">
                <ImageOff className="size-3.5" aria-hidden="true" />
                {t("pointsEditor.canvas.noImageCaption")}
              </div>
            </>
          )}

          {placedFiducials.map(({ fiducial, nx, ny }) => (
            <div
              key={fiducial.code}
              aria-hidden="true"
              title={fiducial.name ?? fiducial.code}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center"
              style={{ left: `${nx * 100}%`, top: `${ny * 100}%` }}
            >
              <span className="block size-3 rotate-45 border border-text-muted bg-surface-card/70" />
            </div>
          ))}

          {placed.map(({ point, nx, ny }) => {
            const selected = point.code === selectedCode
            const color = colorForType(point.measurementType, chartTokens)
            const size = markerSize(point)
            return (
              <button
                key={point.code}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectPoint(point.code)
                }}
                title={`${point.code} · ${point.name}`}
                aria-pressed={selected}
                aria-label={t("pointsEditor.canvas.pointAria", { code: point.code, name: point.name })}
                className={cn(
                  // Instrument-mark treatment (spec §7 "points reading as instrument marks") — hollow
                  // ring rather than a filled disc, monospace/tabular code label, no drop shadow (the
                  // ground rule's one shadow exception is the E-STOP dome, spec §6).
                  "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden border-2 bg-surface-card/80 font-mono text-[9px] leading-none font-semibold tabular-nums text-text-strong transition-transform outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-1",
                  shapeClassName(point.shape),
                  selected ? "z-20 scale-110 ring-2 ring-[var(--color-accent)] ring-offset-1" : "z-10 hover:scale-105"
                )}
                style={{ left: `${nx * 100}%`, top: `${ny * 100}%`, width: size, height: size, borderColor: color }}
              >
                <span className={cn("truncate", point.shape === "polygon" && "-rotate-45")}>{point.code}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Technical caption + dimension register, directly beneath the frame — same idiom
          `AoiSchematic.tsx`'s own FIG./dimension-line footer uses, so this reads as the same drawing
          family rather than a plain image widget with markers on it. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border border-t-0 border-border-strong bg-surface-muted px-2.5 py-1.5 font-mono text-[10px] tracking-[0.06em] text-text-muted uppercase">
        <span className="truncate" title={gloss("pointsEditor.canvas.figTitle")}>
          {t("pointsEditor.canvas.figTitle")}
          {productName ? ` · ${productName}` : ""}
        </span>
        <span className="font-numeric flex shrink-0 items-center gap-3 normal-case">
          {dimensionLabel ? <span>{dimensionLabel}</span> : null}
          <span>{t("hmi.schematic.pointsSynced", { count: placed.length })}</span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-text-muted">
        <p>{t("pointsEditor.canvas.hint")}</p>
        {unplacedCount > 0 ? <p>{t("pointsEditor.canvas.unplacedNote", { count: unplacedCount })}</p> : null}
      </div>
    </div>
  )
}
