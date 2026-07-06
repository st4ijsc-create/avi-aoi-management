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
      title: "AVI/AOI Factory Control Plane — Unified Machine API",
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
      { name: "PdM", description: "U4a — predictive-maintenance failure risk (read)." },
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
