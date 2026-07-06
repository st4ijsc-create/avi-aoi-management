/**
 * doc 36 — UNIFIED APP REGISTRY (single source of truth for the App Launcher / Phương án A).
 *
 * This is the reconciliation layer the launcher IA is built on. It unifies the THREE
 * taxonomies that previously drifted apart:
 *   - `navigation.tsx` `navGroups`  → the task-based sidebar (9 groups, group.id).
 *   - `module-registry` SYSTEM_MODULES → the sellable SKUs (module.code, license).
 *   - `domains.ts` DOMAINS           → the marketing tile grid.
 *
 * An **App** = one tile in the launcher = one purchasable/commercial unit. Each app is
 * backed by 1+ license modules (`moduleCodes`) and surfaces the nav items whose OWNING
 * module (via `getModuleByRoute`) belongs to it. Because route ownership was made
 * authoritative in `module-registry` (doc 36 W0), an item can now live in a different
 * app than its legacy nav group — e.g. `/feeder-verify` (was under Devices) resolves to
 * the Production app because its route is owned by MOD_PRODUCTION. THIS is how the menu
 * gets reorganised across the old groups.
 *
 * Gating stays 3-layered (independent):
 *   - L1 license → `isAppAllowed(app, allowed)` (ANY of the app's modules owned; core always).
 *   - L2 RBAC    → still applied per-item by getFilteredNavGroups downstream.
 *   - L3 simple/advanced → filterNavGroupsByMode downstream.
 *
 * NOTE: labels are i18n keys under `nav.app.*` (added in W1). Kept data-only here; no UI.
 */
import {
  Gauge,
  Factory,
  ClipboardCheck,
  Cpu,
  Code2,
  LineChart,
  Sparkles,
  Building2,
  Shield,
  User,
  type LucideIcon,
} from "lucide-react";

import {
  SYSTEM_MODULES,
  getModuleByRoute,
  CORE_MODULE_CODES,
} from "../../../shared/module-registry";
import { getGroupByHref, type NavGroup } from "./navigation";

/** A launcher app: a commercial/purchasable unit rendered as one tile. */
export interface AppDescriptor {
  /** Stable id (React key + analytics + persisted "active app"). */
  appId: string;
  /** `core` = always-on shell app (never a locked tile); `sellable` = SKU tile. */
  kind: "core" | "sellable";
  /** i18n key → short label (nav.app.<id>). */
  labelKey: string;
  /** i18n key → one-line blurb (nav.app.<id>Desc). */
  blurbKey: string;
  icon: LucideIcon;
  /** Canonical landing route when the app is opened (verified in App.tsx). */
  landingHref: string;
  /** Nav group.id(s) this app draws its menu from (fallback resolver + breadcrumb root). */
  navGroupIds: string[];
  /** License module code(s) that unlock this app. App is allowed if ANY is owned (core always). */
  moduleCodes: string[];
  /** Display order in the launcher grid. */
  order: number;
}

/**
 * The app catalog — order = launcher grid order. Core apps first (always shown), then the
 * sellable SKUs. Backing modules reflect doc 36 §9 decisions:
 *   D1 Quality = own SKU · D2 Engineering split from OT (one tile, two SKUs, gated per-item)
 *   D3 Alerts folded into Monitoring · D4 Corporate+Federation = one "Đa nhà máy" app
 *   D5 Master Data inside the Admin app.
 */
export const APPS: AppDescriptor[] = [
  // ── Core (always-on shell apps) ───────────────────────────────────────────
  {
    appId: "overview",
    kind: "core",
    labelKey: "nav.app.overview",
    blurbKey: "nav.app.overviewDesc",
    icon: Gauge,
    landingHref: "/dashboard",
    navGroupIds: ["overview"],
    moduleCodes: ["CORE_DASHBOARD"],
    order: 0,
  },
  // ── Sellable SKUs ─────────────────────────────────────────────────────────
  {
    appId: "production",
    kind: "sellable",
    labelKey: "nav.app.production",
    blurbKey: "nav.app.productionDesc",
    icon: Factory,
    landingHref: "/production-dashboard",
    navGroupIds: ["production"],
    moduleCodes: ["MOD_PRODUCTION"],
    order: 10,
  },
  {
    appId: "quality",
    kind: "sellable",
    labelKey: "nav.app.quality",
    blurbKey: "nav.app.qualityDesc",
    icon: ClipboardCheck,
    landingHref: "/quality-cockpit",
    navGroupIds: ["quality"],
    moduleCodes: ["MOD_QUALITY"],
    order: 20,
  },
  {
    appId: "devices",
    kind: "sellable",
    labelKey: "nav.app.devices",
    blurbKey: "nav.app.devicesDesc",
    icon: Cpu,
    landingHref: "/device-monitor",
    navGroupIds: ["devices"],
    moduleCodes: ["MOD_MONITORING"],
    order: 30,
  },
  {
    appId: "engineering",
    kind: "sellable",
    labelKey: "nav.app.engineering",
    blurbKey: "nav.app.engineeringDesc",
    icon: Code2,
    landingHref: "/engineering-home",
    navGroupIds: ["engineering"],
    // D2 — two SKUs behind one tile: authoring (Engineering) + device control (OT).
    // Buy just Engineering → tile appears, OT items are license-hidden inside.
    moduleCodes: ["MOD_ENGINEERING", "MOD_OT_CONTROL"],
    order: 40,
  },
  {
    appId: "analytics",
    kind: "sellable",
    labelKey: "nav.app.analytics",
    blurbKey: "nav.app.analyticsDesc",
    icon: LineChart,
    landingHref: "/reports",
    navGroupIds: ["analytics"],
    moduleCodes: ["MOD_ANALYTICS"],
    order: 50,
  },
  {
    appId: "ai",
    kind: "sellable",
    labelKey: "nav.app.ai",
    blurbKey: "nav.app.aiDesc",
    icon: Sparkles,
    landingHref: "/ai-hub",
    navGroupIds: ["ai"],
    moduleCodes: ["MOD_AI"],
    order: 60,
  },
  {
    appId: "multisite",
    kind: "sellable",
    labelKey: "nav.app.multisite",
    blurbKey: "nav.app.multisiteDesc",
    icon: Building2,
    landingHref: "/corporate-dashboard",
    // Corporate items live in the overview/admin groups; resolved primarily by module.
    navGroupIds: ["admin", "overview"],
    moduleCodes: ["MOD_CORPORATE", "MOD_FEDERATION"],
    order: 70,
  },
  // ── Core (governance + personal) ──────────────────────────────────────────
  {
    appId: "admin",
    kind: "core",
    labelKey: "nav.app.admin",
    blurbKey: "nav.app.adminDesc",
    icon: Shield,
    landingHref: "/admin-home",
    navGroupIds: ["admin"],
    // D5 — Master Data folded into the Admin app.
    moduleCodes: ["CORE_ADMIN", "CORE_SETTINGS", "MOD_DATA_MANAGEMENT"],
    order: 80,
  },
  {
    appId: "me",
    kind: "core",
    labelKey: "nav.app.me",
    blurbKey: "nav.app.meDesc",
    icon: User,
    landingHref: "/inbox",
    navGroupIds: ["me"],
    moduleCodes: ["CORE_AUTH"],
    order: 90,
  },
];

