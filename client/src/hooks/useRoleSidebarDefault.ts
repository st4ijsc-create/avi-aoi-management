/**
 * Doc 10 / U7 — role-appropriate DEFAULT sidebar width.
 *
 * Shop-floor roles (operator/maintenance) get a narrower, less-busy rail; everyone else
 * gets the standard width. This is only a DEFAULT used when the user has never set their
 * own width (no "sidebar-width" in localStorage) — a user's explicit choice always wins.
 */
const ROLE_DEFAULT_WIDTH: Record<string, number> = {
  operator: 220,
  maintenance: 220,
};

/** The default sidebar width (px) for a role, or undefined to fall back to the app default. */
export function roleSidebarWidth(role?: string | null): number | undefined {
  return role ? ROLE_DEFAULT_WIDTH[role] : undefined;
}
