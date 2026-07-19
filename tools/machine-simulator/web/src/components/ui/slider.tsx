import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

interface SliderProps extends Omit<SliderPrimitive.Root.Props, "children"> {
  /** Accessible name — Base UI's own guidance is to label the `Thumb` (the actual `<input
   * type="range">` lives there), not the `Root`, so this wrapper takes it once and forwards it to the
   * right place instead of every call site having to know that. */
  "aria-label"?: string
}

/** Single-thumb slider only — the app has no range-slider use case, so this wrapper doesn't take an
 * `index` prop or render more than one `Slider.Thumb`. */
function Slider({ className, "aria-label": ariaLabel, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="relative flex h-4 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="h-1.5 w-full rounded-full bg-surface-muted">
          <SliderPrimitive.Indicator className="rounded-full bg-navy-600" />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            className="block size-4 rounded-full border-2 border-navy-600 bg-surface-base shadow-sm outline-none transition-transform data-dragging:scale-110 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-navy-600/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
