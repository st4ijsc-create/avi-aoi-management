import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

/**
 * WS-D-D7 — the ONE new UI primitive this task adds: a themed dropdown menu built on
 * `@base-ui/react/menu` (already an installed dependency of `@base-ui/react` — the exact same package
 * `select.tsx`/`dialog.tsx`/`switch.tsx` already import from, just a different submodule — so this adds
 * NO new npm dependency). TopBar's user menu (username + role badge + Logout) is the first consumer;
 * shaped generically enough for any future "trigger opens a small list of actions" surface to reuse
 * rather than hand-rolling a second one.
 *
 * Same structural/styling idiom as `select.tsx`'s `Select*` family (Root/Trigger/Portal/Positioner/
 * Popup/Item), right down to reusing `hmi-panel-glass`/`data-highlighted` for the popup/item look — a
 * menu and a select-popup are visually the same "floating list of choices" surface in this design
 * system, just triggered differently and (for a menu) each item performs an action instead of selecting
 * a value.
 */
function Menu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="menu" {...props} />
}

function MenuTrigger({ className, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menu-trigger"
      className={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        className
      )}
      {...props}
    />
  )
}

function MenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="menu-portal" {...props} />
}

function MenuPositioner({ className, sideOffset = 6, ...props }: MenuPrimitive.Positioner.Props) {
  return (
    <MenuPrimitive.Positioner
      data-slot="menu-positioner"
      sideOffset={sideOffset}
      className={cn("z-50 outline-none select-none", className)}
      {...props}
    />
  )
}

function MenuPopup({ className, children, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Popup
      data-slot="menu-popup"
      className={cn(
        "hmi-panel-glass min-w-48 origin-(--transform-origin) overflow-hidden rounded-[var(--radius-card)] border border-border py-1 text-popover-foreground shadow-[var(--elevation)] outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    >
      {children}
    </MenuPrimitive.Popup>
  )
}

function MenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
  return (
    <MenuPrimitive.Item
      data-slot="menu-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 px-3 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-navy-50 data-highlighted:text-primary-text dark:data-highlighted:bg-navy-800/60",
        className
      )}
      {...props}
    />
  )
}

/** Groups related items under one {@link MenuGroupLabel} — Base UI requires this wrapper to exist
 * (`MenuGroupLabel` throws "MenuGroupContext is missing" without it), same requirement `select.tsx`'s
 * `SelectGroup`/`SelectGroupLabel` pair has. */
function MenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />
}

/** Non-interactive header row above a {@link MenuGroup}'s items — MUST be a `MenuGroup` descendant
 * (see that component's own doc comment); same eyebrow-label register `SelectGroupLabel` uses
 * elsewhere. */
function MenuGroupLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menu-group-label"
      className={cn("px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-text-muted uppercase select-none", className)}
      {...props}
    />
  )
}

/** A plain hairline divider between groups of items — Base UI's menu package has no dedicated
 * separator part (unlike `select`'s own primitives), so this is a bare styled `<div>`. */
function MenuSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="menu-separator" role="separator" className={cn("my-1 h-px bg-border", className)} {...props} />
}

export { Menu, MenuTrigger, MenuPortal, MenuPositioner, MenuPopup, MenuItem, MenuGroup, MenuGroupLabel, MenuSeparator }
