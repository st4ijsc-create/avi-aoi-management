/**
 * Giai đoạn 4 — OpenAPI 3.0 spec cho REST API external (`/api/external/*`).
 *
 * Tài liệu hợp đồng REST cho đối tác tích hợp ngoài. Tổng hợp thủ công từ các
 * route trong `server/_core/index.ts`. Bảo mật: `x-master-key` (server-to-server)
 * hoặc `Authorization: Bearer <jwt>` (đăng nhập qua /api/external/auth/login).
 *
 * Additive — chỉ đọc, không thay đổi hành vi route hiện hành. Phục vụ qua
 * GET /api/external/openapi.json (public, không lộ dữ liệu nghiệp vụ).
 */

const okEnvelope = {
  type: "object",
  properties: {
    success: { type: "boolean", example: true },
    data: { type: "object", additionalProperties: true },
  },
} as const;

const errorEnvelope = {
  type: "object",
  properties: {
    success: { type: "boolean", example: false },
    message: { type: "string" },
  },
} as const;

const unauthorized = {
  description: "Unauthorized — thiếu/sai x-master-key hoặc Bearer token",
  content: { "application/json": { schema: errorEnvelope } },
} as const;

function listGet(summary: string, tag: string, secured = true) {
  return {
    get: {
      tags: [tag],
      summary,
      ...(secured ? { security: [{ masterKey: [] }, { bearerAuth: [] }] } : {}),
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } },
        ...(secured ? { "401": unauthorized } : {}),
      },
    },
  };
}

export function buildExternalOpenApiSpec(serverUrl = "/") {
  return {
    openapi: "3.0.3",
    info: {
      title: "AVI/AOI Management — External REST API",
      version: "1.0.0",
      description:
        "REST API cho đối tác/hệ thống ngoài. Xác thực bằng x-master-key (server-to-server) hoặc Bearer JWT (đăng nhập qua /api/external/auth/login).",
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: "Auth", description: "Đăng nhập lấy JWT" },
      { name: "Machines", description: "Đăng ký & truy vấn máy (master key)" },
      { name: "Hierarchy", description: "Cây phân cấp doanh nghiệp" },
      { name: "Statistics", description: "Thống kê điểm đo / trạm" },
      { name: "Alerts", description: "Cảnh báo nhà máy" },
      { name: "Bulletins", description: "Bản tin" },
      { name: "Dashboard", description: "Tổng quan" },
      { name: "Stations", description: "Trạm / điểm kiểm tra" },
      { name: "Reports", description: "Sinh báo cáo" },
      { name: "User", description: "Tuỳ chọn người dùng" },
      { name: "System", description: "Thời gian server / health" },
    ],
    components: {
      securitySchemes: {
        masterKey: { type: "apiKey", in: "header", name: "x-master-key" },
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: { OkEnvelope: okEnvelope, ErrorEnvelope: errorEnvelope },
    },
    paths: {
      "/api/external/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Đăng nhập, trả JWT cho các endpoint bảo vệ bằng Bearer",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    username: { type: "string" },
                    password: { type: "string", format: "password" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "OK — kèm token", content: { "application/json": { schema: okEnvelope } } },
            "401": unauthorized,
          },
        },
      },
      "/api/external/machines/register": {
        post: {
          tags: ["Machines"],
          summary: "Đăng ký máy mới (master key)",
          security: [{ masterKey: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/machines": listGet("Danh sách máy", "Machines"),
      "/api/external/machines/by-code/{code}": {
        get: {
          tags: ["Machines"],
          summary: "Lấy máy theo mã",
          security: [{ masterKey: [] }],
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/hierarchy/tree": listGet("Cây phân cấp", "Hierarchy"),
      "/api/external/hierarchy/factory/{factoryId}": {
        get: {
          tags: ["Hierarchy"],
          summary: "Phân cấp theo nhà máy",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          parameters: [{ name: "factoryId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/hierarchy/mqtt-topics": listGet("Danh sách MQTT topic", "Hierarchy"),
      "/api/external/hierarchy/mqtt-message-types": listGet("Loại bản tin MQTT", "Hierarchy"),
      "/api/external/hierarchy/summary": listGet("Tóm tắt phân cấp", "Hierarchy"),
      "/api/external/statistics/measurement-points": listGet("Thống kê điểm đo", "Statistics"),
      "/api/external/alerts": listGet("Danh sách cảnh báo", "Alerts"),
      "/api/external/alerts/{alertId}": {
        get: {
          tags: ["Alerts"],
          summary: "Chi tiết cảnh báo",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          parameters: [{ name: "alertId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/alerts/{alertId}/acknowledge": {
        post: {
          tags: ["Alerts"],
          summary: "Xác nhận cảnh báo",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          parameters: [{ name: "alertId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/alerts/{alertId}/resolve": {
        post: {
          tags: ["Alerts"],
          summary: "Đóng cảnh báo",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          parameters: [{ name: "alertId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/bulletins": listGet("Danh sách bản tin", "Bulletins"),
      "/api/external/dashboard/summary": listGet("Tổng quan dashboard", "Dashboard"),
      "/api/external/reports/generate": {
        post: {
          tags: ["Reports"],
          summary: "Sinh báo cáo",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          requestBody: { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/user/preferences": {
        get: {
          tags: ["User"],
          summary: "Lấy tuỳ chọn người dùng",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
        put: {
          tags: ["User"],
          summary: "Cập nhật tuỳ chọn người dùng",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          requestBody: { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/stations": listGet("Danh sách trạm", "Stations"),
      "/api/external/stations/resolve-topic": listGet("Phân giải topic theo trạm", "Stations"),
      "/api/external/stations/{id}": {
        get: {
          tags: ["Stations"],
          summary: "Chi tiết trạm",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/stations/{id}/inspection-points": {
        get: {
          tags: ["Stations"],
          summary: "Điểm kiểm tra của trạm",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/stations/{id}/statistics": {
        get: {
          tags: ["Stations"],
          summary: "Thống kê trạm",
          security: [{ masterKey: [] }, { bearerAuth: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", content: { "application/json": { schema: okEnvelope } } }, "401": unauthorized },
        },
      },
      "/api/external/server-time": listGet("Thời gian server (public)", "System", false),
    },
  };
}
