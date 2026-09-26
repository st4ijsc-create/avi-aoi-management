import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavGroup, NavItem, L2Entry, buildModuleL2, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useIsCoarsePointer } from "@/hooks/useMobile";
import { useSidebar } from "@/components/ui/sidebar";
import { BetaBadge } from "./BetaBadge";

/**
 * R4 — Inline-accordion navigation (click-to-expand at every level, all pointers).
 *
 * Level 1: module rows in the sidebar (icon + label + chevron). Click a module →
 *   its categories drop straight down inline below it (accordion), like a classic
 *   expanding sidebar.
 * Level 2: category rows rendered INLINE under the open module. Orphan / flat
 *   (section-less) modules drop their pages directly as item rows (no Level 3).
 * Level 3: the pages of a category. Click a category → its pages expand INLINE
 *   right below it (single-column drill), for every pointer type. No hover flyout —
 *   the expanded pages are real links, reachable by Tab.
 *
 * Triggers: L1→L2 = click (toggle accordion). L2→L3 = click (toggle inline expand).
 * Esc + click-outside + navigation close all.
 *
 * The `groups` prop is ALREADY role/permission/license-filtered — never re-filter
 * here. (The collapsed icon rail still uses a fixed-positioned hover flyout — see
 * CollapsedRail below — which is intentional and unaffected by this component.)
 */

const CLOSE_DELAY_MS = 120;
const PANEL_WIDTH = 240;
const PANEL_GAP = 6;

interface CascadingNavProps {
  groups: NavGroup[];
  currentPath: string;
  onNavigate: (href: string) => void;
}

