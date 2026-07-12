/**
 * Phase E1 — Unified Machine API: OpenAPI 3.0 document builder.
 *
 * Describes every /api/v1 endpoint (paths, params, request / response schemas), the
 * bearer/X-API-Key auth scheme, and the scope vocabulary. Served at GET /api/v1/openapi.json.
 *
 * doc 37 §7 (dev-portal / C3): the request-body component schemas that HAVE an authoritative
 * Zod contract are now GENERATED from that Zod source (zod v4 `z.toJSONSchema`), not re-typed
 * by hand — `InspectionIngest` ← machineDataContractV1, `WorkOrderIntake`/`BomIntake` ←
 * erpIntake's Zod schemas. Generation is fail-safe: if a schema can't be converted the builder
 * falls back to a hand-written stub, so the doc always renders. Paths/tags for the ERP intake
 * (`/orders`, `/bom`), OAuth token (`/oauth/token`), twin-simulate (`/orchestration/simulate`)
 * and edge-sync (`/edge/sync`) routes are covered so the published contract matches router.ts.
 */
import { z } from "zod";
import { ALL_SCOPES, SCOPE_DESCRIPTIONS } from "./scopes";
import { V1_WEBHOOK_EVENTS } from "./webhookBridge";
import { orderIntakeSchema, bomIntakeSchema } from "./erpIntake";
import { machineContractJsonSchema, LATEST_MACHINE_CONTRACT_VERSION } from "../../contracts/machineDataContract";

/**
 * Convert a Zod schema to a draft-7 JSON-Schema fragment (dropping the `$schema` header so it
 * embeds cleanly under components/schemas). Fail-safe: returns null if conversion throws, so the
 * caller can fall back to a hand-written schema and the whole document still builds.
 */
function zodToJson(schema: z.ZodTypeAny): Record<string, unknown> | null {
  try {
    const js = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
    delete js.$schema;
    return js;
  } catch {
    return null;
  }
}

/** JSON-Schema derived from a raw JSON-Schema producer (machineDataContract), $schema stripped. */
function stripSchemaHeader(js: unknown): Record<string, unknown> | null {
  if (!js || typeof js !== "object") return null;
  const out = { ...(js as Record<string, unknown>) };
  delete out.$schema;
  return out;
}

const envelopeOk = {
  type: "object",
  required: ["ok"],
  properties: {
    ok: { type: "boolean", example: true },
    data: {},
  },
} as const;

const envelopeError = {
  type: "object",
  required: ["ok", "error"],
  properties: {
    ok: { type: "boolean", example: false },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", example: "forbidden" },
        message: { type: "string" },
        details: {},
      },
    },
  },
} as const;

const security = [{ bearerAuth: [] }, { apiKeyHeader: [] }];

function errResponses(extra: Record<string, unknown> = {}) {
  return {
    "401": { description: "Unauthorized — missing/invalid API key", content: jsonErr() },
    "403": { description: "Forbidden — API key lacks the required scope", content: jsonErr() },
    ...extra,
  };
}
function jsonOk() {
  return { "application/json": { schema: { $ref: "#/components/schemas/ApiEnvelope" } } };
}
function jsonErr() {
  return { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } };
}

// Hand-written fallbacks used only if the Zod → JSON-Schema conversion fails at runtime.
const inspectionIngestFallback = {
  type: "object",
  required: ["serialNumber", "overallResult"],
  properties: {
    machineCode: { type: "string" },
    serialNumber: { type: "string" },
    productModel: { type: "string" },
    overallResult: { type: "string", enum: ["OK", "NG", "NTF"] },
    measurements: { type: "array", items: { type: "object", additionalProperties: true } },
  },
} as const;
const workOrderIntakeFallback = {
  type: "object",
  required: ["schemaVersion", "orderCode", "companyCode", "factoryId", "workshopId", "lineId", "productModelId", "targetQuantity"],
  properties: {
    schemaVersion: { type: "string" },
    idempotencyKey: { type: "string" },
    orderCode: { type: "string" },
    companyCode: { type: "string" },
    factoryId: { type: "integer" },
    workshopId: { type: "integer" },
    lineId: { type: "integer" },
    productModelId: { type: "integer" },
    targetQuantity: { type: "integer" },
  },
} as const;
const bomIntakeFallback = {
  type: "object",
  required: ["schemaVersion", "productModelId", "code"],
  properties: {
    schemaVersion: { type: "string" },
    idempotencyKey: { type: "string" },
    productModelId: { type: "integer" },
    code: { type: "string" },
    version: { type: "integer" },
    lines: { type: "array", items: { type: "object", additionalProperties: true } },
  },
} as const;

