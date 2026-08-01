/**
 * W5-D (doc 27 §6 A10) — streaming export route tests.
 *
 * Real Express app on an ephemeral port (global fetch, no supertest — the
 * apiV1.test.ts discipline), mocked DB layer. Covers:
 *   • auth reject: no credential → 401; machine key (ingest:write only) → 403;
 *     master key + session both pass;
 *   • window guard: missing from/to → 400, span > EXPORT_MAX_WINDOW_DAYS → 400;
 *   • chunked CSV correctness over MULTIPLE cursor pages (header + rows in
 *     order, RFC-4180 escaping) and the cursor actually paging;
 *   • JSON stream is one valid document with count;
 *   • session principals carry userId/userRole into the cursor query (tenant scoping);
 *   • measurements endpoint streams keyset pages;
 *   • an audit_logs row is written per export with the row count.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  cursorMock: vi.fn(),
  auditMock: vi.fn(async () => ({ id: 1 })),
  sessionUser: null as Record<string, unknown> | null,
  measurementPages: [] as Array<Array<Record<string, unknown>>>,
  oeeExecRows: [] as Array<Record<string, unknown>>,
}));

// Master key: only "MASTER" is valid in this test.
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

// db barrel: auth (api_keys lookup disabled via null db) + machine key + audit.
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async (k: string) =>
    k === "MACHINE_KEY" ? { id: 1, code: "AOI-01" } : undefined,
  ),
  createAuditLog: h.auditMock,
}));

// Session authenticator (browser cookie path).
vi.mock("../../_core/sdk", () => ({
  sdk: { authenticateRequest: vi.fn(async () => h.sessionUser) },
}));

// Inspections cursor (the audited-projection read path).
vi.mock("../../db/inspection", () => ({
  getProductInspectionsCursor: h.cursorMock,
}));

// Measurements keyset query → fake drizzle chain returning scripted pages.
// Also exposes `execute` (used by the /oee aggregate dataset).
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    execute: async (_q: unknown) => h.oeeExecRows,
    select: (_cols: unknown) => ({
      from: (_t: unknown) => ({
        innerJoin: (_t2: unknown, _on: unknown) => ({
          leftJoin: (_t3: unknown, _on2: unknown) => ({
            leftJoin: (_t4: unknown, _on3: unknown) => ({
              where: (_pred: unknown) => ({
                orderBy: (_o: unknown) => ({
                  limit: async (_n: number) => h.measurementPages.shift() ?? [],
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  })),
}));

// Aggregate datasets (yield / defect-pareto) reuse the R1 report aggregators.
vi.mock("../../db/reportAggregators", () => ({
  getYieldByProduct: vi.fn(async () => [
    { productModelId: 5, productCode: "PM-5", productName: "Board X", total: 100, ok: 95, ng: 4, ntf: 1, yieldRate: 96 },
  ]),
  getDefectParetoByCategory: vi.fn(async () => ({
    dimension: "category",
    items: [
      { key: "SOLDER", count: 8, percentage: 66.67, cumulativePercentage: 66.67, bucket: "value" },
      { key: "UNCLASSIFIED", count: 4, percentage: 33.33, cumulativePercentage: 100, bucket: "unclassified" },
    ],
    totalDefects: 12,
    classifiedDefects: 8,
    unclassifiedDefects: 4,
    topN: 10,
  })),
}));

import { createExportRouter, parseExportWindow, INSPECTION_EXPORT_COLUMNS } from "./exportRouter";
import { csvEscape, toCsvLine } from "../../services/universalExportService";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  // Plenty of headroom so the dedicated limiter never trips the suite.
  process.env.EXPORT_RATE_LIMIT_PER_5MIN = "1000";
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/export", createExportRouter());
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ROW_1 = {
  id: 3,
  serialNumber: "SN-1,comma",
  overallResult: "NG",
  originalResult: "NG",
  aiDecision: null,
  inspectionTime: new Date("2026-06-02T01:00:00.000Z"),
  cycleTime: 12,
  machineId: 12,
  productModelId: 5,
  productModel: 'Model "X"',
  batchNumber: "B1",
  corporateCode: "C1",
  factoryCode: "F1",
  workshopCode: "W1",
  lineCode: "L1",
  stageCode: "S1",
  acknowledgedBy: null,
  acknowledgedAt: null,
  createdAt: new Date("2026-06-02T01:00:01.000Z"),
};
const ROW_2 = { ...ROW_1, id: 2, serialNumber: "SN-2", overallResult: "OK" };
const ROW_3 = { ...ROW_1, id: 1, serialNumber: "SN-3", overallResult: "NTF" };

function seedTwoPages() {
  h.cursorMock.mockReset();
  h.cursorMock
    .mockResolvedValueOnce({ data: [ROW_1, ROW_2], nextCursor: "CUR2", prevCursor: null, hasMore: true })
    .mockResolvedValueOnce({ data: [ROW_3], nextCursor: null, prevCursor: null, hasMore: false });
}

beforeEach(() => {
  h.sessionUser = null;
  h.auditMock.mockClear();
  h.measurementPages = [];
  h.oeeExecRows = [];
  seedTwoPages();
});

const WINDOW = "from=2026-06-01&to=2026-06-08";

describe("auth", () => {
  it("no credential → 401", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.csv?${WINDOW}`);
    expect(res.status).toBe(401);
  });

  it("machine key (ingest:write only) → 403 with scope message", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.csv?${WINDOW}`, {
      headers: { "x-api-key": "MACHINE_KEY" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("export:read");
  });

  it("unknown key → 401", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.csv?${WINDOW}`, {
      headers: { authorization: "Bearer NOPE" },
    });
    expect(res.status).toBe(401);
  });
});

describe("window guard", () => {
  it("missing from/to → 400", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.csv`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("REQUIRED");
  });

  it("window over the max span → 400", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.csv?from=2026-01-01&to=2026-06-01`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Window too large");
  });

  it("from after to → 400; parseExportWindow unit behaviour", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.csv?from=2026-06-08&to=2026-06-01`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(400);
    expect(parseExportWindow("2026-06-01", "2026-06-02").window).toBeDefined();
    expect(parseExportWindow("garbage", "2026-06-02").error).toContain("Invalid");
    expect(parseExportWindow(undefined, undefined).error).toContain("REQUIRED");
  });
});

describe("CSV streaming", () => {
  it("streams header + all rows across cursor pages with RFC-4180 escaping", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.csv?${WINDOW}&machineId=12`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("inspections_2026-06-01_2026-06-08.csv");

    const text = await res.text();
    const lines = text.split("\r\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(1 + 3); // header + 3 rows over 2 pages
    expect(lines[0]).toBe(toCsvLine([...INSPECTION_EXPORT_COLUMNS]).trim());
    // Escaping: comma-carrying serial is quoted; embedded quotes doubled.
    expect(lines[1]).toContain('"SN-1,comma"');
    expect(lines[1]).toContain('"Model ""X"""');
    expect(lines[1]).toContain("2026-06-02T01:00:00.000Z");
    expect(lines[2]).toContain("SN-2");
    expect(lines[3]).toContain("SN-3");

    // Cursor paging actually happened: 2 calls, second resumes from CUR2.
    expect(h.cursorMock).toHaveBeenCalledTimes(2);
    expect(h.cursorMock.mock.calls[0][0]).toMatchObject({
      machineId: 12,
      cursor: undefined,
      startDate: new Date("2026-06-01"),
      endDate: new Date("2026-06-08"),
    });
    expect(h.cursorMock.mock.calls[1][0]).toMatchObject({ cursor: "CUR2" });
  });

  it("writes an audit_logs row with the exported range and row count", async () => {
    await fetch(`${baseUrl}/api/export/inspections.csv?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    await vi.waitFor(() => expect(h.auditMock).toHaveBeenCalled());
    const entry = h.auditMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(entry.action).toBe("export");
    expect(entry.userName).toBe("master");
    expect(entry.details.rows).toBe(3);
    expect(entry.details.completed).toBe(true);
    expect(entry.details.from).toContain("2026-06-01");
    expect(entry.status).toBe("success");
  });
});

describe("JSON streaming", () => {
  it("emits one valid JSON document with rows + count", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.json?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = JSON.parse(await res.text());
    expect(body.dataset).toBe("inspections");
    expect(body.rows).toHaveLength(3);
    expect(body.count).toBe(3);
    expect(body.rows[0].serialNumber).toBe("SN-1,comma");
  });
});

describe("session principal", () => {
  it("cookie session passes and carries userId/userRole into the cursor query", async () => {
    h.sessionUser = { id: 5, name: "Op", email: "op@x", role: "user" };
    const res = await fetch(`${baseUrl}/api/export/inspections.json?${WINDOW}`, {
      headers: { cookie: "session=abc" },
    });
    expect(res.status).toBe(200);
    expect(h.cursorMock.mock.calls[0][0]).toMatchObject({ userId: 5, userRole: "user" });
  });
});

describe("measurements endpoint", () => {
  it("streams keyset pages as CSV", async () => {
    const m = (id: number) => ({
      id,
      inspectionId: 3,
      serialNumber: "SN-1",
      inspectionTime: new Date("2026-06-02T01:00:00.000Z"),
      machineId: 12,
      pointDefId: 9,
      pointCode: "P9",
      pointName: "Fuse",
      measuredValue: 1.5,
      measuredValueText: null,
      result: "NG",
      defectCatalogId: 2,
      defectCode: "MISSING",
      defectName: "Missing part",
      defectSeverity: "MAJOR",
      aiConfidence: 0.97,
    });
    h.measurementPages = [[m(1), m(2)]]; // single short page (< page size) ends the loop
    const res = await fetch(`${baseUrl}/api/export/measurements.csv?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines).toHaveLength(1 + 2);
    expect(lines[0].split(",")[0]).toBe("id");
    expect(lines[1]).toContain("MISSING");
  });

  it("unknown export path → structured 404", async () => {
    const res = await fetch(`${baseUrl}/api/export/nope.csv?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.available).toContain("/api/export/inspections.csv");
    expect(body.available).toContain("/api/export/inspections.xlsx");
    expect(body.available).toContain("/api/export/yield.csv");
    expect(body.available).toContain("/api/export/oee.xlsx");
  });
});

describe("buffered documents (item 19: XLSX/PDF)", () => {
  it("inspections.xlsx renders a bounded branded workbook + audits the row count", async () => {
    const res = await fetch(`${baseUrl}/api/export/inspections.xlsx?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    expect(res.headers.get("content-disposition")).toContain("inspections_2026-06-01_2026-06-08.xlsx");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 2).toString("latin1")).toBe("PK"); // xlsx = zip → "PK" magic

    await vi.waitFor(() => expect(h.auditMock).toHaveBeenCalled());
    const entry = h.auditMock.mock.calls.at(-1)![0] as Record<string, any>;
    expect(entry.details.endpoint).toBe("/api/export/inspections.xlsx");
    expect(entry.details.rows).toBe(3);
    expect(entry.details.completed).toBe(true);
  });
});

describe("aggregate datasets (item 19: yield / oee / defect-pareto)", () => {
  it("yield.csv is a clean data CSV (header + product rows)", async () => {
    const res = await fetch(`${baseUrl}/api/export/yield.csv?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const lines = (await res.text()).split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("productModelId,productCode,productName,total,ok,ng,ntf,yieldRate");
    expect(lines[1]).toContain("PM-5");
    expect(lines[1]).toContain("96");
  });

  it("yield.xlsx renders a workbook", async () => {
    const res = await fetch(`${baseUrl}/api/export/yield.xlsx?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
  });

  it("defect-pareto.json returns the dimension Pareto incl. UNCLASSIFIED", async () => {
    const res = await fetch(`${baseUrl}/api/export/defect-pareto.json?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body.dataset).toBe("defect-pareto");
    expect(body.rows.map((r: { key: string }) => r.key)).toEqual(["SOLDER", "UNCLASSIFIED"]);
  });

  it("oee.json returns per machine/day averages from oee_metrics", async () => {
    h.oeeExecRows = [
      { day: "2026-06-01", machine_id: 1, machine_code: "AOI-01", availability: 90, performance: 95, quality: 99, oee: 84.6, total_count: 100, good_count: 99, reject_count: 1 },
    ];
    const res = await fetch(`${baseUrl}/api/export/oee.json?${WINDOW}`, {
      headers: { "x-api-key": "MASTER" },
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body.dataset).toBe("oee");
    expect(body.rows[0].machine_code).toBe("AOI-01");
    expect(body.rows[0].oee).toBe(84.6);
  });

  it("aggregate datasets still enforce the window guard (missing from/to → 400)", async () => {
    const res = await fetch(`${baseUrl}/api/export/yield.csv`, { headers: { "x-api-key": "MASTER" } });
    expect(res.status).toBe(400);
  });

  it("aggregate datasets still enforce scope (machine key → 403)", async () => {
    const res = await fetch(`${baseUrl}/api/export/yield.csv?${WINDOW}`, {
      headers: { "x-api-key": "MACHINE_KEY" },
    });
    expect(res.status).toBe(403);
  });
});

describe("csv primitives", () => {
  it("csvEscape handles null/quote/comma/newline/date", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
    expect(csvEscape(new Date("2026-06-01T00:00:00.000Z"))).toBe("2026-06-01T00:00:00.000Z");
  });
});
