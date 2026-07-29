import * as React from "react"
import {
  BarChart3,
  Boxes,
  Cable,
  Database,
  Factory,
  LayoutDashboard,
  Network,
  Package,
  PlugZap,
  ScrollText,
  Settings,
  Siren,
  SlidersHorizontal,
  Terminal,
  Users,
  Workflow,
} from "lucide-react"
import { Link, useLocation } from "wouter"

import { useLanguage, useT } from "@/i18n"
import { en } from "@/i18n/en"
import { vi, type Dictionary } from "@/i18n/vi"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"

export interface NavItem {
  /** i18n dictionary key (not the literal label) — every consumer (Sidebar, TopBar's title, Command
   * Palette) resolves it through `t()` so the label follows the active language. */
  labelKey: string
  path: string
  icon: React.ComponentType<{ className?: string }>
  /** WS-D-D7 (blueprint §6) — the minimum role allowed to SEE this nav entry at all (undefined means
   * every authenticated role). Checked via {@link ROLE_RANK}, not string equality, so a future
   * `minRole:"Engineer"` entry would also show for Admin — Admin is always a superset of every lower
   * role's own nav surface. The server's own per-route policy (`Policies.Admin`/etc.) is the REAL
   * gate regardless; this only keeps the sidebar/command-palette from listing a route whose every
   * underlying request would just 403 for the current user. */
  minRole?: string
}

export const NAV_ITEMS: NavItem[] = [
  { labelKey: "shell.nav.dashboard", path: "/", icon: LayoutDashboard },
  { labelKey: "shell.nav.machines", path: "/machines", icon: Factory },
  { labelKey: "shell.nav.productConfig", path: "/products", icon: Boxes },
  { labelKey: "shell.nav.onboarding", path: "/onboarding", icon: PlugZap },
  { labelKey: "shell.nav.inspector", path: "/inspector", icon: Terminal },
  { labelKey: "shell.nav.scenario", path: "/scenario", icon: SlidersHorizontal },
  // Task 12 (WS-A) — durable-results browse/export screen (`routes/Historian.tsx`). `Database` reads
  // as "stored records" (vs. e.g. `Clock`/`History`, which read more like "recent activity") — matches
  // this screen's own subject: long-lived historian rows, not a live tick.
  { labelKey: "shell.nav.historian", path: "/historian", icon: Database },
  // Task 13 (WS-A) — per-machine OEE screen (`routes/Reports.tsx`): A/P/Q/OEE tiles, the honest
  // 3-bucket loss chart, editable targets, PDF export. `BarChart3` reads as "reporting/analytics"
  // (distinct from `Database`'s "stored records" reading just above), matching this screen's own
  // subject: computed KPI rollups, not raw browsable rows.
  { labelKey: "shell.nav.reports", path: "/reports", icon: BarChart3 },
  // P2-2 (WS-J Asset Registry) — `/assets` (`routes/AssetRegistry.tsx`), the persisted asset roster
  // P2-1's backend maintains. `Package` (a single physical unit) reads as "one registered asset",
  // distinct from `Boxes`' own "a configuration catalog" reading (`productConfig`, above) and from
  // `Factory`'s "the live fleet" reading (`machines`) — this screen is about WHAT'S REGISTERED, not
  // what's configured or what's currently running. Reads are Operator (`AssetEndpoints.cs`), so no
  // `minRole` — every authenticated role sees this entry, same as every other fleet-facing screen
  // above; only the lifecycle-transition control INSIDE the screen is Engineer+-gated.
  { labelKey: "shell.nav.assets", path: "/assets", icon: Package },
  // SM-5 (.superpowers/sdd/2026-07-29-dotA-single-machine-sellable-blueprint/task-5-brief.md) —
  // `/connectors` (`routes/Connectors.tsx`): add/view/remove a real Modbus TCP or OPC-UA connector
  // configuration — the write path connectors.json/the ST4I_MODBUS_*/ST4I_OPCUA_* env vars never had.
  // `Cable` reads as "a physical wired connection", distinct from `PlugZap`'s "join the wider ecosystem"
  // reading (`onboarding`, above) and from `Package`'s "what's registered" reading (`assets`) — this
  // screen is specifically about WIRING UP a real device. Reads are Operator (`ConnectorEndpoints.cs`),
  // so no `minRole` — only the add-connector form + per-row Remove control inside the screen are
  // Engineer+-gated, same shape `assets`'/`site`'s own mutating controls use.
  { labelKey: "shell.nav.connectors", path: "/connectors", icon: Cable },
  // GĐ3 EC-4 (`routes/Site.tsx`) — the Site/Ecosystem link screen: device identity + Site-link form +
  // live bridge status, over EC-3's `/v1/site*` endpoints. `Network` reads as "federation/uplink to
  // another system", distinct from `PlugZap`'s "join THIS fleet" reading (`onboarding`, above) — this
  // screen is about linking OUT to a higher-tier SYNAPSE Site, not enrolling into the local fleet.
  // Reads are Operator (`SiteEndpoints.cs`), so no `minRole` — only the Site-link SAVE control inside
  // the screen is Engineer+-gated, same shape `assets`' own lifecycle-transition gate uses above.
  { labelKey: "shell.nav.site", path: "/site", icon: Network },
  // GĐ3 sub-4 LC-4 (`routes/AlarmCenter.tsx`) — the ISA-18.2 alarm center over LC-1/2's alarm backbone.
  // `Siren` reads as "active alarm/attention needed", distinct from every icon above (all either a
  // screen-shape or a single status glyph) — this is the one nav entry specifically about ALARMS, not
  // audit history (`ScrollText`) or a machine's own status. Reads are Operator (`AlarmEndpoints.cs`),
  // so no `minRole` — only the Ack action inside the screen carries its own (effectively-everyone)
  // `RequireRole` gate.
  { labelKey: "shell.nav.alarms", path: "/alarms", icon: Siren },
  // GĐ3 sub-4 LC-4 (`routes/LineControl.tsx`) — the PackML state machine control panel over LC-3's
  // `LineController`. `Workflow` reads as "a staged process/state machine", distinct from `Factory`'s
  // "the live fleet roster" reading (`machines`, above) — this screen is about the LINE's own
  // commanded PackML state (Idle/Execute/Held/Stopped/Aborted), not which machines exist. Reads are
  // Operator (`LineEndpoints.cs`), so no `minRole` — only the command buttons inside the screen carry
  // their own (effectively-everyone) `RequireRole` gate.
  { labelKey: "shell.nav.line", path: "/line", icon: Workflow },
  { labelKey: "shell.nav.settings", path: "/settings", icon: Settings },
  // WS-D-D7 — Admin-only account management (`routes/Users.tsx`). `Users` (plural person glyph) reads
  // as "manage people/accounts", distinct from every icon above (all either a screen-shape or a single
  // status glyph) — the one nav entry actually about WHO can use this deployment, not what it does.
  { labelKey: "shell.nav.users", path: "/users", icon: Users, minRole: "Admin" },
  // WS-D-D8 — Admin-only hash-chained audit log viewer (`routes/Audit.tsx`). `ScrollText` reads as
  // "a ledger/record kept over time", distinct from `Database`'s "browsable production results"
  // (Historian, above) and from `ShieldAlert`'s own "restricted/guard" reading elsewhere in this app —
  // this nav entry is about WHO DID WHAT, not what the fleet produced or who's allowed to act.
  { labelKey: "shell.nav.audit", path: "/audit", icon: ScrollText, minRole: "Admin" },
]

