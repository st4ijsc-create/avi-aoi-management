/**
 * doc 44 W2-A2 (G1.10) — URN/ISA-95 identity service tests.
 *
 * Covers: the shared slug rule (lowercase, Vietnamese diacritics stripped,
 * [a-z0-9-] only, empty → 'unassigned'), the pure identity builder (spec §6.2
 * format, missing levels → 'unassigned'), computeUrn/computePath over a mocked
 * hierarchy join, and syncAssetIdentity upsert semantics (no-write when already
 * in sync; '-m{id}' suffix on an ACTIVE URN collision — matches the 0251
 * backfill rule). DB is faked at ../../db/connection (FIFO select results +
 * recorded updates) — no real Postgres needed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    updates: [] as Record<string, unknown>[],
  };
  function chain(rows: unknown[]) {
    const p: any = Promise.resolve(rows);
    p.from = () => p;
    p.leftJoin = () => p;
    p.innerJoin = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = () => p;
    return p;
  }
  const db = {
    select: (_cols?: unknown) => chain(state.selectResults.shift() ?? []),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push(data);
        },
      }),
    }),
  };
  return { state, db };
});

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fake.db) }));
// Schema tables are only used as identity handles by the fake chains.
vi.mock("../../../drizzle/schema", () => ({
  machines: { id: "id", code: "code", urn: "urn", isa95Path: "isa95Path", stationId: "stationId", isActive: "isActive" },
  stations: { id: "id", code: "code", lineId: "lineId" },
  productionLines: { id: "id", code: "code", workshopId: "workshopId" },
  workshops: { id: "id", code: "code", factoryId: "factoryId" },
  factories: { id: "id", code: "code" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  ne: (...a: unknown[]) => a,
}));

import { slugSegment, identityFromCodes, computeUrn, computePath, syncAssetIdentity, UNASSIGNED_SEGMENT } from "./urnService";

beforeEach(() => {
  fake.state.selectResults = [];
  fake.state.updates = [];
});

// ── slug rule (shared with the UNS convention) ───────────────────────────────
describe("G1.10 — slugSegment", () => {
  it("lowercases and keeps [a-z0-9-] only", () => {
    expect(slugSegment("AOI 01")).toBe("aoi-01");
    expect(slugSegment("Line#1 (SMT)")).toBe("line-1-smt");
  });

  it("strips Vietnamese diacritics including đ/Đ", () => {
    expect(slugSegment("Xưởng Đúc 01")).toBe("xuong-duc-01");
    expect(slugSegment("Đà Nẵng")).toBe("da-nang");
    expect(slugSegment("HÀ NỘI")).toBe("ha-noi");
  });

  it("collapses dash runs and trims edge dashes", () => {
    expect(slugSegment("--A__B--")).toBe("a-b");
    expect(slugSegment("a - - b")).toBe("a-b");
  });

  it("empty / null / symbol-only → 'unassigned'", () => {
    expect(slugSegment("")).toBe(UNASSIGNED_SEGMENT);
    expect(slugSegment(null)).toBe(UNASSIGNED_SEGMENT);
    expect(slugSegment(undefined)).toBe(UNASSIGNED_SEGMENT);
    expect(slugSegment("###")).toBe(UNASSIGNED_SEGMENT);
  });
});

// ── pure identity builder (spec §6.2) ────────────────────────────────────────
describe("G1.10 — identityFromCodes", () => {
  const CODES = { factoryCode: "HANOI", workshopCode: "ASSY", lineCode: "LINE1", stationCode: "CELL3", machineCode: "SCREW01" };

  it("builds urn:syn:asset:{site}:{line}:{cell}:{equipment} and {site}/{area}/{line}/{cell}/{equipment}", () => {
    const id = identityFromCodes(CODES);
    expect(id.urn).toBe("urn:syn:asset:hanoi:line1:cell3:screw01");
    expect(id.path).toBe("hanoi/assy/line1/cell3/screw01");
  });

  it("missing levels become 'unassigned'", () => {
    const id = identityFromCodes({ machineCode: "AOI-9" });
    expect(id.urn).toBe("urn:syn:asset:unassigned:unassigned:unassigned:aoi-9");
    expect(id.path).toBe("unassigned/unassigned/unassigned/unassigned/aoi-9");
  });

  it("equipment suffix is appended verbatim (collision rule)", () => {
    const id = identityFromCodes(CODES, "-m7");
    expect(id.urn.endsWith(":screw01-m7")).toBe(true);
    expect(id.path.endsWith("/screw01-m7")).toBe(true);
  });
});

// ── DB-backed compute + sync ─────────────────────────────────────────────────
const ROW = {
  machineCode: "AOI 01",
  isActive: true,
  currentUrn: null,
  currentPath: null,
  stationCode: "ST-1",
  lineCode: "Line 1",
  workshopCode: "Xưởng A",
  factoryCode: "F1",
};

describe("G1.10 — computeUrn / computePath", () => {
  it("computes from the live hierarchy join", async () => {
    fake.state.selectResults = [[{ ...ROW }]];
    expect(await computeUrn(1)).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01");
    fake.state.selectResults = [[{ ...ROW }]];
    expect(await computePath(1)).toBe("f1/xuong-a/line-1/st-1/aoi-01");
  });

  it("unknown machine → null", async () => {
    fake.state.selectResults = [[]];
    expect(await computeUrn(999)).toBeNull();
  });
});

describe("G1.10 — syncAssetIdentity", () => {
  it("stamps urn + isa95Path when out of sync", async () => {
    fake.state.selectResults = [
      [{ ...ROW }], // loadCodes
      [], // collision check — no holder
    ];
    const id = await syncAssetIdentity(5);
    expect(id?.urn).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01");
    expect(fake.state.updates).toHaveLength(1);
    expect(fake.state.updates[0].urn).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01");
    expect(fake.state.updates[0].isa95Path).toBe("f1/xuong-a/line-1/st-1/aoi-01");
  });

  it("no write when the stored identity is already correct", async () => {
    fake.state.selectResults = [
      [{ ...ROW, currentUrn: "urn:syn:asset:f1:line-1:st-1:aoi-01", currentPath: "f1/xuong-a/line-1/st-1/aoi-01" }],
      [], // collision check
    ];
    const id = await syncAssetIdentity(5);
    expect(id?.urn).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01");
    expect(fake.state.updates).toHaveLength(0);
  });

  it("suffixes '-m{id}' when another ACTIVE machine holds the URN (slug collision)", async () => {
    fake.state.selectResults = [
      [{ ...ROW }], // loadCodes
      [{ id: 9 }], // collision: another active machine already owns the urn
    ];
    const id = await syncAssetIdentity(5);
    expect(id?.urn).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01-m5");
    expect(id?.path).toBe("f1/xuong-a/line-1/st-1/aoi-01-m5");
    expect(fake.state.updates[0].urn).toBe("urn:syn:asset:f1:line-1:st-1:aoi-01-m5");
  });

  it("unknown machine → null, no write", async () => {
    fake.state.selectResults = [[]];
    expect(await syncAssetIdentity(404)).toBeNull();
    expect(fake.state.updates).toHaveLength(0);
  });
});
