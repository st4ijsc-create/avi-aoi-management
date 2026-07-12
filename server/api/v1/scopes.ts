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
  // W2-A2 (doc 44 G1.10-G1.12) — SYNAPSE control-plane asset registry (/v1/assets).
  ASSETS_READ: "assets:read",
  ASSETS_WRITE: "assets:write",
  // W2-B1 (doc 44 G2.16-G2.18) — SYNAPSE Tầng-2 Access APIs (READ): current
  // state, timeseries, events, semantic metrics, genealogy.
  DATA_READ: "data:read",
  // W3-A1 (doc 44 G3.13) — SYNAPSE Tầng-3 Policy API (/v1/policy, spec §13.3).
  POLICY_READ: "policy:read",
  POLICY_WRITE: "policy:write",
  // W3-A2 (doc 44 G3.1) — Line Controller FSM (/v1/lines).
  LINES_READ: "lines:read",
  LINES_WRITE: "lines:write",
  // W3-A3 (doc 44 G3.6/G3.7) — order lifecycle (LDS-L3 §13.1 Orchestration API).
  ORDERS_READ: "orders:read",
  ORDERS_WRITE: "orders:write",
  // W5-A3 (doc 44 G4.30) — SYNAPSE Tầng-4 Advice API (READ/compute-only).
  ADVICE_READ: "advice:read",
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
  "assets:read":
    "Read the asset registry: URN/ISA-95 discovery, asset detail, health, tag catalogue, config-drift status, gateway status (W2-A2 G1.10-G1.12).",
  "assets:write":
    "Register a declarative asset, change asset lifecycle (validated transitions), approve config baselines; adapter restart is ADDITIONALLY gated by V1_ADAPTER_RESTART_ENABLED, default OFF (W2-A2).",
  "data:read":
    "SYNAPSE Tầng-2 Access APIs (READ): /state/{path}, /query/timeseries, /events, /metrics/{metric} (semantic layer), /genealogy (W2-B1 G2.16-G2.18).",
  "policy:read":
    "Policy Engine (W3-A1 G3.13): dry-run POST /policy/evaluate, list /policy/policies, immutable /policy/audit decision log.",
  "policy:write":
    "RESERVED — governance mutations of policy_definitions (not exposed yet; as-code Git sync is the write path).",
  "lines:read":
    "Read line-controller FSM state, per-station stages, takt/bottleneck, readiness (W3-A2 G3.1).",
  "lines:write":
    "Issue line commands start|hold|resume|changeover|complete|reset_fault — every transition passes the policy seam (W3-A2 G3.1).",
  "orders:read":
    "Read production-order lifecycle: list/detail/transitions/trace (W3-A3; gated by ORDER_LIFECYCLE_ENABLED).",
  "orders:write":
    "Order lifecycle commands: allocate/hold/resume/cancel — policy-gated, transactional audit (W3-A3; gated by ORDER_LIFECYCLE_ENABLED).",
  "advice:read":
    "SYNAPSE Tầng-4 Advice API (READ/compute-only): POST /predict/{task}, POST /recommend, GET /recommendations — advisory, no side-effect (W5-A3 G4.30).",
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
