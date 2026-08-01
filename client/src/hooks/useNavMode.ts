/**
 * doc 22 P4 — Simple vs Advanced navigation mode.
 *
 * A user-toggleable menu mode, persisted in localStorage:
 *   - "simple"   → everyday groups only (Overview/Dashboard, Production, Quality,
 *                  Alerts, Reports, Me). Engineering-heavy modules (Devices & OT,
 *                  AI ops internals, Admin/Federation) + advanced items are hidden.
 *   - "advanced" → the full menu (power-user surface, unchanged).
 *
 * DEFAULT per role: technical roles (admin / it_admin / engineer) start in Advanced;
 * every other role (operator / supervisor / viewer / user / quality_inspector / …)
 * starts in Simple. The default is only used until the user makes an explicit choice
 * — their stored preference always wins thereafter.
 */
import { useCallback, useEffect, useState } from "react";
import { type NavMode, defaultNavModeForRole } from "@/lib/navigation";

const STORAGE_KEY = "nav-mode";

function readStored(): NavMode | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "simple" || v === "advanced" ? v : null;
  } catch {
    return null;
  }
}

export interface UseNavModeResult {
  /** Current effective menu mode. */
  mode: NavMode;
  /** True once the user has explicitly chosen a mode (vs. the role default). */
  isExplicit: boolean;
  setMode: (mode: NavMode) => void;
  toggleMode: () => void;
}

/**
 * @param role the authenticated user's role — drives the DEFAULT mode when the
 *             user has not yet made an explicit choice.
 */
export function useNavMode(role?: string | null): UseNavModeResult {
  // Seed from storage → else role default. Lazy init so SSR/first paint is stable.
  const [mode, setModeState] = useState<NavMode>(
    () => readStored() ?? defaultNavModeForRole(role),
  );
  const [isExplicit, setIsExplicit] = useState<boolean>(() => readStored() != null);

  // When the role resolves (auth loads after mount), adopt its default — but only
  // while the user has NOT made an explicit choice (respect a stored preference).
  useEffect(() => {
    if (isExplicit) return;
    const stored = readStored();
    if (stored) {
      setModeState(stored);
      setIsExplicit(true);
      return;
    }
    setModeState(defaultNavModeForRole(role));
  }, [role, isExplicit]);

  // Cross-tab sync — mirror an explicit change made in another tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readStored();
      if (next) {
        setModeState(next);
        setIsExplicit(true);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setMode = useCallback((next: NavMode) => {
    setModeState(next);
    setIsExplicit(true);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — in-memory only */
    }
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === "simple" ? "advanced" : "simple");
  }, [mode, setMode]);

  return { mode, isExplicit, setMode, toggleMode };
}
