/**
 * DS F0 — breadcrumb auto-builder (doc 23 §F0).
 *
 * Derives a `Module › Section › Page` trail for a route straight from the
 * canonical nav model in `./navigation` (`getGroupByHref`, `getNavItemByHref`,
 * `group.sections`, `item.section`), so pages don't hand-maintain breadcrumbs.
 *
 * i18n choice — the nav model stores labels as i18n KEYS (`nav.*`). This builder:
 *   • by default returns the raw keys (label = the `nav.*` key), because
 *     PageHeader's caller already calls `t()` on nav labels elsewhere; OR
 *   • if you pass a `t` function it resolves them for you, which is the ergonomic
 *     path for the F1/F2 PageHeader wiring (PageHeader renders labels verbatim).
 * Pick one and stay consistent per call-site.
 *
 * Matching strips any query string first (so `/audit-logs?tab=enhanced` resolves
 * to the `/audit-logs`-family item). Every crumb except the last carries an
 * `href` (the current page is plain text); the Module crumb links to the first
 * item of its group so it is navigable.
 */
import {
  getGroupByHref,
  getNavItemByHref,
  navGroups,
  type NavGroup,
} from "./navigation";

export interface Breadcrumb {
  /** i18n key (nav.*) by default, or the resolved string when a `t` fn is passed. */
  label: string;
  /** Present on all but the current (last) crumb. */
  href?: string;
}

/** Optional translator; matches i18next's `t(key) => string` shape. */
type TranslateFn = (key: string) => string;

/** getGroupByHref matches on the exact stored href (query included); this variant
 *  strips the query string first so `?tab=` routes still resolve to their group. */
function findGroupByPath(path: string): NavGroup | undefined {
  const direct = getGroupByHref(path);
  if (direct) return direct;
  return navGroups.find((group) =>
    group.items.some((item) => item.href.split("?")[0] === path),
  );
}

/**
 * Build the `Module › Section › Page` breadcrumb trail for a route.
 *
 * @param href   The current route (query string is ignored for matching).
 * @param t      Optional i18next translator. When provided, labels are resolved;
 *               otherwise raw `nav.*` keys are returned (caller translates).
 * @returns      Ordered crumbs, or `[]` when the route isn't in the nav model
 *               (e.g. detail routes like `/inspection/:id`).
 */
export function buildBreadcrumbs(href: string, t?: TranslateFn): Breadcrumb[] {
  const path = (href || "").split("?")[0];
  const group = findGroupByPath(path);
  const item = getNavItemByHref(path);
  if (!group || !item) return [];

  const label = (key: string): string => (t ? t(key) : key);
  const crumbs: Breadcrumb[] = [];

  // 1. Module — link to the group's first item so the crumb is navigable.
  const moduleHref = group.items[0]?.href;
  crumbs.push({ label: label(group.label), href: moduleHref });

  // 2. Section (only when this item declares one that the group defines).
  if (item.section && group.sections) {
    const section = group.sections.find((s) => s.key === item.section);
    if (section) {
      // Sections aren't independently routable → no href (plain text).
      crumbs.push({ label: label(section.label) });
    }
  }

  // 3. Page — current route, rendered as plain text (no href).
  crumbs.push({ label: label(item.label) });

  return crumbs;
}

export default buildBreadcrumbs;
