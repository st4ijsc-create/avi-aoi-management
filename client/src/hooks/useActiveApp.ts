/**
 * doc 36 W1 — resolve the CURRENT app from the route (+ persist the last choice).
 *
 * The active app is derived from the current location via `getAppForRoute` (route →
 * owning module → app). When a route doesn't resolve to any app (rare: params/redirects),
 * we fall back to the last persisted app, then the first app (Overview). The resolved app
 * is persisted so a full-page reload on an unowned route still opens the right menu.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { getAppForRoute, getAppById, listApps, type AppDescriptor } from "@/lib/apps";

const ACTIVE_APP_KEY = "active_app";

function readPersisted(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_APP_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export function useActiveApp(currentPath?: string): AppDescriptor {
  const [loc] = useLocation();
  const path = (currentPath || loc).split("?")[0];
  const resolved = getAppForRoute(path);
  const app = resolved || getAppById(readPersisted() || "") || listApps()[0];

  useEffect(() => {
    if (resolved) {
      try {
        localStorage.setItem(ACTIVE_APP_KEY, resolved.appId);
      } catch {
        /* storage unavailable */
      }
    }
  }, [resolved?.appId]);

  return app;
}
