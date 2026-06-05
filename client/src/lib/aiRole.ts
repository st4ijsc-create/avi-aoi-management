/**
 * C5 — Map APP role → AI UserRole.
 *
 * The application's user roles (server/db/auth.ts) differ from the AI copilot's
 * UserRole union (server/services/aiLocalKnowledgeService.ts:
 * "worker" | "engineer" | "manager" | "it_admin"). The backend validates the
 * AI role and uses it ONLY to shape the assistant's tone / scope of suggestions
 * — it does NOT grant any permission. We therefore map every app role to a safe
 * AI role, defaulting unknown/custom roles (e.g. from RoleBuilder) to "worker".
 *
 * Agreed mapping:
 *   admin              → it_admin
 *   supervisor         → manager
 *   quality_inspector  → engineer
 *   maintenance        → engineer
 *   operator           → worker
 *   viewer             → worker
 *   user               → worker
 *   (unknown / undefined) → worker  (safe default)
 */

export type AiUserRole = "worker" | "engineer" | "manager" | "it_admin";

const APP_ROLE_TO_AI_ROLE: Record<string, AiUserRole> = {
  admin: "it_admin",
  supervisor: "manager",
  quality_inspector: "engineer",
  maintenance: "engineer",
  operator: "worker",
  viewer: "worker",
  user: "worker",
};

export function mapAppRoleToAiRole(appRole?: string | null): AiUserRole {
  if (!appRole) return "worker";
  return APP_ROLE_TO_AI_ROLE[appRole.toLowerCase().trim()] ?? "worker";
}