/** Rank order for {@link NavItem.minRole} comparisons — Operator < Engineer < Admin, same hierarchy
 * `Policies.cs`'s server-side `RequireRole` OR-chains already encode (`Policies.Admin` = Admin alone,
 * `Policies.Engineer` = Engineer or Admin, `Policies.Operator` = any of the three). */
const ROLE_RANK: Record<string, number> = { Operator: 0, Engineer: 1, Admin: 2 }

function meetsMinRole(minRole: string | undefined, userRole: string | undefined): boolean {
  if (!minRole) return true
  if (!userRole) return false
  return (ROLE_RANK[userRole] ?? -1) >= (ROLE_RANK[minRole] ?? Number.POSITIVE_INFINITY)
}

/** `NAV_ITEMS` filtered down to what `userRole` is allowed to even see — shared by `Sidebar` and
 * `CommandPalette` so the two surfaces never disagree about which nav entries exist for the signed-in
 * user. */
export function visibleNavItems(userRole: string | undefined): NavItem[] {
  return NAV_ITEMS.filter((item) => meetsMinRole(item.minRole, userRole))
}

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
  const { user } = useAuth()
  const items = React.useMemo(() => visibleNavItems(user?.role), [user?.role])

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-navy-800 bg-navy-700 font-heading text-sm font-bold text-white">
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
        {items.map((item) => {
          const active = isNavItemActive(location, item.path)
          const Icon = item.icon
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "flex items-center gap-2.5 border-l-2 px-2.5 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
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
