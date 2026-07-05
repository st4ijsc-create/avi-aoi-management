/**
 * Contracts tests — SYNAPSE §5.6/§8/§5.9 (doc 33 F7 · H5).
 * Schema BACKWARD gate · OpenAPI/AsyncAPI builder · reconciliation.
 */
import { describe, it, expect, beforeEach } from "vitest";

import {
  checkBackwardCompat,
  registerSchema,
  getLatestSchema,
  _clearSchemaRegistry,
  SchemaCompatError,
  type JsonSchema,
} from "./schemaRegistry";
import { buildOpenApi, buildAsyncApi, buildSeedSpecs, SEED_UNS_CHANNELS } from "./apiSpec";
import { reconcile } from "./reconciliation";

const v1: JsonSchema = {
  type: "object",
  properties: { id: { type: "string" }, qty: { type: "number" }, status: { type: "string", enum: ["a", "b"] } },
  required: ["id"],
};

describe("schemaRegistry — BACKWARD gate", () => {
  beforeEach(() => _clearSchemaRegistry());

  it("adding an optional property is compatible", () => {
    const next = { ...v1, properties: { ...(v1.properties as object), extra: { type: "string" } } };
    const r = checkBackwardCompat(v1, next);
    expect(r.compatible).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/extra/);
  });
  it("removing a property is breaking", () => {
    const next: JsonSchema = { type: "object", properties: { id: { type: "string" } }, required: ["id"] };
    expect(checkBackwardCompat(v1, next).compatible).toBe(false);
  });
  it("changing a type is breaking", () => {
    const next: JsonSchema = { ...v1, properties: { ...(v1.properties as object), qty: { type: "string" } } };
    expect(checkBackwardCompat(v1, next).breaking.join(" ")).toMatch(/qty.*type changed/);
  });
  it("newly-required field is breaking; shrunk enum is breaking", () => {
    const req: JsonSchema = { ...v1, required: ["id", "qty"] };
    expect(checkBackwardCompat(v1, req).compatible).toBe(false);
    const enumShrink: JsonSchema = { ...v1, properties: { ...(v1.properties as object), status: { type: "string", enum: ["a"] } } };
    expect(checkBackwardCompat(v1, enumShrink).breaking.join(" ")).toMatch(/enum value .*removed/);
  });

  it("registerSchema rejects a breaking change but allows explicit allowBreaking", () => {
    registerSchema("WorkOrder", v1);
    const breaking: JsonSchema = { type: "object", properties: { id: { type: "number" } }, required: ["id"] };
    expect(() => registerSchema("WorkOrder", breaking)).toThrow(SchemaCompatError);
    // additive is fine → v2
    const additive = { ...v1, properties: { ...(v1.properties as object), note: { type: "string" } } };
    expect(registerSchema("WorkOrder", additive).version).toBe(2);
    // explicit major bump allowed
    expect(registerSchema("WorkOrder", breaking, { allowBreaking: true }).version).toBe(3);
    expect(getLatestSchema("WorkOrder")?.version).toBe(3);
  });
});

describe("apiSpec — OpenAPI + AsyncAPI", () => {
  it("builds a valid OpenAPI 3.1 skeleton", () => {
    const doc = buildOpenApi(
      [{ method: "get", path: "/api/v1/robots", summary: "list", tags: ["fleet"] }],
      { title: "t", version: "1.0.0" },
    );
    expect(doc.openapi).toBe("3.1.0");
    expect((doc.paths as Record<string, unknown>)["/api/v1/robots"]).toBeTruthy();
  });
  it("builds a valid AsyncAPI 2.6 skeleton from channels", () => {
    const doc = buildAsyncApi(SEED_UNS_CHANNELS, { title: "t", version: "1.0.0" });
    expect(doc.asyncapi).toBe("2.6.0");
    expect(Object.keys(doc.channels as object).length).toBe(SEED_UNS_CHANNELS.length);
  });
  it("seed specs are non-empty", () => {
    const { openapi, asyncapi } = buildSeedSpecs();
    expect(Object.keys(openapi.paths as object).length).toBeGreaterThan(0);
    expect(Object.keys(asyncapi.channels as object).length).toBeGreaterThan(0);
  });
});

describe("reconciliation", () => {
  it("matches within tolerance, tickets over tolerance", () => {
    const r = reconcile({
      internal: { produced: 100, scrap: 5 },
      external: { produced: 101, scrap: 9 },
      toleranceRel: 0.02, // 2%
    });
    // produced: delta 1 vs tol 2.02 → match; scrap: delta 4 vs tol 0.18 → ticket
    expect(r.ok).toBe(false);
    expect(r.tickets.map((t) => t.key)).toEqual(["scrap"]);
  });
  it("flags missing keys on either side", () => {
    const r = reconcile({ internal: { a: 1 }, external: { b: 2 } });
    expect(r.tickets.map((t) => t.reason).sort()).toEqual(["missing-external", "missing-internal"]);
  });
  it("all match → ok", () => {
    expect(reconcile({ internal: { a: 10 }, external: { a: 10 } }).ok).toBe(true);
  });
});
