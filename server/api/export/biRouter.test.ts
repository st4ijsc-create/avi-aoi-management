/**
 * W5-D (doc 27 §6 A10) — BI dataset feed tests.
 *
 * Covers: bi:read scope auth (401/403/master-ok), the dataset catalog, unknown
 * dataset 404, nextToken continuation paging (page 1 returns a token whose
 * decoded offset advances by pageSize; final page returns nextToken null),
 * MV-fresh vs live-fallback source selection for inspections_daily, and the
 * token encode/decode round-trip incl. garbage input.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  executeMock: vi.fn(async (_q: unknown) => [] as Array<Record<string, unknown>>),
  mvFresh: null as { lastRefreshMs: number; ageMs: number; thresholdMs: number } | null,
}));

vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null), // api_keys lookup disabled → master/machine only
  getMachineByApiKey: vi.fn(async (k: string) =>
    k === "MACHINE_KEY" ? { id: 1, code: "AOI-01" } : undefined,
  ),
}));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ execute: h.executeMock })),
}));

vi.mock("../../functions/cachedStatistics", () => ({
  getMvFreshness: vi.fn(async () => h.mvFresh),
}));

import { createBiRouter, encodeNextToken, decodeNextToken, BI_DATASETS } from "./biRouter";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use("/api/bi", createBiRouter());
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.executeMock.mockReset();
  h.executeMock.mockResolvedValue([]);
  h.mvFresh = null;
});

const MASTER = { "x-api-key": "MASTER" };

describe("auth (bi:read scope)", () => {
  it("no key → 401", async () => {
    const res = await fetch(`${baseUrl}/api/bi/datasets`);
    expect(res.status).toBe(401);
  });

  it("machine key (ingest:write only) → 403", async () => {
    const res = await fetch(`${baseUrl}/api/bi/datasets`, { headers: { "x-api-key": "MACHINE_KEY" } });
    expect(res.status).toBe(403);
  });

  it("master key → catalog with the three datasets + OData disclaimer", async () => {
    const res = await fetch(`${baseUrl}/api/bi/datasets`, { headers: MASTER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.datasets.map((d: { name: string }) => d.name).sort()).toEqual([
      "defect_pareto",
      "inspections_daily",
      "machine_oee",
    ]);
    expect(body.odata).toContain("NOT supported");
  });
});

describe("dataset endpoint", () => {
  it("unknown dataset → 404 with the available list", async () => {
    const res = await fetch(`${baseUrl}/api/bi/datasets/nope`, { headers: MASTER });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.available).toEqual(BI_DATASETS.map((d) => d.name));
  });

  it("window over the cap → 400", async () => {
    const res = await fetch(
      `${baseUrl}/api/bi/datasets/inspections_daily?from=2020-01-01&to=2026-01-01`,
      { headers: MASTER },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Window too large");
  });

  it("nextToken paging: pageSize+1 rows → token; final page → null", async () => {
    const mk = (day: string) => ({ day, machine_id: 1, total: 10, ok: 9, ng: 1, ntf: 0, yield_rate: 90 });
    // Page 1: query LIMIT pageSize+1 (=3) returns 3 rows → 2 rows + token.
    h.executeMock.mockResolvedValueOnce([mk("2026-06-01"), mk("2026-06-02"), mk("2026-06-03")]);
    const res1 = await fetch(
      `${baseUrl}/api/bi/datasets/inspections_daily?from=2026-06-01&to=2026-06-10&pageSize=2`,
      { headers: MASTER },
    );
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.rows).toHaveLength(2);
    expect(body1.count).toBe(2);
    expect(body1.nextToken).not.toBeNull();
    expect(decodeNextToken(body1.nextToken)).toBe(2); // offset advanced by pageSize

    // Page 2: only 1 row left → nextToken null.
    h.executeMock.mockResolvedValueOnce([mk("2026-06-03")]);
    const res2 = await fetch(
      `${baseUrl}/api/bi/datasets/inspections_daily?from=2026-06-01&to=2026-06-10&pageSize=2&nextToken=${body1.nextToken}`,
      { headers: MASTER },
    );
    const body2 = await res2.json();
    expect(body2.rows).toHaveLength(1);
    expect(body2.nextToken).toBeNull();
  });

  it("inspections_daily prefers the MV when fresh, live query when stale", async () => {
    // Fresh MV → the single query hits hourly_yield_cache.
    h.mvFresh = { lastRefreshMs: Date.now(), ageMs: 1000, thresholdMs: 600000 };
    h.executeMock.mockResolvedValueOnce([]);
    await fetch(`${baseUrl}/api/bi/datasets/inspections_daily?from=2026-06-01&to=2026-06-02`, {
      headers: MASTER,
    });
    expect(h.executeMock).toHaveBeenCalledTimes(1);
    const mvSql = JSON.stringify(h.executeMock.mock.calls[0][0]);
    expect(mvSql).toContain("hourly_yield_cache");

    // Stale MV (freshness null) → live query against product_inspections.
    h.executeMock.mockReset();
    h.mvFresh = null;
    h.executeMock.mockResolvedValueOnce([]);
    await fetch(`${baseUrl}/api/bi/datasets/inspections_daily?from=2026-06-01&to=2026-06-02`, {
      headers: MASTER,
    });
    const liveSql = JSON.stringify(h.executeMock.mock.calls[0][0]);
    expect(liveSql).toContain("product_inspections");
    expect(liveSql).toContain("to_factory_time");
  });

  it("defect_pareto and machine_oee answer with their documented shape", async () => {
    h.executeMock.mockResolvedValueOnce([
      { defect_code: "MISSING", defect_name: "Missing part", defect_name_vi: "Thiếu linh kiện", count: 12, pct: 60 },
    ]);
    const res = await fetch(`${baseUrl}/api/bi/datasets/defect_pareto?from=2026-06-01&to=2026-06-08`, {
      headers: MASTER,
    });
    const body = await res.json();
    expect(body.dataset).toBe("defect_pareto");
    expect(body.rows[0].defect_code).toBe("MISSING");

    h.executeMock.mockResolvedValueOnce([
      { day: "2026-06-01", machine_id: 1, machine_code: "AOI-01", availability: 90, performance: 95, quality: 99, oee: 84.6, total_count: 100, good_count: 99, reject_count: 1 },
    ]);
    const res2 = await fetch(`${baseUrl}/api/bi/datasets/machine_oee?from=2026-06-01&to=2026-06-08`, {
      headers: MASTER,
    });
    const body2 = await res2.json();
    expect(body2.rows[0].oee).toBe(84.6);
  });
});

describe("nextToken codec", () => {
  it("round-trips offsets and defends against garbage", () => {
    expect(decodeNextToken(encodeNextToken(0))).toBe(0);
    expect(decodeNextToken(encodeNextToken(5000))).toBe(5000);
    expect(decodeNextToken(undefined)).toBe(0);
    expect(decodeNextToken("")).toBe(0);
    expect(decodeNextToken("!!!not-base64!!!")).toBe(0);
    expect(decodeNextToken(Buffer.from('{"o":-5}').toString("base64url"))).toBe(0);
  });
});
