/**
 * W2-A2 (doc 44 G1.10-G1.12) — /api/v1 asset-registry endpoint tests.
 *
 * Covers: scope gating (no key → 401, wrong scope → 403, master → 200/2xx),
 * the spec asset shape (asset_id URN + path + class + lifecycle_state + tag
 * count), URN-or-id resolution, lifecycle PUT reusing transitionMachineLifecycle
 * (guarded: illegal → 409, bad state → 400), honest health (presence null when
 * no record), declarative POST /assets (201, lifecycle 'registered', 409 on code
 * collision), config-drift view/approve reuse, adapter restart 501 while
 * V1_ADAPTER_RESTART_ENABLED is OFF (default), gateway status honest mapping,
 * and openapi path registration. Runs a real Express app on an ephemeral port
 * (mirrors moduleReads.test.ts — no supertest dep).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── mocks (hoisted) ──────────────────────────────────────────────────────────
const h = vi.hoisted(() => {
  const machineRow = {
    id: 1,
    code: "AOI-01",
    name: "AOI Line A",
    machineType: "AOI",
    model: "VT-S730",
    manufacturer: "Omron",
    serialNumber: "SN-1",
    stationId: 4,
    lifecycleStatus: "active",
    registrationStatus: "approved",
    operationStatus: "running",
    capabilities: { hasRecipe: true },
    urn: "urn:syn:asset:f1:line-1:st-1:aoi-01",
    isa95Path: "f1/ws-a/line-1/st-1/aoi-01",
    lastHeartbeat: null,
    isActive: true,
  };
  return {
    machineRow,
    rows: {
      machines: [machineRow] as unknown[],
      deviceAdapters: [] as unknown[],
      deviceTags: [] as unknown[],
      machineStatusLogs: [] as unknown[],
      edgeNodes: [] as unknown[],
    },
    transitionMachineLifecycle: vi.fn(),
    getStationById: vi.fn(async () => ({ id: 4, code: "ST-1" })),
    createMachine: vi.fn(async () => 42),
    recordAuditEvent: vi.fn(async () => null),
    syncAssetIdentity: vi.fn(async () => ({ urn: "urn:syn:asset:f1:line-1:st-1:new-01", path: "f1/ws-a/line-1/st-1/new-01" })),
    computeUrn: vi.fn(async () => "urn:syn:asset:computed"),
    computePath: vi.fn(async () => "computed/path"),
    checkAdapterDrift: vi.fn(async () => ({
      entityType: "adapter",
      adapterId: 3,
      adapterCode: "plc-1",
      protocol: "modbus_tcp",
      machineId: 1,
      currentHash: "c".repeat(64),
      approvedHash: "a".repeat(64),
      status: "drift",
      driftDetectedAt: new Date(),
      approvedAt: null,
      approvedBy: null,
      summary: { tagCount: 2 },
      newlyDrifted: false,
    })),
    approveCurrentConfig: vi.fn(async (adapterId: number) => ({
      entityType: "adapter",
      adapterId,
      adapterCode: "plc-1",
      protocol: "modbus_tcp",
      machineId: 1,
      currentHash: "c".repeat(64),
      approvedHash: "c".repeat(64),
      status: "in_sync",
      driftDetectedAt: null,
      approvedAt: new Date(),
      approvedBy: null,
      summary: {},
      newlyDrifted: false,
    })),
  };
});

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

// Auth path + the db functions assets.ts pulls from "../../db".
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async (k: string) => (k === "MACHINE_KEY" ? { id: 1, code: "AOI-01" } : undefined)),
  transitionMachineLifecycle: h.transitionMachineLifecycle,
  getStationById: h.getStationById,
  createMachine: h.createMachine,
}));

// Chainable fake drizzle db resolving rows per mocked table identity.
function makeDb() {
  function chain(rows: unknown[]) {
    const p: any = Promise.resolve(rows);
    p.from = () => p;
    p.leftJoin = () => p;
    p.innerJoin = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.groupBy = () => p;
    p.limit = () => p;
    return p;
  }
  return {
    select: () => ({
      from: (table: any) => {
        const key = (table && table.__mockName) || "";
        const rows = (h.rows as Record<string, unknown[]>)[key] ?? [];
        return chain(rows);
      },
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeDb()) }));

vi.mock("../../../drizzle/schema", () => ({
  machines: { __mockName: "machines", id: "id", urn: "urn", isActive: "isActive", machineType: "machineType", lifecycleStatus: "lifecycleStatus", isa95Path: "isa95Path", stationId: "stationId" },
  stations: { __mockName: "stations", id: "id", code: "code", lineId: "lineId" },
  productionLines: { __mockName: "productionLines", id: "id", code: "code", workshopId: "workshopId" },
  workshops: { __mockName: "workshops", id: "id", code: "code", factoryId: "factoryId" },
  factories: { __mockName: "factories", id: "id", code: "code" },
  deviceAdapters: { __mockName: "deviceAdapters", id: "id", machineId: "machineId", code: "code", protocol: "protocol", status: "status", isEnabled: "isEnabled", lastConnectedAt: "lastConnectedAt", lastErrorAt: "lastErrorAt", lastError: "lastError" },
  deviceTags: { __mockName: "deviceTags", adapterId: "adapterId", tagKey: "tagKey", address: "address", dataType: "dataType", unit: "unit", writable: "writable", isEnabled: "isEnabled" },
  machineStatusLogs: { __mockName: "machineStatusLogs", machineId: "machineId", status: "status", timestamp: "timestamp" },
  edgeNodes: { __mockName: "edgeNodes", id: "id", code: "code" },
  machineTypeEnum: { enumValues: ["AVI", "AOI", "ROBOT"] },
  MACHINE_LIFECYCLE_STATUSES: ["registered", "commissioning", "active", "faulted", "maintenance", "decommissioned", "retired"],
}));

vi.mock("drizzle-orm", () => {
  const sqlTag: any = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals });
  sqlTag.raw = (s: unknown) => s;
  return {
    and: (...a: unknown[]) => a,
    or: (...a: unknown[]) => a,
    eq: (...a: unknown[]) => a,
    ne: (...a: unknown[]) => a,
    asc: (x: unknown) => x,
    desc: (x: unknown) => x,
    inArray: (...a: unknown[]) => a,
    gte: (...a: unknown[]) => a,
    lte: (...a: unknown[]) => a,
    sql: sqlTag,
  };
});

vi.mock("../../services/assetRegistry/urnService", () => ({
  syncAssetIdentity: h.syncAssetIdentity,
  computeUrn: h.computeUrn,
  computePath: h.computePath,
}));
vi.mock("../../services/assetRegistry/configDriftService", () => ({
  checkAdapterDrift: h.checkAdapterDrift,
  approveCurrentConfig: h.approveCurrentConfig,
  configDriftEnabled: () => false,
}));
vi.mock("../../services/audit/controlAuditService", () => ({ recordAuditEvent: h.recordAuditEvent }));

import { createV1Router } from "./router";

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/v1", createV1Router());
  await new Promise<void>((resolve) => {
    server = createServer(app).listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.rows.machines = [h.machineRow];
  h.rows.deviceAdapters = [];
  h.rows.deviceTags = [];
  h.rows.machineStatusLogs = [];
  h.rows.edgeNodes = [];
  h.transitionMachineLifecycle.mockReset();
  h.createMachine.mockClear();
  h.recordAuditEvent.mockClear();
  h.checkAdapterDrift.mockClear();
  h.approveCurrentConfig.mockClear();
  delete process.env.V1_ADAPTER_RESTART_ENABLED;
});

function call(path: string, key?: string, init?: RequestInit) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as never) };
  if (key) headers["authorization"] = `Bearer ${key}`;
  return fetch(`${base}${path}`, { ...init, headers });
}

// ── scope gating ─────────────────────────────────────────────────────────────
describe("W2-A2 — scope gating", () => {
  const reads = [
    "/api/v1/assets",
    "/api/v1/assets/1",
    "/api/v1/assets/1/health",
    "/api/v1/assets/1/tags",
    "/api/v1/assets/1/config-drift",
    "/api/v1/gateways/1/status",
  ];
  const writes: Array<[string, string]> = [
    ["PUT", "/api/v1/assets/1/lifecycle"],
    ["POST", "/api/v1/assets"],
    ["POST", "/api/v1/assets/1/config-drift/approve"],
    ["POST", "/api/v1/adapters/3/restart"],
  ];

  it("no key → 401 on every endpoint", async () => {
    for (const ep of reads) {
      const res = await call(ep);
      expect(res.status, ep).toBe(401);
      expect((await res.json()).error.code).toBe("unauthorized");
    }
    for (const [method, ep] of writes) {
      const res = await call(ep, undefined, { method, body: "{}" });
      expect(res.status, `${method} ${ep}`).toBe(401);
    }
  });

  it("machine key (ingest:write only) → 403 everywhere", async () => {
    for (const ep of reads) {
      const res = await call(ep, "MACHINE_KEY");
      expect(res.status, ep).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden");
    }
    for (const [method, ep] of writes) {
      const res = await call(ep, "MACHINE_KEY", { method, body: "{}" });
      expect(res.status, `${method} ${ep}`).toBe(403);
    }
  });
});

// ── discovery + detail ───────────────────────────────────────────────────────
describe("W2-A2 — GET /assets (spec shape)", () => {
  it("returns spec-shaped assets: asset_id URN, class, path, lifecycle_state, tag count", async () => {
    const res = await call("/api/v1/assets", "MASTER");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(1);
    const a = body.data.assets[0];
    expect(a.asset_id).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01");
    expect(a.machine_id).toBe(1);
    expect(a.class).toBe("AOI");
    expect(a.vendor).toBe("Omron");
    expect(a.path).toBe("f1/ws-a/line-1/st-1/aoi-01");
    expect(a.lifecycle_state).toBe("active");
    expect(a.tags).toBe(0);
  });

  it("invalid lifecycle filter → 400", async () => {
    const res = await call("/api/v1/assets?lifecycle=bogus", "MASTER");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("GET /assets/:id resolves numeric id AND rejects a malformed id", async () => {
    const ok = await call("/api/v1/assets/1", "MASTER");
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data.asset_id).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01");
    expect(body.data.lifecycle_state).toBe("active");
    expect(body.data.registration_status).toBe("approved");

    const bad = await call("/api/v1/assets/not-a-urn", "MASTER");
    expect(bad.status).toBe(400);
  });

  it("GET /assets/:id accepts a urn:… id (resolver)", async () => {
    const res = await call("/api/v1/assets/urn:syn:asset:f1:line-1:st-1:aoi-01", "MASTER");
    expect(res.status).toBe(200);
    expect((await res.json()).data.machine_id).toBe(1);
  });

  it("unknown asset → 404", async () => {
    h.rows.machines = [];
    const res = await call("/api/v1/assets/99", "MASTER");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });
});

// ── lifecycle mutation ───────────────────────────────────────────────────────
describe("W2-A2 — PUT /assets/:id/lifecycle", () => {
  it("reuses transitionMachineLifecycle and records the control audit", async () => {
    h.transitionMachineLifecycle.mockResolvedValue({
      before: { id: 1, code: "AOI-01", name: "AOI", lifecycleStatus: "active" },
      after: { id: 1, code: "AOI-01", name: "AOI", lifecycleStatus: "maintenance" },
    });
    const res = await call("/api/v1/assets/1/lifecycle", "MASTER", {
      method: "PUT",
      body: JSON.stringify({ state: "maintenance", reason: "planned PM" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.lifecycle_state).toBe("maintenance");
    expect(body.data.previous_state).toBe("active");
    expect(h.transitionMachineLifecycle).toHaveBeenCalledWith(1, "maintenance");
    expect(h.recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("illegal transition (LifecycleTransitionError) → 409, guard preserved", async () => {
    const err = new Error("Illegal lifecycle transition 'active' → 'retired'");
    err.name = "LifecycleTransitionError";
    h.transitionMachineLifecycle.mockRejectedValue(err);
    const res = await call("/api/v1/assets/1/lifecycle", "MASTER", {
      method: "PUT",
      body: JSON.stringify({ state: "retired" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("illegal_transition");
  });

  it("unknown state → 400 (zod, includes the new registered/faulted vocabulary)", async () => {
    const res = await call("/api/v1/assets/1/lifecycle", "MASTER", {
      method: "PUT",
      body: JSON.stringify({ state: "exploded" }),
    });
    expect(res.status).toBe(400);
    expect(h.transitionMachineLifecycle).not.toHaveBeenCalled();
  });

  it("accepts the NEW 'faulted' state through the same guard", async () => {
    h.transitionMachineLifecycle.mockResolvedValue({
      before: { id: 1, code: "AOI-01", name: "AOI", lifecycleStatus: "active" },
      after: { id: 1, code: "AOI-01", name: "AOI", lifecycleStatus: "faulted" },
    });
    const res = await call("/api/v1/assets/1/lifecycle", "MASTER", {
      method: "PUT",
      body: JSON.stringify({ state: "faulted" }),
    });
    expect(res.status).toBe(200);
    expect(h.transitionMachineLifecycle).toHaveBeenCalledWith(1, "faulted");
  });
});

// ── health + tags (honest) ───────────────────────────────────────────────────
describe("W2-A2 — health & tags", () => {
  it("health is HONEST: presence null when no status log exists", async () => {
    const res = await call("/api/v1/assets/1/health", "MASTER");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.presence).toBeNull();
    expect(body.data.last_heartbeat).toBeNull();
    expect(body.data.operation_status).toBe("running");
    expect(Array.isArray(body.data.adapters)).toBe(true);
  });

  it("health carries the latest presence record when one exists", async () => {
    h.rows.machineStatusLogs = [{ status: "online", timestamp: "2026-07-12T00:00:00.000Z" }];
    const body = await (await call("/api/v1/assets/1/health", "MASTER")).json();
    expect(body.data.presence.status).toBe("online");
  });

  it("tags are spec-shaped (tag_id, datatype, direction, source_address)", async () => {
    h.rows.deviceTags = [
      { tagKey: "temp", address: "40001", dataType: "float", unit: "C", writable: false, isEnabled: true, adapterId: 3, adapterCode: "plc-1", protocol: "modbus_tcp" },
    ];
    const body = await (await call("/api/v1/assets/1/tags", "MASTER")).json();
    expect(body.data.count).toBe(1);
    const t = body.data.tags[0];
    expect(t.tag_id).toBe("temp");
    expect(t.direction).toBe("ro");
    expect(t.source_address).toBe("modbus_tcp:40001");
  });
});

// ── declarative registration ─────────────────────────────────────────────────
describe("W2-A2 — POST /assets", () => {
  it("creates a machine at lifecycle 'registered' and returns the URN + honest onboarding", async () => {
    const res = await call("/api/v1/assets", "MASTER", {
      method: "POST",
      body: JSON.stringify({ code: "NEW-01", name: "New robot", class: "ROBOT", stationId: 4 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.machine_id).toBe(42);
    expect(body.data.lifecycle_state).toBe("registered");
    expect(body.data.asset_id).toBe("urn:syn:asset:f1:line-1:st-1:new-01");
    expect(body.data.onboarding.next_steps.length).toBeGreaterThan(0);
    const created = h.createMachine.mock.calls[0][0] as Record<string, unknown>;
    expect(created.lifecycleStatus).toBe("registered");
    expect(created.machineType).toBe("ROBOT");
  });

  it("unknown class → 400; missing fields → 400 (strict zod)", async () => {
    const badClass = await call("/api/v1/assets", "MASTER", {
      method: "POST",
      body: JSON.stringify({ code: "X", name: "X", class: "TOASTER", stationId: 4 }),
    });
    expect(badClass.status).toBe(400);
    const missing = await call("/api/v1/assets", "MASTER", { method: "POST", body: JSON.stringify({ code: "X" }) });
    expect(missing.status).toBe(400);
    expect(h.createMachine).not.toHaveBeenCalled();
  });

  it("active code collision → 409", async () => {
    const err = new Error("Machine code 'NEW-01' is already in use by an active machine");
    err.name = "MachineCodeCollisionError";
    h.createMachine.mockRejectedValueOnce(err);
    const res = await call("/api/v1/assets", "MASTER", {
      method: "POST",
      body: JSON.stringify({ code: "NEW-01", name: "New robot", class: "ROBOT", stationId: 4 }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("code_collision");
  });

  it("unknown station → 404", async () => {
    h.getStationById.mockResolvedValueOnce(undefined as never);
    const res = await call("/api/v1/assets", "MASTER", {
      method: "POST",
      body: JSON.stringify({ code: "NEW-01", name: "New robot", class: "ROBOT", stationId: 999 }),
    });
    expect(res.status).toBe(404);
  });
});

// ── config drift ─────────────────────────────────────────────────────────────
describe("W2-A2 — config-drift view/approve", () => {
  it("GET reuses checkAdapterDrift READ-ONLY (persist:false)", async () => {
    h.rows.deviceAdapters = [{ id: 3 }];
    const body = await (await call("/api/v1/assets/1/config-drift", "MASTER")).json();
    expect(h.checkAdapterDrift).toHaveBeenCalledWith(3, { persist: false });
    expect(body.data.adapters[0].status).toBe("drift");
    expect(body.data.sweep_enabled).toBe(false);
  });

  it("POST approve reuses approveCurrentConfig for the asset's adapters", async () => {
    h.rows.deviceAdapters = [{ id: 3 }, { id: 5 }];
    const body = await (
      await call("/api/v1/assets/1/config-drift/approve", "MASTER", { method: "POST", body: "{}" })
    ).json();
    expect(h.approveCurrentConfig).toHaveBeenCalledTimes(2);
    expect(body.data.approved).toHaveLength(2);
    expect(body.data.approved[0].status).toBe("in_sync");
  });

  it("POST approve with a foreign adapterId → 404", async () => {
    h.rows.deviceAdapters = [{ id: 3 }];
    const res = await call("/api/v1/assets/1/config-drift/approve", "MASTER", {
      method: "POST",
      body: JSON.stringify({ adapterId: 77 }),
    });
    expect(res.status).toBe(404);
    expect(h.approveCurrentConfig).not.toHaveBeenCalled();
  });

  it("POST approve when the asset has no adapters → 404 (honest)", async () => {
    const res = await call("/api/v1/assets/1/config-drift/approve", "MASTER", { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });
});

// ── adapter restart (flag-gated) + gateway status ────────────────────────────
describe("W2-A2 — adapter restart & gateway status", () => {
  it("restart is 501 with the flag note while V1_ADAPTER_RESTART_ENABLED is OFF (default)", async () => {
    const res = await call("/api/v1/adapters/3/restart", "MASTER", { method: "POST", body: "{}" });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe("v1_adapter_restart_disabled");
    expect(body.error.details.flag).toBe("V1_ADAPTER_RESTART_ENABLED");
  });

  it("gateway status maps the edge_nodes registry (honest health passthrough)", async () => {
    h.rows.edgeNodes = [
      { id: 9, code: "edge-a", name: "Edge A", status: "online", factoryCode: "F1", lastHeartbeatAt: "2026-07-12T00:00:00.000Z", version: "1.2.0", assignedLineCodes: ["L1"], healthJson: null },
    ];
    const body = await (await call("/api/v1/gateways/9/status", "MASTER")).json();
    expect(body.data.gateway_id).toBe(9);
    expect(body.data.status).toBe("online");
    expect(body.data.health).toBeNull(); // honest — no self-reported health
  });

  it("unknown gateway → 404", async () => {
    const res = await call("/api/v1/gateways/404/status", "MASTER");
    expect(res.status).toBe(404);
  });
});

// ── openapi contract ─────────────────────────────────────────────────────────
describe("W2-A2 — openapi documents the new endpoints", () => {
  it("openapi.json includes the asset-registry paths + assets scopes", async () => {
    const spec = await (await call("/api/v1/openapi.json")).json();
    expect(spec.paths["/api/v1/assets"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/assets"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/assets/{id}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/assets/{id}/lifecycle"]?.put).toBeTruthy();
    expect(spec.paths["/api/v1/assets/{id}/health"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/assets/{id}/tags"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/assets/{id}/config-drift"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/assets/{id}/config-drift/approve"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/adapters/{id}/restart"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/gateways/{id}/status"]?.get).toBeTruthy();
    expect(spec.info.description).toMatch(/assets:read/);
    expect(spec.info.description).toMatch(/assets:write/);
  });
});