export function CascadingNav({ groups, currentPath, onNavigate }: CascadingNavProps) {
  const { t } = useTranslation();
  // When the rail is collapsed to icons, render the icon-only variant (module icons +
  // a hover flyout) instead of the full-width accordion (whose labels would otherwise
  // spill over the page content). `state` comes from the shadcn Sidebar provider.
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  // The module that owns the current route. Used so the open (Level-2) module
  // follows where you ARE — important because each page renders its own
  // DashboardLayout, so this nav remounts on every navigation; without this the
  // accordion would always reset to collapsed after navigating.
  const moduleForPath = useMemo(
    () => groups.find(g => g.items.some(i => isNavItemActive(i.href, currentPath)))?.id ?? null,
    [groups, currentPath],
  );
  // App-Launcher mode: the sidebar is scoped to ONE app, which usually resolves to a
  // single nav group. When the scoped `groups` collapses to exactly one module, that
  // module IS the app — auto-open it so its categories/pages are visible immediately
  // (otherwise the app shows just one collapsed Level-1 header the user must click).
  const soleModuleId = groups.length === 1 ? groups[0].id : null;
  // Open the current route's module by default (on mount / remount); when the scope is
  // a single module, open that instead (covers routes whose href isn't matched here).
  const [activeModuleId, setActiveModuleId] = useState<string | null>(moduleForPath ?? soleModuleId);

  // Principle: Level-2 only collapses when a DIFFERENT Level-1 is selected — not
  // when navigating within the same module. So when the route moves to a page in
  // ANOTHER module, expand that module; otherwise leave the user's accordion state
  // alone (so a manual collapse on the current page is respected).
  const prevPathModule = useRef(moduleForPath);
  useEffect(() => {
    if (moduleForPath && moduleForPath !== prevPathModule.current) {
      setActiveModuleId(moduleForPath);
    }
    prevPathModule.current = moduleForPath;
  }, [moduleForPath]);
  // App-Launcher app-switch: when the scoped `groups` changes to a SINGLE module
  // (switching to a one-module app), auto-open it — this reacts to scope changes, not
  // just first mount. Fires only when the sole module CHANGES, so a manual collapse
  // within the same single-module scope is respected (activeModuleId stays null until
  // the scope changes again). Multi-group scopes (soleModuleId === null) are untouched.
  const prevSoleModuleId = useRef(soleModuleId);
  useEffect(() => {
    if (soleModuleId && soleModuleId !== prevSoleModuleId.current) {
      setActiveModuleId(soleModuleId);
    }
    prevSoleModuleId.current = soleModuleId;
  }, [soleModuleId]);
  // Touch devices (tablets/phones in landscape that still show the rail): switch
  // Level-2→3 from hover to tap and expand items INLINE in the Level-2 panel
  // (single-column drill) instead of opening a separate Level-3 side flyout — this
  // avoids the rail+L2+L3 horizontal overflow on narrow touch screens.
  const coarse = useIsCoarsePointer();

  const containerRef = useRef<HTMLDivElement>(null);

  // NOTE: the inline accordion is PART of the persistent left sidebar — it is NOT a
  // transient popup. It must stay exactly as the user left it while they work in the
  // page (clicking an in-page tab, a button, or anywhere in the content must NOT
  // collapse it). So there is deliberately no click-outside / Esc "closeAll" here —
  // a module opens/closes only via its own header (handleModuleClick), and a category
  // only via its own row (handleToggleCategory). The collapsed icon-rail flyout has
  // its own dismissal logic in CollapsedRail (that one IS a transient flyout).

  const handleModuleClick = useCallback((groupId: string) => {
    setActiveModuleId(prev => (prev === groupId ? null : groupId));
  }, []);

  const handleNavigate = useCallback(
    (href: string) => {
      onNavigate(href);
      // Do NOT collapse the category on navigate — the category the user is in stays
      // OPEN (the categoryForPath effect keeps the active category open after the
      // per-page remount; other categories collapse because it's single-open).
    },
    [onNavigate],
  );

  // Collapsed icon rail (after all hooks, so the hook order is stable).
  if (collapsed && !coarse) {
    return <CollapsedRail groups={groups} currentPath={currentPath} onNavigate={onNavigate} />;
  }

  return (
    <div ref={containerRef} className="flex flex-col gap-0.5 px-2" data-cascading-nav>
      {groups.map(group => {
        const moduleHasActive = group.items.some(item => isNavItemActive(item.href, currentPath));
        const isOpen = group.id === activeModuleId;
        const isActive = isOpen || moduleHasActive;
        const l2 = buildModuleL2(group);
        return (
          <div key={group.id}>
            {/* Level 1 — module row (accordion header). Click drops categories straight down. */}
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => handleModuleClick(group.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-full px-3 text-sm transition-colors",
                coarse ? "py-3" : "py-2.5",
                "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "font-medium text-primary" : "text-sidebar-foreground",
              )}
            >
              <span className={isActive ? "text-primary" : "text-muted-foreground"}>
                {group.icon}
              </span>
              <span className="flex-1 text-left">{t(group.label)}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            {/* Level 2 — drops straight down inline under the module. Hub pages (with
                their own in-page tabs) are direct links; the rest stay grouped as
                categories that expand their pages inline on click. */}
            {isOpen && (
              <div className="mt-0.5 space-y-0.5 pl-3 animate-in fade-in-0 slide-in-from-top-1 duration-150 ease-out">
                {l2.map(entry => {
                  // Hub page → direct link at Level 2 (no Level-3).
                  if (entry.kind === "link") {
                    return (
                      <ItemRow
                        key={entry.item.href}
                        item={entry.item}
                        isActive={isNavItemActive(entry.item.href, currentPath)}
                        onNavigate={handleNavigate}
                        variant="pill"
                      />
                    );
                  }
                  // doc 60 FIX A — section = STATIC header, pages listed directly below
                  // it (no L3 click). Reaching a page is now 2 clicks (module → page)
                  // instead of 3. Same shape CollapsedFlyout already uses.
                  return (
                    <div key={entry.key} className="space-y-0.5">
                      <div className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t(entry.label)}
                      </div>
                      {entry.items.map(item => (
                        <ItemRow
                          key={item.href}
                          item={item}
                          isActive={isNavItemActive(item.href, currentPath)}
                          onNavigate={handleNavigate}
                          variant="pill"
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Floating-panel position hook ────────────────────────────────────────────
// Anchors a `panelWidth`-wide panel to the right of `anchorEl`. If it would overflow
// the right viewport edge, it flips to the LEFT of the anchor; if it still won't fit
// it clamps inside the margin — so panels are never clipped off-screen (narrow
// tablets, near-edge Level-3 flyouts).
function useAnchoredPosition(anchorEl: HTMLElement | null, panelWidth: number) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl) {
      setPos(null);
      return;
    }
    const compute = () => {
      const rect = anchorEl.getBoundingClientRect();
      const margin = 8;
      let top = rect.top;
      const maxTop = window.innerHeight - 48;
      if (top > maxTop) top = maxTop;
      if (top < margin) top = margin;

      // Prefer right of the anchor; flip left on overflow; clamp as last resort.
      let left = rect.right + PANEL_GAP;
      if (left + panelWidth > window.innerWidth - margin) {
        const flipped = rect.left - PANEL_GAP - panelWidth;
        left = flipped >= margin ? flipped : window.innerWidth - margin - panelWidth;
        if (left < margin) left = margin;
      }
      setPos({ left, top });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [anchorEl, panelWidth]);

  return pos;
}

const panelClass =
  "fixed z-[60] max-h-[80vh] overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg";

// ── Collapsed icon rail (module icons + hover flyout) ───────────────────────
/**
 * Rendered when the sidebar is collapsed to icons. Shows one centered icon per module
 * (native tooltip = label); hovering/clicking an icon opens a floating flyout with that
 * module's pages (Level-2 categories + items). The flyout is portalled to <body> and
 * fixed-positioned, so it is never clipped by the narrow rail.
 */
function CollapsedRail({ groups, currentPath, onNavigate }: CascadingNavProps) {
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const iconRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpenId(null), CLOSE_DELAY_MS);
  }, [cancelClose]);
  const openGroupId = useCallback((id: string) => {
    cancelClose();
    setOpenId(id);
  }, [cancelClose]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const handleNavigate = useCallback((href: string) => {
    onNavigate(href);
    cancelClose();
    setOpenId(null);
  }, [onNavigate, cancelClose]);

  const openGroup = groups.find(g => g.id === openId) ?? null;

  return (
    <div className="flex flex-col items-center gap-1 px-1" data-cascading-nav>
      {groups.map(group => {
        const active = group.items.some(i => isNavItemActive(i.href, currentPath));
        return (
          <button
            key={group.id}
            ref={el => { iconRefs.current[group.id] = el; }}
            type="button"
            aria-label={t(group.label)}
            title={t(group.label)}
            aria-haspopup="menu"
            aria-expanded={openId === group.id}
            onMouseEnter={() => openGroupId(group.id)}
            onMouseLeave={scheduleClose}
            onFocus={() => openGroupId(group.id)}
            onBlur={scheduleClose}
            onClick={() => openGroupId(group.id)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
              "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-sidebar-accent text-primary" : "text-muted-foreground",
            )}
          >
            {group.icon}
          </button>
        );
      })}
      {openGroup && (
        <CollapsedFlyout
          anchorEl={iconRefs.current[openGroup.id] ?? null}
          group={openGroup}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          onEnter={cancelClose}
          onLeave={scheduleClose}
        />
      )}
    </div>
  );
}

interface CollapsedFlyoutProps {
  anchorEl: HTMLElement | null;
  group: NavGroup;
  currentPath: string;
  onNavigate: (href: string) => void;
  onEnter: () => void;
  onLeave: () => void;
}

function CollapsedFlyout({ anchorEl, group, currentPath, onNavigate, onEnter, onLeave }: CollapsedFlyoutProps) {
  const { t } = useTranslation();
  const pos = useAnchoredPosition(anchorEl, PANEL_WIDTH);
  const l2 = useMemo(() => buildModuleL2(group), [group]);
  if (!pos) return null;

  return createPortal(
    <div
      data-cascading-panel
      role="menu"
      aria-label={t(group.label)}
      className={panelClass}
      style={{ left: pos.left, top: pos.top, width: PANEL_WIDTH }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="px-2 pb-1 pt-0.5 text-xs font-semibold text-popover-foreground">{t(group.label)}</div>
      <div className="space-y-0.5">
        {l2.map(entry =>
          entry.kind === "link" ? (
            <ItemRow
              key={entry.item.href}
              item={entry.item}
              isActive={isNavItemActive(entry.item.href, currentPath)}
              onNavigate={onNavigate}
            />
          ) : (
            <div key={entry.key} className="pt-1">
              <div className="px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {t(entry.label)}
              </div>
              {entry.items.map(item => (
                <ItemRow
                  key={item.href}
                  item={item}
                  isActive={isNavItemActive(item.href, currentPath)}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          ),
        )}
      </div>
    </div>,
    document.body,
  );
}

// ── Shared item row ─────────────────────────────────────────────────────────
interface ItemRowProps {
  item: NavItem;
  isActive: boolean;
  onNavigate: (href: string) => void;
  /** `pill` → Material 3 expanded-rail styling (used for flat items in Level 2).
   *  Default (Level 3) keeps the original rounded-lg row, unchanged. */
  variant?: "default" | "pill";
  /** Roving-focus tabIndex for WAI-ARIA menu items (Level-3 flyout): the active
   *  item is `0`, the rest `-1`. Omitted elsewhere → native default (focusable). */
  tabIndex?: number;
  /** Ref callback so a parent menu can `.focus()` this row during roving nav. */
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

function ItemRow({ item, isActive, onNavigate, variant = "default", tabIndex, buttonRef }: ItemRowProps) {
  const { t } = useTranslation();
  // Plain-language tooltip for jargon items (FOE, UNS, PackML, …). Shown as a
  // native title and, for jargon rows, a muted subtitle under the label.
  const hint = item.hint ? t(item.hint) : undefined;
  return (
    <button
      type="button"
      role="menuitem"
      ref={buttonRef}
      tabIndex={tabIndex}
      onClick={() => onNavigate(item.href)}
      title={hint}
      className={cn(
        "flex min-h-10 w-full items-center gap-2 text-sm transition-colors",
        variant === "pill" ? "gap-3 rounded-full px-3 py-2.5" : "rounded-lg px-2 py-2",
        "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isActive ? "bg-sidebar-accent text-primary font-medium" : "text-popover-foreground",
      )}
    >
      <span className={cn("shrink-0", isActive ? "text-primary" : "text-muted-foreground")}>{item.icon}</span>
      <span className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{t(item.label)}</span>
          {item.beta && <BetaBadge />}
        </span>
        {hint && (
          <span className="mt-0.5 block truncate text-[11px] font-normal leading-tight text-muted-foreground">
            {hint}
          </span>
        )}
      </span>
      {item.badge && (
        <span className="ml-auto shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
          {item.badge}
        </span>
      )}
    </button>
  );
}

// ── Mobile tap-drill navigation ─────────────────────────────────────────────
/**
 * Mobile variant rendered inside the existing Sidebar Sheet drawer.
 * Hover doesn't work on touch, so navigation is a tap-drill stack:
 *   modules → categories (or flat items) → items, with a Back affordance per level.
 * Same `groups` prop (already filtered) and `buildModuleL2` data as desktop.
 */
interface MobileDrillNavProps {
  groups: NavGroup[];
  currentPath: string;
  onNavigate: (href: string) => void;
}

export function MobileDrillNav({ groups, currentPath, onNavigate }: MobileDrillNavProps) {
  const { t } = useTranslation();
  const [moduleId, setModuleId] = useState<string | null>(null);

  const group = groups.find(g => g.id === moduleId) ?? null;

  // Level 0 — module list.
  if (!group) {
    return (
      <div className="space-y-0.5 px-2">
        {groups.map(g => {
          const isActive = g.items.some(item => isNavItemActive(item.href, currentPath));
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => setModuleId(g.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
                "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive ? "text-primary font-medium" : "text-sidebar-foreground",
              )}
            >
              <span className={isActive ? "text-primary" : "text-muted-foreground"}>
                {g.icon}
              </span>
              <span className="flex-1 text-left">{t(g.label)}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
      </div>
    );
  }

  const l2 = buildModuleL2(group);

  // doc 60 FIX A — module selected → ALL its pages listed (sections as static headers).
  // No more per-category drill (was Level 3). Back button returns to the module list.
  return (
    <div className="space-y-0.5 px-2">
      <button
        type="button"
        onClick={() => setModuleId(null)}
        className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{t(group.label)}</span>
      </button>
      {l2.map(entry => {
        if (entry.kind === "link") {
          return (
            <ItemRow
              key={entry.item.href}
              item={entry.item}
              isActive={isNavItemActive(entry.item.href, currentPath)}
              onNavigate={onNavigate}
            />
          );
        }
        // doc 60 FIX A — section = static header, pages listed directly (no drill).
        return (
          <div key={entry.key} className="space-y-0.5">
            <div className="px-3 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(entry.label)}
            </div>
            {entry.items.map(item => (
              <ItemRow
                key={item.href}
                item={item}
                isActive={isNavItemActive(item.href, currentPath)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}
