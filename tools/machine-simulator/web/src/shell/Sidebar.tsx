import * as React from "react"
import {
  Boxes,
  Factory,
  LayoutDashboard,
  PlugZap,
  Settings,
  SlidersHorizontal,
  Terminal,
} from "lucide-react"
import { Link, useLocation } from "wouter"

import { useT } from "@/i18n"
import { cn } from "@/lib/utils"

export interface NavItem {
  /** i18n dictionary key (not the literal label) — every consumer (Sidebar, TopBar's title, Command
   * Palette) resolves it through `t()` so the label follows the active language. */
  labelKey: string
  path: string
  icon: React.ComponentType<{ className?: string }>
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "shell.nav.dashboard", path: "/", icon: LayoutDashboard },
  { labelKey: "shell.nav.machines", path: "/machines", icon: Factory },
  { labelKey: "shell.nav.productConfig", path: "/products", icon: Boxes },
  { labelKey: "shell.nav.onboarding", path: "/onboarding", icon: PlugZap },
  { labelKey: "shell.nav.inspector", path: "/inspector", icon: Terminal },
  { labelKey: "shell.nav.scenario", path: "/scenario", icon: SlidersHorizontal },
  { labelKey: "shell.nav.settings", path: "/settings", icon: Settings },
]

function isNavItemActive(location: string, path: string): boolean {
  if (path === "/") return location === "/"
  return location === path || location.startsWith(`${path}/`)
}

export function Sidebar() {
  const [location] = useLocation()
  const t = useT()

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-navy-600 text-sm font-bold text-white">
          S4
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-text-strong">ST4I</span>
          <span className="text-[11px] text-text-muted">{t("shell.sidebar.brandSubtitle")}</span>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(location, item.path)
          const Icon = item.icon
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-600/50",
                active
                  ? "bg-navy-600 text-white shadow-sm"
                  : "text-text-body hover:bg-navy-50 hover:text-navy-700"
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {t(item.labelKey)}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-border px-5 py-3">
        <p className="text-[11px] text-text-muted">EngineApi · localhost:5199</p>
      </div>
    </aside>
  )
}
