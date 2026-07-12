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
  // R0 (doc 16 Khối 0) — inbound ERP intake (work orders / BOM master data).
  ERP_WRITE: "erp:write",
  // U4a (doc 21 §6 U4 / §3 G-6) — open the NEW upper-layer modules to /api/v1 (READ).
  // Each is least-privilege READ over an existing tRPC-internal service; no new
  // device-control path is opened (all reads reuse the same service the tRPC router calls).
  FLEET_READ: "fleet:read",
  SAFETY_READ: "safety:read",
  TWIN_READ: "twin:read",
  PROGRAMS_READ: "programs:read",
  PDM_READ: "pdm:read",
  ANOMALY_READ: "anomaly:read",
  STANDARDS_READ: "standards:read",
  // W5-D (doc 27 §6 A10) — raw inspection/measurement export + BI dataset feed.
  EXPORT_READ: "export:read",
  BI_READ: "bi:read",
  // W0-F (doc 44 G4.27) — AI model registry reads + gated lifecycle mutations.
  MODELS_READ: "models:read",
  MODELS_WRITE: "models:write",
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
  "erp:write": "Inbound ERP intake: create/upsert production orders and BOM master data (R0 Khối 0).",
  "fleet:read": "Read fleet orchestration state: tasks and zones (occupancy) (U4a).",
  "safety:read": "Read ADVISORY safety events and safety zones (U4a; advisory, not safety-rated).",
  "twin:read": "Read digital-twin scene graph and equipment 3D model registry (U4a).",
  "programs:read": "Read device programs (projects/artifacts) and their deployments (U4a).",
  "pdm:read": "Read predictive-maintenance failure-risk for a machine (U4a).",
  "anomaly:read": "Read ADVISORY robot-behaviour anomaly events (U4a).",
  "standards:read": "Read equipment governance: device types, ISA-18.2 alarm taxonomy, compliance (U4a).",
  "export:read": "Stream raw inspection/measurement exports as CSV/JSON (/api/export, W5-D A10).",
  "bi:read": "Read the paged BI dataset feed for Power BI/Tableau (/api/bi/datasets, W5-D A10).",
  "models:read": "Read the AI model registry (models + versions + stage/status) and drift monitoring (W0-F G4.27).",
  "models:write": "Promote/rollback an AI model version — gated by V1_MODEL_MUTATIONS_ENABLED, default OFF (W0-F G4.27).",
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
