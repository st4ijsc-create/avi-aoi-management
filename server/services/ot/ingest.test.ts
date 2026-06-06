/**
 * Sprint F1.1 — ingest unit tests (mapSampleToRow is pure; ingestSample mocks getDb).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapSampleToRow } from "./ingest";
import type { OtSample } from "./otDriver";

function sample(value: OtSample["value"], extra: Partial<OtSample> = {}): OtSample {
  return {
    tagKey: "t",
    raw: value,
    value,
    quality: "good",
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    ...extra,
  };
}

describe("mapSampleToRow", () => {
  it("number → valueNumeric (string), valueText null", () => {
    const row = mapSampleToRow(1, 2, sample(42.5));
    expect(row.adapterId).toBe(1);
    expect(row.machineId).toBe(2);
    expect(row.valueNumeric).toBe("42.5");
    expect(row.valueText).toBeNull();
  });

  it("boolean → valueText, valueNumeric null", () => {
    expect(mapSampleToRow(1, null, sample(true)).valueText).toBe("true");
    expect(mapSampleToRow(1, null, sample(false)).valueText).toBe("false");
    expect(mapSampleToRow(1, null, sample(true)).valueNumeric).toBeNull();
  });

  it("string → valueText, truncated to 500 chars", () => {
    const long = "x".repeat(600);
    const row = mapSampleToRow(1, null, sample(long));
    expect(row.valueText).toHaveLength(500);
  });

  it("null value → both null but row well-formed", () => {
    const row = mapSampleToRow(7, null, sample(null));
    expect(row.valueNumeric).toBeNull();
    expect(row.valueText).toBeNull();
    expect(row.tagKey).toBe("t");
    expect(row.quality).toBe("good");
  });

  it("non-finite number is not stored as numeric", () => {
    const row = mapSampleToRow(1, null, sample(Number.NaN));
    expect(row.valueNumeric).toBeNull();
  });

  it("passes through quality and timestamp", () => {
    const row = mapSampleToRow(1, null, sample(1, { quality: "uncertain" }));
    expect(row.quality).toBe("uncertain");
    expect(row.timestamp).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });
});

describe("ingestSample", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("no-op safe when DB unavailable and UNS off", async () => {
    vi.doMock("../../db/connection", () => ({ getDb: async () => null }));
    const { ingestSample } = await import("./ingest");
    const adapter = {
      adapterId: 1, code: "A1", machineId: null, protocol: "stub" as const,
      connection: { endpoint: "stub://x" }, pollIntervalMs: 1000, tags: [],
      driver: {} as never,
    };
    await expect(ingestSample(adapter, sample(1))).resolves.toBeUndefined();
  });
});
