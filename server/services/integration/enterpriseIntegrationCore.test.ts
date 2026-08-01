/**
 * Enterprise Integration CORE tests — doc 44 W6-5 (G5.24).
 *
 * Covers: per-system flags, anti-corruption id-map upsert/resolve, sync-log audit +
 * duplicate detection, the outbound bridge (disabled/no-endpoint/idempotent), and the
 * generic REST pull helper + pure field pickers. getDb is mocked to a fake DB; the
 * outbox is mocked to a dedupe-store.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./erpOutbox", () => {
  const store = new Map<string, number>();
  let id = 0;
  return {
    enqueueOutbox: vi.fn(async (input: any) => {
      if (input.idempotencyKey && store.has(input.idempotencyKey)) {
        return { ok: true, id: store.get(input.idempotencyKey), duplicate: true };
      }
      id += 1;
      if (input.idempotencyKey) store.set(input.idempotencyKey, id);
      return { ok: true, id };
    }),
  };
});

vi.mock("../../db/connection", () => ({
  getDb: async () => (await import("./enterpriseIntegration.testkit")).makeFakeDb(),
}));

import {
  wmsEnabled, plmEnabled, cmmsEnabled, systemEnabled, connectorFlags,
  upsertIdMap, resolveInternalId, recordSync,
  enqueueEnterpriseOutbound, pullExternalJson, getPath, toNumber,
} from "./enterpriseIntegrationCore";
import { enterpriseIdMap, enterpriseSyncLog } from "../../../drizzle/schema";
import { resetFakeDb, queueSelect, failNextInsert, fakeDbState } from "./enterpriseIntegration.testkit";
import { enqueueOutbox } from "./erpOutbox";

beforeEach(() => {
  resetFakeDb();
  vi.clearAllMocks();
  delete process.env.WMS_INTEGRATION_ENABLED;
  delete process.env.PLM_INTEGRATION_ENABLED;
  delete process.env.CMMS_INTEGRATION_ENABLED;
});

describe("flags (default OFF)", () => {
  it("each connector flag reads its env var", () => {
    expect(wmsEnabled({})).toBe(false);
    expect(wmsEnabled({ WMS_INTEGRATION_ENABLED: "true" })).toBe(true);
    expect(plmEnabled({ PLM_INTEGRATION_ENABLED: "1" })).toBe(true);
    expect(cmmsEnabled({ CMMS_INTEGRATION_ENABLED: "false" })).toBe(false);
    expect(systemEnabled("wms", { WMS_INTEGRATION_ENABLED: "true" })).toBe(true);
    expect(connectorFlags({})).toEqual({ wms: false, plm: false, cmms: false });
  });
});

describe("id-map (anti-corruption)", () => {
  it("inserts a new mapping when none exists", async () => {
    queueSelect(enterpriseIdMap, []); // existing lookup → none
    const ok = await upsertIdMap({ system: "wms", entityType: "material", externalId: "WMS-1", internalId: "R100" });
    expect(ok).toBe(true);
    expect(fakeDbState.inserts).toHaveLength(1);
    expect(fakeDbState.inserts[0].table).toBe(enterpriseIdMap);
    expect((fakeDbState.inserts[0].values as any).internalId).toBe("R100");
  });

  it("updates an existing mapping (no second insert)", async () => {
    queueSelect(enterpriseIdMap, [{ id: 7 }]); // existing lookup → found
    const ok = await upsertIdMap({ system: "wms", entityType: "material", externalId: "WMS-1", internalId: 200 });
    expect(ok).toBe(true);
    expect(fakeDbState.inserts).toHaveLength(0);
    expect(fakeDbState.updates).toHaveLength(1);
    expect((fakeDbState.updates[0].values as any).internalId).toBe("200");
  });

  it("resolveInternalId returns the mapped canonical id (or null)", async () => {
    queueSelect(enterpriseIdMap, [{ internalId: "R100" }]);
    expect(await resolveInternalId("wms", "material", "WMS-1")).toBe("R100");
    queueSelect(enterpriseIdMap, []);
    expect(await resolveInternalId("wms", "material", "WMS-2")).toBeNull();
  });
});

describe("sync-log", () => {
  it("records an op", async () => {
    const r = await recordSync({ system: "plm", direction: "inbound", operation: "plm.bom.upsert", status: "ok" });
    expect(r).toEqual({ recorded: true, duplicate: false });
    expect(fakeDbState.inserts[0].table).toBe(enterpriseSyncLog);
  });

  it("treats a unique-violation as a duplicate (inbound idempotency)", async () => {
    failNextInsert();
    const r = await recordSync({ system: "plm", direction: "inbound", operation: "plm.bom.upsert", idempotencyKey: "k1", status: "ok" });
    expect(r.duplicate).toBe(true);
    expect(r.recorded).toBe(false);
  });
});

describe("outbound bridge onto the durable outbox", () => {
  const base = { system: "wms" as const, family: "production-event" as const, kind: "wms.material.request", payload: { a: 1 }, idempotencyKey: "wms-x", targetEndpoint: "https://wms.test/hook" };

  it("no-op (disabled) when the system flag is OFF", async () => {
    const r = await enqueueEnterpriseOutbound(base);
    expect(r.disabled).toBe(true);
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });

  it("no-op (noEndpoint) when no endpoint is configured", async () => {
    process.env.WMS_INTEGRATION_ENABLED = "true";
    const r = await enqueueEnterpriseOutbound({ ...base, targetEndpoint: "" });
    expect(r.noEndpoint).toBe(true);
    expect(enqueueOutbox).not.toHaveBeenCalled();
  });

  it("enqueues when enabled and is idempotent (2nd identical enqueue dedupes)", async () => {
    process.env.WMS_INTEGRATION_ENABLED = "true";
    const first = await enqueueEnterpriseOutbound({ ...base, idempotencyKey: "wms-dedupe-1" });
    const second = await enqueueEnterpriseOutbound({ ...base, idempotencyKey: "wms-dedupe-1" });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBeFalsy();
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    // payload carries the discriminator kind
    expect((enqueueOutbox as any).mock.calls[0][0].payload.kind).toBe("wms.material.request");
  });
});

describe("generic REST pull helper + pure utils", () => {
  it("pullExternalJson returns parsed JSON on 2xx", async () => {
    const fetchImpl = (async () => ({ ok: true, status: 200, json: async () => ({ hello: "world" }) })) as unknown as typeof fetch;
    expect(await pullExternalJson({ url: "u", fetchImpl })).toEqual({ hello: "world" });
  });

  it("pullExternalJson throws on a non-2xx (caller decides autonomy)", async () => {
    const fetchImpl = (async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch;
    await expect(pullExternalJson({ url: "u", fetchImpl })).rejects.toThrow(/HTTP 503/);
  });

  it("getPath reads dot-paths; toNumber coerces", () => {
    expect(getPath({ a: { b: 5 } }, "a.b")).toBe(5);
    expect(getPath({ a: {} }, "a.b.c")).toBeUndefined();
    expect(toNumber("42")).toBe(42);
    expect(toNumber("x")).toBeNull();
    expect(toNumber(3.5)).toBe(3.5);
  });
});
