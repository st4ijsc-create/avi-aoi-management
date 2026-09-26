/**
 * Roles allowed to actuate — the client mirror of the server's ACTUATION_ROLES
 * (server/_core/trpc.ts, `actuationProcedure`). Advisory only: the server stays the wall; the
 * client uses it to avoid showing an enabled control that would end in FORBIDDEN.
 */
export const ACTUATION_ROLES = ["admin", "supervisor", "engineer"] as const;

export function isActuationRole(role: string | null | undefined): boolean {
  return role != null && (ACTUATION_ROLES as readonly string[]).includes(role);
}
