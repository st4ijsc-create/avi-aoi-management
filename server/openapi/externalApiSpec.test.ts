import { describe, expect, it } from "vitest";
import { buildExternalOpenApiSpec } from "./externalApiSpec";

describe("externalApiSpec", () => {
  const spec = buildExternalOpenApiSpec("https://example.com") as any;

  it("is a valid OpenAPI 3 document", () => {
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toContain("External REST API");
    expect(spec.servers[0].url).toBe("https://example.com");
  });

  it("declares both security schemes", () => {
    expect(spec.components.securitySchemes.masterKey).toMatchObject({ type: "apiKey", name: "x-master-key" });
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
  });

  it("documents the login and key external endpoints", () => {
    expect(spec.paths["/api/external/auth/login"].post).toBeTruthy();
    expect(spec.paths["/api/external/machines"].get).toBeTruthy();
    expect(spec.paths["/api/external/alerts/{alertId}/acknowledge"].post).toBeTruthy();
  });

  it("marks server-time as public (no security)", () => {
    expect(spec.paths["/api/external/server-time"].get.security).toBeUndefined();
  });

  it("secures alerts list with masterKey or bearer", () => {
    const sec = spec.paths["/api/external/alerts"].get.security;
    expect(sec).toEqual([{ masterKey: [] }, { bearerAuth: [] }]);
  });
});
