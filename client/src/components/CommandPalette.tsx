import { useMemo, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { Search, Star, StarOff, Check } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { NavGroup, NavItem, isNavItemActive } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const RECENT_KEY = "nav-recent";
const FAVORITES_KEY = "nav-favorites";
const RECENT_SEARCH_KEY = "nav-recent-search";
const RECENT_MAX = 5;
const RECENT_SEARCH_MAX = 5;

/** Read a JSON string-array from localStorage, tolerating bad/missing data. */
function readHrefList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

function writeHrefList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Push an href to the front of nav-recent (de-duped, capped). Exposed so the
 * navigation site (DashboardLayout) can record visits if it prefers. */
export function pushRecentHref(href: string) {
  const next = [href, ...readHrefList(RECENT_KEY).filter(h => h !== href)].slice(0, RECENT_MAX);
  writeHrefList(RECENT_KEY, next);
}

/** Push a non-trivial search term to the front of the recent-searches list. */
function pushRecentSearch(term: string) {
  const q = term.trim();
  if (q.length < 2) return;
  const next = [q, ...readHrefList(RECENT_SEARCH_KEY).filter(h => h.toLowerCase() !== q.toLowerCase())].slice(
    0,
    RECENT_SEARCH_MAX,
  );
  writeHrefList(RECENT_SEARCH_KEY, next);
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already role/permission/license-filtered nav groups (from DashboardLayout). */
  groups: NavGroup[];
  /** Navigate to href and close the palette. */
  onNavigate: (href: string) => void;
}

type FlatItem = {
  item: NavItem;
  group: NavGroup;
  /** Muted hint: "Group label · Section label" — also fed to cmdk for matching. */
  hint: string;
};

export function CommandPalette({ open, onOpenChange, groups, onNavigate }: CommandPaletteProps) {
  const { t } = useTranslation();
  // Current location WITH query (mirrors DashboardLayout's `navActivePath`), so the
  // active row honours pinned `?tab=` deep-links exactly like the sidebar.
  const [loc] = useLocation();
  const searchStr = useSearch();
  const activePath = searchStr ? `${loc}?${searchStr}` : loc;
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // Refresh recent/favorites/searches every time the palette opens (other surfaces
  // may have mutated localStorage since last open).
  useEffect(() => {
    if (open) {
      setFavorites(readHrefList(FAVORITES_KEY));
      setRecent(readHrefList(RECENT_KEY));
      setRecentSearches(readHrefList(RECENT_SEARCH_KEY));
      setSearch("");
    }
  }, [open]);

  // Flatten visible groups → one command per item, with a group/section hint.
  const flat = useMemo<FlatItem[]>(() => {
    const out: FlatItem[] = [];
    for (const group of groups) {
      const groupLabel = t(group.label);
      for (const item of group.items) {
        const sectionLabel = item.section ? t(`nav.section.${item.section}`) : null;
        const hint = sectionLabel ? `${groupLabel} · ${sectionLabel}` : groupLabel;
        out.push({ item, group, hint });
      }
    }
    return out;
  }, [groups, t]);

  // Fast href → FlatItem lookup, used to resolve recent/favorite hrefs and to
  // skip any that are no longer visible to this user.
  const byHref = useMemo(() => {
    const map = new Map<string, FlatItem>();
    for (const f of flat) map.set(f.item.href, f);
    return map;
  }, [flat]);

  const toggleFavorite = useCallback((href: string) => {
    setFavorites(prev => {
      const next = prev.includes(href) ? prev.filter(h => h !== href) : [href, ...prev];
      writeHrefList(FAVORITES_KEY, next);
      return next;
    });
  }, []);

  const handleNavigate = useCallback(
    (href: string) => {
      pushRecentHref(href);
      // If the user typed a query to reach this result, remember it as a recent search.
      if (search.trim().length >= 2) pushRecentSearch(search);
      onNavigate(href);
    },
    [onNavigate, search],
  );

  const isEmptySearch = search.trim() === "";

  // Resolve recent/favorite hrefs to currently-visible items (skip hidden ones).
  const favoriteItems = useMemo(
    () => favorites.map(h => byHref.get(h)).filter((f): f is FlatItem => !!f),
    [favorites, byHref],
  );
  const recentItems = useMemo(
    () => recent.map(h => byHref.get(h)).filter((f): f is FlatItem => !!f),
    [recent, byHref],
  );

  const renderStar = (href: string) => {
    const isFav = favorites.includes(href);
    const Icon = isFav ? Star : StarOff;
    return (
      <button
        type="button"
        aria-label={isFav ? "Unfavorite" : "Favorite"}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          toggleFavorite(href);
        }}
        className={cn(
          "ml-auto rounded p-1 opacity-60 transition-colors hover:bg-accent hover:opacity-100",
          isFav && "text-yellow-500 opacity-100",
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    );
  };

  const renderRow = (f: FlatItem) => {
    const active = isNavItemActive(f.item.href, activePath);
    return (
      <CommandItem
        key={f.item.href}
        // `value` is what cmdk fuzzy-matches against — include label + hint.
        value={`${t(f.item.label)} ${f.hint} ${f.item.href}`}
        onSelect={() => handleNavigate(f.item.href)}
        aria-current={active ? "page" : undefined}
        className="gap-2"
      >
        <span className={cn("shrink-0 text-muted-foreground", active && "text-primary")}>
          {f.item.icon}
        </span>
        <span className={cn("truncate", active && "font-medium text-primary")}>
          {t(f.item.label)}
        </span>
        <span className="ml-2 truncate text-xs text-muted-foreground">{f.hint}</span>
        {active && (
          <Check className="ml-auto h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        )}
        {renderStar(f.item.href)}
      </CommandItem>
    );
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("nav.searchPlaceholder")}
      description={t("nav.searchPlaceholder")}
    >
      <CommandInput
        placeholder={t("nav.searchPlaceholder")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>{t("nav.searchEmpty")}</CommandEmpty>

        {isEmptySearch && recentSearches.length > 0 && (
          <>
            <CommandGroup heading={t("nav.recentSearches", "Recent searches")}>
              {recentSearches.map(term => (
                <CommandItem
                  key={`search-${term}`}
                  value={`__recent_search__ ${term}`}
                  onSelect={() => setSearch(term)}
                  className="gap-2"
                >
                  <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{term}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {isEmptySearch && favoriteItems.length > 0 && (
          <>
            <CommandGroup heading={t("nav.favorites")}>
              {favoriteItems.map(renderRow)}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {isEmptySearch && recentItems.length > 0 && (
          <>
            <CommandGroup heading={t("nav.recent")}>
              {recentItems.map(renderRow)}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {groups.map((group, idx) => {
          const items = flat.filter(f => f.group.id === group.id);
          if (items.length === 0) return null;
          return (
            <div key={group.id}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup heading={t(group.label)}>
                {items.map(renderRow)}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;
