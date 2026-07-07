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
import { NavGroup, NavItem, buildModuleL2, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";
import { useIsCoarsePointer } from "@/hooks/useMobile";
import { useSidebar } from "@/components/ui/sidebar";
import { BetaBadge } from "./BetaBadge";

/**
 * R4 — Inline-accordion navigation with a floating Level-3 page menu.
 *
 * Level 1: module rows in the sidebar (icon + label + chevron). Click a module →
 *   its categories drop straight down inline below it (accordion), like a classic
 *   expanding sidebar.
 * Level 2: category rows rendered INLINE under the open module. Orphan / flat
 *   (section-less) modules drop their pages directly as item rows (no Level 3).
 * Level 3: the pages of a category. Fine pointer → a floating menu anchored beside
 *   the hovered category row (keeps Level 2 compact). Touch (coarse) → the pages
 *   expand inline under the tapped category instead (single-column drill).
 *
 * Triggers: L1→L2 = click (toggle accordion). L2→L3 = hover (fine, ~120ms close-
 * delay so the cursor can reach the floating menu) / tap (touch, inline). Esc +
 * click-outside + navigation close all.
 *
 * The `groups` prop is ALREADY role/permission/license-filtered — never re-filter
 * here. The Level-3 floating menu uses fixed positioning (with horizontal flip/clamp)
 * so it is never clipped by the sidebar overflow or the viewport edge.
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
  const [hoverCategoryKey, setHoverCategoryKey] = useState<string | null>(null);
  // Bumped when a keyboard user asks to step INTO the open flyout. The panel focuses
  // its first item on each new value; mount alone (hover) never steals focus.
  const [enterPanelSeq, setEnterPanelSeq] = useState(0);

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
  const categoryRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of the open category so returnFocusToCategory can stay a stable callback
  // (the panel's native keydown listener depends on it — no per-render re-subscribe).
  const hoverCategoryKeyRef = useRef<string | null>(null);
  useEffect(() => {
    hoverCategoryKeyRef.current = hoverCategoryKey;
  }, [hoverCategoryKey]);

  const activeGroup = groups.find(g => g.id === activeModuleId) ?? null;

  const closeAll = useCallback(() => {
    setActiveModuleId(null);
    setHoverCategoryKey(null);
  }, []);

  // Click-outside (pointerdown) closes Level-2 & Level-3.
  useEffect(() => {
    if (!activeModuleId) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (containerRef.current?.contains(target as Node)) return;
      if (target?.closest?.("[data-cascading-panel]")) return;
      closeAll();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [activeModuleId, closeAll]);

  // Esc closes panels.
  useEffect(() => {
    if (!activeModuleId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeAll();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeModuleId, closeAll]);

  // Clear any pending close timer on unmount.
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleCategoryClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setHoverCategoryKey(null), CLOSE_DELAY_MS);
  }, [cancelClose]);

  const handleModuleClick = useCallback((groupId: string) => {
    setHoverCategoryKey(null);
    setActiveModuleId(prev => (prev === groupId ? null : groupId));
  }, []);

  // Touch: tapping a category toggles its inline expansion (tap again collapses).
  const handleToggleCategory = useCallback(
    (key: string) => {
      cancelClose();
      setHoverCategoryKey(prev => (prev === key ? null : key));
    },
    [cancelClose],
  );

  const handleNavigate = useCallback(
    (href: string) => {
      onNavigate(href);
      // Close ONLY the Level-3 flyout — keep the module (Level-2) expanded so it
      // does not collapse when you pick a Level-3 page. The module stays open
      // because the new route belongs to it (moduleForPath keeps it active).
      cancelClose();
      setHoverCategoryKey(null);
    },
    [onNavigate, cancelClose],
  );

  const openCategory = useCallback(
    (key: string) => {
      cancelClose();
      setHoverCategoryKey(key);
    },
    [cancelClose],
  );

  // Keyboard: open the flyout AND step focus into its first item. Called for
  // Enter/Space/ArrowRight/ArrowDown on a focused category button (fine pointer).
  const enterCategoryPanel = useCallback(
    (key: string) => {
      openCategory(key);
      setEnterPanelSeq(n => n + 1);
    },
    [openCategory],
  );

  // Escape / ArrowLeft inside the flyout: close it and return focus to the category
  // button (still mounted — the module stays open). Stable so the panel's native
  // keydown listener never re-subscribes.
  const returnFocusToCategory = useCallback(() => {
    const key = hoverCategoryKeyRef.current;
    setHoverCategoryKey(null);
    if (key) categoryRowRefs.current[key]?.focus();
  }, []);

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
                categories that open a Level-3 menu. */}
            {isOpen && (
              <div className="mt-0.5 space-y-0.5 pl-3">
                {l2.map(entry => {
                  // Hub page → direct link at Level 2 (no Level-3).
                  if (entry.kind === "link") {
                    return (
                      <div
                        key={entry.item.href}
                        onMouseEnter={coarse ? undefined : scheduleCategoryClose}
                      >
                        <ItemRow
                          item={entry.item}
                          isActive={isNavItemActive(entry.item.href, currentPath)}
                          onNavigate={handleNavigate}
                          variant="pill"
                        />
                      </div>
                    );
                  }
                  // Category → opens the Level-3 floating menu on hover (fine pointer)
                  // or expands its items inline on tap (touch).
                  const categoryHasActive = entry.items.some(i => isNavItemActive(i.href, currentPath));
                  const isCatOpen = hoverCategoryKey === entry.key;
                  return (
                    <div key={entry.key}>
                      <button
                        ref={el => {
                          categoryRowRefs.current[entry.key] = el;
                        }}
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={isCatOpen}
                        onMouseEnter={coarse ? undefined : () => openCategory(entry.key)}
                        onMouseLeave={coarse ? undefined : scheduleCategoryClose}
                        onFocus={coarse ? undefined : () => openCategory(entry.key)}
                        onKeyDown={
                          coarse
                            ? undefined
                            : e => {
                                // Open the flyout and move focus into its first page.
                                // (Coarse pointers expand inline — natively tabbable.)
                                if (
                                  e.key === "ArrowRight" ||
                                  e.key === "ArrowDown" ||
                                  e.key === "Enter" ||
                                  e.key === " "
                                ) {
                                  e.preventDefault();
                                  enterCategoryPanel(entry.key);
                                }
                              }
                        }
                        onClick={() =>
                          coarse ? handleToggleCategory(entry.key) : openCategory(entry.key)
                        }
                        className={cn(
                          "flex w-full items-center gap-3 rounded-full px-3 text-sm transition-colors",
                          coarse ? "py-3" : "py-2",
                          "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isCatOpen && "bg-sidebar-accent",
                          categoryHasActive ? "font-medium text-primary" : "text-popover-foreground",
                        )}
                      >
                        <span className={categoryHasActive ? "text-primary" : "text-muted-foreground"}>
                          {entry.items[0]?.icon}
                        </span>
                        <span className="flex-1 text-left">{t(entry.label)}</span>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            coarse && isCatOpen && "rotate-90",
                          )}
                        />
                      </button>
                      {/* Touch: inline-expanded items (replaces the Level-3 side flyout). */}
                      {coarse && isCatOpen && (
                        <div className="mt-0.5 space-y-0.5 pl-3">
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
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Level 3 — items flyout (fine pointer only; touch expands inline above). */}
      {!coarse && activeGroup && hoverCategoryKey && (
        <Level3Panel
          key={hoverCategoryKey}
          anchorEl={categoryRowRefs.current[hoverCategoryKey] ?? null}
          group={activeGroup}
          categoryKey={hoverCategoryKey}
          currentPath={currentPath}
          onNavigate={handleNavigate}
          onEnter={cancelClose}
          onLeave={scheduleCategoryClose}
          focusFirstSignal={enterPanelSeq}
          onReturnFocus={returnFocusToCategory}
        />
      )}
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

// ── Level 3 — items flyout ──────────────────────────────────────────────────
interface Level3PanelProps {
  anchorEl: HTMLElement | null;
  group: NavGroup;
  categoryKey: string;
  currentPath: string;
  onNavigate: (href: string) => void;
  onEnter: () => void;
  onLeave: () => void;
  /** Bumped by the category button when a keyboard user asks to enter the flyout
   *  (Enter/Space/ArrowRight/ArrowDown). Each new value moves focus to the first
   *  item — mount alone (hover-open) does NOT steal focus. */
  focusFirstSignal: number;
  /** Escape / ArrowLeft inside the flyout: close it and return focus to the
   *  category button (handled by the parent, which still owns that ref). */
  onReturnFocus: () => void;
}

function Level3Panel({
  anchorEl,
  group,
  categoryKey,
  currentPath,
  onNavigate,
  onEnter,
  onLeave,
  focusFirstSignal,
  onReturnFocus,
}: Level3PanelProps) {
  const { t } = useTranslation();
  const pos = useAnchoredPosition(anchorEl, PANEL_WIDTH);
  const entry = buildModuleL2(group).find(e => e.kind === "category" && e.key === categoryKey);
  const isCategory = !!entry && entry.kind === "category";
  const items = isCategory ? entry.items : [];
  const count = items.length;

  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Roving focus: exactly one item carries tabIndex=0. `activeIndexRef` mirrors the
  // state so the (stable) native keydown listener can read it without re-subscribing.
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);

  const focusItem = useCallback(
    (i: number) => {
      if (count === 0) return;
      const idx = ((i % count) + count) % count; // wrap both directions
      activeIndexRef.current = idx;
      setActiveIndex(idx);
      itemRefs.current[idx]?.focus();
    },
    [count],
  );

  // Move focus to the first item when the category button requests entry via keyboard.
  // Guarded so a plain hover-open mount does not yank focus away from the page.
  const lastSignal = useRef(focusFirstSignal);
  useEffect(() => {
    if (focusFirstSignal !== lastSignal.current) {
      lastSignal.current = focusFirstSignal;
      focusItem(0);
    }
  }, [focusFirstSignal, focusItem]);

  // WAI-ARIA menu roving-focus keys. Attached natively (not via React onKeyDown) so
  // `stopPropagation` on Escape runs BEFORE the document-level Esc handler — which
  // would otherwise collapse the whole module instead of just this flyout.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          e.stopPropagation();
          focusItem(activeIndexRef.current + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          e.stopPropagation();
          focusItem(activeIndexRef.current - 1);
          break;
        case "Home":
          e.preventDefault();
          e.stopPropagation();
          focusItem(0);
          break;
        case "End":
          e.preventDefault();
          e.stopPropagation();
          focusItem(count - 1);
          break;
        case "Escape":
        case "ArrowLeft":
          e.preventDefault();
          e.stopPropagation();
          onReturnFocus();
          break;
        // Enter / Space fall through to the item button's native activation → onNavigate.
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [count, focusItem, onReturnFocus]);

  if (!pos || !isCategory) return null;

  // Portal to <body> so the fixed panel escapes the sidebar's stacking context and
  // renders above page content (otherwise page cards can paint over it).
  return createPortal(
    <div
      ref={panelRef}
      data-cascading-panel
      role="menu"
      aria-label={t(entry.label)}
      className={panelClass}
      style={{ left: pos.left, top: pos.top, width: PANEL_WIDTH }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      // Cancel any pending hover-close the instant keyboard focus enters the flyout,
      // so roving through items never races the close timer shut.
      onFocus={onEnter}
    >
      <div className="space-y-0.5">
        {items.map((item, i) => (
          <ItemRow
            key={item.href}
            item={item}
            isActive={isNavItemActive(item.href, currentPath)}
            onNavigate={onNavigate}
            tabIndex={i === activeIndex ? 0 : -1}
            buttonRef={el => {
              itemRefs.current[i] = el;
            }}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

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
        "flex w-full items-center gap-2 text-sm transition-colors",
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
  const [categoryKey, setCategoryKey] = useState<string | null>(null);

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
              onClick={() => {
                setModuleId(g.id);
                setCategoryKey(null);
              }}
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
  const activeCategory = l2.find(
    (e): e is Extract<typeof e, { kind: "category" }> =>
      e.kind === "category" && e.key === categoryKey,
  );

  // Level 2 — items inside a selected category (non-hub pages).
  if (activeCategory) {
    return (
      <div className="space-y-0.5 px-2">
        <button
          type="button"
          onClick={() => setCategoryKey(null)}
          className="mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{t(activeCategory.label)}</span>
        </button>
        {activeCategory.items.map(item => (
          <ItemRow
            key={item.href}
            item={item}
            isActive={isNavItemActive(item.href, currentPath)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    );
  }

  // Level 1 — the module's Level-2 list: hub pages as direct links, the rest as
  // categories that drill into their items.
  return (
    <div className="space-y-0.5 px-2">
      <button
        type="button"
        onClick={() => {
          setModuleId(null);
          setCategoryKey(null);
        }}
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
        const categoryHasActive = entry.items.some(i => isNavItemActive(i.href, currentPath));
        return (
          <button
            key={entry.key}
            type="button"
            onClick={() => setCategoryKey(entry.key)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm transition-colors",
              "hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              categoryHasActive ? "text-primary font-medium" : "text-sidebar-foreground",
            )}
          >
            <span className={categoryHasActive ? "text-primary" : "text-muted-foreground"}>
              {entry.items[0]?.icon}
            </span>
            <span className="flex-1 text-left">{t(entry.label)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}
