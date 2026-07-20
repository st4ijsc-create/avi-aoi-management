import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Select<Value = string>({ ...props }: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-8 w-full items-center justify-between gap-2 rounded-none border border-border-strong bg-surface-muted px-2.5 py-1 text-sm outline-none transition-colors select-none focus-visible:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/40 data-disabled:pointer-events-none data-disabled:opacity-50 data-popup-open:border-[var(--color-accent)]",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon className="size-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className="truncate data-placeholder:text-muted-foreground"
      {...props}
    />
  )
}

function SelectPortal({ ...props }: SelectPrimitive.Portal.Props) {
  return <SelectPrimitive.Portal data-slot="select-portal" {...props} />
}

function SelectPositioner({
  className,
  sideOffset = 4,
  ...props
}: SelectPrimitive.Positioner.Props) {
  return (
    <SelectPrimitive.Positioner
      data-slot="select-positioner"
      sideOffset={sideOffset}
      className={cn("z-50 outline-none select-none", className)}
      {...props}
    />
  )
}

function SelectPopup({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Popup
      data-slot="select-popup"
      className={cn(
        "hmi-scroll max-h-[var(--available-height)] min-w-[var(--anchor-width)] origin-(--transform-origin) overflow-y-auto rounded-none border border-border bg-popover py-1 text-popover-foreground outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    >
      {children}
    </SelectPrimitive.Popup>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        // `text-primary-text` (not `text-navy-700`) — navy-700 has no dark override and left the
        // highlighted option's label unreadable against `dark:bg-navy-800/60` (same bug class as
        // Scenario.tsx's PresetCard, Settings.tsx's ModeSelector).
        "relative flex w-full cursor-default items-center gap-2 rounded-none py-1.5 pr-3 pl-7 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-navy-50 data-highlighted:text-primary-text dark:data-highlighted:bg-navy-800/60",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-2 flex size-3.5 items-center justify-center">
        <CheckIcon className="size-3.5 text-primary-text" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectGroup({ ...props }: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

/** Non-interactive heading above a `SelectGroup`'s items — same eyebrow-label styling used across the
 * app for section headings (KpiTile, Machines' filter groups, ApiInspector, Scenario, SpcChart). */
function SelectGroupLabel({ className, ...props }: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-group-label"
      className={cn("px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-text-muted uppercase select-none", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectPositioner,
  SelectPopup,
  SelectItem,
  SelectGroup,
  SelectGroupLabel,
}
