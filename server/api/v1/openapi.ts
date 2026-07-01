/**
 * Phase E1 — Unified Machine API: OpenAPI 3.0 document builder.
 *
 * Hand-authored spec describing every /api/v1 endpoint (paths, params, request /
 * response schemas), the bearer/X-API-Key auth scheme, and the scope vocabulary.
 * Served at GET /api/v1/openapi.json. Kept in sync with router.ts by hand.
 */
import { ALL_SCOPES, SCOPE_DESCRIPTIONS } from "./scopes";
import { V1_WEBHOOK_EVENTS } from "./webhookBridge";

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

/** Build the OpenAPI 3.0 document for the Unified Machine API. */
export function buildV1OpenApiSpec(serverUrl = "/"): Record<string, unknown> {
  const scopeDoc = ALL_SCOPES.map((s) => `\`${s}\` — ${SCOPE_DESCRIPTIONS[s]}`).join("\n");

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
      { name: "Orchestration", description: "Workflow/run orchestration (stubs — arriving in E2)." },
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
        InspectionIngest: {
          type: "object",
          required: ["serialNumber", "overallResult"],
          properties: {
            machineCode: { type: "string" },
            serialNumber: { type: "string" },
            productModel: { type: "string" },
            overallResult: { type: "string", enum: ["OK", "NG", "NTF"] },
            measurements: { type: "array", items: { type: "object", additionalProperties: true } },
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
