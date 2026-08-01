/**
 * doc 59 P0 — pure URL helpers for TabbedHub + the WorkspaceShell client flag.
 *
 * Kept framework-free (no React, no import.meta at module top level) so the URL
 * logic is unit-testable in the node vitest env (*.unit.test.ts). The tab-sync
 * behaviour is the one that used to be copy-pasted in every hub (DeviceHub,
 * ConnectivityHub, MonitoringSettings, QualityCockpit).
 */

/** Resolve the active tab from a `?tab=` query, falling back when absent/invalid. */
export function resolveActiveTab(search: string, valid: readonly string[], fallback: string): string {
  const tab = new URLSearchParams(search).get("tab");
  return tab && valid.includes(tab) ? tab : fallback;
}

/**
 * Build the href for switching to `tab` while PRESERVING every other query param
 * (e.g. `?machine=243` in a master-detail workspace). This is why hubs must not
 * blindly overwrite the search string.
 */
export function buildTabHref(basePath: string, search: string, tab: string): string {
  const params = new URLSearchParams(search);
  params.set("tab", tab);
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * WorkspaceShell master-detail rollout flag (doc 59). Convention mirrors the repo's
 * other client flags: localStorage override ("true"/"false") → VITE env → default.
 *
 * doc 59 P3 (USER duyệt 2026-07-18 "bật mặc định ngay"): default is now ON — the
 * Machine Workspace IS /device-monitor. Set `VITE_WORKSPACE_SHELL_ENABLED=false`
 * (or localStorage `workspaceShellEnabled="false"`) to fall back to the legacy hub.
 */
export const WORKSPACE_SHELL_FLAG_KEY = "workspaceShellEnabled";

export function isWorkspaceShellEnabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      const v = window.localStorage.getItem(WORKSPACE_SHELL_FLAG_KEY);
      if (v === "true") return true;
      if (v === "false") return false;
    } catch {
      /* storage unavailable — fall through to env default */
    }
  }
  return import.meta.env.VITE_WORKSPACE_SHELL_ENABLED !== "false";
}
