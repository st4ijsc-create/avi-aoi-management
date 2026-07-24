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

import { useLanguage, useT } from "@/i18n"
import { en } from "@/i18n/en"
import { vi, type Dictionary } from "@/i18n/vi"
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

/** Looks up a dot-path key against a specific dictionary (not the active one) — used to render the
 * inactive-language gloss beside a nav label, same bilingual register `useGloss()`/`Readout`'s
 * `labelEn` use elsewhere. Nav labels are always plain strings (no interpolation vars), so no `Vars`
 * handling. */
function resolveLabel(dict: Dictionary, key: string): string {
  const parts = key.split(".")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let node: any = dict
  for (const part of parts) {
    if (node == null || typeof node !== "object") return key
    node = node[part]
  }
  return typeof node === "string" ? node : key
}

export function Sidebar() {
  const [location] = useLocation()
  const t = useT()
  const { language } = useLanguage()
  const glossDict = language === "vi" ? en : vi

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <div className="flex size-8 shrink-0 items-center justify-center border border-navy-800 bg-navy-700 font-heading text-sm font-bold text-white">
          S4
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-heading text-sm font-semibold tracking-tight text-text-strong">ST4I</span>
          <span className="hmi-micro">{t("shell.sidebar.brandSubtitle")}</span>
        </div>
      </div>

      <nav
        className="hmi-scroll flex flex-1 flex-col gap-px overflow-y-auto px-2 py-2"
        aria-label={t("shell.sidebar.navAria")}
      >
        {NAV_ITEMS.map((item) => {
          const active = isNavItemActive(location, item.path)
          const Icon = item.icon
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "flex items-center gap-2.5 border-l-2 px-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
                active
                  ? "border-l-[var(--color-accent)] bg-navy-700 text-white"
                  : "border-l-transparent text-text-body hover:border-l-border-strong hover:bg-surface-muted hover:text-text-strong"
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate">{t(item.labelKey)}</span>
                <span className={cn("hmi-micro truncate", active && "!text-white/80")}>
                  {resolveLabel(glossDict, item.labelKey)}
                </span>
              </span>
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <p className="hmi-micro font-mono normal-case">EngineApi · localhost:5199</p>
      </div>
    </aside>
  )
}
