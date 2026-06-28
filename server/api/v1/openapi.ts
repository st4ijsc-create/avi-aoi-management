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
