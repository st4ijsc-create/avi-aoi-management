/**
 * Phase E1 — Factory Control Plane / Unified Machine API: SCOPE vocabulary.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The least-privilege scopes a scoped API key can be granted. Each /api/v1
 * endpoint declares the ONE scope it needs; the auth middleware denies (403) when
 * the caller's key lacks it. The MASTER_API_KEY super-key implicitly holds every
 * scope (see auth.ts).
 *
 * Wildcards: a granted scope of "*" → all scopes. A granted scope ending in ":*"
 * (e.g. "orchestration:*") → every scope in that namespace.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** The canonical scope set. Keep in sync with the OpenAPI security doc. */
export const API_SCOPES = {
  EQUIPMENT_READ: "equipment:read",
  EQUIPMENT_COMMAND: "equipment:command",
  INGEST_WRITE: "ingest:write",
  ORCHESTRATION_READ: "orchestration:read",
  ORCHESTRATION_WRITE: "orchestration:write",
  // Phase E4 — an edge control runtime syncs run/step results back to central.
  EDGE_SYNC: "edge:sync",
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

/** All concrete scopes (no wildcards) — for docs / validation. */
export const ALL_SCOPES: ApiScope[] = Object.values(API_SCOPES);

/** Human-readable description of every scope (surfaced in the OpenAPI doc). */
export const SCOPE_DESCRIPTIONS: Record<ApiScope, string> = {
  "equipment:read": "Read equipment list, capabilities, telemetry and state.",
  "equipment:command": "Propose/dispatch equipment commands (always via HITL dry-run gate).",
  "ingest:write": "Ingest inspection results from external machines/systems.",
  "orchestration:read": "Read orchestration workflows and run status (E2).",
  "orchestration:write": "Create orchestration workflows and start runs (E2).",
  "edge:sync": "Sync edge run/step results back to central (E4 edge control runtime).",
};

/**
 * Does a set of GRANTED scopes satisfy a REQUIRED scope?
 * Honours "*" (all) and "<namespace>:*" (whole namespace) wildcards. Fail-safe:
 * a missing/garbage grant list never throws — it simply denies.
 */
export function scopeSatisfied(granted: readonly string[] | null | undefined, required: ApiScope): boolean {
  if (!Array.isArray(granted) || granted.length === 0) return false;
  if (granted.includes("*")) return true;
  if (granted.includes(required)) return true;
  const namespace = required.split(":")[0];
  return granted.includes(`${namespace}:*`);
}
