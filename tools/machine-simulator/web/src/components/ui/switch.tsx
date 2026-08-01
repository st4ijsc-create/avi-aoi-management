import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-[var(--radius-pill)] border border-border-strong bg-surface-muted transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-checked:border-navy-800 data-checked:bg-navy-700 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-surface-base ring-0 transition-transform data-checked:translate-x-[18px] data-checked:bg-white"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
