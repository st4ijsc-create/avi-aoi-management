/**
 * doc 36 — App Launcher vs Classic menu mode (reactive, persisted).
 *
 * The App Launcher (Phương án A) is the DEFAULT menu. Existing users who prefer the
 * old 9-group sidebar can switch to "classic" — the choice is persisted in localStorage
 * and mirrored across tabs. Default (no stored choice) = launcher ON. A deployment can
 * flip the default to classic with VITE_APP_LAUNCHER_V2="false".
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "APP_LAUNCHER_V2";

function readStored(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* storage unavailable */
  }
  // No explicit choice → App Launcher is the default (opt-out only).
  return import.meta.env.VITE_APP_LAUNCHER_V2 === "false" ? false : true;
}

export interface UseAppLauncherModeResult {
  /** True when the App Launcher menu is active; false = classic 9-group sidebar. */
  launcherOn: boolean;
  setLauncher: (on: boolean) => void;
  toggleLauncher: () => void;
}

export function useAppLauncherMode(): UseAppLauncherModeResult {
  const [launcherOn, setOn] = useState<boolean>(readStored);

  // Cross-tab sync.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setOn(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLauncher = useCallback((on: boolean) => {
    setOn(on);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(on));
    } catch {
      /* storage unavailable — in-memory only */
    }
  }, []);

  const toggleLauncher = useCallback(() => setLauncher(!launcherOn), [launcherOn, setLauncher]);

  return { launcherOn, setLauncher, toggleLauncher };
}
