/**
 * W2-B1 (doc 44 G2.16) — /api/v1 Tầng-2 Access API tests: scope gating
 * (401/403), GET /state (shape + 404 + SLO ring), POST /query/timeseries
 * (validation + plain-PG fallback + timescale-main engine), GET /events
 * (union shape + severity/type/path filters), GET /metrics/{metric}
 * (semantic-layer wrap + honest error mapping), and the W0-audit
 * /equipment/{id}/telemetry range fix. Mirrors assets.test.ts (real Express
 * app on an ephemeral port, no supertest).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

// ── mocks (hoisted) ──────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  rows: {
    machines: [] as unknown[],
    andonEvents: [] as unknown[],
    safetyEvents: [] as unknown[],
    interlockEvents: [] as unknown[],
  },
  featureRows: [] as unknown[],
  telemetryRows: [] as unknown[],
  machinePathRows: [] as unknown[],
  execute: vi.fn(),
  getState: vi.fn(),
  computeMetric: vi.fn(),
  getLatestTelemetry: vi.fn(async () => [] as unknown[]),
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async (k: string) => (k === "MACHINE_KEY" ? { id: 1, code: "AOI-01" } : undefined)),
  getMachineById: vi.fn(async (id: number) =>
    id === 1 ? { id: 1, code: "AOI-01", name: "AOI", machineType: "AOI", operationStatus: "running", capabilities: null, stationId: 4 } : undefined,
  ),
}));

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

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: (table: any) => {
        const key = (table && table.__mockName) || "";
        const rows = (h.rows as Record<string, unknown[]>)[key] ?? [];
        return chain(rows);
      },
    }),
    execute: h.execute,
  })),
}));

vi.mock("../../db/timescale", () => ({ getTsdb: () => null }));
vi.mock("../../db/otTelemetry", () => ({ getLatestTelemetry: h.getLatestTelemetry }));

vi.mock("../../../drizzle/schema", () => ({
  machines: { __mockName: "machines", id: "id", urn: "urn", isa95Path: "isa95Path", isActive: "isActive", machineType: "machineType", lifecycleStatus: "lifecycleStatus", stationId: "stationId" },
  andonEvents: { __mockName: "andonEvents", raisedAt: "raisedAt", machineId: "machineId" },
  safetyEvents: { __mockName: "safetyEvents", createdAt: "createdAt" },
  interlockEvents: { __mockName: "interlockEvents", firedAt: "firedAt" },
  stations: { __mockName: "stations" },
  productionLines: { __mockName: "productionLines" },
  workshops: { __mockName: "workshops" },
  factories: { __mockName: "factories" },
  deviceAdapters: { __mockName: "deviceAdapters" },
  deviceTags: { __mockName: "deviceTags" },
  edgeNodes: { __mockName: "edgeNodes" },
  machineTypeEnum: { enumValues: ["AVI", "AOI", "ROBOT"] },
  MACHINE_LIFECYCLE_STATUSES: ["registered", "commissioning", "active", "faulted", "maintenance", "decommissioned", "retired"],
}));

vi.mock("drizzle-orm", () => {
  const sqlTag: any = (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals });
  sqlTag.raw = (s: unknown) => s;
  sqlTag.join = (arr: unknown[], sep: unknown) => ({ arr, sep });
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

// State store — mocked (its own behaviour is covered in stateStore.test.ts).
vi.mock("../../services/stateStore/stateStore", () => ({
  getState: h.getState,
  normalizePath: (raw: unknown) => {
    const s = String(raw ?? "").trim().replace(/^\/+|\/+$/g, "");
    return !s || s.length > 512 ? null : s;
  },
}));

// Semantic layer — mocked compute; REAL error-class shape for instanceof.
vi.mock("../../services/semantics/metricRegistry", () => {
  class MetricComputeError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "MetricComputeError";
    }
  }
  return { computeMetric: h.computeMetric, MetricComputeError };
});

// Observability seams (state-read-p95 provider registration must not pull the
// real observability stack into this test).
vi.mock("../../services/observability/sloAlerting", () => ({
  registerSloObservationProvider: vi.fn(),
}));
vi.mock("../../services/observability/slo", () => ({
  DEFAULT_SLOS: [{ id: "state-read-p95", kind: "latency", latencyThresholdMs: 100 }],
}));

import { createV1Router } from "./router";
import { recordStateReadLatency, stateReadSloObservation, _resetStateReadSloForTests } from "./state";
import { _resetTimeseriesEngineCacheForTests } from "./timeseries";

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
  h.rows.machines = [];
  h.rows.andonEvents = [];
  h.rows.safetyEvents = [];
  h.rows.interlockEvents = [];
  h.featureRows = [];
  h.telemetryRows = [];
  h.machinePathRows = [];
  h.getState.mockReset();
  h.computeMetric.mockReset();
  h.getLatestTelemetry.mockReset().mockResolvedValue([]);
  h.execute.mockReset().mockImplementation(async (q: any) => {
    const text = Array.isArray(q?.strings) ? q.strings.join(" ") : "";
    if (text.includes("db_feature_status")) return h.featureRows;
    if (text.includes("ot_telemetry")) return h.telemetryRows;
    if (text.includes("FROM machines")) return h.machinePathRows;
    return [];
  });
  _resetStateReadSloForTests();
  _resetTimeseriesEngineCacheForTests();
});

function call(path: string, key?: string, init?: RequestInit) {
  const headers: Record<string, string> = { "content-type": "application/json", ...(init?.headers as never) };
  if (key) headers["authorization"] = `Bearer ${key}`;
  return fetch(`${base}${path}`, { ...init, headers });
}

// ── scope gating ─────────────────────────────────────────────────────────────
describe("W2-B1 — data:read scope gating", () => {
  const endpoints: Array<[string, string, string | undefined]> = [
    ["GET", "/api/v1/state/f1/a/l1/c1/m1", undefined],
    ["POST", "/api/v1/query/timeseries", "{}"],
    ["GET", "/api/v1/events", undefined],
    ["GET", "/api/v1/metrics/OEE?scope=line", undefined],
    ["GET", "/api/v1/genealogy/SN-1", undefined],
    ["POST", "/api/v1/genealogy/search", "{}"],
  ];

  it("no key → 401 everywhere", async () => {
    for (const [method, ep, body] of endpoints) {
      const res = await call(ep, undefined, { method, ...(body ? { body } : {}) });
      expect(res.status, `${method} ${ep}`).toBe(401);
    }
  });

  it("machine key (ingest:write only) → 403 everywhere", async () => {
    for (const [method, ep, body] of endpoints) {
      const res = await call(ep, "MACHINE_KEY", { method, ...(body ? { body } : {}) });
      expect(res.status, `${method} ${ep}`).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden");
    }
  });
});

// ── GET /state/{path+} ───────────────────────────────────────────────────────
describe("W2-B1 — GET /state/{path+}", () => {
  it("returns the StateSnapshot for a wildcard path (slashes preserved)", async () => {
    h.getState.mockResolvedValue({
      path: "f1/assy/line1/cell3/screw01",
      ts: "2026-07-12T08:00:00.000Z",
      state: "EXECUTE",
      values: { "screw.torque": { v: 1.82, unit: "N·m", q: "GOOD" } },
      health: "online",
      source: "live",
      machineId: 7,
    });
    const res = await call("/api/v1/state/f1/assy/line1/cell3/screw01", "MASTER");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(h.getState).toHaveBeenCalledWith("f1/assy/line1/cell3/screw01");
    expect(body.data.state).toBe("EXECUTE");
    expect(body.data.source).toBe("live");
    expect(body.data.values["screw.torque"].v).toBe(1.82);
  });

  it("path mapping to nothing → 404 (honest)", async () => {
    h.getState.mockResolvedValue(null);
    const res = await call("/api/v1/state/no/such/path/at/all", "MASTER");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("state-read SLO ring measures REAL latencies (good = ≤100ms)", () => {
    expect(stateReadSloObservation()).toBeNull(); // honest: no traffic → no data
    recordStateReadLatency(50);
    recordStateReadLatency(80);
    recordStateReadLatency(200);
    const obs = stateReadSloObservation();
    expect(obs).not.toBeNull();
    expect(obs!.long.total).toBe(3);
    expect(obs!.long.good).toBe(2);
  });
});

// ── POST /query/timeseries ───────────────────────────────────────────────────
describe("W2-B1 — POST /query/timeseries", () => {
  const baseBody = {
    series: "screw.torque",
    machineId: 7,
    from: "2026-07-12T00:00:00.000Z",
    to: "2026-07-12T08:00:00.000Z",
  };

  it("validation: missing path+machineId → 400; from ≥ to → 400; bad bucket → 400", async () => {
    let res = await call("/api/v1/query/timeseries", "MASTER", {
      method: "POST",
      body: JSON.stringify({ series: "x", from: baseBody.from, to: baseBody.to }),
    });
    expect(res.status).toBe(400);

    res = await call("/api/v1/query/timeseries", "MASTER", {
      method: "POST",
      body: JSON.stringify({ ...baseBody, from: baseBody.to, to: baseBody.from }),
    });
    expect(res.status).toBe(400);

    res = await call("/api/v1/query/timeseries", "MASTER", {
      method: "POST",
      body: JSON.stringify({ ...baseBody, agg: "avg", bucket: "5 minutes" }),
    });
    expect(res.status).toBe(400);
  });

  it("agg=raw returns points with value/quality/unit", async () => {
    h.telemetryRows = [
      { ts: "2026-07-12T01:00:00.000Z", numValue: 1.79, textValue: null, boolValue: null, quality: "good", unit: "N·m" },
      { ts: "2026-07-12T01:00:05.000Z", numValue: null, textValue: null, boolValue: true, quality: "good", unit: null },
    ];
    const res = await call("/api/v1/query/timeseries", "MASTER", { method: "POST", body: JSON.stringify(baseBody) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.count).toBe(2);
    expect(body.data.points[0]).toMatchObject({ v: 1.79, q: "GOOD", unit: "N·m" });
    expect(body.data.points[1].v).toBe(true);
  });

  it("agg with bucket falls back to PLAIN-PG when db_feature_status has no ok row (honest engine)", async () => {
    h.featureRows = []; // no timescaledb_hypertables row → plain PG
    h.telemetryRows = [
      { bucket: "2026-07-12T00:00:00.000Z", v: 1.5 },
      { bucket: "2026-07-12T00:05:00.000Z", v: 1.75 },
    ];
    const res = await call("/api/v1/query/timeseries", "MASTER", {
      method: "POST",
      body: JSON.stringify({ ...baseBody, agg: "avg", bucket: "5m" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.engine).toBe("plain-pg");
    expect(body.data.bucket).toBe("5m");
    expect(body.data.points).toEqual([
      { ts: "2026-07-12T00:00:00.000Z", v: 1.5 },
      { ts: "2026-07-12T00:05:00.000Z", v: 1.75 },
    ]);
  });

  it("agg with bucket uses time_bucket when the main DB reports Timescale ok", async () => {
    h.featureRows = [{ status: "ok" }];
    h.telemetryRows = [{ bucket: "2026-07-12T00:00:00.000Z", v: 2.0 }];
    const res = await call("/api/v1/query/timeseries", "MASTER", {
      method: "POST",
      body: JSON.stringify({ ...baseBody, agg: "max", bucket: "1h" }),
    });
    const body = await res.json();
    expect(body.data.engine).toBe("timescale-main");
    expect(body.data.points[0].v).toBe(2.0);
  });

  it("path → machineId resolution 404s when no machine has the isa95_path", async () => {
    h.machinePathRows = [];
    const res = await call("/api/v1/query/timeseries", "MASTER", {
      method: "POST",
      body: JSON.stringify({ series: "x", path: "f1/a/l1/c1/ghost", from: baseBody.from, to: baseBody.to }),
    });
    expect(res.status).toBe(404);
  });
});

// ── GET /events ──────────────────────────────────────────────────────────────
describe("W2-B1 — GET /events (union feed)", () => {
  beforeEach(() => {
    h.rows.andonEvents = [
      { id: 1, state: "red", reason: "quality", status: "raised", machineId: 1, lineId: null, stationId: null, raisedBySystem: true, title: "NG spike", raisedAt: "2026-07-12T01:00:00.000Z" },
    ];
    h.rows.safetyEvents = [
      { id: 2, eventType: "estop", outcome: "logged_only", detectedBy: "telemetry", robotId: null, lineId: 1, stationId: null, isNearMiss: false, createdAt: "2026-07-12T02:00:00.000Z" },
    ];
    h.rows.interlockEvents = [
      { id: 3, ruleId: 9, action: "alert", status: "fired", sourceType: "spc", observedValue: null, threshold: null, firedAt: "2026-07-12T03:00:00.000Z" },
    ];
  });

  it("unions the 3 sources into the Event shape, newest first", async () => {
    const res = await call("/api/v1/events", "MASTER");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.count).toBe(3);
    expect(body.data.sources).toEqual(["andon_events", "safety_events", "interlock_events"]);
    const [first, second, third] = body.data.events;
    expect(first.event_id).toBe("interlock-3");
    expect(first.severity).toBe("warning"); // action=alert
    expect(second.event_id).toBe("safety-2");
    expect(second.severity).toBe("critical");
    expect(third.event_id).toBe("andon-1");
    expect(third.type).toBe("andon:quality");
    expect(third.severity).toBe("critical"); // state=red
    for (const e of body.data.events) {
      expect(e).toHaveProperty("event_id");
      expect(e).toHaveProperty("type");
      expect(e).toHaveProperty("severity");
      expect(e).toHaveProperty("ts");
      expect(e).toHaveProperty("payload");
    }
  });

  it("severity is a MINIMUM filter", async () => {
    const body = await (await call("/api/v1/events?severity=critical", "MASTER")).json();
    expect(body.data.events.map((e: any) => e.event_id).sort()).toEqual(["andon-1", "safety-2"]);
  });

  it("type prefix filter", async () => {
    const body = await (await call("/api/v1/events?type=andon", "MASTER")).json();
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].event_id).toBe("andon-1");
  });

  it("path filter: machine-addressed events only + honest note", async () => {
    h.rows.machines = [{ id: 1, isa95Path: "f1/a/l1/c1/m1", urn: "urn:syn:asset:f1:l1:c1:m1" }];
    const body = await (await call("/api/v1/events?path=f1/a/l1", "MASTER")).json();
    expect(body.data.events).toHaveLength(1);
    expect(body.data.events[0].event_id).toBe("andon-1");
    expect(body.data.events[0].path).toBe("f1/a/l1/c1/m1");
    expect(body.data.events[0].asset_id).toBe("urn:syn:asset:f1:l1:c1:m1");
    expect(body.data.notes.join(" ")).toMatch(/excluded under a path filter/);
  });

  it("invalid severity → 400", async () => {
    expect((await call("/api/v1/events?severity=nuclear", "MASTER")).status).toBe(400);
  });
});

// ── GET /metrics/{metric} ────────────────────────────────────────────────────
describe("W2-B1 — GET /metrics/{metric} (semantic layer wrap)", () => {
  it("returns the MetricResult verbatim with definition_version", async () => {
    h.computeMetric.mockResolvedValue({
      metric: "OEE",
      scope: "line",
      path: "LINE1",
      window: { from: "2026-07-11T08:00:00.000Z", to: "2026-07-12T08:00:00.000Z" },
      value: 0.87,
      parts: { availability: 0.94, performance: 0.95, quality: 0.97 },
      definition_version: "OEE@v1",
    });
    const res = await call("/api/v1/metrics/OEE?scope=line&scopeId=3", "MASTER");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.definition_version).toBe("OEE@v1");
    expect(body.data.value).toBe(0.87);
    const [name, params] = h.computeMetric.mock.calls[0];
    expect(name).toBe("OEE");
    expect(params.scope).toBe("line");
    expect(params.scopeId).toBe(3);
    expect(params.from).toBeInstanceOf(Date);
    expect(params.to).toBeInstanceOf(Date);
  });

  it("missing scope → 400 WITHOUT calling the registry", async () => {
    const res = await call("/api/v1/metrics/OEE", "MASTER");
    expect(res.status).toBe(400);
    expect(h.computeMetric).not.toHaveBeenCalled();
  });

  it("honest error mapping: METRIC_NOT_FOUND → 404, SCOPE_ID_REQUIRED → 400, DB_UNAVAILABLE → 503", async () => {
    const { MetricComputeError } = await import("../../services/semantics/metricRegistry");
    h.computeMetric.mockRejectedValueOnce(new MetricComputeError("METRIC_NOT_FOUND" as never, "unknown"));
    expect((await call("/api/v1/metrics/Bogus?scope=line", "MASTER")).status).toBe(404);

    h.computeMetric.mockRejectedValueOnce(new MetricComputeError("SCOPE_ID_REQUIRED" as never, "need id"));
    expect((await call("/api/v1/metrics/OEE?scope=equipment", "MASTER")).status).toBe(400);

    h.computeMetric.mockRejectedValueOnce(new MetricComputeError("DB_UNAVAILABLE" as never, "db down"));
    expect((await call("/api/v1/metrics/OEE?scope=factory", "MASTER")).status).toBe(503);
  });
});

// ── W0-audit fix: /equipment/{id}/telemetry range query ──────────────────────
describe("W2-B1 — /equipment/{id}/telemetry range fix", () => {
  it("with from/to runs a REAL range query (no longer an echo)", async () => {
    h.telemetryRows = [
      { metric: "temp", numValue: 42, textValue: null, boolValue: null, quality: "good", unit: "C", ts: "2026-07-11T12:00:00.000Z" },
    ];
    const res = await call(
      "/api/v1/equipment/1/telemetry?from=2026-07-11T00:00:00.000Z&to=2026-07-12T00:00:00.000Z",
      "MASTER",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ranged).toBe(true);
    expect(body.data.count).toBe(1);
    expect(body.data.samples[0].tagKey).toBe("temp");
    // The range REALLY reached the SQL (params carried into the query).
    const rangeCall = h.execute.mock.calls.find((c: any[]) =>
      Array.isArray(c[0]?.strings) && c[0].strings.join(" ").includes("ot_telemetry"),
    );
    expect(rangeCall).toBeTruthy();
    expect(rangeCall![0].vals).toContain("2026-07-11T00:00:00.000Z");
    expect(rangeCall![0].vals).toContain("2026-07-12T00:00:00.000Z");
  });

  it("without from/to keeps the latest-samples behaviour (ranged:false)", async () => {
    h.getLatestTelemetry.mockResolvedValue([
      { tagKey: "temp", valueNumeric: 42, valueText: null, quality: "good", timestamp: "2026-07-12T00:00:00.000Z", unit: "C" },
    ]);
    const body = await (await call("/api/v1/equipment/1/telemetry", "MASTER")).json();
    expect(body.data.ranged).toBe(false);
    expect(body.data.count).toBe(1);
  });

  it("garbage from/to → 400", async () => {
    expect((await call("/api/v1/equipment/1/telemetry?from=yesterday", "MASTER")).status).toBe(400);
  });
});

// ── openapi contract ─────────────────────────────────────────────────────────
describe("W2-B1 — openapi documents the new endpoints", () => {
  it("openapi.json includes the Data paths + data:read scope", async () => {
    const spec = await (await call("/api/v1/openapi.json")).json();
    expect(spec.paths["/api/v1/state/{path}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/query/timeseries"]?.post).toBeTruthy();
    expect(spec.paths["/api/v1/events"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/metrics/{metric}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/genealogy/{unitId}"]?.get).toBeTruthy();
    expect(spec.paths["/api/v1/genealogy/search"]?.post).toBeTruthy();
    expect(spec.info.description).toMatch(/data:read/);
  });
});