// ── Derived lookup maps (built once) ─────────────────────────────────────────

const APP_BY_ID = new Map<string, AppDescriptor>(APPS.map((a) => [a.appId, a]));

/** module code → owning app (first app that lists the module). */
const APP_BY_MODULE = new Map<string, AppDescriptor>();
for (const app of APPS) {
  for (const code of app.moduleCodes) {
    if (!APP_BY_MODULE.has(code)) APP_BY_MODULE.set(code, app);
  }
}

/** nav group.id → app (first app that lists the group) — fallback for unowned routes. */
const APP_BY_GROUP = new Map<string, AppDescriptor>();
for (const app of APPS) {
  for (const gid of app.navGroupIds) {
    if (!APP_BY_GROUP.has(gid)) APP_BY_GROUP.set(gid, app);
  }
}

const CORE_SET = new Set(CORE_MODULE_CODES);

// ── Public API ───────────────────────────────────────────────────────────────

/** All apps in launcher order. */
export function listApps(): AppDescriptor[] {
  return [...APPS].sort((a, b) => a.order - b.order);
}

/** The sellable SKU apps only (locked/upsell candidates). */
export function listSellableApps(): AppDescriptor[] {
  return listApps().filter((a) => a.kind === "sellable");
}

export function getAppById(appId: string): AppDescriptor | undefined {
  return APP_BY_ID.get(appId);
}

export function getAppForModule(moduleCode: string): AppDescriptor | undefined {
  return APP_BY_MODULE.get(moduleCode);
}

export function getAppForGroup(groupId: string): AppDescriptor | undefined {
  return APP_BY_GROUP.get(groupId);
}

/**
 * Resolve which app a route/href belongs to. Primary: the route's OWNING module
 * (module-registry) → app. Fallback: the item's legacy nav group → app. Returns
 * undefined only for routes that are neither owned nor in any known group.
 */
export function getAppForRoute(href: string): AppDescriptor | undefined {
  const path = (href || "").split("?")[0];
  const mod = getModuleByRoute(path);
  if (mod) {
    const byModule = APP_BY_MODULE.get(mod.code);
    if (byModule) return byModule;
  }
  const group = getGroupByHref(path);
  if (group) return APP_BY_GROUP.get(group.id);
  return undefined;
}

/**
 * Is an app unlocked for the given allowed module codes? Core apps are always allowed;
 * a sellable app is allowed if ANY of its backing modules is owned (so a two-SKU tile
 * like Engineering shows when either half is bought; per-item license hides the rest).
 */
export function isAppAllowed(app: AppDescriptor, allowedModuleCodes: Iterable<string>): boolean {
  if (app.kind === "core") return true;
  const allowed = allowedModuleCodes instanceof Set ? allowedModuleCodes : new Set(allowedModuleCodes);
  return app.moduleCodes.some((c) => CORE_SET.has(c) || allowed.has(c));
}

/**
 * Scope an (already role/permission/license/mode-filtered) group list down to the ONE
 * active app: keep only items whose resolved app === appId, dropping now-empty groups.
 * This is what turns the 9-group sidebar into a single-app menu — and reorganises items
 * across the old groups (an item follows its owning module's app, not its legacy group).
 */
export function scopeGroupsToApp(groups: NavGroup[], appId: string): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => getAppForRoute(it.href)?.appId === appId) }))
    .filter((g) => g.items.length > 0);
}

/** Dev/self-check: every app's backing module codes are real registry codes. */
export function validateAppRegistry(): string[] {
  const known = new Set(SYSTEM_MODULES.map((m) => m.code));
  const problems: string[] = [];
  for (const app of APPS) {
    for (const code of app.moduleCodes) {
      if (!known.has(code)) problems.push(`app "${app.appId}" → unknown module "${code}"`);
    }
  }
  return problems;
}

export default APPS;
