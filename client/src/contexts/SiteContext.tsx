/**
 * DS F0 → F2 — <SiteProvider> / useSite() (doc 23 §F0 + §F2).
 *
 * The multi-site scope context the header SiteSwitcher builds on. F0 landed this
 * as an inert scaffold; F2 makes it a real, populatable store:
 *   • `sites` starts empty and is filled by the SiteSwitcher IF the current role
 *     can read the (admin-gated) sites list — otherwise it stays empty and the
 *     switcher degrades to a static "All sites" label (no crash).
 *   • `activeSiteId` is PERSISTED to localStorage so a chosen site survives reloads.
 *   • This context is CONTEXT-ONLY — it does NOT rewire page data-queries to filter
 *     by site (future work). It carries the ecosystem scope in the chrome.
 *
 * The default value is all-sites / empty list, so a component that calls `useSite()`
 * without a provider still gets a sane, inert value (no throw).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

/** Scope of the current view: everything, a single site, or a single line. */
export type SiteScope = "all" | "site" | "line";

export interface SiteSummary {
  id: string;
  name: string;
}

export interface SiteContextValue {
  /** Current scope granularity. Defaults to `all`. */
  scope: SiteScope;
  /** Known sites (empty until the switcher fetches them / when access is denied). */
  sites: SiteSummary[];
  /** Selected site id, or `null` for all-sites. */
  activeSiteId: string | null;
  /** Set the active site (null → all-sites). Persisted to localStorage. */
  setActiveSiteId: (id: string | null) => void;
  /** Replace the known sites list (called by the SiteSwitcher once fetched). */
  setSites: (sites: SiteSummary[]) => void;
}

/** Inert default so `useSite()` is safe with no provider mounted. */
const DEFAULT_VALUE: SiteContextValue = {
  scope: "all",
  sites: [],
  activeSiteId: null,
  setActiveSiteId: () => {},
  setSites: () => {},
};

const SiteContext = createContext<SiteContextValue>(DEFAULT_VALUE);

/** localStorage key for the persisted active-site selection. */
const ACTIVE_SITE_KEY = "active-site-id";

function readStoredActiveSite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(ACTIVE_SITE_KEY);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export interface SiteProviderProps {
  children: React.ReactNode;
  /** Seed the sites list (usually left empty; the switcher populates it). */
  initialSites?: SiteSummary[];
  /** Seed the active site (falls back to the persisted value). */
  initialActiveSiteId?: string | null;
}

export function SiteProvider({
  children,
  initialSites = [],
  initialActiveSiteId,
}: SiteProviderProps) {
  const [sites, setSites] = useState<SiteSummary[]>(initialSites);
  const [activeSiteId, setActiveSiteIdState] = useState<string | null>(
    () => initialActiveSiteId ?? readStoredActiveSite(),
  );

  // Persist the active-site selection so it survives reloads/navigations.
  const setActiveSiteId = useCallback((id: string | null) => {
    setActiveSiteIdState(id);
    try {
      if (id) window.localStorage.setItem(ACTIVE_SITE_KEY, id);
      else window.localStorage.removeItem(ACTIVE_SITE_KEY);
    } catch {
      /* storage unavailable — in-memory only */
    }
  }, []);

  // If the persisted/seeded active site is no longer in the known list (e.g. it
  // was deleted, or the role lost access), fall back to all-sites so the switcher
  // never shows a dangling selection.
  useEffect(() => {
    if (activeSiteId && sites.length > 0 && !sites.some(s => s.id === activeSiteId)) {
      setActiveSiteId(null);
    }
  }, [activeSiteId, sites, setActiveSiteId]);

  const value = useMemo<SiteContextValue>(
    () => ({
      scope: activeSiteId ? "site" : "all",
      sites,
      activeSiteId,
      setActiveSiteId,
      setSites,
    }),
    [activeSiteId, sites, setActiveSiteId],
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** Access the current site scope. Safe without a provider (returns the inert default). */
export function useSite(): SiteContextValue {
  return useContext(SiteContext);
}

export default SiteContext;
