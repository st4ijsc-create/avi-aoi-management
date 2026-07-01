/**
 * U4a — /api/v1 upper-layer module READ endpoints tests.
 *
 * Covers, for the new fleet/safety/twin/programs/pdm/anomaly/standards/ecosystem/cockpit
 * reads: scope-gated auth (no key → 401, wrong scope → 403, master key → 200), the
 * `{ ok, data?, error? }` envelope shape, honest empty/absent handling, 400 on a missing
 * required param, 404 on an absent asset, and that each reuses the underlying service
 * (asserted via the mocked service being called). Runs against a real Express app on an
 * ephemeral port using global `fetch` (no supertest dep — mirrors apiV1.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── mocks (hoisted) ──────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  getZoneOccupancy: vi.fn(async () => 0),
  queryFeed: vi.fn(async () => [{ id: 1, eventType: "near_miss", isNearMiss: true }]),
  listSafetyZones: vi.fn(async () => [{ id: 7, code: "SZ-1", name: "Cell 1" }]),
  buildSceneGraph: vi.fn(async () => ({ factoryId: 3, nodes: [], edges: [] })),
  listModels: vi.fn(async () => [{ id: 2, modelKey: "arm-v1", status: "active" }]),
  computeFailureRisk: vi.fn(async (machineId: number) => ({ machineId, failureRisk: 0.1, confidenceScore: 0.5, factors: [], dataPoints: 3 })),
  buildHierarchy: vi.fn(async () => ({ sites: [] })),
  buildKpiSummary: vi.fn(async () => ({ oee: null, wip: 0, alarms: 0 })),
  commandCenterStatus: vi.fn(() => ({ live: false })),
  machineDetail: vi.fn(async (id: number) => (id === 1 ? { machineId: 1, code: "AOI-01", gatedActions: [] } : null)),
  robotDetail: vi.fn(async (id: number) => (id === 1 ? { robotId: 1, code: "RB-01", gatedActions: [] } : null)),
  buildSeedTypes: vi.fn(() => [{ typeKey: "aoi", parentTypeKey: null, version: "1.0.0", status: "published" }]),
  buildTree: vi.fn((nodes: unknown[]) => nodes),
  computeCompliance: vi.fn(() => ({ coverage: 1, publishedTypes: 1 })),
  // Fake drizzle db: table-aware select() chains that resolve to fixed rows.
  fleetTasks: [{ id: 10, status: "pending", priority: 3 }],
  programProjectsRows: [{ id: 5, code: "PRJ-1" }],
  programDeploymentsRows: [{ id: 99, projectId: 5 }],
  anomalies: [{ id: 4, robotId: 1, status: "raised" }],
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

// Auth DB path — no api_keys table + one known machine key (ingest:write only).
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async (k: string) => (k === "MACHINE_KEY" ? { id: 1, code: "AOI-01" } : undefined)),
}));

// A minimal chainable drizzle stub whose terminal await resolves per table.
function makeDb() {
  function chain(rows: unknown[]) {
    const p: any = Promise.resolve(rows);
    p.from = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = () => p;
    return p;
  }
  return {
    select: () => ({
      from: (table: any) => {
        const name = table?._?.name ?? table?.[Symbol.for("drizzle:Name")] ?? String(table?.name ?? "");
        // Resolve rows by a loose table identity hint set on the mocked schema below.
        const key = (table && (table as any).__mockName) || name;
        const rowsByTable: Record<string, unknown[]> = {
          tasks: h.fleetTasks,
          zones: [{ id: 7, code: "Z-1" }],
          programProjects: h.programProjectsRows,
          programDeployments: h.programDeploymentsRows,
          robotBehaviorAnomalies: h.anomalies,
          deviceTypes: [],
          alarmTaxonomy: [],
          deviceTypeChangeRequests: [],
          machines: [],
        };
        return chain(rowsByTable[key] ?? []);
      },
    }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeDb()) }));

// Tag the mocked schema tables so makeDb can resolve rows by identity.
vi.mock("../../../drizzle/schema", () => ({
  tasks: { __mockName: "tasks" },
  zones: { __mockName: "zones", code: "code" },
  programProjects: { __mockName: "programProjects", updatedAt: "updatedAt", id: "id" },
  programDeployments: { __mockName: "programDeployments", projectId: "projectId", id: "id" },
  robotBehaviorAnomalies: { __mockName: "robotBehaviorAnomalies", detectedAt: "detectedAt", robotId: "robotId", status: "status" },
  machines: { __mockName: "machines", machineType: "machineType" },
}));
vi.mock("../../../drizzle/schema/equipmentStandards", () => ({
  deviceTypes: { __mockName: "deviceTypes", status: "status" },
  alarmTaxonomy: { __mockName: "alarmTaxonomy", vendor: "vendor" },
  deviceTypeChangeRequests: { __mockName: "deviceTypeChangeRequests", status: "status" },
}));

// drizzle-orm operators → inert (the fake db ignores them).
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, desc: (x: unknown) => x, eq: (...a: unknown[]) => a }));

// Service reuse targets (each mocked so the test proves the endpoint calls it).
vi.mock("../../services/fleet/trafficManager", () => ({ getZoneOccupancy: h.getZoneOccupancy }));
vi.mock("../../services/safety/safetyAuditService", () => ({ queryFeed: h.queryFeed }));
vi.mock("../../services/safety/safetyZoneService", () => ({ listZones: h.listSafetyZones }));
vi.mock("../../services/twin/sceneGraph", () => ({ buildSceneGraph: h.buildSceneGraph }));
vi.mock("../../services/twin/modelRegistry", () => ({ listModels: h.listModels }));
vi.mock("../../services/predictiveMaintenanceService", () => ({ computeFailureRisk: h.computeFailureRisk }));
vi.mock("../../services/ecosystem/commandCenterService", () => ({
  buildHierarchy: h.buildHierarchy,
  buildKpiSummary: h.buildKpiSummary,
  commandCenterStatus: h.commandCenterStatus,
}));
vi.mock("../../services/ecosystem/assetCockpitService", () => ({
  machineDetail: h.machineDetail,
  robotDetail: h.robotDetail,
}));
vi.mock("../../services/standards/deviceTypeRegistry", () => ({ buildSeedTypes: h.buildSeedTypes, buildTree: h.buildTree }));
vi.mock("../../services/standards/alarmTaxonomy", () => ({
  SEED_ALARM_MAPPINGS: [{ vendor: "fanuc", nativeCode: "SRVO-050", standardCode: "COLLISION", severity: "high" }],
  listVendors: (e: Array<{ vendor: string }>) => [...new Set(e.map((x) => x.vendor))],
  asSeverity: (s: unknown) => String(s ?? "medium"),
}));
vi.mock("../../services/standards/complianceService", () => ({ computeCompliance: h.computeCompliance }));

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

function call(path: string, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["authorization"] = `Bearer ${key}`;
  return fetch(`${base}${path}`, { headers });
}

describe("U4a — scope gating (no key → 401, wrong scope → 403, master → 200)", () => {
  const endpoints = [
    "/api/v1/fleet/tasks",
    "/api/v1/fleet/zones",
    "/api/v1/safety/events",
    "/api/v1/safety/zones",
    "/api/v1/twin/scene-graph?factoryId=3",
    "/api/v1/twin/models",
    "/api/v1/programs",
    "/api/v1/pdm/risk?machineId=1",
    "/api/v1/anomaly/events",
    "/api/v1/standards/device-types",
    "/api/v1/standards/alarm-taxonomy",
    "/api/v1/standards/compliance",
    "/api/v1/ecosystem/hierarchy",
    "/api/v1/ecosystem/kpi",
    "/api/v1/machines/1/detail",
  ];

  it("no key → 401 for every new endpoint", async () => {
    for (const ep of endpoints) {
      const res = await call(ep);
      expect(res.status, ep).toBe(401);
      const body = await res.json();
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe("unauthorized");
    }
  });

  it("machine key (ingest:write only) → 403 on the new scoped reads", async () => {
    for (const ep of endpoints) {
      const res = await call(ep, "MACHINE_KEY");
      expect(res.status, ep).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("forbidden");
    }
  });

  it("master key → 200 + ok envelope for every new endpoint", async () => {
    for (const ep of endpoints) {
      const res = await call(ep, "MASTER");
      expect(res.status, ep).toBe(200);
      const body = await res.json();
      expect(body.ok, ep).toBe(true);
      expect(body.data, ep).toBeTruthy();
    }
  });
});

describe("U4a — reuse + shape per endpoint", () => {
  it("fleet/tasks reuses the tasks query + count envelope", async () => {
    const body = await (await call("/api/v1/fleet/tasks", "MASTER")).json();
    expect(body.data.count).toBe(1);
    expect(body.data.tasks[0].id).toBe(10);
  });

  it("fleet/zones derives occupancy via getZoneOccupancy", async () => {
    h.getZoneOccupancy.mockClear();
    const body = await (await call("/api/v1/fleet/zones", "MASTER")).json();
    expect(h.getZoneOccupancy).toHaveBeenCalled();
    expect(body.data.zones[0]).toHaveProperty("occupancy");
  });

  it("safety/events reuses queryFeed + is flagged advisory", async () => {
    h.queryFeed.mockClear();
    const body = await (await call("/api/v1/safety/events?limit=10", "MASTER")).json();
    expect(h.queryFeed).toHaveBeenCalledTimes(1);
    expect(body.data.advisory).toBe(true);
    expect(body.data.count).toBe(1);
  });

  it("safety/zones reuses listZones", async () => {
    h.listSafetyZones.mockClear();
    const body = await (await call("/api/v1/safety/zones", "MASTER")).json();
    expect(h.listSafetyZones).toHaveBeenCalledTimes(1);
    expect(body.data.ratedStopIsHardware).toBe(true);
  });

  it("twin/scene-graph reuses buildSceneGraph; missing factoryId → 400", async () => {
    h.buildSceneGraph.mockClear();
    const ok = await (await call("/api/v1/twin/scene-graph?factoryId=3", "MASTER")).json();
    expect(h.buildSceneGraph).toHaveBeenCalledWith(3);
    expect(ok.data.factoryId).toBe(3);
    const bad = await call("/api/v1/twin/scene-graph", "MASTER");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad_request");
  });

  it("twin/models reuses listModels", async () => {
    h.listModels.mockClear();
    const body = await (await call("/api/v1/twin/models", "MASTER")).json();
    expect(h.listModels).toHaveBeenCalledTimes(1);
    expect(body.data.count).toBe(1);
  });

  it("programs reuses the projects query", async () => {
    const body = await (await call("/api/v1/programs", "MASTER")).json();
    expect(body.data.programs[0].id).toBe(5);
  });

  it("programs/:id/deployments returns the program's deployments", async () => {
    const body = await (await call("/api/v1/programs/5/deployments", "MASTER")).json();
    expect(body.data.programId).toBe(5);
    expect(body.data.deployments[0].id).toBe(99);
  });

  it("pdm/risk reuses computeFailureRisk; missing machineId → 400", async () => {
    h.computeFailureRisk.mockClear();
    const ok = await (await call("/api/v1/pdm/risk?machineId=1", "MASTER")).json();
    expect(h.computeFailureRisk).toHaveBeenCalledWith(1, undefined);
    expect(ok.data.machineId).toBe(1);
    const bad = await call("/api/v1/pdm/risk", "MASTER");
    expect(bad.status).toBe(400);
  });

  it("anomaly/events reuses the anomalies query + advisory flag", async () => {
    const body = await (await call("/api/v1/anomaly/events", "MASTER")).json();
    expect(body.data.advisory).toBe(true);
    expect(body.data.anomalies[0].id).toBe(4);
  });

  it("standards/device-types reuses buildTree", async () => {
    h.buildTree.mockClear();
    const body = await (await call("/api/v1/standards/device-types", "MASTER")).json();
    expect(h.buildTree).toHaveBeenCalledTimes(1);
    expect(body.data.typeCount).toBe(1);
  });

  it("standards/alarm-taxonomy merges SEED + lists vendors", async () => {
    const body = await (await call("/api/v1/standards/alarm-taxonomy", "MASTER")).json();
    expect(body.data.vendors).toContain("fanuc");
    expect(body.data.mappings.length).toBe(1);
  });

  it("standards/compliance reuses computeCompliance", async () => {
    h.computeCompliance.mockClear();
    const body = await (await call("/api/v1/standards/compliance", "MASTER")).json();
    expect(h.computeCompliance).toHaveBeenCalledTimes(1);
    expect(body.data.coverage).toBe(1);
  });

  it("ecosystem/hierarchy reuses buildHierarchy", async () => {
    h.buildHierarchy.mockClear();
    const body = await (await call("/api/v1/ecosystem/hierarchy", "MASTER")).json();
    expect(h.buildHierarchy).toHaveBeenCalledTimes(1);
    expect(body.data).toHaveProperty("sites");
  });

  it("ecosystem/kpi reuses buildKpiSummary with a synthetic api principal", async () => {
    h.buildKpiSummary.mockClear();
    const body = await (await call("/api/v1/ecosystem/kpi", "MASTER")).json();
    expect(h.buildKpiSummary).toHaveBeenCalledTimes(1);
    const userArg = h.buildKpiSummary.mock.calls[0][0] as any;
    expect(userArg.id).toBe(0);
    expect(body.data).toHaveProperty("status");
  });

  it("machines/:id/detail reuses machineDetail; unknown → 404", async () => {
    h.machineDetail.mockClear();
    const ok = await (await call("/api/v1/machines/1/detail", "MASTER")).json();
    expect(h.machineDetail).toHaveBeenCalledWith(1);
    expect(ok.data.machineId).toBe(1);
    const miss = await call("/api/v1/machines/999/detail", "MASTER");
    expect(miss.status).toBe(404);
    expect((await miss.json()).error.code).toBe("not_found");
  });

  it("robots/:id/detail reuses robotDetail; unknown → 404", async () => {
    const ok = await (await call("/api/v1/robots/1/detail", "MASTER")).json();
    expect(ok.data.robotId).toBe(1);
    const miss = await call("/api/v1/robots/999/detail", "MASTER");
    expect(miss.status).toBe(404);
  });
});

describe("U4a — openapi documents the new endpoints", () => {
  it("openapi.json includes the new paths + scopes", async () => {
    const spec = await (await call("/api/v1/openapi.json")).json();
    for (const p of [
      "/api/v1/fleet/tasks",
      "/api/v1/safety/events",
      "/api/v1/twin/scene-graph",
      "/api/v1/programs/{id}/deployments",
      "/api/v1/pdm/risk",
      "/api/v1/anomaly/events",
      "/api/v1/standards/compliance",
      "/api/v1/ecosystem/hierarchy",
      "/api/v1/machines/{id}/detail",
      "/api/v1/robots/{id}/detail",
    ]) {
      expect(spec.paths[p]?.get, p).toBeTruthy();
    }
    // The scope vocabulary in the info description mentions the new scopes.
    expect(spec.info.description).toMatch(/fleet:read/);
    expect(spec.info.description).toMatch(/standards:read/);
  });
});
