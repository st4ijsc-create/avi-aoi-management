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
      <SliderPrimitive.Control className="relative flex h-5 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="h-1 w-full rounded-none border border-border-strong bg-surface-muted">
          <SliderPrimitive.Indicator className="rounded-none bg-navy-700" />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            className="block size-5 rounded-none border border-navy-800 bg-navy-700 outline-none transition-transform data-dragging:scale-105 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-navy-700/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
