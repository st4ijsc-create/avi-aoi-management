// doc 59 P0 — workspace consolidation primitives (WorkspaceShell / TabbedHub / ContextDrawer).
export { TabbedHub, type TabbedHubTab, type TabbedHubProps } from "./TabbedHub";
export { WorkspaceShell, type WorkspaceShellProps } from "./WorkspaceShell";
export { ContextDrawer, type ContextDrawerProps } from "./ContextDrawer";
export { HubLauncher, type HubTool, type HubCategory, type HubLauncherProps } from "./HubLauncher";
export { resolveActiveTab, buildTabHref, isWorkspaceShellEnabled, WORKSPACE_SHELL_FLAG_KEY } from "./hubState";
