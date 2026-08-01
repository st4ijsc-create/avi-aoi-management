/**
 * OpenAPI + AsyncAPI spec builder — SYNAPSE §8 / Open-APIs attribute (doc 33 §3.2 / F7 · H5).
 *
 * "Bên thứ ba tích hợp chỉ bằng tài liệu công bố" requires published, machine-readable specs.
 * This builds an OpenAPI 3.1 document (REST /api/v1) and an AsyncAPI 2.6 document (UNS/Sparkplug
 * channels) from a DECLARATIVE registry, seeded with the current surface. It is the substrate the
 * Developer Portal (later) serves; here the specs are produced + exposed read-only. Pure.
 *
 * (Full auto-extraction from every tRPC/express route is a later step; F7 establishes the
 * publishable-spec capability + the seed + the shape a route registers with.)
 */

export interface RestEndpoint {
  method: "get" | "post" | "put" | "delete";
  path: string; // e.g. "/api/v1/work-orders"
  summary: string;
  tags: string[];
  requestSchemaRef?: string;
  responseSchemaRef?: string;
}

export interface UnsChannel {
  channel: string; // e.g. "syn/{site}/{area}/{line}/{cell}/{equip}/telemetry"
  description: string;
  operation: "publish" | "subscribe";
  payloadRef?: string;
}

export interface SpecInfo {
  title: string;
  version: string;
  description?: string;
}

/** Build an OpenAPI 3.1 document from REST endpoint descriptors. */
export function buildOpenApi(endpoints: readonly RestEndpoint[], info: SpecInfo): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of endpoints) {
    const item = (paths[e.path] ??= {});
    item[e.method] = {
      summary: e.summary,
      tags: e.tags,
      ...(e.requestSchemaRef
        ? {
            requestBody: {
              content: { "application/json": { schema: { $ref: `#/components/schemas/${e.requestSchemaRef}` } } },
            },
          }
        : {}),
      responses: {
        "200": {
          description: "OK",
          ...(e.responseSchemaRef
            ? { content: { "application/json": { schema: { $ref: `#/components/schemas/${e.responseSchemaRef}` } } } }
            : {}),
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: info.title, version: info.version, description: info.description },
    paths,
    components: { schemas: {} },
  };
}

/** Build an AsyncAPI 2.6 document from UNS channel descriptors. */
export function buildAsyncApi(channels: readonly UnsChannel[], info: SpecInfo): Record<string, unknown> {
  const chans: Record<string, unknown> = {};
  for (const c of channels) {
    chans[c.channel] = {
      description: c.description,
      [c.operation]: {
        message: {
          contentType: "application/json",
          ...(c.payloadRef ? { payload: { $ref: `#/components/schemas/${c.payloadRef}` } } : {}),
        },
      },
    };
  }
  return {
    asyncapi: "2.6.0",
    info: { title: info.title, version: info.version, description: info.description },
    defaultContentType: "application/json",
    channels: chans,
    components: { schemas: {} },
  };
}

/** Seed of the current REST surface (representative; extend as routes register). */
export const SEED_REST_ENDPOINTS: readonly RestEndpoint[] = [
  { method: "post", path: "/api/v1/work-orders", summary: "Tạo lệnh sản xuất (Idempotency-Key)", tags: ["orchestration"], requestSchemaRef: "WorkOrder", responseSchemaRef: "WorkOrderAck" },
  { method: "get", path: "/api/v1/work-orders/{id}", summary: "Trạng thái lệnh + tiến độ task", tags: ["orchestration"], responseSchemaRef: "WorkOrderState" },
  { method: "get", path: "/api/v1/robots", summary: "Truy vấn đội robot", tags: ["fleet"], responseSchemaRef: "RobotList" },
  { method: "get", path: "/api/v1/edge/health", summary: "Sức khỏe connector biên", tags: ["integration"], responseSchemaRef: "EdgeHealth" },
];

/** Seed of the UNS/Sparkplug channel surface (ISA-95 topic tree). */
export const SEED_UNS_CHANNELS: readonly UnsChannel[] = [
  { channel: "syn/{site}/{area}/{line}/{cell}/{equip}/telemetry", description: "DDATA Sparkplug thiết bị", operation: "publish", payloadRef: "Telemetry" },
  { channel: "syn/{site}/{area}/{line}/{cell}/{equip}/events", description: "Sự kiện CEID chuẩn hoá", operation: "publish", payloadRef: "EquipmentEvent" },
  { channel: "syn/{site}/{area}/{line}/{cell}/{equip}/cmd", description: "NCMD/DCMD (qua Policy)", operation: "subscribe", payloadRef: "Command" },
  { channel: "syn/{site}/fleet/{robot_id}/state", description: "Trạng thái robot chuẩn hoá", operation: "publish", payloadRef: "RobotState" },
];

/** Convenience: build both seeded specs. */
export function buildSeedSpecs(version = "1.0.0") {
  return {
    openapi: buildOpenApi(SEED_REST_ENDPOINTS, { title: "SYNAPSE REST API", version, description: "SYNAPSE orchestration REST surface (/api/v1)." }),
    asyncapi: buildAsyncApi(SEED_UNS_CHANNELS, { title: "SYNAPSE UNS (Sparkplug B)", version, description: "ISA-95 Unified Namespace channels." }),
  };
}