/** Build the OpenAPI 3.0 document for the Unified Machine API. */
export function buildV1OpenApiSpec(serverUrl = "/"): Record<string, unknown> {
  const scopeDoc = ALL_SCOPES.map((s) => `\`${s}\` — ${SCOPE_DESCRIPTIONS[s]}`).join("\n");

  // Request-body schemas GENERATED from their authoritative Zod contracts (fail-safe fallbacks).
  const inspectionIngestSchema =
    stripSchemaHeader(machineContractJsonSchema(LATEST_MACHINE_CONTRACT_VERSION)) ?? inspectionIngestFallback;
  const workOrderIntakeSchema = zodToJson(orderIntakeSchema) ?? workOrderIntakeFallback;
  const bomIntakeSchemaJson = zodToJson(bomIntakeSchema) ?? bomIntakeFallback;

  return {
    openapi: "3.0.3",
    info: {
      title: "SYNAPSE Factory Control Plane — Unified Machine API",
      version: "1.0.0",
      description:
        "The single, versioned integration contract (Phase E1) external machines and systems " +
        "use to read equipment capabilities/telemetry/state, issue HITL-gated commands, ingest " +
        "inspection results, and subscribe to webhooks.\n\n" +
        "U4a extends the READ surface to the upper-layer modules — fleet, safety (advisory), " +
        "digital twin, device programs, predictive maintenance, robot anomalies (advisory), " +
        "equipment governance, plus a single-pane ecosystem roll-up (hierarchy/KPI) and per-asset " +
        "cockpit detail — so a third party or another ecosystem module can build on them. These " +
        "are READ-ONLY; actions/writes stay behind the existing gated flow.\n\n" +
        "Authentication: `Authorization: Bearer <apiKey>` or `X-API-Key: <apiKey>`.\n\n" +
        "Scopes (each endpoint declares the one it needs; the master key holds all):\n" +
        scopeDoc +
        "\n\nWebhook events: " +
        V1_WEBHOOK_EVENTS.map((e) => `\`${e}\``).join(", ") +
        ".\n\nSAFETY: command POSTs ALWAYS route through the existing HITL/dry-run dispatcher; " +
        "the API never performs a direct device write.",
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "Equipment", description: "List equipment, capabilities, telemetry, state, commands." },
      { name: "Ingest", description: "Inbound data from external machines/systems." },
      { name: "ERP", description: "R0 — inbound ERP/MES intake: production orders & BOM master data (idempotent, versioned)." },
      { name: "OAuth", description: "K0+ — OAuth2 client-credentials token for ERP/MES partners (alternative Bearer)." },
      { name: "Orchestration", description: "Workflow/run orchestration + digital-twin simulate (FOE, E2/E3a)." },
      { name: "Edge", description: "E4 — edge control runtime run/step result sync." },
      { name: "Fleet", description: "U4a — fleet orchestration state: tasks & zones (read)." },
      { name: "Safety", description: "U4a — ADVISORY safety events & zones (read; not safety-rated)." },
      { name: "Twin", description: "U4a — digital-twin scene graph & 3D model registry (read)." },
      { name: "Programs", description: "U4a — device programs & deployments (read)." },
      { name: "PdM", description: "U4a/W0-F — predictive-maintenance failure risk, asset health, prediction history (read)." },
      { name: "Models", description: "W0-F G4.27 — AI model registry: catalogue + drift (read); promote/rollback (flag-gated, default OFF)." },
      { name: "Assets", description: "W2-A2 (doc 44 G1.10-G1.12) — SYNAPSE control-plane asset registry: URN/ISA-95 discovery, lifecycle, health, tags, config-drift; adapter restart (flag-gated); gateway status." },
      { name: "Data", description: "W2-B1 (doc 44 G2.16-G2.18) — SYNAPSE Tầng-2 Access APIs: current state (state store), timeseries, unified events, semantic metrics, genealogy. All read-only, scope data:read." },
      { name: "Policy", description: "W3-A1 (doc 44 G3.11-G3.16) — SYNAPSE Tầng-3 Policy Engine: dry-run evaluate, governed policies, append-only decision audit." },
      { name: "Lines", description: "W3-A2 (doc 44 G3.1) — Line Controller FSM: state/stages/readiness + commands start|hold|resume|changeover|complete|reset_fault (policy-gated)." },
      { name: "Orders", description: "W3-A3 (doc 44 G3.6/G3.7) — Order lifecycle LDS-L3 §8.2: allocate/hold/resume/cancel/trace (policy-gated; ORDER_LIFECYCLE_ENABLED)." },
      { name: "Anomaly", description: "U4a — ADVISORY robot-behaviour anomaly events (read)." },
      { name: "Standards", description: "U4a — equipment governance: device types, alarm taxonomy, compliance (read)." },
      { name: "Ecosystem", description: "U4a — single-pane roll-up: hierarchy, KPI, per-asset cockpit detail (read)." },
      { name: "Meta", description: "OpenAPI document." },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", description: "Scoped API key as a bearer token." },
        apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas: {
        ApiEnvelope: envelopeOk,
        ApiError: envelopeError,
        CommandRequest: {
          type: "object",
          required: ["command"],
          properties: {
            command: { type: "string", example: "start", description: "Canonical command verb from the capability." },
            args: { type: "object", additionalProperties: true, description: "Command arguments (e.g. recipeCode, tag writes)." },
            idempotencyKey: { type: "string", description: "Client-supplied de-dup key (generated if omitted)." },
          },
        },
        // GENERATED from machineDataContractV1 (server/contracts/machineDataContract.ts) via zod v4.
        InspectionIngest: inspectionIngestSchema,
        // GENERATED from erpIntake.ts orderIntakeSchema / bomIntakeSchema.
        WorkOrderIntake: workOrderIntakeSchema,
        BomIntake: bomIntakeSchemaJson,
        OAuthTokenResponse: {
          type: "object",
          required: ["access_token", "token_type", "expires_in"],
          properties: {
            access_token: { type: "string", description: "Short-lived signed JWT (HS256)." },
            token_type: { type: "string", example: "Bearer" },
            expires_in: { type: "integer", description: "TTL in seconds." },
            scope: { type: "string", description: "Space-separated granted scopes." },
          },
        },
        EdgeSyncRequest: {
          type: "object",
          required: ["runId"],
          properties: {
            edgeNodeCode: { type: "string" },
            runId: { type: "integer" },
            status: { type: "string", enum: ["running", "completed", "failed"] },
            error: { type: "string", nullable: true },
            currentStepId: { type: "string", nullable: true },
            steps: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
      },
    },
    security,
    paths: {
      "/api/v1/equipment": {
        get: {
          tags: ["Equipment"],
          summary: "List machines + resolved capabilities",
          description: "Requires scope `equipment:read`.",
          parameters: [
            { name: "stationId", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/equipment/{id}/capabilities": {
        get: {
          tags: ["Equipment"],
          summary: "Resolved EquipmentCapability for a machine",
          description: "Requires scope `equipment:read`.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Machine not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/equipment/{id}/telemetry": {
        get: {
          tags: ["Equipment"],
          summary: "Recent telemetry for a machine",
          description: "Requires scope `equipment:read`.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/equipment/{id}/state": {
        get: {
          tags: ["Equipment"],
          summary: "PackML state projection for a machine",
          description: "Requires scope `equipment:read`.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Machine not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/equipment/{id}/commands": {
        post: {
          tags: ["Equipment"],
          summary: "Propose/dispatch a command (HITL/dry-run)",
          description:
            "Requires scope `equipment:command`. Routes through the existing HITL dispatcher; " +
            "with the control flag off (default) it returns a `simulated` result and writes nothing.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CommandRequest" } } } },
          responses: {
            "200": { description: "Routed (dispatched or simulated)", content: jsonOk() },
            "400": { description: "Bad request — unknown command / missing args", content: jsonErr() },
            ...errResponses({ "404": { description: "Machine not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/ingest/inspection": {
        post: {
          tags: ["Ingest"],
          summary: "Ingest an inspection result",
          description: "Requires scope `ingest:write`. Reuses the existing submitInspection path.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/InspectionIngest" } } } },
          responses: { "200": { description: "Committed", content: jsonOk() }, "400": { description: "Bad request", content: jsonErr() }, ...errResponses() },
        },
      },
      // ── R0 (doc 16 Khối 0) — inbound ERP/MES intake. Gated by ERP_INBOUND_ENABLED. ──
      "/api/v1/orders": {
        post: {
          tags: ["ERP"],
          summary: "Upsert a production order (idempotent, versioned)",
          description:
            "Requires scope `erp:write`. Idempotent: an `X-Idempotency-Key` header (or body `idempotencyKey`) is " +
            "REQUIRED; a duplicate key replays the prior result. Accepts JSON or B2MML XML (ERP_B2MML_ENABLED). " +
            "Emits `order.created` on a NEW order. Disabled → structured 503 `erp_inbound_disabled`.",
          parameters: [{ name: "X-Idempotency-Key", in: "header", required: false, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/WorkOrderIntake" } }, "application/xml": { schema: { type: "string", description: "B2MML ProductionSchedule XML" } } } },
          responses: {
            "201": { description: "Created", content: jsonOk() },
            "200": { description: "Updated / replayed", content: jsonOk() },
            "400": { description: "Validation / idempotency error", content: jsonErr() },
            "415": { description: "XML posted but B2MML disabled", content: jsonErr() },
            "503": { description: "ERP inbound disabled (ERP_INBOUND_ENABLED)", content: jsonErr() },
            ...errResponses(),
          },
        },
        // W3-A3 (doc 44 G3.6/G3.7) — order lifecycle list (cùng path với ERP intake POST).
        get: {
          tags: ["Orders"],
          summary: "List orders + effective lifecycle + allocation",
          description: "Requires scope `orders:read`. Query: lifecycle|lineId|limit|offset. 503 khi ORDER_LIFECYCLE_ENABLED off.",
          responses: {
            "200": { description: "Orders", content: jsonOk() },
            "503": { description: "Feature off (ORDER_LIFECYCLE_ENABLED)", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      "/api/v1/bom": {
        post: {
          tags: ["ERP"],
          summary: "Upsert a BOM definition + replace its lines (idempotent, versioned)",
          description:
            "Requires scope `erp:write`. Upsert by (productModelId, code, version); the posted `lines` fully " +
            "re-state the BOM. `X-Idempotency-Key` required (replay on duplicate). Accepts JSON or B2MML XML. " +
            "Disabled → structured 503 `erp_inbound_disabled`.",
          parameters: [{ name: "X-Idempotency-Key", in: "header", required: false, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BomIntake" } }, "application/xml": { schema: { type: "string", description: "B2MML BOMInformation XML" } } } },
          responses: {
            "201": { description: "Created", content: jsonOk() },
            "200": { description: "Updated / replayed", content: jsonOk() },
            "400": { description: "Validation / idempotency error", content: jsonErr() },
            "415": { description: "XML posted but B2MML disabled", content: jsonErr() },
            "503": { description: "ERP inbound disabled (ERP_INBOUND_ENABLED)", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      // ── K0+ — OAuth2 client-credentials (ADDITIVE partner auth). Gated by ERP_OAUTH_ENABLED. ──
      "/api/v1/oauth/token": {
        post: {
          tags: ["OAuth"],
          summary: "Exchange client_id/client_secret for a short-lived Bearer token",
          description:
            "OAuth2 `client_credentials` grant. `application/x-www-form-urlencoded` body: " +
            "`grant_type=client_credentials&client_id=…&client_secret=…[&scope=…]`. Returns a signed JWT " +
            "accepted as an alternative Bearer on `/orders` and `/bom`. No API key required. Disabled → 503 `oauth_disabled`.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/x-www-form-urlencoded": {
                schema: {
                  type: "object",
                  required: ["grant_type", "client_id", "client_secret"],
                  properties: {
                    grant_type: { type: "string", enum: ["client_credentials"] },
                    client_id: { type: "string" },
                    client_secret: { type: "string" },
                    scope: { type: "string", description: "Optional space-separated subset of the client's scopes." },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Token issued", content: { "application/json": { schema: { $ref: "#/components/schemas/OAuthTokenResponse" } } } },
            "400": { description: "Unsupported grant / missing params", content: jsonErr() },
            "401": { description: "Invalid client credentials", content: jsonErr() },
            "503": { description: "OAuth disabled (ERP_OAUTH_ENABLED)", content: jsonErr() },
          },
        },
      },
      "/api/v1/orchestration/workflows": {
        post: {
          tags: ["Orchestration"],
          summary: "Deploy a workflow (E2 — not implemented)",
          description: "Requires scope `orchestration:write`. Published now; returns 501 until E2.",
          responses: { "501": { description: "Not Implemented — coming in E2", content: jsonErr() }, ...errResponses() },
        },
      },
      "/api/v1/orchestration/runs": {
        post: {
          tags: ["Orchestration"],
          summary: "Start a run (E2 — not implemented)",
          description: "Requires scope `orchestration:write`. Published now; returns 501 until E2.",
          responses: { "501": { description: "Not Implemented — coming in E2", content: jsonErr() }, ...errResponses() },
        },
      },
      "/api/v1/orchestration/simulate": {
        post: {
          tags: ["Orchestration"],
          summary: "Digital-twin simulate a workflow WITHOUT dispatch (E3a)",
          description:
            "Requires scope `orchestration:read`. PURE + fail-safe, NOT flag-gated: predicts step order, " +
            "duration and gates without touching any device. Body: `{ workflow | workflowRef, params?, " +
            "assumedTelemetry?, commandDurations?, defaultCommandMs?, gateMs? }`.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          responses: {
            "200": { description: "Simulation result", content: jsonOk() },
            "400": { description: "Neither workflow nor workflowRef supplied", content: jsonErr() },
            ...errResponses({ "404": { description: "workflowRef not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/edge/sync": {
        post: {
          tags: ["Edge"],
          summary: "Sync an edge run/step result back to central (E4)",
          description:
            "Requires scope `edge:sync`. Idempotent reconcile (upsert on runId+stepId). Coordination only — " +
            "safety stays on the PLC. Disabled → structured 503 `edge_disabled`.",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/EdgeSyncRequest" } } } },
          responses: {
            "202": { description: "Accepted / reconciled", content: jsonOk() },
            "400": { description: "Missing runId / sync failed", content: jsonErr() },
            "503": { description: "Edge runtime disabled (EDGE_RUNTIME_ENABLED)", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      "/api/v1/orchestration/runs/{id}": {
        get: {
          tags: ["Orchestration"],
          summary: "Get run status (E2 — not implemented)",
          description: "Requires scope `orchestration:read`. Published now; returns 501 until E2.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "501": { description: "Not Implemented — coming in E2", content: jsonErr() }, ...errResponses() },
        },
      },
      // ── U4a — NEW upper-layer module READ endpoints (doc 21 §6 U4 / §3 G-6). ──
      "/api/v1/fleet/tasks": {
        get: {
          tags: ["Fleet"],
          summary: "List fleet tasks",
          description: "Requires scope `fleet:read`. Read-only. Reuses fleetRouter.listTasks' query.",
          parameters: [
            { name: "status", in: "query", required: false, schema: { type: "string" } },
            { name: "deviceId", in: "query", required: false, schema: { type: "integer" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100, maximum: 500 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/fleet/zones": {
        get: {
          tags: ["Fleet"],
          summary: "List fleet zones + derived occupancy",
          description: "Requires scope `fleet:read`. Read-only. Reuses getZoneOccupancy (as fleetRouter.listZones).",
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/safety/events": {
        get: {
          tags: ["Safety"],
          summary: "ADVISORY safety events feed",
          description: "Requires scope `safety:read`. Read-only. Reuses safetyAuditService.queryFeed. ADVISORY — not safety-rated.",
          parameters: [
            { name: "eventType", in: "query", required: false, schema: { type: "string" } },
            { name: "robotId", in: "query", required: false, schema: { type: "integer" } },
            { name: "sinceHours", in: "query", required: false, schema: { type: "integer" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 200, maximum: 500 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/safety/zones": {
        get: {
          tags: ["Safety"],
          summary: "ADVISORY safety zones",
          description: "Requires scope `safety:read`. Read-only. Reuses safetyZoneService.listZones. Rated stop is hardware (a certified Safety PLC).",
          parameters: [
            { name: "robotId", in: "query", required: false, schema: { type: "integer" } },
            { name: "stationId", in: "query", required: false, schema: { type: "integer" } },
            { name: "lineId", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/twin/scene-graph": {
        get: {
          tags: ["Twin"],
          summary: "Digital-twin scene graph for a factory",
          description: "Requires scope `twin:read`. Read-only. Reuses twin/sceneGraph.buildSceneGraph.",
          parameters: [{ name: "factoryId", in: "query", required: true, schema: { type: "integer" } }],
          responses: {
            "200": { description: "OK", content: jsonOk() },
            "400": { description: "Bad request — missing/invalid factoryId", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      "/api/v1/twin/models": {
        get: {
          tags: ["Twin"],
          summary: "Equipment 3D model registry",
          description: "Requires scope `twin:read`. Read-only. Reuses twin/modelRegistry.listModels.",
          parameters: [
            { name: "equipmentClass", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["active", "archived"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 200, maximum: 1000 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/programs": {
        get: {
          tags: ["Programs"],
          summary: "List device-programming projects",
          description: "Requires scope `programs:read`. Read-only. Reuses programmingRouter.listProjects' query. Deploy/rollback stay behind the gated tRPC flow.",
          parameters: [{ name: "limit", in: "query", required: false, schema: { type: "integer", default: 200, maximum: 500 } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/programs/{id}/deployments": {
        get: {
          tags: ["Programs"],
          summary: "List a program's deployments",
          description: "Requires scope `programs:read`. Read-only. Reuses programmingRouter.listDeployments' query.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Program not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/pdm/risk": {
        get: {
          tags: ["PdM"],
          summary: "Predictive-maintenance failure risk for a machine",
          description: "Requires scope `pdm:read`. Read-only. Reuses predictiveMaintenanceService.computeFailureRisk.",
          parameters: [
            { name: "machineId", in: "query", required: true, schema: { type: "integer" } },
            { name: "windowHours", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "OK", content: jsonOk() },
            "400": { description: "Bad request — missing/invalid machineId", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      // ── W0-F G4.11 (doc 44) — PdM asset health + prediction history (read). ──
      "/api/v1/health/assets/{id}": {
        get: {
          tags: ["PdM"],
          summary: "Predicted health + RUL + confidence + factors for one asset",
          description:
            "Requires scope `pdm:read`. Read-only. Wraps predictiveMaintenanceService.computeFailureRisk + the latest " +
            "machine_health_history snapshot. HONEST: `health` is null when no snapshot exists; `rul.method` is " +
            "`heuristic-proxy` (EWMA forecast crossing capped by MTBF) — not a trained survival model.",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "integer" } },
            { name: "windowHours", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: {
            "200": { description: "OK", content: jsonOk() },
            "400": { description: "Bad request — invalid asset id", content: jsonErr() },
            ...errResponses({ "404": { description: "Asset not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/predictions": {
        get: {
          tags: ["PdM"],
          summary: "Prediction/alert history (predictive_alerts)",
          description:
            "Requires scope `pdm:read`. Read-only over the central predictive_alerts table. Honest-empty when no rows.",
          parameters: [
            { name: "assetId", in: "query", required: false, schema: { type: "integer" } },
            { name: "type", in: "query", required: false, schema: { type: "string", enum: ["DEFECT_SPIKE", "YIELD_DROP", "MACHINE_FAILURE", "QUALITY_DEGRADATION", "PATTERN_ANOMALY"] } },
            { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100, maximum: 500 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, "400": { description: "Bad request — invalid filter", content: jsonErr() }, ...errResponses() },
        },
      },
      // ── W0-F G4.27 (doc 44) — AI model registry. ──
      "/api/v1/models": {
        get: {
          tags: ["Models"],
          summary: "AI model catalogue (models + versions + stage/status)",
          description: "Requires scope `models:read`. Read-only over ai_models + model_versions. Honest-empty without a DB.",
          parameters: [
            { name: "status", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 100, maximum: 500 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/models/{id}/promote": {
        post: {
          tags: ["Models"],
          summary: "Promote (activate) a model version — flag-gated, default OFF",
          description:
            "Requires scope `models:write`. Gated by `V1_MODEL_MUTATIONS_ENABLED` (default OFF → structured 501 " +
            "`v1_model_mutations_disabled`). When ON, wraps the SAME internal aiModelService.activateModelVersion path.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["versionId"], properties: { versionId: { type: "integer" } } } } } },
          responses: {
            "200": { description: "Promoted", content: jsonOk() },
            "400": { description: "Missing/invalid versionId", content: jsonErr() },
            "501": { description: "Mutations not opened (V1_MODEL_MUTATIONS_ENABLED)", content: jsonErr() },
            ...errResponses({ "404": { description: "Model/version not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/models/{id}/rollback": {
        post: {
          tags: ["Models"],
          summary: "Roll back a model to a stable version — flag-gated, default OFF",
          description:
            "Requires scope `models:write`. Gated by `V1_MODEL_MUTATIONS_ENABLED` (default OFF → structured 501). When ON, " +
            "wraps modelAutoRollback.manualRollback (records the append-only model_rollback_events audit row). Body " +
            "`toVersionId` optional — omitted, the most recent stable version with an eval baseline is auto-selected.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { toVersionId: { type: "integer" }, reason: { type: "string" } } } } } },
          responses: {
            "200": { description: "Rolled back", content: jsonOk() },
            "409": { description: "No active version / no stable rollback target", content: jsonErr() },
            "501": { description: "Mutations not opened (V1_MODEL_MUTATIONS_ENABLED)", content: jsonErr() },
            ...errResponses({ "404": { description: "Model not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/monitoring/drift": {
        get: {
          tags: ["Models"],
          summary: "AI drift monitoring report (advisory, read-only)",
          description:
            "Requires scope `models:read`. Read-only: aiDriftMonitor flag/counters + persisted model_drift_alerts rows. " +
            "ADVISORY — reading this never changes which model serves.",
          parameters: [
            { name: "modelId", in: "query", required: false, schema: { type: "integer" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 50, maximum: 200 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      // ── W2-A2 (doc 44 G1.10-G1.12) — SYNAPSE control-plane asset registry. ──
      "/api/v1/assets": {
        get: {
          tags: ["Assets"],
          summary: "Asset discovery (URN + ISA-95 path) with class/path/lifecycle filters",
          description:
            "Requires scope `assets:read`. Read-only over machines + hierarchy. Spec-shape rows: " +
            "{asset_id (urn:syn:asset:{site}:{line}:{cell}:{equipment}), name, class, vendor, model, path " +
            "({site}/{area}/{line}/{cell}/{equipment}), lifecycle_state, capabilities, tags (count)}. Honest-empty without a DB.",
          parameters: [
            { name: "class", in: "query", required: false, schema: { type: "string" }, description: "machineType filter (e.g. AOI, ROBOT)" },
            { name: "path", in: "query", required: false, schema: { type: "string" }, description: "ISA-95 path prefix filter" },
            { name: "lifecycle", in: "query", required: false, schema: { type: "string", enum: ["registered", "commissioning", "active", "faulted", "maintenance", "decommissioned", "retired"] } },
            { name: "includeInactive", in: "query", required: false, schema: { type: "boolean", default: false } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 200, maximum: 1000 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, "400": { description: "Bad filter", content: jsonErr() }, ...errResponses() },
        },
        post: {
          tags: ["Assets"],
          summary: "Register a DECLARATIVE asset (lifecycle 'registered')",
          description:
            "Requires scope `assets:write`. Creates the machine record at lifecycle `registered` (SYNAPSE spec §6.3/§12.3) " +
            "with strict validation. HONEST: declarative only — nothing is connected/verified; the response lists the " +
            "remaining onboarding steps (commissioning → adapter mapping → approval).",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["code", "name", "class", "stationId"],
                  properties: {
                    code: { type: "string", maxLength: 50 },
                    name: { type: "string", maxLength: 255 },
                    class: { type: "string", description: "machineType (e.g. AOI, ROBOT, MOUNTER)" },
                    stationId: { type: "integer" },
                    vendor: { type: "string" },
                    model: { type: "string" },
                    serialNumber: { type: "string" },
                    description: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Registered (declarative)", content: jsonOk() },
            "400": { description: "Invalid body / unknown class", content: jsonErr() },
            "409": { description: "Machine code already in use by an active machine", content: jsonErr() },
            ...errResponses({ "404": { description: "Station not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/assets/{id}": {
        get: {
          tags: ["Assets"],
          summary: "Asset detail (id = URN or numeric machine id)",
          description: "Requires scope `assets:read`. Read-only: identity, hierarchy codes, lifecycle/registration/operation state, adapters.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "urn:syn:asset:… or machine id" }],
          responses: { "200": { description: "OK", content: jsonOk() }, "400": { description: "Bad id", content: jsonErr() }, ...errResponses({ "404": { description: "Asset not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/assets/{id}/lifecycle": {
        put: {
          tags: ["Assets"],
          summary: "Change asset lifecycle state (validated transition matrix)",
          description:
            "Requires scope `assets:write`. Wraps the SAME transitionMachineLifecycle path the tRPC mutation uses " +
            "(registered→commissioning→active⇄maintenance, active→faulted→active/maintenance, decommission/retire) — " +
            "illegal transitions → 409. Writes the append-only control_audit_log.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["state"], properties: { state: { type: "string", enum: ["registered", "commissioning", "active", "faulted", "maintenance", "decommissioned", "retired"] }, reason: { type: "string", maxLength: 500 } } } } },
          },
          responses: {
            "200": { description: "Transitioned", content: jsonOk() },
            "400": { description: "Invalid state", content: jsonErr() },
            "409": { description: "Illegal lifecycle transition", content: jsonErr() },
            ...errResponses({ "404": { description: "Asset not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/assets/{id}/health": {
        get: {
          tags: ["Assets"],
          summary: "Current asset health (presence + heartbeat + adapter link states)",
          description:
            "Requires scope `assets:read`. Read-only over REAL signals: machine_status_logs presence, machines.lastHeartbeat, " +
            "device_adapters connection status. HONEST: presence is null when no record exists — never fabricated.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Asset not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/assets/{id}/tags": {
        get: {
          tags: ["Assets"],
          summary: "Asset tag catalogue (device_tags via its adapters)",
          description: "Requires scope `assets:read`. Spec-shape rows: {tag_id, datatype, unit, direction ro|rw, source_address, enabled}.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Asset not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/assets/{id}/config-drift": {
        get: {
          tags: ["Assets"],
          summary: "Config-drift status per adapter (live hash vs approved baseline)",
          description:
            "Requires scope `assets:read`. READ-ONLY comparison (no persist — the CONFIG_DRIFT_ENABLED sweep persists + alerts). " +
            "Hashes are computed over SECRET-REDACTED config (credentials never enter the hash or the summary).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Asset not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/assets/{id}/config-drift/approve": {
        post: {
          tags: ["Assets"],
          summary: "Approve the CURRENT running config as the baseline",
          description:
            "Requires scope `assets:write`. Sets approved_hash := current hash for one adapter (body.adapterId) or all of the " +
            "asset's adapters; status becomes in_sync and the drift episode is cleared. Audited (v1 guard).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { adapterId: { type: "integer" } } } } } },
          responses: {
            "200": { description: "Approved", content: jsonOk() },
            ...errResponses({ "404": { description: "Asset/adapter not found or no adapters", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/adapters/{id}/restart": {
        post: {
          tags: ["Assets"],
          summary: "Restart connectivity — flag-gated, default OFF",
          description:
            "Requires scope `assets:write`. Gated by `V1_ADAPTER_RESTART_ENABLED` (default OFF → structured 501 " +
            "`v1_adapter_restart_disabled`). HONEST LIMITATION: otManager exposes no per-adapter restart, so when enabled the " +
            "restart is composed from stopOt()+startOt() and reconnects EVERY adapter (response says scope: framework).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: {
            "200": { description: "Restarted (framework-wide)", content: jsonOk() },
            "409": { description: "OT framework not running", content: jsonErr() },
            "501": { description: "Not opened (V1_ADAPTER_RESTART_ENABLED)", content: jsonErr() },
            ...errResponses({ "404": { description: "Adapter not found", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/gateways/{id}/status": {
        get: {
          tags: ["Assets"],
          summary: "Gateway (edge node) status & resources",
          description:
            "Requires scope `assets:read`. Maps to the edge_nodes registry (E4): status, heartbeat, version, assigned lines, " +
            "self-reported health. HONEST: health is the node's own report and may be null.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "edge node id or code" }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Gateway not found", content: jsonErr() } }) },
        },
      },
      // ── W2-B1 (doc 44 G2.16-G2.18) — SYNAPSE Tầng-2 Access APIs (scope data:read). ──
      "/api/v1/state/{path}": {
        get: {
          tags: ["Data"],
          summary: "Current StateSnapshot for one ISA-95 path (spec §10.1)",
          description:
            "Requires scope `data:read`. `{path}` is the FULL slash-separated ISA-95 path " +
            "({site}/{area}/{line}/{cell}/{equipment}) — the wildcard tail of the URL. Served from the " +
            "G2.12 state store (live snapshots when STATE_STORE_ENABLED; lazy DB rebuild otherwise — the " +
            "`source` field says which: live | db-fallback). 404 when no machine maps to the path. " +
            "Latency feeds the REAL `state-read-p95` SLO provider.",
          parameters: [
            { name: "path", in: "path", required: true, schema: { type: "string" }, description: "ISA-95 path, slashes included (e.g. f1/assy/line1/cell3/screw01)" },
          ],
          responses: {
            "200": { description: "StateSnapshot {path, ts, state, values?, health?, source}", content: jsonOk() },
            "400": { description: "Empty/invalid path", content: jsonErr() },
            ...errResponses({ "404": { description: "No asset maps to the path", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/query/timeseries": {
        post: {
          tags: ["Data"],
          summary: "Timeseries query over ot_telemetry (spec §11.2)",
          description:
            "Requires scope `data:read`. Body: {series, path | machineId, from, to, agg: raw|avg|min|max|sum, " +
            "bucket: '30s'|'1m'|'5m'|'1h'|…, limit (default 5000, cap 50000)}. Engine is HONESTLY reported: " +
            "`timescale-tsdb` (dedicated TSDB_URL) / `timescale-main` (main DB, db_feature_status " +
            "'timescaledb_hypertables' ok → time_bucket) / `plain-pg` (epoch-floor bucketing fallback). " +
            "Aggregates operate on numeric samples only.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["series", "from", "to"],
                  properties: {
                    series: { type: "string", description: "metric/tag name (ot_telemetry.metric)" },
                    path: { type: "string", description: "ISA-95 path (alternative to machineId)" },
                    machineId: { type: "integer" },
                    from: { type: "string", format: "date-time" },
                    to: { type: "string", format: "date-time" },
                    agg: { type: "string", enum: ["raw", "avg", "min", "max", "sum"], default: "raw" },
                    bucket: { type: "string", example: "5m", description: "required meaningfully for agg≠raw (default 5m)" },
                    limit: { type: "integer", default: 5000, maximum: 50000 },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "{points:[{ts,v,…}], engine, truncated}", content: jsonOk() },
            "400": { description: "Invalid body / from ≥ to / missing path+machineId", content: jsonErr() },
            ...errResponses({ "404": { description: "path maps to no asset", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/events": {
        get: {
          tags: ["Data"],
          summary: "Unified event feed (andon ∪ safety ∪ interlock)",
          description:
            "Requires scope `data:read`. Union Event shape {event_id, source, asset_id?, path?, type, severity, " +
            "ts, payload} over andon_events + safety_events + interlock_events. `severity` is a MINIMUM filter " +
            "(info|warning|error|critical); `type` is a prefix filter ('andon' or 'andon:quality'). HONEST: a " +
            "`path` filter applies to machine-addressed (andon) events only — safety/interlock rows carry no " +
            "machineId and are excluded under a path filter (stated in `notes`).",
          parameters: [
            { name: "path", in: "query", required: false, schema: { type: "string" }, description: "ISA-95 path prefix" },
            { name: "type", in: "query", required: false, schema: { type: "string" } },
            { name: "severity", in: "query", required: false, schema: { type: "string", enum: ["info", "warning", "error", "critical"] }, description: "minimum severity" },
            { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 200, maximum: 1000 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, "400": { description: "Bad filter", content: jsonErr() }, ...errResponses() },
        },
      },
      "/api/v1/metrics/{metric}": {
        get: {
          tags: ["Data"],
          summary: "Semantic-layer metric (MetricResult + definition_version, spec §10.2)",
          description:
            "Requires scope `data:read`. Wraps semantics/metricRegistry.computeMetric — the ONE governed " +
            "definition (contracts/metrics/*.yaml); the response always carries `definition_version` " +
            "(e.g. OEE@v1). Errors: unknown metric → 404, undeclared scope / missing scopeId / unsupported " +
            "window → 400, DB down → 503. from/to default to the trailing 24 h.",
          parameters: [
            { name: "metric", in: "path", required: true, schema: { type: "string" }, description: "OEE | FPY | Throughput | DPMO | Availability | Performance | Quality" },
            { name: "scope", in: "query", required: true, schema: { type: "string" }, description: "equipment | line | factory (per definition)" },
            { name: "scopeId", in: "query", required: false, schema: { type: "integer" } },
            { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          ],
          responses: {
            "200": { description: "MetricResult", content: jsonOk() },
            "400": { description: "Unsupported scope / missing scopeId / bad window", content: jsonErr() },
            "503": { description: "DB unavailable", content: jsonErr() },
            ...errResponses({ "404": { description: "Unknown metric", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/genealogy/{unitId}": {
        get: {
          tags: ["Data"],
          summary: "Full GenealogyRecord for one unit (spec §10.3)",
          description:
            "Requires scope `data:read`. Assembles {unit_id, product, line, started, finished, steps[{station, " +
            "ts, result, data}], materials[{part, lot}], carton, pallet} from genealogy_chain + " +
            "product_inspections + process_results + component_installations (⋈ supplier_lots). HONEST: " +
            "carton/pallet come from chain event payloads (no packing table exists) and are null when never " +
            "recorded. 404 only when every source is empty.",
          parameters: [{ name: "unitId", in: "path", required: true, schema: { type: "string" }, description: "serial number" }],
          responses: {
            "200": { description: "GenealogyRecord", content: jsonOk() },
            "400": { description: "Invalid unit id", content: jsonErr() },
            ...errResponses({ "404": { description: "Unit has no genealogy data", content: jsonErr() } }),
          },
        },
      },
      "/api/v1/genealogy/search": {
        post: {
          tags: ["Data"],
          summary: "Reverse genealogy search → unit ids",
          description:
            "Requires scope `data:read`. Body {lot?, part?, carton?, pallet?, dateRange?{from,to}, limit?} — at " +
            "least one criterion; multiple criteria INTERSECT (AND). lot matches genealogy_chain.lotCode ∪ " +
            "supplier-lot installations; part matches component_installations.componentCode; carton/pallet match " +
            "chain event payload keys.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    lot: { type: "string" },
                    part: { type: "string" },
                    carton: { type: "string" },
                    pallet: { type: "string" },
                    dateRange: { type: "object", properties: { from: { type: "string", format: "date-time" }, to: { type: "string", format: "date-time" } } },
                    limit: { type: "integer", default: 200, maximum: 1000 },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "{units, count, criteria, semantics: intersection}", content: jsonOk() },
            "400": { description: "No criterion supplied / invalid body", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      // ── W3-A1 (doc 44 G3.11-G3.16) — Policy Engine (spec §13.3) ──────────────
      "/api/v1/policy/evaluate": {
        post: {
          tags: ["Policy"],
          summary: "Dry-run policy evaluation → PERMIT/DENY + obligations (SYNAPSE §13.4)",
          description: "Requires scope `policy:read`. Dry-run only — no side effects besides the decision log.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action"],
                  properties: {
                    subject: { type: "string" },
                    action: { type: "string", example: "line.command" },
                    resource: { type: "string", example: "HANOI/ASSY/LINE1" },
                    verb: { type: "string" },
                    request_id: { type: "string" },
                    context: { type: "object", additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Decision {decision, obligations, reason_code, policy_ref, latency_ms}", content: jsonOk() },
            "400": { description: "Missing/invalid action or context", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      "/api/v1/policy/policies": {
        get: {
          tags: ["Policy"],
          summary: "List governed policies (DB store when POLICY_STORE_ENABLED, else built-ins)",
          responses: { "200": { description: "Policy listing", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/policy/audit": {
        get: {
          tags: ["Policy"],
          summary: "Append-only policy decision log",
          parameters: [
            { name: "subject", in: "query", required: false, schema: { type: "string" } },
            { name: "action", in: "query", required: false, schema: { type: "string" } },
            { name: "decision", in: "query", required: false, schema: { type: "string", enum: ["PERMIT", "DENY"] } },
            { name: "from", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", required: false, schema: { type: "string", format: "date-time" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", maximum: 500 } },
          ],
          responses: {
            "200": { description: "Decisions (newest first)", content: jsonOk() },
            "400": { description: "Bad filter", content: jsonErr() },
            "503": { description: "Decision log unavailable (migration 0256 not applied)", content: jsonErr() },
            ...errResponses(),
          },
        },
      },
      // ── W3-A2 (doc 44 G3.1) — Line Controller (spec §13.2) ───────────────────
      "/api/v1/lines": {
        get: {
          tags: ["Lines"],
          summary: "List production lines + FSM state",
          description: "Requires scope `lines:read`.",
          responses: { "200": { description: "Lines + states", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/lines/{id}/state": {
        get: {
          tags: ["Lines"],
          summary: "Line FSM state + takt/bottleneck + readiness",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "LineState", content: jsonOk() }, "404": { description: "Unknown line", content: jsonErr() }, ...errResponses() },
        },
      },
      "/api/v1/lines/{id}/stages": {
        get: {
          tags: ["Lines"],
          summary: "Per-station stages (PackML/op state, dwell, blocked/starved)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "StageState[]", content: jsonOk() }, "404": { description: "Unknown line", content: jsonErr() }, ...errResponses() },
        },
      },
      "/api/v1/lines/{id}/command": {
        post: {
          tags: ["Lines"],
          summary: "Line command start|hold|resume|changeover|complete|reset_fault (policy-gated)",
          description: "Requires scope `lines:write`. Transition vào READY bắt buộc qua readiness checklist; mọi transition qua policy seam.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["command"],
                  properties: {
                    command: { type: "string", enum: ["start", "hold", "resume", "changeover", "complete", "reset_fault"] },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "TransitionResult (gồm readiness checks khi bị chặn)", content: jsonOk() },
            ...errResponses({
              "400": { description: "INVALID_TRANSITION + danh sách hợp lệ", content: jsonErr() },
              "403": { description: "POLICY_DENIED", content: jsonErr() },
            }),
          },
        },
      },
      // ── W3-A3 (doc 44 G3.6/G3.7) — Order lifecycle (spec §13.1) ─────────────
      // LƯU Ý: GET /api/v1/orders (list lifecycle) được gộp vào entry POST /orders
      // của ERP intake phía trên (key trùng — object literal không cho phép 2 key).
      "/api/v1/orders/{id}": {
        get: {
          tags: ["Orders"],
          summary: "Order detail + transition history",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Order + transitions", content: jsonOk() }, "404": { description: "Not found", content: jsonErr() }, ...errResponses() },
        },
      },
      "/api/v1/orders/{id}/allocate": {
        post: {
          tags: ["Orders"],
          summary: "Allocate (§9.1) {lineId?} — capacity-validated / least-loaded; hết chỗ → state=rejected",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "allocated|rejected", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/orders/{id}/hold": {
        post: {
          tags: ["Orders"],
          summary: "running → held {reason}",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/orders/{id}/resume": {
        post: {
          tags: ["Orders"],
          summary: "held → running {reason}",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/orders/{id}/cancel": {
        post: {
          tags: ["Orders"],
          summary: "created/allocated→rejected · running/held→compensating→failed",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/orders/{id}/trace": {
        get: {
          tags: ["Orders"],
          summary: "Transitions + genealogy refs (honest-empty)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "Trace", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/anomaly/events": {
        get: {
          tags: ["Anomaly"],
          summary: "ADVISORY robot-behaviour anomaly events",
          description: "Requires scope `anomaly:read`. Read-only. Reuses aiRobotAnomalyRouter.listAnomalies' query. ADVISORY — no robot command.",
          parameters: [
            { name: "robotId", in: "query", required: false, schema: { type: "integer" } },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["raised", "acknowledged"] } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", default: 50, maximum: 200 } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/standards/device-types": {
        get: {
          tags: ["Standards"],
          summary: "Device-type hierarchy tree (SEED ∪ published)",
          description: "Requires scope `standards:read`. Read-only. Reuses deviceTypeRegistry.buildTree over SEED ∪ persisted rows.",
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/standards/alarm-taxonomy": {
        get: {
          tags: ["Standards"],
          summary: "ISA-18.2 alarm taxonomy (SEED ∪ persisted)",
          description: "Requires scope `standards:read`. Read-only. Reuses alarmTaxonomy SEED + listVendors.",
          parameters: [{ name: "vendor", in: "query", required: false, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/standards/compliance": {
        get: {
          tags: ["Standards"],
          summary: "Equipment governance compliance metrics",
          description: "Requires scope `standards:read`. Read-only. Reuses complianceService.computeCompliance (same inputs as equipmentStandardsRouter.complianceMetrics).",
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/ecosystem/hierarchy": {
        get: {
          tags: ["Ecosystem"],
          summary: "Whole-ecosystem live hierarchy roll-up (single pane)",
          description: "Requires scope `equipment:read`. Read-only. Reuses commandCenterService.buildHierarchy.",
          parameters: [
            { name: "factoryId", in: "query", required: false, schema: { type: "integer" } },
            { name: "corporateCode", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/ecosystem/kpi": {
        get: {
          tags: ["Ecosystem"],
          summary: "Ecosystem KPI command strip (single pane)",
          description: "Requires scope `equipment:read`. Read-only. Reuses commandCenterService.buildKpiSummary (honest nulls when a source is disabled/absent).",
          parameters: [
            { name: "factoryId", in: "query", required: false, schema: { type: "integer" } },
            { name: "corporateCode", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses() },
        },
      },
      "/api/v1/machines/{id}/detail": {
        get: {
          tags: ["Ecosystem"],
          summary: "Full per-machine cockpit detail",
          description: "Requires scope `equipment:read`. Read-only. Reuses assetCockpitService.machineDetail. gatedActions are METADATA only (no exec).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Machine not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/robots/{id}/detail": {
        get: {
          tags: ["Ecosystem"],
          summary: "Full per-robot cockpit detail",
          description: "Requires scope `equipment:read`. Read-only. Reuses assetCockpitService.robotDetail. gatedActions are METADATA only (no exec).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "OK", content: jsonOk() }, ...errResponses({ "404": { description: "Robot not found", content: jsonErr() } }) },
        },
      },
      "/api/v1/openapi.json": {
        get: {
          tags: ["Meta"],
          summary: "This OpenAPI document",
          security: [],
          responses: { "200": { description: "OpenAPI 3.0 document", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    },
  };
}
