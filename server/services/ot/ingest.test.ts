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

  const baseAdapter = {
    adapterId: 1, code: "A1", machineId: null, protocol: "stub" as const,
    connection: { endpoint: "stub://x" }, pollIntervalMs: 1000,
    tags: [{ tagKey: "t", address: "addr", dataType: "float" as const }],
    driver: {} as never,
  };

  it("no-op safe when DB unavailable and UNS off", async () => {
    vi.doMock("../../db/connection", () => ({ getDb: async () => null }));
    const { ingestSample } = await import("./ingest");
    await expect(ingestSample(baseAdapter, sample(1))).resolves.toBeUndefined();
  });

  it("UNS_SPARKPLUG_ENABLED=true → gọi publishSparkplugDData (không publishNormalized)", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.doMock("../../db/connection", () => ({ getDb: async () => null }));
    vi.doMock("../unsBridge", () => ({ isUnsBridgeEnabled: () => true }));
    const publishSparkplugDData = vi.fn();
    const publishNormalized = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishSparkplugDData, publishNormalized }));

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(23.4));

    expect(publishSparkplugDData).toHaveBeenCalledTimes(1);
    expect(publishNormalized).not.toHaveBeenCalled();
    const [deviceId, metrics] = publishSparkplugDData.mock.calls[0];
    expect(deviceId).toBe("A1");
    expect(metrics[0]).toMatchObject({ name: "t", type: "Double", value: 23.4 });
  });

  it("Sparkplug off → đường JSON cũ publishNormalized", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "false");
    vi.doMock("../../db/connection", () => ({ getDb: async () => null }));
    vi.doMock("../unsBridge", () => ({ isUnsBridgeEnabled: () => true }));
    const publishSparkplugDData = vi.fn();
    const publishNormalized = vi.fn();
    vi.doMock("../unsPublisher", () => ({ publishSparkplugDData, publishNormalized }));

    const { ingestSample } = await import("./ingest");
    await ingestSample(baseAdapter, sample(1));

    expect(publishNormalized).toHaveBeenCalledTimes(1);
    expect(publishSparkplugDData).not.toHaveBeenCalled();
  });

  it("không throw khi publisher chưa connect (publishSparkplugDData ném)", async () => {
    vi.stubEnv("OT_INGEST_TO_UNS", "true");
    vi.stubEnv("UNS_SPARKPLUG_ENABLED", "true");
    vi.doMock("../../db/connection", () => ({ getDb: async () => null }));
    vi.doMock("../unsBridge", () => ({ isUnsBridgeEnabled: () => true }));
    vi.doMock("../unsPublisher", () => ({
      publishSparkplugDData: vi.fn(() => { throw new Error("not connected"); }),
      publishNormalized: vi.fn(),
    }));

    const { ingestSample } = await import("./ingest");
    await expect(ingestSample(baseAdapter, sample(1))).resolves.toBeUndefined();
  });
});
